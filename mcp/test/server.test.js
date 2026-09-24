import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createListener } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/tools.js';
import { createApi, ApiError, readUiMessageStream } from '../src/api.js';
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
  assert.equal(tools.length, 7);
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
  assert.equal((await c.listTools()).tools.length, 19);
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
  t.after(() => c.close()); assert.equal((await c.listTools()).tools.length, 19);
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

test('report forwards activity, name and approach inputs the app sends', async t => {
  let query;
  const c = await pair(t, { hasAccount: false, get: async (_path, args) => { query = args; return {}; } });
  const r = await c.callTool({ name: 'get_conditions_report', arguments: { ...plan, activity: 'ski-touring', name: 'Mount Tom', trailhead_ft: 7000, ascent_min_per_kft: 30, approach_route: [{ minute: 0, elevation_ft: 7000.4 }, { minute: 185.6, elevation_ft: 13652 }] } });
  assert.equal(r.isError, undefined);
  assert.equal(query.activity, 'ski-touring'); assert.equal(query.name, 'Mount Tom'); assert.equal(query.trailhead_ft, 7000);
  assert.equal(query.approach_route, '0:7000,186:13652');
  const bad = await c.callTool({ name: 'get_conditions_report', arguments: { ...plan, activity: 'paragliding' } });
  assert.equal(bad.isError, true);
});
test('start-time and day-over-day comparisons use the app routes with the plan', async t => {
  const seen = [];
  const c = await pair(t, { hasAccount: false, get: async (path, args) => { seen.push([path, args]); return { comparison: { scenarios: [{ startTime: '05:00', evaluation: { hidden: true } }] } }; } });
  const r = await c.callTool({ name: 'compare_start_times', arguments: { ...plan, activity: 'hiking', extended: true } });
  assert.deepEqual(seen[0], ['/api/start-time-scenarios', { ...plan, travel_window_hours: 12, activity: 'hiking', set: 'extended' }]);
  assert.equal(r.structuredContent.data.comparison.scenarios[0].evaluation, undefined);
  await c.callTool({ name: 'get_day_over_day', arguments: plan });
  assert.equal(seen[1][0], '/api/day-over-day');
});
test('AI brief evaluates the plan report and sends its decision with units', async t => {
  let posted;
  const report = { generatedAt: '2026-09-16T12:00:00Z', partialData: true, weather: { temp: 40 }, evaluation: { decision: { level: 'CAUTION' } } };
  const c = await pair(t, { hasAccount: true, get: async (path, args) => { assert.equal(path, '/api/safety'); assert.equal(args.activity, 'hiking'); return report; },
    post: async (path, body, account) => { posted = { path, body, account }; return { narrative: 'BIG PICTURE: ...', evidence: [], validation: 'evidence_checked' }; } });
  const r = await c.callTool({ name: 'get_ai_brief', arguments: { ...plan, activity: 'hiking', units: { temperature: 'c' } } });
  assert.equal(posted.path, '/api/ai-brief'); assert.equal(posted.account, true);
  assert.equal(posted.body.decisionLevel, 'CAUTION'); assert.deepEqual(posted.body.units, { temperature: 'c', wind: 'mph', elevation: 'ft' });
  assert.equal(r.structuredContent.data.brief.validation, 'evidence_checked'); assert.equal(r.structuredContent.data.partialData, true);
  assert.equal(r.structuredContent.data.requestedPlan.activity, 'hiking');
});
test('AI brief refuses a report without an evaluation instead of guessing a decision', async t => {
  let posts = 0;
  const c = await pair(t, { hasAccount: true, get: async () => ({ weather: {} }), post: async () => { posts++; } });
  const r = await c.callTool({ name: 'get_ai_brief', arguments: plan });
  assert.equal(r.isError, true); assert.equal(r.structuredContent.error, 'EVALUATION_UNAVAILABLE'); assert.equal(posts, 0);
});
test('multi-day forecast sends an idempotency key and omits per-day full reports', async t => {
  let posted;
  const c = await pair(t, { hasAccount: true, post: async (path, body, account, options) => { posted = { path, body, account, options };
    return { days: [{ date: '2026-09-20', decision: 'GO', safetyData: { weather: {} } }], ranking: [], chatContext: 'x', failedCount: 0 }; } });
  const r = await c.callTool({ name: 'get_multi_day_forecast', arguments: { lat: 37.5, lon: -118.5, start_date: '2026-09-20', start: '06:00', duration_days: 3, activity: 'hiking', max_gust_mph: 30 } });
  assert.equal(posted.path, '/api/trip-forecasts'); assert.equal(posted.account, true);
  assert.match(posted.options.headers['Idempotency-Key'], /^[0-9a-f-]{36}$/u);
  assert.deepEqual({ ...posted.body }, { lat: 37.5, lon: -118.5, startDate: '2026-09-20', startTime: '06:00', durationDays: 3, requestedDays: 3, travelWindowHours: 12, objectiveName: undefined, activity: 'hiking', includeAvalanche: false, plan: { max_gust_mph: 30 } });
  const data = r.structuredContent.data;
  assert.equal(data.days[0].decision, 'GO'); assert.equal(data.days[0].safetyData, undefined); assert.equal(data.chatContext, undefined);
});
test('route tools call the account AI routes', async t => {
  const calls = [];
  const c = await pair(t, { hasAccount: true, get: async (path, args, account) => { calls.push([path, args, account]); return [{ name: 'East Face' }]; },
    post: async (path, body, account) => { calls.push([path, body, account]); return { analysis: 'ok', analysisSource: 'ai', waypoints: [] }; } });
  const s = await c.callTool({ name: 'suggest_routes', arguments: { peak: 'Mount Tom', lat: 37.5, lon: -118.5 } });
  assert.deepEqual(s.structuredContent.data.routes, [{ name: 'East Face' }]);
  const a = await c.callTool({ name: 'analyze_route', arguments: { peak: 'Mount Tom', route: 'East Face', lat: 37.5, lon: -118.5, date: '2026-09-20', start: '06:00', route_distance_rt_miles: 9 } });
  assert.equal(a.structuredContent.data.analysisSource, 'ai');
  assert.deepEqual(calls[0], ['/api/route-suggestions', { peak: 'Mount Tom', lat: 37.5, lon: -118.5 }, true]);
  assert.equal(calls[1][0], '/api/route-analysis'); assert.equal(calls[1][1].route_distance_rt_miles, 9); assert.equal(calls[1][1].travel_window_hours, 12); assert.equal(calls[1][2], true);
});
test('satellite snow analysis sends the report snowpack and returns the image as image content', async t => {
  let posted;
  const c = await pair(t, { hasAccount: true, get: async (_path, args) => { assert.equal(args.date, '2026-09-20'); return { snowpack: { snotel: { depthIn: 12 } } }; },
    post: async (path, body) => { posted = { path, body }; return { analysis: 'Patchy snow', imagery: { acquiredAt: '2026-09-10' }, image: 'data:image/png;base64,iVBORw0KGgo=' }; } });
  const r = await c.callTool({ name: 'analyze_satellite_snow', arguments: { lat: 37.5, lon: -118.5, date: '2026-09-20' } });
  assert.equal(posted.path, '/api/snow-vision'); assert.deepEqual(posted.body.snowpack, { snotel: { depthIn: 12 } });
  assert.equal(r.structuredContent.data.image, undefined); assert.equal(r.structuredContent.data.imageIncluded, true);
  assert.deepEqual(r.content[1], { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' });
});
test('POST requests send JSON, extra headers and the account bearer, and surface usage codes', async () => {
  let seen;
  const api = createApi({ baseUrl: 'https://api.example', accessToken: 'alice', fetchImpl: async (url, options) => { seen = { url, options };
    return new Response(JSON.stringify({ error: 'limit', code: 'AI_USAGE_LIMIT_REACHED' }), { status: 429 }); } });
  await assert.rejects(api.post('/api/ai-brief', { a: 1 }, true, { headers: { 'Idempotency-Key': 'k' } }), e => e.code === 'HTTP_429' && e.details.reason === 'AI_USAGE_LIMIT_REACHED');
  assert.equal(seen.options.method, 'POST'); assert.equal(seen.options.body, '{"a":1}');
  assert.equal(seen.options.headers['Content-Type'], 'application/json'); assert.equal(seen.options.headers['Idempotency-Key'], 'k');
  assert.equal(seen.options.headers.Authorization, 'Bearer alice');
  await assert.rejects(createApi({ baseUrl: 'https://api.example' }).post('/api/ai-brief', {}, true), e => e.code === 'ACCOUNT_NOT_CONFIGURED');
});

test('evaluate_plan returns the app evaluation, with display units, and only there', async t => {
  let query;
  const c = await pair(t, { hasAccount: false, get: async (_path, args) => { query = args; return { generatedAt: 'g', evaluation: { decision: { level: 'NO-GO' }, shareUrl: 'x' } }; } });
  const r = await c.callTool({ name: 'evaluate_plan', arguments: { ...plan, activity: 'hiking', max_gust_mph: 25, target_elevation_ft: 12000, units: { temperature: 'c', time_style: '24h' } } });
  assert.equal(query.temp_unit, 'c'); assert.equal(query.time_style, '24h'); assert.equal(query.max_gust_mph, 25); assert.equal(query.target_elevation_ft, 12000);
  assert.equal(r.structuredContent.data.evaluation.decision.level, 'NO-GO');
  assert.equal(r.structuredContent.data.evaluation.shareUrl, undefined, 'share links are still removed');
  assert.equal(r.structuredContent.data.requestedPlan.units, undefined);
});
test('service status trims health and keeps each part failure explicit', async t => {
  const c = await pair(t, { hasAccount: false, get: async path => {
    if (path === '/api/healthz') return { ok: true, version: '1.0.0', memory: { rssMb: 1 }, nodeVersion: 'v24', ai: { preferred: 'openai' }, database: { configured: true, connected: true, pool: 3 } };
    throw new ApiError('HTTP_503', 'Unavailable');
  } });
  const r = await c.callTool({ name: 'get_service_status', arguments: {} });
  const { health, featureFlags } = r.structuredContent.data;
  assert.deepEqual(health.database, { configured: true, connected: true }); assert.equal(health.memory, undefined); assert.equal(health.nodeVersion, undefined);
  assert.equal(featureFlags.failure.error, 'HTTP_503');
});
test('account read tools use the watch, baseline and usage routes', async t => {
  const id = 'd4167c22-61fa-4e49-8d68-0c538752967e', seen = [];
  const c = await pair(t, { hasAccount: true, get: async (path, args, account) => { seen.push([path, args, account]);
    if (path.endsWith('/checks')) return { checks: [{ id: 1 }], policy: { historyDays: 7 } };
    if (path.endsWith('/events')) return { events: [{ id: 2 }], policy: { historyDays: 7 } };
    return { ok: true }; } });
  const h = await c.callTool({ name: 'get_watch_history', arguments: { watch_id: id } });
  assert.deepEqual(h.structuredContent.data, { checks: [{ id: 1 }], events: [{ id: 2 }], policy: { historyDays: 7 } });
  await c.callTool({ name: 'get_comparison_baseline', arguments: { lat: 37.5, lon: -118.5, date: '2026-09-20', start: '06:00' } });
  await c.callTool({ name: 'get_account_usage', arguments: {} });
  assert.deepEqual(seen.slice(2), [
    ['/api/account/reports/comparison-baseline', { lat: 37.5, lon: -118.5, forecastDate: '2026-09-20', alpineStartTime: '06:00', excludeReportId: undefined }, true],
    ['/api/account/usage', {}, true],
  ]);
  assert.ok(seen.slice(0, 2).every(([path, , account]) => path.startsWith(`/api/account/objective-watches/${id}/`) && account));
  assert.equal((await c.callTool({ name: 'get_watch_history', arguments: { watch_id: 'not-a-uuid' } })).isError, true);
});
test('report assistant sends the report and history as chat messages', async t => {
  let posted;
  const c = await pair(t, { hasAccount: true, get: async () => ({ generatedAt: 'g', weather: {} }),
    post: async (path, body, account, options) => { posted = { path, body, account, options }; return { text: 'Winds ease after noon.', error: null, followUpSuggestions: ['When is the gust peak?'] }; } });
  const r = await c.callTool({ name: 'ask_report_assistant', arguments: { ...plan, question: 'When is it calmest?', history: [{ role: 'user', text: 'Hi' }, { role: 'assistant', text: 'Hello' }] } });
  assert.equal(posted.path, '/api/report-chat'); assert.equal(posted.account, true); assert.equal(posted.options.uiMessageStream, true);
  assert.equal(posted.body.contextType, 'report');
  assert.deepEqual(posted.body.messages.map(m => [m.role, m.parts[0].text]), [['user', 'Hi'], ['assistant', 'Hello'], ['user', 'When is it calmest?']]);
  assert.equal(r.structuredContent.data.answer, 'Winds ease after noon.');
  assert.deepEqual(r.structuredContent.data.followUpSuggestions, ['When is the gust peak?']);
});
test('report assistant stream errors become tool errors', async t => {
  const c = await pair(t, { hasAccount: true, get: async () => ({}), post: async () => ({ text: '', error: 'The report assistant is unavailable right now.', followUpSuggestions: [] }) });
  const r = await c.callTool({ name: 'ask_report_assistant', arguments: { ...plan, question: 'Hi' } });
  assert.equal(r.isError, true); assert.equal(r.structuredContent.error, 'ASSISTANT_UNAVAILABLE');
});
test('UI message streams are read into text, suggestions and errors', async () => {
  const body = ['data: {"type":"start"}', '', 'data: {"type":"text-delta","id":"t","delta":"Calm "}', '', 'data: {"type":"text-delta","id":"t","delta":"by noon."}', '',
    'data: {"type":"data-followUpSuggestions","data":{"suggestions":["Why?",3]}}', '', 'data: not json', '', 'data: [DONE]', ''].join('\n');
  assert.deepEqual(readUiMessageStream(body), { text: 'Calm by noon.', error: null, followUpSuggestions: ['Why?'] });
  assert.equal(readUiMessageStream('data: {"type":"error","errorText":"boom"}\n').error, 'boom');
  const api = createApi({ baseUrl: 'https://api.example', accessToken: 'a', fetchImpl: async (_url, options) => {
    assert.match(options.headers.Accept, /text\/event-stream/u);
    return new Response('data: {"type":"text-delta","delta":"ok"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  assert.equal((await api.post('/api/report-chat', {}, true, { uiMessageStream: true })).text, 'ok');
});
