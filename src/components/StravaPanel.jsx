import React, { useState, useEffect } from 'react';
import { getApiBase } from '../utils/api.js';

function normalizeApiBase(base) {
  if (!base || typeof base !== 'string') return getApiBase();
  return base.replace(/\/+$/, '');
}

function formatFetchError(e, url, fallback) {
  const msg = e?.message || String(e) || fallback;
  if (msg === 'Failed to fetch') {
    return `Network error (request to ${url}). Check: 1) API running at that URL (e.g. docker compose ps). 2) Open app at http://localhost:4173 or http://127.0.0.1:4173. 3) CORS may block other origins.`;
  }
  return msg;
}

export default function StravaPanel({
  activities = [],
  onSync,
  onResyncComplete,
  onSelectActivity,
  apiBase,
}) {
  const [loading, setLoading] = useState(false);
  const [resyncLoading, setResyncLoading] = useState(false);
  const [error, setError] = useState(null);
  const [stravaMessage, setStravaMessage] = useState(null);
  const base = normalizeApiBase(apiBase ?? getApiBase());

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const strava = params.get('strava');
    const message = params.get('message');
    if (strava === 'connected') {
      setStravaMessage({ type: 'success', text: 'Connected to Strava!' });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (strava === 'error') {
      setStravaMessage({ type: 'error', text: message || 'Strava connection failed' });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleLoadActivities = async () => {
    const url = `${base}/api/strava/sync`;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const serverMsg = data.message || data.error || data.detail || res.statusText;
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[StravaPanel] Load activities failed', { url, status: res.status, body: data });
        }
        setError(serverMsg);
        return;
      }
      if (typeof onSync === 'function') onSync(data);
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[StravaPanel] Load activities fetch error', { url, error: e?.message });
      }
      setError(formatFetchError(e, url, 'Failed to sync activities'));
    } finally {
      setLoading(false);
    }
  };

  const handleResync = async () => {
    const url = `${base}/api/strava/resync`;
    setResyncLoading(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const serverMsg = data.message || data.error || data.detail || res.statusText;
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[StravaPanel] Resync failed', { url, status: res.status, body: data });
        }
        setError(serverMsg);
        return;
      }
      if (typeof onSync === 'function') onSync(data);
      if (typeof onResyncComplete === 'function') onResyncComplete();
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[StravaPanel] Resync fetch error', { url, error: e?.message });
      }
      setError(formatFetchError(e, url, 'Failed to resync'));
    } finally {
      setResyncLoading(false);
    }
  };

  return (
    <div className="stat-card">
      <h3 style={{
        margin: '0 0 16px 0',
        color: '#00ff88',
        fontSize: '18px',
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        Strava
      </h3>

      {stravaMessage && (
        <div style={{
          marginBottom: '12px',
          padding: '10px',
          borderRadius: '8px',
          background: stravaMessage.type === 'success' ? 'rgba(0, 255, 136, 0.15)' : 'rgba(255, 51, 102, 0.15)',
          color: stravaMessage.type === 'success' ? '#00ff88' : '#ff3366',
          fontSize: '14px',
          fontWeight: 600,
        }}>
          {stravaMessage.text}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <button
          type="button"
          onClick={handleLoadActivities}
          className="btn btn-primary"
          style={{ width: '100%' }}
          disabled={loading}
        >
          {loading ? 'Syncing…' : 'Load my Strava activities'}
        </button>
        {(typeof import.meta !== 'undefined' && (import.meta.env?.VITE_APP_DEBUG === 'true' || import.meta.env?.DEV)) && (
          <button
            type="button"
            onClick={handleResync}
            className="btn btn-secondary"
            style={{
              width: '100%',
              background: 'rgba(0,0,0,0.45)',
              border: '1px solid rgba(0,255,136,0.4)',
              color: 'rgba(255,255,255,0.9)',
            }}
            disabled={resyncLoading}
          >
            {resyncLoading ? 'Resyncing…' : 'Resync from Strava (recompute territory)'}
          </button>
        )}
      </div>

      {error && (
        <div style={{
          marginTop: '12px',
          padding: '10px',
          borderRadius: '8px',
          background: 'rgba(255, 51, 102, 0.15)',
          color: '#ff3366',
          fontSize: '13px',
        }}>
          {error}
        </div>
      )}

      {activities.length > 0 && (
        <div style={{
          marginTop: '16px',
          maxHeight: '280px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>
            Recent activities ({activities.length})
          </div>
          {activities.map((a) => (
            <div
              key={a.id}
              role="button"
              tabIndex={0}
              onClick={() => typeof onSelectActivity === 'function' && onSelectActivity(a.id)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && typeof onSelectActivity === 'function') {
                  e.preventDefault();
                  onSelectActivity(a.id);
                }
              }}
              style={{
                padding: '12px',
                background: 'rgba(255,255,255,0.06)',
                borderRadius: '10px',
                border: '1px solid rgba(0,255,136,0.2)',
                fontSize: '13px',
                cursor: onSelectActivity ? 'pointer' : 'default',
              }}
            >
              <div style={{ fontWeight: 700, color: '#00ff88', marginBottom: '4px' }}>
                {a.name || 'Unnamed activity'}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.75)' }}>
                Type: {a.type || '—'} · Distance: {a.distance != null ? `${(a.distance / 1000).toFixed(2)} km` : '—'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
