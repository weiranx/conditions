import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import { createApi } from './api.js';
import { createServer } from './tools.js';
import { installAuth } from './auth.js';

export function readConfig(env = process.env) {
  if (env.CONDITIONS_SESSION || env.MCP_BEARER_TOKEN || env.MCP_OWNER_PASSWORD) throw new Error('Shared credentials are no longer supported. Connect a Conditions account with OAuth.');
  const config = { baseUrl: env.CONDITIONS_API_URL || 'https://apivps.conditions.weiranxiong.com', publicUrl: env.MCP_PUBLIC_URL || 'http://127.0.0.1:8104', host: env.MCP_HOST || '127.0.0.1', port: Number(env.PORT || 8104) };
  for (const value of [config.baseUrl, config.publicUrl]) {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname)))) throw new Error('MCP and API URLs must be HTTPS origins, or loopback HTTP for development.');
  }
  config.baseUrl = new URL(config.baseUrl).origin;
  config.publicUrl = new URL(config.publicUrl).origin;
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Invalid PORT.');
  return config;
}

export function createHttpApp(config, apiFactory = token => createApi({ ...config, accessToken: token })) {
  const app = express(); app.disable('x-powered-by');
  const allowedHosts = new Set([new URL(config.publicUrl).host, `127.0.0.1:${config.port}`, `localhost:${config.port}`]);
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'" });
    if (!allowedHosts.has(req.headers.host) || (req.headers.origin && req.headers.origin !== config.publicUrl)) return res.status(403).json({ error: 'untrusted_origin' });
    next();
  });
  app.use(express.json({ limit: '32kb' }), express.urlencoded({ extended: false, limit: '8kb' }));
  const authenticate = installAuth(app, config);
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'conditions-mcp', accountToolsConfigured: true, note: 'Process health only; verify upstream with a tool call.' }));
  app.use('/mcp', authenticate, rateLimit({ windowMs: 60000, limit: 60, keyGenerator: req => req.conditionsUserId, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.post('/mcp', async (req, res) => {
    const server = createServer(apiFactory(req.conditionsToken));
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
