import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

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
