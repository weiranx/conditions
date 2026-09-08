#!/usr/bin/env bash
# Sent by Actions over SSH; do not resolve APP_DIR relative to this script.
# DEPLOY_SHA must be the main-branch commit whose complete CI run passed.
set -euo pipefail

fail() {
  echo "CI deploy failed: $*" >&2
  exit 1
}

[[ "${DEPLOY_SHA:-}" =~ ^[0-9a-f]{40}$ ]] \
  || fail "DEPLOY_SHA must be a full commit SHA."

APP_DIR="${SUMMITSAFE_APP_DIR:-/opt/summitsafe}"
cd "$APP_DIR"

GIT_DIR="$(git rev-parse --absolute-git-dir)"
LOCK_FILE="${SUMMITSAFE_DEPLOY_LOCK_FILE:-$GIT_DIR/summitsafe-deploy.lock}"
# Share the manual deploy lock across fetch, checkout, build, and health checks.
exec 9>"$LOCK_FILE"
flock -n 9 || fail "Another deployment is already running (lock: $LOCK_FILE)."

current_branch="$(git symbolic-ref --quiet --short HEAD)" \
  || fail "The production checkout is detached; switch it to main."
[ "$current_branch" = main ] || fail "The production checkout must be on main."
if ! git diff --quiet || ! git diff --cached --quiet; then
  fail "Tracked changes are present in the production checkout."
fi

git fetch origin refs/heads/main:refs/remotes/origin/main
remote_head="$(git rev-parse refs/remotes/origin/main)"
if [ "$remote_head" != "$DEPLOY_SHA" ]; then
  echo "==> Skipping superseded commit $DEPLOY_SHA; origin/main is $remote_head."
  exit 0
fi

# Fast-forward only: never reset host edits, deploy a newer untested commit, or
# roll production back when an older CI run finishes after a newer release.
git merge --ff-only "$DEPLOY_SHA"
[ "$(git rev-parse HEAD)" = "$DEPLOY_SHA" ] \
  || fail "The production checkout does not match the tested commit."

echo "==> Releasing tested commit $DEPLOY_SHA"
# deploy.sh recognizes the inherited descriptor and holds it through readiness.
SUMMITSAFE_DEPLOY_LOCK_FD=9 exec bash "$APP_DIR/scripts/deploy.sh" --no-pull --no-nginx
