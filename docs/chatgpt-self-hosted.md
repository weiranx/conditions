# Personal ChatGPT plan usage

Conditions can use your eligible ChatGPT plan when you run this open-source tool for personal use, locally or on a server you control. This uses OpenAI's supported OAuth registration and Responses API. No partner client ID, client secret, or Platform API key is needed for this flow.

Every Conditions account has its own connection, model choice, and disconnect controls. Only that account's foreground browser requests use its connection. Anonymous visitors, MCP clients, admin tasks, and automatic watch jobs cannot use your subscription. Accounts that have never connected ChatGPT continue using the existing server provider; availability alone does not authorize subscription usage. Subscription failures never fall back to a separately billed API provider. Existing Conditions sign-in still controls access to your Conditions account; connecting ChatGPT separately grants plan usage.

## Connect in the browser

After deploying the updated frontend and backend, sign in to Conditions and open **Account → Use your ChatGPT plan**:

1. Choose **Continue with ChatGPT**. A new tab opens OpenAI sign-in. If popups are blocked, use **Open ChatGPT sign-in** in the form.
2. Sign in and approve access to your eligible plan. Identity sign-in alone does not authorize plan usage.
3. When OpenAI redirects to an address beginning with `http://127.0.0.1:1455/auth/callback`, copy the **entire address** from that tab's address bar.
4. Return to Conditions, paste it into **ChatGPT return address**, and choose **Finish sign-in** within ten minutes.

No terminal, API key, account UUID, or credential-file transfer is needed. The connection takes effect immediately. Repeat these steps while signed into each of your Conditions accounts to connect them independently.

The localhost page may say it cannot be reached. That is expected: the callback points at the computer running your browser, while Conditions runs on your server. Copy its address anyway. Conditions uses the pasted address to finish the exchange on your server. This manual return-address handoff has fixture coverage, but still needs live validation with an eligible OpenAI account; OpenAI's documented loopback flow normally uses a local callback listener.

Keep the return address private and paste it only into the Conditions page where you started sign-in. Conditions binds the attempt to that account and browser session, checks state, PKCE, ID-token signature, issuer, audience, expiry, subject, and nonce, and accepts a completion only once. The PKCE verifier and renewable credentials remain on the server. The return address is cleared from the form on submission and is not saved in browser storage.

**Cancel sign-in** discards the pending attempt. Reopening Account in the same browser session restores an unexpired pending attempt. Starting again replaces the previous attempt. A backend restart also discards pending attempts; start again if sign-in expires or was interrupted.

## Server configuration

Connections are enabled by default for every signed-in account. No account UUID allowlist or per-account environment configuration is required. The server chooses credentials from the authenticated Conditions session, never a caller-supplied account ID. Each account must separately approve plan usage.

The protected store is `backend/data/chatgpt/credentials.json` (directory `0700`, file `0600`). In the repository's Docker Compose deployment it is `/app/data/chatgpt`, inside the existing persistent backend-only volume. Deploy both updated frontend and backend images. The directory must be private, persistent, and writable by the backend service user; `CHATGPT_AUTH_DIR` can override it. It is excluded from Git and Docker builds. Do not share this store with other running installations or multiple backend replicas. Pending sign-ins are held in memory on one backend process.

Outbound HTTPS to `auth.openai.com` and `api.openai.com` is required. Serve Conditions over HTTPS and ensure `APP_BASE_URL` or `CORS_ORIGIN` includes the frontend origin; settings writes require an explicit allowed Origin.

An optional installation-wide `CHATGPT_ENABLED=false` setting disables connection access for all accounts. Restart/recreate the backend when changing this setting. The old `CHATGPT_ACCOUNT_USER_IDS` list is no longer used and can be removed.

Accounts that have never connected ChatGPT, and accounts that explicitly disconnected it, use the configured server provider and normal Conditions API allowance. Retained registrations from earlier disconnects also use the server provider. Expired credentials, missing permissions, usage limits, and connection failures do not automatically fall back to separately billed API providers; choose **Disconnect ChatGPT** to switch back to server AI.

## Choose a model and use AI

In Account, choose **Refresh connection**, then **Load available models**. Select from your account's current catalog. Without a selection, the first listed eligible model is chosen on the first AI request. Reload the catalog if model availability changes.

Enable the planner's **Use AI** preference. Field briefings, route analysis, plan parsing, snow-image analysis, forecast discussion summaries, and report chat use your connection. The selected model serves both normal and fast tasks. OpenAI responses use `store: false` and streaming, and incomplete streams are errors. Report chat streams text to the composer; this subscription path currently omits automatically generated follow-up suggestions.

Your ChatGPT limits apply. Usage records use provider `chatgpt` and zero Platform API spend, which is not an estimate of your subscription cost. Conditions' monthly API spend cap does not gate requests using your plan. Report-generation and other product limits still apply. Manage usage and app access at <https://chatgpt.com/settings/usage>. Connecting does not grant access to ChatGPT conversation history.

## Reconnect, switch accounts, disconnect

Choose **Continue with ChatGPT** to reconnect the selected saved registration. Choose **Use another ChatGPT account** to create a separate registration, then complete the same browser flow. When multiple registrations are saved, **Saved ChatGPT account** switches the active connection within the current Conditions account. Client IDs, verified identities, model choices, and credentials remain separate.

**Disconnect ChatGPT** attempts to revoke the renewable session and clears local access, refresh, and ID tokens. It retains the account/client mapping and host ID. If remote revocation cannot be confirmed, the UI says so; disconnect Conditions in ChatGPT settings too. Your requests switch back to the configured server provider, subject to its availability, enabled features, and your Conditions API allowance. Disconnecting one Conditions account leaves your other accounts connected. Generated AI caches are scoped by Conditions account, ChatGPT registration, and selected model.

Refreshes are serialized with a filesystem lock and committed atomically. If a process crashes while holding `CHATGPT_AUTH_DIR/.lock`, stop all backend/CLI processes using the store before removing the stale lock directory and restarting. A busy lock is never automatically stolen.

## Existing single-owner setup

Keep `CHATGPT_OWNER_USER_ID` set to its original UUID if you already use the single-owner setup. That account continues using the original unscoped credential profile. All other accounts can connect by default and use separate profiles. CLI commands without `--user` manage the legacy profile; passing the UUID matching `CHATGPT_OWNER_USER_ID` also selects that legacy profile. Do not remove the legacy environment variable while relying on its original connection.

## Verification

Automated tests use local fixtures for browser sign-in, state and PKCE validation, JWT verification, refresh rotation, permissions, per-account and browser-session isolation, expiry, cancellation, replay protection, saved-account selection, CSRF protection, inference, and no API failover. Frontend tests cover the browser form, popup-blocked link, completion, cancellation, model selection, and disconnect. Live sign-in and a real eligible request still need your account after deployment.

Official references: [sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms), [inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).
