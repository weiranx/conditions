# Operations Guide

## Production Topology

Recommended setup:

- Serve `frontend/dist` from static hosting or CDN.
- Route `/api/*`, `/healthz`, `/health`, `/api/healthz`, and `/api/health` to backend.
- Keep frontend and backend same-origin when possible.
- If cross-origin, set backend `CORS_ORIGIN` allowlist.

## Backend Runtime Hardening

Built-in controls:

- Helmet security headers
- Gzip compression
- API rate limiting (`/api/*`)
- Request tracing with `X-Request-Id`
- External provider timeout handling
- Avalanche map-layer caching
- Graceful shutdown (`SIGINT`, `SIGTERM`, uncaught exception handling)

## Health Monitoring

Use any of:

- `GET /healthz`
- `GET /health`
- `GET /api/healthz`
- `GET /api/health`

Expected success includes:

- `ok: true`
- `service: "summitsafe-backend"`
- current ISO timestamp

## Logging and Debugging

- Every API request receives a request ID in response headers.
- In non-production, requests are logged with timing.
- 5xx responses are logged in all environments.
- Set `DEBUG_AVY=true` to enable avalanche pipeline debug logs.

## Data Freshness and Degradation

The app intentionally degrades to partial output when some providers fail.

Signals:

- `partialData: true` in `/api/safety` response
- `apiWarning` with failure context
- Per-section status fields (`status`, `coverageStatus`, `generatedTime`)

Operationally:

- Treat provider outages as reduced-confidence output, not hard downtime.
- Track provider-level error rates separately from API uptime.

## Common Failure Modes

- NOAA point/forecast request failures
- Avalanche.org product map or detail feed gaps
- NWS alerts unavailable for future time windows (by design)
- SNOTEL/NOHRSC availability variability by location and season
- Geocoding fallback returning local-only results
- API throttling for heavy automated polling (`429` from `/api/*`)

## Troubleshooting Runbook

1. Check backend health endpoint.
2. Re-run a failing `/api/safety` request with same query params.
3. Inspect response for `partialData`, `apiWarning`, and section statuses.
4. Check backend logs by request ID (`X-Request-Id`).
5. Enable `DEBUG_AVY=true` if avalanche-specific issue.
6. Verify environment variables and network egress to upstream providers.
7. Verify frontend is pointing at expected backend origin/proxy.

## Release Checklist

1. `backend`: `npm run test:unit` and `npm run test:integration`
2. `frontend`: `npm run typecheck` and `npm run build`
3. Smoke-test planner: search, forecast reload, settings/unit toggles
4. Smoke-test report actions: print, SAT line copy, team brief copy
5. Verify health endpoint and API proxying in deployed environment
