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

# Secret key required to access the /api/report-logs endpoint and the logs UI.
# Generate a strong random value, e.g.: openssl rand -hex 32
# Leave blank to disable protection (not recommended in production).
LOGS_SECRET=changeit

DEBUG_AVY=false

# Choose the preferred provider. Configure both keys for automatic per-request
# failover when the preferred provider errors or times out.
AI_PROVIDER=openai
# Used when no persisted admin setting exists. Admin changes are written to
# backend/data/ai-settings.json by default and survive process restarts.
AI_ENABLED=true
# Optional absolute path override for the persisted runtime settings file.
AI_SETTINGS_FILE=
AI_PRIMARY_TIMEOUT_MS=28000
AI_FAST_TIMEOUT_MS=8000

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-terra
OPENAI_FAST_MODEL=gpt-5.6-luna

ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5
ANTHROPIC_FAST_MODEL=claude-haiku-4-5-20251001
```

### Deploy PostgreSQL

Run the database deployment as the `deploy` user after creating `.env`:

```bash
cd /opt/summitsafe
./scripts/deploy-postgres.sh
```

On its first run, the script generates a dedicated database name, application
user, 256-bit password, and `DATABASE_URL` in `/opt/summitsafe/.env`. It then
starts PostgreSQL, verifies password authentication, builds the backend, applies
versioned database migrations, recreates the backend with the new environment,
and verifies `/healthz` reports an active database connection. Rerunning the
script reuses the credentials and persistent Docker volume; it does not
reinitialize or delete data.

Normal backend deployments also apply pending migrations before recreating the
backend whenever `DATABASE_URL` is configured. A migration failure stops the
deployment before the running backend is replaced.

PostgreSQL has no published host port. Other Compose services connect privately
at `postgres:5432`; do not add a public `5432` firewall rule. To inspect the
service without exposing it:

```bash
docker compose ps postgres
docker compose logs --tail 100 postgres
docker compose exec postgres psql \
  --username "$(sed -n 's/^POSTGRES_USER=//p' .env)" \
  --dbname "$(sed -n 's/^POSTGRES_DB=//p' .env)"
```

The Docker volume protects data across container recreation, but it is not a
backup. Before storing user or billing data, schedule encrypted `pg_dump`
backups to storage outside this Droplet and test a restore.

---

## 6. Obtain a TLS Certificate (First Deploy Only)

The nginx site config references cert files that must exist before it can load.
Use certbot's standalone mode — it briefly binds port 80 itself, so nginx must
be stopped first.

```bash
# Install certbot.
apt-get install -y certbot

# Stop nginx so certbot can bind port 80.
systemctl stop nginx

# Obtain the certificate.
certbot certonly \
  --standalone \
  -d api.example.com \
  --email you@example.com \
  --agree-tos \
  --non-interactive

# Restart nginx.
systemctl start nginx
```

Set up renewal hooks so future automatic renewals stop/start nginx around the
ACME challenge:

```bash
echo "systemctl stop nginx" \
  | tee /etc/letsencrypt/renewal-hooks/pre/stop-nginx.sh
echo "systemctl start nginx" \
  | tee /etc/letsencrypt/renewal-hooks/post/start-nginx.sh
chmod +x /etc/letsencrypt/renewal-hooks/pre/stop-nginx.sh \
         /etc/letsencrypt/renewal-hooks/post/start-nginx.sh
```

Certbot installs a systemd timer by default (`systemctl status certbot.timer`).
If it's absent, add a cron job:

```bash
crontab -e
# Add:
0 3 * * * certbot renew --quiet
```

Dry-run to verify the renewal hooks work:

```bash
certbot renew --dry-run
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

Run the backend utility scripts from the production checkout:

```bash
cd /opt/summitsafe
./scripts/backend-health.sh      # Show container status and check /healthz
./scripts/backend-logs.sh        # Follow the latest 200 backend log lines
./scripts/backend-restart.sh     # Restart the existing backend container
./scripts/backend-reload-env.sh  # Recreate the container and reload .env
```

Additional Docker Compose log options can be passed through, for example
`./scripts/backend-logs.sh --since 30m`. Use `backend-reload-env.sh` after
editing `/opt/summitsafe/.env`; a normal container restart does not reload the
Compose environment file.

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
