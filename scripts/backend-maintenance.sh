#!/usr/bin/env bash
# Start or stop the production backend container for maintenance windows.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEALTH_URL="${BACKEND_HEALTH_URL:-http://localhost:3001/healthz}"
HEALTH_ATTEMPTS="${BACKEND_HEALTH_ATTEMPTS:-20}"

usage() {
  cat <<EOF
Usage: $(basename "$0") <start|stop|status>

  start   Start the backend container and wait for it to become healthy.
  stop    Gracefully stop the backend container.
  status  Show the backend container and health status.

Environment overrides:
  BACKEND_HEALTH_URL       Health endpoint (default: $HEALTH_URL)
  BACKEND_HEALTH_ATTEMPTS  One-second health-check attempts (default: $HEALTH_ATTEMPTS)
EOF
}

backend_is_running() {
  [ -n "$(docker compose ps --status running --quiet backend)" ]
}

wait_for_health() {
  local attempt

  echo "==> Waiting for backend health at $HEALTH_URL..."
  for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1)); do
    if curl --fail --silent "$HEALTH_URL" | grep --quiet '"ok":true'; then
      echo "==> Backend is healthy."
      return 0
    fi
    sleep 1
  done

  echo "Backend did not become healthy within ${HEALTH_ATTEMPTS} seconds." >&2
  docker compose ps backend >&2
  docker compose logs --tail=50 backend >&2
  return 1
}

if [ "$#" -ne 1 ]; then
  usage >&2
  exit 2
fi

cd "$APP_DIR"

case "$1" in
  start)
    if ! [[ "$HEALTH_ATTEMPTS" =~ ^[1-9][0-9]*$ ]]; then
      echo "BACKEND_HEALTH_ATTEMPTS must be a positive integer." >&2
      exit 2
    fi

    if backend_is_running; then
      echo "==> Backend container is already running."
    else
      echo "==> Starting backend container..."
      docker compose up -d --no-deps backend
    fi
    wait_for_health
    ;;
  stop)
    if ! backend_is_running; then
      echo "==> Backend container is already stopped."
      exit 0
    fi

    echo "==> Gracefully stopping backend container..."
    docker compose stop backend
    if backend_is_running; then
      echo "Backend container is still running after stop completed." >&2
      exit 1
    fi
    echo "==> Backend is stopped."
    ;;
  status)
    docker compose ps backend
    if ! backend_is_running; then
      echo "==> Backend is stopped."
      exit 1
    fi
    if curl --fail --silent "$HEALTH_URL" | grep --quiet '"ok":true'; then
      echo "==> Backend is healthy."
    else
      echo "==> Backend is running but its health check is failing." >&2
      exit 1
    fi
    ;;
  -h|--help)
    usage
    ;;
  *)
    echo "Unknown action: $1" >&2
    usage >&2
    exit 2
    ;;
esac
