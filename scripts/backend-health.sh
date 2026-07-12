#!/usr/bin/env bash
# Check the production backend container and its local health endpoint.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

docker compose ps backend
curl --fail --silent --show-error http://localhost:3001/healthz
echo
