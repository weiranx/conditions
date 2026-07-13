#!/usr/bin/env bash
# Start or stop the production backend and PostgreSQL containers for maintenance windows.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEALTH_URL="${BACKEND_HEALTH_URL:-http://localhost:3001/healthz}"
HEALTH_ATTEMPTS="${BACKEND_HEALTH_ATTEMPTS:-20}"
DATABASE_HEALTH_ATTEMPTS="${DATABASE_HEALTH_ATTEMPTS:-60}"

usage() {
  cat <<EOF
Usage: $(basename "$0") <start|stop|status> [backend|database|all]

Targets:
  backend   Manage only the backend API container.
  database  Manage only PostgreSQL (aliases: db, postgres).
  all       Manage both services in dependency-safe order (default).

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

start_backend() {
  validate_positive_integer BACKEND_HEALTH_ATTEMPTS "$HEALTH_ATTEMPTS"

  if service_is_running backend; then
    echo "==> Backend container is already running."
  else
    echo "==> Starting backend container..."
    docker compose up -d --no-deps backend
  fi
  wait_for_backend
}

start_database() {
  validate_positive_integer DATABASE_HEALTH_ATTEMPTS "$DATABASE_HEALTH_ATTEMPTS"

  if service_is_running postgres; then
    echo "==> PostgreSQL container is already running."
  else
    echo "==> Starting PostgreSQL container..."
    docker compose up -d --no-deps postgres
  fi
  wait_for_database
}

stop_backend() {
  if ! service_is_running backend; then
    echo "==> Backend container is already stopped."
    return 0
  fi

  echo "==> Gracefully stopping backend container..."
  docker compose stop backend
  if service_is_running backend; then
    echo "Backend container is still running after stop completed." >&2
    return 1
  fi
  echo "==> Backend is stopped."
}

stop_database() {
  if ! service_is_running postgres; then
    echo "==> PostgreSQL container is already stopped."
    return 0
  fi

  echo "==> Gracefully stopping PostgreSQL container..."
  docker compose stop postgres
  if service_is_running postgres; then
    echo "PostgreSQL container is still running after stop completed." >&2
    return 1
  fi
  echo "==> PostgreSQL is stopped."
}

report_backend_status() {
  if ! service_is_running backend; then
    echo "==> Backend is stopped."
    return 1
  fi
  if curl --fail --silent "$HEALTH_URL" | grep --quiet '"ok":true'; then
    echo "==> Backend is healthy."
    return 0
  fi
  echo "==> Backend is running but its health check is failing." >&2
  return 1
}

report_database_status() {
  if ! service_is_running postgres; then
    echo "==> PostgreSQL is stopped."
    return 1
  fi
  if docker compose exec -T postgres pg_isready >/dev/null 2>&1; then
    echo "==> PostgreSQL is ready."
    return 0
  fi
  echo "==> PostgreSQL is running but not ready." >&2
  return 1
}

if [ "$#" -eq 1 ] && { [ "$1" = "-h" ] || [ "$1" = "--help" ]; }; then
  usage
  exit 0
fi

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  usage >&2
  exit 2
fi

ACTION="$1"
TARGET="${2:-all}"

case "$TARGET" in
  backend|all) ;;
  database|db|postgres) TARGET=database ;;
  *)
    echo "Unknown target: $TARGET" >&2
    usage >&2
    exit 2
    ;;
esac

cd "$APP_DIR"

case "$ACTION" in
  start)
    case "$TARGET" in
      backend) start_backend ;;
      database) start_database ;;
      all)
        start_database
        start_backend
        ;;
    esac
    ;;
  stop)
    case "$TARGET" in
      backend) stop_backend ;;
      database) stop_database ;;
      all)
        stop_backend
        stop_database
        ;;
    esac
    ;;
  status)
    result=0
    case "$TARGET" in
      backend)
        docker compose ps backend
        report_backend_status || result=1
        ;;
      database)
        docker compose ps postgres
        report_database_status || result=1
        ;;
      all)
        docker compose ps backend postgres
        report_database_status || result=1
        report_backend_status || result=1
        ;;
    esac
    exit "$result"
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    usage >&2
    exit 2
    ;;
esac
