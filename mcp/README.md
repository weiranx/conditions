# Conditions MCP

Read-only MCP tools using each person's Conditions account. The backend owns
OAuth and persists hashed credentials in PostgreSQL; the separate MCP process
validates access on every request and forwards only that user's bearer token.
No shared owner password, browser session, or static bearer key is accepted by HTTP.

## Tools

Public (also over local stdio):

- `search_objectives`
- `get_conditions_report` — the `/api/safety` report. Takes the plan the app
  sends: activity, objective name, approach (`trailhead_ft`, `ascent_min_per_kft`,
  or an `approach_route` elevation timeline from a GPX track, or `approach=off`),
  weather limits, target elevation, and display units (`temp_unit`, `wind_unit`,
  `elevation_unit`, `time_style`) for the app's formatted text.
- `compare_conditions_plans`
- `compare_start_times` — the app's departure-time comparison
- `get_day_over_day` — the plan against the same plan one day earlier
- `evaluate_plan` — the app's evaluation of the plan (decision, hourly checks,
  verdict), the one tool that returns `evaluation`
- `get_service_status` — trimmed health and the feature flags

Account (OAuth). Tools that spend AI or multi-day usage are annotated
`readOnlyHint: false` (non-destructive), so clients can ask before calling them:

- `list_saved_reports`, `get_saved_report`, `list_objective_watches`
- `list_saved_trips`, `get_saved_trip` — saved multi-day trips, as compact day-by-day evidence
- `get_watch_history` — a watch's checks and change events
- `get_comparison_baseline` — the saved report a new one is compared against
- `get_account_usage` — tier and report, multi-day and AI usage
- `get_multi_day_forecast` — 2–7 day trip forecast; per-day full reports are
  omitted (use `get_conditions_report` for a day)
- `check_itinerary` — a 2–7 day trip, each day at its camp and high points with the night after it,
  returned as the app's trip assessment and compact evidence per day
- `get_ai_brief` — fetches the plan's report and asks for the app's AI brief
  with the report's computed decision
- `ask_report_assistant` — the app's report chat; the streamed answer is
  collected and returned with follow-up suggestions
- `suggest_routes`, `analyze_route` — the app's route suggestions and route analysis
- `analyze_satellite_snow` — the satellite snow analysis; the analyzed image is
  returned as MCP image content

The app's plan `evaluation` (its verdict and screen-ready checks) is removed from
every output except `evaluate_plan`, which returns it as the app's judgment.
The AI brief, start-time and multi-day tools still carry the decision levels
the app shows for them.

Private routes use the authenticated user's ID and retain their existing backend
ownership/feature checks. Missing evidence remains missing. `conditions:read`
allows GET on the read routes above and POST on `/api/ai-brief`,
`/api/report-chat`, `/api/route-analysis`, `/api/snow-vision` and
`/api/trip-forecasts`, which store nothing but count against the account's AI
and multi-day usage. No report, watch or account writes, emails, or admin
operations are authorized.

## Sign-in and connection management

ChatGPT redirects to the existing Conditions website at `/connect?request=…`.
Users sign in with their own email/password or Google account, review the data
being shared, and explicitly allow or deny. The browser's session cookie never
reaches ChatGPT or the MCP process. `/connect` lists active connections and allows
users to revoke their own grants; Account also links to that page.

Authorization codes expire after 60 seconds and require S256 PKCE. Access tokens
expire after 15 minutes. Refresh tokens rotate on each exchange; reuse revokes the
whole grant. Grants last at most 30 days and are bounded by the originating
Conditions session. Signing out, expiring that session, disabling/deleting an
account, or revoking a connection invalidates access. Backend/MCP restarts do not
invalidate persistent grants. Refresh does not silently extend a grant forever.

## Configuration

Run migrations `018_mcp_oauth.sql` and `019_mcp_oauth_clients.sql`, and `020_mcp_grant_callback.sql` through the normal backend migration runner.
Add these private settings to the **backend** environment:

```dotenv
MCP_PUBLIC_URL=https://apivps.conditions.weiranxiong.com
MCP_FRONTEND_ORIGIN=https://conditions.weiranxiong.com
MCP_OAUTH_CLIENT_ID=conditions-chatgpt
MCP_OAUTH_CLIENT_SECRET=GENERATE_A_RANDOM_32_PLUS_CHARACTER_SECRET
MCP_OAUTH_REDIRECT_URIS=EXACT_CHATGPT_CALLBACK_FROM_THE_CONNECTION_SETTINGS
```

Client callbacks must be exact HTTPS URLs, without fragments or wildcards.
Keep secrets out of Git. The website origin must already be in the API CORS
allowlist. These settings preserve existing manually registered connections.
New compatible MCP connections use the advertised `/api/auth/mcp/register` endpoint:
leave client ID and secret blank in ChatGPT. Registration accepts only exact
HTTPS ChatGPT callbacks, the exact Claude callback
`https://claude.ai/api/mcp/auth_callback`, the Grok callback `https://grok.com/connectors-oauth-exchange-code/`, Gemini’s six Google relay callbacks, and explicit-port HTTP loopback
callbacks on `localhost`, `127.0.0.1`, or `[::1]`. It stores secrets only as hashes and
supports public PKCE clients or generated credentials using secret-post/basic.
Registration grants no account access; each user must sign in and consent.
Codes, refresh tokens, and revocation are bound to the authenticated client.
Registration is limited to 20 requests per IP per hour and 10,000 stored clients.
The storage cap fails closed; operators should investigate abuse before raising
it or removing unused client records. App distribution/publication is separate.

The **MCP service** `.env` contains only the origins/port in `.env.example`.
Remove legacy `MCP_BEARER_TOKEN`, `MCP_OWNER_PASSWORD`, and `CONDITIONS_SESSION`.
HTTP fails closed if they are present. Node 22+ is required; Docker uses Node 24.

```bash
npm ci
npm test
docker compose -p conditions-mcp up -d --build
```

In production, `scripts/deploy.sh` performs this release (with a health check
and image rollback) whenever `/opt/summitsafe/mcp/.env` exists, so every
CI-gated deployment of `main` also updates the MCP server.
`scripts/setup-nginx.sh` writes the proxy routes below.

Keep host port 8104 loopback-only. Proxy `/mcp` and
`/.well-known/oauth-protected-resource` and
`/.well-known/oauth-protected-resource/mcp` to port 8104, preserving Host and disabling
proxy buffering. Proxy `/.well-known/oauth-authorization-server` to backend
`/api/auth/mcp/metadata` at port 3001. `/api/` already routes to that backend.
Clients may cache OAuth metadata. Keep `/authorize` and `/oauth/token` as
compatibility proxies to backend `/api/auth/mcp/authorize` and
`/api/auth/mcp/token`; do not route them to the retired owner-login service.
Disable access logs for both aliases and `/api/auth/mcp/`. Auth responses use `Cache-Control: no-store`. Do not log request bodies or callback
query strings containing codes. The new consent page uses the website's existing
login rather than an MCP-hosted password form.

In ChatGPT, create a custom connection using the MCP URL and OAuth, leaving
the optional client ID and secret blank. Select dynamic registration if prompted.
Existing manually configured connections continue to work. Metadata supplies the new
`/api/auth/mcp/authorize`, `/token`, and `/revoke` endpoints. Existing shared-owner
tokens stop working on cutover and users must reconnect with their own account.

Local stdio (`node src/index.js --stdio`) exposes only the seven public tools.
The health endpoint tests the MCP process; it does not prove backend availability.

## Verification

- `npm test` here: tool schemas, missing evidence, authentication, bearer isolation.
- Backend Jest `unit.mcp-oauth.test.js`: CSRF/origin, account-change and route scope.
- Backend `MCP_TEST_DATABASE_URL=… node --test test/integration.mcp-oauth.cjs`:
  real isolated PostgreSQL schema tests for PKCE, persistence, two users, rotation,
  replay detection, cross-user revocation, disabled accounts, and logout.
- Frontend `npm run test:field`: explicit consent and stale account response tests.

The CI MCP job uses a disposable PostgreSQL service. Never point test settings at
an untrusted database; test setup creates and removes a uniquely named schema.

## Other AI clients

Claude supports the same remote MCP URL through Customize → Connectors, with
optional OAuth credentials left blank. Compatible desktop/CLI clients must
support Streamable HTTP, DCR, and authorization-code PKCE with a loopback
callback. Callbacks are matched exactly to each registration. Hosted callback
domains other than ChatGPT, Claude, Grok, and the supported Gemini relay hosts and private URI schemes are rejected.

Consent displays the actual callback and derives the app label from its destination,
not caller-supplied names. Local-client identity is not verified: users should only
approve a local flow they started on the same device. Connection management records
the callback used for each grant. A missing requested scope defaults to the sole
supported scope, `conditions:read`; other scopes remain rejected.

Protocol regression coverage exercises registration, consent, code exchange and
private account token resolution for Claude and IPv4/IPv6/localhost callbacks.
This does not establish compatibility with every third-party app version.

### Grok and Gemini web

Grok: Plugins → Connectors → New Connector → Custom, then use the MCP URL.
Gemini: Settings → Personal Intelligence → Connected Apps → Custom apps (sometimes under Spark), then use the same URL. Leave optional OAuth credentials blank.
Both use dynamic registration and the Conditions sign-in/consent page.

Observed Gemini registration supplies six callbacks: HTTPS hosts
`oauth-redirect.googleusercontent.com`, `oauth-redirect-test.googleusercontent.com`,
and `oauth-redirect-sandbox.googleusercontent.com`, each with `/r/` and `/a/`
paths followed by `user_bound_custom-mcp-<numeric-user-id>-apivps_conditions_weiranxiong_com`.
The allowlist matches only that server namespace, and each authorization still
requires an exact callback registered to its client. Registration permits at most six callbacks.
These destinations were verified from live client registration on 2026-09-16.
