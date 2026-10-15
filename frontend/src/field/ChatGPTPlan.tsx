import { useEffect, useState } from "react";
import { fetchApi, readApiErrorMessage } from "../lib/api-client";
import { publishAiAvailability } from "../hooks/useAiAvailability";

interface Connection {
  enabled: boolean;
  connected?: boolean;
  state?: string;
  email?: string | null;
  model?: string | null;
}
interface Model { id: string; name: string }

export function ChatGPTPlan({ userId }: { userId: string }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [welcome, setWelcome] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setConnection(null);
    setModels([]);
    setError("");
    setMessage("");
    setWelcome(false);
    void fetchApi("/api/account/chatgpt", { signal: controller.signal }, { retries: 0 }).then(({ response, payload }) => {
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(readApiErrorMessage(payload, "Could not load your ChatGPT connection."));
      setConnection(payload as Connection);
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
      if (next.connected) {
        try { setWelcome(localStorage.getItem(`conditions:chatgpt-welcome:${userId}`) !== "seen"); } catch { /* Optional preference only. */ }
      }
      const health = await fetchApi("/api/healthz", undefined, { retries: 0 });
      if (health.response.ok) publishAiAvailability((health.payload as { ai: Parameters<typeof publishAiAvailability>[0] }).ai);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not refresh the connection."); }
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
              void act("/api/account/chatgpt/disconnect", { method: "POST" }).then((payload) => {
                setConnection(payload as Connection);
                setModels([]);
                setMessage((payload as { message: string }).message);
                publishAiAvailability({ available: false, billingSource: "chatgpt", accountUserId: userId });
              }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not disconnect ChatGPT."));
            }}>Disconnect ChatGPT</button>}
          </div>
        </>}
        {!connection?.enabled && <button className="field-button" disabled={busy} onClick={() => void refresh()}>Refresh connection</button>}
        <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">Manage ChatGPT usage and app access</a>
        <details className="sky-details">
          <summary>{connection?.connected ? "Reconnect or switch ChatGPT accounts" : "Set up personal ChatGPT access"}</summary>
          <p>On the computer running your browser, open the Conditions backend folder and run <code>npm run chatgpt -- login --user {userId}</code>. Choose Continue with ChatGPT and approve plan usage. No API key is needed.</p>
          <p>For a remote server, export only this account’s connection with <code>npm run chatgpt -- export /private/path/credentials.json --user {userId}</code>. Transfer that file securely, then run <code>npm run chatgpt -- import /private/path/credentials.json --user {userId}</code> on the server.</p>
          <p>ChatGPT connections are enabled by default for every Conditions account. After importing, refresh this connection. Your account’s AI requests use your own ChatGPT plan once connected; before connecting, the existing server provider applies.</p>
          <p>To add another ChatGPT registration for this Conditions account, run <code>npm run chatgpt -- login --new-account --user {userId}</code>. Select one with <code>npm run chatgpt -- use &lt;client-id&gt; --user {userId}</code>.</p>
          <p>This connection powers your foreground requests only. Automatic watch summaries use the separately configured server provider.</p>
        </details>
        {error && <p className="sky-notice is-caution" role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
      </div>
    </section>
  );
}
