# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy lockfile and manifest first for layer caching.
COPY package.json package-lock.json ./
# Install ALL dependencies including devDeps for compilation
RUN npm ci

# Copy application source
COPY . .

# Build the TypeScript code
RUN npm run build

# ── Stage 2: final runtime image ──────────────────────────────────────────────
FROM node:20-alpine AS runner

# Run as a non-root user for security.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy production node_modules only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled code from builder
COPY --from=builder /app/dist ./dist
# Copy peaks.json which is required at runtime
COPY --from=builder /app/peaks.json ./dist/peaks.json

# Pre-create the data directory so appuser can write logs at runtime.
RUN mkdir -p /app/data && chown appuser:appgroup /app/data

USER appuser

EXPOSE 3001

# Docker health check targeting the /healthz endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3001/healthz || exit 1

# Run the compiled index.js
CMD ["node", "dist/index.js"]
