#!/usr/bin/env bash
# provision-server.sh — takes a fresh Ubuntu droplet to a running, verified
# production server: packages, firewall, deploy user, checkout, .env files,
# DNS, nginx + Let's Encrypt, PostgreSQL, backend, MCP server and cron. Every
# step is idempotent, so rerunning it on the live server only fills in what is
# missing; it never replaces existing secrets or database credentials.
#
# Run as root on the droplet. It needs no checkout, so it can be piped over SSH:
#   ssh root@DROPLET_IP bash -s -- \
#     --domain api.example.com --frontend-origin https://app.example.com \
#     --email you@example.com --ci-public-key "$(cat ~/.ssh/summitsafe_deploy.pub)" \
#     < scripts/provision-server.sh
#
# Run with --help for the options.

set -euo pipefail

DOMAIN=""
FRONTEND_ORIGIN=""
EMAIL=""
CI_PUBLIC_KEY=""
REPO_URL="https://github.com/weiranx/conditions.git"
APP_DIR="/opt/summitsafe"
DEPLOY_USER="deploy"
PUBLIC_IP=""
WITH_MCP=true
CHECK_DNS=true

usage() {
  cat <<'USAGE'
Usage: provision-server.sh --domain DOMAIN --frontend-origin URL [options]

Options:
  --domain DOMAIN          API hostname for this droplet (required)
  --frontend-origin URL    Frontend origin, for CORS and email links (required)
  --email EMAIL            Let's Encrypt account email (required for a new certificate)
  --ci-public-key KEY      Public key GitHub Actions deploys with (added to the deploy user)
  --repo URL               Git repository (default: https://github.com/weiranx/conditions.git)
  --app-dir DIR            Checkout location (default: /opt/summitsafe)
  --deploy-user NAME       Account that owns the checkout and runs Docker (default: deploy)
  --public-ip IP           This droplet's public IPv4 (default: detected)
  --no-mcp                 Do not configure or deploy the MCP server
  --skip-dns-check         Continue even if DNS does not point at this droplet
  --help                   Show usage

Environment:
  CLOUDFLARE_API_TOKEN     When set (Zone:DNS:Edit), creates or updates the A
                           record for --domain as DNS-only. Otherwise the
                           record must already exist.
USAGE
}

step() {
  echo
  echo "==> $*"
}

fail() {
  echo "Provisioning failed: $*" >&2
  exit 1
}

# Everything runs inside main so bash has read the whole script before the
# first command. Piped over `ssh … bash -s`, the script is stdin; main's stdin
# is /dev/null so no child (apt, docker compose exec) can swallow the rest.
main() {
while [ "$#" -gt 0 ]; do
  case "$1" in
    --domain)          DOMAIN="${2:-}"; shift ;;
    --frontend-origin) FRONTEND_ORIGIN="${2:-}"; shift ;;
    --email)           EMAIL="${2:-}"; shift ;;
    --ci-public-key)   CI_PUBLIC_KEY="${2:-}"; shift ;;
    --repo)            REPO_URL="${2:-}"; shift ;;
    --app-dir)         APP_DIR="${2:-}"; shift ;;
    --deploy-user)     DEPLOY_USER="${2:-}"; shift ;;
    --public-ip)       PUBLIC_IP="${2:-}"; shift ;;
    --no-mcp)          WITH_MCP=false ;;
    --skip-dns-check)  CHECK_DNS=false ;;
    --help|-h)         usage; exit 0 ;;
    *) fail "Unknown option: $1 (see --help)" ;;
  esac
  shift
done

[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$ ]] \
  || fail "--domain must be a hostname such as api.example.com."
[[ "$FRONTEND_ORIGIN" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] \
  || fail "--frontend-origin must be an HTTPS origin with no path or trailing slash."
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || fail "--deploy-user is not a valid user name."
[ "$(id -u)" -eq 0 ] || fail "Run as root."
command -v apt-get >/dev/null 2>&1 || fail "This script supports Ubuntu/Debian (apt-get) only."

API_ORIGIN="https://${DOMAIN}"

# Runs a command in the checkout as the deploy user, with that user's HOME so
# Docker and Git read its configuration rather than root's.
# shellcheck disable=SC2016 # $0 and $@ belong to the inner bash.
as_deploy() {
  runuser -u "$DEPLOY_USER" -- env HOME="$DEPLOY_HOME" bash -c 'cd "$0" && exec "$@"' "$APP_DIR" "$@"
}

# Sets KEY in an env file, replacing its first definition in place.
set_env_value() {
  local file="$1" key="$2" value="$3" tmp
  tmp="$(mktemp)"
  awk -v key="$key" -v line="$key=$value" '
    index($0, key "=") == 1 { if (!done) print line; done = 1; next }
    { print }
    END { if (!done) print line }
  ' "$file" > "$tmp"
  cat "$tmp" > "$file"
  rm -f "$tmp"
  echo "    set $key"
}

# Sets KEY unless it already has a real value. Placeholder values copied from
# an .env.example (empty or *.example.com) count as unset.
set_env_default() {
  local current
  current="$(awk -v key="$2" 'index($0, key "=") == 1 { v = substr($0, length(key) + 2) } END { print v }' "$1")"
  current="${current%\"}"; current="${current#\"}"
  if [ -n "$current" ] && [[ "$current" != *example.com* ]]; then
    return 0
  fi
  set_env_value "$@"
}

env_has_value() {
  grep -Eq "^$2=.+$" "$1"
}

# ---------------------------------------------------------------------------
step "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl git ufw fail2ban nginx certbot openssl cron jq

if ! command -v docker >/dev/null 2>&1; then
  step "Installing Docker Engine"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker cron nginx fail2ban >/dev/null
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is not available."

# ---------------------------------------------------------------------------
step "Configuring the firewall (SSH, HTTP, HTTPS)"
# Allow sshd's actual ports so a non-default SSH port cannot lock us out.
ssh_ports="$( (sshd -T 2>/dev/null || true) | awk '$1 == "port" { print $2 }')"
for port in ${ssh_ports:-22} 80 443; do
  ufw allow "$port/tcp" >/dev/null
done
if ufw status | grep -q '^Status: active'; then
  echo "    ufw already active; SSH, HTTP and HTTPS are allowed"
else
  # Enabling ufw on a live host would cut off any other public service.
  other_ports="$( (ss -Hltn 2>/dev/null || true) | awk '{ print $4 }' \
    | grep -Ev '^(127\.|\[::1\]|\[::ffff:127\.)' | sed -E 's/.*:([0-9]+)$/\1/' \
    | grep -Evx "${ssh_ports//$'\n'/|}|22|80|443" | sort -un | tr '\n' ' ' || true)"
  if [ -n "$other_ports" ]; then
    echo "    Warning: ufw left disabled; ports ${other_ports}are listening publicly. Allow them, then run 'ufw enable'." >&2
  else
    ufw --force enable >/dev/null
    echo "    ufw enabled"
  fi
fi

# ---------------------------------------------------------------------------
step "Preparing the $DEPLOY_USER user"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
touch "$DEPLOY_HOME/.ssh/authorized_keys"
chmod 600 "$DEPLOY_HOME/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/.ssh/authorized_keys"
if [ -n "$CI_PUBLIC_KEY" ]; then
  [[ "$CI_PUBLIC_KEY" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-[a-z0-9-]+)\ [A-Za-z0-9+/=]+ ]] \
    || fail "--ci-public-key is not an OpenSSH public key."
  key_body="$(printf '%s' "$CI_PUBLIC_KEY" | awk '{ print $2 }')"
  if grep -Fq "$key_body" "$DEPLOY_HOME/.ssh/authorized_keys"; then
    echo "    CI deploy key already authorized"
  else
    printf '%s\n' "$CI_PUBLIC_KEY" >> "$DEPLOY_HOME/.ssh/authorized_keys"
    echo "    authorized the CI deploy key"
  fi
elif [ ! -s "$DEPLOY_HOME/.ssh/authorized_keys" ]; then
  echo "    Warning: $DEPLOY_USER has no authorized SSH keys; GitHub Actions cannot deploy until --ci-public-key is added." >&2
fi

# ---------------------------------------------------------------------------
step "Checking out $REPO_URL into $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  echo "    existing checkout at $(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown); deploy.sh updates it"
else
  [ ! -e "$APP_DIR" ] || [ -z "$(ls -A "$APP_DIR")" ] || fail "$APP_DIR exists and is not a Git checkout."
  install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"
  runuser -u "$DEPLOY_USER" -- git clone --branch main "$REPO_URL" "$APP_DIR"
fi
chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

# ---------------------------------------------------------------------------
step "Configuring environment files"
BACKEND_ENV="$APP_DIR/.env"
if [ ! -f "$BACKEND_ENV" ]; then
  install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR/backend/.env.example" "$BACKEND_ENV"
  echo "    created $BACKEND_ENV from backend/.env.example"
fi
set_env_default "$BACKEND_ENV" NODE_ENV production
set_env_default "$BACKEND_ENV" CORS_ORIGIN "$FRONTEND_ORIGIN"
set_env_default "$BACKEND_ENV" APP_BASE_URL "$FRONTEND_ORIGIN"
set_env_default "$BACKEND_ENV" OBJECTIVE_WATCH_CRON_SECRET "$(openssl rand -hex 32)"
chmod 600 "$BACKEND_ENV"
chown "$DEPLOY_USER:$DEPLOY_USER" "$BACKEND_ENV"

if [ "$WITH_MCP" = true ]; then
  MCP_ENV="$APP_DIR/mcp/.env"
  if [ ! -f "$MCP_ENV" ]; then
    install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR/mcp/.env.example" "$MCP_ENV"
    echo "    created $MCP_ENV from mcp/.env.example"
    # The example holds the current production origins; point it at this domain.
    # The MCP service calls the API through its public origin, like any client.
    set_env_value "$MCP_ENV" CONDITIONS_API_URL "$API_ORIGIN"
    set_env_value "$MCP_ENV" MCP_PUBLIC_URL "$API_ORIGIN"
  fi
  chown "$DEPLOY_USER:$DEPLOY_USER" "$MCP_ENV"
fi

missing_optional=()
for key in RESEND_API_KEY EMAIL_FROM; do
  env_has_value "$BACKEND_ENV" "$key" || missing_optional+=("$key (account email and health alerts)")
done
if ! env_has_value "$BACKEND_ENV" OPENAI_API_KEY && ! env_has_value "$BACKEND_ENV" ANTHROPIC_API_KEY \
  && ! env_has_value "$BACKEND_ENV" GEMINI_API_KEY; then
  missing_optional+=("OPENAI_API_KEY, ANTHROPIC_API_KEY or GEMINI_API_KEY (AI features)")
fi
# The backend refuses to start with MCP_PUBLIC_URL but incomplete OAuth client
# settings, so this script never writes them; they are listed for the operator.
if [ "$WITH_MCP" = true ] && ! env_has_value "$BACKEND_ENV" MCP_PUBLIC_URL; then
  missing_optional+=("MCP_PUBLIC_URL=$API_ORIGIN, MCP_FRONTEND_ORIGIN=$FRONTEND_ORIGIN and MCP_OAUTH_* (MCP sign-in; see mcp/README.md)")
fi

# ---------------------------------------------------------------------------
detect_public_ip() {
  # DigitalOcean metadata first; otherwise the source address of the default route.
  curl -fsS --max-time 2 http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address 2>/dev/null \
    || ip -4 route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1) }'
}

# The token goes through a config file descriptor, not argv, so it never
# appears in the process list.
cloudflare() {
  curl -fsS --max-time 20 --config <(printf 'header = "Authorization: Bearer %s"\n' "$CLOUDFLARE_API_TOKEN") \
    -H "Content-Type: application/json" "$@"
}

upsert_cloudflare_record() {
  local zone_name="$DOMAIN" zone_id="" record record_id body
  # Walk up the hostname until Cloudflare recognizes a zone (api.x.example.com → x.example.com → example.com).
  while [[ "$zone_name" == *.* ]]; do
    zone_id="$(cloudflare "https://api.cloudflare.com/client/v4/zones?name=${zone_name}" | jq -r '.result[0].id // empty')"
    [ -n "$zone_id" ] && break
    zone_name="${zone_name#*.}"
  done
  [ -n "$zone_id" ] || fail "No Cloudflare zone for $DOMAIN is visible to CLOUDFLARE_API_TOKEN."

  # DNS-only: certbot's HTTP challenge and the MCP stream must reach nginx directly.
  body="$(jq -nc --arg name "$DOMAIN" --arg ip "$PUBLIC_IP" \
    '{type: "A", name: $name, content: $ip, ttl: 300, proxied: false, comment: "summitsafe API (provision-server.sh)"}')"
  record="$(cloudflare "https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records?type=A&name=${DOMAIN}")"
  record_id="$(jq -r '.result[0].id // empty' <<<"$record")"
  if [ -z "$record_id" ]; then
    cloudflare -X POST --data "$body" "https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records" >/dev/null
    echo "    created Cloudflare A record $DOMAIN → $PUBLIC_IP (zone $zone_name)"
  elif [ "$(jq -r '.result[0].content' <<<"$record")" != "$PUBLIC_IP" ] || [ "$(jq -r '.result[0].proxied' <<<"$record")" != false ]; then
    cloudflare -X PATCH --data "$body" "https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records/${record_id}" >/dev/null
    echo "    updated Cloudflare A record $DOMAIN → $PUBLIC_IP (DNS only)"
  else
    echo "    Cloudflare A record already points at $PUBLIC_IP"
  fi
}

resolved_ips() {
  getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{ print $1 }' | sort -u
}

step "Checking DNS for $DOMAIN"
[ -n "$PUBLIC_IP" ] || PUBLIC_IP="$(detect_public_ip || true)"
[[ "$PUBLIC_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Could not detect the public IP; pass --public-ip."
echo "    this droplet: $PUBLIC_IP"
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  upsert_cloudflare_record
fi
if [ "$CHECK_DNS" = true ]; then
  dns_ok=false
  for _ in {1..20}; do
    if [ "$(resolved_ips)" = "$PUBLIC_IP" ]; then
      dns_ok=true
      break
    fi
    [ -n "${CLOUDFLARE_API_TOKEN:-}" ] || break
    sleep 15
  done
  if [ "$dns_ok" != true ]; then
    fail "$DOMAIN resolves to '$(resolved_ips | tr '\n' ' ')', not $PUBLIC_IP.
Create an A record '$DOMAIN → $PUBLIC_IP' (DNS only / not proxied) at your DNS
provider, or set CLOUDFLARE_API_TOKEN to have this script create it, then rerun.
Use --skip-dns-check to continue without a certificate check."
  fi
  echo "    $DOMAIN → $PUBLIC_IP"
fi

# ---------------------------------------------------------------------------
step "Configuring nginx and TLS"
nginx_args=(--domain "$DOMAIN")
[ -n "$EMAIL" ] && nginx_args+=(--email "$EMAIL")
[ "$WITH_MCP" = true ] || nginx_args+=(--no-mcp)
"$APP_DIR/scripts/setup-nginx.sh" "${nginx_args[@]}"

# ---------------------------------------------------------------------------
if env_has_value "$BACKEND_ENV" DATABASE_URL; then
  echo
  echo "==> PostgreSQL already configured; deploy.sh starts it and applies migrations"
else
  step "Deploying PostgreSQL"
  as_deploy ./scripts/deploy-postgres.sh
fi

step "Deploying the latest main (backend, MCP server, health monitor, cron)"
# Pulls main, builds, migrates, restarts with rollback, and installs the cron.
# nginx is reloaded here as root because the deploy user cannot run systemctl.
as_deploy ./scripts/deploy.sh --no-nginx
nginx -t
systemctl reload nginx

# ---------------------------------------------------------------------------
step "Verifying through https://$DOMAIN"
smoke_args=(--api "$API_ORIGIN" --no-safety)
# MCP routes answer only once the backend has its MCP OAuth settings.
if [ "$WITH_MCP" = false ] || ! env_has_value "$BACKEND_ENV" MCP_PUBLIC_URL; then
  smoke_args+=(--no-mcp)
fi
# The backend image carries Node, so the host needs no Node install.
docker run --rm --network host \
  -v "$APP_DIR/scripts/smoke-test.mjs:/smoke-test.mjs:ro" \
  summitsafe-backend:latest node /smoke-test.mjs "${smoke_args[@]}"

# ---------------------------------------------------------------------------
fingerprint="$(ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null | awk '{ print $2 }' || true)"
echo
echo "==> Provisioning complete: $API_ORIGIN"
echo
echo "GitHub → Settings → Secrets and variables → Actions:"
echo "  Secrets:   DO_SSH_HOST=$PUBLIC_IP"
echo "             DO_SSH_USER=$DEPLOY_USER"
echo "             DO_SSH_KEY=<private key matching --ci-public-key>"
if [ -n "$fingerprint" ]; then
  echo "             DO_SSH_FINGERPRINT=$fingerprint"
fi
echo "  Variables: PRODUCTION_API_URL=$API_ORIGIN"
echo "             PRODUCTION_FRONTEND_URL=$FRONTEND_ORIGIN"
echo
echo "Frontend host: build frontend/ with VITE_API_BASE_URL=$API_ORIGIN."
if [ "${#missing_optional[@]}" -gt 0 ]; then
  echo
  echo "Not configured yet in $BACKEND_ENV (add them, then run ./scripts/backend-reload-env.sh):"
  printf '  - %s\n' "${missing_optional[@]}"
fi
}

main "$@" </dev/null
