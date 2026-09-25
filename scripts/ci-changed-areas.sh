#!/usr/bin/env bash
# ci-changed-areas.sh — which CI jobs have inputs that changed since BASE.
# Prints one `area=true|false` line per area for $GITHUB_OUTPUT.
#
# Usage: scripts/ci-changed-areas.sh BASE [HEAD]
#
# CI errs toward running: an empty or unknown BASE, or a change to CI itself,
# marks every area changed.
set -euo pipefail

base="${1:-}"
head="${2:-HEAD}"

# Paths each job's result depends on. Keep these in step with imports that
# cross directories.
area_paths() {
  case "$1" in
    # The health monitor tests run scripts/backend-reload-env.sh.
    backend)  echo "backend scripts/backend-reload-env.sh" ;;
    # UI and mock API tests import backend/src/utils.
    frontend) echo "frontend backend/src" ;;
    # The MCP OAuth tests run the backend's OAuth service and migrations.
    mcp)      echo "mcp backend" ;;
    pipeline) echo ".github scripts" ;;
  esac
}

everything=false
if [ -z "$base" ] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  echo "==> No comparable base commit; running every job." >&2
  everything=true
elif ! git diff --quiet "$base" "$head" -- .github/workflows/ci.yml scripts/ci-changed-areas.sh; then
  echo "==> CI itself changed; running every job." >&2
  everything=true
fi

for area in backend frontend mcp pipeline; do
  changed=true
  # git diff exits 1 for changes and >1 for errors; both run the job.
  # shellcheck disable=SC2046 # area_paths is a fixed list of plain paths.
  if [ "$everything" = false ] && git diff --quiet "$base" "$head" -- $(area_paths "$area"); then
    changed=false
  fi
  echo "$area=$changed"
done
