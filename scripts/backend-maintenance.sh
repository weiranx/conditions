#!/usr/bin/env bash
# Start or stop the production backend and PostgreSQL containers for maintenance windows.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEALTH_URL="${BACKEND_HEALTH_URL:-http://localhost:3001/healthz}"
HEALTH_ATTEMPTS="${BACKEND_HEALTH_ATTEMPTS:-20}"
DATABASE_HEALTH_ATTEMPTS="${DATABASE_HEALTH_ATTEMPTS:-60}"

usage() {
  cat <<EOF
Usage: $(basename "$0") <start|stop|status>

  start   Start PostgreSQL, then start the backend after the database is ready.
  stop    Gracefully stop the backend, then stop PostgreSQL.
  status  Show the backend and PostgreSQL container health status.

Environment overrides:
  BACKEND_HEALTH_URL       Health endpoint (default: $HEALTH_URL)
  BACKEND_HEALTH_ATTEMPTS  One-second health-check attempts (default: $HEALTH_ATTEMPTS)
  DATABASE_HEALTH_ATTEMPTS One-second database readiness attempts (default: $DATABASE_HEALTH_ATTEMPTS)
EOF
}

service_is_running() {
  local service="$1"
  [ -n "$(docker compose ps --status running --quiet "$service")" ]
}

wait_for_backend() {
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

wait_for_database() {
  local attempt

  echo "==> Waiting for PostgreSQL readiness..."
  for ((attempt = 1; attempt <= DATABASE_HEALTH_ATTEMPTS; attempt += 1)); do
    if docker compose exec -T postgres pg_isready >/dev/null 2>&1; then
      echo "==> PostgreSQL is ready."
      return 0
    fi
    sleep 1
  done

  echo "PostgreSQL did not become ready within ${DATABASE_HEALTH_ATTEMPTS} seconds." >&2
  docker compose ps postgres >&2
  docker compose logs --tail=50 postgres >&2
  return 1
}

validate_positive_integer() {
  local name="$1"
  local value="$2"

  if ! [[ "$value" =~ ^[1-9][0-9]*$ ]]; then
    echo "$name must be a positive integer." >&2
    exit 2
  fi
}

if [ "$#" -ne 1 ]; then
  usage >&2
  exit 2
fi

cd "$APP_DIR"

case "$1" in
  start)
    validate_positive_integer BACKEND_HEALTH_ATTEMPTS "$HEALTH_ATTEMPTS"
    validate_positive_integer DATABASE_HEALTH_ATTEMPTS "$DATABASE_HEALTH_ATTEMPTS"

    if service_is_running postgres; then
      echo "==> PostgreSQL container is already running."
    else
      echo "==> Starting PostgreSQL container..."
      docker compose up -d --no-deps postgres
    fi
    wait_for_database

    if service_is_running backend; then
      echo "==> Backend container is already running."
    else
      echo "==> Starting backend container..."
      docker compose up -d --no-deps backend
    fi
    wait_for_backend
    ;;
  stop)
    if service_is_running backend; then
      echo "==> Gracefully stopping backend container..."
      docker compose stop backend
      if service_is_running backend; then
        echo "Backend container is still running after stop completed." >&2
        exit 1
      fi
      echo "==> Backend is stopped."
    else
      echo "==> Backend container is already stopped."
    fi

    if service_is_running postgres; then
      echo "==> Gracefully stopping PostgreSQL container..."
      docker compose stop postgres
      if service_is_running postgres; then
        echo "PostgreSQL container is still running after stop completed." >&2
        exit 1
      fi
      echo "==> PostgreSQL is stopped."
    else
      echo "==> PostgreSQL container is already stopped."
    fi
    ;;
  status)
    result=0
    docker compose ps backend postgres

    if ! service_is_running postgres; then
      echo "==> PostgreSQL is stopped."
      result=1
    elif docker compose exec -T postgres pg_isready >/dev/null 2>&1; then
      echo "==> PostgreSQL is ready."
    else
      echo "==> PostgreSQL is running but not ready." >&2
      result=1
    fi

    if ! service_is_running backend; then
      echo "==> Backend is stopped."
      result=1
    elif curl --fail --silent "$HEALTH_URL" | grep --quiet '"ok":true'; then
      echo "==> Backend is healthy."
    else
      echo "==> Backend is running but its health check is failing." >&2
      result=1
    fi
    exit "$result"
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
