# Conditions MCP

Read-only MCP tools using each person's Conditions account. The backend owns
OAuth and persists hashed credentials in PostgreSQL; the separate MCP process
validates access on every request and forwards only that user's bearer token.
No shared owner password, browser session, or static bearer key is accepted by HTTP.

## Tools

- `search_objectives`
- `get_conditions_report`
- `compare_conditions_plans`
- `list_saved_reports`
- `get_saved_report`
- `list_objective_watches`

Private routes use the authenticated user's ID and retain their existing backend
ownership/feature checks. Missing evidence remains missing. No writes, watch
creation, emails, or admin operations are authorized by `conditions:read`.

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

Run migration `018_mcp_oauth.sql` through the normal backend migration runner.
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
allowlist. The OAuth client is statically registered: each user authorizes their
own account under that client; app distribution/publication is separate.

The **MCP service** `.env` contains only the origins/port in `.env.example`.
Remove legacy `MCP_BEARER_TOKEN`, `MCP_OWNER_PASSWORD`, and `CONDITIONS_SESSION`.
HTTP fails closed if they are present. Node 22+ is required; Docker uses Node 24.

```bash
npm ci
npm test
docker compose -p conditions-mcp up -d --build
```

Keep host port 8104 loopback-only. Proxy `/mcp` and
`/.well-known/oauth-protected-resource` to port 8104, preserving Host and disabling
proxy buffering. Proxy `/.well-known/oauth-authorization-server` to backend
`/api/auth/mcp/metadata` at port 3001. `/api/` already routes to that backend.
Remove the old `/authorize` and `/oauth/token` routes after migration. Auth
responses use `Cache-Control: no-store`. Do not log request bodies or callback
query strings containing codes. The new consent page uses the website's existing
login rather than an MCP-hosted password form.

In ChatGPT, refresh OAuth settings or reconnect with the registered client ID,
secret, `client_secret_post`, and `conditions:read`. Metadata supplies the new
`/api/auth/mcp/authorize`, `/token`, and `/revoke` endpoints. Existing shared-owner
tokens stop working on cutover and users must reconnect with their own account.

Local stdio (`node src/index.js --stdio`) exposes only the three public tools.
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
