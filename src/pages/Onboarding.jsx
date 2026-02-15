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
  const [guardReason, setGuardReason] = useState(null); // 'cookie_missing' | 'strava_not_linked' | 'fetch_error'
  const [fetchErrorDetail, setFetchErrorDetail] = useState(null); // { message, url }
  const [diagnostics, setDiagnostics] = useState(null); // { apiBase, meStatus, meBody, pendingStatus, pendingHasPending }

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const opts = { credentials: 'include' };
      try {
        if (IS_DEV) {
          console.log('[Onboarding] GET', apiMeUrl);
          console.log('[Onboarding] GET', apiPendingUrl);
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
          setGuardReason('cookie_missing');
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
  }, [navigate, apiMeUrl, apiPendingUrl, apiBase]);

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
      sessionStorage.setItem('terrarun_strava_connected', '1');
      navigate('/app');
    } catch (err) {
      setErrorBanner(err.message || 'Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    sessionStorage.setItem('terrarun_strava_connected', '1');
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

  const showGuard = guardReason === 'cookie_missing' || guardReason === 'strava_not_linked' || guardReason === 'fetch_error';
  if (showGuard) {
    let message = '';
    if (guardReason === 'cookie_missing') {
      message = 'Session not established (cookie missing). Try connecting Strava from the home page and ensure cookies are allowed for this site.';
    } else if (guardReason === 'strava_not_linked') {
      message = 'Strava account not linked yet. Connect Strava on the home page to continue.';
    } else if (guardReason === 'fetch_error') {
      message = `Network or CORS error: ${fetchErrorDetail?.message || 'Failed to fetch'}. In DevTools → Network, check the request: Origin should be http://localhost:4173; response must include Access-Control-Allow-Origin: http://localhost:4173 and Access-Control-Allow-Credentials: true (not *).`;
    }

    const showCookieBlockedHint =
      guardReason === 'cookie_missing' &&
      diagnostics?.pendingStatus === 200 &&
      diagnostics?.pendingHasPending === false;

    return (
      <div className="onboarding-root">
        <div className="onboarding-card">
          <h1 className="onboarding-title">Connect Strava first</h1>
          <p className="onboarding-sub">{message}</p>
          {showCookieBlockedHint && (
            <div className="onboarding-cookie-hint" role="alert">
              You may have just completed Strava login but the pending cookie was not sent. Your browser might be blocking cross-site cookies between localhost and onrender.com. Try Chrome Incognito or allow third-party cookies for testing.
            </div>
          )}
          {diagnostics && (
            <div className="onboarding-diagnostics" aria-live="polite">
              <div className="line"><strong>Diagnostics</strong></div>
              <div className="line">API base: {diagnostics.apiBase}</div>
              {diagnostics.apiBase && diagnostics.apiBase.includes('localhost:8787') && (
                <div className="line">If you expect Render: frontend was built without VITE_STRAVA_API_URL. Rebuild with docker-compose.render.yml or run npm run dev:render.</div>
              )}
              <div className="line">GET /api/me: status {diagnostics.meStatus ?? '—'} {diagnostics.meBody != null && typeof diagnostics.meBody === 'object' && !diagnostics.fetchError ? ` body=${JSON.stringify(diagnostics.meBody)}` : ''}</div>
              <div className="line">GET /api/auth/pending: status {diagnostics.pendingStatus ?? '—'} hasPending={String(diagnostics.pendingHasPending ?? '—')}</div>
              {diagnostics.fetchError && <div className="line">Fetch error: {diagnostics.fetchError}</div>}
              <div className="line">Cookies: check Network tab → request headers for Cookie: (must be sent to same origin as API base).</div>
              <div className="line">CORS: Response headers should have Access-Control-Allow-Origin: http://localhost:4173 and Access-Control-Allow-Credentials: true.</div>
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
