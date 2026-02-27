# VPS Setup Guide: DigitalOcean Droplet

This guide covers initial provisioning of the DigitalOcean droplet that runs
the SummitSafe backend. nginx runs on the host (alongside any other services)
and proxies to the backend container managed by Docker Compose.

## Prerequisites

- A DigitalOcean droplet running **Ubuntu 22.04 LTS** (minimum 1 GB RAM / 1 vCPU; 2 GB / 2 vCPU recommended).
- A domain name with an **A record** pointing to the droplet's IP address.
- SSH access as root or a sudo-capable user.

---

## 1. Initial Droplet Hardening

```bash
apt-get update && apt-get upgrade -y
apt-get install -y curl git ufw fail2ban

# Firewall: allow SSH, HTTP, HTTPS only.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

systemctl enable --now fail2ban
```

---

## 2. Create a Dedicated Deploy User

Never run the application as root. The `deploy` user owns the application files
and is the SSH target for GitHub Actions.

```bash
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy

# Install the deploy user's SSH public key.
mkdir -p /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
echo "ssh-ed25519 AAAA...your-public-key... github-actions" \
  >> /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
```

Generate the key pair (run locally, not on the VPS):

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/summitsafe_deploy
# Add summitsafe_deploy.pub to the droplet (line above).
# Add the contents of summitsafe_deploy (private key) to GitHub Secrets as DO_SSH_KEY.
```

---

## 3. Install Docker and Docker Compose

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
systemctl enable --now docker

# Verify (Docker Compose v2 is bundled with Docker Engine 23+).
docker --version
docker compose version
```

---

## 4. Clone the Repository

```bash
su - deploy
sudo mkdir -p /opt/summitsafe
sudo chown deploy:deploy /opt/summitsafe
git clone git@github.com:YOUR_ORG/YOUR_REPO.git /opt/summitsafe
cd /opt/summitsafe
```

If the repository is private, add the deploy user's SSH public key as a
GitHub Deploy Key (Settings → Deploy keys → Add deploy key, read-only):

```bash
# As the deploy user on the VPS:
ssh-keygen -t ed25519 -C "summitsafe-vps-deploy-key" -f ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub
# Paste the output into GitHub as a Deploy Key.
```

---

## 5. Configure Environment Variables

The production `.env` lives at `/opt/summitsafe/.env` and is **never committed
to git**. Create it from the template:

```bash
cd /opt/summitsafe
cp backend/.env.example .env
chmod 600 .env
nano .env
```

Fill in production values:

```ini
NODE_ENV=production
PORT=3001

# Comma-separated frontend origins. No trailing slash.
# Must match exactly what the browser sends in the Origin header.
# Example: https://summitsafe.netlify.app,https://www.summitsafe.app
CORS_ORIGIN=https://your-frontend-domain.example.com

REQUEST_TIMEOUT_MS=9000
AVALANCHE_MAP_LAYER_TTL_MS=600000
SNOTEL_STATION_CACHE_TTL_MS=43200000
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=300
DEBUG_AVY=false
```

---

## 6. Obtain a TLS Certificate (First Deploy Only)

The nginx site config references cert files that must exist before it can load.
Get the certificate first using a temporary minimal config for the ACME challenge.

```bash
# Install certbot.
apt-get install -y certbot

# Create a minimal nginx config just for the ACME challenge.
cat > /etc/nginx/sites-available/summitsafe-bootstrap <<'EOF'
server {
    listen 80;
    server_name api.example.com;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 404; }
}
EOF

mkdir -p /var/www/certbot
ln -s /etc/nginx/sites-available/summitsafe-bootstrap /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Obtain the certificate.
certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  -d api.example.com \
  --email you@example.com \
  --agree-tos \
  --non-interactive

# Clean up the bootstrap config.
rm /etc/nginx/sites-enabled/summitsafe-bootstrap
rm /etc/nginx/sites-available/summitsafe-bootstrap
```

Set up automatic renewal — certbot installs a systemd timer by default
(`systemctl status certbot.timer`). If it's absent, add a cron job:

```bash
crontab -e
# Add:
0 3 * * * certbot renew --quiet && systemctl reload nginx
```

---

## 7. Configure Host nginx

Run the setup script, which writes the nginx site config and reloads nginx:

```bash
cd /opt/summitsafe
sudo ./scripts/setup-nginx.sh --domain api.example.com
```

This creates `/etc/nginx/sites-available/summitsafe`, symlinks it into
`sites-enabled`, and reloads nginx. Verify:

```bash
curl -I https://api.example.com/healthz
# Should get a 502 at this point — backend isn't running yet. That's expected.
```

---

## 8. First Deploy

```bash
cd /opt/summitsafe
./scripts/deploy.sh
```

Expected output ends with:
```
==> Deploy complete.
```

Smoke test:

```bash
curl https://api.example.com/healthz
# {"ok":true,"service":"summitsafe-backend","timestamp":"..."}
```

---

## 9. Wire Up GitHub Actions CI/CD

In your GitHub repository: **Settings → Secrets and variables → Actions**

| Secret | Value |
|--------|-------|
| `DO_SSH_HOST` | Droplet IP address or hostname |
| `DO_SSH_USER` | `deploy` |
| `DO_SSH_KEY` | Contents of `~/.ssh/summitsafe_deploy` (private key) |

Push to `main` to trigger the deploy workflow. Monitor progress in the
**Actions** tab on GitHub.

---

## 10. Ongoing Operations

**View live logs:**
```bash
docker compose -f /opt/summitsafe/docker-compose.yml logs -f backend
```

**Health check:**
```bash
curl https://api.example.com/healthz
```

**Manual deploy (bypasses GitHub Actions):**
```bash
cd /opt/summitsafe
./scripts/deploy.sh

# Skip git pull (e.g. deploy current working tree):
./scripts/deploy.sh --no-pull

# Skip rebuild (e.g. only .env changed):
./scripts/deploy.sh --no-build
```

**Enable avalanche debug logging temporarily:**
```bash
# Edit /opt/summitsafe/.env: set DEBUG_AVY=true
./scripts/deploy.sh --no-pull --no-build
# Reset when done: set DEBUG_AVY=false and repeat.
```

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| nginx returns 502 | `docker compose ps` — is backend healthy? Check `docker compose logs backend` |
| Backend container exits immediately | Check `.env` for missing/malformed vars; run `docker compose logs backend` |
| CORS errors in browser | Verify `CORS_ORIGIN` matches the exact frontend origin (scheme+host, no trailing slash) |
| Certificate errors | Run `certbot certificates`; verify domain in `/etc/nginx/sites-available/summitsafe` matches |
| Deploy workflow fails at SSH step | Verify `DO_SSH_KEY` contains the private key; verify `deploy` user is in the `docker` group |
| 429 responses from API | Rate limit hit; increase `RATE_LIMIT_MAX_REQUESTS` or widen `RATE_LIMIT_WINDOW_MS` in `.env` |
| Slow / timeout on `/api/safety` | Enable `DEBUG_AVY=true` if avalanche-related; check upstream provider availability |
