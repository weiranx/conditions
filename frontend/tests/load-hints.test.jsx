// @env production
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import {
  RETURNING_VISITOR_KEYS,
  apiOriginOf,
  plannerLoadHints,
  plannerPreloadScript,
  plannerPreloads,
} from '../scripts/planner-load-hints.mjs';
import { LANDING_SEEN_KEY, shouldShowLanding } from '../src/app/landing-gate';
import { PERSISTED_REPORT_KEY, USER_PREFERENCES_KEY } from '../src/app/constants';
import { GUEST_REPORT_COUNT_KEY } from '../src/app/guest-report-limit';

const chunk = (fileName, extra = {}) => ({ type: 'chunk', fileName, imports: [], moduleIds: [], isEntry: false, viteMetadata: { importedCss: new Set() }, ...extra });
const bundle = () => ({
  'assets/index-1.js': chunk('assets/index-1.js', { isEntry: true, facadeModuleId: '/repo/frontend/index.html' }),
  'assets/FieldApp-2.js': chunk('assets/FieldApp-2.js', {
    facadeModuleId: null,
    moduleIds: ['/repo/frontend/src/lib/api-client.ts', '/repo/frontend/src/field/FieldApp.tsx'],
    imports: ['assets/index-1.js', 'assets/preferences-3.js', 'assets/sky-4.js'],
    viteMetadata: { importedCss: new Set(['assets/FieldApp-2.css']) },
  }),
  'assets/preferences-3.js': chunk('assets/preferences-3.js', { imports: ['assets/index-1.js'] }),
  'assets/sky-4.js': chunk('assets/sky-4.js', { imports: ['assets/index-1.js', 'assets/preferences-3.js'], viteMetadata: { importedCss: new Set(['assets/sky-4.css']) } }),
  // Loaded on demand from the planner, so it is not part of what the planner needs at once.
  'assets/Report-5.js': chunk('assets/Report-5.js', { imports: ['assets/FieldApp-2.js'], viteMetadata: { importedCss: new Set(['assets/Report-5.css']) } }),
  'assets/topo-6.svg': { type: 'asset', fileName: 'assets/topo-6.svg' },
});

test('the planner preloads are its own chunk, its static imports and their styles, and nothing else', () => {
  assert.deepEqual(plannerPreloads(bundle()), {
    js: ['/assets/FieldApp-2.js', '/assets/preferences-3.js', '/assets/sky-4.js'],
    css: ['/assets/FieldApp-2.css', '/assets/sky-4.css'],
  });
});

test('preload paths follow the configured base, and a bundle without the planner has none', () => {
  assert.equal(plannerPreloads(bundle(), '/conditions').js[0], '/conditions/assets/FieldApp-2.js');
  assert.equal(plannerPreloads(bundle(), '/conditions/').css[0], '/conditions/assets/FieldApp-2.css');
  const withoutPlanner = bundle();
  delete withoutPlanner['assets/FieldApp-2.js'];
  assert.equal(plannerPreloads(withoutPlanner), null);
  // Rollup may name the facade instead of listing the module.
  const facade = bundle();
  facade['assets/FieldApp-2.js'].moduleIds = [];
  facade['assets/FieldApp-2.js'].facadeModuleId = 'C:\\repo\\frontend\\src\\field\\FieldApp.tsx';
  assert.equal(plannerPreloads(facade).js[0], '/assets/FieldApp-2.js');
});

test('imports that circle back do not loop', () => {
  const circular = bundle();
  circular['assets/preferences-3.js'].imports.push('assets/FieldApp-2.js', 'assets/sky-4.js');
  assert.equal(plannerPreloads(circular).js.length, 3);
});

test('only an absolute API address gets a preconnect', () => {
  assert.equal(apiOriginOf('https://apivps.conditions.example/'), 'https://apivps.conditions.example');
  assert.equal(apiOriginOf(' https://api.example.com:8443/v1 '), 'https://api.example.com:8443');
  assert.equal(apiOriginOf('http://localhost:3001'), 'http://localhost:3001');
  for (const none of ['', '   ', undefined, null, '/api', 'api.example.com', 'ftp://files.example.com', 'javascript:alert(1)']) {
    assert.equal(apiOriginOf(none), null, String(none));
  }
});

test('the build plugin adds the preconnect and the preload script, each only when it applies', () => {
  const run = (env, files) => {
    const plugin = plannerLoadHints();
    plugin.configResolved({ base: '/', env });
    return plugin.transformIndexHtml.handler('<html></html>', { bundle: files });
  };
  const full = run({ VITE_API_BASE_URL: 'https://apivps.conditions.example/' }, bundle());
  assert.deepEqual(full[0], { tag: 'link', attrs: { rel: 'preconnect', href: 'https://apivps.conditions.example' }, injectTo: 'head-prepend' });
  assert.equal(full[1].tag, 'script');
  assert.equal(full[1].injectTo, 'head-prepend');
  assert.match(full[1].children, /\/assets\/FieldApp-2\.js/);
  assert.match(full[1].children, /\/assets\/sky-4\.css/);

  assert.equal(run({}, bundle()).length, 1, 'no API address: only the script');
  assert.equal(run({}, bundle())[0].tag, 'script');
  assert.equal(run({ VITE_API_BASE_URL: '/api' }, bundle()).some((tag) => tag.tag === 'link'), false);
  assert.deepEqual(run({ VITE_API_BASE_URL: 'https://api.example.com' }, {}), [
    { tag: 'link', attrs: { rel: 'preconnect', href: 'https://api.example.com' }, injectTo: 'head-prepend' },
  ]);
  assert.equal(plannerLoadHints().apply, 'build');
});

test('the script keys off the same storage keys as the landing gate', () => {
  assert.deepEqual(
    [...RETURNING_VISITOR_KEYS].sort(),
    [LANDING_SEEN_KEY, USER_PREFERENCES_KEY, PERSISTED_REPORT_KEY, GUEST_REPORT_COUNT_KEY].sort(),
  );
});

// Runs the script the way a browser would while parsing the head, for one visit.
function preloadsFor({ path, storage = {}, storageThrows = false, writeThrows = false }) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: `https://conditions.example${path}`, runScripts: 'outside-only' });
  const store = { ...storage };
  const stub = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { if (writeThrows) throw new Error('quota'); store[key] = value; },
    removeItem: (key) => { delete store[key]; },
  };
  Object.defineProperty(dom.window, 'localStorage', { configurable: true, get: () => { if (storageThrows) throw new Error('denied'); return stub; } });
  dom.window.eval(plannerPreloadScript({ js: ['/assets/App.js', '/assets/util.js'], css: ['/assets/App.css'] }));
  const links = [...dom.window.document.head.querySelectorAll('link')].map((link) => ({
    rel: link.getAttribute('rel'), href: link.getAttribute('href'), as: link.getAttribute('as'), crossorigin: link.getAttribute('crossorigin'),
  }));
  const at = new URL(`https://conditions.example${path}`);
  const gateStorage = storageThrows ? null : { getItem: stub.getItem, setItem: stub.setItem, removeItem: stub.removeItem };
  const planner = at.pathname !== '/connect' && !shouldShowLanding({ pathname: at.pathname, search: at.search, hash: at.hash }, gateStorage);
  dom.window.close();
  return { links, planner };
}

const visits = [
  ['a first visit to /', { path: '/' }],
  ['/ after the landing page was seen', { path: '/', storage: { [LANDING_SEEN_KEY]: '1' } }],
  ['/ with saved preferences', { path: '/', storage: { [USER_PREFERENCES_KEY]: '{}' } }],
  ['/ with a saved report', { path: '/', storage: { [PERSISTED_REPORT_KEY]: '{}' } }],
  ['/ with guest reports counted', { path: '/', storage: { [GUEST_REPORT_COUNT_KEY]: '2' } }],
  ['/ with a query, first visit', { path: '/?lat=46.85&lon=-121.76' }],
  ['/ with a hash, first visit', { path: '/#conditions' }],
  ['/welcome for a returning visitor', { path: '/welcome', storage: { [LANDING_SEEN_KEY]: '1' } }],
  ['/welcome/ for a first visit', { path: '/welcome/' }],
  ['/planner, first visit', { path: '/planner' }],
  ['a shared report link, first visit', { path: '/report/abcdefghijklmnopqrstuv' }],
  ['/connect', { path: '/connect', storage: { [LANDING_SEEN_KEY]: '1' } }],
  ['/ with storage that cannot be read', { path: '/', storageThrows: true }],
  ['/ with storage that cannot be written', { path: '/', writeThrows: true }],
];

for (const [name, visit] of visits) {
  test(`preloads for ${name} exactly when the planner opens`, () => {
    const { links, planner } = preloadsFor(visit);
    if (!planner) {
      assert.deepEqual(links, []);
      return;
    }
    assert.deepEqual(links, [
      { rel: 'modulepreload', href: '/assets/App.js', as: null, crossorigin: '' },
      { rel: 'modulepreload', href: '/assets/util.js', as: null, crossorigin: '' },
      { rel: 'preload', href: '/assets/App.css', as: 'style', crossorigin: '' },
    ]);
  });
}

test('a first visit to / is the only planner-less path, and the script leaves no mark on storage', () => {
  assert.equal(preloadsFor({ path: '/' }).planner, false);
  assert.equal(preloadsFor({ path: '/planner' }).planner, true);
  const dom = new JSDOM('<html><head></head></html>', { url: 'https://conditions.example/', runScripts: 'outside-only' });
  dom.window.eval(plannerPreloadScript({ js: ['/assets/App.js'], css: [] }));
  assert.equal(dom.window.localStorage.length, 0);
  dom.window.close();
});

test('the fonts stylesheet no longer blocks the first paint, and still loads without scripts', async () => {
  const html = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
  const fonts = [...html.matchAll(/<link\s[^>]*fonts\.googleapis\.com\/css2[^>]*>/g)].map((match) => match[0]);
  assert.equal(fonts.length, 2, 'one stylesheet and its noscript fallback');
  const [main, fallback] = fonts;
  assert.match(main, /media="print"/);
  assert.match(main, /onload="this\.media='all'"/);
  assert.doesNotMatch(fallback, /media=/);
  assert.match(html, /<noscript>\s*<link[^>]*fonts\.googleapis\.com\/css2/);
  assert.match(html, /display=swap/);
});

test('hashed assets are cached for good and the service worker is always checked', async () => {
  const headers = await readFile(resolve(process.cwd(), 'public/_headers'), 'utf8');
  const rules = new Map();
  let current = null;
  for (const line of headers.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\S/.test(line)) { current = line.trim(); rules.set(current, []); } else rules.get(current).push(line.trim());
  }
  assert.deepEqual(rules.get('/assets/*'), ['Cache-Control: public, max-age=31536000, immutable']);
  assert.deepEqual(rules.get('/sw.js'), ['Cache-Control: public, max-age=0, must-revalidate']);
  assert.deepEqual([...rules.keys()].sort(), ['/assets/*', '/sw.js']);
});
