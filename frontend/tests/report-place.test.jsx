import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useWorkspace } from '../src/field/model/useWorkspace';
import { placeToReturnTo, reportPlaceKey, useKeepReportPlace } from '../src/field/report-place';
import { buildPersistedReport } from '../src/app/report-storage';
import { PERSISTED_REPORT_KEY } from '../src/app/constants';
import { getDefaultUserPreferences } from '../src/app/preferences';
import { AccountContext } from '../src/contexts/account';
import { makeReport } from '../dev/mock-data.mjs';

const date = new Date().toISOString().slice(0, 10);
const plan = { lat: 46.8523, lon: -121.7603, forecastDate: date, alpineStartTime: '07:00', travelWindowHours: 10 };
const preferences = getDefaultUserPreferences();
const persisted = () => buildPersistedReport(
  { ...plan, objectiveName: 'Mount Rainier', searchQuery: 'Mount Rainier', targetElevationInput: '' },
  makeReport({ lat: plan.lat, lon: plan.lon, date, start: plan.alpineStartTime, travel_window_hours: 10, activity: preferences.defaultActivity }, 'clear'),
  {},
  { preferences: { ...preferences, travelWindowHours: plan.travelWindowHours } },
);

// A browser page at `url` with a scrollable window; `stored` is put in local storage first.
async function mount(t, url, Component, props, { stored = null, account = null, height = 10_000 } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url, pretendToBeVisual: true });
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  let scrollY = 0;
  let pageHeight = height;
  Object.defineProperty(dom.window, 'scrollY', { get: () => scrollY, configurable: true });
  dom.window.scrollTo = (options) => {
    scrollY = Math.max(0, Math.min(pageHeight, typeof options === 'object' ? options.top : options));
    dom.window.dispatchEvent(new dom.window.Event('scroll'));
  };
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  if (stored) dom.window.localStorage.setItem(PERSISTED_REPORT_KEY, JSON.stringify(stored));
  const requests = [];
  globalThis.fetch = (input) => {
    requests.push(new URL(input, url));
    return new Promise(() => {});
  };
  const root = createRoot(document.getElementById('root'));
  const render = (next) => act(async () => root.render(<AccountContext.Provider value={account}><Component {...next} /></AccountContext.Provider>));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  await render(props);
  return {
    render,
    requests,
    window: dom.window,
    setPageHeight(height) { pageHeight = height; },
    frames: (count = 3) => act(() => new Promise((resolve) => setTimeout(resolve, count * 20))),
  };
}

for (const page of ['settings', 'history', 'account', 'status']) {
  test(`a reload on /${page} keeps the last report behind the brief`, async t => {
    let w;
    function Probe() { w = useWorkspace(); return null; }
    const account = { loading: false, user: null, refreshAccount: async () => {}, savePreferences: async () => {}, syncMultiDayUsage: () => {}, syncGeneratedReportUsage: () => {} };
    const h = await mount(t, `http://localhost/${page}`, Probe, {}, { stored: persisted(), account });
    assert.equal(w.view, page, 'the requested page opens');
    assert.equal(w.reportSnapshot?.plan.objectiveName, 'Mount Rainier', 'the stored report is restored behind the page');
    await act(async () => w.navigateToView('planner'));
    assert.equal(w.view, 'planner');
    assert.equal(w.reportSnapshot?.plan.objectiveName, 'Mount Rainier');
    assert.ok(!h.requests.some((url) => url.pathname === '/api/safety'), 'no new report is requested');
  });
}

test('a report opens where the reader left it', async t => {
  const report = persisted();
  const key = reportPlaceKey(report);
  let opened;
  function Reading({ id, show }) {
    return show ? <Report id={id} /> : null;
  }
  const store = { current: null };
  function Report({ id }) {
    const [returning] = useState(() => placeToReturnTo(store.current, id));
    const [sections, setSections] = useState(() => new Set(returning?.sections ?? []));
    opened = { returning, setSections };
    useKeepReportPlace(store, id, sections, returning);
    return null;
  }
  const h = await mount(t, 'http://localhost/planner', Reading, { id: key, show: true });
  assert.equal(opened.returning, null, 'a report read for the first time opens at its top');
  await act(async () => opened.setSections(new Set(['forecast', 'timing'])));
  await act(async () => h.window.scrollTo({ top: 1400 }));
  assert.deepEqual(store.current, { report: key, scrollY: 1400, sections: ['forecast', 'timing'] });

  // Another page opens at its top; the report keeps the place it was left at.
  await h.render({ id: key, show: false });
  await act(async () => h.window.scrollTo({ top: 0 }));
  assert.equal(store.current.scrollY, 1400);

  // Back on the brief, the rendered sections and the spot return, waiting for the page to grow tall enough.
  h.setPageHeight(600);
  await h.render({ id: key, show: true });
  assert.deepEqual(opened.returning.sections, ['forecast', 'timing']);
  assert.equal(h.window.scrollY, 600, 'the page is not yet tall enough');
  assert.equal(store.current.scrollY, 1400, 'a short page does not overwrite the place');
  h.setPageHeight(5000);
  await h.frames();
  assert.equal(h.window.scrollY, 1400);

  // A different report opens at its top.
  await h.render({ id: key, show: false });
  await h.render({ id: `${key}-other`, show: true });
  assert.equal(opened.returning, null);
});

test('scrolling first ends the wait for the old spot', async t => {
  const store = { current: { report: 'r', scrollY: 1400, sections: [] } };
  const none = new Set();
  function Report() {
    const [returning] = useState(() => placeToReturnTo(store.current, 'r'));
    useKeepReportPlace(store, 'r', none, returning);
    return null;
  }
  const h = await mount(t, 'http://localhost/planner', Report, {}, { height: 300 });
  await act(async () => {
    h.window.dispatchEvent(new h.window.Event('wheel'));
    h.window.scrollTo({ top: 120 });
  });
  h.setPageHeight(5000);
  await h.frames();
  assert.equal(h.window.scrollY, 120, 'the reader is not pulled away from where they scrolled');
  assert.equal(store.current.scrollY, 120);
});

test('a spot the page grows too slowly to reach stays kept for next time', async t => {
  const store = { current: { report: 'r', scrollY: 1400, sections: ['forecast'] } };
  const none = new Set();
  function Report() {
    const [returning] = useState(() => placeToReturnTo(store.current, 'r'));
    useKeepReportPlace(store, 'r', none, returning);
    return null;
  }
  let now = 0;
  const realNow = performance.now;
  performance.now = () => now;
  t.after(() => { performance.now = realNow; });
  const h = await mount(t, 'http://localhost/planner', Report, {}, { height: 300 });
  assert.equal(h.window.scrollY, 300);
  now = 10_000;
  await h.frames();
  assert.equal(store.current.scrollY, 1400, 'the clipped offset does not replace the kept spot');
  await act(async () => h.window.scrollTo({ top: 200 }));
  assert.equal(store.current.scrollY, 200, 'once the wait is over, the reader\'s own scrolling is kept');
});
