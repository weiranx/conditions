import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { runSmokeTest } from '../smoke-test.mjs';

// One loopback server stands in for the API, MCP and frontend; each test
// breaks one piece through `overrides`.
async function fakeProduction(t, overrides = {}) {
  const state = {
    health: () => ({ ok: true, timestamp: new Date().toISOString(), database: { configured: true, connected: true } }),
    corsOrigin: null, // null echoes the request's Origin, like a correct CORS_ORIGIN
    authServerStatus: 200,
    mcpStatus: 401,
    assetStatus: 200,
    ...overrides,
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/healthz' || url.pathname === '/api/healthz') {
      const allowed = state.corsOrigin ?? req.headers.origin;
      return json(200, state.health(), req.headers.origin ? { 'access-control-allow-origin': allowed } : {});
    }
    if (url.pathname === '/api/safety') return json(200, { evaluation: { verdict: 'go' } });
    if (url.pathname === '/.well-known/oauth-protected-resource') return json(200, { resource: 'https://api.example.test/mcp' });
    if (url.pathname === '/.well-known/oauth-authorization-server') return json(state.authServerStatus, { issuer: 'https://api.example.test' });
    if (url.pathname === '/mcp') {
      return json(state.mcpStatus, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer resource_metadata="https://api.example.test/.well-known/oauth-protected-resource"' });
    }
    if (url.pathname === '/assets/index-abc.js') {
      res.writeHead(state.assetStatus);
      return res.end('console.log(1)');
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><div id="root"></div><script type="module" crossorigin src="/assets/index-abc.js"></script>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

async function smoke(options) {
  const lines = [];
  const failures = await runSmokeTest(
    { frontend: null, mcp: true, safety: true, healthWaitMs: 0, ...options },
    { log: (line) => lines.push(line), sleep: async () => {} },
  );
  return { failures, lines, output: lines.join('\n') };
}

test('every check passes against a healthy deployment', async (t) => {
  const origin = await fakeProduction(t);
  // The fake frontend is served by the same loopback server as the API.
  const { failures, lines, output } = await smoke({ api: origin, frontend: origin });
  assert.equal(failures, 0, output);
  assert.equal(lines.length, 9);
  assert.match(output, /✓ API health — ok, database connected/);
  assert.match(output, /✓ Frontend script bundle — \/assets\/index-abc\.js/);
});

for (const [name, overrides, pattern] of [
  ['a disconnected database', { health: () => ({ ok: true, timestamp: new Date().toISOString(), database: { configured: true, connected: false } }) }, /✗ API health — .*not connected/],
  ['a stale cached health response', { health: () => ({ ok: true, timestamp: '2020-01-01T00:00:00Z' }) }, /✗ API health — .*not current/],
  ['a CORS origin mismatch', { corsOrigin: 'https://other.example.test' }, /✗ CORS allows the frontend — .*CORS_ORIGIN/],
  ['missing MCP OAuth settings', { authServerStatus: 404 }, /✗ MCP OAuth authorization-server metadata — .*MCP_PUBLIC_URL/],
  ['an MCP route that bypasses OAuth', { mcpStatus: 200 }, /✗ MCP endpoint requires OAuth/],
  ['a frontend index whose bundle is missing', { assetStatus: 404 }, /✗ Frontend script bundle — .*out of sync/],
]) {
  test(`fails on ${name}`, async (t) => {
    const origin = await fakeProduction(t, overrides);
    const { failures, output } = await smoke({ api: origin, frontend: origin });
    assert.equal(failures, 1, output);
    assert.match(output, pattern);
  });
}

test('--no-mcp and --no-safety skip those checks', async (t) => {
  const origin = await fakeProduction(t, { authServerStatus: 404 });
  const { failures, lines } = await smoke({ api: origin, mcp: false, safety: false });
  assert.equal(failures, 0);
  assert.deepEqual(lines.map((line) => line.split(' — ')[0]), ['✓ API health']);
});

test('retries the health check until the deadline', async (t) => {
  let calls = 0;
  const origin = await fakeProduction(t, {
    health: () => (++calls < 3 ? { ok: false } : { ok: true, timestamp: new Date().toISOString() }),
  });
  const { failures, output } = await smoke({ api: origin, mcp: false, safety: false, healthWaitMs: 60_000 });
  assert.equal(failures, 0, output);
  assert.equal(calls, 3);
});
