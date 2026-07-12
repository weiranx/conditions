#!/usr/bin/env bash
# Recreate the production backend so Docker Compose reloads .env.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

echo "==> Recreating backend container with current .env..."
docker compose up -d --force-recreate --no-deps backend

echo "==> Waiting for backend health..."
for attempt in {1..20}; do
  if curl --fail --silent http://localhost:3001/healthz | grep --quiet '"ok":true'; then
    echo "==> Backend is healthy and .env has been reloaded."
    exit 0
  fi
  sleep 1
done

echo "Backend did not become healthy within 20 seconds." >&2
docker compose ps backend >&2
exit 1
