import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { getDefaultUserPreferences } from '../src/app/preferences';
import { objectiveFrom, readShortlist, rankShortlist, sameChoice, shortlistValidation, SHORTLIST_KEY } from '../src/app/objective-shortlist';
import { useObjectiveShortlist } from '../src/field/model/useObjectiveShortlist';
import ObjectiveShortlist from '../src/field/ObjectiveShortlist';
import { makeReport } from '../dev/mock-data.mjs';
const preferences = { ...getDefaultUserPreferences(), travelWindowHours: 8 };
const rainier = objectiveFrom({ name: 'Rainier', lat: 46.8523, lon: -121.7603 });
const hood = objectiveFrom({ name: 'Hood', lat: 45.3735, lon: -121.6959 });
const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const state = { objectives: [rainier, hood], startDate: date, durationDays: 2, startTime: '07:00', hours: 8, planA: null, planB: null };
const report = (objective = rainier, day = date) => {
  const data = makeReport({ lat: objective.lat, lon: objective.lon, date: day, start: '07:00', travel_window_hours: 8 }, 'clear');
  // Production returns forecast-period timestamps, not the requested HH:mm.
  data.forecast.selectedStartTime = data.weather.forecastStartTime;
  data.forecast.selectedEndTime = data.weather.forecastEndTime;
  return data;
};
async function harness(t, initial = state, component = false) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.setItem(SHORTLIST_KEY, JSON.stringify(initial));
  const requests = [], usage = [], limits = [], opened = [];
  globalThis.fetch = (url, init) => new Promise(resolve => requests.push({ url, init,
    respond(payload, status = 200) { resolve(new Response(JSON.stringify(payload), { status })); } }));
  const callbacks = { onUsageUpdated: u => usage.push(u), onUsageLimitReached: u => limits.push(u) };
  let current;
  function Probe({ input }) { current = useObjectiveShortlist(input, preferences, callbacks); return null; }
  const workspace = { preferences, tripStartDate: date, tripStartTime: '07:00', travelWindowHours: 8, todayDate: date, maxForecastDate: '2099-01-01',
    hasObjective: false, accountLoading: false, handleMultiDayUsageUpdated: callbacks.onUsageUpdated, handleMultiDayUsageLimitReached: callbacks.onUsageLimitReached,
    formatWindDisplay: n => n == null ? 'Unavailable' : `${n} mph`, handleOpenComparisonPlan: p => opened.push(p) };
  const root = createRoot(document.getElementById('root'));
  const render = async input => { await act(async () => root.render(component ? <ObjectiveShortlist workspace={workspace} /> : <Probe input={input} />)); };
  await render(initial);
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });
  return { get current() { return current; }, requests, usage, limits, opened, render, root, workspace };
}
async function respond(request, payload, status = 200) { await act(async () => request.respond(payload, status)); }
async function click(text) {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text || b.getAttribute('aria-label') === text);
  assert.ok(button, `Button ${text} exists`);
  await act(async () => button.click());
}

test('shortlist coordinates reject invalid values and collapse duplicate locations', async t => {
  assert.equal(objectiveFrom({ name: 'Bad', lat: null, lon: 1 }), null);
  assert.equal(objectiveFrom({ name: 'Bad', lat: 91, lon: 1 }), null);
  const h = await harness(t);
  assert.ok(h);
  localStorage.setItem(SHORTLIST_KEY, JSON.stringify({ ...state, objectives: [rainier, rainier, hood, { name: 'bad', lat: null, lon: null }] }));
  assert.deepEqual(readShortlist(state).objectives, [rainier, hood]);
  localStorage.setItem(SHORTLIST_KEY, '{broken');
  assert.deepEqual(readShortlist(state), state);
});
test('saved plans retain their own date, departure and duration and reject malformed choices', async t => {
  await harness(t);
  const choice = { objectiveId: rainier.id, date, startTime: '05:30', hours: 12 };
  localStorage.setItem(SHORTLIST_KEY, JSON.stringify({ ...state, planA: choice, planB: choice }));
  const saved = readShortlist(state);
  assert.deepEqual(saved.planA, choice);
  assert.equal(saved.planB, null);
  assert.equal(sameChoice(choice, { ...choice, hours: 8 }), false);
  localStorage.setItem(SHORTLIST_KEY, JSON.stringify({ ...state, planA: { ...choice, date: '2026-02-31' } }));
  assert.equal(readShortlist(state).planA, null);
});
test('validation requires 2–5 locations and a complete date range in each local time zone', () => {
  assert.equal(shortlistValidation(state), null);
  assert.match(shortlistValidation({ ...state, objectives: [rainier] }), /2–5/);
  assert.match(shortlistValidation({ ...state, durationDays: 8 }), /2–7/);
  assert.match(shortlistValidation({ ...state, startDate: '2026-02-31' }), /valid/);
  assert.match(shortlistValidation({ ...state, startDate: '2000-01-01' }), /next 7 days/);
  assert.match(shortlistValidation({ ...state, hours: 0 }), /1–24/);
});
test('hazard rank precedes score and comfort; partial and missing data never win', () => {
  const day = { score: 80, decisionLevel: 'GO', partialData: false, travelTotalHours: 8 };
  const ranked = rankShortlist([{ objectiveId: rainier.id, days: [day, { ...day, score: 100, decisionLevel: 'NO-GO', pleasantness: 100 },
    { ...day, score: 100, partialData: true }, { ...day, score: null }, { ...day, score: 100, travelTotalHours: 0 }] }]);
  assert.deepEqual(ranked.map(r => r.day.score), [80, 100]);
  assert.deepEqual(rankShortlist([{ objectiveId: rainier.id, days: [day] }], 12), [], 'an incomplete hourly window cannot win');
});
test('comparison is explicit, sequential, and preserves local time, hours and quota callbacks', async t => {
  const h = await harness(t);
  assert.equal(h.requests.length, 0);
  let pending;
  await act(async () => { pending = h.current.run(); });
  assert.equal(h.requests.length, 1);
  const body = JSON.parse(h.requests[0].init.body);
  assert.equal(body.startTime, '07:00'); assert.equal(body.travelWindowHours, 8); assert.equal(body.durationDays, 2);
  assert.ok(h.requests[0].init.headers['Idempotency-Key']);
  await respond(h.requests[0], { days: [report()] });
  assert.equal(h.requests.length, 2);
  await respond(h.requests[1], { days: [report(hood)] });
  await pending;
  assert.equal(h.current.results.length, 2); assert.equal(h.current.loading, false);
  assert.equal(h.current.results[0].days[0].date, date);
});
test('missing dates stay missing and wrong location/duration responses are rejected', async t => {
  const h = await harness(t);
  let pending; await act(async () => { pending = h.current.run(); });
  const next = new Date(`${date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  const nextDate = next.toISOString().slice(0, 10);
  const wrongDuration = report(); wrongDuration.rainfall.expected.travelWindowHours = 12;
  await respond(h.requests[0], { days: [report(rainier, nextDate), report(hood), wrongDuration, { weather: {} }] });
  await respond(h.requests[1], { days: [] }); await pending;
  assert.deepEqual(h.current.results[0].days.map(d => d.date), [nextDate]);
  assert.equal(h.current.results[1].days.length, 0);
  assert.match(h.current.results[1].error, /No matching/);
});
test('changing the plan immediately hides results and late responses cannot overwrite a new run', async t => {
  const h = await harness(t);
  let old; await act(async () => { old = h.current.run(); });
  const first = h.requests[0];
  await h.render({ ...state, hours: 6 });
  assert.equal(first.init.signal.aborted, true);
  assert.deepEqual(h.current.results, []);
  let newer; await act(async () => { newer = h.current.run(); });
  await respond(first, { days: [report()] }); await old;
  assert.equal(h.current.loading, true); assert.deepEqual(h.current.results, []);
  const sixHours = report(); sixHours.rainfall.expected.travelWindowHours = 6;
  const sixHoursHood = report(hood); sixHoursHood.rainfall.expected.travelWindowHours = 6;
  await respond(h.requests[1], { days: [sixHours] });
  await respond(h.requests[2], { days: [sixHoursHood] }); await newer;
  assert.equal(h.current.results.length, 2);
});
test('stop and unmount abort pending requests and do not request another objective', async t => {
  const h = await harness(t);
  let pending; await act(async () => { pending = h.current.run(); });
  await act(async () => h.current.cancel());
  assert.equal(h.current.loading, false); assert.equal(h.requests[0].init.signal.aborted, true);
  await respond(h.requests[0], { days: [report()] }); await pending;
  assert.equal(h.requests.length, 1); assert.deepEqual(h.current.results, []);
});
test('Plan A and Plan B save distinct choices and hand the exact saved plan to the planner', async t => {
  const h = await harness(t, state, true);
  await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  await respond(h.requests[0], { days: [report()] });
  await respond(h.requests[1], { days: [report(hood)] });
  await click(document.querySelector('.shortlist-cell').getAttribute('aria-label'));
  await click('Save as Plan A');
  await click('Save as Plan B');
  let stored = JSON.parse(localStorage.getItem(SHORTLIST_KEY));
  assert.equal(stored.planA, null); assert.equal(stored.planB.objectiveId, rainier.id);
  await click([...document.querySelectorAll('.shortlist-cell')][1].getAttribute('aria-label'));
  await click('Save as Plan A');
  stored = JSON.parse(localStorage.getItem(SHORTLIST_KEY));
  assert.equal(stored.planA.objectiveId, hood.id);
  await click('Open in planner');
  assert.equal(h.opened[0].objectiveName, 'Hood');
  assert.equal(h.opened[0].forecastDate, date); assert.equal(h.opened[0].alpineStartTime, '07:00'); assert.equal(h.opened[0].travelWindowHours, 8);
  assert.equal(h.opened[0].targetElevationInput, '');
});

test('exhausted usage updates the account and stops requesting further objectives', async t => {
  const h = await harness(t);
  const usage = { tierKey: 'guest', unlimited: false, usedRuns: 1, exhausted: true, limitRuns: 1, remainingRuns: 0, percentUsed: 100, periodStart: null, periodEnd: null, resetAt: null };
  let pending; await act(async () => { pending = h.current.run(); });
  for (let attempt = 0; attempt < 3; attempt++) {
    await respond(h.requests[attempt], { error: 'Comparison allowance reached', multiDayUsage: usage }, 429);
    if (attempt < 2) await act(async () => { await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000 + 20)); });
  }
  await pending;
  assert.equal(h.requests.length, 3, 'only the first objective and its idempotent retries');
  assert.equal(h.usage.length, 1); assert.equal(h.limits.length, 1);
  assert.equal(h.current.results[1].days.length, 0);
  assert.match(h.current.results[1].error, /allowance/);
  assert.equal(h.current.loading, false);
});

test('unmount aborts pending comparison work', async t => {
  const h = await harness(t);
  let pending; await act(async () => { pending = h.current.run(); });
  await act(async () => h.root.render(null));
  assert.equal(h.requests[0].init.signal.aborted, true);
  await respond(h.requests[0], { days: [report()] }); await pending;
  assert.equal(h.requests.length, 1);
});

test('production forecast-period timestamps are accepted for a non-hour departure', async t => {
  const h = await harness(t, { ...state, startTime: '07:30' });
  let pending; await act(async () => { pending = h.current.run(); });
  const data = report();
  assert.match(data.forecast.selectedStartTime, /T07:00:00-07:00$/);
  await respond(h.requests[0], { days: [data] });
  await respond(h.requests[1], { days: [report(hood)] }); await pending;
  assert.equal(h.current.results[0].days.length, 1);
  assert.equal(h.current.results[1].days.length, 1);
  assert.equal(JSON.parse(h.requests[0].init.body).startTime, '07:30');
});
test('unavailable precipitation metadata does not discard the weather forecast', async t => {
  const h = await harness(t);
  let pending; await act(async () => { pending = h.current.run(); });
  const data = report();
  data.partialData = true;
  data.rainfall = { status: 'unavailable', expected: { status: 'unavailable', travelWindowHours: null } };
  await respond(h.requests[0], { days: [data] });
  const missing = report(hood); delete missing.rainfall;
  await respond(h.requests[1], { days: [missing] }); await pending;
  assert.equal(h.current.results[0].days.length, 1);
  assert.equal(h.current.results[0].days[0].partialData, true);
  assert.equal(h.current.results[1].days.length, 1);
});
