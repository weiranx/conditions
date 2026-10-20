import { useEffect, useState } from "react";
import { fetchApi, readApiErrorMessage } from "../lib/api-client";
import { publishAiAvailability } from "../hooks/useAiAvailability";

interface Connection {
  enabled: boolean;
  connected?: boolean;
  state?: string;
  email?: string | null;
  model?: string | null;
  accounts?: { clientId: string; email: string | null; active: boolean }[];
  signIn?: SignIn | null;
}
interface Model { id: string; name: string }
interface SignIn { id: string; authorizationUrl: string; expiresAt: number }

function readSignIn(value: unknown): SignIn | null {
  if (value === null || value === undefined) return null;
  const record = value as Partial<SignIn>;
  if (typeof record.id !== 'string' || typeof record.authorizationUrl !== 'string' || typeof record.expiresAt !== 'number') {
    throw new Error('Could not start ChatGPT sign-in. Try again.');
  }
  const url = new URL(record.authorizationUrl);
  if (url.origin !== 'https://auth.openai.com' || url.pathname !== '/api/accounts/authorize' || url.username || url.password) {
    throw new Error('Could not verify the ChatGPT sign-in address. Try again.');
  }
  return { id: record.id, authorizationUrl: url.href, expiresAt: record.expiresAt };
}

const jsonPost = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function ChatGPTPlan({ userId }: { userId: string }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [welcome, setWelcome] = useState(false);
  const [signIn, setSignIn] = useState<SignIn | null>(null);
  const [callbackUrl, setCallbackUrl] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setConnection(null);
    setModels([]);
    setError("");
    setMessage("");
    setWelcome(false);
    setSignIn(null);
    setCallbackUrl('');
    void fetchApi("/api/account/chatgpt", { signal: controller.signal }, { retries: 0 }).then(({ response, payload }) => {
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(readApiErrorMessage(payload, "Could not load your ChatGPT connection."));
      setConnection(payload as Connection);
      setSignIn(readSignIn((payload as Connection).signIn));
      if ((payload as Connection).connected) {
        try { setWelcome(localStorage.getItem(`conditions:chatgpt-welcome:${userId}`) !== "seen"); } catch { /* Storage may be unavailable. */ }
      }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load your ChatGPT connection.");
    });
    return () => controller.abort();
  }, [userId]);

  async function act(path: string, init?: RequestInit) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { response, payload } = await fetchApi(path, init, { retries: 0 });
      if (!response.ok) throw new Error(readApiErrorMessage(payload, "ChatGPT request failed. Try again."));
      return payload;
    } finally { setBusy(false); }
  }
  async function refresh() {
    try {
      const next = await act("/api/account/chatgpt") as Connection;
      setConnection(next);
      setSignIn(readSignIn(next.signIn));
      if (next.connected) {
        try { setWelcome(localStorage.getItem(`conditions:chatgpt-welcome:${userId}`) !== "seen"); } catch { /* Optional preference only. */ }
      }
      const health = await fetchApi("/api/healthz", undefined, { retries: 0 });
      if (health.response.ok) publishAiAvailability((health.payload as { ai: Parameters<typeof publishAiAvailability>[0] }).ai);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not refresh the connection."); }
  }

  async function beginSignIn(newAccount = false) {
    // Open during the click, before awaiting the API, so popup blockers can allow the sign-in tab.
    let popup: Window | null = null;
    try {
      popup = window.open('about:blank', '_blank');
      if (popup) popup.opener = null;
    } catch { /* The form also provides a normal sign-in link. */ }
    try {
      const result = await act('/api/account/chatgpt/signin/start', jsonPost({ newAccount })) as { signIn: unknown };
      const next = readSignIn(result.signIn);
      if (!next) throw new Error('Could not start ChatGPT sign-in. Try again.');
      setSignIn(next);
      setCallbackUrl('');
      if (popup) {
        try { popup.location.replace(next.authorizationUrl); } catch { popup.close(); }
      }
    } catch (reason) {
      popup?.close();
      setError(reason instanceof Error ? reason.message : 'Could not open ChatGPT sign-in.');
    }
  }

  async function finishSignIn() {
    if (!signIn || !callbackUrl.trim()) return;
    const value = callbackUrl.trim();
    setCallbackUrl('');
    try {
      const next = await act('/api/account/chatgpt/signin/complete', jsonPost({ signInId: signIn.id, callbackUrl: value })) as Connection;
      setSignIn(null);
      setConnection(next);
      setModels([]);
      setMessage(next.connected ? 'ChatGPT connected. Your eligible AI requests now use this plan.' : 'Signed in, but ChatGPT plan usage was not approved. Continue with ChatGPT again to approve it.');
      if (next.connected) {
        try { setWelcome(localStorage.getItem(`conditions:chatgpt-welcome:${userId}`) !== 'seen'); } catch { /* Optional preference only. */ }
      }
      const health = await fetchApi('/api/healthz', undefined, { retries: 0 });
      if (health.response.ok) publishAiAvailability((health.payload as { ai: Parameters<typeof publishAiAvailability>[0] }).ai);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not finish ChatGPT sign-in. Start again.');
    }
  }

  return (
    <section className="sky-account-section" aria-labelledby="chatgpt-plan-heading" aria-busy={busy}>
      <div className="sky-sh"><h2 id="chatgpt-plan-heading">Use your ChatGPT plan</h2></div>
      <div className="sky-card sky-ai-card">
        <p>Use your eligible ChatGPT plan for your personal Conditions AI requests. Your ChatGPT limits apply separately from Conditions’ API spend allowance.</p>
        {welcome && <div className="sky-notice is-info" role="status">
          <div><strong>You’re using your ChatGPT plan</strong><p>Eligible AI requests use your ChatGPT allowance. Manage app access and usage in ChatGPT settings.</p>
            <button className="field-button" onClick={() => {
              setWelcome(false);
              try { localStorage.setItem(`conditions:chatgpt-welcome:${userId}`, "seen"); } catch { /* Optional preference only. */ }
            }}>Got it</button>
          </div>
        </div>}
        {!connection && !error && <p role="status">Checking your ChatGPT connection…</p>}
        {connection?.enabled && <>
          <p><strong>{connection.connected ? "Using ChatGPT plan" : connection.state === "permission_required" ? "ChatGPT plan permission needed" : connection.state === "reauthentication_required" ? "Reconnect ChatGPT" : connection.state === "unavailable" ? "Connection unavailable — check server setup" : "ChatGPT is not connected"}</strong>{connection.email && ` · ${connection.email}`}</p>
          {!signIn && <div>
            <button type="button" className="field-button field-button-primary" disabled={busy} onClick={() => void beginSignIn()}>Continue with ChatGPT</button>{' '}
            {Boolean(connection.accounts?.length) && <button type="button" className="field-button" disabled={busy} onClick={() => void beginSignIn(true)}>Use another ChatGPT account</button>}
          </div>}
          {signIn && <form className="sky-chatgpt-signin" onSubmit={(event) => { event.preventDefault(); void finishSignIn(); }}>
            <h3>Finish connecting ChatGPT</h3>
            <ol>
              <li><a href={signIn.authorizationUrl} target="_blank" rel="noreferrer">Open ChatGPT sign-in</a> and approve access to your plan.</li>
              <li>Copy the full return address from the sign-in tab, beginning with <code>http://127.0.0.1:1455/auth/callback</code>.</li>
              <li>Paste it below and choose Finish sign-in.</li>
            </ol>
            <p id="chatgpt-return-help">The localhost page may say it can’t be reached because Conditions runs on your server. Copy its address anyway; finish here within ten minutes.</p>
            <label htmlFor="chatgpt-return-url">ChatGPT return address</label>
            <textarea id="chatgpt-return-url" aria-describedby="chatgpt-return-help" autoComplete="off" autoCapitalize="none" spellCheck={false} rows={3} maxLength={8192}
              placeholder="http://127.0.0.1:1455/auth/callback?…" value={callbackUrl} onChange={(event) => setCallbackUrl(event.target.value)} disabled={busy} required />
            <div>
              <button className="field-button field-button-primary" type="submit" disabled={busy || !callbackUrl.trim()}>Finish sign-in</button>{' '}
              <button className="field-button" type="button" disabled={busy} onClick={() => {
                void act('/api/account/chatgpt/signin/cancel', jsonPost({ signInId: signIn.id }))
                  .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not confirm cancellation.'))
                  .finally(() => { setSignIn(null); setCallbackUrl(''); });
              }}>Cancel sign-in</button>
            </div>
          </form>}
          {(connection.accounts?.length || 0) > 1 && <label>Saved ChatGPT account
            <select disabled={busy || Boolean(signIn)} value={connection.accounts?.find((account) => account.active)?.clientId || ''} onChange={(event) => {
              void act('/api/account/chatgpt/account', jsonPost({ clientId: event.target.value })).then((payload) => {
                setConnection(payload as Connection); setModels([]); setSignIn(null); setCallbackUrl('');
                return refresh();
              }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not switch ChatGPT accounts.'));
            }}>
              {connection.accounts?.map((account, index) => <option key={account.clientId} value={account.clientId}>{account.email || 'ChatGPT account'} · Connection {index + 1}</option>)}
            </select>
          </label>}
          {connection.connected && <>
            <p>Model: {connection.model || "Automatically selected from your available models on the first request"}</p>
            <button className="field-button" disabled={busy} onClick={() => {
              void act("/api/account/chatgpt/models").then((payload) => {
                const available = (payload as { models: Model[] }).models;
                setModels(available);
                if (available.length === 0) setMessage("No models are currently available to this ChatGPT account. Review app access in ChatGPT settings.");
              })
                .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load models."));
            }}>Load available models</button>
            {models.length > 0 && <label>ChatGPT model
              <select value={connection.model || ""} disabled={busy} onChange={(event) => {
                void act("/api/account/chatgpt/model", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: event.target.value }) })
                  .then((payload) => setConnection(payload as Connection))
                  .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not save the model."));
              }}>
                <option value="" disabled>Choose a model</option>
                {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
              </select>
            </label>}
          </>}
          <div>
            <button className="field-button" disabled={busy} onClick={() => void refresh()}>Refresh connection</button>{" "}
            {(connection.connected || connection.state === "permission_required" || connection.state === "reauthentication_required") && <button className="field-button" disabled={busy} onClick={() => {
              void act("/api/account/chatgpt/disconnect", { method: "POST" }).then(async (payload) => {
                setConnection(payload as Connection);
                setModels([]);
                setSignIn(null);
                setCallbackUrl('');
                setWelcome(false);
                setMessage((payload as { message: string }).message);
                publishAiAvailability({ available: false, billingSource: "api" });
                try {
                  const health = await fetchApi('/api/healthz', undefined, { retries: 0 });
                  if (health.response.ok) publishAiAvailability((health.payload as { ai: Parameters<typeof publishAiAvailability>[0] }).ai);
                } catch { /* The shared availability poll retries if the health check is unreachable. */ }
              }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not disconnect ChatGPT."));
            }}>Disconnect ChatGPT</button>}
          </div>
        </>}
        {!connection?.enabled && <button className="field-button" disabled={busy} onClick={() => void refresh()}>Refresh connection</button>}
        <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">Manage ChatGPT usage and app access</a>
        <details className="sky-details">
          <summary>How ChatGPT sign-in works</summary>
          <p>Choose Continue with ChatGPT, approve access in the new tab, then paste its return address here. Conditions verifies the sign-in and keeps the connection securely on your personal server. No terminal, API key, or credential-file transfer is needed.</p>
          <p>Each Conditions account has its own ChatGPT connections and model selection. Sign-in alone does not authorize plan usage; approve that permission separately in ChatGPT. Connecting does not grant access to your ChatGPT conversations.</p>
          <p>This connection powers your foreground requests only. Automatic watch summaries use the separately configured server provider.</p>
          <p>Disconnecting ChatGPT switches AI requests back to the configured server provider and your Conditions API allowance.</p>
        </details>
        {error && <p className="sky-notice is-caution" role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
      </div>
    </section>
  );
}
