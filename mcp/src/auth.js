import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';

const hash = value => createHash('sha256').update(String(value)).digest();
export const secretsEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && timingSafeEqual(hash(a), hash(b));
const random = () => randomBytes(32).toString('base64url');
const escape = value => String(value).replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Personal, statically registered OAuth client; no dynamic registration or anonymous consent.
// Pending requests and issued tokens are bounded, expiring, and revoked on process restart.
export function installAuth(app, config) {
  const { publicUrl, bearerToken, oauth } = config;
  const resource = `${publicUrl}/mcp`;
  const pending = new Map(), codes = new Map(), tokens = new Map();
  const prune = () => { for (const map of [pending, codes, tokens]) for (const [key, value] of map) if (value.expires <= Date.now()) map.delete(key); };
  const put = (map, key, value) => { prune(); if (map.size >= 1000) return false; map.set(key, value); return true; };
  app.get('/.well-known/oauth-protected-resource', (_req, res) => res.json({ resource, authorization_servers: oauth ? [publicUrl] : [], scopes_supported: ['conditions:read'] }));
  if (oauth) {
    app.get('/.well-known/oauth-authorization-server', (_req, res) => res.json({ issuer: publicUrl, authorization_endpoint: `${publicUrl}/authorize`, token_endpoint: `${publicUrl}/oauth/token`, response_types_supported: ['code'], grant_types_supported: ['authorization_code'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'], scopes_supported: ['conditions:read'] }));
    app.use(['/authorize', '/oauth/token'], rateLimit({ windowMs: 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }));
    app.get('/authorize', (req, res) => {
      const q = req.query;
      if (q.client_id !== oauth.clientId || q.response_type !== 'code' || !oauth.redirectUris.includes(q.redirect_uri) || q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/u.test(q.code_challenge || '') || (q.resource !== undefined && q.resource !== resource) || (q.scope !== undefined && q.scope !== 'conditions:read') || typeof q.state !== 'string' || q.state.length > 1024) return res.status(400).send('Invalid authorization request.');
      const nonce = random();
      if (!put(pending, hash(nonce).toString('hex'), { redirect: q.redirect_uri, state: q.state, challenge: q.code_challenge, expires: Date.now() + 600000 })) return res.status(503).send('Try later.');
      res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Connect Conditions</title></head><body><h1>Connect Conditions</h1><p>Allow this client to read forecasts${config.session ? ' and your configured Conditions account’s saved reports and watches' : ''}.</p><p>Client: ${escape(oauth.clientId)}</p><p>Return to: ${escape(new URL(q.redirect_uri).origin)}</p><form method="post" action="/authorize"><input type="hidden" name="nonce" value="${nonce}"><label>Conditions MCP owner password <input name="password" type="password" required autocomplete="current-password"></label><button type="submit">Authorize read access</button></form></body></html>`);
    });
    app.post('/authorize', (req, res) => {
      prune(); const key = hash(req.body.nonce || '').toString('hex'), item = pending.get(key);
      if (!item || !secretsEqual(req.body.password, oauth.ownerPassword)) return res.status(401).send('Invalid or expired authorization.');
      pending.delete(key);
      const code = random();
      if (!put(codes, hash(code).toString('hex'), { ...item, expires: Date.now() + 60000 })) return res.status(503).send('Try later.');
      const target = new URL(item.redirect); target.searchParams.set('code', code); target.searchParams.set('state', item.state);
      res.redirect(303, target.href);
    });
    app.post('/oauth/token', (req, res) => {
      prune(); let { client_id: id, client_secret: secret } = req.body;
      if (req.headers.authorization?.startsWith('Basic ')) {
        try { const decoded = Buffer.from(req.headers.authorization.slice(6), 'base64').toString(); const index = decoded.indexOf(':'); id = decodeURIComponent(decoded.slice(0, index)); secret = decodeURIComponent(decoded.slice(index + 1)); } catch { return res.status(401).json({ error: 'invalid_client' }); }
      }
      if (id !== oauth.clientId || !secretsEqual(secret, oauth.clientSecret)) return res.status(401).json({ error: 'invalid_client' });
      if (req.body.grant_type !== 'authorization_code') return res.status(400).json({ error: 'unsupported_grant_type' });
      const key = hash(req.body.code || '').toString('hex'), item = codes.get(key);
      const verifier = req.body.code_verifier;
      if (!item || item.redirect !== req.body.redirect_uri || !/^[A-Za-z0-9._~-]{43,128}$/u.test(verifier || '') || hash(verifier).toString('base64url') !== item.challenge || (req.body.resource !== undefined && req.body.resource !== resource)) return res.status(400).json({ error: 'invalid_grant' });
      codes.delete(key); const token = random();
      if (!put(tokens, hash(token).toString('hex'), { expires: Date.now() + 3600000 })) return res.status(503).json({ error: 'temporarily_unavailable' });
      res.json({ access_token: token, token_type: 'Bearer', expires_in: 3600, scope: 'conditions:read' });
    });
  }
  return (req, res, next) => {
    prune(); const token = /^Bearer (\S+)$/u.exec(req.headers.authorization || '')?.[1];
    if (token && ((bearerToken && secretsEqual(token, bearerToken)) || tokens.has(hash(token).toString('hex')))) return next();
    res.set('WWW-Authenticate', `Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource"`);
    res.status(401).json({ error: 'unauthorized' });
  };
}
