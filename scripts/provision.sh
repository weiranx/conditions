#!/usr/bin/env bash
# provision.sh — one command, run from your machine, that sets up production on
# a droplet: provisions the server over SSH (scripts/provision-server.sh), wires
# GitHub Actions to deploy to it, and smoke-tests the public URLs. Safe to rerun
# against the live server.
#
# Example:
#   CLOUDFLARE_API_TOKEN=… ./scripts/provision.sh --host 203.0.113.10 \
#     --domain api.example.com --frontend-origin https://app.example.com \
#     --email you@example.com
#
# Run with --help for the options.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST=""
SSH_USER="root"
DOMAIN=""
FRONTEND_ORIGIN=""
EMAIL=""
CI_KEY="$HOME/.ssh/summitsafe_deploy"
DEPLOY_USER="deploy"
CONFIGURE_GITHUB=true
ASSUME_YES=false
server_args=()

usage() {
  cat <<'USAGE'
Usage: scripts/provision.sh --host HOST --domain DOMAIN --frontend-origin URL [options]

Options:
  --host HOST             Droplet IP or hostname to SSH into (required)
  --domain DOMAIN         API hostname for the droplet (required)
  --frontend-origin URL   Frontend origin, e.g. https://app.example.com (required)
  --email EMAIL           Let's Encrypt account email (required for a new certificate)
  --ssh-user USER         SSH login with root or passwordless sudo (default: root)
  --ci-key PATH           GitHub Actions deploy key; created if missing (default: ~/.ssh/summitsafe_deploy)
  --deploy-user NAME      Server account that runs deployments (default: deploy)
  --no-github             Do not set the repository's Actions secrets and variables
  --yes                   Update GitHub secrets without asking
  --no-mcp, --skip-dns-check, --repo URL, --app-dir DIR, --public-ip IP
                          Passed to scripts/provision-server.sh

Environment:
  CLOUDFLARE_API_TOKEN    Creates/updates the DNS A record (sent over SSH stdin, never as an argument)
USAGE
}

fail() {
  echo "Provisioning failed: $*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host)            HOST="${2:-}"; shift ;;
    --ssh-user)        SSH_USER="${2:-}"; shift ;;
    --domain)          DOMAIN="${2:-}"; shift ;;
    --frontend-origin) FRONTEND_ORIGIN="${2:-}"; shift ;;
    --email)           EMAIL="${2:-}"; shift ;;
    --ci-key)          CI_KEY="${2:-}"; shift ;;
    --deploy-user)     DEPLOY_USER="${2:-}"; server_args+=(--deploy-user "$DEPLOY_USER"); shift ;;
    --no-github)       CONFIGURE_GITHUB=false ;;
    --yes|-y)          ASSUME_YES=true ;;
    --no-mcp|--skip-dns-check) server_args+=("$1") ;;
    --repo|--app-dir|--public-ip) server_args+=("$1" "${2:-}"); shift ;;
    --help|-h)         usage; exit 0 ;;
    *) fail "Unknown option: $1 (see --help)" ;;
  esac
  shift
done

[ -n "$HOST" ] || fail "--host is required."
[ -n "$DOMAIN" ] || fail "--domain is required."
[ -n "$FRONTEND_ORIGIN" ] || fail "--frontend-origin is required."
for command in ssh ssh-keygen ssh-keyscan node; do
  command -v "$command" >/dev/null 2>&1 || fail "Required command '$command' is not installed."
done

if [ ! -f "$CI_KEY" ]; then
  echo "==> Creating the GitHub Actions deploy key $CI_KEY"
  mkdir -p "$(dirname "$CI_KEY")"
  ssh-keygen -q -t ed25519 -N "" -C "summitsafe-github-actions-deploy" -f "$CI_KEY"
fi
[ -f "$CI_KEY.pub" ] || fail "$CI_KEY.pub is missing."

# ${a[@]+…} keeps macOS's bash 3.2 from treating an empty array as unset.
server_args=(--domain "$DOMAIN" --frontend-origin "$FRONTEND_ORIGIN" --ci-public-key "$(cat "$CI_KEY.pub")" ${server_args[@]+"${server_args[@]}"})
[ -z "$EMAIL" ] || server_args+=(--email "$EMAIL")

# ssh joins its arguments into one remote shell command, so quote each one.
remote_command="bash -s --"
for arg in "${server_args[@]}"; do
  remote_command+=" $(printf '%q' "$arg")"
done
[ "$SSH_USER" = root ] || remote_command="sudo $remote_command"

echo "==> Provisioning $SSH_USER@$HOST"
{
  # A secret passed as an argument would be visible in the server's process list.
  if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
    printf 'export CLOUDFLARE_API_TOKEN=%q\n' "$CLOUDFLARE_API_TOKEN"
  fi
  cat "$ROOT/scripts/provision-server.sh"
} | ssh -o ServerAliveInterval=30 "$SSH_USER@$HOST" "$remote_command"

if [ "$CONFIGURE_GITHUB" = true ]; then
  command -v gh >/dev/null 2>&1 || fail "gh is not installed; rerun with --no-github and set the secrets printed above by hand."
  repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
  fingerprint="$(ssh-keyscan -t ed25519 "$HOST" 2>/dev/null | ssh-keygen -lf - | awk '{ print $2 }')"
  [[ "$fingerprint" == SHA256:* ]] || fail "Could not read $HOST's ed25519 host key."

  echo
  echo "==> GitHub Actions settings for $repo:"
  echo "    secrets:   DO_SSH_HOST=$HOST  DO_SSH_USER=$DEPLOY_USER  DO_SSH_KEY=<$CI_KEY>  DO_SSH_FINGERPRINT=$fingerprint"
  echo "    variables: PRODUCTION_API_URL=https://$DOMAIN  PRODUCTION_FRONTEND_URL=$FRONTEND_ORIGIN"
  if [ "$ASSUME_YES" != true ]; then
    read -r -p "Replace these in $repo? [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]] || { echo "==> Left GitHub unchanged."; CONFIGURE_GITHUB=false; }
  fi
  if [ "$CONFIGURE_GITHUB" = true ]; then
    gh secret set DO_SSH_HOST --repo "$repo" --body "$HOST"
    gh secret set DO_SSH_USER --repo "$repo" --body "$DEPLOY_USER"
    gh secret set DO_SSH_KEY --repo "$repo" < "$CI_KEY"
    gh secret set DO_SSH_FINGERPRINT --repo "$repo" --body "$fingerprint"
    gh variable set PRODUCTION_API_URL --repo "$repo" --body "https://$DOMAIN"
    gh variable set PRODUCTION_FRONTEND_URL --repo "$repo" --body "$FRONTEND_ORIGIN"
  fi
fi

echo
smoke_args=(--api "https://$DOMAIN" --frontend "$FRONTEND_ORIGIN")
for arg in "${server_args[@]}"; do
  if [ "$arg" = --no-mcp ]; then smoke_args+=(--no-mcp); fi
done
if ! node "$ROOT/scripts/smoke-test.mjs" "${smoke_args[@]}"; then
  echo "Server provisioning finished, but the public smoke test failed (see above)." >&2
  echo "A new frontend host may still need VITE_API_BASE_URL=https://$DOMAIN and a deploy." >&2
  exit 1
fi
