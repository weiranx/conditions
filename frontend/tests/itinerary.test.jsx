import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeReport } from '../dev/mock-data.mjs';
import { getDefaultUserPreferences } from '../src/app/preferences';
import itineraryAssessment from '../../backend/src/utils/itinerary-assessment.js';
import {
  buildItineraryRequest,
  buildItineraryStages,
  campPoint,
  createItineraryDraft,
  itineraryGaps,
  maxNightsWithinForecast,
  parseItineraryDraft,
  parseItineraryResults,
  parseSavedTrip,
  buildSavedTrip,
  setItineraryNights,
  splitGpxIntoDays,
  stagePlan,
  stageStartElevationFt,
} from '../src/app/itinerary';
import { planSettingsParams } from '../src/app/plan-evaluation';
import { buildTripOverlay } from '../src/field/itinerary-overlay';
import { Itinerary } from '../src/field/Itinerary';
import { AiAccessContext } from '../src/contexts/ai-access';

const preferences = getDefaultUserPreferences();
// Future dates keep the mock forecast fresh for the decision's freshness check.
const date = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const today = date(0);
const TRAILHEAD = { name: 'Snow Lakes TH', lat: 47.53, lon: -120.71, elevationFt: 1350 };
const CAMP_1 = { name: 'Nada Lake', lat: 47.49, lon: -120.76, elevationFt: 4950 };
const CAMP_2 = { name: 'Upper Enchantments', lat: 47.48, lon: -120.82, elevationFt: 7600 };

const draftFor = (edit = (draft) => draft) => edit({
  ...createItineraryDraft({ startDate: date(1), start: '07:00', travelHours: 7, nights: 2, trailhead: TRAILHEAD }),
  camps: [{ point: CAMP_1, layover: false }, { point: CAMP_2, layover: false }],
});

/** A checked trip from mock reports; `scenarios[i]` sets day i's weather, null fails that day. */
function checked(scenarios, { draft = draftFor(), edit = () => {} } = {}) {
  const stages = buildItineraryStages(draft);
  const results = stages.map((stage, index) => {
    const scenario = scenarios[index];
    const report = scenario === null ? null : makeReport({
      lat: stage.to.lat,
      lon: stage.to.lon,
      date: stage.date,
      start: stage.start,
      travel_window_hours: stage.travelHours,
      ...(index < stages.length - 1 ? { camp_night: '1' } : {}),
    }, scenario);
    if (report) edit(report, index);
    return { index, date: stage.date, fromElevationFt: stage.from.elevationFt, report, checkpoints: [] };
  });
  const assessment = itineraryAssessment.assessItinerary({
    stages,
    results,
    planSettings: planSettingsParams(preferences),
    activity: 'backpacking',
    todayDate: today,
    bailPoints: draft.bailPoints,
  });
  return { checkedAt: new Date().toISOString(), startDate: draft.startDate, stages, results, assessment, chatContext: { contextType: 'multi-day-itinerary' } };
}

test('a trip is a trailhead, a camp for each night, and an exit that defaults to the trailhead', () => {
  const stages = buildItineraryStages(draftFor());
  assert.deepEqual(stages.map((stage) => [stage.from.name, stage.to.name]), [
    ['Snow Lakes TH', 'Nada Lake'],
    ['Nada Lake', 'Upper Enchantments'],
    ['Upper Enchantments', 'Snow Lakes TH'],
  ]);
  assert.deepEqual(stages.map((stage) => stage.date), [date(1), date(2), date(3)]);
  const oneWay = buildItineraryStages(draftFor((draft) => ({ ...draft, exit: { name: 'Stuart Lake TH', lat: 47.52, lon: -120.83, elevationFt: 3400 } })));
  assert.equal(oneWay[2].to.name, 'Stuart Lake TH');
});

test('missing camps block the check and name what to add', () => {
  const draft = createItineraryDraft({ startDate: date(1), start: '07:00', travelHours: 7, nights: 2 });
  assert.deepEqual(itineraryGaps(draft), ['Choose a trailhead', 'Add a camp for night 1', 'Add a camp for night 2']);
  assert.equal(buildItineraryStages(draft), null);
});

test('a layover stays at the previous camp and marks the day spent there', () => {
  const draft = draftFor((current) => ({ ...current, camps: [{ point: CAMP_1, layover: false }, { point: null, layover: true }] }));
  assert.deepEqual(itineraryGaps(draft), []);
  assert.equal(campPoint(draft, 1).name, 'Nada Lake');
  const stages = buildItineraryStages(draft);
  assert.equal(stages[1].layover, true);
  assert.equal(stages[1].from.name, 'Nada Lake');
  assert.equal(stages[1].to.name, 'Nada Lake');
});

test('changing the number of nights keeps the camps and days already set', () => {
  const draft = draftFor((current) => ({ ...current, days: current.days.map((day, index) => ({ ...day, start: index === 1 ? '05:00' : day.start })) }));
  const longer = setItineraryNights(draft, 4);
  assert.equal(longer.camps.length, 4);
  assert.equal(longer.days.length, 5);
  assert.equal(longer.camps[1].point.name, 'Upper Enchantments');
  assert.equal(longer.days[1].start, '05:00');
  assert.equal(longer.camps[3].point, null);
  assert.equal(setItineraryNights(draft, 99).camps.length, 6);
  assert.equal(setItineraryNights(draft, 0).camps.length, 1);
  assert.equal(maxNightsWithinForecast(date(0), date(7)), 6);
  assert.equal(maxNightsWithinForecast(date(5), date(7)), 2);
});

test('the request carries each day with its points and high points', () => {
  const draft = draftFor((current) => ({
    ...current,
    days: current.days.map((day, index) => (index === 1 ? { ...day, checkpoints: [{ name: 'Aasgard Pass', lat: 47.48, lon: -120.84, elevationFt: null }] } : day)),
  }));
  const body = buildItineraryRequest(draft, buildItineraryStages(draft), { ...preferences, defaultActivity: 'backpacking' });
  assert.equal(body.activity, 'backpacking');
  assert.equal(body.plan.max_gust_mph, String(preferences.maxWindGustMph));
  assert.deepEqual(body.bailPoints, []);
  assert.equal(body.startDate, date(1));
  assert.equal(body.stages.length, 3);
  assert.deepEqual(body.stages[1].checkpoints, [{ name: 'Aasgard Pass', lat: 47.48, lon: -120.84, elevationFt: null }]);
  assert.deepEqual(Object.keys(body.stages[0]).sort(), ['checkpoints', 'from', 'start', 'to', 'travelHours']);
  assert.deepEqual(Object.keys(body).sort(), ['activity', 'bailPoints', 'name', 'plan', 'stages', 'startDate']);
});

test('a day the server did not return is kept as a failed one', () => {
  const stages = buildItineraryStages(draftFor());
  const report = makeReport({ date: stages[0].date }, 'clear');
  const results = parseItineraryResults({ stages: [{ index: 0, report, checkpoints: [] }, { index: 2, report: { not: 'a report' } }] }, stages);
  assert.equal(results.length, 3);
  assert.equal(results[0].report, report);
  assert.equal(results[1].report, null);
  assert.equal(results[2].report, null);
});

test('a trip day opens from last night’s camp, or from its own camp on a layover', () => {
  const draft = draftFor((current) => ({ ...current, camps: [{ point: CAMP_1, layover: false }, { point: null, layover: true }] }));
  const check = checked(['clear', 'clear', 'clear'], { draft });
  assert.equal(stageStartElevationFt(check.stages[0], check.results[0]), 1350);
  assert.equal(stageStartElevationFt(check.stages[1], check.results[1]), Number(check.results[1].report.weather.elevation));
  assert.equal(stageStartElevationFt(check.stages[2], { ...check.results[2], fromElevationFt: 5000 }), 5000);
  const plan = stagePlan(check.stages[0], '1350');
  assert.deepEqual([plan.objectiveName, plan.forecastDate, plan.travelWindowHours, plan.trailheadElevationInput], ['Nada Lake', date(1), 7, '1350']);
});

test('a GPX track splits into days of equal effort with high points to check', () => {
  // Flat for 10 mi, then a 3,000 ft climb and back down over 10 mi.
  const track = Array.from({ length: 21 }, (_, i) => ({
    lat: 47 + i * 0.01,
    lon: -120,
    elev_ft: i <= 10 ? 4000 : i <= 15 ? 4000 + (i - 10) * 600 : 7000 - (i - 15) * 600,
    progress_percent: i * 5,
  }));
  const route = { name: 'Loop', fileName: 'loop.gpx', pointCount: 21, distanceMiles: 20, elevationGainFt: 3000, minElevationFt: 4000, maxElevationFt: 7000, checkpoints: [], displayTrack: track, routeShape: 'point-to-point' };
  const split = splitGpxIntoDays(route, 1, { paceMinutesPerMile: 30, ascentMinutesPer1000Ft: 45, stopBufferMinutes: 30 });
  assert.equal(split.camps.length, 1);
  // Half the effort (10 mi + 3 mi of climbing) is reached before the midpoint of the distance.
  assert.ok(split.camps[0].lat < 47.14 && split.camps[0].lat > 47.1, `camp at ${split.camps[0].lat}`);
  assert.equal(split.days.length, 2);
  assert.equal(split.days[0].checkpoints.length, 0);
  assert.equal(split.days[1].checkpoints[0].elevationFt, 7000);
  assert.equal(split.exit.name, 'Loop end');
  const named = splitGpxIntoDays({ ...route, checkpoints: [{ name: 'Camp at the lake', lat: 47.05, lon: -120, distance_miles: 5, progress_percent: 25 }] }, 1, { paceMinutesPerMile: 30, ascentMinutesPer1000Ft: 45, stopBufferMinutes: 30 });
  assert.equal(named.camps[0].name, 'Camp at the lake');
  assert.equal(named.camps[0].lat, 47.05);
});

test('a stored draft is read back, and anything else is refused', () => {
  const draft = draftFor();
  assert.deepEqual(parseItineraryDraft(JSON.parse(JSON.stringify(draft))), draft);
  assert.equal(parseItineraryDraft({ camps: [], days: [] }), null);
  assert.equal(parseItineraryDraft('nope'), null);
  const cleaned = parseItineraryDraft({ ...draft, camps: [{ point: { lat: 'x' } }], days: [{ start: '7am', travelHours: 99 }] });
  assert.equal(cleaned.camps[0].point, null);
  assert.deepEqual([cleaned.days[0].start, cleaned.days[0].travelHours], ['07:00', 24]);
});

test('the map shows camps colored by their nights once the trip is checked', () => {
  const draft = draftFor();
  const planning = buildTripOverlay(draft, null);
  assert.deepEqual(planning.points.map((point) => [point.kind, point.label, point.tone]), [['camp', '1', 'plan'], ['camp', '2', 'plan']]);
  assert.equal(planning.path.length, 4);
  const { assessment } = checked(['clear', 'clear', 'clear'], {
    edit: (report, index) => { if (index === 1) Object.assign(report.campNight, { severity: 'high' }); },
  });
  assert.deepEqual(buildTripOverlay(draft, assessment).points.map((point) => point.tone), ['go', 'nogo']);
});

function workspaceFor(check) {
  const { assessment } = check;
  const draft = draftFor();
  return {
    preferences,
    itinerary: { result: check, assessment, draft, loading: false, fromSaved: false, alternatives: [], runCheck: async () => true, compareStartDates: async () => {} },
    todayDate: today,
    maxForecastDate: date(7),
    formatTempDisplay: (v) => (v === null || v === undefined ? '—' : `${Math.round(v)}°F`),
    formatWindDisplay: (v) => (v === null || v === undefined ? '—' : `${Math.round(v)} mph`),
    formatElevationDisplay: (v) => `${Math.round(v)} ft`,
    formatDistanceDisplay: (v) => `${v.toFixed(1)} mi`,
    localizeUnitText: (text) => text,
    openItineraryDay: () => {},
  };
}

test('the trip brief shows every day and night, and says when a day could not be checked', () => {
  const html = renderToStaticMarkup(
    <AiAccessContext.Provider value={{ requestAiAccess: () => true }}>
      <Itinerary workspace={workspaceFor(checked(['clear', null, 'clear']))} onEdit={() => {}} />
    </AiAccessContext.Provider>,
  );
  assert.match(html, /Not cleared yet/);
  assert.match(html, /Day 2 can(’|'|&#x27;)t be cleared yet/);
  for (const label of ['Day 1', 'Night 1', 'Day 2', 'Night 2', 'Day 3']) assert.ok(html.includes(label), label);
  assert.match(html, /This day could not be checked at camp/);
  assert.match(html, /This night could not be checked because its day failed/);
  assert.equal((html.match(/Open day \d report/g) || []).length, 2, 'only checked days open');
  assert.match(html, /Check starting 1–3 days later/);
});


test('a saved trip keeps the backend’s assessment and reads back whole', () => {
  const draft = draftFor();
  const check = checked(['clear', 'storm', 'clear'], { draft });
  const saved = JSON.parse(JSON.stringify(buildSavedTrip(draft, { ...check, preferences })));
  assert.equal(saved.verdictLevel, 'NO-GO');
  const restored = parseSavedTrip(saved);
  assert.equal(restored.result.assessment.level, 'NO-GO');
  assert.equal(restored.result.assessment.headline.title, 'Day 2 limits the trip');
  assert.equal(restored.result.results[1].report.forecast.selectedDate, check.results[1].report.forecast.selectedDate);
  assert.equal(parseSavedTrip({ draft, result: { stages: [], results: [1] } }), null);
});
