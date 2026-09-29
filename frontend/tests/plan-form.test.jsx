import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createRef } from 'react';
// React's event support is detected when React DOM is first imported.
const bootstrap = new JSDOM('<html><body></body></html>');
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: bootstrap.window.navigator });
const { createRoot } = await import('react-dom/client');
const { WorkspacePlan } = await import('../src/field/WorkspacePlan');
bootstrap.window.close();
delete globalThis.window;
delete globalThis.document;
if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
else delete globalThis.navigator;
import { getDefaultUserPreferences } from '../src/app/preferences';

function setup(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
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
    async render(element) {
      root ??= createRoot(document.getElementById('root'));
      await act(async () => root.render(element));
    },
  };
}

function planWorkspace(overrides = {}) {
  const calls = [];
  const record = (name) => (...args) => { calls.push([name, ...args]); };
  return {
    calls,
    searchWrapperRef: createRef(),
    searchInputRef: createRef(),
    preferences: { ...getDefaultUserPreferences(), timeStyle: 'ampm' },
    formatWindDisplay: (mph) => `${mph} mph`,
    formatTempDisplay: (f) => `${f}°F`,
    searchQuery: 'Mount Rainier',
    committedSearchQuery: 'Mount Rainier',
    objectiveName: 'Mount Rainier',
    objectiveTimezone: 'America/Los_Angeles',
    position: { lat: 46.8523, lng: -121.7603 },
    showSuggestions: false,
    suggestions: [],
    activeSuggestionIndex: -1,
    hasObjective: true,
    objectiveDraftDirty: false,
    featureFlags: {},
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
    setSearchInputValue: record('setSearchInputValue'),
    setForecastDate: record('setForecastDate'),
    navigateToView: record('navigateToView'),
    handleGenerateReport: record('handleGenerateReport'),
    ...overrides,
  };
}

const submit = () => document.querySelector('.field-form-submit');

test('a chosen place is a card with a Change button; changing it can be given up', async (t) => {
  const env = setup(t);
  const w = planWorkspace();
  await env.render(<WorkspacePlan workspace={w} />);
  const card = document.querySelector('.sky-plan-place');
  assert.match(card.textContent, /Mount Rainier.*46\.8523, -121\.7603 · America\/Los Angeles/);
  assert.equal(document.querySelector('input[role="combobox"]'), null, 'no search box while a place is chosen');
  assert.equal(submit().textContent, 'Create conditions brief');

  await act(async () => document.querySelector('[aria-label="Change place"]').click());
  const input = document.querySelector('input[role="combobox"]');
  assert.ok(input, 'Change brings the search back');
  assert.equal(document.activeElement, input);
  const keep = document.querySelector('.sky-plan-keep');
  assert.equal(keep.textContent, 'keep Mount Rainier');
  await act(async () => keep.click());
  assert.deepEqual(w.calls.find(([name]) => name === 'setSearchInputValue'), ['setSearchInputValue', 'Mount Rainier']);
  assert.ok(document.querySelector('.sky-plan-place'), 'keeping the place shows its card again');
});

test('each forecast day is a chip, and the window reads as a return time', async (t) => {
  const env = setup(t);
  const w = planWorkspace({ alpineStartTime: '05:30', travelWindowHoursDraft: '20' });
  await env.render(<WorkspacePlan workspace={w} />);
  const chips = [...document.querySelectorAll('.sky-date-chips label')];
  assert.equal(chips.length, 8);
  assert.match(chips[0].textContent, /^Today/);
  assert.match(chips[1].textContent, /^Tomorrow/);
  assert.equal(chips[0].querySelector('input').checked, true);
  await act(async () => chips[3].querySelector('input').click());
  assert.deepEqual(w.calls.find(([name]) => name === 'setForecastDate'), ['setForecastDate', '2026-09-09']);
  assert.match(document.querySelector('.sky-plan-window').textContent, /Back by 1:30 AM the next day.*Local time at Mount Rainier/);
});

test('Create with a typed place picks the place and then creates the brief', async (t) => {
  const env = setup(t);
  let searched = 0;
  const typed = planWorkspace({
    hasObjective: false, searchQuery: 'Rainier', committedSearchQuery: '',
    handleSearchSubmit: async () => { searched += 1; return true; },
  });
  await env.render(<WorkspacePlan workspace={typed} />);
  assert.equal(submit().textContent, 'Create conditions brief', 'the button names the goal, not an extra step');
  await act(async () => submit().click());
  assert.equal(searched, 1);
  assert.equal(typed.calls.filter(([name]) => name === 'handleGenerateReport').length, 0, 'waits for the place');

  // The next render holds the chosen place.
  await env.render(<WorkspacePlan workspace={{ ...typed, hasObjective: true, searchQuery: 'Mount Rainier', committedSearchQuery: 'Mount Rainier' }} />);
  assert.equal(typed.calls.filter(([name]) => name === 'handleGenerateReport').length, 1);
});

test('Create with nothing typed asks for a place', async (t) => {
  const env = setup(t);
  const w = planWorkspace({ hasObjective: false, searchQuery: '', committedSearchQuery: '', handleSearchSubmit: async () => { throw new Error('not called'); } });
  await env.render(<WorkspacePlan workspace={w} />);
  await act(async () => submit().click());
  assert.equal(document.querySelector('.field-feedback').textContent, 'Choose a place first.');
  assert.equal(document.activeElement, document.querySelector('input[role="combobox"]'));
});

test('a picked point shows while it is looked up, then its elevation', async (t) => {
  const env = setup(t);
  const base = { objectiveName: 'Dropped pin', searchQuery: '46.7900, -121.6500', committedSearchQuery: '46.7900, -121.6500',
    position: { lat: 46.79, lng: -121.65 }, formatElevationDisplay: (ft) => `${ft.toLocaleString('en-US')} ft` };
  await env.render(<WorkspacePlan workspace={planWorkspace({ ...base, pointLookup: { lat: 46.79, lng: -121.65, loading: true, elevationFt: null } })} />);
  assert.match(document.querySelector('.sky-plan-place-name strong').textContent, /Finding what’s here/);
  await env.render(<WorkspacePlan workspace={planWorkspace({ ...base, objectiveName: 'Near Mount Rainier',
    pointLookup: { lat: 46.79, lng: -121.65, loading: false, elevationFt: 7121 } })} />);
  assert.equal(document.querySelector('.sky-plan-place-name strong').textContent, 'Near Mount Rainier');
  assert.match(document.querySelector('.sky-plan-place-name small').textContent, /^7,121 ft · 46\.7900, -121\.6500/);
  await env.render(<WorkspacePlan workspace={planWorkspace({ ...base, pointLookup: { lat: 1, lng: 2, loading: true, elevationFt: 900 } })} />);
  assert.equal(document.querySelector('.sky-plan-place-name strong').textContent, 'Dropped pin', 'a lookup for another point is ignored');
});

test('every activity is one tap, and the chosen one says what it changes', async (t) => {
  const env = setup(t);
  const patches = [];
  const w = planWorkspace({ updatePreferences: (patch) => patches.push(patch) });
  await env.render(<WorkspacePlan workspace={w} />);
  const chips = [...document.querySelectorAll('.sky-activity')];
  assert.ok(chips.length >= 9, 'no list to open first');
  assert.equal(document.querySelector('.sky-activity-toggle'), null);
  assert.equal(document.querySelector('.sky-activity.is-checked').textContent, 'Mountain hiking');
  const panel = document.querySelector('.sky-plan-limits summary').textContent;
  assert.match(panel, /Mountain hiking.*Adjust limits/);
  assert.match(panel, /The brief leads with storms and daylight\./);
  const ski = chips.find((chip) => chip.textContent === 'Ski touring');
  await act(async () => ski.querySelector('input').click());
  assert.deepEqual(patches, [{ defaultActivity: 'ski-touring', customActivityId: null }]);
});

test('a place can be renamed in place; Enter saves without submitting the plan', async (t) => {
  const env = setup(t);
  const names = [];
  const w = planWorkspace({ renameObjective: (name) => names.push(name), handleSearchSubmit: async () => true });
  await env.render(<WorkspacePlan workspace={w} />);
  await act(async () => document.querySelector('[aria-label="Rename place"]').click());
  const input = document.querySelector('.sky-plan-rename input');
  assert.equal(input.value, 'Mount Rainier');
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setValue.call(input, 'Rainier via Muir');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  assert.deepEqual(names, ['Rainier via Muir']);
  assert.equal(w.calls.filter(([name]) => name === 'handleGenerateReport').length, 0);
  assert.equal(document.querySelector('.sky-plan-rename input'), null);
});

test('a searched summit shows its mapped elevation on the place card', async (t) => {
  const env = setup(t);
  await env.render(<WorkspacePlan workspace={planWorkspace({ searchedPlaceElevationFt: 14411, formatElevationDisplay: (ft) => `${ft.toLocaleString('en-US')} ft` })} />);
  assert.match(document.querySelector('.sky-plan-place-name small').textContent, /^14,411 ft · /);
});

test('the later forecast days are outlooks, and choosing one says so', async (t) => {
  const env = setup(t);
  await env.render(<WorkspacePlan workspace={planWorkspace()} />);
  const chips = [...document.querySelectorAll('.sky-date-chips label')];
  assert.deepEqual(chips.map((chip) => chip.classList.contains('is-outlook')), [false, false, false, false, false, true, true, true]);
  assert.equal(document.querySelector('.sky-date-outlook'), null);
  await env.render(<WorkspacePlan workspace={planWorkspace({ forecastDate: '2026-09-12' })} />);
  assert.match(document.querySelector('.sky-date-outlook').textContent, /outlook/);
});

test('first light, sunrise and sunset show for the place and day, with a start at first light', async (t) => {
  const env = setup(t);
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    return new Response(JSON.stringify({ dawn: '6:31:00 AM', sunrise: '7:01:00 AM', sunset: '6:48:00 PM' }), { headers: { 'Content-Type': 'application/json' } });
  };
  const w = planWorkspace({ setAlpineStartTime: (value) => w.calls.push(['setAlpineStartTime', value]) });
  await env.render(<WorkspacePlan workspace={w} />);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 320)); });
  assert.match(asked[0], /\/api\/search\/daylight\?lat=46\.8523&lon=-121\.7603&date=2026-09-06/);
  const line = document.querySelector('.sky-plan-daylight');
  assert.match(line.textContent, /First light 6:31 AM.*Sunrise 7:01 AM.*Sunset 6:48 PM/);
  await act(async () => line.querySelector('button').click());
  assert.deepEqual(w.calls.find(([name]) => name === 'setAlpineStartTime'), ['setAlpineStartTime', '06:31']);
});

test('a multi-day trip checks as soon as the typed trailhead reaches the trip', async (t) => {
  const env = setup(t);
  const checks = [];
  const day = { start: '07:00', travelHours: 8, checkpoints: [] };
  const itinerary = (trailhead) => ({
    mode: 'multi',
    draft: { name: '', trailhead, camps: [{ point: { name: 'Camp', lat: 36.57, lon: -118.28, elevationFt: null }, layover: false }], exit: null,
      days: [day, day], bailPoints: [], track: null, startDate: '2026-09-06' },
    stages: [], gaps: [], loading: false, maxNights: 5, pickTarget: null, setPickTarget: () => {},
    runCheck: async () => { checks.push(1); }, updateDraft: () => {},
  });
  const typed = planWorkspace({ hasObjective: false, searchQuery: 'Whitney', committedSearchQuery: '', itinerary: itinerary(null),
    handleSearchSubmit: async () => true });
  await env.render(<WorkspacePlan workspace={typed} />);
  await act(async () => document.querySelector('.field-form-submit').click());
  const chosen = { ...typed, hasObjective: true, searchQuery: 'Mount Whitney', committedSearchQuery: 'Mount Whitney', position: { lat: 36.5786, lng: -118.2923 } };
  await env.render(<WorkspacePlan workspace={chosen} />);
  assert.equal(checks.length, 0, 'waits for the trip to hold the trailhead');
  await env.render(<WorkspacePlan workspace={{ ...chosen, itinerary: itinerary({ name: 'Mount Whitney', lat: 36.5786, lon: -118.2923 }) }} />);
  assert.equal(checks.length, 1);
});
