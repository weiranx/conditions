// The whole report, as the app shows it: on a phone each chapter starts shut, its
// heading, checks and lead, and opens on a tap or a jump; on a wider screen every
// chapter is open. Every brief card still lands on the reading behind it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
// React's event support is detected when React DOM is first imported.
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/planner', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
const { createRoot } = await import('react-dom/client');
const { useWorkspace } = await import('../src/field/model/useWorkspace');
const { Report } = await import('../src/field/Report');
const { buildPersistedReport } = await import('../src/app/report-storage');
const { PERSISTED_REPORT_KEY } = await import('../src/app/constants');
const { getDefaultUserPreferences } = await import('../src/app/preferences');
const { AccountContext } = await import('../src/contexts/account');
const { AiAccessContext } = await import('../src/contexts/ai-access');
const { makeEvaluatedReport } = await import('../dev/mock-data.mjs');
const { createMockApi } = await import('../dev/mock-api.mjs');

const date = new Date().toISOString().slice(0, 10);
const plan = { lat: 46.8523, lon: -121.7603, forecastDate: date, alpineStartTime: '07:00', travelWindowHours: 10 };
const preferences = { ...getDefaultUserPreferences(), travelWindowHours: plan.travelWindowHours };
const persisted = () => buildPersistedReport(
  { ...plan, objectiveName: 'Mount Rainier', searchQuery: 'Mount Rainier', targetElevationInput: '' },
  makeEvaluatedReport({ lat: plan.lat, lon: plan.lon, date, start: plan.alpineStartTime, travel_window_hours: 10, activity: preferences.defaultActivity }, 'mixed'),
  {},
  { preferences },
);
const backend = createMockApi();
const wait = (ms = 20) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

/** The report in a browser `width` wide; phones match the narrow media queries. */
async function mountReport(t, { phone }) {
  const page = new JSDOM('<div id="root"></div>', { url: 'http://localhost/planner', pretendToBeVisual: true });
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch,
    requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame, MutationObserver: globalThis.MutationObserver };
  page.window.matchMedia = (query) => ({ matches: phone && /max-width/.test(query), addEventListener() {}, removeEventListener() {} });
  page.window.scrollTo = () => {};
  page.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
  globalThis.window = page.window;
  globalThis.document = page.window.document;
  globalThis.localStorage = page.window.localStorage;
  globalThis.requestAnimationFrame = page.window.requestAnimationFrame.bind(page.window);
  globalThis.cancelAnimationFrame = page.window.cancelAnimationFrame.bind(page.window);
  globalThis.MutationObserver = page.window.MutationObserver;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  page.window.localStorage.setItem(PERSISTED_REPORT_KEY, JSON.stringify(persisted()));
  // Every request is answered as the backend would, through the development mock that shares its modules.
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input, 'http://localhost');
    const { status, payload } = await backend.handle(`${url.pathname}${url.search}`, init.method || 'GET', init.body ? JSON.parse(init.body) : {});
    return new Response(payload === null ? null : JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
  };
  let printed = 0;
  page.window.print = () => { printed += 1; };
  function App() {
    const w = useWorkspace();
    if (!w.reportSnapshot || !w.evaluation) return null;
    return (
      <AiAccessContext.Provider value={w.aiAccessContextValue}>
        <Report report={w.reportSnapshot} workspace={w} onEdit={() => {}} onSave={() => {}} onWatch={() => {}}
          onShare={() => {}} onEmail={() => {}} actionBusy={false} feedback="" />
      </AiAccessContext.Provider>
    );
  }
  const account = { loading: false, user: null, refreshAccount: async () => {}, savePreferences: async () => {}, syncMultiDayUsage: () => {}, syncGeneratedReportUsage: () => {} };
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(<AccountContext.Provider value={account}><App /></AccountContext.Provider>));
  for (let i = 0; i < 20 && !document.querySelector('.sky-chapter-block'); i += 1) await wait(50);
  t.after(async () => {
    await act(async () => root.unmount());
    page.window.close();
    Object.assign(globalThis, previous);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  return { window: page.window, printed: () => printed };
}
const block = (id) => document.querySelector(`[data-chapter="${id}"]`);
const shut = (id) => block(id).classList.contains('is-shut');
/** Waits until a chapter has rendered its content. */
async function rendered(id, selector) {
  for (let i = 0; i < 60 && !block(id).querySelector(selector); i += 1) await wait(50);
  return block(id).querySelector(selector);
}

test('on a phone each chapter starts shut, showing its heading, checks and one lead', async (t) => {
  await mountReport(t, { phone: true });
  const blocks = [...document.querySelectorAll('.sky-chapter-block')];
  assert.ok(blocks.length >= 5);
  for (const chapter of blocks) {
    const id = chapter.dataset.chapter;
    assert.ok(chapter.classList.contains('is-shut'), `${id} starts shut`);
    const toggle = chapter.querySelector('h2.sky-chapter-name > button.sky-chapter-toggle');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(chapter.querySelector('.sky-chapter-body').hidden, true);
    assert.equal(chapter.querySelector('.sky-chapter-body').children.length, 0, `${id} waits to render until opened`);
    assert.ok(chapter.querySelector(`#sky-chapter-${id}`), 'the heading keeps the id the section bar and saved places rely on');
    assert.ok(chapter.querySelectorAll(':scope > .sky-lead').length <= 1, `${id} has at most one lead`);
  }
  for (const id of ['forecast', 'timing', 'terrain', 'sources']) assert.equal(block(id).querySelectorAll(':scope > .sky-lead').length, 1, `${id} shows its lead while shut`);

  // A tap on the heading opens the chapter and renders it; another tap shuts it.
  const toggle = block('timing').querySelector('.sky-chapter-toggle');
  await act(async () => toggle.click());
  assert.equal(shut('timing'), false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.ok(await rendered('timing', '#sky-timing-compare, #sky-timing-daylight-limits'), 'opening renders the chapter');
  assert.equal(shut('forecast'), true, 'other chapters stay shut');
  await act(async () => toggle.click());
  assert.equal(shut('timing'), true);
});

test('on a phone a brief card opens its chapter and the fold that holds the reading', async (t) => {
  await mountReport(t, { phone: true });
  const card = [...document.querySelectorAll('.sky-brief-checks .sky-check')].find((node) => node.textContent.includes('Terrain & snow'));
  await act(async () => card.click());
  const surface = await rendered('terrain', '#sky-terrain-surface');
  assert.ok(surface, 'the anchor renders');
  for (let i = 0; i < 40 && !surface.closest('details')?.open; i += 1) await wait(50);
  assert.equal(surface.closest('details').open, true, 'the fold around the anchor opens');
  assert.equal(shut('terrain'), false);
  assert.equal(shut('forecast'), true, 'chapters above stay shut on a phone');
  assert.equal(document.activeElement, surface.closest('section'), 'focus moves to the reading');
});

test('printing opens every chapter on a phone', async (t) => {
  const h = await mountReport(t, { phone: true });
  await act(async () => h.window.dispatchEvent(new h.window.Event('beforeprint')));
  assert.equal(document.querySelectorAll('.sky-chapter-block.is-shut').length, 0);
});

test('the Print action waits for every chapter, then the print opens every fold in them', async (t) => {
  const h = await mountReport(t, { phone: true });
  const print = [...document.querySelectorAll('.report-actions-popover button')].find((b) => /Print report/.test(b.textContent));
  await act(async () => print.click());
  // The action prints once every chapter, lazily loaded ones included, has rendered.
  for (let i = 0; i < 100 && h.printed() === 0; i += 1) await wait(50);
  assert.equal(h.printed(), 1);
  assert.equal(document.querySelectorAll('.sky-chapter-block.is-shut, .sky-section-loading').length, 0);
  // Folds that mounted while the print waited cannot hear its event, so the report opens them by hand.
  await act(async () => h.window.dispatchEvent(new h.window.Event('beforeprint')));
  const folds = [...document.querySelectorAll('.field-report details:not(.report-actions-menu)')];
  assert.ok(folds.some((fold) => fold.closest('.sky-fold')), 'the chapters hold generic folds');
  assert.deepEqual(folds.filter((fold) => !fold.open).map((fold) => fold.className), [], 'every fold is open for print');
  assert.equal(document.querySelector('.report-actions-menu').open, false, 'the actions menu stays shut');
});

test('on a wider screen every chapter is open, with no toggle', async (t) => {
  await mountReport(t, { phone: false });
  assert.equal(document.querySelectorAll('.sky-chapter-block.is-shut, .sky-chapter-toggle').length, 0);
  assert.equal(document.querySelector('.sky-chapter-name').textContent, 'Weather');
  assert.ok(await rendered('forecast', '#sky-weather-hours'));
  // One lead per chapter: the chapter's own lead is in its heading, not repeated in its body.
  assert.equal(block('forecast').querySelectorAll('.sky-lead').length, 1);
  // A number tile still lands inside its fold.
  const tile = [...document.querySelectorAll('.sky-number-tile')].find((node) => /expected/.test(node.textContent));
  assert.ok(tile, 'the rain or snow number is on the brief');
  const precip = await rendered('forecast', '#sky-precip-title');
  assert.equal(precip.closest('details').open, false, 'rain and snow start folded');
  await act(async () => tile.click());
  for (let i = 0; i < 40 && !precip.closest('details').open; i += 1) await wait(50);
  assert.equal(precip.closest('details').open, true);
});
