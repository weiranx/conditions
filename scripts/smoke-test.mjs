#!/usr/bin/env node
// Verifies production through its public URLs (DNS, TLS, nginx, CORS, backend,
// PostgreSQL, MCP and the frontend), the way a browser or MCP client reaches it.
// Run by the deploy workflow after each release; safe to run by hand:
//
//   node scripts/smoke-test.mjs --api https://api.example.com --frontend https://app.example.com
//
// Options (or the environment variables in brackets):
//   --api URL        Public API origin [SMOKE_API_URL] (required)
//   --frontend URL   Public frontend origin [SMOKE_FRONTEND_URL]; also used for the CORS check
//   --no-mcp         Skip the MCP checks [SMOKE_SKIP_MCP=1]
//   --no-safety      Skip the end-to-end /api/safety report [SMOKE_SKIP_SAFETY=1]
//   --health-wait S  Seconds to keep retrying the health check [SMOKE_HEALTH_WAIT_SECONDS] (default 60)
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const USER_AGENT = 'conditions-deploy-smoke-test';
// Mount Rainier: covered by NOAA, the NWAC avalanche center and SNOTEL.
const SAFETY_POINT = { lat: '46.8523', lon: '-121.7603' };

function readOptions(argv, env) {
  const { values } = parseArgs({
    args: argv,
    options: {
      api: { type: 'string' },
      frontend: { type: 'string' },
      'no-mcp': { type: 'boolean' },
      'no-safety': { type: 'boolean' },
      'health-wait': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const origin = (value, name) => {
    if (!value) return null;
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      throw new Error(`${name} must be an HTTPS origin.`);
    }
    return url.origin;
  };
  const healthWait = Number(values['health-wait'] ?? env.SMOKE_HEALTH_WAIT_SECONDS ?? 60);
  if (!Number.isFinite(healthWait) || healthWait < 0) throw new Error('--health-wait must be a number of seconds.');
  return {
    help: Boolean(values.help),
    api: origin(values.api ?? env.SMOKE_API_URL, '--api'),
    frontend: origin(values.frontend ?? env.SMOKE_FRONTEND_URL, '--frontend'),
    mcp: !(values['no-mcp'] || env.SMOKE_SKIP_MCP === '1'),
    safety: !(values['no-safety'] || env.SMOKE_SKIP_SAFETY === '1'),
    healthWaitMs: healthWait * 1000,
  };
}

async function request(url, { timeoutMs = 15_000, headers = {} } = {}) {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, ...headers },
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, headers: response.headers, text, json };
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function snippet(text) {
  return JSON.stringify(text.slice(0, 160));
}

function buildChecks(options, sleep) {
  const { api, frontend } = options;
  const checks = [];
  const add = (name, run) => checks.push({ name, run });

  add('API health', async () => {
    const deadline = Date.now() + options.healthWaitMs;
    let last;
    for (;;) {
      try {
        const res = await request(`${api}/healthz`, { timeoutMs: 10_000 });
        expect(res.status === 200, `GET /healthz returned ${res.status}: ${snippet(res.text)}`);
        expect(res.json?.ok === true, `/healthz did not report ok: ${snippet(res.text)}`);
        const age = Math.abs(Date.now() - Date.parse(res.json.timestamp));
        expect(age < 5 * 60_000, `/healthz timestamp ${res.json.timestamp} is not current (cached or stale proxy?)`);
        const db = res.json.database;
        if (db?.configured) expect(db.connected === true, '/healthz reports PostgreSQL is configured but not connected');
        return db?.configured ? 'ok, database connected' : 'ok (no database configured)';
      } catch (error) {
        last = error;
        if (Date.now() >= deadline) throw last;
        await sleep(5_000);
      }
    }
  });

  if (frontend) {
    add('CORS allows the frontend', async () => {
      const res = await request(`${api}/api/healthz`, { headers: { origin: frontend } });
      const allowed = res.headers.get('access-control-allow-origin');
      expect(allowed === frontend, `Access-Control-Allow-Origin is ${JSON.stringify(allowed)}, expected ${frontend}; check CORS_ORIGIN`);
    });
  }

  if (options.safety) {
    add('Conditions report (/api/safety)', async () => {
      // UTC's date is within a day of the objective's, which any forecast covers.
      const query = new URLSearchParams({ ...SAFETY_POINT, date: new Date().toISOString().slice(0, 10) });
      const res = await request(`${api}/api/safety?${query}`, { timeoutMs: 60_000 });
      expect(res.status === 200, `GET /api/safety returned ${res.status}: ${snippet(res.text)}`);
      expect(res.json && typeof res.json.evaluation === 'object' && res.json.evaluation,
        `/api/safety has no plan evaluation: ${snippet(res.text)}`);
      return res.json.partialData ? `partial data: ${res.json.apiWarning ?? 'an upstream provider failed'}` : 'complete';
    });
  }

  if (options.mcp) {
    add('MCP protected-resource metadata', async () => {
      const res = await request(`${api}/.well-known/oauth-protected-resource`);
      expect(res.status === 200, `returned ${res.status}: ${snippet(res.text)}`);
      expect(typeof res.json?.resource === 'string' && res.json.resource.endsWith('/mcp'),
        `unexpected metadata: ${snippet(res.text)}`);
    });
    add('MCP OAuth authorization-server metadata', async () => {
      const res = await request(`${api}/.well-known/oauth-authorization-server`);
      expect(res.status === 200, `returned ${res.status}; is MCP_PUBLIC_URL configured in the backend .env? ${snippet(res.text)}`);
      expect(typeof res.json?.issuer === 'string', `unexpected metadata: ${snippet(res.text)}`);
    });
    add('MCP endpoint requires OAuth', async () => {
      const res = await request(`${api}/mcp`);
      expect(res.status === 401, `GET /mcp returned ${res.status}, expected 401: ${snippet(res.text)}`);
      expect(/resource_metadata=/.test(res.headers.get('www-authenticate') ?? ''),
        'GET /mcp did not answer with the MCP server\'s WWW-Authenticate challenge');
    });
  }

  if (frontend) {
    let indexHtml = '';
    add('Frontend index', async () => {
      const res = await request(`${frontend}/`);
      expect(res.status === 200, `GET / returned ${res.status}`);
      expect(res.text.includes('id="root"'), 'index.html has no #root element');
      indexHtml = res.text;
    });
    add('Frontend deep link falls back to the app', async () => {
      const res = await request(`${frontend}/smoke-test/deep-link`, { headers: { accept: 'text/html' } });
      expect(res.status === 200 && res.text.includes('id="root"'), `deep link returned ${res.status}`);
    });
    add('Frontend script bundle', async () => {
      const script = indexHtml.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
      expect(script, 'index.html references no script bundle');
      const res = await request(new URL(script, `${frontend}/`).href);
      expect(res.status === 200, `GET ${script} returned ${res.status}; the index and its assets are out of sync`);
      return script;
    });
  }

  return checks;
}

export async function runSmokeTest(options, { log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let failures = 0;
  for (const check of buildChecks(options, sleep)) {
    try {
      const detail = await check.run();
      log(`✓ ${check.name}${detail ? ` — ${detail}` : ''}`);
    } catch (error) {
      failures += 1;
      log(`✗ ${check.name} — ${error.cause?.message ?? error.message}`);
    }
  }
  return failures;
}

async function main() {
  let options;
  try {
    options = readOptions(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (options.help) {
    console.log('Usage: node scripts/smoke-test.mjs --api URL [--frontend URL] [--no-mcp] [--no-safety] [--health-wait SECONDS]');
    return;
  }
  if (!options.api) {
    console.error('--api (or SMOKE_API_URL) is required.');
    process.exit(2);
  }
  console.log(`==> Smoke testing ${options.api}${options.frontend ? ` and ${options.frontend}` : ''}`);
  const failures = await runSmokeTest(options);
  if (failures) {
    console.error(`==> ${failures} smoke check(s) failed.`);
    process.exit(1);
  }
  console.log('==> All smoke checks passed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
