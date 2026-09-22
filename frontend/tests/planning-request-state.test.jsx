import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useTripForecast } from '../src/hooks/useTripForecast';
import { useSafetyData } from '../src/hooks/useSafetyData';
import { getDefaultUserPreferences } from '../src/app/preferences';
import { BACKEND_WAKE_RETRY_DELAY_MS } from '../src/app/constants';
import { makeReport } from '../dev/mock-data.mjs';

const preferences = getDefaultUserPreferences();
const plan = { lat: 46.8523, lon: -121.7603, date: '2026-09-21', start: '07:00', travel_window_hours: 12 };
const tripInput = {
  hasObjective: true,
  position: { lat: plan.lat, lng: plan.lon },
  todayDate: plan.date,
  maxForecastDate: '2026-09-28',
  initialStartDate: plan.date,
  initialStartTime: plan.start,
  preferences,
  objectiveName: 'Mount Rainier',
};
const usage = {
  tierKey: 'guest', unlimited: false, usedRuns: 1, limitRuns: 2, remainingRuns: 1,
  percentUsed: 50, exhausted: false, periodStart: null, periodEnd: null, resetAt: null,
};

async function mountHook(t, hook, input) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const requests = [];
  globalThis.fetch = (url, init) => new Promise(resolve => requests.push({
    url: new URL(url, 'http://localhost/'), init,
    // Resolve even after abort to cover responses already received or parsed by the client.
    respond(payload, status = 200) { resolve(new Response(JSON.stringify(payload), { status })); },
  }));
  let current;
  function Probe(props) { current = hook(props); return null; }
  const root = createRoot(document.getElementById('root'));
  let mounted = true;
  async function unmount() {
    if (!mounted) return;
    mounted = false;
    await act(async () => root.unmount());
  }
  async function render(props) { await act(async () => root.render(<Probe {...props} />)); }
  t.after(async () => {
    await unmount();
    dom.window.close();
    Object.assign(globalThis, previous);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  await render(input);
  return { get current() { return current; }, requests, render, unmount };
}

function tripPayload(date = plan.date, overrides = {}) {
  return { days: [makeReport({ ...plan, date }, 'clear')], ...overrides };
}

test('a late trip forecast cannot overwrite a newer run or its usage', async t => {
  const usageUpdates = [];
  const h = await mountHook(t, useTripForecast, { ...tripInput, onUsageUpdated: value => usageUpdates.push(value) });
  await act(async () => { void h.current.runTripForecast(); });
  await act(async () => h.current.setTripStartDate('2026-09-22'));
  await act(async () => { void h.current.runTripForecast(); });
  await act(async () => h.requests[1].respond(tripPayload('2026-09-22', { multiDayUsage: usage })));
  const currentRows = h.current.tripForecastRows;
  assert.equal(currentRows[0].date, '2026-09-22');
  await act(async () => h.requests[0].respond(tripPayload(plan.date, { multiDayUsage: usage })));
  assert.equal(h.current.tripForecastRows, currentRows);
  assert.equal(usageUpdates.length, 1);
  assert.equal(h.requests[0].init.signal.aborted, true);
});

test('failure from a superseded trip run does not clear the active loading state', async t => {
  const h = await mountHook(t, useTripForecast, tripInput);
  await act(async () => { void h.current.runTripForecast(); });
  await act(async () => { void h.current.runTripForecast(); });
  await act(async () => h.requests[0].respond({ error: 'Old request failed' }, 400));
  assert.equal(h.current.tripForecastLoading, true);
  assert.equal(h.current.tripForecastError, null);
  await act(async () => h.requests[1].respond(tripPayload()));
  assert.equal(h.current.tripForecastLoading, false);
  assert.equal(h.current.tripForecastRows.length, 1);
});

test('clearing trip results for an edited plan invalidates its pending request', async t => {
  const h = await mountHook(t, useTripForecast, tripInput);
  await act(async () => { void h.current.runTripForecast(); });
  await act(async () => h.current.setTripForecastRows([]));
  assert.equal(h.current.tripForecastLoading, false);
  await act(async () => h.requests[0].respond(tripPayload()));
  assert.deepEqual(h.current.tripForecastRows, []);
  assert.equal(h.current.tripForecastError, null);
  assert.equal(h.requests[0].init.signal.aborted, true);
});

test('an invalid trip run supersedes a previous valid pending run', async t => {
  const h = await mountHook(t, useTripForecast, tripInput);
  await act(async () => { void h.current.runTripForecast(); });
  await act(async () => h.current.setTripStartDate(tripInput.maxForecastDate));
  await act(async () => { void h.current.runTripForecast(); });
  await act(async () => h.requests[0].respond(tripPayload()));
  assert.equal(h.current.tripForecastLoading, false);
  assert.deepEqual(h.current.tripForecastRows, []);
  assert.match(h.current.tripForecastError, /At least two forecast dates/);
});

test('an unmounted trip forecast cannot update account usage', async t => {
  let usageUpdates = 0;
  const h = await mountHook(t, useTripForecast, { ...tripInput, onUsageUpdated: () => { usageUpdates++; } });
  await act(async () => { void h.current.runTripForecast(); });
  await h.unmount();
  await act(async () => h.requests[0].respond(tripPayload(plan.date, { multiDayUsage: usage })));
  assert.equal(usageUpdates, 0);
  assert.equal(h.requests[0].init.signal.aborted, true);
});

async function startWakeHealthCheck(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = await mountHook(t, useSafetyData, {
    todayDate: plan.date, preferences, isProductionBuild: true,
    objectiveNameRef: { current: 'Mount Rainier' },
  });
  await act(async () => { void h.current.fetchSafetyData(plan.lat, plan.lon, plan.date, plan.start); });
  // A populated HTTP 500 response bypasses the API client's transport retries.
  await act(async () => h.requests[0].respond({ error: 'Safety API request failed (500)' }, 500));
  await act(async () => t.mock.timers.tick(BACKEND_WAKE_RETRY_DELAY_MS));
  assert.equal(h.requests[1].url.pathname, '/api/healthz');
  return h;
}

test('a late healthy wake check cannot regenerate a cleared objective', async t => {
  const h = await startWakeHealthCheck(t);
  await act(async () => h.current.clearWakeRetry());
  await act(async () => h.requests[1].respond({ ok: true }));
  assert.equal(h.requests.length, 2);
});

test('a late unhealthy wake check cannot restart a cleared retry loop', async t => {
  const h = await startWakeHealthCheck(t);
  await act(async () => h.current.clearWakeRetry());
  await act(async () => h.requests[1].respond({ ok: false }));
  await act(async () => t.mock.timers.tick(BACKEND_WAKE_RETRY_DELAY_MS));
  assert.equal(h.requests.length, 2);
});

test('a pending wake check cannot restart report generation after unmount', async t => {
  const h = await startWakeHealthCheck(t);
  await h.unmount();
  await act(async () => h.requests[1].respond({ ok: true }));
  assert.equal(h.requests.length, 2);
});

test('a superseded health check cannot clear a newer retry for the same plan', async t => {
  const h = await startWakeHealthCheck(t);
  await act(async () => { void h.current.fetchSafetyData(plan.lat, plan.lon, plan.date, plan.start, { force: true }); });
  await act(async () => h.requests[2].respond({ error: 'Safety API request failed (500)' }, 500));
  await act(async () => h.requests[1].respond({ ok: true }));
  assert.equal(h.requests.length, 3, 'the older health check must not start another report');
  await act(async () => t.mock.timers.tick(BACKEND_WAKE_RETRY_DELAY_MS));
  assert.equal(h.requests[3].url.pathname, '/api/healthz', 'the newer retry remains scheduled');
});

test('the active healthy wake check still regenerates its report', async t => {
  const h = await startWakeHealthCheck(t);
  await act(async () => h.requests[1].respond({ ok: true }));
  assert.equal(h.requests[2].url.pathname, '/api/safety');
  await act(async () => h.requests[2].respond(makeReport(plan, 'clear')));
  assert.equal(h.current.safetyData.forecast.selectedDate, plan.date);
  assert.equal(h.current.error, null);
  assert.equal(h.current.loading, false);
});
