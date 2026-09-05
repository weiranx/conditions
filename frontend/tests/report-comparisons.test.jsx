import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useDayComparisons } from '../src/hooks/useDayComparisons';
import { useStartTimeScenarios } from '../src/hooks/useStartTimeScenarios';
import { useReportComparisons } from '../src/field/model/useReportComparisons';
import { useReportGeneration } from '../src/field/model/useReportGeneration';
import { useSavedReportSession, useSavedReportSync } from '../src/field/model/useSavedReportSync';
import { buildPersistedReport } from '../src/app/report-storage';
import { getDefaultUserPreferences } from '../src/app/preferences';
import { makeReport } from '../dev/mock-data.mjs';

const preferences = { ...getDefaultUserPreferences(), travelWindowHours: 10 };
const plan = { lat: 46.8523, lon: -121.7603, date: '2026-09-06', start: '07:00', travel_window_hours: 10 };
function props(overrides = {}) {
  return { enabled: true, sourceReport: makeReport(plan, 'clear'), forecastDate: plan.date,
    currentStartTime: plan.start, position: { lat: plan.lat, lng: plan.lon }, preferences, ...overrides };
}
async function mountHook(t, hook, initial, strict = false) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const requests = [];
  globalThis.fetch = (url, init) => new Promise(resolve => requests.push({
    url: new URL(url, 'http://localhost'), init,
    // Intentionally allow late responses after abort to exercise the result guards.
    respond(payload, status = 200) { resolve(new Response(JSON.stringify(payload), { status })); },
  }));
  let current;
  const renders = [];
  function Probe(input) { current = hook(input); renders.push(current); return null; }
  const root = createRoot(document.getElementById('root'));
  async function render(input) {
    await act(async () => root.render(strict ? <StrictMode><Probe {...input} /></StrictMode> : <Probe {...input} />));
  }
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  await render(initial);
  return { get current() { return current; }, requests, renders, render };
}
async function respondAll(requests, status = 200) {
  await act(async () => {
    for (const req of requests) req.respond(makeReport(Object.fromEntries(req.url.searchParams), 'clear'), status);
  });
}

test('previous-day comparisons preserve the selected local start and duration', async t => {
  const source = makeReport({ ...plan, start: '13:30', travel_window_hours: 7 }, 'clear');
  const input = { hasObjective: true, view: 'planner', safetyData: source, forecastDate: plan.date,
    currentStartTime: '13:30', position: { lat: plan.lat, lng: plan.lon }, preferences: { ...preferences, travelWindowHours: 7 } };
  const h = await mountHook(t, useDayComparisons, input);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url.searchParams.get('date'), '2026-09-05');
  assert.equal(h.requests[0].url.searchParams.get('start'), '13:30');
  assert.equal(h.requests[0].url.searchParams.get('travel_window_hours'), '7');
  await respondAll(h.requests);
  assert.equal(h.current.dayOverDay.startTime, '13:30');
  assert.equal(h.current.dayOverDay.travelWindowHours, 7);
  const old = h.current.dayOverDay;
  await h.render({ ...input, safetyData: { ...source } });
  assert.equal(h.current.dayOverDay, null, 'refresh must hide a previous comparison even when scores match');
  await respondAll(h.requests.slice(1));
  assert.notEqual(h.current.dayOverDay, old);
});

for (const [label, change] of [
  ['date', { forecastDate: '2026-09-07' }],
  ['location', { position: { lat: 36.5786, lng: -118.2923 } }],
  ['start', { currentStartTime: '12:00' }],
  ['duration', { preferences: { ...preferences, travelWindowHours: 6 } }],
]) test(`departure results disappear on the first render after changing ${label}`, async t => {
  const input = props();
  const h = await mountHook(t, useStartTimeScenarios, input);
  await respondAll(h.requests);
  assert.ok(h.current.comparison);
  const firstNewRender = h.renders.length;
  await h.render({ ...input, ...change });
  assert.equal(h.renders[firstNewRender].comparison, null);
  assert.equal(h.current.loading, true);
  await respondAll(h.requests.slice(3));
  assert.ok(h.current.comparison);
});

test('late departure responses cannot replace the current plan', async t => {
  const input = props();
  const h = await mountHook(t, useStartTimeScenarios, input);
  const oldRequests = [...h.requests];
  await h.render({ ...input, forecastDate: '2026-09-07' });
  assert.ok(oldRequests.every(req => req.init.signal.aborted));
  await respondAll(h.requests.slice(3));
  const current = h.current.comparison;
  assert.equal(current.scenarios[0].data.forecast.selectedDate, '2026-09-07');
  await respondAll(oldRequests);
  assert.equal(h.current.comparison, current);
});

test('refresh, expansion, disabling, and failed requests never expose stale departures', async t => {
  const input = props();
  const h = await mountHook(t, useStartTimeScenarios, input);
  await respondAll(h.requests);
  await act(async () => h.current.generateMore());
  assert.equal(h.current.comparison, null);
  assert.equal(h.current.loading, true);
  await respondAll(h.requests.slice(3));
  assert.equal(h.current.comparison.scenarios.length, 8);
  const newInput = { ...input, sourceReport: { ...input.sourceReport } };
  const count = h.requests.length;
  await h.render(newInput);
  assert.equal(h.current.comparison, null);
  await respondAll(h.requests.slice(count), 400);
  assert.equal(h.current.loading, false);
  assert.equal(h.current.comparison, null);
  assert.match(h.current.error, /could not be evaluated/);
  await h.render({ ...newInput, enabled: false });
  assert.equal(h.current.comparison, null);
  assert.equal(h.current.error, null);
  assert.equal(h.current.loading, false);
});

test('saved snapshots and a report being regenerated do not trigger comparisons', async t => {
  const base = props();
  const input = { ...base, hasObjective: true, view: 'planner', safetyData: base.sourceReport,
    viewingHistoryReport: true, loading: false, startTimeComparisonsEnabled: true };
  const h = await mountHook(t, useReportComparisons, input);
  assert.equal(h.requests.length, 0);
  await h.render({ ...input, viewingHistoryReport: false, loading: true });
  assert.equal(h.requests.length, 0);
  await h.render({ ...input, viewingHistoryReport: false });
  assert.equal(h.requests.length, 4);
});

test('report generation respects access checks and does not run on draft edits', async t => {
  const calls = [];
  const input = { autoGenerateInitially: false, hasObjective: true, forecastDate: '2099-09-06', alpineStartTime: '07:00',
    objectiveTimezone: 'America/Los_Angeles', accountLoading: false, view: 'planner', position: { lat: plan.lat, lng: plan.lon },
    safetyData: null, requestNewReportAccess: () => false, beginReportGeneration: () => calls.push('begin'),
    collapseMobilePlanControls: () => {}, fetchSafetyData: (...args) => calls.push(args),
    setPreviousSafetyData: () => {}, setPastStartPrompt: () => {} };
  const h = await mountHook(t, useReportGeneration, input);
  await act(async () => h.current.handleGenerateReport());
  assert.equal(calls.length, 0);
  await h.render({ ...input, alpineStartTime: '09:00', requestNewReportAccess: () => true });
  assert.equal(calls.length, 0);
  await act(async () => h.current.handleGenerateReport());
  assert.equal(calls[0], 'begin');
  assert.equal(calls[1][3], '09:00');
  assert.equal(calls[1][4].countAsNewReport, true);
});

test('shared-plan startup generates once under StrictMode', async t => {
  let generated = 0;
  const input = { autoGenerateInitially: true, hasObjective: true, forecastDate: '2099-09-06', alpineStartTime: '07:00',
    objectiveTimezone: 'America/Los_Angeles', accountLoading: false, view: 'planner', position: { lat: plan.lat, lng: plan.lon },
    safetyData: null, requestNewReportAccess: () => true, beginReportGeneration: () => {},
    collapseMobilePlanControls: () => {}, fetchSafetyData: () => { generated++; }, setPreviousSafetyData: () => {}, setPastStartPrompt: () => {} };
  const h = await mountHook(t, useReportGeneration, input, true);
  assert.equal(generated, 1);
  assert.equal(h.current.pendingAutoGenerate, false);
});

test('a late account save cannot attach its identity to a new report generation', async t => {
  const noOp = () => {};
  let usageSyncs = 0;
  const syncUsage = () => { usageSyncs++; };
  function useSession(input) {
    const session = useSavedReportSession(input);
    useSavedReportSync(session, { ...input, hasObjective: true, viewingHistoryReport: false,
      reportHistoryEnabled: true, syncGeneratedReportUsage: syncUsage, setReportChatMessages: noOp,
      resetRouteState: noOp, setReportChatSessionKey: noOp });
    return session;
  }
  const input = { accountLoading: false, accountUserId: 'test-account', safetyData: null, reportSnapshot: null };
  const h = await mountHook(t, useSession, input);
  await act(async () => h.current.beginSavedReportGeneration());
  const data = makeReport(plan, 'clear');
  const snapshot = buildPersistedReport({ lat: plan.lat, lon: plan.lon, objectiveName: 'Test', searchQuery: 'Test',
    forecastDate: plan.date, alpineStartTime: plan.start, targetElevationInput: '', travelWindowHours: 10 }, data, {}, { preferences });
  await h.render({ ...input, safetyData: data, reportSnapshot: snapshot });
  assert.equal(h.requests.length, 1);
  await act(async () => h.current.resetSavedReportTracking());
  await act(async () => h.requests[0].respond({ report: { id: 'old-report', shareToken: 'old-token' }, reportCount: 1,
    reportUsage: { usedReports: 1, limitReports: 10, remainingReports: 9, percentUsed: 10, unlimited: false, exhausted: false, tierKey: 'free', periodStart: '2026-09-01', periodEnd: '2026-10-01', resetAt: '2026-10-01' } }));
  assert.equal(h.current.activeSavedReportId, null);
  assert.equal(usageSyncs, 1, 'a successful obsolete save still updates account usage');
});

test('comparison coordination rejects a draft that no longer matches its report', async t => {
  const base = props();
  const input = { ...base, hasObjective: true, view: 'planner', safetyData: base.sourceReport,
    viewingHistoryReport: false, loading: false, startTimeComparisonsEnabled: true };
  const h = await mountHook(t, useReportComparisons, { ...input, currentStartTime: '14:00' });
  assert.equal(h.requests.length, 0);
  assert.equal(h.current.dayOverDay, null);
  assert.equal(h.current.startTimeScenarios.comparison, null);
  await h.render({ ...input, preferences: { ...preferences, travelWindowHours: 3 } });
  assert.equal(h.requests.length, 0);
  await h.render(input);
  assert.equal(h.requests.length, 4);
});

test('late previous-day responses do not overwrite a newly selected report', async t => {
  const source = makeReport(plan, 'clear');
  const input = { hasObjective: true, view: 'planner', safetyData: source, forecastDate: plan.date,
    currentStartTime: plan.start, position: { lat: plan.lat, lng: plan.lon }, preferences };
  const h = await mountHook(t, useDayComparisons, input);
  const oldRequest = h.requests[0];
  const next = makeReport({ ...plan, date: '2026-09-07', start: '13:30', travel_window_hours: 7 }, 'clear');
  await h.render({ ...input, safetyData: next, forecastDate: '2026-09-07', currentStartTime: '13:30',
    preferences: { ...preferences, travelWindowHours: 7 } });
  assert.equal(oldRequest.init.signal.aborted, true);
  await respondAll(h.requests.slice(1));
  const comparison = h.current.dayOverDay;
  assert.equal(comparison.previousDate, '2026-09-06');
  assert.equal(comparison.startTime, '13:30');
  await respondAll([oldRequest]);
  assert.equal(h.current.dayOverDay, comparison);
});
