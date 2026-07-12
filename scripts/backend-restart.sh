#!/usr/bin/env bash
# Restart the production backend without rebuilding it or reloading .env.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

echo "==> Restarting backend container..."
docker compose restart backend

echo "==> Waiting for backend health..."
for attempt in {1..12}; do
  if curl --fail --silent http://localhost:3001/healthz | grep --quiet '"ok":true'; then
    echo "==> Backend is healthy."
    exit 0
  fi
  sleep 1
done

echo "Backend did not become healthy within 12 seconds." >&2
docker compose ps backend >&2
exit 1
