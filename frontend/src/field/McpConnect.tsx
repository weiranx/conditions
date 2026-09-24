import { useEffect, useRef, useState } from 'react';
import { useAccount } from '../hooks/useAccount';
import { buildApiUrl } from '../lib/api-client';
import { GoogleAuth } from './GoogleAuth';
import { getDefaultUserPreferences } from '../app/preferences';
import './mcp-connect.css';

type Connection = { clientName?: string; id: string; created_at: string; expires_at: string };
async function requestApi(path: string, body?: object) {
  const response = await fetch(buildApiUrl(`/api/auth/mcp/${path}`), {
    credentials: 'include', headers: { 'Content-Type': 'application/json' },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The connection request failed.');
  return data;
}
export default function McpConnect() {
  const account = useAccount();
  const [request] = useState(() => new URLSearchParams(window.location.search).get('request'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [client, setClient] = useState<{clientName:string;callbackUri:string} | null>(null);
  const [reviewedUser, setReviewedUser] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loadedUser, setLoadedUser] = useState<string | null>(null);
  const userId = account.user?.id;
  const currentUser = useRef(userId);
  currentUser.current = account.user?.id;
  useEffect(() => {
    if (!userId) return;
    const id = userId;
    setError('');
    let active = true;
    requestApi(request ? `request/${encodeURIComponent(request)}` : 'connections')
      .then(data => {
        if (!active || currentUser.current !== id) return;
        if (request) { setReviewedUser(data.userId); setClient({clientName:data.clientName,callbackUri:data.callbackUri}); } else { setConnections(data.connections); setLoadedUser(id); }
      }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [userId, request]);
  async function run(action: () => Promise<unknown>) {
    setError(''); setBusy(true);
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  async function decide(allow: boolean) {
    if (!account.user || reviewedUser !== account.user.id) return;
    const id = account.user.id;
    const data = await requestApi('approve', { request, allow, userId: id });
    if (currentUser.current !== id) throw new Error('Account changed. Please reconnect.');
    const redirect = new URL(data.redirect);
    // Return only to the exact destination reviewed for this signed-in account.
    const reviewed = client && new URL(client.callbackUri);
    if (!reviewed || redirect.origin !== reviewed.origin || redirect.pathname !== reviewed.pathname
      || redirect.username || redirect.password || redirect.hash) throw new Error('Invalid return address.');
    window.location.assign(redirect.href);
  }
  const pending = busy || account.busy || account.loading;
  return <main className="mcp-connect">
    <a href="/">Conditions</a>
    <h1>{request ? 'Connect Conditions to an AI app' : 'Connected apps'}</h1>
    {error && <p role="alert">{error}</p>}
    {account.loading ? <p role="status">Checking your account…</p> : !account.user ? <>
      <p>Sign in to your Conditions account to continue.</p>
      {account.google.available && account.google.clientId && account.google.nonce && <GoogleAuth
        busy={pending} clientId={account.google.clientId} nonce={account.google.nonce}
        onCredential={credential => void run(() => account.signInWithGoogle({credential, preferences:getDefaultUserPreferences()}))}
        onError={setError} />}
      <form onSubmit={event => { event.preventDefault(); void run(async () => { await account.signIn({email,password}); setPassword(''); }); }}>
        <label>Email<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} /></label>
        <button disabled={pending}>Sign in</button>
      </form>
      <p><a href="/settings" target="_blank" rel="noreferrer">Create an account or reset your password</a>, then return here and <button disabled={pending} onClick={()=>void run(account.refreshAccount)}>check sign-in</button>.</p>
    </> : <>
      <p>Signed in as <strong>{account.user.email}</strong>.</p>
      <button disabled={pending} onClick={()=>void run(account.signOut)}>Use a different account</button>
      {request ? <>
        <h2>Allow {reviewedUser === userId ? client?.clientName || "this app" : "this app"} to read your Conditions data?</h2>
        {reviewedUser === userId && client && <p>Return address: <code style={{overflowWrap:"anywhere"}}>{client.callbackUri}</code></p>}
        {reviewedUser === userId && client?.clientName === "Local MCP client" && <p>Approve only if you started this connection in an app on this device. The local app’s identity is not verified.</p>}
        <ul><li>Search objectives and retrieve forecasts.</li><li>Compare trip plans, departure times and multi-day forecasts.</li><li>Ask the report assistant and generate AI briefs, route analyses and satellite snow analyses. These count toward your AI and multi-day usage limits.</li><li>Read your saved reports, objective watches and their check history, including trip locations and dates, and your plan’s usage.</li></ul>
        <p>This connection cannot change reports, create watches, or send notifications.</p>
        <p>You can disconnect at any time in Connected apps. Access ends when this Conditions sign-in expires or you sign out.</p>
        <div className="mcp-connect-actions">
          <button disabled={pending || reviewedUser !== account.user.id} onClick={()=>void run(()=>decide(true))}>Allow read access</button>
          <button disabled={pending || reviewedUser !== account.user.id} onClick={()=>void run(()=>decide(false))}>Cancel</button>
        </div>
      </> : <>
        {loadedUser !== account.user.id ? (!error && <p role="status">Loading connections…</p>) : connections.length === 0 ? <p>No active connections.</p> : connections.map(connection => <section key={connection.id}>
          <h2>{connection.clientName || "MCP client"}</h2><p>Connected {new Date(connection.created_at).toLocaleDateString()} · expires {new Date(connection.expires_at).toLocaleDateString()}</p>
          <button disabled={pending} onClick={()=>void run(async()=>{
            const id = account.user!.id;
            await requestApi('disconnect',{id:connection.id,userId:id});
            if (currentUser.current === id) setConnections(items=>items.filter(item=>item.id!==connection.id));
          })}>Disconnect</button>
        </section>)}
      </>}
    </>}
  </main>;
}
