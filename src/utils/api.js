/**
 * API base URL for backend. All API calls should use getApiBase() (via API_BASE or apiBase prop).
 * - Production (e.g. Vercel): set VITE_STRAVA_API_URL to your API URL (e.g. https://your-api.onrender.com).
 * - Dev: defaults to http://localhost:8787; when opening at 127.0.0.1 we use same host so CORS works.
 */
const DEFAULT_DEV_API = 'http://localhost:8787';

export function getApiBase() {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_STRAVA_API_URL) {
    return String(import.meta.env.VITE_STRAVA_API_URL).replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return `${window.location.protocol}//${window.location.hostname}:8787`;
  }
  return DEFAULT_DEV_API;
}
