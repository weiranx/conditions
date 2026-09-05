import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { AccountContext } from '../src/contexts/account';
import { paginateReportHistory } from '../dev/saved-report-history.mjs';
const bootstrap = new JSDOM('<html><body></body></html>');
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
const { createRoot } = await import('react-dom/client');
const { ReportHistory } = await import('../src/field/ReportHistory');
bootstrap.window.close();
delete globalThis.window;
delete globalThis.document;
const row = (id, overrides = {}) => ({
  id, title: `Mountain ${id}`, objectiveName: `Mountain ${id}`, shareToken: `share-token-${id}`,
  forecastDate: '2026-09-06', alpineStartTime: '05:30', score: 72.6, hasAi: false,
  generatedAt: '2026-09-04T08:00:00Z', createdAt: '2026-09-05T08:00:00Z', updatedAt: '2026-09-05T08:00:00Z', ...overrides,
});
async function mount(t, handler, props = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, signal: options.signal });
    const result = await handler(new URL(url, 'http://localhost'), options);
    return Response.json(result.body ?? result, { status: result.status ?? 200 });
  };
  const opened = [];
  const root = createRoot(document.getElementById('root'));
  const render = async (account = { user: { id: 'account-a' }, loading: false }) => act(async () => {
    root.render(<AccountContext.Provider value={account}><ReportHistory localReport={null} sharingEnabled onOpen={(...args) => opened.push(args)} navigate={() => {}} {...props} /></AccountContext.Provider>);
  });
  await render();
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  const click = async text => act(async () => {
    const button = [...document.querySelectorAll('button')].find(el => el.textContent.includes(text));
    assert.ok(button, `Button ${text} exists`); button.click();
  });
  const search = async value => {
    await act(async () => {
      const input = document.querySelector('input[type="search"]');
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
  };
  return { dom, requests, opened, click, search, render };
}

test('loads older pages, preserves existing reports on failure, and retries the same cursor', async t => {
  let failures = 1;
  const h = await mount(t, url => url.searchParams.has('cursor')
    ? failures-- > 0 ? { status: 400, body: { error: 'Older history unavailable' } } : { reports: [row('older')], nextCursor: null }
    : { reports: [row('newest')], nextCursor: 'newest' });
  await h.click('Load older reports');
  assert.match(document.body.textContent, /Older history unavailable/);
  assert.match(document.body.textContent, /Mountain newest/);
  await h.click('Try again');
  assert.equal(document.querySelectorAll('.field-library-entry').length, 2);
  assert.doesNotMatch(document.body.textContent, /Load older reports/);
  assert.equal(h.requests.filter(request => request.url.includes('cursor=newest')).length, 2);
});

test('searches the entire account and combines AI filtering with the search', async t => {
  const h = await mount(t, url => ({ reports: [row(url.searchParams.get('q') || 'initial')], nextCursor: url.searchParams.has('q') ? null : 'initial' }));
  await h.search('Remote summit');
  assert.match(h.requests.at(-1).url, /q=Remote\+summit/);
  assert.equal(document.querySelectorAll('.field-library-entry').length, 1);
  assert.match(document.body.textContent, /Mountain Remote summit/);
  await act(async () => document.querySelector('input[type="checkbox"]').click());
  assert.match(h.requests.at(-1).url, /aiOnly=true/);
  assert.match(h.requests.at(-1).url, /q=Remote\+summit/);
  assert.doesNotMatch(h.requests.at(-1).url, /cursor=/);
});

test('an account switch aborts outstanding history requests and hides the previous account', async t => {
  let finish;
  const h = await mount(t, () => new Promise(resolve => { finish = resolve; }));
  const signal = h.requests.at(-1).signal;
  await h.render({ user: null, loading: false });
  assert.equal(signal.aborted, true);
  await act(async () => finish({ reports: [row('private')], nextCursor: null }));
  assert.doesNotMatch(document.body.textContent, /Mountain private/);
  assert.match(document.body.textContent, /Take your reports with you/);
});

test('invalid saved snapshots produce a visible error without navigating', async t => {
  const h = await mount(t, url => url.pathname.endsWith('/broken')
    ? { report: { snapshot: { invalid: true } } }
    : { reports: [row('broken', { score: null, generatedAt: null })], nextCursor: null });
  assert.match(document.body.textContent, /Generated unavailable/);
  assert.equal(document.querySelector('b').getAttribute('aria-label'), 'Snapshot score unavailable');
  await h.click('Mountain broken');
  assert.match(document.querySelector('[role="alert"]').textContent, /incomplete or no longer compatible/);
  assert.equal(h.opened.length, 0);
});

test('initial loading errors do not masquerade as empty history and can recover', async t => {
  let failed = true;
  const h = await mount(t, () => failed ? { status: 400, body: { error: 'History unavailable' } } : { reports: [], nextCursor: null });
  assert.doesNotMatch(document.body.textContent, /No account reports yet/);
  failed = false;
  await h.click('Try again');
  assert.match(document.body.textContent, /No account reports yet/);
});

test('mock history finds matches beyond 100 and pages equal timestamps without losing rows', () => {
  const reports = Array.from({ length: 205 }, (_, index) => row(String(index).padStart(3, '0'), { hasAi: index % 2 === 0 }));
  const first = paginateReportHistory(reports, new URLSearchParams());
  const second = paginateReportHistory(reports, new URLSearchParams({ cursor: first.nextCursor }));
  const third = paginateReportHistory(reports, new URLSearchParams({ cursor: second.nextCursor }));
  assert.equal(new Set([...first.reports, ...second.reports, ...third.reports].map(report => report.id)).size, 205);
  assert.equal(third.nextCursor, null);
  const match = paginateReportHistory(reports, new URLSearchParams({ q: 'Mountain 002', aiOnly: 'true' }));
  assert.deepEqual(match.reports.map(report => report.id), ['002']);
});

test('opens the exact saved snapshot with its account identity and no generation request', async t => {
  const snapshot = {
    version: 3, savedAt: '2026-09-05T08:00:00Z',
    plan: { lat: 46.85, lon: -121.76, objectiveName: 'Saved mountain', searchQuery: '', forecastDate: '2026-09-06', alpineStartTime: '05:30', travelWindowHours: 8, targetElevationInput: '' },
    safetyData: { location: { lat: 46.85, lon: -121.76 }, weather: {}, safety: { score: 73 }, generatedAt: '2026-09-04T08:00:00Z' },
    ai: { aiBriefNarrative: 'Saved briefing', snowVisionAnalysis: null, snowVisionImage: null, reportChatMessages: [] },
    route: { routeSuggestions: null, routeAnalysis: null, customRouteName: '', gpxRoute: null }, preferences: null,
  };
  const h = await mount(t, url => url.pathname.endsWith('/saved') ? { report: { snapshot } } : { reports: [row('saved')], nextCursor: null });
  await h.click('Mountain saved');
  assert.equal(h.opened.length, 1);
  assert.equal(h.opened[0][0].plan.travelWindowHours, 8);
  assert.equal(h.opened[0][0].ai.aiBriefNarrative, 'Saved briefing');
  assert.deepEqual(h.opened[0].slice(1), ['share-token-saved', 'saved']);
  assert.deepEqual(h.requests.map(request => request.url), ['/api/account/reports', '/api/account/reports/saved']);
});
