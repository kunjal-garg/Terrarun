import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiBase } from '../utils/api.js';
import './onboarding.css';

const NICKNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;
const API_BASE = getApiBase();
const API_NICKNAME_URL = `${API_BASE}/api/nickname`;

// Auth state derived from API (so onboarding works after Strava callback when cookies are cross-site)
const AUTH_LOADING = 'loading';
const AUTH_READY = 'ready'; // has session → redirect to /app, or has pending → show form, or neither → connect Strava first

export default function Onboarding() {
  const navigate = useNavigate();
  const [nickname, setNickname] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorBanner, setErrorBanner] = useState(null);
  const [authState, setAuthState] = useState(AUTH_LOADING);
  const [guardReason, setGuardReason] = useState(null); // 'cookie_missing' | 'strava_not_linked'

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const [meRes, pendingRes] = await Promise.all([
          fetch(`${API_BASE}/api/me`, { credentials: 'include' }),
          fetch(`${API_BASE}/api/auth/pending`, { credentials: 'include' }),
        ]);
        if (cancelled) return;
        const pendingData = await pendingRes.json().catch(() => ({}));
        const hasPending = !!pendingData.hasPending;

        if (meRes.ok) {
          const meData = await meRes.json();
          if (meData.stravaLinked) {
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
      } catch {
        if (!cancelled) {
          setGuardReason('cookie_missing');
          setAuthState(AUTH_READY);
        }
      }
    };
    run();
    return () => { cancelled = true; };
  }, [navigate]);

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
      const res = await fetch(API_NICKNAME_URL, {
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

  const showGuard = guardReason === 'cookie_missing' || guardReason === 'strava_not_linked';
  if (showGuard) {
    const message =
      guardReason === 'cookie_missing'
        ? 'Session not established (cookie missing). Try connecting Strava from the home page and ensure cookies are allowed for this site.'
        : 'Strava account not linked yet. Connect Strava on the home page to continue.';
    return (
      <div className="onboarding-root">
        <div className="onboarding-card">
          <h1 className="onboarding-title">Connect Strava first</h1>
          <p className="onboarding-sub">{message}</p>
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
