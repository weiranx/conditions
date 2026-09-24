#!/usr/bin/env bash
# setup-nginx.sh — writes the summitsafe nginx site (API + MCP) and obtains its
# Let's Encrypt certificate. Safe to rerun: an existing certificate is reused,
# the previous site file is backed up, and a config that fails `nginx -t` is
# rolled back before nginx reloads.
#
# Usage (as root on the VPS):
#   sudo ./scripts/setup-nginx.sh --domain api.example.com --email you@example.com
#
# Options:
#   --domain DOMAIN  API hostname served by this droplet (required)
#   --email EMAIL    Let's Encrypt account email (required to issue a certificate)
#   --no-mcp         Omit the MCP server and MCP OAuth routes
#   --dry-run        Print the diff against the current site file and exit
#   --help           Show usage

set -euo pipefail

DOMAIN=""
EMAIL=""
WITH_MCP=true
DRY_RUN=false

SITES_AVAILABLE="${SUMMITSAFE_NGINX_SITE:-/etc/nginx/sites-available/summitsafe}"
SITES_ENABLED="/etc/nginx/sites-enabled/summitsafe"
ACME_ROOT=/var/www/certbot

usage() {
  sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

fail() {
  echo "nginx setup failed: $*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --domain=*) DOMAIN="${1#*=}" ;;
    --domain)   DOMAIN="${2:-}"; shift ;;
    --email=*)  EMAIL="${1#*=}" ;;
    --email)    EMAIL="${2:-}"; shift ;;
    --no-mcp)   WITH_MCP=false ;;
    --dry-run)  DRY_RUN=true ;;
    --help|-h)  usage; exit 0 ;;
    *) usage >&2; fail "Unknown option: $1" ;;
  esac
  shift
done

[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] \
  || fail "--domain must be a hostname such as api.example.com."

CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"

# Port 80 serves ACME challenges (for issuing and renewing) and redirects the
# rest to HTTPS once the certificate exists.
http_server() {
  local fallback="$1"
  cat <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${ACME_ROOT};
    }

    location / {
        ${fallback}
    }
}
EOF
}

https_server() {
  cat <<EOF
server {
    listen 443 ssl;
    server_name ${DOMAIN};

    ssl_certificate     ${CERT_DIR}/fullchain.pem;
    ssl_certificate_key ${CERT_DIR}/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    add_header Strict-Transport-Security "max-age=15768000" always;

    proxy_set_header Host              \$host;
    proxy_set_header X-Real-IP         \$remote_addr;
    proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    # /api/safety makes multiple upstream calls; allow up to 30s.
    proxy_read_timeout 30s;

    # Route analysis makes multiple parallel safety calls + AI provider calls; needs more time.
    location /api/route-analysis {
        proxy_pass http://127.0.0.1:3001;
        proxy_read_timeout 120s;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
    }

    location /healthz {
        proxy_pass http://127.0.0.1:3001;
    }

    location /health {
        proxy_pass http://127.0.0.1:3001;
    }
EOF
  if [ "$WITH_MCP" = true ]; then
    cat <<'EOF'

    # MCP server (mcp/compose.yaml). Streamed responses must not be buffered.
    # OAuth codes and tokens travel in these URLs, so none of them are logged.
    location ^~ /mcp {
        proxy_pass http://127.0.0.1:8104;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        access_log off;
    }

    location ^~ /.well-known/oauth-protected-resource {
        proxy_pass http://127.0.0.1:8104;
        access_log off;
    }

    location = /.well-known/oauth-authorization-server {
        proxy_pass http://127.0.0.1:3001/api/auth/mcp/metadata;
        access_log off;
    }

    location ^~ /api/auth/mcp/ {
        proxy_pass http://127.0.0.1:3001;
        access_log off;
    }

    # Compatibility aliases for connections created before the /api/auth/mcp/ endpoints.
    location = /authorize {
        proxy_pass http://127.0.0.1:3001/api/auth/mcp/authorize;
        access_log off;
    }

    location = /oauth/token {
        proxy_pass http://127.0.0.1:3001/api/auth/mcp/token;
        access_log off;
    }
EOF
  fi
  echo "}"
}

render_site() {
  echo "# Managed by scripts/setup-nginx.sh — edits are replaced on the next run."
  https_server
  echo
  http_server "return 301 https://\$host\$request_uri;"
}

if [ "$DRY_RUN" = true ]; then
  if [ -f "$SITES_AVAILABLE" ]; then
    diff -u "$SITES_AVAILABLE" <(render_site) && echo "==> $SITES_AVAILABLE is already up to date."
  else
    render_site
  fi
  exit 0
fi

[ "$(id -u)" -eq 0 ] || fail "Run as root (sudo)."
command -v nginx >/dev/null 2>&1 || fail "nginx is not installed."

backup=""
install_site() {
  local content="$1"
  if [ -f "$SITES_AVAILABLE" ] && [ -z "$backup" ]; then
    backup="${SITES_AVAILABLE}.bak.$(date +%Y%m%d%H%M%S)"
    cp -p "$SITES_AVAILABLE" "$backup"
    echo "==> Backed up the current site to $backup"
  fi
  printf '%s\n' "$content" > "$SITES_AVAILABLE"
  [ -L "$SITES_ENABLED" ] || ln -sfn "$SITES_AVAILABLE" "$SITES_ENABLED"

  if ! nginx -t; then
    if [ -n "$backup" ]; then
      cp -p "$backup" "$SITES_AVAILABLE"
      echo "==> Restored $backup" >&2
    else
      rm -f "$SITES_ENABLED" "$SITES_AVAILABLE"
    fi
    fail "nginx rejected the generated configuration; nothing was reloaded."
  fi
  systemctl reload nginx
}

mkdir -p "$ACME_ROOT"

if [ ! -f "$CERT_DIR/fullchain.pem" ]; then
  [ -n "$EMAIL" ] || fail "No certificate exists for $DOMAIN; pass --email to issue one."
  command -v certbot >/dev/null 2>&1 || fail "certbot is not installed."
  systemctl is-active --quiet nginx || systemctl start nginx

  # The HTTPS server cannot load before its certificate exists, so serve the
  # ACME challenge over plain HTTP first.
  echo "==> Serving ACME challenges for $DOMAIN over HTTP..."
  install_site "$(http_server 'return 503;')"

  echo "==> Requesting a Let's Encrypt certificate for $DOMAIN..."
  certbot certonly --webroot --webroot-path "$ACME_ROOT" \
    --domain "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive --no-eff-email
else
  echo "==> Reusing the existing certificate in $CERT_DIR"
fi

# Renewals reload nginx so it serves the new certificate. Certificates issued
# by the older standalone setup keep their stop/start hooks and still renew.
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

echo "==> Writing $SITES_AVAILABLE"
if [ -f "$SITES_AVAILABLE" ] && ! diff -u "$SITES_AVAILABLE" <(render_site); then
  echo "==> (diff above: current site → generated site)"
fi
install_site "$(render_site)"

if [ "$WITH_MCP" = true ]; then
  echo "==> Done. nginx proxies https://${DOMAIN} → backend :3001 and MCP :8104"
else
  echo "==> Done. nginx proxies https://${DOMAIN} → backend :3001"
fi
