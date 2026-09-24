import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createRef } from 'react';
// React's event support is detected when React DOM is first imported.
const bootstrap = new JSDOM('<html><body></body></html>');
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
// Node 20 has no navigator; newer Node versions expose a getter-only global.
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: bootstrap.window.navigator });
const { createRoot } = await import('react-dom/client');
const { WorkspacePlan } = await import('../src/field/WorkspacePlan');
const { default: Compare } = await import('../src/field/Compare');
bootstrap.window.close();
delete globalThis.window;
delete globalThis.document;
if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
else delete globalThis.navigator;
import { followThemePreference } from '../src/app/theme';
import { getDefaultUserPreferences } from '../src/app/preferences';
import { revealStart, scrollPageToTop, useNewPageStartsAtTop } from '../src/field/page-scroll';

const preferences = getDefaultUserPreferences();

// A phone unless told otherwise: a touch screen in the one-column layout.
function setup(t, { html = '<div id="root"></div>', phone = true } = {}) {
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const scheme = { dark: false, listeners: new Set() };
  dom.window.matchMedia = (query) => ({
    get matches() {
      if (query.includes('prefers-color-scheme')) return scheme.dark;
      if (query.includes('reduce')) return false;
      return phone && /coarse|max-width/.test(query);
    },
    addEventListener: (_, listener) => scheme.listeners.add(listener),
    removeEventListener: (_, listener) => scheme.listeners.delete(listener),
  });
  const scrolls = [];
  dom.window.scrollTo = (options) => scrolls.push(options);
  const reveals = [];
  dom.window.HTMLElement.prototype.scrollIntoView = function (options) { reveals.push({ element: this, options }); };
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.fetch = () => new Promise(() => {});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let root = null;
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  return {
    scrolls,
    reveals,
    setDark(dark) {
      scheme.dark = dark;
      scheme.listeners.forEach((listener) => listener());
    },
    async render(element) {
      root ??= createRoot(document.getElementById('root'));
      await act(async () => root.render(element));
    },
  };
}

function tap(element, pointerType = 'touch') {
  const event = new window.MouseEvent('pointerdown', { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  element.dispatchEvent(event);
  element.focus();
}

function planWorkspace(overrides = {}) {
  return {
    searchWrapperRef: createRef(),
    searchInputRef: createRef(),
    preferences,
    searchQuery: '',
    showSuggestions: false,
    suggestions: [],
    activeSuggestionIndex: -1,
    hasObjective: false,
    objectiveDraftDirty: false,
    featureFlags: { gpxImport: false },
    forecastDate: '2026-09-06',
    alpineStartTime: '07:00',
    todayDate: '2026-09-06',
    maxForecastDate: '2026-09-13',
    travelWindowHoursDraft: '12',
    handleFocus: () => {},
    handleInputChange: () => {},
    handleSearchKeyDown: () => {},
    setShowSuggestions: () => {},
    handlePlannerTimeChange: () => () => {},
    ...overrides,
  };
}

test('the browser bars take the theme the app shows, and follow the system when asked to', (t) => {
  const env = setup(t, {
    html: '<meta name="theme-color" content="#f2f3f1" media="(prefers-color-scheme: light)">'
      + '<meta name="theme-color" content="#0f1211" media="(prefers-color-scheme: dark)"><div id="root"></div>',
  });
  const colors = () => [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) => meta.content);
  const stopDark = followThemePreference('dark');
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.deepEqual(colors(), ['#0f1211', '#0f1211'], 'a dark setting on a light system still tints the bars dark');
  stopDark();

  const stopSystem = followThemePreference('system');
  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.deepEqual(colors(), ['#f2f3f1', '#f2f3f1']);
  env.setDark(true);
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.deepEqual(colors(), ['#0f1211', '#0f1211']);
  stopSystem();
  env.setDark(false);
  assert.equal(document.documentElement.dataset.theme, 'dark', 'a replaced preference stops following the system');
});

test('only a change that is off screen is scrolled to', (t) => {
  const env = setup(t);
  const element = document.createElement('div');
  document.body.append(element);
  for (const top of [2400, 120, -900]) {
    element.getBoundingClientRect = () => ({ top });
    revealStart(element);
  }
  assert.deepEqual(env.reveals.map(({ options }) => options.block), ['start', 'start'], 'below the fold and above the screen, not on it');
});

test('tapping the search on a phone lifts it clear of the keyboard; other focus leaves the page alone', async (t) => {
  const env = setup(t);
  const w = planWorkspace();
  await env.render(<WorkspacePlan workspace={w} />);
  const input = document.querySelector('input[role="combobox"]');

  await act(async () => tap(input));
  assert.equal(env.reveals.length, 1);
  assert.equal(env.reveals[0].element, w.searchWrapperRef.current);
  assert.deepEqual(env.reveals[0].options, { block: 'start', behavior: 'instant' });

  await act(async () => { input.blur(); input.focus(); });
  assert.equal(env.reveals.length, 1, 'focus moved by the form after a failed search');
  await act(async () => { input.blur(); tap(input, 'mouse'); });
  assert.equal(env.reveals.length, 1, 'a mouse click opens no keyboard');
});

test('a desktop layout never lifts the search', async (t) => {
  const env = setup(t, { phone: false });
  await env.render(<WorkspacePlan workspace={planWorkspace()} />);
  await act(async () => tap(document.querySelector('input[role="combobox"]')));
  assert.equal(env.reveals.length, 0);
});

test('starting a comparison below the form follows the results', async (t) => {
  const env = setup(t);
  const w = planWorkspace({ hasObjective: true, objectiveName: 'Test mountain', tripForecastRows: [], tripStartDate: '2026-09-06', tripStartTime: '07:00', tripDurationDays: 3 });
  const below = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.classList.contains('sky-compare-results') ? { top: 1600 } : below.call(this);
  };
  await env.render(<Compare workspace={w} />);
  assert.equal(env.reveals.length, 0, 'opening the page does not jump');
  await env.render(<Compare workspace={{ ...w, tripForecastLoading: true }} />);
  assert.equal(env.reveals.length, 1);
  assert.ok(env.reveals[0].element.classList.contains('sky-compare-results'));
  await env.render(<Compare workspace={{ ...w, tripForecastLoading: false }} />);
  assert.equal(env.reveals.length, 1, 'finishing does not scroll again');
});

test('another page, or a new brief, opens at the top instead of the old scroll offset', async (t) => {
  const env = setup(t);
  function Shell({ page, newBrief }) {
    useNewPageStartsAtTop(page, newBrief);
    return null;
  }
  await env.render(<Shell page="history" newBrief={false} />);
  assert.equal(env.scrolls.length, 0, 'loading the app keeps the browser position');
  await env.render(<Shell page="history" newBrief={false} />);
  assert.equal(env.scrolls.length, 0, 'staying on a page keeps its position');
  await env.render(<Shell page="watches" newBrief={false} />);
  assert.deepEqual(env.scrolls, [{ top: 0, behavior: 'instant' }]);
  await env.render(<Shell page="planner" newBrief={false} />);
  await env.render(<Shell page="planner" newBrief />);
  await env.render(<Shell page="planner" newBrief />);
  assert.equal(env.scrolls.length, 3, 'once for the page and once as the new brief starts loading');

  scrollPageToTop();
  assert.deepEqual(env.scrolls.at(-1), { top: 0, behavior: 'smooth' });
});
