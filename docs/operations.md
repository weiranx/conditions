# Operations Guide

## Production Topology

Recommended setup:

- Serve `frontend/dist/` from static hosting or a CDN.
- Route `/api/*`, `/healthz`, `/health`, `/api/healthz`, and `/api/health` to the backend via a reverse proxy.
- Keep frontend and backend on the same origin when possible to avoid CORS configuration.
- If cross-origin, set the backend `CORS_ORIGIN` allowlist to include the frontend origin.

**Example nginx proxy block:**

```nginx
location /api/ {
    proxy_pass http://localhost:3001;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location /healthz {
    proxy_pass http://localhost:3001;
}
```

---

## Backend Runtime Hardening

Built-in controls:

| Control | Purpose |
|---|---|
| Helmet security headers | XSS, content-type sniffing, and clickjacking protection |
| Gzip compression | Reduces response payload size |
| API rate limiting | Protects `/api/*` from high-volume polling (configurable via env) |
| Account protection | Salted scrypt password hashes, hashed opaque session/action tokens, expiring single-use email links, HTTP-only cookies, and tighter account-attempt rate limits |
| Request tracing (`X-Request-Id`) | Unique ID per request for log correlation |
| Upstream timeout handling | Prevents hung requests from blocking the event loop |
| Tiered in-memory caching | TTL + stale-while-revalidate caching across all upstream API calls (weather, avalanche, snowpack, AI brief, etc.) |
| Graceful shutdown | Handles `SIGINT`, `SIGTERM`, and uncaught exceptions cleanly |
| Admin access control | The signed-in administrator account gates report logs and all `/api/admin/*` endpoints; every other session receives `404`. |

---

## Health Monitoring

All four aliases return the same response:

```
GET /healthz
GET /health
GET /api/healthz
GET /api/health
```

A healthy response looks like:

```json
{
  "ok": true,
  "service": "summitsafe-backend",
  "env": "production",
  "timestamp": "2026-02-21T14:00:00.000Z"
}
```

Monitor for:
- HTTP `200` status
- `ok: true` in the body
- Timestamp within the last 30 seconds (confirm liveness, not just connectivity)

---

## Logging and Debugging

- Every API request receives a `X-Request-Id` response header. Use this ID to correlate log entries.
- In non-production environments, requests are logged with timing information.
- `5xx` responses are logged in all environments.
- Set `DEBUG_AVY=true` to enable verbose avalanche pipeline debug logs (useful when diagnosing zone-matching or bulletin parsing issues).

---

## Data Freshness and Degradation

The app intentionally degrades gracefully when upstream providers are unavailable.

**Signals in the API response:**

| Field | Meaning |
|---|---|
| `partialData: true` | One or more upstream feeds failed; response is usable but incomplete |
| `apiWarning` | Human-readable description of which feeds failed |
| Per-section `status` | Section-level availability (e.g., `"ok"`, `"unavailable"`, `"stale"`) |
| `coverageStatus` | Coverage quality for spatial data (snowpack, avalanche zone) |
| `generatedTime` | Timestamp of the upstream data used for each section |

**Operational posture:**

- Treat provider outages as reduced-confidence output, not hard downtime.
- Track provider-level error rates separately from overall API uptime.
- A `200` response with `partialData: true` is a degraded success, not a failure.

---

## Common Failure Modes

| Failure | Symptoms | Notes |
|---|---|---|
| NOAA point/forecast request failure | Weather section unavailable; Open-Meteo fallback may fill some fields | NOAA has intermittent availability for remote coordinates |
| Avalanche.org product feed gap | Avalanche section missing or stale | Center-specific fallback scraping is attempted automatically |
| NWS alerts unavailable for future windows | `alerts` section empty | By design — NWS only issues alerts for near-term windows |
| SNOTEL/NOHRSC variability | Snowpack section sparse or unavailable | Availability varies by location, elevation, and season |
| Nominatim rate limiting | Search returns only local results | Nominatim enforces usage policies; heavy automated use will be throttled |
| Preferred AI provider key missing | Requests use the configured fallback, or AI-powered endpoints fail if neither key is set | Set both `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` for automatic failover |
| Account email unavailable | Registration succeeds but verification is not sent; recovery returns `503` | Check `RESEND_API_KEY`, `EMAIL_FROM`, `APP_BASE_URL`, sender-domain verification, and backend logs |
| Admin setting does not survive restart | PostgreSQL is unavailable or its admin migration was not applied | Check `/healthz`, run `npm run db:migrate`, and inspect the `admin_settings` table |
| Both AI providers fail during route analysis | Route analysis returns `500` | Check both providers' key validity, model access, quota, and the configured AI timeouts. |
| Rate limiting (`429`) | Clients receive `429 Too Many Requests` | Configurable via `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX_REQUESTS` |
| Avalanche zone not found | `avalanche.zone` null, score confidence reduced | Polygon match failed; nearest fallback attempted before returning null |

---

## Troubleshooting Runbook

1. **Check the health endpoint** — confirm the backend process is alive and responding.
2. **Re-run the failing request** with the exact same query parameters to confirm reproducibility.
3. **Inspect the response** for `partialData`, `apiWarning`, and per-section `status` fields to identify which upstream feed failed.
4. **Correlate backend logs** using the `X-Request-Id` from the response header.
5. **Enable avalanche debug logging** with `DEBUG_AVY=true` if the issue is in avalanche zone matching or bulletin parsing.
6. **Verify environment variables** — check `CORS_ORIGIN`, `PORT`, timeout settings, cache TTLs, `DATABASE_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `APP_BASE_URL`, `AI_PROVIDER`, `AI_ENABLED`, and both AI provider keys.
7. **Check network egress** — confirm the backend can reach all upstream providers (NOAA, Avalanche.org, NRCS, Open-Meteo).
8. **Check the frontend proxy** — verify the frontend is pointing to the expected backend origin or proxy target.

---

## Release Checklist

Before deploying a new version:

1. `cd backend && npm run test:unit` — all unit tests pass
2. `cd backend && npm run test:integration` — all integration tests pass
3. `cd frontend && npm run typecheck` — no TypeScript errors
4. `cd frontend && npm run build` — production build succeeds
5. Smoke-test the planner: search an objective, reload the forecast, toggle settings/unit preferences
6. Smoke-test report actions: print report, SAT one-liner copy, team brief copy
7. Verify the health endpoint returns `ok: true` in the deployed environment
8. Verify API proxying routes correctly (check at least one `/api/safety` request end-to-end)
9. If the selected AI provider is configured, verify route analysis: load a named peak report and click "Analyze Full Route"
10. If account email is configured, create a password account, verify its email, request a password reset, and confirm the reset signs out existing sessions
