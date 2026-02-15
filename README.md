# TerraRun

<p align="center">
  <img src="public/logo.png" alt="TerraRun" width="200" />
</p>

**Turn your runs into territory.** Connect Strava, run routes, and compete for area on the map.

TerraRun is a location-based running game: you connect your Strava account, and your activities become routes and claimable loops. Compete on leaderboards by total area captured, unlock badges, and see your progress over time—all with a privacy-first design.

---

## Features

### Connect & sync
- **Strava integration** — Sign in with Strava (OAuth). Your activities sync so you can see routes and claim territory.
- **Import recent (90 days)** — Pull in older or newly imported Strava activities so nothing is missed.
- **Load my Strava activities** — Manual sync for the latest activities (incremental by last sync time).

### Run mode
- **Activity routes on the map** — Your runs appear as routes from Strava polylines. Click an activity to highlight it and fit the map to its bounds.
- **Run stats** — Today, this week, and all-time: distance, active days, streak, longest run.
- **Territory from loops** — Closed-loop runs (e.g. laps) can claim territory; see loops completed and area owned.
- **Badges & progress** — Unlock badges (e.g. by total miles, longest run, streak) and see progress to the next tier.

### Game mode
- **Territory map** — 50 m grid cells; ownership is computed from your loop activities. View **Everyone** or **Friends only**.
- **Leaderboard** — Global or friends, by total area or recent claims. See your rank and climb by capturing new loops.
- **Conquests** — When someone takes your cells, you get a notification; “View” zooms to the attack and shows a short animation.
- **Friends** — Add friends by nickname, accept/reject requests. Compete and see friends’ badges and leaderboard position.

### General
- **Notifications** — Territory conquered, friend requests, badge unlocks.
- **Privacy & terms** — Privacy Policy and Terms of Service are linked from the landing page and footer. Session cookies; no selling of data; nickname visible only to friends in friend views.
- **Mobile-friendly** — Responsive layout and map; works on phones and tablets.

---

## Tech stack

- **Frontend:** React 18, Vite, React Router, MapLibre GL JS, MapTiler.
- **Backend:** Node.js, Express, Prisma, PostgreSQL.
- **Auth:** Cookie-based sessions; Strava OAuth for activity access.
- **Deploy:** Frontend (e.g. Vercel), API (e.g. Render); see `DEPLOYMENT.md` and `server/.env.example` for configuration.

---

## License

Copyright (C) 2025 TerraRun.

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)** — see the [LICENSE](LICENSE) file for the full text.

You may use, copy, modify, and distribute this software under the terms of the GPL-3.0. If you convey modified or combined works based on TerraRun, you must make the source available under the same license and preserve copyright and license notices.
