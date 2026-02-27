#!/usr/bin/env bash
# setup-nginx.sh — creates and enables the summitsafe nginx site config.
# Run once on the VPS after initial provisioning.
#
# Usage:
#   sudo ./scripts/setup-nginx.sh --domain api.example.com

set -euo pipefail

DOMAIN=""

for arg in "$@"; do
  case $arg in
    --domain=*) DOMAIN="${arg#*=}" ;;
    --domain)   DOMAIN="${2:-}"; shift ;;
    *) echo "Unknown option: $arg" && exit 1 ;;
  esac
done

if [ -z "$DOMAIN" ]; then
  echo "Error: --domain is required"
  echo "Usage: sudo $0 --domain api.example.com"
  exit 1
fi

SITES_AVAILABLE="/etc/nginx/sites-available/summitsafe"
SITES_ENABLED="/etc/nginx/sites-enabled/summitsafe"

echo "==> Writing $SITES_AVAILABLE"

cat > "$SITES_AVAILABLE" <<EOF
server {
    listen 443 ssl;
    server_name ${DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    add_header Strict-Transport-Security "max-age=15768000" always;

    proxy_set_header Host              \$host;
    proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    # /api/safety makes multiple upstream calls; allow up to 30s.
    proxy_read_timeout 30s;

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
    }

    location /healthz {
        proxy_pass http://127.0.0.1:3001;
    }

    location /health {
        proxy_pass http://127.0.0.1:3001;
    }
}

server {
    listen 80;
    server_name ${DOMAIN};

    # Allow certbot ACME challenges over HTTP.
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}
EOF

if [ ! -L "$SITES_ENABLED" ]; then
  echo "==> Enabling site (symlink)"
  ln -s "$SITES_AVAILABLE" "$SITES_ENABLED"
else
  echo "==> Site already enabled, skipping symlink"
fi

echo "==> Testing nginx config..."
nginx -t

echo "==> Reloading nginx..."
systemctl reload nginx

echo "==> Done. Nginx is now proxying ${DOMAIN} → localhost:3001"
echo ""
echo "Next: obtain a TLS certificate if you haven't already:"
echo "  certbot certonly --webroot --webroot-path /var/www/certbot -d ${DOMAIN}"
