import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiBase } from '../utils/api.js';
import './onboarding.css';

const NICKNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;
const IS_DEV = typeof import.meta !== 'undefined' && import.meta.env?.DEV;

// Auth state derived from API (so onboarding works after Strava callback when cookies are cross-site)
const AUTH_LOADING = 'loading';
const AUTH_READY = 'ready';

export default function Onboarding() {
  const navigate = useNavigate();
  const apiBase = getApiBase();
  const apiNicknameUrl = `${apiBase}/api/nickname`;
  const apiMeUrl = `${apiBase}/api/me`;
  const apiPendingUrl = `${apiBase}/api/auth/pending`;

  const [nickname, setNickname] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorBanner, setErrorBanner] = useState(null);
  const [authState, setAuthState] = useState(AUTH_LOADING);
  const [guardReason, setGuardReason] = useState(null); // 'cookie_blocked' | 'cookie_missing' | 'strava_not_linked' | 'fetch_error'
  const [fetchErrorDetail, setFetchErrorDetail] = useState(null); // { message, url }
  const [diagnostics, setDiagnostics] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0); // increment to re-run auth check (Retry)
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [showHowToFix, setShowHowToFix] = useState(false);

  const isRenderApi = apiBase && apiBase.includes('onrender.com');

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const opts = { credentials: 'include' };
      try {
        if (IS_DEV) {
          console.log('[Onboarding] GET', apiMeUrl, 'GET', apiPendingUrl, 'credentials:', opts.credentials);
        }
        const [meRes, pendingRes] = await Promise.all([
          fetch(apiMeUrl, opts),
          fetch(apiPendingUrl, opts),
        ]);
        if (cancelled) return;

        const meStatus = meRes.status;
        let meBody = null;
        try {
          meBody = await meRes.json();
        } catch {
          meBody = { _raw: await meRes.text().catch(() => '') };
        }
        const pendingStatus = pendingRes.status;
        let pendingBody = {};
        try {
          pendingBody = await pendingRes.json();
        } catch {
          pendingBody = { _raw: await pendingRes.text().catch(() => '') };
        }
        const hasPending = !!pendingBody.hasPending;

        if (IS_DEV) {
          console.log('[Onboarding] GET /api/me status=', meStatus, 'body=', meBody);
          console.log('[Onboarding] GET /api/auth/pending status=', pendingStatus, 'body=', pendingBody, 'hasPending=', hasPending);
        }

        setDiagnostics({
          apiBase,
          meStatus,
          meBody: meRes.ok ? { user: !!meBody?.user, stravaLinked: !!meBody?.stravaLinked } : meBody,
          pendingStatus,
          pendingHasPending: hasPending,
        });

        if (meRes.ok) {
          if (meBody?.stravaLinked) {
            navigate('/app', { replace: true });
            return;
          }
          setGuardReason('strava_not_linked');
        } else {
          if (hasPending) {
            setAuthState(AUTH_READY);
            return;
          }
          // On /onboarding with Render API: 401 + no pending cookie likely means third-party cookies blocked
          if (isRenderApi && meStatus === 401 && pendingStatus === 200 && !hasPending) {
            setGuardReason('cookie_blocked');
          } else {
            setGuardReason('cookie_missing');
          }
        }
        setAuthState(AUTH_READY);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (IS_DEV) {
          console.log('[Onboarding] fetch error url=', apiMeUrl, 'or', apiPendingUrl, 'error=', message);
        }
        if (!cancelled) {
          setFetchErrorDetail({ message, url: apiBase });
          setDiagnostics({ apiBase, fetchError: message });
          setGuardReason('fetch_error');
          setAuthState(AUTH_READY);
        }
      }
    };
    run();
    return () => { cancelled = true; };
  }, [navigate, apiMeUrl, apiPendingUrl, apiBase, isRenderApi, refreshTrigger]);

  const handleRetry = () => {
    setAuthState(AUTH_LOADING);
    setGuardReason(null);
    setShowHowToFix(false);
    setRefreshTrigger((t) => t + 1);
  };

  const invalid = nickname.length > 0 && !NICKNAME_REGEX.test(nickname);
  const valid = NICKNAME_REGEX.test(nickname);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    setErrorBanner(null);
    const trimmed = nickname.trim();
    setSubmitting(true);
    try {
      const res = await fetch(apiNicknameUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: trimmed }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorBanner(data.message || data.error || `Request failed (${res.status})`);
        return;
      }
      sessionStorage.setItem('terrarun_nickname', trimmed);
      navigate('/app');
    } catch (err) {
      setErrorBanner(err.message || 'Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    navigate('/app');
  };

  const handleBack = () => {
    navigate('/');
  };

  if (authState === AUTH_LOADING) {
    return (
      <div className="onboarding-root">
        <div className="onboarding-card">
          <p className="onboarding-sub">Checking…</p>
        </div>
      </div>
    );
  }

  const showGuard = guardReason === 'cookie_blocked' || guardReason === 'cookie_missing' || guardReason === 'strava_not_linked' || guardReason === 'fetch_error';
  if (showGuard) {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';

    if (guardReason === 'cookie_blocked') {
      const isChrome = typeof navigator !== 'undefined' && /Chrome/.test(navigator.userAgent) && !/Edge|Edg/.test(navigator.userAgent);
      return (
        <div className="onboarding-root">
          <div className="onboarding-card">
            <h1 className="onboarding-title">Cookies are blocked</h1>
            <div className="onboarding-cookie-blocked-banner" role="alert">
              <p>TerraRun needs cookies to stay signed in. Your browser is blocking third-party cookies, so we can&apos;t complete login.</p>
              {isChrome ? (
                <ul className="onboarding-cookie-blocked-steps">
                  <li>Chrome: Settings → Privacy &amp; security → Third-party cookies → Allow for this site (or temporarily allow).</li>
                  <li>Or allow cookies for this site and disable strict tracking prevention.</li>
                  <li>Then refresh this page and try again.</li>
                </ul>
              ) : (
                <ul className="onboarding-cookie-blocked-steps">
                  <li>Allow cookies for this site and allow third-party cookies (or disable strict tracking prevention), then refresh.</li>
                </ul>
              )}
              <div className="onboarding-cookie-blocked-actions">
                <button type="button" className="onboarding-cookie-blocked-retry" onClick={handleRetry}>
                  Retry
                </button>
                <button type="button" className="onboarding-cookie-blocked-how" onClick={() => setShowHowToFix((v) => !v)}>
                  {showHowToFix ? 'Hide steps' : 'How to fix'}
                </button>
              </div>
              {showHowToFix && (
                <div style={{ marginTop: '0.75rem' }}>
                  {isChrome ? (
                    <ul className="onboarding-cookie-blocked-steps">
                      <li>Chrome: Settings → Privacy &amp; security → Third-party cookies → Allow for this site (or temporarily allow).</li>
                      <li>Then click Retry above.</li>
                      <li>Tip: Try an Incognito window — sometimes cookies work there for this flow.</li>
                    </ul>
                  ) : (
                    <ul className="onboarding-cookie-blocked-steps">
                      <li>Allow third-party cookies (or disable strict tracking prevention) and click Retry.</li>
                      <li>Tip: Try a private/incognito window — sometimes cookies work there.</li>
                    </ul>
                  )}
                </div>
              )}
              <p className="onboarding-cookie-blocked-why">
                <a href="#why" onClick={(e) => { e.preventDefault(); setShowWhy((w) => !w); }} role="button">
                  Why?
                </a>
                {showWhy && (
                  <span style={{ display: 'block', marginTop: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    Because TerraRun runs on Vercel and the login is handled by our backend on Render.
                  </span>
                )}
              </p>
            </div>
            <button type="button" className="onboarding-diagnostics-toggle" onClick={() => setShowDiagnostics((d) => !d)}>
              {showDiagnostics ? 'Hide diagnostics' : 'Show diagnostics'}
            </button>
            {showDiagnostics && diagnostics && (
              <div className="onboarding-diagnostics" aria-live="polite">
                <div className="line"><strong>Diagnostics</strong></div>
                <div className="line">Frontend origin: {origin}</div>
                <div className="line">API base: {diagnostics.apiBase}</div>
                <div className="line">GET /api/me: status {diagnostics.meStatus ?? '—'} {diagnostics.meBody != null && typeof diagnostics.meBody === 'object' && !diagnostics.fetchError ? ` body=${JSON.stringify(diagnostics.meBody)}` : ''}</div>
                <div className="line">GET /api/auth/pending: status {diagnostics.pendingStatus ?? '—'} hasPending={String(diagnostics.pendingHasPending ?? '—')}</div>
                <div className="line">CORS: Response should have Access-Control-Allow-Origin: {origin} and Access-Control-Allow-Credentials: true.</div>
              </div>
            )}
            <button type="button" className="onboarding-back" onClick={handleBack}>
              Back to home
            </button>
          </div>
        </div>
      );
    }

    let message = '';
    if (guardReason === 'cookie_missing') {
      message = 'Session not established (cookie missing). Try connecting Strava from the home page and ensure cookies are allowed for this site.';
    } else if (guardReason === 'strava_not_linked') {
      message = 'Strava account not linked yet. Connect Strava on the home page to continue.';
    } else if (guardReason === 'fetch_error') {
      message = `Network or CORS error: ${fetchErrorDetail?.message || 'Failed to fetch'}. Check that the API is reachable and allows your origin (${origin || 'this site'}).`;
    }

    return (
      <div className="onboarding-root">
        <div className="onboarding-card">
          <h1 className="onboarding-title">Connect Strava first</h1>
          <p className="onboarding-sub">{message}</p>
          <button type="button" className="onboarding-diagnostics-toggle" onClick={() => setShowDiagnostics((d) => !d)}>
            {showDiagnostics ? 'Hide diagnostics' : 'Show diagnostics'}
          </button>
          {showDiagnostics && diagnostics && (
            <div className="onboarding-diagnostics" aria-live="polite">
              <div className="line"><strong>Diagnostics</strong></div>
              <div className="line">Frontend origin: {origin}</div>
              <div className="line">API base: {diagnostics.apiBase || '(not set)'}</div>
              <div className="line">GET /api/me: status {diagnostics.meStatus ?? '—'} {diagnostics.meBody != null && typeof diagnostics.meBody === 'object' && !diagnostics.fetchError ? ` body=${JSON.stringify(diagnostics.meBody)}` : ''}</div>
              <div className="line">GET /api/auth/pending: status {diagnostics.pendingStatus ?? '—'} hasPending={String(diagnostics.pendingHasPending ?? '—')}</div>
              {diagnostics.fetchError && <div className="line">Fetch error: {diagnostics.fetchError}</div>}
              <div className="line">Cookies: check Network tab → request headers for Cookie.</div>
              <div className="line">CORS: Response should have Access-Control-Allow-Origin: {origin} and Access-Control-Allow-Credentials: true.</div>
            </div>
          )}
          <button type="button" className="onboarding-back" onClick={handleBack}>
            Back to home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="onboarding-root">
      <div className="onboarding-card">
        <h1 className="onboarding-title">Choose your nickname</h1>
        <p className="onboarding-sub">This is how you’ll appear on the leaderboard.</p>

        {errorBanner && (
          <div className="onboarding-banner error" role="alert">
            {errorBanner}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="onboarding-nickname" className="onboarding-label">
            Nickname
          </label>
          <input
            id="onboarding-nickname"
            type="text"
            className={`onboarding-input ${touched && invalid ? 'invalid' : ''}`}
            placeholder="e.g. runner_42"
            value={nickname}
            onChange={(e) => {
              setNickname(e.target.value);
              setErrorBanner(null);
            }}
            onBlur={() => setTouched(true)}
            autoComplete="username"
            aria-invalid={touched && invalid}
            aria-describedby={touched && invalid ? 'nickname-err' : undefined}
          />
          <p className="onboarding-helper">3–20 characters. Letters, numbers, underscore.</p>
          {touched && invalid && (
            <p id="nickname-err" className="onboarding-error-inline">
              Use only letters, numbers, and underscore (3–20 characters).
            </p>
          )}

          <button
            type="submit"
            className="onboarding-submit"
            disabled={!valid || submitting}
            aria-busy={submitting}
          >
            {submitting ? 'Saving…' : 'Continue to app'}
          </button>
        </form>

        <button type="button" className="onboarding-skip" onClick={handleSkip}>
          Skip for now
        </button>
      </div>
    </div>
  );
}
