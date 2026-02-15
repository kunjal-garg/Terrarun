/**
 * API base URL for backend. All API calls should use getApiBase() (via API_BASE or apiBase prop).
 * - Production (Vercel): set VITE_STRAVA_API_URL to your API URL. No localhost default in production.
 * - Local dev (hostname localhost/127.0.0.1): falls back to same host :8787.
 */
export function getApiBase() {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_STRAVA_API_URL) {
    return String(import.meta.env.VITE_STRAVA_API_URL).replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return `${window.location.protocol}//${window.location.hostname}:8787`;
  }
  return '';
}
