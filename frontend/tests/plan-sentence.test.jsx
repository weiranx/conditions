import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createRef, useState } from 'react';
// React's event support is detected when React DOM is first imported.
const bootstrap = new JSDOM('<html><body></body></html>');
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: bootstrap.window.navigator });
const { createRoot } = await import('react-dom/client');
const { WorkspacePlan } = await import('../src/field/WorkspacePlan');
const { PlanSentence } = await import('../src/field/PlanSentence');
bootstrap.window.close();
delete globalThis.window;
delete globalThis.document;
if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
else delete globalThis.navigator;
import { getDefaultUserPreferences } from '../src/app/preferences';
import { createItineraryDraft } from '../src/app/itinerary';

const json = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

/** `parse` answers POST /api/plan-parse; the health check says whether the feature is on. */
function setup(t, { planParse = true, parse = () => json({}) } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url), 'http://localhost/').pathname;
    if (path === '/api/healthz') return json({ ai: { available: true, features: { planParse: { available: planParse } } } });
    if (path === '/api/plan-parse') {
      const body = JSON.parse(init.body);
      requests.push(body);
      return parse(body);
    }
    return new Promise(() => {});
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let root = null;
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  return {
    requests,
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
    formatElevationDisplay: (ft) => `${ft} ft`,
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
    handleInputChange: (event) => calls.push(['handleInputChange', event.target.value]),
    handleSearchKeyDown: () => {},
    setShowSuggestions: () => {},
    setSearchInputValue: record('setSearchInputValue'),
    setForecastDate: record('setForecastDate'),
    setAlpineStartTime: record('setAlpineStartTime'),
    handleTravelWindowHoursDraftChange: (event) => calls.push(['travelWindowHours', event.target.value]),
    handleTargetElevationChange: (event) => calls.push(['targetElevation', event.target.value]),
    updatePreferences: record('updatePreferences'),
    handleEditPlan: record('handleEditPlan'),
    navigateToView: record('navigateToView'),
    handleGenerateReport: record('handleGenerateReport'),
    isPlaceSaved: () => false,
    toggleSavedPlace: record('toggleSavedPlace'),
    ...overrides,
  };
}

const sentenceInput = () => document.querySelector('.sky-plan-sentence input, .sky-plan-sentence textarea');

async function describe(text) {
  const input = sentenceInput();
  const field = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(field.prototype, 'value').set;
  await act(async () => {
    setValue.call(input, text);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  // The answer resolves after the request's microtasks.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

test('the sentence box shows only while plan parsing is available, and not in Compare', async (t) => {
  const env = setup(t, { planParse: false });
  await env.render(<WorkspacePlan workspace={planWorkspace()} />);
  assert.equal(sentenceInput(), null);

  await env.render(<WorkspacePlan workspace={planWorkspace({ tripStartTime: '07:00', tripStartDate: '2026-09-06', tripDurationDays: 3 })} comparison />);
  assert.equal(sentenceInput(), null, 'Compare keeps its own day range');
});

test('a sentence fills the plan through the form and puts the place in the search', async (t) => {
  const env = setup(t, {
    parse: () => json({
      placeQuery: 'Split Mountain',
      date: '2026-09-12',
      startTime: '03:00',
      activity: 'ski-touring',
      params: { max_gust_mph: 30, travel_window_hours: 10 },
      notes: ['route: north couloir'],
    }),
  });
  const w = planWorkspace();
  await env.render(<WorkspacePlan workspace={w} />);
  assert.ok(sentenceInput(), 'offered when the health check says plan parsing is on');

  await describe('Split Mountain Saturday, ski the north couloir, 3am start, bail over 30 mph');
  assert.deepEqual(env.requests, [{
    text: 'Split Mountain Saturday, ski the north couloir, 3am start, bail over 30 mph',
    today: '2026-09-06',
    units: { temperature: 'f', wind: 'mph', elevation: 'ft' },
  }]);
  const named = (name) => w.calls.filter(([call]) => call === name).map(([, ...args]) => args);
  assert.deepEqual(named('setForecastDate'), [['2026-09-12']]);
  assert.deepEqual(named('setAlpineStartTime'), [['03:00']]);
  assert.deepEqual(named('travelWindowHours'), [['10']]);
  assert.deepEqual(named('updatePreferences'), [
    [{ defaultActivity: 'ski-touring', customActivityId: null }],
    [{ maxWindGustMph: 30 }],
  ], 'the activity first, so its saved limits load before the sentence sets its own');
  assert.deepEqual(named('handleInputChange'), [['Split Mountain']]);
  assert.equal(named('handleGenerateReport').length, 0, 'Enter fills the form; it never creates the brief');
  assert.ok(document.querySelector('input[role="combobox"]'), 'the search shows so the place can be picked');

  const status = document.querySelector('.sky-plan-sentence [role="status"]').textContent;
  assert.match(status, /Filled in: Split Mountain \(pick it from the results\) · Sat, Sep 12 · leave 3:00 AM · out 10 h · Ski touring · gusts ≤ 30 mph/);
  assert.match(status, /Not set: route: north couloir/);
});

/**
 * The plan form over a search that answers `results(query)` a moment after it
 * is typed, and whose picks move the place, as the workspace's does.
 */
function SearchingPlan({ base, results }) {
  const [search, setSearch] = useState({ searchQuery: base.searchQuery, searchLoading: false, suggestions: [] });
  const [place, setPlace] = useState({ position: base.position, committedSearchQuery: base.committedSearchQuery, objectiveName: base.objectiveName });
  const w = {
    ...base,
    ...search,
    ...place,
    handleInputChange: (event) => {
      const query = event.target.value;
      base.calls.push(['handleInputChange', query]);
      setSearch({ searchQuery: query, searchLoading: true, suggestions: [] });
      setTimeout(() => setSearch({ searchQuery: query, searchLoading: false, suggestions: results(query) }), 0);
    },
    selectSuggestion: (item) => {
      base.calls.push(['selectSuggestion', item.name]);
      const label = item.name.split(',')[0];
      setSearch((current) => ({ ...current, searchQuery: label }));
      setPlace({ position: { lat: item.lat, lng: item.lon }, committedSearchQuery: label, objectiveName: label });
    },
  };
  return <WorkspacePlan workspace={w} />;
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const sierraSplit = { name: 'Split Mountain, Inyo County, California', lat: 37.0216, lon: -118.4223, kind: 'Peak', where: 'Inyo NF, CA' };
const utahSplit = { name: 'Split Mountain, Uintah County, Utah', lat: 40.45, lon: -109.25, kind: 'Peak', where: 'Dinosaur NM, UT' };
const campground = { name: 'Split Mountain Campground, Uintah County, Utah', lat: 40.44, lon: -109.26, kind: 'Campground' };

test('a described place with one clear match is chosen, with a way to change it', async (t) => {
  const env = setup(t, { parse: () => json({ placeQuery: 'Split Mountain', date: null, startTime: '03:00', activity: null, params: {}, notes: [] }) });
  const w = planWorkspace();
  await env.render(<SearchingPlan base={w} results={() => [sierraSplit, campground]} />);
  await describe('Split Mountain, 3am start');
  await settle();

  assert.deepEqual(w.calls.filter(([name]) => name === 'selectSuggestion'), [['selectSuggestion', 'Split Mountain, Inyo County, California']]);
  assert.equal(document.querySelector('input[role="combobox"]'), null, 'the chosen place shows instead of the search');
  assert.equal(document.querySelector('.sky-plan-place-title strong').textContent, 'Split Mountain');
  assert.match(document.querySelector('.sky-plan-place-described').textContent, /Not this one\? Change it/);
  assert.ok(document.querySelector('button[aria-label="Change place"]'));
  assert.match(
    document.querySelector('.sky-plan-sentence [role="status"]').textContent,
    /Filled in: Split Mountain, Inyo NF, CA \(picked: the only match\) · leave 3:00 AM/,
  );
});

test('a described place with two matches waits in the search for the traveler', async (t) => {
  const env = setup(t, { parse: () => json({ placeQuery: 'Split Mountain', date: null, startTime: null, activity: null, params: {}, notes: [] }) });
  const w = planWorkspace();
  await env.render(<SearchingPlan base={w} results={() => [sierraSplit, utahSplit, campground]} />);
  await describe('Split Mountain');
  await settle();

  assert.equal(w.calls.filter(([name]) => name === 'selectSuggestion').length, 0);
  assert.ok(document.querySelector('input[role="combobox"]'), 'the search stays open to pick from');
  assert.equal(document.querySelectorAll('[role="option"]').length, 0, 'the fixture keeps the results closed');
  assert.match(document.querySelector('.sky-plan-sentence [role="status"]').textContent, /Filled in: Split Mountain \(pick it from the results\)/);
  assert.equal(document.querySelector('.sky-plan-place-described'), null);
});

test('a day past the forecast days is a note, and a target elevation waits for the picked place', async (t) => {
  const env = setup(t, {
    parse: () => json({
      placeQuery: 'Mount Whitney',
      date: '2026-09-20',
      startTime: null,
      activity: null,
      params: { target_elevation_ft: 14505 },
      notes: [],
    }),
  });
  const w = planWorkspace();
  await env.render(<WorkspacePlan workspace={w} />);
  await describe('Whitney on the 20th, summit 14505 ft');
  assert.equal(w.calls.filter(([name]) => name === 'setForecastDate').length, 0);
  assert.match(document.querySelector('.sky-plan-sentence-notes').textContent, /Sun, Sep 20 is past the forecast days/);
  assert.equal(w.calls.filter(([name]) => name === 'targetElevation').length, 0, 'choosing a place clears the target, so it waits');

  await env.render(<WorkspacePlan workspace={{ ...w, position: { lat: 36.5785, lng: -118.2923 }, committedSearchQuery: 'Mount Whitney', searchQuery: 'Mount Whitney', objectiveName: 'Mount Whitney' }} />);
  assert.deepEqual(w.calls.filter(([name]) => name === 'targetElevation'), [['targetElevation', '14505']]);
});

test('a refused sentence shows why and changes nothing', async (t) => {
  const env = setup(t, { parse: () => json({ error: 'Could not read that plan. Try rephrasing it.' }, 422) });
  const w = planWorkspace();
  await env.render(<WorkspacePlan workspace={w} />);
  await describe('asdf');
  assert.equal(document.querySelector('.sky-plan-sentence-error').textContent, 'Could not read that plan. Try rephrasing it.');
  assert.deepEqual(w.calls.filter(([name]) => name !== 'handleEditPlan'), []);
});

test('a multi-day description fills the trip and leaves its camps, exit and passes to pick', async (t) => {
  const env = setup(t, {
    parse: () => json({
      placeQuery: 'Onion Valley',
      date: '2026-09-11',
      startTime: '08:00',
      activity: 'backpacking',
      params: { travel_window_hours: 6, max_gust_mph: 35 },
      trip: {
        name: 'Rae Lakes Loop',
        nights: 3,
        camps: [{ placeQuery: 'Kearsarge Lakes', layover: false }, { placeQuery: 'Rae Lakes', layover: false }, { placeQuery: null, layover: true }],
        exit: 'Cottonwood Lakes',
        passes: [['Kearsarge Pass'], ['Glen Pass'], [], []],
      },
      notes: ['permit: Kearsarge Pass'],
    }),
  });
  let draft = createItineraryDraft({ startDate: '2026-09-06', start: '07:00', travelHours: 8, nights: 1 });
  let hints = null;
  const w = planWorkspace({
    itinerary: {
      mode: 'multi',
      draft,
      updateDraft: (update) => { draft = update(draft); },
      setPlaceHints: (next) => { hints = next; },
    },
  });
  const placeQueries = [];
  await env.render(
    <PlanSentence workspace={w} multiDay placeKey="here" onDate={() => {}} onStart={() => {}} onDuration={() => {}} onPlaceQuery={(query) => placeQueries.push(query)} />,
  );
  assert.equal(document.querySelector('.sky-plan-sentence label').textContent, 'Describe your trip');
  assert.equal(sentenceInput().tagName, 'TEXTAREA');

  await describe('Rae Lakes Loop from Onion Valley Friday, 3 nights: Kearsarge Lakes, Rae Lakes, layover, out at Cottonwood Lakes');
  assert.equal(env.requests[0].mode, 'multi');
  assert.deepEqual(placeQueries, ['Onion Valley'], 'the trailhead goes through the plan search');
  assert.equal(draft.name, 'Rae Lakes Loop');
  assert.equal(draft.startDate, '2026-09-11');
  assert.equal(draft.camps.length, 2, 'cut to the nights the forecast reaches');
  assert.equal(draft.camps[1].layover, false);
  assert.ok(draft.days.every((day) => day.start === '08:00' && day.travelHours === 6));
  assert.deepEqual(hints, { camps: ['Kearsarge Lakes', 'Rae Lakes'], exit: 'Cottonwood Lakes', checkpoints: [['Kearsarge Pass'], ['Glen Pass']] });
  const named = (name) => w.calls.filter(([call]) => call === name).map(([, ...args]) => args);
  assert.deepEqual(named('updatePreferences'), [[{ defaultActivity: 'backpacking', customActivityId: null }], [{ maxWindGustMph: 35 }]]);
  assert.equal(named('handleEditPlan').length, 0, 'a trip is checked again as a whole');

  const status = document.querySelector('.sky-plan-sentence [role="status"]').textContent;
  assert.match(status, /Filled in: Onion Valley \(pick it from the results\) · “Rae Lakes Loop” · from Fri, Sep 11 · 2 nights · leave camp 8:00 AM · 6 h a day · camps: Kearsarge Lakes, Rae Lakes · out at Cottonwood Lakes · over Kearsarge Pass, Glen Pass · Backpacking · gusts ≤ 35 mph/);
  assert.match(status, /Pick each camp, exit and pass from its results under Camps/);
  assert.match(status, /The forecast reaches 2 nights/);
  assert.match(status, /permit: Kearsarge Pass/);
});
