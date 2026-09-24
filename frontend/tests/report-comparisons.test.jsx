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
import { buildPersistedReport, loadPersistedReport } from '../src/app/report-storage';
import { getDefaultUserPreferences } from '../src/app/preferences';
import { makeReport } from '../dev/mock-data.mjs';
import { createMockApi } from '../dev/mock-api.mjs';
import { useWorkspace } from '../src/field/model/useWorkspace';
import { AccountContext } from '../src/contexts/account';

const preferences = { ...getDefaultUserPreferences(), travelWindowHours: 10 };
const plan = { lat: 46.8523, lon: -121.7603, date: '2026-09-06', start: '07:00', travel_window_hours: 10 };
// The traveler's limits, units and approach, as the workspace sends them.
const planSettingsQuery = 'max_gust_mph=25&max_precip_chance=60&min_feels_like_f=5&max_feels_like_f=95&temp_unit=f&wind_unit=mph&elevation_unit=ft&time_style=ampm';
function props(overrides = {}) {
  return { enabled: true, sourceReport: makeReport(plan, 'clear'), forecastDate: plan.date,
    currentStartTime: plan.start, position: { lat: plan.lat, lng: plan.lon }, travelWindowHours: preferences.travelWindowHours,
    planSettingsQuery, preferences, ...overrides };
}
async function mountHook(t, hook, initial, strict = false, account = null) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  dom.window.scrollTo = () => {};
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
    await act(async () => root.render(<AccountContext.Provider value={account}>{strict ? <StrictMode><Probe {...input} /></StrictMode> : <Probe {...input} />}</AccountContext.Provider>));
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
// Answers each request as the backend would, through the development mock that shares its modules.
const backend = createMockApi();
async function respondAll(requests, status = 200) {
  await act(async () => {
    for (const req of requests) {
      const { payload } = await backend.handle(`${req.url.pathname}${req.url.search}`);
      req.respond(status === 200 ? payload : { error: 'Unavailable' }, status);
    }
  });
}

test('departure comparisons ask the backend once per plan, and again for more departures', async t => {
  const h = await mountHook(t, useStartTimeScenarios, props());
  assert.equal(h.requests.length, 1);
  const url = h.requests[0].url;
  assert.equal(url.pathname, '/api/start-time-scenarios');
  assert.deepEqual(['lat', 'lon', 'date', 'start', 'travel_window_hours'].map(key => url.searchParams.get(key)),
    [String(plan.lat), String(plan.lon), plan.date, plan.start, '10']);
  assert.equal(url.searchParams.get('max_gust_mph'), '25', 'the traveler\'s limits travel with the request');
  assert.equal(url.searchParams.get('set'), null);
  await respondAll(h.requests);
  assert.deepEqual(h.current.comparison.scenarios.map(scenario => scenario.startTime).sort(), ['04:00', '07:00', '08:00']);
  assert.ok(h.current.comparison.scenarios.every(scenario => scenario.planned.rows.length === 10));
  assert.equal(h.current.error, null);
  await act(async () => h.current.generateMore());
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].url.searchParams.get('set'), 'extended');
  assert.equal(h.current.comparison, null);
  await respondAll(h.requests.slice(1));
  assert.equal(h.current.comparison.scenarios.length, 8);
  assert.equal(h.current.canGenerateMore, false);
});

test('previous-day comparisons send the selected local start and duration', async t => {
  const source = makeReport({ ...plan, start: '13:30', travel_window_hours: 7 }, 'clear');
  const input = { hasObjective: true, view: 'planner', safetyData: source, forecastDate: plan.date,
    currentStartTime: '13:30', position: { lat: plan.lat, lng: plan.lon }, preferences: { ...preferences, travelWindowHours: 7 } };
  const h = await mountHook(t, useDayComparisons, input);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url.pathname, '/api/day-over-day');
  assert.equal(h.requests[0].url.searchParams.get('date'), plan.date);
  assert.equal(h.requests[0].url.searchParams.get('start'), '13:30');
  assert.equal(h.requests[0].url.searchParams.get('travel_window_hours'), '7');
  await respondAll(h.requests);
  assert.equal(h.current.dayOverDay.previousDate, '2026-09-05');
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
  ['duration', { travelWindowHours: 6 }],
  ['limits', { planSettingsQuery: planSettingsQuery.replace('max_gust_mph=25', 'max_gust_mph=15') }],
]) test(`departure results disappear on the first render after changing ${label}`, async t => {
  const input = props();
  const h = await mountHook(t, useStartTimeScenarios, input);
  await respondAll(h.requests);
  assert.ok(h.current.comparison);
  const firstNewRender = h.renders.length;
  const previousRequestCount = h.requests.length;
  await h.render({ ...input, ...change });
  assert.equal(h.renders[firstNewRender].comparison, null);
  assert.equal(h.current.loading, true);
  await respondAll(h.requests.slice(previousRequestCount));
  assert.ok(h.current.comparison);
});

test('late departure responses cannot replace the current plan', async t => {
  const input = props();
  const h = await mountHook(t, useStartTimeScenarios, input);
  const oldRequests = [...h.requests];
  await h.render({ ...input, forecastDate: '2026-09-07' });
  assert.ok(oldRequests.every(req => req.init.signal.aborted));
  await respondAll(h.requests.slice(oldRequests.length));
  const current = h.current.comparison;
  await respondAll(oldRequests);
  assert.equal(h.current.comparison, current);
});

test('refresh, disabling, and failed requests never expose stale departures', async t => {
  const input = props();
  const h = await mountHook(t, useStartTimeScenarios, input);
  await respondAll(h.requests);
  assert.ok(h.current.comparison);
  const newInput = { ...input, sourceReport: { ...input.sourceReport } };
  const count = h.requests.length;
  await h.render(newInput);
  assert.equal(h.current.comparison, null, 'a refreshed report asks again');
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
  assert.deepEqual(h.requests.map(request => request.url.pathname).sort(), ['/api/day-over-day', '/api/start-time-scenarios']);
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
  assert.equal(h.requests.length, 2);
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


import { useTripForecast } from '../src/hooks/useTripForecast';

test('multi-day comparisons send the plan and show the days as the backend ranked them', async t => {
  const h = await mountHook(t, useTripForecast, {
    hasObjective: true,
    position: { lat: plan.lat, lng: plan.lon },
    todayDate: plan.date,
    maxForecastDate: '2026-09-13',
    initialStartDate: plan.date,
    initialStartTime: plan.start,
    preferences: { ...preferences, windSpeedUnit: 'kph' },
    objectiveName: 'Test mountain',
  });
  let request;
  await act(async () => {
    const pending = h.current.runTripForecast();
    assert.equal(h.requests.length, 1);
    request = h.requests[0];
    const body = JSON.parse(request.init.body);
    assert.equal(body.plan.wind_unit, 'kph');
    assert.equal(body.plan.max_gust_mph, '25');
    assert.equal(body.requestedDays, 7);
    const { payload } = await backend.handle('/api/trip-forecasts', 'POST', body);
    request.respond(payload);
    await pending;
  });
  assert.equal(h.current.tripForecastError, null);
  assert.equal(h.current.tripForecastRows.length, 7);
  assert.equal(h.current.tripRanking.order.length, 7);
  assert.equal(h.current.tripHighlights.length, 3);
  assert.equal(h.current.tripChatContext.contextType, 'multi-day-trip-plan');
  assert.ok(h.current.tripForecastRows.every(day => typeof day.rankValue === 'number' && Array.isArray(day.concerns)));
});

const manualSaveUsage = { usedReports: 1, limitReports: 10, remainingReports: 9, percentUsed: 10, unlimited: false, exhausted: false, tierKey: 'free', periodStart: '2026-09-01', periodEnd: '2026-10-01', resetAt: '2026-10-01' };

for (const transition of ['edit', 'new generation', 'saved history']) {
  test(`late manual save does not attach after ${transition}`, async t => {
    const input = { accountLoading: false, accountUserId: 'test-account', safetyData: null };
    const h = await mountHook(t, useSavedReportSession, input);
    const data = makeReport(plan, 'clear');
    const snapshot = buildPersistedReport({ lat: plan.lat, lon: plan.lon, objectiveName: 'Report A', searchQuery: '', forecastDate: plan.date,
      alpineStartTime: plan.start, targetElevationInput: '', travelWindowHours: 10 }, data, {}, { preferences });
    let saving;
    let usageSyncs = 0;
    await act(async () => { saving = h.current.saveReportSnapshot(snapshot, () => { usageSyncs++; }); });
    assert.equal(h.requests.length, 1);
    await act(async () => {
      if (transition === 'new generation') h.current.beginSavedReportGeneration();
      else h.current.resetSavedReportTracking();
      if (transition === 'saved history') { h.current.setActiveSavedReportId('report-B'); h.current.setActiveSavedReportShareToken('token-B'); }
    });
    const intent = h.current.reportSaveIntentRef.current;
    await act(async () => {
      h.requests[0].respond({ report: { id: 'report-A', shareToken: 'token-A' }, reportCount: 1, reportUsage: manualSaveUsage });
      assert.equal(await saving, null);
    });
    assert.equal(h.current.activeSavedReportId, transition === 'saved history' ? 'report-B' : null);
    assert.equal(h.current.activeSavedReportShareToken, transition === 'saved history' ? 'token-B' : null);
    assert.equal(h.current.reportSaveIntentRef.current, intent);
    assert.equal(usageSyncs, 1);
  });
}

test('manual save attaches once when current and can retry an error', async t => {
  const h = await mountHook(t, useSavedReportSession, { accountLoading: false, accountUserId: 'test-account', safetyData: null });
  const snapshot = { plan: {}, safetyData: {} };
  let saving;
  await act(async () => { saving = h.current.saveReportSnapshot(snapshot, () => {}).catch(error => error); });
  assert.equal(await h.current.saveReportSnapshot(snapshot, () => {}), null);
  await act(async () => { h.requests[0].respond({error:'Offline'}, 400); });
  assert.match((await saving).message, /Offline/);
  assert.equal(h.current.reportSaveIntentRef.current, 'browser-only');
  await act(async () => { saving = h.current.saveReportSnapshot(snapshot, () => {}); });
  await act(async () => { h.requests[1].respond({report:{id:'saved',shareToken:'token'},reportCount:1,reportUsage:manualSaveUsage}); await saving; });
  assert.equal(h.current.activeSavedReportId, 'saved');
  assert.equal(h.current.lastSavedReportSnapshotRef.current, JSON.stringify(snapshot));
});

for (const nextUser of [undefined, 'account-B']) {
  test(`account change to ${nextUser || 'signed out'} clears identity before it is rendered`, async t => {
    const input = { accountLoading: false, accountUserId: 'account-A', safetyData: null };
    const h = await mountHook(t, useSavedReportSession, input);
    await act(async () => { h.current.setActiveSavedReportId('owned-by-A'); h.current.setActiveSavedReportShareToken('token-A'); });
    const firstRender = h.renders.length;
    await h.render({ ...input, accountUserId: nextUser });
    assert.equal(h.renders[firstRender].activeSavedReportId, null);
    assert.equal(h.renders[firstRender].activeSavedReportShareToken, null);
    assert.equal(h.current.activeSavedReportId, null);
    // A -> B -> A must not resurrect the old saved identity either.
    await h.render(input);
    assert.equal(h.current.activeSavedReportId, null);
  });
}

test('late manual saves from the old account cannot attach to the new one', async t => {
  const input = { accountLoading: false, accountUserId: 'account-A', safetyData: null };
  const h = await mountHook(t, useSavedReportSession, input);
  let pending;
  await act(async () => { pending = h.current.saveReportSnapshot({plan:{},safetyData:{}}, () => {}); });
  await h.render({ ...input, accountUserId: 'account-B' });
  await act(async () => {
    h.requests[0].respond({report:{id:'old-A',shareToken:'token-A'},reportCount:1,reportUsage:manualSaveUsage});
    assert.equal(await pending, null);
  });
  assert.equal(h.current.activeSavedReportId, null);
  assert.equal(h.current.activeSavedReportShareToken, null);
  assert.equal(h.current.reportSaveIntentRef.current, 'browser-only');
});

const usageSyncs = [];
function useSyncedSession(input) {
  const session = useSavedReportSession(input);
  const noOp = () => {};
  useSavedReportSync(session, { ...input, hasObjective: true, viewingHistoryReport: false,
    syncGeneratedReportUsage: (...args) => usageSyncs.push(args),
    setReportChatMessages: noOp, onReportGenerated: noOp, setReportChatSessionKey: noOp });
  return session;
}
function savedTestSnapshot() {
  const safetyData = makeReport(plan, 'clear');
  return buildPersistedReport({lat:plan.lat,lon:plan.lon,objectiveName:'Test',searchQuery:'',forecastDate:plan.date,
    alpineStartTime:plan.start,targetElevationInput:'',travelWindowHours:10},safetyData,{}, {preferences});
}
test('generated reports are metered after account hydration but never saved', async t => {
  usageSyncs.length = 0;
  const input={accountLoading:true,accountUserId:undefined,safetyData:null,reportSnapshot:null};
  const h=await mountHook(t,useSyncedSession,input,true);
  await act(async()=>h.current.beginSavedReportGeneration());
  const snapshot=savedTestSnapshot();
  await h.render({...input,safetyData:snapshot.safetyData,reportSnapshot:snapshot});
  assert.equal(h.requests.length,0);
  await h.render({...input,accountLoading:false,accountUserId:'account-A',safetyData:snapshot.safetyData,reportSnapshot:snapshot});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,450));});
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].url.pathname,'/api/account/reports/generations');
  const {idempotencyKey}=JSON.parse(h.requests[0].init.body);
  assert.match(idempotencyKey,/^[A-Za-z0-9_-]{8,64}$/);
  await act(async()=>h.requests[0].respond({reportCount:2,reportUsage:manualSaveUsage}));
  assert.deepEqual(usageSyncs,[['account-A',2,manualSaveUsage]]);
  assert.equal(h.current.activeSavedReportId,null,'metering does not create a saved report');
});

test('signed-out generations are not metered or saved', async t => {
  const input={accountLoading:false,accountUserId:undefined,safetyData:null,reportSnapshot:null};
  const h=await mountHook(t,useSyncedSession,input);
  await act(async()=>h.current.beginSavedReportGeneration());
  const snapshot=savedTestSnapshot();
  await h.render({...input,safetyData:snapshot.safetyData,reportSnapshot:snapshot});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,450));});
  assert.equal(h.requests.length,0);
});

test('account changes cancel queued updates to a saved report', async t => {
  const input = {accountLoading:false,accountUserId:'account-A',safetyData:null,reportSnapshot:null};
  const h = await mountHook(t,useSyncedSession,input);
  await act(async () => h.current.beginSavedReportGeneration());
  const snapshot = savedTestSnapshot();
  await h.render({...input,accountUserId:'account-B',safetyData:snapshot.safetyData,reportSnapshot:snapshot});
  await act(async()=>h.current.setActiveSavedReportId('owned-by-B'));
  await h.render({...input,accountUserId:'account-C',safetyData:snapshot.safetyData,reportSnapshot:snapshot});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,450));});
  assert.ok(h.requests.every(req=>req.url.pathname==='/api/account/reports/generations'),'no queued update is sent with the next account session');
});

for (const legacy of [false, true]) {
  test(`saved snapshot survives preference navigation${legacy ? ' without embedded preferences' : ''}`, async t => {
    const userPreferences = { ...getDefaultUserPreferences(), travelWindowHours: 12 };
    const account = { loading: false, user: { id: 'test-account', email: 'test@example.test', preferences: userPreferences },
      refreshAccount: async () => {}, savePreferences: async () => {}, syncMultiDayUsage: () => {}, syncGeneratedReportUsage: () => {} };
    const h = await mountHook(t, useWorkspace, {}, false, account);
    const snapshot = savedTestSnapshot();
    snapshot.plan.travelWindowHours = 3;
    snapshot.preferences = legacy ? null : { ...snapshot.preferences, travelWindowHours: 3 };
    await act(async () => h.current.handleOpenSavedReport(snapshot, ''));
    assert.equal(h.current.reportSnapshot.plan.travelWindowHours, 3);
    const restored = h.current.reportSnapshot;
    await act(async () => h.current.navigateToView('settings'));
    assert.equal(h.current.preferences.travelWindowHours, 12, 'settings retains the user preference');
    assert.equal(h.current.reportSnapshot, restored, 'navigation does not rebuild the saved snapshot');
    assert.equal(loadPersistedReport().plan.travelWindowHours, 3);
    assert.equal(loadPersistedReport().preferences.travelWindowHours, 3);
    await act(async () => h.current.navigateToView('history'));
    assert.equal(loadPersistedReport().plan.travelWindowHours, 3);
    await act(async () => h.current.navigateToView('planner'));
    assert.equal(h.current.reportSnapshot.plan.travelWindowHours, 3);
    await act(async () => h.current.handleEditPlan());
    assert.equal(h.current.reportSnapshot, null, 'editing leaves the saved snapshot');
    assert.equal(h.current.preferences.travelWindowHours, 12);
  });
}


test('comparison coordination uses the requested clock instead of the forecast period timestamp', async t => {
  const base = props({ currentStartTime: '13:30' });
  base.sourceReport.forecast.selectedStartTime = `${plan.date}T13:00:00-07:00`;
  base.sourceReport.forecast.requestedStartTime = '13:30';
  const input = { ...base, hasObjective: true, view: 'planner', safetyData: base.sourceReport,
    viewingHistoryReport: false, loading: false, startTimeComparisonsEnabled: true };
  const h = await mountHook(t, useReportComparisons, input);
  assert.equal(h.requests.length, 2);
  assert.ok(h.requests.every(request => request.url.searchParams.get('start') === '13:30'));
  await respondAll(h.requests);
  assert.equal(h.current.dayOverDay.startTime, '13:30');
  await h.render({ ...input, currentStartTime: '14:00' });
  assert.equal(h.requests.length, 2, 'editing departure hides comparisons until a new report exists');
  assert.equal(h.current.dayOverDay, null);
  assert.equal(h.current.startTimeScenarios.comparison, null);
});

test('legacy timestamp reports use the planner clock for previous-day requests', async t => {
  const source = makeReport(plan, 'clear');
  delete source.forecast.requestedStartTime;
  source.forecast.selectedStartTime = `${plan.date}T06:00:00-07:00`;
  const h = await mountHook(t, useDayComparisons, { hasObjective: true, view: 'planner', safetyData: source,
    forecastDate: plan.date, currentStartTime: '07:30', position: { lat: plan.lat, lng: plan.lon }, preferences });
  assert.equal(h.requests[0].url.searchParams.get('start'), '07:30');
});

test('previous-day comparisons stop when the current report has no score', async t => {
  const source = makeReport(plan, 'clear');
  const input = { hasObjective: true, view: 'planner', safetyData: source,
    forecastDate: plan.date, currentStartTime: plan.start, position: { lat: plan.lat, lng: plan.lon }, preferences };
  const h = await mountHook(t, useDayComparisons, input);
  await respondAll(h.requests);
  assert.ok(h.current.dayOverDay);
  await h.render({ ...input, safetyData: { ...source, safety: { ...source.safety, score: null } } });
  assert.equal(h.current.dayOverDay, null);
  assert.equal(h.requests.length, 1);
});

test('a prior day the backend cannot compare shows no comparison', async t => {
  const source = makeReport(plan, 'clear');
  const h = await mountHook(t, useDayComparisons, { hasObjective: true, view: 'planner', safetyData: source,
    forecastDate: plan.date, currentStartTime: plan.start, position: { lat: plan.lat, lng: plan.lon }, preferences });
  await act(async () => h.requests[0].respond({ comparison: null }));
  assert.equal(h.current.dayOverDay, null);
});
