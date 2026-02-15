#!/usr/bin/env bash
# Build and run TerraRun (frontend + API) in Docker. Usage: ./run.sh

set -e
cd "$(dirname "$0")"

# Docker Compose requires server/.env to exist when env_file is set. Create from example if missing.
if [ ! -f server/.env ]; then
  echo "Creating server/.env from server/.env.example."
  cp server/.env.example server/.env
  echo "  → Edit server/.env: set SESSION_SECRET (required), and STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET from https://www.strava.com/settings/api for Strava. DATABASE_URL is overridden by Docker."
fi

echo "Building TerraRun (frontend + API + PostgreSQL)..."
docker compose build

echo "Stopping existing containers (if any)..."
docker compose down 2>/dev/null || true

# Free ports 4173 and 8787 if another container is using them (e.g. old terrarun-app from a previous setup)
for port in 4173 8787; do
  cid=$(docker ps -q --filter "publish=$port" 2>/dev/null)
  if [ -n "$cid" ]; then
    echo "Stopping container using port $port so TerraRun can bind to it..."
    docker stop $cid 2>/dev/null || true
  fi
done

echo "Starting TerraRun..."
docker compose up -d

echo ""
echo "TerraRun is running. Open in your browser:"
echo "  Frontend:   http://127.0.0.1:4173"
echo "  API:        http://127.0.0.1:8787"
echo "  PostgreSQL: localhost:5432 (user/postgres db/terrarun; only if needed outside Docker)"
echo ""
echo "If the page does not load, check: docker compose ps   and   docker compose logs -f"
echo "To stop: docker compose down"
