// @env production
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

const ORIGIN = 'https://conditions.example';
const settle = () => new Promise((done) => setImmediate(done));
const js = (body = 'export {}') => new Response(body, { status: 200, headers: { 'content-type': 'text/javascript' } });
const html = () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });

// Runs the real public/sw.js against a small Cache API and network.
async function loadWorker({ network = {}, cached = {} } = {}) {
  const source = await readFile(resolve(process.cwd(), 'public/sw.js'), 'utf8');
  const listeners = {};
  const stores = new Map();
  const fetched = [];
  const keyOf = (request) => new URL(typeof request === 'string' ? request : request.url, ORIGIN).href;
  const store = (name) => stores.get(name) ?? stores.set(name, new Map()).get(name);
  const network_ = async (request) => {
    const url = keyOf(request);
    fetched.push(new URL(url).pathname);
    const answer = network[new URL(url).pathname];
    if (answer === undefined) return new Response('missing', { status: 404 });
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer() : answer.clone();
  };
  const caches = {
    async open(name) {
      const entries = store(name);
      return {
        put: async (request, response) => { entries.set(keyOf(request), response); },
        delete: async (request) => entries.delete(keyOf(request)),
        add: async (request) => { entries.set(keyOf(request), await network_(request)); },
        addAll: async (requests) => { for (const request of requests) entries.set(keyOf(request), await network_(request)); },
      };
    },
    async match(request) {
      for (const entries of stores.values()) {
        const hit = entries.get(keyOf(request));
        if (hit) return hit.clone();
      }
      return undefined;
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const self = { location: { origin: ORIGIN }, addEventListener: (type, listener) => { listeners[type] = listener; }, skipWaiting() {}, clients: { claim() {} } };
  vm.runInContext(source, vm.createContext({ self, caches, fetch: network_, URL, Response, Promise, console }));
  for (const [path, response] of Object.entries(cached)) store('backcountry-conditions-shell-v3').set(`${ORIGIN}${path}`, response);

  const dispatch = async (path, { mode = 'no-cors', method = 'GET', origin = ORIGIN } = {}) => {
    let answer = null;
    const waiting = [];
    listeners.fetch({
      request: { url: `${origin}${path}`, method, mode },
      respondWith: (promise) => { answer = Promise.resolve(promise); },
      waitUntil: (promise) => waiting.push(promise),
    });
    const response = answer ? await answer : null;
    await Promise.all(waiting);
    await settle();
    return { handled: answer !== null, response };
  };
  const install = async () => {
    const waiting = [];
    listeners.install({ waitUntil: (promise) => waiting.push(promise) });
    await Promise.all(waiting);
  };
  const cachedCopy = (path) => store('backcountry-conditions-shell-v3').get(`${ORIGIN}${path}`);
  return { dispatch, install, fetched, cachedCopy, stores };
}

test('a hashed asset already in the cache is served without asking the network again', async () => {
  const worker = await loadWorker({ cached: { '/assets/FieldApp-abc123.js': js('cached') } });
  const { handled, response } = await worker.dispatch('/assets/FieldApp-abc123.js');

  assert.equal(handled, true);
  assert.equal(await response.text(), 'cached');
  assert.deepEqual(worker.fetched, []);
});

test('a hashed asset that is not cached yet is fetched once and kept', async () => {
  const worker = await loadWorker({ network: { '/assets/Report-def456.js': js('fresh') } });
  const { response } = await worker.dispatch('/assets/Report-def456.js');

  assert.equal(await response.text(), 'fresh');
  assert.deepEqual(worker.fetched, ['/assets/Report-def456.js']);
  assert.equal(await worker.cachedCopy('/assets/Report-def456.js').clone().text(), 'fresh');

  await worker.dispatch('/assets/Report-def456.js');
  assert.deepEqual(worker.fetched, ['/assets/Report-def456.js'], 'the second load comes from the cache');
});

test('a page returned in place of a missing asset is never kept or trusted', async () => {
  const worker = await loadWorker({ network: { '/assets/Gone-000000.js': html(), '/assets/Bad-111111.js': html() } });

  await worker.dispatch('/assets/Gone-000000.js');
  assert.equal(worker.cachedCopy('/assets/Gone-000000.js'), undefined);

  // A copy that was cached before is dropped and fetched again.
  worker.stores.get('backcountry-conditions-shell-v3').set(`${ORIGIN}/assets/Bad-111111.js`, html());
  const { response } = await worker.dispatch('/assets/Bad-111111.js');
  assert.match(response.headers.get('content-type'), /html/);
  assert.deepEqual(worker.fetched, ['/assets/Gone-000000.js', '/assets/Bad-111111.js']);
  assert.equal(worker.cachedCopy('/assets/Bad-111111.js'), undefined);
});

test('a file that keeps its name is served from the cache and refreshed behind it', async () => {
  const worker = await loadWorker({
    network: { '/manifest.webmanifest': new Response('new', { status: 200, headers: { 'content-type': 'application/manifest+json' } }) },
    cached: { '/manifest.webmanifest': new Response('old', { status: 200, headers: { 'content-type': 'application/manifest+json' } }) },
  });
  const { response } = await worker.dispatch('/manifest.webmanifest');

  assert.equal(await response.text(), 'old');
  assert.deepEqual(worker.fetched, ['/manifest.webmanifest']);
  assert.equal(await worker.cachedCopy('/manifest.webmanifest').clone().text(), 'new');
});

test('refreshing behind a cached file offline is not an error', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const worker = await loadWorker({
      network: { '/summitsafe-icon.svg': new TypeError('Failed to fetch') },
      cached: { '/summitsafe-icon.svg': new Response('<svg/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } }) },
    });
    const { response } = await worker.dispatch('/summitsafe-icon.svg');
    assert.equal(await response.text(), '<svg/>');
    await settle();
    await settle();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(unhandled, []);
});

test('a file that is not cached comes from the network, and an outage shows the failure', async () => {
  const worker = await loadWorker({ network: { '/hero-rainier.jpg': new Response('jpeg', { status: 200, headers: { 'content-type': 'image/jpeg' } }) } });
  assert.equal(await (await worker.dispatch('/hero-rainier.jpg')).response.text(), 'jpeg');

  const offline = await loadWorker({ network: { '/og.png': new TypeError('Failed to fetch') } });
  await assert.rejects(offline.dispatch('/og.png'), /Failed to fetch/);
});

test('API calls, other origins and non-GET requests are left alone', async () => {
  const worker = await loadWorker();
  assert.equal((await worker.dispatch('/api/feature-flags')).handled, false);
  assert.equal((await worker.dispatch('/assets/app.js', { origin: 'https://cdn.example' })).handled, false);
  assert.equal((await worker.dispatch('/assets/app.js', { method: 'POST' })).handled, false);
  assert.deepEqual(worker.fetched, []);
});

test('pages come from the network first and from the cache when offline', async () => {
  const worker = await loadWorker({ network: { '/planner': html() }, cached: { '/index.html': new Response('shell', { status: 200, headers: { 'content-type': 'text/html' } }) } });
  const online = await worker.dispatch('/planner', { mode: 'navigate' });
  assert.match(online.response.headers.get('content-type'), /html/);
  assert.deepEqual(worker.fetched, ['/planner']);
  assert.equal(await worker.cachedCopy('/index.html').clone().text(), '<!doctype html>');

  const offline = await loadWorker({ network: { '/planner': new TypeError('Failed to fetch') }, cached: { '/index.html': new Response('shell', { status: 200, headers: { 'content-type': 'text/html' } }) } });
  assert.equal(await (await offline.dispatch('/planner', { mode: 'navigate' })).response.text(), 'shell');
});

test('installing keeps the shell and the assets the page names for offline use', async () => {
  const page = '<script type="module" src="/assets/index-aaa111.js"></script><link rel="stylesheet" href="/assets/index-bbb222.css"><link rel="icon" href="/summitsafe-icon.svg">';
  const worker = await loadWorker({
    network: {
      '/': html(),
      '/index.html': new Response(page, { status: 200, headers: { 'content-type': 'text/html' } }),
      '/summitsafe-icon.svg': js('<svg/>'),
      '/manifest.webmanifest': js('{}'),
      '/assets/index-aaa111.js': js('entry'),
      '/assets/index-bbb222.css': js('css'),
    },
  });
  await worker.install();

  for (const path of ['/', '/index.html', '/summitsafe-icon.svg', '/manifest.webmanifest', '/assets/index-aaa111.js', '/assets/index-bbb222.css']) {
    assert.ok(worker.cachedCopy(path), path);
  }
});
