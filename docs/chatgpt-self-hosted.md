# Personal ChatGPT plan usage

Conditions can use your eligible ChatGPT plan when you run this open-source tool for personal use, locally or on a server you control. This uses OpenAI's supported OAuth registration and Responses API. No partner client ID, client secret, or Platform API key is needed for this flow.

Only the configured Conditions account's foreground browser requests use this connection. Visitors, MCP clients, admin tasks, and automatic watch jobs cannot use your subscription. Subscription failures never fall back to a separately billed API provider. Existing Conditions sign-in still controls access to your Conditions account; connecting ChatGPT separately grants plan usage.

## Sign in locally

Use Node 22 or later. On the computer running your browser, from a checkout:

```bash
cd backend
npm ci
npm run chatgpt -- login
```

The tool opens OpenAI's sign-in page. Choose **Continue with ChatGPT**, select your account/workspace, and approve plan usage. Eligibility and limits are determined by OpenAI. Identity sign-in alone does not authorize plan usage.

The callback listener binds only to `127.0.0.1:1455` and closes after success, failure, or ten minutes. Port 1455 must be available locally. `--no-browser` prints a URL to open on that same computer. The tool checks state, PKCE, ID-token signature, issuer, audience, expiry, subject, and nonce.

The protected file is `backend/data/chatgpt/credentials.json` (directory `0700`, file `0600`). This directory is excluded from Git and Docker builds. Set `CHATGPT_AUTH_DIR` to choose another dedicated private directory. Never paste, log, or commit the contents.

For a local backend, skip the transfer step.

## Transfer to your personal server

Loopback callbacks reach the computer running the browser, not a remote VM. Finish OAuth locally, securely transfer the selected registration, preserve the server's host ID, and let only the server refresh the transferred session.

Use SSH/SCP to transfer `credentials.json` into a private (`0700`) temporary directory on your server, preserving file permissions (`0600`). For a backend running directly on the server, run as its service user:

```bash
cd /path/to/conditions/backend
npm run chatgpt -- init
npm run chatgpt -- import /private/transfer/credentials.json
```

Use the running backend's `CHATGPT_AUTH_DIR`. Import preserves or creates a distinct server host ID; do not overwrite the destination store with the laptop's file. Stop using the laptop's copy after transfer so two runtimes do not race a rotating refresh token. Remove the temporary transfer file after import.

For this repository's Docker Compose deployment, first rebuild the backend with this integration. `/app/data` is already a persistent backend-only volume:

```bash
docker compose exec -T --user appuser backend mkdir -m 700 -p /app/data/chatgpt-transfer
docker compose cp /private/transfer/credentials.json backend:/app/data/chatgpt-transfer/credentials.json
docker compose exec -T --user root backend chown -R appuser:appgroup /app/data/chatgpt-transfer
docker compose exec -T --user appuser backend chmod 600 /app/data/chatgpt-transfer/credentials.json
docker compose exec -T --user appuser backend npm run chatgpt -- init
docker compose exec -T --user appuser backend npm run chatgpt -- import /app/data/chatgpt-transfer/credentials.json
docker compose exec -T --user appuser backend rm /app/data/chatgpt-transfer/credentials.json
docker compose exec -T --user appuser backend rmdir /app/data/chatgpt-transfer
```

The default store `/app/data/chatgpt` persists across container recreation. Do not mount it into the monitor container, put it in shared backups, or run multiple replicas against the same session. An overridden directory must be persistent, private, and writable by `appuser`.

## Enable your Conditions account

Sign into Conditions and open **Account → Use your ChatGPT plan → Set up personal ChatGPT access**. Copy your Conditions account UUID. In the server's existing environment configuration, set:

```dotenv
CHATGPT_OWNER_USER_ID=your-conditions-account-uuid
```

Use the Conditions UUID, not your email or OpenAI client/subject ID. Restart the backend to pick up the environment change. With this repository's Compose deployment:

```bash
docker compose up -d --no-deps --force-recreate backend
```

Outbound HTTPS to `auth.openai.com` and `api.openai.com` is required. Ensure `APP_BASE_URL` or `CORS_ORIGIN` includes the frontend origin; settings writes require an explicit allowed Origin.

## Choose a model and use AI

In Account, choose **Refresh connection**, then **Load available models**. Select from your account's current catalog. Without a selection, the first listed eligible model is chosen on the first AI request. Reload the catalog if model availability changes.

Enable the planner's **Use AI** preference. Field briefings, route analysis, plan parsing, snow-image analysis, forecast discussion summaries, and report chat use your connection. The selected model serves both normal and fast tasks. OpenAI responses use `store: false` and streaming, and incomplete streams are errors. Report chat streams text to the composer; this subscription path currently omits automatically generated follow-up suggestions.

Your ChatGPT limits apply. Usage records use provider `chatgpt` and zero Platform API spend, which is not an estimate of your subscription cost. Conditions' monthly API spend cap does not gate requests using your plan. Report-generation and other product limits still apply. Manage usage and app access at <https://chatgpt.com/settings/usage>. Connecting does not grant access to ChatGPT conversation history.

## Reconnect, switch accounts, disconnect

```bash
npm run chatgpt -- status
npm run chatgpt -- login
npm run chatgpt -- login --new-account
npm run chatgpt -- use oaiapp_your_saved_client_id
npm run chatgpt -- logout
```

Registrations keep their client IDs, verified identities, model choices, and credentials separate. `status` prints metadata only. Login reuses the selected registration and host ID; `--new-account` creates a separate registration. For remote servers, repeat local sign-in and transfer when reconnecting.

**Disconnect ChatGPT** in Account attempts to revoke the renewable session and clears local access, refresh, and ID tokens. It retains the account/client mapping and host ID. If remote revocation cannot be confirmed, the UI says so; disconnect Conditions in ChatGPT settings too. Disconnecting does not enable API-key fallback for the configured owner.

Refreshes are serialized with a filesystem lock and committed atomically. If a process crashes while holding `CHATGPT_AUTH_DIR/.lock`, stop all backend/CLI processes using the store before removing the stale lock directory and restarting. A busy lock is never automatically stolen.

## Verification

```bash
cd backend
npm test -- --runTestsByPath test/unit.chatgpt.test.js test/unit.chatgpt-access.test.js test/unit.chatgpt-inference.test.js
cd ../frontend
npm run build
```

Tests use local fixtures for OAuth, real JWT verification, refresh rotation, permissions, owner isolation, CSRF protection, inference, and no API failover. Live sign-in and a real eligible request still need your account after deployment.

Official references: [sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms), [inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).
