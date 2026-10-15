# Personal ChatGPT plan usage

Conditions can use your eligible ChatGPT plan when you run this open-source tool for personal use, locally or on a server you control. This uses OpenAI's supported OAuth registration and Responses API. No partner client ID, client secret, or Platform API key is needed for this flow.

Every Conditions account has its own connection, model choice, and disconnect controls. Only that account's foreground browser requests use its connection. Anonymous visitors, MCP clients, admin tasks, and automatic watch jobs cannot use your subscription. Accounts that have never connected ChatGPT continue using the existing server provider; availability alone does not authorize subscription usage. Subscription failures never fall back to a separately billed API provider. Existing Conditions sign-in still controls access to your Conditions account; connecting ChatGPT separately grants plan usage.

## Sign in locally

Use Node 22 or later. Sign into the Conditions account you want to connect and copy its UUID from **Account → Use your ChatGPT plan → Set up personal ChatGPT access**. On the computer running your browser, from a checkout, set the UUID and run:

```bash
conditions_account_id='your-conditions-account-uuid'
cd backend
npm ci
npm run chatgpt -- login --user "$conditions_account_id"
```

The tool opens OpenAI's sign-in page. Choose **Continue with ChatGPT**, select your account/workspace, and approve plan usage. Eligibility and limits are determined by OpenAI. Identity sign-in alone does not authorize plan usage.

The callback listener binds only to `127.0.0.1:1455` and closes after success, failure, or ten minutes. Port 1455 must be available locally. `--no-browser` prints a URL to open on that same computer. The tool checks state, PKCE, ID-token signature, issuer, audience, expiry, subject, and nonce.

The protected store is `backend/data/chatgpt/credentials.json` (directory `0700`, file `0600`). It contains separate account profiles sharing one stable host ID and one serialized mutation lock. Never transfer the complete store when it contains several accounts; export only the selected connection as shown below. This directory is excluded from Git and Docker builds. Set `CHATGPT_AUTH_DIR` to choose another dedicated private directory. Never paste, log, or commit the contents.

For a local backend, skip the transfer step.

## Transfer to your personal server

Loopback callbacks reach the computer running the browser, not a remote VM. Finish OAuth locally, securely transfer the selected registration, preserve the server's host ID, and let only the server refresh the transferred session.

First export only this Conditions account's selected connection into a dedicated private directory:

```bash
npm run chatgpt -- export /private/transfer/credentials.json --user "$conditions_account_id"
```

Use SSH/SCP to transfer that exported `credentials.json` into a private (`0700`) temporary directory on your server, preserving file permissions (`0600`). On the server, set `conditions_account_id` to the same UUID. For a backend running directly on the server, run as its service user:

```bash
cd /path/to/conditions/backend
npm run chatgpt -- init
npm run chatgpt -- import /private/transfer/credentials.json --user "$conditions_account_id"
```

Use the running backend's `CHATGPT_AUTH_DIR`. Import preserves or creates a distinct server host ID; do not overwrite the destination store with the laptop's file. Stop using the laptop's copy after transfer so two runtimes do not race a rotating refresh token. Remove the temporary transfer file after import.

For this repository's Docker Compose deployment, first rebuild the backend with this integration. `/app/data` is already a persistent backend-only volume:

```bash
docker compose exec -T --user appuser backend mkdir -m 700 -p /app/data/chatgpt-transfer
docker compose cp /private/transfer/credentials.json backend:/app/data/chatgpt-transfer/credentials.json
docker compose exec -T --user root backend chown -R appuser:appgroup /app/data/chatgpt-transfer
docker compose exec -T --user appuser backend chmod 600 /app/data/chatgpt-transfer/credentials.json
docker compose exec -T --user appuser backend npm run chatgpt -- init
docker compose exec -T --user appuser backend npm run chatgpt -- import /app/data/chatgpt-transfer/credentials.json --user "$conditions_account_id"
docker compose exec -T --user appuser backend rm /app/data/chatgpt-transfer/credentials.json
docker compose exec -T --user appuser backend rmdir /app/data/chatgpt-transfer
```

The default store `/app/data/chatgpt` persists across container recreation. Do not mount it into the monitor container, put it in shared backups, or run multiple replicas against the same session. An overridden directory must be persistent, private, and writable by `appuser`.

## Enabled by default

Every signed-in Conditions account can connect ChatGPT immediately. No account UUID allowlist or per-account server environment setup is required. Repeat local login and export/import with a different `--user` UUID for each account. The server chooses credentials from the authenticated Conditions session, never a caller-supplied account ID. Each account must separately approve plan usage; making the feature available does not grant access to anyone else's subscription.

Importing a connection takes effect immediately without a backend restart. Complete a fresh login for each profile; importing the same renewable session into two profiles is rejected. Accounts that have never connected ChatGPT retain their existing server-provider behavior. Once an account has connected, a disconnected, expired, or failed connection does not fall back to separately billed API providers.

An optional installation-wide `CHATGPT_ENABLED=false` environment setting disables connection access for all accounts. Restart/recreate the backend only when changing this setting. The old `CHATGPT_ACCOUNT_USER_IDS` list is no longer used and can be removed.

Outbound HTTPS to `auth.openai.com` and `api.openai.com` is required. Ensure `APP_BASE_URL` or `CORS_ORIGIN` includes the frontend origin; settings writes require an explicit allowed Origin.

## Choose a model and use AI

In Account, choose **Refresh connection**, then **Load available models**. Select from your account's current catalog. Without a selection, the first listed eligible model is chosen on the first AI request. Reload the catalog if model availability changes.

Enable the planner's **Use AI** preference. Field briefings, route analysis, plan parsing, snow-image analysis, forecast discussion summaries, and report chat use your connection. The selected model serves both normal and fast tasks. OpenAI responses use `store: false` and streaming, and incomplete streams are errors. Report chat streams text to the composer; this subscription path currently omits automatically generated follow-up suggestions.

Your ChatGPT limits apply. Usage records use provider `chatgpt` and zero Platform API spend, which is not an estimate of your subscription cost. Conditions' monthly API spend cap does not gate requests using your plan. Report-generation and other product limits still apply. Manage usage and app access at <https://chatgpt.com/settings/usage>. Connecting does not grant access to ChatGPT conversation history.

## Reconnect, switch accounts, disconnect

```bash
npm run chatgpt -- status --user "$conditions_account_id"
npm run chatgpt -- login --user "$conditions_account_id"
npm run chatgpt -- login --new-account --user "$conditions_account_id"
npm run chatgpt -- use oaiapp_your_saved_client_id --user "$conditions_account_id"
npm run chatgpt -- logout --user "$conditions_account_id"
```

Registrations keep their client IDs, verified identities, model choices, and credentials separate. `status` prints metadata only. Login reuses the selected registration and host ID; `--new-account` creates a separate registration. For remote servers, repeat local sign-in and transfer when reconnecting.

**Disconnect ChatGPT** in Account attempts to revoke the renewable session and clears local access, refresh, and ID tokens. It retains the account/client mapping and host ID. If remote revocation cannot be confirmed, the UI says so; disconnect Conditions in ChatGPT settings too. Disconnecting one Conditions account leaves your other accounts connected and does not enable API-key fallback for the disconnected account. Generated AI caches are scoped by Conditions account, ChatGPT registration, and selected model.

Refreshes are serialized with a filesystem lock and committed atomically. If a process crashes while holding `CHATGPT_AUTH_DIR/.lock`, stop all backend/CLI processes using the store before removing the stale lock directory and restarting. A busy lock is never automatically stolen.

## Existing single-owner setup

Keep `CHATGPT_OWNER_USER_ID` set to its original UUID if you already use the single-owner setup. That account continues using the original unscoped credential profile. All other accounts can connect by default and use separate profiles. CLI commands without `--user` manage the legacy profile; passing the UUID matching `CHATGPT_OWNER_USER_ID` also selects that legacy profile. Do not remove the legacy environment variable while relying on its original connection.

## Verification

```bash
cd backend
npm test -- --runTestsByPath test/unit.chatgpt.test.js test/unit.chatgpt-access.test.js test/unit.chatgpt-inference.test.js test/unit.chatgpt-profiles.test.js
cd ../frontend
npm run build
```

Tests use local fixtures for OAuth, real JWT verification, refresh rotation, permissions, per-account isolation, secure single-account export/import, cache isolation, CSRF protection, inference, and no API failover. Live sign-in and a real eligible request still need your account after deployment.

Official references: [sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms), [inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).
