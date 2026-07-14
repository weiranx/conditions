#!/usr/bin/env bash
# Recreate the production backend so Docker Compose reloads .env.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

echo "==> Recreating backend container with current .env..."
docker compose up -d --force-recreate --no-deps backend

echo "==> Waiting for backend health..."
backend_ready=false
for attempt in {1..20}; do
  if curl --fail --silent http://localhost:3001/healthz | grep --quiet '"ok":true'; then
    backend_ready=true
    break
  fi
  sleep 1
done

if [ "$backend_ready" != true ]; then
  echo "Backend did not become healthy within 20 seconds." >&2
  docker compose ps backend >&2
  exit 1
fi

if grep -Eq '^RESEND_API_KEY=.+$' .env \
  && grep -Eq '^EMAIL_FROM=.+$' .env \
  && grep -Eq '^APP_BASE_URL=.+$' .env; then
  echo "==> Recreating health monitor with current .env..."
  docker compose up -d --force-recreate --no-deps health-monitor
fi

echo "==> Backend is healthy and .env has been reloaded."
