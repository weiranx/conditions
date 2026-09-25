# VPS Setup Guide: DigitalOcean Droplet

This guide covers initial provisioning of the DigitalOcean droplet that runs
the SummitSafe backend. nginx runs on the host (alongside any other services)
and proxies to the backend container managed by Docker Compose.

## Automated Provisioning

`scripts/provision.sh` performs every step in this guide from your own machine
in one command. It is idempotent, so it is also safe to rerun against the live
server to repair drift:

```bash
CLOUDFLARE_API_TOKEN=… ./scripts/provision.sh \
  --host 203.0.113.10 \
  --domain api.example.com \
  --frontend-origin https://app.example.com \
  --email you@example.com
```

It needs SSH access as root (or a passwordless-sudo `--ssh-user`), `node`, and an
authenticated `gh` CLI. In order, it:

1. Creates the GitHub Actions deploy key `~/.ssh/summitsafe_deploy` if missing.
2. Runs `scripts/provision-server.sh` on the droplet over SSH, which installs
   packages, Docker, the firewall and fail2ban; creates the `deploy` user and
   authorizes the deploy key; clones the repository into `/opt/summitsafe`;
   creates `.env` and `mcp/.env`, filling in the CORS origin, email link origin,
   Objective Watch secret and MCP origins without replacing existing values;
   checks DNS; runs `setup-nginx.sh` to write nginx and issue the certificate;
   deploys PostgreSQL on the first run; runs `deploy.sh`; and checks health
   through the public domain.
3. Shows the `DO_SSH_*` secrets (including the pinned host-key fingerprint) and
   the `PRODUCTION_*_URL` variables, and sets them in the repository after you
   confirm (`--yes` skips the prompt, `--no-github` skips this step).
4. Runs `scripts/smoke-test.mjs` against the API, MCP server and frontend.

**DNS:** DNS is on Cloudflare. With a `CLOUDFLARE_API_TOKEN` that has
Zone → DNS → Edit permission, the script creates or updates the A record as
DNS-only (not proxied). Certbot's HTTP challenge and MCP streaming must reach
nginx directly. The token reaches the server over SSH stdin and never appears in
a command line. Without a token, create the A record yourself; the script stops
before TLS until the name resolves to the droplet.

**Secrets it does not create:** API keys (`RESEND_API_KEY`, AI providers) and
the MCP OAuth client settings. The backend refuses to start with
`MCP_PUBLIC_URL` but incomplete `MCP_OAUTH_*` settings, so these are listed at
the end for you to add. After editing `.env`, run
`./scripts/backend-reload-env.sh`.

**Frontend:** the frontend is the Cloudflare Pages project `conditions`.
`deploy.yml` builds and uploads it with Wrangler after the backend release, only
for commits whose CI passed and only when `frontend/` changed since the live
deployment. Cloudflare's own automatic deployments must stay
off (Settings → Build → Branch control), or Cloudflare would ship untested
commits. The job needs the `CLOUDFLARE_API_TOKEN` (Account → Cloudflare Pages →
Edit) and `CLOUDFLARE_ACCOUNT_ID` repository secrets. The build uses
`PRODUCTION_API_URL` as `VITE_API_BASE_URL`, and the repository variable
`CLOUDFLARE_PAGES_PROJECT` overrides the project name.

The sections below document each step for manual setup and troubleshooting.

---

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
RATE_LIMIT_MAX_REQUESTS=1000

# Transactional account email. Verify EMAIL_FROM's domain in Resend first.
RESEND_API_KEY=re_replace_me
EMAIL_FROM="Backcountry Conditions <accounts@mail.your-domain.example>"
APP_BASE_URL=https://your-frontend-domain.example.com

DEBUG_AVY=false

# Choose the preferred provider. Configure multiple keys for automatic
# per-request failover when the preferred provider errors or times out.
AI_PROVIDER=openai
# Used only when no PostgreSQL admin setting exists.
AI_ENABLED=true
# Optional path to a legacy settings file to import once into PostgreSQL.
AI_SETTINGS_FILE=
AI_PRIMARY_TIMEOUT_MS=28000
AI_FAST_TIMEOUT_MS=8000

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-terra
OPENAI_FAST_MODEL=gpt-5.6-luna

ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5
ANTHROPIC_FAST_MODEL=claude-haiku-4-5-20251001

GEMINI_API_KEY=
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
GEMINI_MODEL=gemini-3.7-flash
GEMINI_FAST_MODEL=gemini-3.5-flash-lite
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

On the first backend start after the admin/analytics migration, existing
`ai-settings.json`, `feature-flags.json`, `report-logs.ndjson`,
`ai-usage.ndjson`, and `admin-audit.ndjson` files in the persistent data volume
are imported transactionally. Import checksums prevent duplicate imports. The
legacy files remain in place as a rollback backup, but all new settings,
activity, AI usage/cost records, and admin audit events are written to
PostgreSQL.

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

## 6. Configure nginx and TLS

`setup-nginx.sh` writes the host nginx site, including the MCP server and MCP
OAuth routes, and obtains the Let's Encrypt certificate on its first run. It
first serves the ACME challenge over plain HTTP, then issues the certificate with
certbot's webroot mode, so nginx never has to stop. Renewals reload nginx through
`/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh`.

```bash
cd /opt/summitsafe
sudo ./scripts/setup-nginx.sh --domain api.example.com --email you@example.com
```

Rerunning it reuses the existing certificate, prints a diff against the current
site, keeps a timestamped backup, and restores that backup if `nginx -t` rejects
the result. Preview the change without applying it:

```bash
./scripts/setup-nginx.sh --domain api.example.com --dry-run
```

Pass `--no-mcp` for an API-only server. Certificates issued earlier with
certbot's standalone mode keep their stop/start hooks and continue to renew.
Verify renewal with `certbot renew --dry-run`.

---

## 7. Configure Objective Watch Checks

Objective Watch uses the existing backend and PostgreSQL container; the host cron only triggers the protected worker. Add a random secret to `/opt/summitsafe/.env`:

Generate a value with `openssl rand -hex 32`, then paste the output into the file:

```dotenv
OBJECTIVE_WATCH_CRON_SECRET=replace-with-generated-64-character-value
```

The deploy script installs an idempotent crontab entry every five minutes when this setting is present. To install or verify it manually:

```bash
./scripts/install-objective-watch-cron.sh
crontab -l | grep summitsafe-objective-watch
./scripts/objective-watch-cron.sh
```

The five-minute host trigger checks only objectives whose own due time has arrived. The standard interval defaults to three hours and can be configured from 5 minutes to 24 hours in 5-minute increments; during the final 48 hours, the faster of hourly or the configured interval applies. Expired objectives stop automatically, duplicate plans share one upstream refresh, and each run limits provider concurrency.

After deployment, Admin → Operations → Objective Watch scheduler reports the five-minute heartbeat and latest run. It also controls the standard objective check interval and provides Run now for a one-off owner-authorized cycle. Start and Stop control automatic processing without removing the host cron; retaining the heartbeat lets Admin detect a missing or stalled cron after 15 minutes. Run now does not change Start or Stop state or record a host heartbeat. The raw cron secret is never shown in the browser.

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

When account email delivery is configured, the deploy also starts the
independent `health-monitor` worker. It checks every five minutes and sends
incident, reminder, and recovery emails to `weiranxiong@gmail.com` by default.
Override `HEALTH_ALERT_EMAIL` or the interval settings in `/opt/summitsafe/.env`,
then run `./scripts/backend-reload-env.sh` to apply them. Verify the worker with:

```bash
docker compose ps health-monitor
docker compose logs --tail 50 health-monitor
```

---

## 9. Wire Up GitHub Actions CI/CD

In your GitHub repository: **Settings → Secrets and variables → Actions**

| Secret | Value |
|--------|-------|
| `DO_SSH_HOST` | Droplet IP address or hostname |
| `DO_SSH_USER` | `deploy` |
| `DO_SSH_KEY` | Contents of `~/.ssh/summitsafe_deploy` (private key) |
| `DO_SSH_FINGERPRINT` | `SHA256:…` from `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` |

Optional **variables** (same page, Variables tab) point the post-deploy smoke
test at other origins: `PRODUCTION_API_URL`, `PRODUCTION_FRONTEND_URL`.

Push to `main` to trigger the deploy workflow. Monitor progress in the
**Actions** tab on GitHub.

---

## 10. Ongoing Operations

Run the backend utility scripts from the production checkout:

```bash
cd /opt/summitsafe
./scripts/backend-maintenance.sh status  # Show backend and PostgreSQL health
./scripts/backend-maintenance.sh stop    # Stop backend, then PostgreSQL
./scripts/backend-maintenance.sh start   # Start PostgreSQL, then backend
./scripts/backend-maintenance.sh start backend   # Start only the backend
./scripts/backend-maintenance.sh stop database   # Stop only PostgreSQL
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
docker compose -f /opt/summitsafe/docker-compose.yml logs -f backend health-monitor
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

Deploys are serialized with a checkout-local lock, so a manual release cannot
overlap the GitHub Actions release. Normal deploys must run from a clean `main`
checkout and update it with a fast-forward-only pull that exactly matches
`origin/main`. If tracked hotfix changes are intentionally present, use
`--no-pull` to deploy that exact working tree.

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
