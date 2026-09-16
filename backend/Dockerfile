# ── Stage 1: install production deps ──────────────────────────────────────────
FROM node:20-bookworm-slim AS deps

WORKDIR /app

# Copy lockfile and manifest first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: final runtime image ──────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

# Run as a non-root user for security.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-eccodes wget ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 101 appgroup && useradd --system --uid 100 --gid 101 appuser

WORKDIR /app

# Copy production node_modules from deps stage.
COPY --from=deps /app/node_modules ./node_modules

# Copy application source. .dockerignore excludes node_modules, .env*, test/.
COPY . .

# Pre-create the data directory so appuser can write logs at runtime.
RUN mkdir -p /app/data && chown appuser:appgroup /app/data

USER appuser

EXPOSE 3001

# Docker health check targeting the /healthz endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3001/healthz || exit 1

# Exec form ensures PID 1 is node itself, so SIGTERM reaches the graceful
# shutdown handler in src/server/start-server.js directly.
CMD ["node", "index.js"]
