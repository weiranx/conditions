#!/usr/bin/env bash
# deploy.sh — manual deploy script for the SummitSafe backend on the VPS.
# Mirrors what the GitHub Actions workflow does; useful for hotfixes or when
# bypassing CI is necessary.
#
# Usage (run from /opt/summitsafe on the VPS):
#   ./scripts/deploy.sh
#
# Options:
#   --no-pull     Skip git pull (deploy current working tree as-is)
#   --no-build    Skip docker compose build (restart existing image)
#   --no-nginx    Skip host nginx validation/reload (used by CI deploy user)

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

NO_PULL=false
NO_BUILD=false
NO_NGINX=false

for arg in "$@"; do
  case $arg in
    --no-pull)  NO_PULL=true ;;
    --no-build) NO_BUILD=true ;;
    --no-nginx) NO_NGINX=true ;;
    *) echo "Unknown option: $arg" && exit 1 ;;
  esac
done

echo "==> SummitSafe deploy starting"

if [ "$NO_PULL" = false ]; then
  echo "==> Pulling latest changes from origin main..."
  git pull origin main
fi

if [ "$NO_BUILD" = false ]; then
  echo "==> Building backend image..."
  docker compose build --pull backend
fi

if [ -f .env ] && grep -Eq '^DATABASE_URL=.+$' .env; then
  if grep -Eq '^POSTGRES_PASSWORD=.+$' .env; then
    echo "==> Ensuring local PostgreSQL is running..."
    docker compose up -d postgres

    echo "==> Waiting for PostgreSQL readiness..."
    postgres_ready=false
    for _ in {1..60}; do
      if docker compose exec -T postgres pg_isready >/dev/null 2>&1; then
        postgres_ready=true
        break
      fi
      sleep 1
    done
    if [ "$postgres_ready" != true ]; then
      docker compose ps postgres >&2
      docker compose logs --tail 50 postgres >&2
      echo "PostgreSQL did not become ready within 60 seconds." >&2
      exit 1
    fi
  fi

  echo "==> Applying database migrations..."
  docker compose run --rm --no-deps backend npm run db:migrate
fi

echo "==> Restarting backend container..."
docker compose up -d --force-recreate --no-deps backend

if [ "$NO_NGINX" = false ]; then
  echo "==> Reloading host nginx..."
  nginx -t && systemctl reload nginx
fi

echo "==> Waiting for health check..."
backend_ready=false
for _ in {1..30}; do
  if curl --fail --silent http://localhost:3001/healthz | grep --quiet '"ok":true'; then
    backend_ready=true
    break
  fi
  sleep 1
done
if [ "$backend_ready" != true ]; then
  docker compose ps backend >&2
  docker compose logs --tail 50 backend >&2
  echo "Backend did not become healthy within 30 seconds." >&2
  exit 1
fi

echo "==> Deploy complete."
