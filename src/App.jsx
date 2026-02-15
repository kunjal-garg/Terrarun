import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { getApiBase } from './utils/api.js';
import LandingPage from './pages/LandingPage.jsx';
import Onboarding from './pages/Onboarding.jsx';
import AppPage from './pages/AppPage.jsx';

function ConfigError() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0a0a12',
      color: '#e8e8ee',
      fontFamily: 'system-ui, sans-serif',
      padding: 24,
      textAlign: 'center',
    }}>
      <div>
        <h1 style={{ marginBottom: 8 }}>App misconfigured: API URL missing</h1>
        <p style={{ color: 'rgba(232,232,238,0.8)', marginBottom: 16 }}>
          Set VITE_STRAVA_API_URL in your deployment environment (e.g. Vercel project settings).
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const apiBase = getApiBase();
  const isProductionOrigin = typeof window !== 'undefined' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1';
  if (isProductionOrigin && !apiBase) {
    return <ConfigError />;
  }
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/app" element={<AppPage />} />
      </Routes>
    </BrowserRouter>
  );
}
