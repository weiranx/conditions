#!/usr/bin/env bash
# Recreate the production backend so Docker Compose reloads .env.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

read_env_value() {
  local key="$1"
  local env_file="$2"
  awk -v target="$key" '
    function trim(value) {
      sub(/^[[:space:]]+/, "", value)
      sub(/[[:space:]]+$/, "", value)
      return value
    }
    {
      sub(/\r$/, "")
      line = trim($0)
      sub(/^export[[:space:]]+/, "", line)
      separator = index(line, "=")
      if (separator == 0 || trim(substr(line, 1, separator - 1)) != target) next

      value = trim(substr(line, separator + 1))
      quote = substr(value, 1, 1)
      if (quote == "\"" || quote == "\047") {
        value = substr(value, 2)
        closing = index(value, quote)
        value = closing > 0 ? substr(value, 1, closing - 1) : ""
      } else if (substr(value, 1, 1) == "#") {
        value = ""
      } else {
        sub(/[[:space:]]+#.*$/, "", value)
      }
      resolved = trim(value)
      found = 1
    }
    END {
      if (found) print resolved
    }
  ' "$env_file"
}

health_monitor_env_ready() {
  local env_file="$1"
  local resend_api_key email_from app_base_url
  [ -r "$env_file" ] || return 1

  resend_api_key="$(read_env_value RESEND_API_KEY "$env_file")"
  email_from="$(read_env_value EMAIL_FROM "$env_file")"
  app_base_url="$(read_env_value APP_BASE_URL "$env_file")"

  [ -n "$resend_api_key" ] \
    && [ -n "$email_from" ] \
    && [[ "$app_base_url" =~ ^https?://(\[[0-9A-Fa-f:]+\]|[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?)(:[0-9]{1,5})?(/[^[:space:]]*)?$ ]]
}

if [ "${1:-}" = "--validate-health-monitor-env" ]; then
  if health_monitor_env_ready "${2:-.env}"; then
    exit 0
  fi
  exit 1
fi

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

if health_monitor_env_ready .env; then
  echo "==> Recreating health monitor with current .env..."
  docker compose up -d --force-recreate --no-deps health-monitor
  health_monitor_ready=false
  for attempt in {1..10}; do
    if docker compose ps --status running --services health-monitor 2>/dev/null \
      | grep -Fxq 'health-monitor'; then
      health_monitor_ready=true
      break
    fi
    sleep 1
  done
  if [ "$health_monitor_ready" != true ]; then
    echo "Health monitor did not remain running after recreation." >&2
    docker compose ps health-monitor >&2 || true
    exit 1
  fi
else
  echo "==> Health alerting disabled (RESEND_API_KEY, EMAIL_FROM, and APP_BASE_URL are required)."
  docker compose stop health-monitor >/dev/null 2>&1 || true
fi

echo "==> Backend is healthy and .env has been reloaded."
