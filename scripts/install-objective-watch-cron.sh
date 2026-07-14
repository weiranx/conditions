#!/usr/bin/env bash

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MARKER="# summitsafe-objective-watch"
CRON_FILE="$(mktemp)"
trap 'rm -f "$CRON_FILE"' EXIT

if command -v crontab >/dev/null 2>&1; then
  crontab -l 2>/dev/null | grep -Fv "$MARKER" > "$CRON_FILE" || true
else
  echo "crontab is not installed; Objective Watch scheduling was not configured." >&2
  exit 1
fi

printf '*/5 * * * * %q/scripts/objective-watch-cron.sh >/dev/null 2>&1 %s\n' "$APP_DIR" "$MARKER" >> "$CRON_FILE"
crontab "$CRON_FILE"
echo "Objective Watch cron installed for every five minutes."
