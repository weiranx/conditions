# Conditions MCP

A separate, read-only MCP service for Conditions. It calls the existing backend
API and does not need database access or changes to the running Conditions app.
Uses the official MCP SDK with stdio and stateless Streamable HTTP transports.

## Tools

| Tool | Purpose |
| --- | --- |
| `search_objectives` | Resolve a US objective name to coordinates using Conditions search |
| `get_conditions_report` | Forecast evidence for explicit coordinates, date, local start time, and 1–24-hour travel window |
| `compare_conditions_plans` | Compare evidence for 2–3 objectives, dates, or departures; preserve per-plan failures |
| `list_saved_reports` | Account-scoped historical report summaries and pagination, when supported by the deployed API |
| `get_saved_report` | Account-scoped historical report snapshot |
| `list_objective_watches` | Account-scoped watches and check times; no changes or notifications |

The last three tools are advertised only when `CONDITIONS_SESSION` is configured.
No tools modify or delete reports, create watches, send email, or deploy code.
Forecast requests can still consume the existing backend's report quotas.
Missing values, source timestamps, incomplete evidence, and warnings are preserved.
The comparison tool returns evidence, not a fabricated safety ranking.

## Local use

Requires Node.js 22+ (Docker uses Node 24).

```bash
cd mcp
npm ci
cp .env.example .env
chmod 600 .env
# Edit .env locally. For HTTP, set MCP_BEARER_TOKEN to a random 32+ character secret.
npm test
npm start
```

Use `openssl rand -hex 32` to generate each secret separately. Never commit the
result or paste it into chat. HTTP refuses to start without bearer auth or a
complete OAuth configuration. It binds to loopback by default.

For a local MCP client, configure `node` with an absolute entrypoint:

```json
{
  "mcpServers": {
    "conditions": {
      "command": "node",
      "args": ["/absolute/path/to/conditions/mcp/src/index.js", "--stdio"],
      "env": {
        "CONDITIONS_API_URL": "https://apivps.conditions.weiranxiong.com"
      }
    }
  }
}
```

Direct `node` invocation does not read `.env` automatically; inject environment
variables through the client's private configuration or use Node's `--env-file`
option before the entrypoint. Do not use ordinary `npm run` as a stdio transport,
because npm's startup banner can pollute the protocol stream.

## Private account data

`CONDITIONS_SESSION` is an existing Conditions `bc_session` cookie value. Supply
it through a private environment file/secret manager. It is never returned to
the MCP client, forwarded to a different origin, or printed in logs. Expiration
and backend account permissions are respected; expired sessions return a tool
error and need a fresh sign-in. Public tools work without this setting.

This version is **single-owner**: every authorized MCP client sees the same
configured Conditions account. Do not publish it as a shared/multi-user service.
Multi-user hosting requires per-user Conditions authorization instead. The
owner's API session is separate from MCP client authentication. Having SSH access
does not implicitly select an app account, and this service does not mint app
sessions or bypass account permissions.

## ChatGPT web / remote HTTP

ChatGPT requires a reachable HTTPS endpoint. OAuth support is included for one
statically registered client, with an owner password, exact callback allowlist,
S256 PKCE, short-lived single-use codes, resource validation, and one-hour bearer
tokens. It does not support dynamic client registration or refresh tokens.
Authorization state is memory-only: restarting revokes issued MCP tokens and
requires reconnecting; expiry also requires reconnecting. Existing Conditions
account sessions are unaffected.

1. Configure a dedicated HTTPS origin in `MCP_PUBLIC_URL` and route it to this
   service. The origin must have no path prefix. Preserve the original Host.
2. Set `MCP_OAUTH_CLIENT_ID`, `MCP_OAUTH_CLIENT_SECRET`, `MCP_OWNER_PASSWORD`, and
   `MCP_OAUTH_REDIRECT_URIS` in the private environment. The secret and owner
   password must each be at least 32 characters. Register only the exact HTTPS
   callback URL shown by ChatGPT; do not guess or use wildcards.
3. In ChatGPT's developer-mode plugin settings, create a connection to
   `https://YOUR_MCP_HOST/mcp`, choose OAuth, and provide the configured client ID
   and secret. At the server's consent page, enter the MCP owner password
   (not your Conditions account password) to authorize read access.
4. Review the six read-only tools (three without an account session), then test:
   “Find Mount Whitney in Conditions” and a report for an explicit future date.

Endpoints: `/mcp`, `/health`, `/.well-known/oauth-protected-resource`,
`/.well-known/oauth-authorization-server`, `/authorize`, and `/oauth/token`.
An HTTP bearer token can also be used by clients that accept an Authorization
header. Browser origins other than the configured service origin are rejected;
MCP clients should connect server-to-server, not through browser JavaScript.

Official references: [MCP SDK](https://ts.sdk.modelcontextprotocol.io/server) and
[Connect in ChatGPT](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt).

## Isolated deployment

```bash
cd mcp
docker compose up -d --build
```

Run only after provisioning `.env`, HTTPS routing, and the desired owner account.
Compose publishes port 8104 on host loopback only, runs as a non-root user, and
does not restart or alter the other Conditions/Garmin/Strava containers. Use the
public Conditions HTTPS API origin; loopback inside this container is the MCP
container itself, not the backend container.

For nginx, proxy the dedicated hostname to `http://127.0.0.1:8104`, preserve
`Host $http_host`, disable proxy buffering, and set `proxy_read_timeout 120s`
to allow sequential comparison requests. Keep TLS verification enabled.
Do not expose port 8104 publicly or forward cookies from arbitrary browsers.
Rate limiting deliberately uses the socket address (no blindly trusted forwarded
headers); behind nginx, clients share its 60-request/minute limit and the OAuth
20-request/minute limit. This is suitable for the personal service.

`/health` checks this process only, not provider credentials or current forecast
availability. Verify with a real MCP tool call after deployment. Tests exercise
actual SDK client/server communication, OAuth consent and exchange, input
validation, authentication failures, missing evidence, and account boundaries.

## Scope and verification boundary

Source and automated tests are supplied here; creating the service does not
deploy it, create DNS/TLS records, connect ChatGPT, or create an account session.
Saved-report search and pagination depend on the deployed backend version;
the MCP service preserves the API response rather than inventing pagination.
No background monitoring runs unless separately configured.
