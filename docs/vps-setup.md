# VPS Setup Guide: DigitalOcean Droplet

This guide covers initial provisioning of the DigitalOcean droplet that runs
the SummitSafe backend behind nginx, managed by Docker Compose.

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

## 6. Update nginx Domain Name

Replace `your.domain.example.com` in `nginx/nginx.conf` with your actual domain:

```bash
nano /opt/summitsafe/nginx/nginx.conf
# Replace: your.domain.example.com  (appears 3 times)
# With:    api.summitsafe.app        (or your real domain)
```

---

## 7. Bootstrap TLS with Let's Encrypt (First Deploy Only)

nginx will fail to start if the `ssl_certificate` paths don't exist yet. Use
this one-time bootstrap sequence.

**Step 7a — Start nginx with the HTTP block only.**

In `nginx/nginx.conf`, comment out the entire `server { listen 443 ssl; ... }`
block, leaving only the port 80 server block. Then start nginx:

```bash
cd /opt/summitsafe
docker compose up -d nginx
```

**Step 7b — Obtain certificates via certbot.**

```bash
apt-get install -y certbot

certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  -d api.summitsafe.app \
  --email you@example.com \
  --agree-tos \
  --non-interactive
```

Certificates are written to `/etc/letsencrypt/live/api.summitsafe.app/`.

**Step 7c — Restore the HTTPS block and bring up the full stack.**

```bash
nano /opt/summitsafe/nginx/nginx.conf   # Re-enable the HTTPS server block.
docker compose up -d
curl https://api.summitsafe.app/healthz
```

**Step 7d — Set up automatic certificate renewal.**

certbot installs a systemd timer by default (`systemctl status certbot.timer`).
If it's absent, add a cron job:

```bash
crontab -e
# Add:
0 3 * * * certbot renew --quiet && docker compose -f /opt/summitsafe/docker-compose.yml exec -T nginx nginx -s reload
```

---

## 8. First Deploy

```bash
cd /opt/summitsafe
docker compose build backend
docker compose up -d
docker compose logs -f backend
```

Expected startup log line: `Backend Active on 3001`

Smoke test:

```bash
curl https://api.summitsafe.app/healthz
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

**Restart backend only:**
```bash
docker compose -f /opt/summitsafe/docker-compose.yml restart backend
```

**Health check:**
```bash
curl https://api.summitsafe.app/healthz
```

**Enable avalanche debug logging temporarily:**
```bash
# Edit /opt/summitsafe/.env: set DEBUG_AVY=true
docker compose -f /opt/summitsafe/docker-compose.yml restart backend
# Reset when done: set DEBUG_AVY=false and restart again.
```

**Manual deploy (bypasses GitHub Actions):**
```bash
cd /opt/summitsafe
git pull origin main
docker compose build backend
docker compose up -d --no-deps backend
```

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| nginx returns 502 | `docker compose ps` — is backend healthy? Check `docker compose logs backend` |
| Backend container exits immediately | Check `.env` for missing/malformed vars; run `docker compose logs backend` |
| CORS errors in browser | Verify `CORS_ORIGIN` matches the exact frontend origin (scheme+host, no trailing slash) |
| Certificate errors | Run `certbot certificates` on host; verify paths in `nginx.conf` match |
| Deploy workflow fails at SSH step | Verify `DO_SSH_KEY` contains the private key; verify `deploy` user can run `docker compose` without sudo |
| 429 responses from API | Rate limit hit; increase `RATE_LIMIT_MAX_REQUESTS` or widen `RATE_LIMIT_WINDOW_MS` in `.env` |
| Slow / timeout on `/api/safety` | Enable `DEBUG_AVY=true` if avalanche-related; check upstream provider availability |
