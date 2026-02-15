/**
 * TerraRun API: PostgreSQL + Prisma, cookie sessions, Strava OAuth + activity sync.
 * Env: DATABASE_URL, SESSION_SECRET, STRAVA_*, FRONTEND_URL.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { prisma } from './lib/prisma.js';
import { requireUser } from './middleware/requireUser.js';
import {
  applyLoopClaims,
  bboxToCellRange,
  cellToGeoJSONRing,
  getCellSize,
  lngLatToMercator,
} from './lib/territory.js';
import { computeAndEvaluateBadges } from './badges/evaluateBadges.js';
import { getBadgeDefinition, TIER_ROMAN, BADGE_DEFINITIONS } from './badges/definitions.js';

const METERS_PER_MILE = 1609.344;

const app = express();

// Render / reverse proxy: so req.protocol and req.get('host') reflect the public URL (https)
app.set('trust proxy', 1);

const PORT = Number(process.env.PORT) || 8787;
const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-production';
const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const FRONTEND_URL = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
const isProd = process.env.NODE_ENV === 'production';
const AUTO_SYNC_MINUTES = Number(process.env.AUTO_SYNC_MINUTES) || 60;

/** Strava redirect_uri: use env if set (full URL, e.g. https://terrarun-api.onrender.com/auth/strava/callback), else derive from request (trust proxy). */
function getStravaRedirectUri(req) {
  const fromEnv = (process.env.STRAVA_REDIRECT_URI || '').trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  const protocol = req.protocol || 'http';
  const host = req.get('host');
  if (!host) return '';
  return `${protocol}://${host}/auth/strava/callback`;
}

// CORS: allow FRONTEND_URL + CORS_EXTRA_ORIGINS only. Set in env (e.g. on Render). credentials:true required for cookies.
const allowedOrigins = [FRONTEND_URL].filter(Boolean);
const extraOrigins = (process.env.CORS_EXTRA_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
allowedOrigins.push(...extraOrigins);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) {
      if (DEBUG) console.log('[cors] no origin (e.g. same-origin or curl) allowed=true');
      return cb(null, true);
    }
    const o = origin.replace(/\/$/, '');
    const allowed = allowedOrigins.includes(o);
    if (DEBUG) console.log('[cors] origin=%s allowed=%s', o, allowed);
    if (allowed) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser(SESSION_SECRET));

// DEBUG: request trace (method, path, origin, cookie present, no secrets)
if (DEBUG) {
  app.use((req, res, next) => {
    const hasCookie = !!req.signedCookies?.tr_session;
    console.log('[req] %s %s origin=%s cookie=%s', req.method, req.path, req.get('origin') || '-', hasCookie ? 'yes' : 'no');
    next();
  });
}

// ——— Helpers ———

function ensureStravaConfig() {
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    throw new Error(
      'Strava credentials missing. Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in server/.env'
    );
  }
}

async function exchangeCodeForTokens(code) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava token exchange failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava token refresh failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function fetchAthlete(accessToken) {
  const res = await fetch('https://www.strava.com/api/v3/athlete', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Failed to fetch athlete');
  return res.json();
}

// Production (e.g. Render): SameSite=None and Secure=true required for cross-site cookies (Vercel frontend → Render backend). Do not set domain.
function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: '/',
    // domain: not set — let browser use API host only
  };
}

function clearSessionCookie(res) {
  const opts = { ...sessionCookieOptions(), maxAge: 0 };
  res.clearCookie('tr_session', opts);
  if (DEBUG) console.log('[session] tr_session cookie cleared (path=%s)', opts.path);
}

// ——— Routes ———

// GET/POST /api/health — for Render / load balancers and connectivity check (no auth)
const healthPayload = () => ({
  ok: true,
  env: process.env.NODE_ENV || 'development',
  time: new Date().toISOString(),
  service: 'terrarun-api',
});
app.get('/api/health', (req, res) => res.json(healthPayload()));
app.post('/api/health', (req, res) => res.json(healthPayload()));

// GET /api/debug/env — DEBUG only: safe config summary (no secrets)
app.get('/api/debug/env', (req, res) => {
  if (!DEBUG) return res.status(404).json({ error: 'Not found' });
  const cookieOpts = sessionCookieOptions();
  res.json({
    NODE_ENV: process.env.NODE_ENV || 'development',
    FRONTEND_URL,
    STRAVA_REDIRECT_URI: process.env.STRAVA_REDIRECT_URI || '(derived from request)',
    cookie: { secure: cookieOpts.secure, sameSite: cookieOpts.sameSite },
    CORS: { allowedOrigins },
  });
});

// GET /api/debug/auth-status — DEBUG only: cookie/session state for diagnosing cross-site auth (no secrets)
app.get('/api/debug/auth-status', async (req, res) => {
  if (!DEBUG) return res.status(404).json({ error: 'Not found' });
  const hasSessionCookie = !!req.signedCookies?.tr_session;
  const hasPendingCookie = !!req.signedCookies?.tr_strava_pending;
  let resolvedUserId = null;
  if (hasSessionCookie) {
    const user = await prisma.user.findUnique({
      where: { id: req.signedCookies.tr_session },
      select: { id: true },
    });
    if (user) resolvedUserId = user.id;
  }
  const cookieOpts = sessionCookieOptions();
  res.json({
    hasSessionCookie,
    resolvedUserId,
    hasPendingCookie,
    cookieConfig: { sameSite: cookieOpts.sameSite, secure: cookieOpts.secure },
    requestOrigin: req.get('origin') || null,
    host: req.get('host') || null,
    'x-forwarded-proto': req.get('x-forwarded-proto') || null,
  });
});

// GET /api/debug/cookie-echo — DEBUG only: raw Cookie header presence/length and parsed cookie keys (no values)
app.get('/api/debug/cookie-echo', (req, res) => {
  if (!DEBUG) return res.status(404).json({ error: 'Not found' });
  const raw = req.get('cookie') || '';
  const parsedCookiesKeys = [...Object.keys(req.cookies || {}), ...Object.keys(req.signedCookies || {})];
  res.json({
    rawCookieHeaderPresent: raw.length > 0,
    cookieHeaderLength: raw.length,
    parsedCookiesKeys,
  });
});

// GET /api/auth/pending — no auth: true if tr_strava_pending cookie present (so onboarding can show nickname form after Strava callback)
app.get('/api/auth/pending', (req, res) => {
  const hasPending = !!req.signedCookies?.tr_strava_pending;
  res.json({ hasPending });
});

// POST /api/nickname — create user, set session, optional link pending Strava
app.post('/api/nickname', async (req, res) => {
  const nickname = req.body?.nickname;
  if (!nickname || typeof nickname !== 'string') {
    return res.status(400).json({ error: 'Missing nickname', message: 'Send { "nickname": "..." }.' });
  }
  const trimmed = nickname.trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(trimmed)) {
    return res.status(400).json({
      error: 'Invalid nickname',
      message: 'Use 3–20 characters: letters, numbers, underscore only.',
    });
  }

  const lower = trimmed.toLowerCase();
  const existing = await prisma.user.findFirst({
    where: { nickname: { equals: trimmed, mode: 'insensitive' } },
  });
  if (existing) {
    return res.status(409).json({
      error: 'Nickname taken',
      message: 'Nickname already taken. Please choose another.',
    });
  }

  const user = await prisma.user.create({
    data: { nickname: trimmed },
  });

  const cookieOpts = { ...sessionCookieOptions(), signed: true };
  res.cookie('tr_session', user.id, cookieOpts);
  if (DEBUG) console.log('[session] tr_session cookie set for userId=%s (path=%s)', user.id, cookieOpts.path);

  // Link pending Strava if user came from landing Connect flow (no session yet)
  const pending = req.signedCookies?.tr_strava_pending;
  if (pending) {
    try {
      const data = typeof pending === 'string' ? JSON.parse(pending) : pending;
      const { accessToken, refreshToken, expiresAt, athleteId } = data;
      if (accessToken && refreshToken != null && athleteId) {
        await prisma.stravaAccount.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            athleteId: String(athleteId),
            accessToken,
            refreshToken,
            expiresAt: Number(expiresAt) || 0,
          },
          update: {
            accessToken,
            refreshToken,
            expiresAt: Number(expiresAt) || 0,
          },
        });
      }
    } catch (e) {
      console.error('Link pending Strava', e);
    }
    res.clearCookie('tr_strava_pending', { path: '/' });
  }

  return res.status(200).json({ ok: true, user: { id: user.id, nickname: user.nickname } });
});

// POST /api/logout — clear session cookie (same path/options as set) and return to landing
app.post('/api/logout', (req, res) => {
  clearSessionCookie(res);
  if (DEBUG) console.log('[api/logout] session cleared, returning ok');
  return res.json({ ok: true });
});

// GET /api/me — require session, return user + stravaLinked + activities
app.get('/api/me', requireUser, async (req, res) => {
  const user = req.user;
  if (DEBUG) {
    console.log('[api/me] origin=%s cookie=yes userId=%s', req.get('origin') || '-', user.id);
  }
  const stravaAccount = user.stravaAccount;
  const activities = await prisma.activity.findMany({
    where: { userId: user.id },
    orderBy: { startDate: 'desc' },
  });
  return res.json({
    user: { id: user.id, nickname: user.nickname },
    stravaLinked: !!stravaAccount,
    lastAutoSyncAt: stravaAccount?.lastAutoSyncAt?.toISOString() ?? null,
    activities: activities.map((a) => ({
      id: a.id,
      stravaActivityId: a.stravaActivityId,
      name: a.name,
      type: a.type,
      startDate: a.startDate.toISOString(),
      distance: a.distance,
      movingTime: a.movingTime,
      summaryPolyline: a.summaryPolyline,
      routeGeojson: a.routeGeojson,
      loopPolygonGeojson: a.loopPolygonGeojson ?? undefined,
    })),
  });
});

// GET /api/stats — Run Mode panel: today/week/all-time, territory, last3Badges, sync times (week = Monday start, UTC)
app.get('/api/stats', requireUser, async (req, res) => {
  const user = req.user;
  const strava = user.stravaAccount;
  const activities = await prisma.activity.findMany({
    where: { userId: user.id },
    select: { distance: true, startDate: true, loopPolygonGeojson: true },
  });
  const ownedCellsCount = await prisma.territoryCell.count({ where: { ownerUserId: user.id } });
  const cellSize = getCellSize();
  const ownedAreaMi2 = (ownedCellsCount * cellSize * cellSize) / (METERS_PER_MILE * METERS_PER_MILE);

  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const todayEnd = new Date(todayStart);
  todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday, 0, 0, 0, 0));
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  const todayActivities = activities.filter((a) => {
    const t = new Date(a.startDate).getTime();
    return t >= todayStart.getTime() && t < todayEnd.getTime();
  });
  const weekActivities = activities.filter((a) => {
    const t = new Date(a.startDate).getTime();
    return t >= weekStart.getTime() && t < weekEnd.getTime();
  });

  const todayMiles = todayActivities.reduce((s, a) => s + (a.distance ?? 0), 0) / METERS_PER_MILE;
  const weekMiles = weekActivities.reduce((s, a) => s + (a.distance ?? 0), 0) / METERS_PER_MILE;
  const weekActiveDaysSet = new Set(weekActivities.map((a) => new Date(a.startDate).toISOString().slice(0, 10)));
  const weekActiveDaysCount = weekActiveDaysSet.size;

  const localDates = [...new Set(
    activities.map((a) => {
      const d = new Date(a.startDate);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })
  )].sort().reverse();
  let streakDays = 0;
  for (let i = 0; i < localDates.length; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (localDates[i] === expected) streakDays++;
    else break;
  }

  const totalMeters = activities.reduce((s, a) => s + (a.distance ?? 0), 0);
  const totalMiles = totalMeters / METERS_PER_MILE;
  const longestActivityMiles = activities.length
    ? Math.max(...activities.map((a) => (a.distance ?? 0) / METERS_PER_MILE))
    : 0;
  const loopCount = activities.filter((a) => a.loopPolygonGeojson != null).length;

  const last3BadgesRows = await prisma.userBadge.findMany({
    where: { userId: user.id },
    orderBy: { unlockedAt: 'desc' },
    take: 3,
  });
  const last3Badges = last3BadgesRows.map((b) => {
    const def = getBadgeDefinition(b.badgeKey);
    const tierLabel = def?.tiered && b.tier ? (TIER_ROMAN[b.tier] || String(b.tier)) : null;
    return {
      id: b.id,
      badgeKey: b.badgeKey,
      tier: b.tier,
      tierLabel,
      unlockedAt: b.unlockedAt.toISOString(),
      isSecret: b.isSecret,
      name: def?.name ?? b.badgeKey,
      description: def?.description ?? null,
      icon: def?.icon ?? '🏅',
    };
  });

  const lastSyncAt = strava?.lastSyncAt != null
    ? new Date(strava.lastSyncAt * 1000).toISOString()
    : null;
  const lastAutoSyncAt = strava?.lastAutoSyncAt?.toISOString() ?? null;

  // Progress to next tier for 2–3 tiered badges (for Run Mode panel)
  const statsForBadges = {
    totalMiles,
    longestSingleActivityMiles: longestActivityMiles,
    activeDayStreak: streakDays,
    loopCount,
    totalOwnedAreaMi2: ownedAreaMi2,
    totalActivities: activities.length,
  };
  const progressKeys = ['total_miles', 'longest_run', 'streak'];
  const progressToNextBadge = [];
  for (const key of progressKeys) {
    const def = getBadgeDefinition(key);
    if (!def?.tiered || !def.tiers?.length) continue;
    const currentTier = def.condition(statsForBadges) || 0;
    if (currentTier >= def.tiers.length) continue;
    const nextThreshold = def.tiers[currentTier];
    const current = key === 'total_miles' ? totalMiles
      : key === 'longest_run' ? longestActivityMiles
      : streakDays;
    const unit = key === 'streak' ? 'days' : 'mi';
    progressToNextBadge.push({
      badgeKey: key,
      name: def.name,
      icon: def.icon ?? '🏅',
      current: Math.round(current * 100) / 100,
      nextThreshold,
      unit,
    });
  }

  return res.json({
    todayMiles,
    todayCount: todayActivities.length,
    weekMiles,
    weekActiveDaysCount,
    streakDays,
    totalMiles,
    totalActivities: activities.length,
    longestActivityMiles,
    loopCount,
    ownedCellsCount,
    ownedAreaMi2,
    lastSyncAt,
    lastAutoSyncAt,
    last3Badges,
    progressToNextBadge,
  });
});

// GET /auth/strava/start — Normal: approval_prompt=auto (no repeated consent). ?switch=1 in dev: add prompt=login to allow switching Strava account.
app.get('/auth/strava/start', (req, res) => {
  try {
    ensureStravaConfig();
  } catch (e) {
    return res.redirect(302, `${FRONTEND_URL}?strava=error&message=${encodeURIComponent(e.message)}`);
  }
  const redirectUri = getStravaRedirectUri(req);
  if (!redirectUri) {
    if (DEBUG) console.log('[auth] start redirect_uri empty (host missing or STRAVA_REDIRECT_URI not set)');
    return res.status(500).json({
      error: 'Server misconfiguration',
      message: 'Strava redirect URI could not be determined. Set STRAVA_REDIRECT_URI or ensure the request has a valid Host header.',
    });
  }
  const params = new URLSearchParams({
    client_id: STRAVA_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'activity:read_all',
    approval_prompt: 'auto', // do not force consent for returning users
  });
  const switchAccount = req.query.switch === '1' && !isProd;
  if (switchAccount) {
    params.set('prompt', 'login'); // dev-only: force Strava login screen to choose different account
  }
  const url = `https://www.strava.com/oauth/authorize?${params.toString()}`;
  if (DEBUG) {
    console.log('[auth] start redirect_uri=%s protocol=%s host=%s x-forwarded-proto=%s', redirectUri, req.protocol, req.get('host'), req.get('x-forwarded-proto') || '-');
    console.log('[auth] authorize URL: %s', url);
  }
  res.redirect(302, url);
});

// GET /auth/strava/callback — returning Strava user: set session + redirect to /app; new: set pending + redirect to /onboarding
app.get('/auth/strava/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.redirect(302, `${FRONTEND_URL}?strava=error&message=missing_code`);
  }
  try {
    ensureStravaConfig();
    const data = await exchangeCodeForTokens(code);
    const athleteId = String(data.athlete?.id ?? data.athlete_id);
    const accessToken = data.access_token;
    const refreshToken = data.refresh_token;
    const expiresAt = data.expires_at ?? 0;

    const existingStrava = await prisma.stravaAccount.findUnique({
      where: { athleteId },
      include: { user: true },
    });

    if (existingStrava) {
      await prisma.stravaAccount.update({
        where: { id: existingStrava.id },
        data: { accessToken, refreshToken, expiresAt },
      });
      const cookieOpts = { ...sessionCookieOptions(), signed: true };
      res.setHeader('X-Set-Cookie-Attempt', 'session');
      res.cookie('tr_session', existingStrava.userId, cookieOpts);
      const redirectTo = `${FRONTEND_URL}/app`;
      if (DEBUG) {
        console.log('[auth] callback athleteId=%s existingAccount=true setting tr_session=yes setting tr_strava_pending=no redirectTo=%s', athleteId, redirectTo);
        console.log('[session] set-cookie secure=%s sameSite=%s path=/ httpOnly=true', cookieOpts.secure, cookieOpts.sameSite);
      }
      return res.redirect(302, redirectTo);
    }

    const pending = JSON.stringify({
      accessToken,
      refreshToken,
      expiresAt,
      athleteId,
    });
    const pendingCookieOpts = {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 10 * 60 * 1000,
      path: '/',
      signed: true,
      // domain: not set — let browser use API host only
    };
    res.setHeader('X-Set-Cookie-Attempt', 'pending');
    res.cookie('tr_strava_pending', pending, pendingCookieOpts);
    const redirectToOnboarding = `${FRONTEND_URL}/onboarding`;
    if (DEBUG) {
      console.log('[auth] callback athleteId=%s existingAccount=false setting tr_session=no setting tr_strava_pending=yes redirectTo=%s', athleteId, redirectToOnboarding);
      console.log('[session] set-cookie tr_strava_pending secure=%s sameSite=%s path=/ httpOnly=true', pendingCookieOpts.secure, pendingCookieOpts.sameSite);
    }
    return res.redirect(302, redirectToOnboarding);
  } catch (e) {
    console.error('[auth] callback error', e);
    return res.redirect(302, `${FRONTEND_URL}?strava=error&message=${encodeURIComponent(e.message)}`);
  }
});

/** Run incremental Strava sync: fetch new activities, create, apply loop claims, update lastSyncAt. Returns { added, territoryGained, territoryLost, gainedPolygons }. */
async function runIncrementalSync(prisma, user) {
  const strava = user.stravaAccount;
  if (!strava) throw new Error('Strava not linked');
  ensureStravaConfig();
  let { accessToken, refreshToken, expiresAt, lastSyncAt } = strava;
  const now = Math.floor(Date.now() / 1000);
  if (now >= expiresAt) {
    const refreshed = await refreshAccessToken(refreshToken);
    accessToken = refreshed.access_token;
    refreshToken = refreshed.refresh_token ?? refreshToken;
    expiresAt = refreshed.expires_at ?? 0;
    await prisma.stravaAccount.update({
      where: { id: strava.id },
      data: { accessToken, refreshToken, expiresAt },
    });
  }
  const after = lastSyncAt ?? 0;
  const apiRes = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=200`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!apiRes.ok) {
    const text = await apiRes.text();
    throw new Error(`Strava API error: ${apiRes.status} ${text}`);
  }
  const list = await apiRes.json();
  let added = 0;
  const territoryGained = [];
  const territoryLost = [];
  const gainedPolygons = [];
  for (const act of list) {
    const startDate = act.start_date ? new Date(act.start_date) : new Date();
    const existing = await prisma.activity.findUnique({
      where: { stravaActivityId: String(act.id) },
    });
    if (existing) continue;
    let summaryPolyline = act.map?.summary_polyline ?? null;
    if (!summaryPolyline) {
      try {
        const detailRes = await fetch(
          `https://www.strava.com/api/v3/activities/${act.id}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (detailRes.ok) {
          const detail = await detailRes.json();
          summaryPolyline = detail.map?.summary_polyline ?? summaryPolyline;
        }
      } catch (_) {}
    }
    const created = await prisma.activity.create({
      data: {
        userId: user.id,
        stravaActivityId: String(act.id),
        name: act.name ?? 'Unnamed',
        type: act.type ?? 'Unknown',
        startDate,
        distance: act.distance ?? null,
        movingTime: act.moving_time ?? null,
        summaryPolyline: summaryPolyline || null,
      },
    });
    added++;
    if (DEBUG) {
      console.log('[territory] sync: new activity', created.id);
      console.log('[territory] applying loop claims for activity', created.id);
    }
    try {
      const result = await applyLoopClaims(prisma, user.id, created);
      const { gainedCellIds, lostCellIds, loopPolygonGeojson } = result;
      territoryGained.push(...gainedCellIds);
      territoryLost.push(...lostCellIds);
      if (loopPolygonGeojson) {
        gainedPolygons.push({ activityId: created.id, polygonGeojson: loopPolygonGeojson });
      }
    } catch (err) {
      console.error('Territory loop claims for activity', created.id, err);
    }
  }
  await prisma.stravaAccount.update({
    where: { id: strava.id },
    data: { lastSyncAt: now },
  });
  return { added, territoryGained, territoryLost, gainedPolygons };
}

// POST /api/strava/sync — manual; require session + Strava; full incremental sync + territory + badges (no throttling)
app.post('/api/strava/sync', requireUser, async (req, res) => {
  const user = req.user;
  if (!user.stravaAccount) {
    return res.status(400).json({
      error: 'Not linked',
      message: 'Connect Strava first via the landing page.',
    });
  }
  try {
    const { added, territoryGained, territoryLost, gainedPolygons } = await runIncrementalSync(prisma, user);
    const uniqueGained = [...new Set(territoryGained)];
    const uniqueLost = [...new Set(territoryLost)];
    const cellsWithCoords = async (cellIds) => {
      const cells = await prisma.territoryCell.findMany({
        where: { cellId: { in: cellIds } },
        select: { cellId: true, cellX: true, cellY: true },
      });
      return cells.map((c) => ({ cellId: c.cellId, coordinates: cellToGeoJSONRing(c.cellX, c.cellY) }));
    };
    const [gainedWithCoords, lostWithCoords] = await Promise.all([
      cellsWithCoords(uniqueGained),
      cellsWithCoords(uniqueLost),
    ]);
    let newBadgesUnlocked = [];
    try {
      newBadgesUnlocked = await computeAndEvaluateBadges(prisma, user.id, { hasEverSynced: true });
    } catch (err) {
      console.error('Badge evaluation after sync', err);
    }
    return res.json({
      ok: true,
      added,
      territoryChanges: {
        gained: gainedWithCoords,
        lost: lostWithCoords,
        gainedPolygons,
      },
      newBadgesUnlocked,
    });
  } catch (e) {
    console.error('Strava sync', e);
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/strava/auto-sync — background; throttled by lastAutoSyncAt (AUTO_SYNC_MINUTES)
app.post('/api/strava/auto-sync', requireUser, async (req, res) => {
  if (DEBUG) console.log('[auto-sync] request (session + strava check)');
  const user = req.user;
  const strava = user.stravaAccount;
  if (!strava) {
    if (DEBUG) console.log('[auto-sync] skipped reason=not_linked');
    return res.json({ skipped: true, reason: 'not_linked' });
  }
  const now = new Date();
  const lastAuto = strava.lastAutoSyncAt;
  if (lastAuto) {
    const elapsedMs = now - lastAuto;
    if (elapsedMs < AUTO_SYNC_MINUTES * 60 * 1000) {
      if (DEBUG) console.log('[auto-sync] skipped reason=throttle elapsedMinutes=%s', Math.floor(elapsedMs / 60000));
      return res.json({ skipped: true, reason: 'throttle', lastAutoSyncAt: lastAuto.toISOString() });
    }
  }
  try {
    const { added, territoryGained, territoryLost, gainedPolygons } = await runIncrementalSync(prisma, user);
    if (DEBUG) console.log('[auto-sync] runIncrementalSync done added=%s territoryGained=%s gainedPolygons=%s', added, territoryGained.length, gainedPolygons.length);
    if (DEBUG && added > 0) {
      const cellCount = await prisma.territoryCell.count({ where: { ownerUserId: user.id } });
      console.log('[auto-sync] user TerritoryCell count after sync=%s', cellCount);
    }
    await prisma.stravaAccount.update({
      where: { id: strava.id },
      data: { lastAutoSyncAt: now },
    });
    const uniqueGained = [...new Set(territoryGained)];
    const uniqueLost = [...new Set(territoryLost)];
    const cellsWithCoords = async (cellIds) => {
      const cells = await prisma.territoryCell.findMany({
        where: { cellId: { in: cellIds } },
        select: { cellId: true, cellX: true, cellY: true },
      });
      return cells.map((c) => ({ cellId: c.cellId, coordinates: cellToGeoJSONRing(c.cellX, c.cellY) }));
    };
    const [gainedWithCoords, lostWithCoords] = await Promise.all([
      cellsWithCoords(uniqueGained),
      cellsWithCoords(uniqueLost),
    ]);
    let newBadgesUnlocked = [];
    try {
      newBadgesUnlocked = await computeAndEvaluateBadges(prisma, user.id, { hasEverSynced: true });
      if (DEBUG) console.log('[auto-sync] evaluateBadges done newBadgesUnlocked=%s', newBadgesUnlocked.length);
    } catch (err) {
      console.error('Badge evaluation after auto-sync', err);
    }
    return res.json({
      skipped: false,
      added,
      territoryChanges: {
        gained: gainedWithCoords,
        lost: lostWithCoords,
        gainedPolygons,
      },
      newBadgesUnlocked,
      lastAutoSyncAt: now.toISOString(),
    });
  } catch (e) {
    console.error('Strava auto-sync', e);
    return res.status(500).json({
      error: e.message || 'Auto-sync failed',
      message: e.message || 'Auto-sync failed',
    });
  }
});

// POST /api/strava/resync — dev/debug only (DEBUG=1); fetch last 90 days, ensure polylines, re-run territory
app.post('/api/strava/resync', requireUser, async (req, res) => {
  if (!DEBUG) {
    return res.status(404).json({ error: 'Not found' });
  }
  const user = req.user;
  const strava = user.stravaAccount;
  if (!strava) {
    return res.status(400).json({
      error: 'Not linked',
      message: 'Connect Strava first via the landing page.',
    });
  }

  try {
    ensureStravaConfig();
    let { accessToken, refreshToken, expiresAt } = strava;
    const now = Math.floor(Date.now() / 1000);
    if (now >= expiresAt) {
      const refreshed = await refreshAccessToken(refreshToken);
      accessToken = refreshed.access_token;
      refreshToken = refreshed.refresh_token ?? refreshToken;
      expiresAt = refreshed.expires_at ?? 0;
      await prisma.stravaAccount.update({
        where: { id: strava.id },
        data: { accessToken, refreshToken, expiresAt },
      });
    }

    const after = now - 90 * 24 * 3600; // last 90 days
    const apiRes = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=200`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!apiRes.ok) {
      const text = await apiRes.text();
      return res.status(apiRes.status).json({ error: 'Strava API error', detail: text });
    }
    const list = await apiRes.json();
    let activitiesUpdated = 0;
    for (const act of list) {
      const startDate = act.start_date ? new Date(act.start_date) : new Date();
      let summaryPolyline = act.map?.summary_polyline ?? null;
      if (!summaryPolyline) {
        try {
          const detailRes = await fetch(
            `https://www.strava.com/api/v3/activities/${act.id}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (detailRes.ok) {
            const detail = await detailRes.json();
            summaryPolyline = detail.map?.summary_polyline ?? summaryPolyline;
          }
        } catch (_) {}
      }
      await prisma.activity.upsert({
        where: { stravaActivityId: String(act.id) },
        create: {
          userId: user.id,
          stravaActivityId: String(act.id),
          name: act.name ?? 'Unnamed',
          type: act.type ?? 'Unknown',
          startDate,
          distance: act.distance ?? null,
          movingTime: act.moving_time ?? null,
          summaryPolyline: summaryPolyline || null,
        },
        update: {
          name: act.name ?? 'Unnamed',
          type: act.type ?? 'Unknown',
          startDate,
          distance: act.distance ?? null,
          movingTime: act.moving_time ?? null,
          ...(summaryPolyline != null && summaryPolyline !== '' && { summaryPolyline }),
        },
      });
      activitiesUpdated++;
    }
    await prisma.stravaAccount.update({
      where: { id: strava.id },
      data: { lastSyncAt: now },
    });

    const activitiesWithPolyline = await prisma.activity.findMany({
      where: { userId: user.id, summaryPolyline: { not: null } },
      select: { id: true },
    });
    const territoryGained = [];
    const territoryLost = [];
    for (const activity of activitiesWithPolyline) {
      const full = await prisma.activity.findUnique({ where: { id: activity.id } });
      if (!full?.summaryPolyline) continue;
      try {
        const { gainedCellIds, lostCellIds } = await applyLoopClaims(prisma, user.id, full);
        territoryGained.push(...gainedCellIds);
        territoryLost.push(...lostCellIds);
      } catch (err) {
        console.error('Resync territory for activity', full.id, err);
      }
    }
    const uniqueGained = [...new Set(territoryGained)];
    const uniqueLost = [...new Set(territoryLost)];
    const cellsWithCoords = async (cellIds) => {
      const cells = await prisma.territoryCell.findMany({
        where: { cellId: { in: cellIds } },
        select: { cellId: true, cellX: true, cellY: true },
      });
      return cells.map((c) => ({ cellId: c.cellId, coordinates: cellToGeoJSONRing(c.cellX, c.cellY) }));
    };
    const [gainedWithCoords, lostWithCoords] = await Promise.all([
      cellsWithCoords(uniqueGained),
      cellsWithCoords(uniqueLost),
    ]);
    const cellsTotal = await prisma.territoryCell.count({ where: { ownerUserId: user.id } });

    let newBadgesUnlocked = [];
    try {
      newBadgesUnlocked = await computeAndEvaluateBadges(prisma, user.id, { hasEverSynced: true });
    } catch (err) {
      console.error('Badge evaluation after resync', err);
    }

    return res.json({
      ok: true,
      activitiesUpdated,
      cellsTotal,
      territoryChanges: { gained: gainedWithCoords, lost: lostWithCoords },
      newBadgesUnlocked,
    });
  } catch (e) {
    console.error('Strava resync', e);
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/strava/reconcile?days=90 — fetch last N days from Strava, upsert missing activities, fill polylines, apply territory for new/updated loops only. Does not change lastSyncAt.
app.post('/api/strava/reconcile', requireUser, async (req, res) => {
  const user = req.user;
  const strava = user.stravaAccount;
  if (!strava) {
    return res.status(400).json({
      error: 'Not linked',
      message: 'Connect Strava first via the landing page.',
    });
  }

  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 90));
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - days * 24 * 3600;
  const cutoffDate = new Date(cutoff * 1000);

  try {
    ensureStravaConfig();
    let { accessToken, refreshToken, expiresAt } = strava;
    if (now >= expiresAt) {
      const refreshed = await refreshAccessToken(refreshToken);
      accessToken = refreshed.access_token;
      refreshToken = refreshed.refresh_token ?? refreshToken;
      expiresAt = refreshed.expires_at ?? 0;
      await prisma.stravaAccount.update({
        where: { id: strava.id },
        data: { accessToken, refreshToken, expiresAt },
      });
    }

    // Paginate: fetch all activities since cutoff
    const all = [];
    let page = 1;
    const perPage = 200;
    while (true) {
      const apiRes = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?after=${cutoff}&per_page=${perPage}&page=${page}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!apiRes.ok) {
        const text = await apiRes.text();
        return res.status(apiRes.status).json({ error: 'Strava API error', detail: text });
      }
      const list = await apiRes.json();
      if (list.length === 0) break;
      all.push(...list);
      if (list.length < perPage) break;
      page++;
      if (DEBUG) console.log('[reconcile] fetched page', page - 1, 'size', list.length);
    }

    const fetchedCount = all.length;
    if (DEBUG) console.log('[reconcile] cutoff=%s fetchedCount=%d', cutoffDate.toISOString(), fetchedCount);

    let upsertedCount = 0;
    let updatedPolylinesCount = 0;
    let territoryAppliedCount = 0;
    let skippedExisting = 0;

    for (const act of all) {
      const stravaId = String(act.id);
      const existing = await prisma.activity.findUnique({
        where: { stravaActivityId: stravaId },
      });
      const startDate = act.start_date ? new Date(act.start_date) : new Date();
      let summaryPolyline = act.map?.summary_polyline ?? null;
      let fetchedDetailForPolyline = false;
      if (!summaryPolyline) {
        try {
          const detailRes = await fetch(
            `https://www.strava.com/api/v3/activities/${act.id}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (detailRes.ok) {
            const detail = await detailRes.json();
            summaryPolyline = detail.map?.summary_polyline ?? null;
            fetchedDetailForPolyline = !!summaryPolyline;
          }
        } catch (_) {}
      }
      if (fetchedDetailForPolyline) updatedPolylinesCount++;

      const hadNoPolyline = existing && !existing.summaryPolyline;
      const nowHasPolyline = summaryPolyline != null && summaryPolyline !== '';
      const needToApplyTerritory = nowHasPolyline && (!existing || hadNoPolyline);

      const createData = {
        userId: user.id,
        stravaActivityId: stravaId,
        name: act.name ?? 'Unnamed',
        type: act.type ?? 'Unknown',
        startDate,
        distance: act.distance ?? null,
        movingTime: act.moving_time ?? null,
        summaryPolyline: summaryPolyline || null,
      };
      const updateData = {
        name: act.name ?? 'Unnamed',
        type: act.type ?? 'Unknown',
        startDate,
        distance: act.distance ?? null,
        movingTime: act.moving_time ?? null,
        ...(nowHasPolyline && { summaryPolyline }),
      };

      const activity = await prisma.activity.upsert({
        where: { stravaActivityId: stravaId },
        create: createData,
        update: updateData,
      });
      const wasCreated = !existing;
      if (existing && !needToApplyTerritory) skippedExisting++;
      upsertedCount++;

      if (needToApplyTerritory) {
        try {
          await applyLoopClaims(prisma, user.id, activity);
          territoryAppliedCount++;
        } catch (err) {
          console.error('[reconcile] territory for activity', activity.id, err);
        }
      }
    }

    if (DEBUG) {
      console.log('[reconcile] skippedExisting=%d upsertedCount=%d updatedPolylinesCount=%d territoryAppliedCount=%d',
        skippedExisting, upsertedCount, updatedPolylinesCount, territoryAppliedCount);
    }

    return res.json({
      ok: true,
      cutoff: cutoffDate.toISOString(),
      fetchedCount,
      upsertedCount,
      updatedPolylinesCount,
      territoryAppliedCount,
    });
  } catch (e) {
    console.error('[reconcile]', e);
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/debug/territory-db — DB counts and sample activities (only when DEBUG=1)
app.get('/api/debug/territory-db', requireUser, async (req, res) => {
  if (!DEBUG) return res.status(404).end();
  try {
    const [cellCount, claimCount, activitiesWithPolyline, sampleActivities] = await Promise.all([
      prisma.territoryCell.count(),
      prisma.territoryClaim.count(),
      prisma.activity.count({ where: { summaryPolyline: { not: null } } }),
      prisma.activity.findMany({
        where: { summaryPolyline: { not: null } },
        take: 3,
        select: { id: true, name: true, summaryPolyline: true },
      }),
    ]);
    const samples = sampleActivities.map((a) => ({
      id: a.id,
      name: a.name,
      polylineLength: a.summaryPolyline ? a.summaryPolyline.length : 0,
    }));
    const out = {
      territoryCellCount: cellCount,
      territoryClaimCount: claimCount,
      activityCountWithPolyline: activitiesWithPolyline,
      sampleActivities: samples,
    };
    if (DEBUG) console.log('[territory-db]', JSON.stringify(out, null, 2));
    return res.json(out);
  } catch (e) {
    if (DEBUG) console.error('[territory-db]', e);
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/territory — cells in bbox; view=everyone|friends; privacy-safe (no nicknames/ids for non-friends in everyone view)
app.get('/api/territory', requireUser, async (req, res) => {
  const bboxParam = req.query.bbox;
  const view = (req.query.view === 'friends' ? 'friends' : 'everyone') || 'everyone';
  if (!bboxParam || typeof bboxParam !== 'string') {
    return res.status(400).json({ error: 'Missing bbox', message: 'Query param bbox=minLng,minLat,maxLng,maxLat required.' });
  }
  const parts = bboxParam.split(',').map((p) => parseFloat(p.trim()));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    return res.status(400).json({ error: 'Invalid bbox', message: 'bbox must be minLng,minLat,maxLng,maxLat.' });
  }
  const [minLng, minLat, maxLng, maxLat] = parts;
  const { cellXMin, cellXMax, cellYMin, cellYMax } = bboxToCellRange(minLng, minLat, maxLng, maxLat);

  if (DEBUG) {
    const sw = lngLatToMercator(minLng, minLat);
    const ne = lngLatToMercator(maxLng, maxLat);
    console.log('[territory] GET bbox=', bboxParam, 'mercator minX/minY/maxX/maxY=', sw.x, sw.y, ne.x, ne.y, 'cellRange=', { cellXMin, cellXMax, cellYMin, cellYMax });
  }

  const friendIds = new Set(
    (await prisma.friendship.findMany({
      where: { userId: req.user.id },
      select: { friendId: true },
    })).map((f) => f.friendId)
  );
  const friendList = await prisma.user.findMany({
    where: { id: { in: [...friendIds] } },
    select: { id: true, nickname: true },
  });
  const friendNicknames = new Map(friendList.map((f) => [f.id, f.nickname]));

  const cells = await prisma.territoryCell.findMany({
    where: {
      cellX: { gte: cellXMin, lte: cellXMax },
      cellY: { gte: cellYMin, lte: cellYMax },
    },
    include: { owner: { select: { id: true, nickname: true } } },
  });

  if (DEBUG) console.log('[territory] GET cells in range:', cells.length);

  const myId = req.user.id;
  const friendIndex = new Map([...friendList].map((f, i) => [f.id, i]));
  const paletteLen = 8;

  const out = [];
  for (const c of cells) {
    let ownerType = 'other';
    if (c.ownerUserId === myId) ownerType = 'me';
    else if (friendIds.has(c.ownerUserId)) ownerType = 'friend';

    if (view === 'friends' && ownerType === 'other') continue;

    const colorKey =
      ownerType === 'me'
        ? 'me'
        : ownerType === 'friend'
          ? `friend-${friendIndex.get(c.ownerUserId) ?? 0}`
          : 'other';

    const cellPayload = {
      cellId: c.cellId,
      cellX: c.cellX,
      cellY: c.cellY,
      ownerType,
      colorKey,
      coordinates: cellToGeoJSONRing(c.cellX, c.cellY),
    };

    if (view === 'friends' && ownerType === 'friend') {
      cellPayload.friendNickname = friendNicknames.get(c.ownerUserId) ?? null;
    }

    out.push(cellPayload);
  }

  return res.json({ cells: out, cellSizeMeters: getCellSize() });
});

// GET /api/territory/loops — loop polygons in bbox for polygon-based rendering (Run + Game mode)
app.get('/api/territory/loops', requireUser, async (req, res) => {
  const bboxParam = req.query.bbox;
  const view = (req.query.view === 'friends' ? 'friends' : 'everyone') || 'everyone';
  if (!bboxParam || typeof bboxParam !== 'string') {
    return res.status(400).json({ error: 'Missing bbox', message: 'Query param bbox=minLng,minLat,maxLng,maxLat required.' });
  }
  const parts = bboxParam.split(',').map((p) => parseFloat(p.trim()));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    return res.status(400).json({ error: 'Invalid bbox', message: 'bbox must be minLng,minLat,maxLng,maxLat.' });
  }
  const [minLng, minLat, maxLng, maxLat] = parts;

  const activities = await prisma.activity.findMany({
    where: {
      loopPolygonGeojson: { not: null },
      loopMaxLng: { gte: minLng },
      loopMinLng: { lte: maxLng },
      loopMaxLat: { gte: minLat },
      loopMinLat: { lte: maxLat },
    },
    select: { id: true, userId: true, loopPolygonGeojson: true },
  });

  const friendIds = new Set(
    (await prisma.friendship.findMany({
      where: { userId: req.user.id },
      select: { friendId: true },
    })).map((f) => f.friendId)
  );
  const friendList = await prisma.user.findMany({
    where: { id: { in: [...friendIds] } },
    select: { id: true, nickname: true },
  });
  const friendNicknames = new Map(friendList.map((f) => [f.id, f.nickname]));
  const myId = req.user.id;
  const friendIndex = new Map([...friendList].map((f, i) => [f.id, i]));

  const loops = [];
  for (const a of activities) {
    let ownerType = 'other';
    if (a.userId === myId) ownerType = 'me';
    else if (friendIds.has(a.userId)) ownerType = 'friend';

    if (view === 'friends' && ownerType === 'other') continue;

    const colorKey =
      ownerType === 'me'
        ? 'me'
        : ownerType === 'friend'
          ? `friend-${friendIndex.get(a.userId) ?? 0}`
          : 'other';

    const payload = {
      id: a.id,
      polygonGeojson: a.loopPolygonGeojson,
      ownerType,
      colorKey,
    };
    if (view === 'friends' && ownerType === 'friend') {
      payload.friendNickname = friendNicknames.get(a.userId) ?? null;
    }
    loops.push(payload);
  }

  return res.json({ loops });
});

// GET /api/leaderboard — scope=global|friends, metric=total|recent
app.get('/api/leaderboard', requireUser, async (req, res) => {
  const scope = req.query.scope === 'friends' ? 'friends' : 'global';
  const metric = req.query.metric === 'recent' ? 'recent' : 'total';
  const cellSizeMeters = getCellSize();
  const myId = req.user.id;

  let allowedUserIds = null;
  if (scope === 'friends') {
    const friendIds = (
      await prisma.friendship.findMany({
        where: { userId: myId },
        select: { friendId: true },
      })
    ).map((f) => f.friendId);
    allowedUserIds = new Set([myId, ...friendIds]);
  }

  if (metric === 'total') {
    const where = scope === 'friends'
      ? { ownerUserId: { in: [...allowedUserIds] } }
      : {};
    const groups = await prisma.territoryCell.groupBy({
      by: ['ownerUserId'],
      where,
      _count: { cellId: true },
    });
    const userIds = groups.map((g) => g.ownerUserId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, nickname: true },
    });
    const nicknames = new Map(users.map((u) => [u.id, u.nickname]));
    const rows = groups
      .map((g) => ({
        userId: g.ownerUserId,
        nickname: nicknames.get(g.ownerUserId) ?? null,
        cells: g._count.cellId,
      }))
      .sort((a, b) => b.cells - a.cells)
      .map((r, i) => ({
        rank: i + 1,
        userId: r.userId,
        nickname: r.nickname,
        cells: r.cells,
        areaMi2: (r.cells * cellSizeMeters * cellSizeMeters) / (METERS_PER_MILE * METERS_PER_MILE),
        isMe: r.userId === myId,
      }));
    return res.json({ scope, metric, cellSizeMeters, rows });
  }

  // metric === 'recent': TerritoryClaim where claimedAt >= now-24h, group by claimerUserId
  const now24hAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const claimWhere = { claimedAt: { gte: now24hAgo } };
  if (scope === 'friends') {
    claimWhere.claimerUserId = { in: [...allowedUserIds] };
  }
  const groups = await prisma.territoryClaim.groupBy({
    by: ['claimerUserId'],
    where: claimWhere,
    _count: { id: true },
  });
  const userIds = groups.map((g) => g.claimerUserId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, nickname: true },
  });
  const nicknames = new Map(users.map((u) => [u.id, u.nickname]));
  const rows = groups
    .map((g) => ({
      userId: g.claimerUserId,
      nickname: nicknames.get(g.claimerUserId) ?? null,
      cells: g._count.id,
    }))
    .sort((a, b) => b.cells - a.cells)
    .map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      nickname: r.nickname,
      cells: r.cells,
      areaMi2: (r.cells * cellSizeMeters * cellSizeMeters) / (METERS_PER_MILE * METERS_PER_MILE),
      isMe: r.userId === myId,
    }));
  return res.json({ scope, metric, cellSizeMeters, rows });
});

// GET /api/activities/:id/route — return route geometry for map
app.get('/api/activities/:id/route', requireUser, async (req, res) => {
  const id = req.params.id;
  const activity = await prisma.activity.findFirst({
    where: { id, userId: req.user.id },
  });
  if (!activity) {
    return res.status(404).json({ error: 'Not found' });
  }
  return res.json({
    summaryPolyline: activity.summaryPolyline,
    routeGeojson: activity.routeGeojson,
  });
});

// ——— Friends ———

const FRIEND_REQUEST_STATUS = { PENDING: 'PENDING', ACCEPTED: 'ACCEPTED', REJECTED: 'REJECTED' };

// POST /api/friends/request — send friend request by nickname
app.post('/api/friends/request', requireUser, async (req, res) => {
  const nickname = req.body?.nickname;
  if (!nickname || typeof nickname !== 'string') {
    return res.status(400).json({ error: 'Missing nickname', message: 'Send { "nickname": "..." }.' });
  }
  const trimmed = nickname.trim();
  const toUser = await prisma.user.findFirst({
    where: { nickname: { equals: trimmed, mode: 'insensitive' } },
  });
  if (!toUser) {
    return res.status(404).json({ error: 'Not found', message: 'No user with that nickname.' });
  }
  if (toUser.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot add self', message: "You can't send a request to yourself." });
  }
  const existingFriendship = await prisma.friendship.findFirst({
    where: {
      OR: [
        { userId: req.user.id, friendId: toUser.id },
        { userId: toUser.id, friendId: req.user.id },
      ],
    },
  });
  if (existingFriendship) {
    return res.status(400).json({ error: 'Already friends', message: 'You are already friends.' });
  }
  const existingPending = await prisma.friendRequest.findFirst({
    where: {
      fromUserId: req.user.id,
      toUserId: toUser.id,
      status: FRIEND_REQUEST_STATUS.PENDING,
    },
  });
  if (existingPending) {
    return res.status(400).json({ error: 'Already sent', message: 'Friend request already pending.' });
  }
  const request = await prisma.friendRequest.create({
    data: {
      fromUserId: req.user.id,
      toUserId: toUser.id,
      status: FRIEND_REQUEST_STATUS.PENDING,
    },
  });
  await prisma.notification.create({
    data: {
      userId: toUser.id,
      type: 'FRIEND_REQUEST',
      title: 'Friend request',
      body: `${req.user.nickname} wants to be your friend.`,
      meta: { friendRequestId: request.id, fromUserId: req.user.id, fromNickname: req.user.nickname },
    },
  });
  return res.status(201).json({ ok: true, request: { id: request.id, toUser: { id: toUser.id, nickname: toUser.nickname } } });
});

// GET /api/friends — list of friends (accepted)
app.get('/api/friends', requireUser, async (req, res) => {
  const friendships = await prisma.friendship.findMany({
    where: { userId: req.user.id },
    include: { friend: { select: { id: true, nickname: true } } },
  });
  const friends = friendships.map((f) => ({ id: f.friend.id, nickname: f.friend.nickname }));
  return res.json({ friends });
});

// GET /api/badges — current user's badges + last3 (sorted by unlockedAt desc)
app.get('/api/badges', requireUser, async (req, res) => {
  const badges = await prisma.userBadge.findMany({
    where: { userId: req.user.id },
    orderBy: { unlockedAt: 'desc' },
  });
  const withDef = badges.map((b) => {
    const def = getBadgeDefinition(b.badgeKey);
    const tierLabel = def?.tiered && b.tier ? (TIER_ROMAN[b.tier] || String(b.tier)) : null;
    return {
      id: b.id,
      badgeKey: b.badgeKey,
      tier: b.tier,
      tierLabel,
      unlockedAt: b.unlockedAt,
      isSecret: b.isSecret,
      name: def?.name ?? b.badgeKey,
      description: def?.description ?? null,
      icon: def?.icon ?? '🏅',
      category: def?.category ?? null,
    };
  });
  const last3 = withDef.slice(0, 3);
  const definitions = BADGE_DEFINITIONS.map((d) => ({
    key: d.key,
    name: d.name,
    description: d.description,
    icon: d.icon,
    category: d.category,
    tiered: d.tiered,
    tiers: d.tiers,
    isSecret: d.isSecret,
  }));
  return res.json({ badges: withDef, last3, definitions });
});

// GET /api/friends/badges — friends with their last 3 badges (for leaderboard/friends view)
app.get('/api/friends/badges', requireUser, async (req, res) => {
  const friendships = await prisma.friendship.findMany({
    where: { userId: req.user.id },
    include: { friend: { select: { id: true, nickname: true } } },
  });
  const friendIds = friendships.map((f) => f.friend.id);
  const friendBadges = await prisma.userBadge.findMany({
    where: { userId: { in: friendIds } },
    orderBy: { unlockedAt: 'desc' },
  });
  const byUser = new Map();
  for (const b of friendBadges) {
    if (!byUser.has(b.userId)) byUser.set(b.userId, []);
    const arr = byUser.get(b.userId);
    if (arr.length < 3) {
      const def = getBadgeDefinition(b.badgeKey);
      arr.push({
        badgeKey: b.badgeKey,
        icon: b.isSecret ? null : (def?.icon ?? '🏅'),
        name: b.isSecret ? '???' : (def?.name ?? b.badgeKey),
        tierLabel: b.isSecret ? null : (def?.tiered && b.tier ? (TIER_ROMAN[b.tier] || String(b.tier)) : null),
      });
    }
  }
  const friends = friendships.map((f) => ({
    id: f.friend.id,
    nickname: f.friend.nickname,
    last3: byUser.get(f.friend.id) ?? [],
  }));
  return res.json({ friends });
});

// GET /api/friends/requests — incoming pending requests
app.get('/api/friends/requests', requireUser, async (req, res) => {
  const list = await prisma.friendRequest.findMany({
    where: { toUserId: req.user.id, status: FRIEND_REQUEST_STATUS.PENDING },
    include: { fromUser: { select: { id: true, nickname: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return res.json({ requests: list.map((r) => ({ id: r.id, fromUser: r.fromUser, createdAt: r.createdAt })) });
});

// POST /api/friends/requests/:id/accept
app.post('/api/friends/requests/:id/accept', requireUser, async (req, res) => {
  const id = req.params.id;
  const request = await prisma.friendRequest.findFirst({
    where: { id, toUserId: req.user.id, status: FRIEND_REQUEST_STATUS.PENDING },
    include: { fromUser: true },
  });
  if (!request) {
    return res.status(404).json({ error: 'Not found' });
  }
  await prisma.$transaction([
    prisma.friendRequest.update({
      where: { id },
      data: { status: FRIEND_REQUEST_STATUS.ACCEPTED, respondedAt: new Date() },
    }),
    prisma.friendship.createMany({
      data: [
        { userId: request.fromUserId, friendId: request.toUserId },
        { userId: request.toUserId, friendId: request.fromUserId },
      ],
      skipDuplicates: true,
    }),
  ]);
  await prisma.notification.create({
    data: {
      userId: request.fromUserId,
      type: 'FRIEND_REQUEST_ACCEPTED',
      title: 'Friend request accepted',
      body: `${req.user.nickname} accepted your friend request.`,
      meta: { acceptedByUserId: req.user.id, acceptedByNickname: req.user.nickname },
    },
  });
  try {
    await computeAndEvaluateBadges(prisma, req.user.id);
    await computeAndEvaluateBadges(prisma, request.fromUserId);
  } catch (err) {
    console.error('Badge evaluation after friend accept', err);
  }
  return res.json({ ok: true });
});

// POST /api/friends/requests/:id/reject
app.post('/api/friends/requests/:id/reject', requireUser, async (req, res) => {
  const id = req.params.id;
  const request = await prisma.friendRequest.findFirst({
    where: { id, toUserId: req.user.id, status: FRIEND_REQUEST_STATUS.PENDING },
  });
  if (!request) {
    return res.status(404).json({ error: 'Not found' });
  }
  await prisma.friendRequest.update({
    where: { id },
    data: { status: FRIEND_REQUEST_STATUS.REJECTED, respondedAt: new Date() },
  });
  return res.json({ ok: true });
});

// ——— Notifications ———

// GET /api/notifications ?unreadOnly=true
app.get('/api/notifications', requireUser, async (req, res) => {
  const unreadOnly = req.query.unreadOnly === 'true';
  const where = { userId: req.user.id };
  if (unreadOnly) where.readAt = null;
  const list = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const unreadCount = await prisma.notification.count({
    where: { userId: req.user.id, readAt: null },
  });
  return res.json({ notifications: list, unreadCount });
});

// POST /api/notifications/:id/read
app.post('/api/notifications/:id/read', requireUser, async (req, res) => {
  const id = req.params.id;
  await prisma.notification.updateMany({
    where: { id, userId: req.user.id },
    data: { readAt: new Date() },
  });
  return res.json({ ok: true });
});

// POST /api/notifications/read-all
app.post('/api/notifications/read-all', requireUser, async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user.id, readAt: null },
    data: { readAt: new Date() },
  });
  return res.json({ ok: true });
});

// ——— Listen ———

app.listen(PORT, () => {
  console.log(`TerraRun API listening on port ${PORT}`);
  console.log(`  NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}`);
  console.log(`  FRONTEND_URL=${FRONTEND_URL || '(not set)'}`);
  if (isProd && !FRONTEND_URL) {
    console.warn('  WARNING: Set FRONTEND_URL (e.g. your Vercel URL) for redirects and CORS.');
  }
});
