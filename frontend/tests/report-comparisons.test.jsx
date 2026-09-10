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
import { useWorkspace } from '../src/field/model/useWorkspace';
import { AccountContext } from '../src/contexts/account';

const preferences = { ...getDefaultUserPreferences(), travelWindowHours: 10 };
const plan = { lat: 46.8523, lon: -121.7603, date: '2026-09-06', start: '07:00', travel_window_hours: 10 };
function props(overrides = {}) {
  return { enabled: true, sourceReport: makeReport(plan, 'clear'), forecastDate: plan.date,
    currentStartTime: plan.start, position: { lat: plan.lat, lng: plan.lon }, preferences, ...overrides };
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


import { useTripForecast } from '../src/hooks/useTripForecast';

test('multi-day parsing preserves missing readings and genuine zero values', async t => {
  const h = await mountHook(t, useTripForecast, {
    hasObjective: true,
    position: { lat: plan.lat, lng: plan.lon },
    todayDate: plan.date,
    maxForecastDate: '2026-09-13',
    initialStartDate: plan.date,
    initialStartTime: plan.start,
    preferences,
    objectiveName: 'Test mountain',
  });
  const reports = [null, '', 0].map((value, index) => {
    const data = makeReport({ ...plan, date: `2026-09-0${6 + index}` }, 'clear');
    data.safety.score = value;
    data.weather.windGust = value;
    data.weather.precipChance = value;
    return data;
  });
  await act(async () => {
    const pending = h.current.runTripForecast();
    assert.equal(h.requests.length, 1);
    h.requests[0].respond({ days: reports });
    await pending;
  });
  assert.equal(h.current.tripForecastError, null);
  assert.equal(h.current.tripForecastRows.length, 3);
  for (const field of ['score', 'windGustMph', 'precipChance']) {
    assert.deepEqual(h.current.tripForecastRows.map(day => day[field]), [null, null, 0], field);
  }
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

function useSyncedSession(input) {
  const session = useSavedReportSession(input);
  const noOp = () => {};
  useSavedReportSync(session, { ...input, hasObjective: true, viewingHistoryReport: false, reportHistoryEnabled: true,
    syncGeneratedReportUsage: noOp, setReportChatMessages: noOp, resetRouteState: noOp, setReportChatSessionKey: noOp });
  return session;
}
function savedTestSnapshot() {
  const safetyData = makeReport(plan, 'clear');
  return buildPersistedReport({lat:plan.lat,lon:plan.lon,objectiveName:'Test',searchQuery:'',forecastDate:plan.date,
    alpineStartTime:plan.start,targetElevationInput:'',travelWindowHours:10},safetyData,{}, {preferences});
}
test('account changes cancel queued updates and reject old automatic saves', async t => {
  const input = {accountLoading:false,accountUserId:'account-A',safetyData:null,reportSnapshot:null};
  const h = await mountHook(t,useSyncedSession,input);
  await act(async () => h.current.beginSavedReportGeneration());
  const snapshot = savedTestSnapshot();
  await h.render({...input,safetyData:snapshot.safetyData,reportSnapshot:snapshot});
  assert.equal(h.requests.length,1);
  await h.render({...input,accountUserId:'account-B',safetyData:snapshot.safetyData,reportSnapshot:snapshot});
  await act(async()=>h.requests[0].respond({report:{id:'old-A',shareToken:'token-A'},reportCount:1,reportUsage:manualSaveUsage}));
  assert.equal(h.current.activeSavedReportId,null);
  await act(async()=>h.current.setActiveSavedReportId('owned-by-B'));
  await h.render({...input,accountUserId:'account-C',safetyData:snapshot.safetyData,reportSnapshot:snapshot});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,450));});
  assert.equal(h.requests.length,1,'no queued update is sent with the next account session');
});

test('initial account hydration preserves an explicitly waiting report generation', async t => {
  const input={accountLoading:true,accountUserId:undefined,safetyData:null,reportSnapshot:null};
  const h=await mountHook(t,useSyncedSession,input,true);
  await act(async()=>h.current.beginSavedReportGeneration());
  const snapshot=savedTestSnapshot();
  await h.render({...input,safetyData:snapshot.safetyData,reportSnapshot:snapshot});
  assert.equal(h.requests.length,0);
  await h.render({...input,accountLoading:false,accountUserId:'account-A',safetyData:snapshot.safetyData,reportSnapshot:snapshot});
  assert.equal(h.requests.length,1);
  await act(async()=>h.requests[0].respond({report:{id:'current-A',shareToken:'token-A'},reportCount:1,reportUsage:manualSaveUsage}));
  assert.equal(h.current.activeSavedReportId,'current-A');
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
  assert.equal(h.requests.length, 4);
  assert.equal(h.requests[0].url.searchParams.get('start'), '13:30');
  await respondAll(h.requests);
  assert.equal(h.current.dayOverDay.startTime, '13:30');
  await h.render({ ...input, currentStartTime: '14:00' });
  assert.equal(h.requests.length, 4, 'editing departure hides comparisons until a new report exists');
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

test('previous-day comparisons accept a real zero score and stop when the current score is missing', async t => {
  const source = makeReport(plan, 'clear');
  const input = { hasObjective: true, view: 'planner', safetyData: source,
    forecastDate: plan.date, currentStartTime: plan.start, position: { lat: plan.lat, lng: plan.lon }, preferences };
  const h = await mountHook(t, useDayComparisons, input);
  const previous = makeReport({ ...plan, date: '2026-09-05' }, 'clear');
  previous.safety.score = 0;
  await act(async () => h.requests[0].respond(previous));
  assert.equal(h.current.dayOverDay.previousScore, 0);
  assert.equal(h.current.dayOverDay.delta, source.safety.score);
  await h.render({ ...input, safetyData: { ...source, safety: { ...source.safety, score: null } } });
  assert.equal(h.current.dayOverDay, null);
  assert.equal(h.requests.length, 1);
});

for (const missing of [null, '', '   ']) {
  test(`previous-day comparison rejects missing scores (${JSON.stringify(missing)})`, async t => {
    const source = makeReport(plan, 'clear');
    const h = await mountHook(t, useDayComparisons, { hasObjective: true, view: 'planner', safetyData: source,
      forecastDate: plan.date, currentStartTime: plan.start, position: { lat: plan.lat, lng: plan.lon }, preferences });
    const previous = makeReport({ ...plan, date: '2026-09-05' }, 'clear');
    previous.safety.score = missing;
    await act(async () => h.requests[0].respond(previous));
    assert.equal(h.current.dayOverDay, null);
  });
}

import { buildDayOverDayChanges } from '../src/app/day-over-day';
test('day-over-day changes preserve missing evidence and genuine zero readings', () => {
  const current = makeReport(plan, 'clear');
  const previous = makeReport(plan, 'clear');
  previous.safety.score = null;
  previous.avalanche.dangerLevel = null;
  previous.weather.windGust = null;
  previous.weather.feelsLike = '';
  previous.weather.temp = null;
  previous.weather.precipChance = ' ';
  assert.deepEqual(buildDayOverDayChanges(current, previous, preferences), []);
  previous.safety.score = 0;
  previous.weather.windGust = 0;
  const changes = buildDayOverDayChanges(current, previous, preferences);
  assert.ok(changes.some(change => change.startsWith('Safety score')));
  assert.ok(changes.some(change => change.startsWith('Wind gust')));
});

for (const mismatch of ['date', 'location', 'start', 'duration']) {
  test(`comparison responses for a different ${mismatch} are rejected`, async t => {
    const base = props();
    const h = await mountHook(t, useReportComparisons, { ...base, hasObjective: true, view: 'planner', safetyData: base.sourceReport,
      viewingHistoryReport: false, loading: false, startTimeComparisonsEnabled: true });
    await act(async () => {
      for (const req of h.requests) {
        const data = makeReport(Object.fromEntries(req.url.searchParams), 'clear');
        if (mismatch === 'date') data.forecast.selectedDate = '2026-09-08';
        if (mismatch === 'location') data.location.lat += 1;
        if (mismatch === 'start') data.forecast.requestedStartTime = '23:00';
        if (mismatch === 'duration') data.rainfall.expected.travelWindowHours = 2;
        req.respond(data);
      }
    });
    assert.equal(h.current.dayOverDay, null);
    assert.equal(h.current.startTimeScenarios.comparison, null);
    assert.match(h.current.startTimeScenarios.error, /could not be evaluated/);
  });
}
