# ── Stage 1: install production deps ──────────────────────────────────────────
FROM node:24-bookworm-slim AS deps

WORKDIR /app

# Copy lockfile and manifest first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: final runtime image ──────────────────────────────────────────────
FROM node:24-bookworm-slim AS runner

# Reserve the existing volume owner IDs before packages create system accounts.
RUN groupadd --system --gid 101 appgroup && useradd --system --uid 100 --gid 101 appuser

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-eccodes wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy production node_modules from deps stage.
COPY --from=deps /app/node_modules ./node_modules

# Copy application source. .dockerignore excludes node_modules, .env*, test/.
COPY . .

# Pre-create the data directory so appuser can write logs at runtime.
RUN mkdir -p /app/data && chown appuser:appgroup /app/data

USER appuser

# Use the installed versioned library without Debian development tooling.
# The migration step runs through npm; skip its update check in production.
ENV ECMWFLIBS_USED_INSTALLED=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false
RUN python3 -c "import eccodes; print(eccodes.codes_get_api_version())"

EXPOSE 3001

# Docker health check targeting the /healthz endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3001/healthz || exit 1

# Exec form ensures PID 1 is node itself, so SIGTERM reaches the graceful
# shutdown handler in src/server/start-server.js directly.
CMD ["node", "index.js"]
