import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getApiBase } from '../utils/api.js';
import './onboarding.css';

const NICKNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;
const API_BASE = getApiBase();
const API_NICKNAME_URL = `${API_BASE}/api/nickname`;

export default function Onboarding() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [nickname, setNickname] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorBanner, setErrorBanner] = useState(null);
  const [hasStrava, setHasStrava] = useState(false);

  useEffect(() => {
    const strava = searchParams.get('strava') === 'connected';
    const fromLanding = document.referrer && document.referrer.includes(window.location.origin);
    setHasStrava(strava || fromLanding || !!sessionStorage.getItem('terrarun_strava_connected'));
  }, [searchParams]);

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

  if (!hasStrava) {
    return (
      <div className="onboarding-root">
        <div className="onboarding-card">
          <h1 className="onboarding-title">Connect Strava first</h1>
          <p className="onboarding-sub">Please connect your Strava account on the home page, then return here to set your nickname.</p>
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
