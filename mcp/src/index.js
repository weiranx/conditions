import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import { createApi } from './api.js';
import { createServer } from './tools.js';
import { installAuth } from './auth.js';

export function readConfig(env = process.env) {
  const config = { baseUrl: env.CONDITIONS_API_URL || 'https://apivps.conditions.weiranxiong.com', session: env.CONDITIONS_SESSION || '', bearerToken: env.MCP_BEARER_TOKEN || '', publicUrl: env.MCP_PUBLIC_URL || 'http://127.0.0.1:8104', host: env.MCP_HOST || '127.0.0.1', port: Number(env.PORT || 8104) };
  const url = new URL(config.publicUrl);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw new Error('MCP_PUBLIC_URL must be an HTTPS origin, or loopback HTTP for local development.');
  config.publicUrl = url.origin;
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Invalid PORT.');
  if (config.bearerToken && config.bearerToken.length < 32) throw new Error('MCP_BEARER_TOKEN must contain at least 32 characters.');
  const fields = ['MCP_OAUTH_CLIENT_ID', 'MCP_OAUTH_CLIENT_SECRET', 'MCP_OWNER_PASSWORD', 'MCP_OAUTH_REDIRECT_URIS'];
  if (fields.some(key => env[key])) {
    if (!fields.every(key => env[key])) throw new Error('All four OAuth settings are required.');
    const redirectUris = env.MCP_OAUTH_REDIRECT_URIS.split(',').map(s => s.trim());
    for (const uri of redirectUris) { const u = new URL(uri); if (u.protocol !== 'https:' || u.username || u.password || u.hash) throw new Error('OAuth callback URLs must be exact HTTPS URLs without credentials or fragments.'); }
    if (env.MCP_OAUTH_CLIENT_SECRET.length < 32 || env.MCP_OWNER_PASSWORD.length < 32) throw new Error('OAuth secrets must contain at least 32 characters.');
    config.oauth = { clientId: env.MCP_OAUTH_CLIENT_ID, clientSecret: env.MCP_OAUTH_CLIENT_SECRET, ownerPassword: env.MCP_OWNER_PASSWORD, redirectUris };
  }
  return config;
}

export function createHttpApp(config, api = createApi(config)) {
  if (!config.bearerToken && !config.oauth) throw new Error('HTTP requires a bearer token or configured OAuth client.');
  const app = express(); app.disable('x-powered-by');
  const allowedHosts = new Set([new URL(config.publicUrl).host, `127.0.0.1:${config.port}`, `localhost:${config.port}`]);
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'" });
    if (!allowedHosts.has(req.headers.host) || (req.headers.origin && req.headers.origin !== config.publicUrl)) return res.status(403).json({ error: 'untrusted_origin' });
    next();
  });
  app.use(express.json({ limit: '32kb' }), express.urlencoded({ extended: false, limit: '8kb' }));
  const authenticate = installAuth(app, config);
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'conditions-mcp', accountToolsConfigured: api.hasAccount, note: 'Process health only; verify upstream with a tool call.' }));
  app.use('/mcp', authenticate, rateLimit({ windowMs: 60000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.post('/mcp', async (req, res) => {
    const server = createServer(api);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch { if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32603, message: 'MCP request failed.' } }); }
  });
  app.all('/mcp', (_req, res) => res.status(405).set('Allow', 'POST').end());
  app.use((error, _req, res, _next) => res.status(error.status === 413 ? 413 : 400).json({ error: 'invalid_request' }));
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = readConfig();
  if (process.argv.includes('--stdio')) await createServer(createApi(config)).connect(new StdioServerTransport());
  else {
    const listener = createHttpApp(config).listen(config.port, config.host, () => console.error(`Conditions MCP listening on ${config.host}:${config.port}`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { listener.close(); listener.closeAllConnections(); });
  }
}
