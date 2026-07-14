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

The `health-monitor` Compose worker checks the internal readiness endpoint every
five minutes by default. It runs independently of the backend, so it can alert
when the backend is unreachable as well as when PostgreSQL or an enabled AI
provider is unavailable. It emails `HEALTH_ALERT_EMAIL` immediately when an
incident opens, sends a reminder every six hours while the service remains
unhealthy, and sends a recovery notice. Incident state is retained in the
`health-monitor-data` volume so ordinary container recreations do not duplicate
alerts. The same volume retains bounded check history and is mounted read-only
into the backend for the owner-only Admin Operations page.

Configure the schedule in `/opt/summitsafe/.env`:

```dotenv
HEALTH_ALERT_EMAIL=weiranxiong@gmail.com
HEALTH_MONITOR_INTERVAL_SECONDS=300
HEALTH_ALERT_REMINDER_SECONDS=21600
HEALTH_MONITOR_HISTORY_LIMIT=2016
```

`RESEND_API_KEY`, `EMAIL_FROM`, and `APP_BASE_URL` must also be configured. The
default `HEALTH_MONITOR_URL=http://backend:3001/healthz` checks the application
and its database from the private Compose network. Set it to the public API
health URL to include nginx, DNS, and TLS in the same check.

---

## Logging and Debugging

- Every API request receives a `X-Request-Id` response header. Use this ID to correlate log entries.
- In non-production environments, requests are logged with timing information.
- `5xx` responses are logged in all environments.
- Set `DEBUG_AVY=true` to enable verbose avalanche pipeline debug logs (useful when diagnosing zone-matching or bulletin parsing issues).
- The host runs `scripts/objective-watch-cron.sh` at minute 7 hourly. Successful runs log an `Objective Watch cron completed` summary from the backend; failures cause the trigger script to exit non-zero.
- The `health-monitor` container logs every check and email transition independently of backend logs.

### Objective Watch scheduling

- Only current Premium accounts are selected by the hourly worker. Free watches remain available in-app and can be refreshed manually from the Watch dashboard.
- Free accounts can keep one active watch and see 14 days of manual check history. Premium accounts can keep ten active watches and see 90 days of automatic and manual check history.
- Manual refreshes use the same deterministic safety pipeline, do not consume report quota, and have a short anti-abuse cooldown.
- Watches more than 48 hours from their planned start are checked every three hours.
- Watches inside the final 48 hours are checked hourly; expired plan dates are disabled.
- Each attempted run is recorded as unchanged, changed, partial, or failed. Check records are retained for at most 90 days; the account tier controls how much of that window the API returns.
- Identical coordinate/date/start/window plans share one upstream safety refresh.
- `OBJECTIVE_WATCH_CONCURRENCY` defaults to `4` and `OBJECTIVE_WATCH_BATCH_SIZE` defaults to `100`.
- Full snapshots overwrite the previous snapshot; meaningful risk-increase events are retained for up to 90 days, with only the most recent 14 days exposed to Free accounts.
- Email alerts are Premium-only, opt-in, and only deliver to verified account email addresses.

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
