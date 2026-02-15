/**
 * Badge evaluation: compute user stats from Activity + Territory + Friendship, then unlock any newly earned badges.
 * Inserts UserBadge and creates Notification for each new unlock. Returns list of newly unlocked badges.
 */

import { getCellSize } from '../lib/territory.js';
import { BADGE_DEFINITIONS, getBadgeDefinition, TIER_ROMAN } from './definitions.js';

const METERS_PER_MILE = 1609.344;
const CELL_SIZE = getCellSize();

/**
 * Compute stats for a user (activities, territory, friends). Used by condition() in definitions.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} userId
 * @param {{ hasEverSynced?: boolean }} opts
 * @returns {Promise<Record<string, number|boolean>>}
 */
export async function computeUserStats(prisma, userId, opts = {}) {
  const [activities, cellCount, claims, friendsCount, claimsByActivity] = await Promise.all([
    prisma.activity.findMany({
      where: { userId },
      select: {
        distance: true,
        startDate: true,
        loopPolygonGeojson: true,
        id: true,
      },
    }),
    prisma.territoryCell.count({ where: { ownerUserId: userId } }),
    prisma.territoryClaim.findMany({
      where: { claimerUserId: userId },
      select: { reason: true, previousOwnerUserId: true, activityId: true },
    }),
    prisma.friendship.count({ where: { userId } }),
    prisma.territoryClaim.groupBy({
      by: ['activityId'],
      where: {
        claimerUserId: userId,
        previousOwnerUserId: { not: null },
      },
      _count: { id: true },
    }),
  ]);

  const totalMeters = activities.reduce((s, a) => s + (a.distance ?? 0), 0);
  const totalMiles = totalMeters / METERS_PER_MILE;
  const longestMeters = activities.reduce((max, a) => Math.max(max, a.distance ?? 0), 0);
  const longestSingleActivityMiles = longestMeters / METERS_PER_MILE;
  const loopCount = activities.filter((a) => a.loopPolygonGeojson != null).length;
  const totalOwnedAreaMi2 = (cellCount * CELL_SIZE * CELL_SIZE) / (METERS_PER_MILE * METERS_PER_MILE);
  const cellsStolen = claims.filter((c) => c.previousOwnerUserId != null).length;
  const defendedCount = claims.filter((c) => c.reason === 'LOOP_DEFEND_REFRESH').length;

  // Active day streak: distinct local dates, sorted desc, count consecutive from "today"
  const localDates = [...new Set(
    activities.map((a) => {
      const d = new Date(a.startDate);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })
  )].sort().reverse();
  let activeDayStreak = 0;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  for (let i = 0; i < localDates.length; i++) {
    const expected = (() => {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    if (localDates[i] === expected) activeDayStreak++;
    else break;
  }

  // Early morning (before 6) / late night (after 22) - use UTC hours for simplicity unless we have TZ
  let hasEarlyMorningActivity = false;
  let hasLateNightActivity = false;
  for (const a of activities) {
    const d = new Date(a.startDate);
    const h = d.getUTCHours();
    if (h < 6) hasEarlyMorningActivity = true;
    if (h >= 22) hasLateNightActivity = true;
  }

  // Max miles in 7-day sliding window
  const sortedByDate = activities.slice().sort((x, y) => new Date(x.startDate) - new Date(y.startDate));
  let maxMilesIn7Days = 0;
  for (let i = 0; i < sortedByDate.length; i++) {
    const start = new Date(sortedByDate[i].startDate).getTime();
    let sum = 0;
    for (const a of sortedByDate) {
      const t = new Date(a.startDate).getTime();
      if (t >= start && t < start + 7 * 24 * 60 * 60 * 1000) sum += (a.distance ?? 0) / METERS_PER_MILE;
    }
    if (sum > maxMilesIn7Days) maxMilesIn7Days = sum;
  }

  // Max loops in one day (local date)
  const loopsByDay = {};
  for (const a of activities) {
    if (!a.loopPolygonGeojson) continue;
    const d = new Date(a.startDate);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    loopsByDay[key] = (loopsByDay[key] || 0) + 1;
  }
  const maxLoopsInOneDay = Math.max(0, ...Object.values(loopsByDay));

  // Max cells stolen in one activity
  const stolenByActivity = new Map(claimsByActivity.map((g) => [g.activityId, g._count.id]));
  const maxCellsStolenInOneActivity = stolenByActivity.size ? Math.max(...stolenByActivity.values()) : 0;

  // Weekend-only streak: count consecutive weeks (Mon-Sun) where all activities were on Sat or Sun
  const weekToWeekendOnly = {};
  for (const a of activities) {
    const d = new Date(a.startDate);
    const day = d.getUTCDay();
    const weekStart = new Date(d);
    weekStart.setUTCDate(d.getUTCDate() - day + (day === 0 ? -6 : 1));
    const key = weekStart.toISOString().slice(0, 10);
    if (!weekToWeekendOnly[key]) weekToWeekendOnly[key] = { weekend: 0, other: 0 };
    if (day === 0 || day === 6) weekToWeekendOnly[key].weekend++;
    else weekToWeekendOnly[key].other++;
  }
  const weekKeys = Object.keys(weekToWeekendOnly).sort().reverse();
  let weekendOnlyStreakWeeks = 0;
  for (const k of weekKeys) {
    const w = weekToWeekendOnly[k];
    if (w.other === 0 && w.weekend > 0) weekendOnlyStreakWeeks++;
    else break;
  }

  return {
    totalActivities: activities.length,
    totalMiles,
    longestSingleActivityMiles,
    activeDayStreak,
    loopCount,
    totalOwnedAreaMi2,
    cellsStolen,
    defendedCount,
    friendsCount,
    hasEarlyMorningActivity,
    hasLateNightActivity,
    maxMilesIn7Days,
    maxLoopsInOneDay,
    maxCellsStolenInOneActivity,
    weekendOnlyStreakWeeks,
    hasEverSynced: opts.hasEverSynced ?? true,
  };
}

/**
 * Evaluate all badge definitions, insert new UserBadge rows, create Notifications, return newly unlocked.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} userId
 * @param {Record<string, number|boolean>} stats - from computeUserStats
 * @param {{ userNickname?: string }} opts - for notification body
 * @returns {Promise<Array<{ badgeKey: string, tier: number, name: string, icon: string, isSecret: boolean }>>}
 */
export async function evaluateBadges(prisma, userId, stats, opts = {}) {
  const existing = await prisma.userBadge.findMany({
    where: { userId },
    select: { badgeKey: true, tier: true },
  });
  const existingSet = new Set(existing.map((e) => `${e.badgeKey}:${e.tier ?? 1}`));

  const newlyUnlocked = [];

  for (const def of BADGE_DEFINITIONS) {
    const tierReached = def.condition(stats);
    if (tierReached === 0) continue;

    const tiersToUnlock = def.tiered
      ? Array.from({ length: tierReached }, (_, i) => i + 1)
      : [1];

    for (const tierForDb of tiersToUnlock) {
      const key = `${def.key}:${tierForDb}`;
      if (existingSet.has(key)) continue;

      await prisma.userBadge.create({
        data: {
          userId,
          badgeKey: def.key,
          tier: tierForDb,
          isSecret: def.isSecret,
        },
      });
      existingSet.add(key);

      const tierLabel = def.tiered ? ` ${TIER_ROMAN[tierForDb] || tierForDb}` : '';
      const title = `Badge unlocked: ${def.name}${tierLabel}`;
      const body = def.isSecret ? 'You unlocked a secret badge!' : (def.description || '');

      await prisma.notification.create({
        data: {
          userId,
          type: 'BADGE_UNLOCK',
          title,
          body,
          meta: { badgeKey: def.key, tier: tierForDb, isSecret: def.isSecret, icon: def.icon },
        },
      });

      newlyUnlocked.push({
        badgeKey: def.key,
        tier: tierForDb,
        name: def.name,
        description: def.description,
        icon: def.icon,
        isSecret: def.isSecret,
        tiered: def.tiered,
        tierLabel: tierLabel.trim() || null,
      });
    }
  }

  return newlyUnlocked;
}

/**
 * Run full evaluation: compute stats then evaluate. Returns newly unlocked badges.
 */
export async function computeAndEvaluateBadges(prisma, userId, opts = {}) {
  const stats = await computeUserStats(prisma, userId, opts);
  return evaluateBadges(prisma, userId, stats, opts);
}
