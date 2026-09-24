import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import CompareRoutes, { MAX_COMPARED_ROUTES } from '../src/field/CompareRoutes';

// react-dom decides at load whether the browser has input events, so load it with a DOM.
const bootstrap = new JSDOM('<html><body></body></html>');
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: bootstrap.window.navigator });
const { createRoot } = await import('react-dom/client');
delete globalThis.window;
delete globalThis.document;
if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
else delete globalThis.navigator;

const calm = { temp: 40, feelsLike: 35, windGust: 10, precipChance: 10, description: 'Clear' };
const stop = (over = {}) => ({ name: 'Trailhead', elev_ft: 6000, etaDate: '2026-09-26', etaTime: '06:00', dataAvailable: true, score: 80, weather: calm, activeAlerts: 0, ...over });
const analysis = (name, summaries, timing = {}) => ({ routeName: name, waypoints: [], summaries, analysis: '', partialData: false, routeSource: 'openstreetmap', timing: { basis: 'distance-and-vert', roundTrip: true, travelWindowHours: 8, pace: { minutesPerMile: 30, ascentMinutesPer1000Ft: 45 }, paceSource: 'user', ...timing } });

const workspace = (overrides = {}) => ({
  hasObjective: true, objectiveName: 'Test Peak', forecastDate: '2026-09-26', displayStartTime: '6:00 AM',
  position: { lat: 40, lng: -105 }, routeAnalysis: null, plannedRouteName: '', routeSuggestions: null, routeLoading: false, routeLoadingState: null,
  importedGpxRoute: null, viewingHistoryReport: false, customRouteName: '',
  preferences: { maxWindGustMph: 30, maxPrecipChance: 50, minFeelsLikeF: 0, maxFeelsLikeF: 100, timeStyle: '24h', elevationUnit: 'ft',
    runnerPaceMinutesPerMile: 30, runnerAscentMinutesPer1000Ft: 45, runnerStopBufferMinutes: 30 },
  formatClockForStyle: (value) => value, formatTempDisplay: (f) => `${f}°F`, formatWindDisplay: (mph) => `${mph} mph`,
  formatDistanceDisplay: (mi) => `${mi} mi`, formatElevationDeltaDisplay: (ft) => `+${ft} ft`,
  handleFetchRouteSuggestions: () => {}, setCustomRouteName: () => {},
  ...overrides,
});

const mount = async (t, w) => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document, ResizeObserver: globalThis.ResizeObserver };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close(); Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  await act(async () => root.render(<CompareRoutes workspace={w} />));
  return dom.window.document;
};

test('routes are analyzed for the same plan and shown side by side, and one can become the planned route', async (t) => {
  const requested = [];
  let adopted = null;
  const results = {
    'East Ridge': analysis('East Ridge', [stop(), stop({ name: 'Col', etaTime: '09:00', weather: { ...calm, windGust: 45 } }), stop({ name: 'Return to Trailhead', etaTime: '15:00', leg: 'return' })],
      { mode: 'pace', estimatedMinutes: 540, turnaround: { byPlanEnd: '11:00', objectiveName: 'Col' } }),
    'West Gully': analysis('West Gully', [stop(), stop({ name: 'Gully top', etaTime: '10:00', avalanche: { risk: 'Considerable', dangerLevel: 3 } })]),
  };
  const w = workspace({
    routeSuggestions: [{ name: 'West Gully', distance_rt_miles: 7, elev_gain_ft: 3000, class: 'Class 3' }],
    analyzeRouteForComparison: async (name, { onProgress }) => {
      requested.push(name);
      onProgress({ type: 'stage', stage: 'forecasts', checkpoints: [{}, {}] });
      return results[name];
    },
    adoptRouteAnalysis: (result) => { adopted = result; },
  });
  const document = await mount(t, w);
  const input = document.querySelector('.compare-routes-add input');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'East Ridge');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  assert.equal(document.querySelector('.compare-routes-add .field-button-primary').disabled, false);
  await act(async () => { document.querySelector('.compare-routes-add .field-button-primary').click(); });
  await act(async () => { [...document.querySelectorAll('.compare-routes-suggestions button')].find((b) => b.textContent === '+ West Gully').click(); });
  assert.deepEqual(requested, ['East Ridge', 'West Gully']);
  const cards = [...document.querySelectorAll('.compare-route')];
  assert.equal(cards.length, 2);
  assert.match(cards[0].textContent, /1 of 3 over your limits\. First at Col \(09:00\): gusts 45 mph, over your 30 mph limit\./);
  assert.match(cards[0].textContent, /At your pace9 h/);
  assert.match(cards[0].textContent, /Turn around by11:00/);
  assert.match(cards[1].textContent, /Within your limits, with Considerable avalanche danger at Gully top\./);
  assert.doesNotMatch(document.body.textContent, /best|rank #|score/i);
  await act(async () => { [...cards[1].querySelectorAll('button')].find((b) => b.textContent === 'Use this route').click(); });
  assert.equal(adopted, results['West Gully']);
  // Removing a route frees a slot; the limit keeps AI analyses few.
  await act(async () => { cards[0].querySelector('[aria-label="Remove East Ridge"]').click(); });
  assert.equal(document.querySelectorAll('.compare-route').length, 1);
  assert.equal(MAX_COMPARED_ROUTES, 3);
});

test('a failed route says why, and the planned route starts the comparison', async (t) => {
  const planned = analysis('Planned Route', [stop(), stop({ name: 'Summit' })]);
  const document = await mount(t, workspace({
    routeAnalysis: planned, plannedRouteName: 'Planned Route',
    analyzeRouteForComparison: async () => { throw new Error('Failed to analyze route: provider down'); },
    adoptRouteAnalysis: () => {},
  }));
  const cards = [...document.querySelectorAll('.compare-route')];
  assert.equal(cards.length, 1);
  assert.match(cards[0].textContent, /This is the planned route\./);
  const input = document.querySelector('.compare-routes-add input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'Broken Route');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () => { document.querySelector('.compare-routes-add .field-button-primary').click(); });
  assert.match(document.querySelectorAll('.compare-route')[1].querySelector('[role="alert"]').textContent, /provider down/);
});
