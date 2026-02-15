# TerraRun

Real-world territory capture: connect Strava, run routes, claim areas on the map, compete on the leaderboard.

- **Run locally:** `./run.sh` (Docker: frontend, API, PostgreSQL). Frontend: http://localhost:4173, API: http://localhost:8787.
- **Deploy:** Frontend on [Vercel](https://vercel.com), API on [Render](https://render.com) (or similar). Set env vars per checklist below.

---

## Environment variable checklist

### Frontend (Vercel)

| Variable | Required | Description |
|----------|----------|-------------|
| **VITE_STRAVA_API_URL** | **Yes** (production) | Backend API URL (e.g. `https://your-api.onrender.com`). Dev default: `http://localhost:8787`. |
| **VITE_MAPTILER_KEY** | **Yes** | MapTiler API key for the map. [Get one](https://www.maptiler.com/cloud/) (free tier). |
| **VITE_APP_DEBUG** | No | Set to `true` to show development-only controls (e.g. Resync from Strava). Omit or `false` in production. |

- All API calls use `VITE_STRAVA_API_URL` with a sensible dev default; auth requests use `credentials: 'include'`.
- Build: `npm run build` (output: `dist/`). Vercel uses `vercel.json` for SPA rewrites (`/`, `/app`, `/onboarding` → `index.html`).

### Backend (Render)

See `server/.env.example`. Key vars: `DATABASE_URL`, `SESSION_SECRET`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `FRONTEND_URL`, `STRAVA_REDIRECT_URI`. Start command: `npm run start:render` (runs migrations then server).
