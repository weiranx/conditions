#!/usr/bin/env bash
# Follow recent production backend logs. Extra arguments are passed to
# `docker compose logs` (for example: --since 30m).

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

docker compose logs --tail=200 --follow "$@" backend
