import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import StravaIcon from '../components/StravaIcon.jsx';
import './landing.css';

import { getApiBase } from '../utils/api.js';
const API_BASE = getApiBase();

export default function LandingPage() {
  const navigate = useNavigate();
  const [connecting, setConnecting] = useState(false);
  const [stravaConnected, setStravaConnected] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [showWhat, setShowWhat] = useState(false);
  const [logoError, setLogoError] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('strava') === 'connected') {
      setStravaConnected(true);
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (params.get('strava') === 'error') {
      const msg = params.get('message') || params.get('error') || 'Strava connection failed';
      setErrorMessage(decodeURIComponent(String(msg)));
      window.history.replaceState({}, '', window.location.pathname);
    }
    const err = params.get('error');
    if (err && !params.get('strava')) {
      setErrorMessage(decodeURIComponent(err));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleConnectStrava = () => {
    setConnecting(true);
    window.location.href = `${API_BASE.replace(/\/$/, '')}/auth/strava/start`;
  };

  const handleContinue = () => {
    navigate('/onboarding');
  };

  return (
    <div className="landing-root">
      <div className="landing-split">
        <div className="landing-left-col">
          <div className="landing-hero-watermark" aria-hidden="true">
            {logoError ? (
              <span className="landing-watermark-text">TerraRun</span>
            ) : (
              <img
                src="/logo.png"
                alt=""
                className="landing-watermark-img"
                onError={() => setLogoError(true)}
              />
            )}
          </div>
        </div>

        <div className="landing-right-col">
          <div className="landing-right-inner">
            <h1 className="landing-brand">TerraRun</h1>
            <p className="landing-tagline">Powered by Your Steps.</p>
            <div className="landing-card">
            {errorMessage && (
              <div className="landing-banner error" role="alert">
                {errorMessage}
              </div>
            )}

            {stravaConnected ? (
              <>
                <div className="landing-banner success" role="status">
                  Strava connected. Choose a nickname to continue.
                </div>
                <button
                  type="button"
                  className="landing-continue"
                  onClick={handleContinue}
                  autoFocus
                >
                  Continue
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="landing-cta"
                  onClick={handleConnectStrava}
                  disabled={connecting}
                  aria-busy={connecting}
                >
                  <StravaIcon size={20} className="landing-cta-icon" />
                  <span>{connecting ? 'Connecting…' : 'Connect with Strava'}</span>
                </button>
                {typeof import.meta !== 'undefined' && import.meta.env?.DEV && (
                  <p className="landing-dev-switch">
                    <a
                      href={`${API_BASE.replace(/\/$/, '')}/auth/strava/start?switch=1`}
                      className="landing-dev-switch-link"
                    >
                      Switch Strava account (dev)
                    </a>
                  </p>
                )}
                <p className="landing-privacy">We only display your nickname publicly. <Link to="/privacy" className="landing-privacy-link">Privacy Policy</Link></p>
                <button
                  type="button"
                  className="landing-what-toggle"
                  onClick={() => setShowWhat(!showWhat)}
                  aria-expanded={showWhat}
                >
                  {showWhat ? 'Hide' : 'What is TerraRun?'}
                </button>
                {showWhat && (
                  <p className="landing-what-text">
                    TerraRun turns your runs into territory. Connect Strava, run routes, and claim areas on the map. Compete with others and climb the leaderboard by total area captured.
                  </p>
                )}
              </>
            )}
            </div>
          </div>
        </div>
      </div>
      <div className="landing-footer">
        <Link to="/privacy" className="landing-footer-link">Privacy</Link>
        <span className="landing-footer-sep">•</span>
        <Link to="/terms" className="landing-footer-link">Terms</Link>
      </div>
    </div>
  );
}
