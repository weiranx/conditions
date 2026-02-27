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

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

NO_PULL=false
NO_BUILD=false

for arg in "$@"; do
  case $arg in
    --no-pull)  NO_PULL=true ;;
    --no-build) NO_BUILD=true ;;
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

echo "==> Restarting backend container..."
docker compose up -d --no-deps backend

echo "==> Reloading host nginx..."
nginx -t && systemctl reload nginx

echo "==> Waiting for health check..."
sleep 5
curl --fail --silent http://localhost:3001/healthz | grep '"ok":true'

echo "==> Deploy complete."
