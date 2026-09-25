#!/usr/bin/env bash
# deploy.sh — manual deploy script for the SummitSafe backend on the VPS.
# Mirrors what the GitHub Actions workflow does; useful for hotfixes or when
# bypassing CI is necessary. When mcp/.env exists, the MCP server
# (mcp/compose.yaml) is released after the backend.
#
# Usage (run from /opt/summitsafe on the VPS):
#   ./scripts/deploy.sh
#
# Options:
#   --no-pull     Skip git pull (deploy current working tree as-is)
#   --no-build    Skip docker compose build (restart existing image)
#   --no-nginx    Skip host nginx validation/reload (used by CI deploy user)
#   --skip-unchanged
#                 Keep a running backend or MCP server whose files have not
#                 changed since its last healthy release (used by CI)
#   --help        Show usage

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

NO_PULL=false
NO_BUILD=false
NO_NGINX=false
SKIP_UNCHANGED=false

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy.sh [options]

Options:
  --no-pull   Deploy the current working tree without updating from origin/main
  --no-build  Reuse the existing backend image
  --no-nginx  Skip host nginx validation and reload
  --skip-unchanged
              Keep a running backend or MCP server whose files have not
              changed since its last healthy release
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
    --skip-unchanged) SKIP_UNCHANGED=true ;;
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
  [ "$SKIP_UNCHANGED" = true ] && reexec_args+=(--skip-unchanged)
  echo "==> Reloading deployment script after update..."
  SUMMITSAFE_DEPLOY_LOCK_FD=9 exec "$APP_DIR/scripts/deploy.sh" "${reexec_args[@]}"
fi

echo "==> SummitSafe deploy starting"
echo "==> Deploying commit $(git rev-parse --short HEAD)"

# The files each image is built from. A healthy build from a clean tree records
# its commit next to the deploy lock, so --skip-unchanged can tell whether the
# running image still matches HEAD. A failed or rolled-back release keeps the
# older record, so the next release builds again.
BACKEND_PATHS=(backend docker-compose.yml)
MCP_PATHS=(mcp)

released_commit() {
  cat "$GIT_DIR/summitsafe-released-$1" 2>/dev/null
}

# unchanged_since_release NAME PATH...
unchanged_since_release() {
  local released
  released="$(released_commit "$1")" || return 1
  shift
  git cat-file -e "$released^{commit}" 2>/dev/null || return 1
  git diff --quiet "$released" HEAD -- "$@" || return 1
  [ -z "$(git status --porcelain -- "$@")" ]
}

# record_release NAME PATH...
record_release() {
  local record="$GIT_DIR/summitsafe-released-$1"
  shift
  if [ -z "$(git status --porcelain -- "$@")" ]; then
    git rev-parse HEAD > "$record"
  else
    # The image holds uncommitted files, so no commit describes it.
    rm -f "$record"
  fi
}

if [ "$SKIP_UNCHANGED" = true ] \
  && [ -n "$(docker compose ps --quiet backend 2>/dev/null || true)" ] \
  && unchanged_since_release backend "${BACKEND_PATHS[@]}"; then
  # Its migrations are in backend/ too, so they have all been applied.
  echo "==> Backend unchanged since $(released_commit backend); keeping the running backend."
else
  # Must match the backend image name in docker-compose.yml.
  BACKEND_IMAGE=summitsafe-backend:latest
  ROLLBACK_IMAGE=summitsafe-backend:rollback
  rollback_available=false

  if [ "$NO_BUILD" = false ]; then
    # Keep the image of the backend that is actually running, so an unhealthy
    # build can be reverted without a rebuild. :latest is not used because an
    # earlier release may have built it and then failed before restarting. With
    # no running backend (first deployment) there is nothing known-good to keep.
    running_backend="$(docker compose ps --quiet backend 2>/dev/null || true)"
    if [ -n "$running_backend" ]; then
      running_image="$(docker inspect --format '{{.Image}}' "$running_backend")"
      docker image tag "$running_image" "$ROLLBACK_IMAGE"
      rollback_available=true
    fi
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

  wait_for_backend() {
    for _ in {1..30}; do
      if curl --fail --silent --connect-timeout 2 --max-time 5 http://localhost:3001/healthz | grep --quiet '"ok":true'; then
        return 0
      fi
      sleep 1
    done
    return 1
  }

  echo "==> Waiting for health check..."
  if ! wait_for_backend; then
    docker compose ps backend >&2
    docker compose logs --tail 50 backend >&2
    echo "Backend did not become healthy after 30 attempts." >&2
    if [ "$rollback_available" = true ]; then
      # Migrations are not reverted; they must stay compatible with the previous
      # release. The deployment still fails so the bad commit is visible in CI.
      echo "==> Rolling back to the previous backend image..." >&2
      docker image tag "$ROLLBACK_IMAGE" "$BACKEND_IMAGE"
      docker compose up -d --force-recreate --no-deps backend
      if wait_for_backend; then
        echo "Previous backend image restored and healthy." >&2
      else
        docker compose logs --tail 50 backend >&2
        echo "Rollback image is also unhealthy; manual intervention required." >&2
      fi
    fi
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

  # Only now, so a failed health monitor start is retried by the next release.
  if [ "$NO_BUILD" = false ]; then
    record_release backend "${BACKEND_PATHS[@]}"
  fi
fi

if grep -Eq '^OBJECTIVE_WATCH_CRON_SECRET=.+$' .env; then
  if command -v crontab >/dev/null 2>&1; then
    echo "==> Installing Objective Watch five-minute cron..."
    "$APP_DIR/scripts/install-objective-watch-cron.sh"
  else
    echo "==> Warning: crontab is unavailable; Objective Watch automatic checks were not installed." >&2
  fi
else
  echo "==> Objective Watch cron disabled (OBJECTIVE_WATCH_CRON_SECRET is not configured)."
fi

# The MCP server has its own Compose project and .env (see mcp/README.md). It
# is released after the backend, so an MCP failure never holds back the API.
MCP_IMAGE=conditions-mcp:latest
MCP_ROLLBACK_IMAGE=conditions-mcp:rollback

mcp_compose() {
  docker compose --project-name conditions-mcp --file "$APP_DIR/mcp/compose.yaml" "$@"
}

wait_for_mcp() {
  for _ in {1..30}; do
    if curl --fail --silent --connect-timeout 2 --max-time 5 http://127.0.0.1:8104/health | grep --quiet '"status":"ok"'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if [ -f mcp/.env ] && [ -f mcp/compose.yaml ]; then
  if [ "$SKIP_UNCHANGED" = true ] \
    && [ -n "$(mcp_compose ps --quiet conditions-mcp 2>/dev/null || true)" ] \
    && unchanged_since_release mcp "${MCP_PATHS[@]}"; then
    echo "==> MCP server unchanged since $(released_commit mcp); keeping the running server."
  else
    mcp_rollback_available=false
    if [ "$NO_BUILD" = false ]; then
      running_mcp="$(mcp_compose ps --quiet conditions-mcp 2>/dev/null || true)"
      if [ -n "$running_mcp" ]; then
        docker image tag "$(docker inspect --format '{{.Image}}' "$running_mcp")" "$MCP_ROLLBACK_IMAGE"
        mcp_rollback_available=true
      fi
      echo "==> Building MCP server image..."
      mcp_compose build --pull conditions-mcp
    fi

    # Without --force-recreate, Compose leaves the container alone when neither
    # the image nor its configuration changed.
    echo "==> Starting MCP server..."
    mcp_compose up -d conditions-mcp

    echo "==> Waiting for MCP health check..."
    if ! wait_for_mcp; then
      mcp_compose ps conditions-mcp >&2
      mcp_compose logs --tail 50 conditions-mcp >&2
      echo "MCP server did not become healthy after 30 attempts." >&2
      if [ "$mcp_rollback_available" = true ]; then
        echo "==> Rolling back to the previous MCP image..." >&2
        docker image tag "$MCP_ROLLBACK_IMAGE" "$MCP_IMAGE"
        mcp_compose up -d --force-recreate conditions-mcp
        if wait_for_mcp; then
          echo "Previous MCP image restored and healthy." >&2
        else
          echo "Rollback MCP image is also unhealthy; manual intervention required." >&2
        fi
      fi
      exit 1
    fi

    if [ "$NO_BUILD" = false ]; then
      record_release mcp "${MCP_PATHS[@]}"
    fi
  fi
else
  echo "==> MCP server skipped (mcp/.env is not configured)."
fi

if [ "$NO_NGINX" = false ]; then
  echo "==> Validating and reloading host nginx..."
  nginx -t && systemctl reload nginx
fi

# Each build leaves the previous image untagged. Remove dangling images and
# week-old build cache so repeated releases do not fill the droplet's disk.
echo "==> Pruning unused Docker images and build cache..."
docker image prune --force >/dev/null || echo "==> Warning: image prune failed." >&2
docker builder prune --force --filter until=168h >/dev/null \
  || echo "==> Warning: build cache prune failed." >&2

echo "==> Deploy complete."
