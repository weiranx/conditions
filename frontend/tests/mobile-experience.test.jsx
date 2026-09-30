import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
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
import { closeDetailsOnOutsidePress, shareOrCopyLink } from '../src/field/touch';
import { describeShare, SHARE_READY_FEEDBACK } from '../src/field/share-feedback';

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
    formatWindDisplay: (mph) => `${mph} mph`,
    formatTempDisplay: (f) => `${f}°F`,
    searchQuery: '',
    showSuggestions: false,
    suggestions: [],
    activeSuggestionIndex: -1,
    hasObjective: false,
    objectiveDraftDirty: false,
    position: { lat: 46.8523, lng: -121.7603 },
    committedSearchQuery: '',
    featureFlags: { gpxImport: false },
    itinerary: { mode: 'day' },
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
    isPlaceSaved: () => false,
    toggleSavedPlace: () => {},
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
  const w = planWorkspace({ hasObjective: true, objectiveName: 'Test mountain', tripForecastRows: [], tripRanking: null, tripHighlights: [],
    tripChatContext: null, tripStartDate: '2026-09-06', tripStartTime: '07:00', tripDurationDays: 3 });
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

// A stand-in for the browser's navigator, put back when the test ends.
function navigatorStub(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  });
  return (value) => Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
}
const sharedLink = { url: 'https://conditions.example/r/abc', title: 'Mount Rainier conditions · Fri, Oct 2' };
const clipboardTo = (copied) => ({ writeText: async (text) => { copied.push(text); } });

test('a phone hands the link to the share sheet instead of copying it', async (t) => {
  setup(t);
  const shared = [];
  const copied = [];
  navigatorStub(t)({ share: async (data) => { shared.push(data); }, clipboard: clipboardTo(copied) });
  assert.equal(await shareOrCopyLink(sharedLink), 'shared');
  assert.deepEqual(shared, [sharedLink]);
  assert.deepEqual(copied, [], 'a shared link is not also copied');
});

test('closing the share sheet is a choice: nothing is copied and nothing is reported as wrong', async (t) => {
  setup(t);
  const copied = [];
  navigatorStub(t)({
    share: async () => { throw new DOMException('The share sheet was closed', 'AbortError'); },
    clipboard: clipboardTo(copied),
  });
  assert.equal(await shareOrCopyLink(sharedLink), 'dismissed');
  assert.deepEqual(copied, []);
});

test('a share the browser refuses, such as one whose tap has lapsed, is copied instead', async (t) => {
  setup(t);
  const copied = [];
  navigatorStub(t)({
    share: async () => { throw new DOMException('Needs a user gesture', 'NotAllowedError'); },
    clipboard: clipboardTo(copied),
  });
  assert.equal(await shareOrCopyLink(sharedLink), 'copied');
  assert.deepEqual(copied, [sharedLink.url]);
});

test('a tap that lapsed while the report saved asks for another tap instead of copying', async (t) => {
  setup(t);
  const copied = [];
  navigatorStub(t)({
    share: async () => { throw new DOMException('Needs a user gesture', 'NotAllowedError'); },
    clipboard: clipboardTo(copied),
  });
  assert.equal(await shareOrCopyLink(sharedLink, { retryable: true }), 'blocked');
  assert.deepEqual(copied, [], 'copying needs the same permission on iOS, so it is not attempted blind');
});

test('a refusal made in another frame is still recognised by its name', async (t) => {
  setup(t);
  // An error from another realm is not `instanceof Error` here, as one from an embedded frame or extension would be.
  const foreign = (name) => vm.runInNewContext(`Object.assign(new Error('refused'), { name: '${name}' })`);
  assert.equal(foreign('NotAllowedError') instanceof Error, false, 'the stand-in really comes from another realm');
  const copied = [];
  const use = navigatorStub(t);
  use({ share: async () => { throw foreign('NotAllowedError'); }, clipboard: clipboardTo(copied) });
  assert.equal(await shareOrCopyLink(sharedLink, { retryable: true }), 'blocked');
  use({ share: async () => { throw foreign('AbortError'); }, clipboard: clipboardTo(copied) });
  assert.equal(await shareOrCopyLink(sharedLink), 'dismissed');
  assert.deepEqual(copied, [], 'neither refusal is answered with a blind copy');
});

test('only a lapsed tap is worth another tap; any other refusal still copies', async (t) => {
  setup(t);
  const copied = [];
  navigatorStub(t)({
    share: async () => { throw new DOMException('No target accepts this', 'DataError'); },
    clipboard: clipboardTo(copied),
  });
  assert.equal(await shareOrCopyLink(sharedLink, { retryable: true }), 'copied');
  assert.deepEqual(copied, [sharedLink.url]);
});

test('a link the device cannot share is copied, and a desktop copies without opening a share dialog', async (t) => {
  setup(t);
  const copied = [];
  const shared = [];
  const use = navigatorStub(t);
  use({ share: async (data) => { shared.push(data); }, canShare: () => false, clipboard: clipboardTo(copied) });
  assert.equal(await shareOrCopyLink(sharedLink), 'copied');
  use({ clipboard: clipboardTo(copied) });
  assert.equal(await shareOrCopyLink(sharedLink), 'copied', 'a browser with no share support');
  assert.deepEqual(shared, []);
  assert.equal(copied.length, 2);
});

test('a mouse-driven browser copies the link even when it could share one', async (t) => {
  setup(t, { phone: false });
  const shared = [];
  const copied = [];
  navigatorStub(t)({ share: async (data) => { shared.push(data); }, clipboard: clipboardTo(copied) });
  assert.equal(await shareOrCopyLink(sharedLink), 'copied');
  assert.deepEqual(shared, []);
  assert.deepEqual(copied, [sharedLink.url]);
});

test('a link that can be neither shared nor copied is reported, so the page can show it', async (t) => {
  setup(t);
  navigatorStub(t)({ clipboard: { writeText: async () => { throw new Error('denied'); } } });
  assert.equal(await shareOrCopyLink(sharedLink), 'failed');
});

test('a press outside an open menu closes it, a press inside does not, and stopping ends it', (t) => {
  setup(t, {
    html: '<div id="root"></div><details class="menu" open><summary>More</summary><button>Save</button></details>'
      + '<details class="other" open><summary>Other</summary></details><p id="outside">Elsewhere</p>',
  });
  const stop = closeDetailsOnOutsidePress('.menu');
  const press = (target) => target.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  const menu = document.querySelector('.menu');
  press(menu.querySelector('button'));
  assert.equal(menu.open, true, 'a press inside keeps it open');
  press(document.getElementById('outside'));
  assert.equal(menu.open, false);
  assert.equal(document.querySelector('.other').open, true, 'only the named menu closes');
  menu.open = true;
  stop();
  press(document.getElementById('outside'));
  assert.equal(menu.open, true, 'once stopped, presses are ignored');
});

test('the comparison switch keeps its full names for screen readers while a phone shows the nouns', async (t) => {
  const env = setup(t);
  const w = planWorkspace({ hasObjective: true, objectiveName: 'Test mountain', tripForecastRows: [], tripRanking: null, tripHighlights: [],
    tripChatContext: null, tripStartDate: '2026-09-06', tripStartTime: '07:00', tripDurationDays: 3,
    featureFlags: { gpxImport: false, routeAnalysis: true } });
  await env.render(<Compare workspace={w} />);
  const buttons = [...document.querySelectorAll('.shortlist-mode button')];
  assert.deepEqual(buttons.map((button) => button.textContent), ['Compare days', 'Compare objectives', 'Compare routes']);
  assert.ok(buttons.every((button) => button.querySelector('.sky-action-label')?.textContent === 'Compare '),
    'the verb is the part a phone hides');
});

test('the place search asks the phone for no autocorrect and a Search key', async (t) => {
  const env = setup(t);
  await env.render(<WorkspacePlan workspace={planWorkspace()} />);
  const input = document.querySelector('input[role="combobox"]');
  assert.equal(input.getAttribute('autocorrect'), 'off', 'a proper noun or a coordinate is not a typo');
  assert.equal(input.getAttribute('spellcheck'), 'false');
  assert.equal(input.getAttribute('enterkeyhint'), 'search');
});

test('every way a share can end says the right thing, or nothing when the sheet was closed', () => {
  const url = 'https://conditions.example/r/abc';
  const saved = { token: 'abc', saveFailed: false, link: url };
  assert.equal(describeShare('dismissed', saved), null, 'closing the share sheet asks for no message');
  assert.equal(describeShare('shared', saved), 'Report link shared.');
  assert.equal(describeShare('copied', saved), 'Report link copied.');
  assert.equal(describeShare('failed', saved), `Share link: ${url}`, 'the link is shown so it can be copied by hand');
  assert.equal(describeShare('blocked', saved), SHARE_READY_FEEDBACK);
  assert.match(SHARE_READY_FEEDBACK, /saved.*Tap Share link/);

  const plan = { token: null, saveFailed: false, link: url };
  assert.equal(describeShare('copied', plan),
    'Plan link copied. This link makes a new report without the route analysis or AI brief; sign in to share the report itself.');
  assert.match(describeShare('shared', plan), /^Plan link shared\. This link makes a new report/);
  assert.equal(describeShare('copied', { ...plan, saveFailed: true }),
    'Plan link copied. The report could not be saved, so this link makes a new report without the route analysis or AI brief.');
});
