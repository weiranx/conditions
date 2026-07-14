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
#   --help        Show usage

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

NO_PULL=false
NO_BUILD=false
NO_NGINX=false

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy.sh [options]

Options:
  --no-pull   Deploy the current working tree without updating from origin/main
  --no-build  Reuse the existing backend image
  --no-nginx  Skip host nginx validation and reload
  --help      Show this help message
EOF
}

fail() {
  echo "Deploy failed: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command '$1' is not installed."
}

for arg in "$@"; do
  case $arg in
    --no-pull)  NO_PULL=true ;;
    --no-build) NO_BUILD=true ;;
    --no-nginx) NO_NGINX=true ;;
    --help|-h)  usage; exit 0 ;;
    *) usage >&2; fail "Unknown option: $arg" ;;
  esac
done

for command in git docker curl grep flock; do
  require_command "$command"
done
if [ "$NO_NGINX" = false ]; then
  require_command nginx
  require_command systemctl
fi

git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || fail "$APP_DIR is not a Git working tree."
docker compose version >/dev/null 2>&1 \
  || fail "Docker Compose v2 is not available."
[ -f docker-compose.yml ] || fail "docker-compose.yml is missing from $APP_DIR."
[ -f .env ] || fail ".env is missing from $APP_DIR."

# Serialize CI and manual releases from this checkout. The descriptor remains
# open for the life of the script, so the kernel releases the lock on any exit.
GIT_DIR="$(git rev-parse --absolute-git-dir)"
LOCK_FILE="${SUMMITSAFE_DEPLOY_LOCK_FILE:-$GIT_DIR/summitsafe-deploy.lock}"
if [ "${SUMMITSAFE_DEPLOY_LOCK_FD:-}" = 9 ] && flock -n 9 2>/dev/null; then
  : # The pre-pull process passed its still-locked descriptor through exec.
else
  exec 9>"$LOCK_FILE"
  flock -n 9 || fail "Another deployment is already running (lock: $LOCK_FILE)."
fi

if [ "$NO_PULL" = false ]; then
  current_branch="$(git symbolic-ref --quiet --short HEAD)" \
    || fail "The checkout is detached; switch to main or use --no-pull intentionally."
  [ "$current_branch" = main ] \
    || fail "The checkout is on '$current_branch'; switch to main or use --no-pull intentionally."
  if ! git diff --quiet || ! git diff --cached --quiet; then
    fail "Tracked changes are present; commit/stash them or use --no-pull intentionally."
  fi

  echo "==> Pulling latest changes from origin main..."
  git pull --ff-only origin main
  local_head="$(git rev-parse HEAD)"
  remote_head="$(git rev-parse refs/remotes/origin/main)"
  [ "$local_head" = "$remote_head" ] \
    || fail "Local main does not exactly match origin/main after pulling."

  # Re-exec after pulling so this deployment uses the newly checked-out script
  # rather than continuing with a potentially replaced copy already in memory.
  reexec_args=(--no-pull)
  [ "$NO_BUILD" = true ] && reexec_args+=(--no-build)
  [ "$NO_NGINX" = true ] && reexec_args+=(--no-nginx)
  echo "==> Reloading deployment script after update..."
  SUMMITSAFE_DEPLOY_LOCK_FD=9 exec "$APP_DIR/scripts/deploy.sh" "${reexec_args[@]}"
fi

echo "==> SummitSafe deploy starting"
echo "==> Deploying commit $(git rev-parse --short HEAD)"

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

if grep -Eq '^RESEND_API_KEY=.+$' .env \
  && grep -Eq '^EMAIL_FROM=.+$' .env \
  && grep -Eq '^APP_BASE_URL=.+$' .env; then
  echo "==> Starting production health monitor..."
  docker compose up -d --force-recreate --no-deps health-monitor
else
  echo "==> Health alerting disabled (RESEND_API_KEY, EMAIL_FROM, and APP_BASE_URL are required)."
  docker compose stop health-monitor >/dev/null 2>&1 || true
fi

if grep -Eq '^OBJECTIVE_WATCH_CRON_SECRET=.+$' .env; then
  if command -v crontab >/dev/null 2>&1; then
    echo "==> Installing Objective Watch hourly cron..."
    "$APP_DIR/scripts/install-objective-watch-cron.sh"
  else
    echo "==> Warning: crontab is unavailable; Objective Watch hourly checks were not installed." >&2
  fi
else
  echo "==> Objective Watch cron disabled (OBJECTIVE_WATCH_CRON_SECRET is not configured)."
fi

if [ "$NO_NGINX" = false ]; then
  echo "==> Validating and reloading host nginx..."
  nginx -t && systemctl reload nginx
fi

echo "==> Deploy complete."
