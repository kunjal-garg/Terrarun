import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { getApiBase } from './utils/api.js';

if (import.meta.env.DEV) {
  const apiBase = getApiBase();
  console.log('[TerraRun] API base:', apiBase);
  if (!apiBase || apiBase.includes('localhost')) {
    console.warn('[TerraRun] For production, set VITE_STRAVA_API_URL to your API URL.');
  }
}

// Polyfill window.storage (async API) using localStorage for browser
window.storage = {
  get: (key) =>
    Promise.resolve({
      value: localStorage.getItem(key),
    }),
  set: (key, value) => {
    localStorage.setItem(key, value);
    return Promise.resolve();
  },
  delete: (key) => {
    localStorage.removeItem(key);
    return Promise.resolve();
  },
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
