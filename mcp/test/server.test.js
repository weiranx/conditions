import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createListener } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/tools.js';
import { createApi, ApiError } from '../src/api.js';
import { createHttpApp, readConfig } from '../src/index.js';

const token = 'cmcp_' + 'a'.repeat(43);
const plan = { lat: 37.5, lon: -118.5, date: '2026-09-20', start: '06:00' };
async function pair(t, api) {
  const server = createServer(api), client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); }); return client;
}
async function http(t) {
  const config = readConfig({});
  config.fetchImpl = async (_url, options) => options.headers.Authorization === `Bearer ${token}` ? Response.json({ userId: 'alice' }) : new Response('', { status: 401 });
  let app;
  const listener = createListener((req, res) => app(req, res)).listen(0, '127.0.0.1'); await new Promise(r => listener.once('listening', r));
  config.port = listener.address().port; config.publicUrl = `http://127.0.0.1:${config.port}`;
  app = createHttpApp(config, accessToken => ({ hasAccount: true, get: async () => ({ partialData: true, token: accessToken, weather: { temperature: null } }) }));
  t.after(() => { listener.closeAllConnections(); listener.close(); });
  const base = `http://127.0.0.1:${listener.address().port}`;
  const request = (path, options = {}) => fetch(base + path, { ...options, headers: options.headers, redirect: 'manual' });
  return { base, request, config };
}

test('public tools are read-only and account tools are absent without a session', async t => {
  const c = await pair(t, { hasAccount: false }); const { tools } = await c.listTools();
  assert.equal(tools.length, 3);
  assert.ok(tools.every(x => x.annotations.readOnlyHint && !x.annotations.destructiveHint));
});
test('report preserves nulls, zeroes, partial evidence and requested timing', async t => {
  let query;
  const c = await pair(t, { hasAccount: false, get: async (path, args) => { assert.equal(path, '/api/safety'); query = args; return { weather: { temperature: null, precipitation: 0 }, partialData: true, apiWarning: 'Forecast missing', generatedAt: '2026-09-16T12:00:00Z', evaluation: { decision: { level: 'GO' } } }; } });
  const r = await c.callTool({ name: 'get_conditions_report', arguments: plan });
  assert.equal(r.structuredContent.data.evaluation, undefined, 'the app evaluation is not evidence');
  assert.equal(r.structuredContent.data.weather.temperature, null); assert.equal(r.structuredContent.data.weather.precipitation, 0);
  assert.equal(r.structuredContent.data.partialData, true); assert.equal(query.start, '06:00'); assert.equal(query.travel_window_hours, 12);
});
test('impossible dates, invalid times and out-of-range coordinates never reach backend', async t => {
  let calls = 0; const c = await pair(t, { get: async () => { calls++; } });
  for (const args of [{ ...plan, date: '2026-02-30' }, { ...plan, start: '24:30' }, { ...plan, lat: 91 }]) {
    const r = await c.callTool({ name: 'get_conditions_report', arguments: args }); assert.equal(r.isError, true);
  }
  assert.equal(calls, 0);
});
test('comparison preserves partial failures and requested plan identities', async t => {
  const c = await pair(t, { get: async (_path, args) => { if (args.start === '08:00') throw new ApiError('HTTP_503', 'Unavailable'); return { weather: null }; } });
  const r = await c.callTool({ name: 'compare_conditions_plans', arguments: { plans: [plan, { ...plan, start: '08:00' }] } });
  const rows = r.structuredContent.data.comparisons;
  assert.equal(rows[0].requestedPlan.start, '06:00'); assert.equal(rows[1].failure.error, 'HTTP_503'); assert.equal(rows[0].report.weather, null);
});
test('all-plan failure is marked as a tool error', async t => {
  const c = await pair(t, { get: async () => { throw new ApiError('HTTP_503', 'Unavailable'); } });
  const r = await c.callTool({ name: 'compare_conditions_plans', arguments: { plans: [plan, plan] } }); assert.equal(r.isError, true);
});
test('private report tools use account routes and remove share tokens', async t => {
  const id = 'd4167c22-61fa-4e49-8d68-0c538752967e';
  const c = await pair(t, { hasAccount: true, get: async (path, _args, account) => { assert.equal(account, true); assert.equal(path, `/api/account/reports/${id}`); return { report: { id, shareToken: 'secret-share', snapshot: { weather: null } } }; } });
  assert.equal((await c.listTools()).tools.length, 6);
  const r = await c.callTool({ name: 'get_saved_report', arguments: { report_id: id } }); assert.equal(r.structuredContent.data.report.shareToken, undefined);
});
test('upstream session handling, redirect rejection, and safe expired-session errors', async () => {
  const api = createApi({ baseUrl: 'https://conditions.example', session: 'private-session', fetchImpl: async (url, options) => {
    assert.equal(url.origin, 'https://conditions.example'); assert.equal(options.headers.Cookie, 'bc_session=private-session'); assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify({ error: 'do not expose private-session' }), { status: 401 });
  } });
  await assert.rejects(api.get('/api/account/reports', {}, true), e => e.code === 'HTTP_401' && !e.message.includes('private-session'));
  await assert.rejects(api.get('https://other.example/api/reports'));
});
test('upstream limits oversized responses and refuses missing account sessions', async () => {
  const api = createApi({ baseUrl: 'https://conditions.example', fetchImpl: async () => new Response('a'.repeat(2_000_001)) });
  await assert.rejects(api.get('/api/safety'), e => e.code === 'RESPONSE_TOO_LARGE');
  await assert.rejects(api.get('/api/account/reports', {}, true), e => e.code === 'ACCOUNT_NOT_CONFIGURED');
});
test('HTTP refuses unauthenticated requests and untrusted origins', async t => {
  const { request } = await http(t);
  const denied = await request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 401); assert.match(denied.headers.get('www-authenticate'), /resource_metadata/u);
  assert.equal((await request('/health', { headers: { Origin: 'https://evil.example' } })).status, 403);
});
test('SDK client initializes, lists tools and retrieves report over authenticated HTTP', async t => {
  const { base } = await http(t); const c = new Client({ name: 'integration-test', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  t.after(() => c.close()); assert.equal((await c.listTools()).tools.length, 6);
  const r = await c.callTool({ name: 'get_conditions_report', arguments: plan }); assert.equal(r.structuredContent.data.partialData, true);
});
test('HTTP rejects invalid and revoked account tokens', async t => {
  const { request } = await http(t);
  assert.equal((await request('/mcp', { headers: { Authorization: 'Bearer cmcp_' + 'b'.repeat(43) } })).status, 401);
});
test('HTTP configuration rejects shared credentials', () => {
  assert.throws(() => readConfig({ MCP_BEARER_TOKEN: 'legacy' }), /Shared/u);
  assert.throws(() => readConfig({ CONDITIONS_SESSION: 'legacy' }), /Shared/u);
  assert.throws(() => createApi({ baseUrl: 'http://public.example' }), /HTTPS/u);
});
test('each API instance forwards only its own account bearer', async () => {
  const seen = [];
  const fetchImpl = async (_url, options) => { seen.push(options.headers); return Response.json({ok:true}); };
  await Promise.all(['alice','bob'].map(accessToken => createApi({baseUrl:'https://api.example',accessToken,fetchImpl}).get('/api/account/reports', {}, true)));
  assert.deepEqual(seen.map(h=>h.Authorization).sort(), ['Bearer alice','Bearer bob']);
  assert.ok(seen.every(h=>!h.Cookie));
});
