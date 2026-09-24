import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getDefaultUserPreferences, normalizeUserPreferences } from '../src/app/preferences';
import { buildShareQuery } from '../src/app/url-state';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildSkyHours } from '../src/field/sky/sky-model';
import { ApproachNote } from '../src/field/sky/ApproachNote';
import { DayStrip } from '../src/field/sky/DayStrip';
import { Forecast } from '../src/field/Forecast';
import { buildPersistedReport, parsePersistedReport } from '../src/app/report-storage';
import { buildApproachRequestParams } from '../src/app/approach-elevation';
import { ComfortScore } from '../src/field/ComfortScore';
import { evaluate } from './evaluation-fixtures';

// Where the party is at each hour, and what that changes, is computed by the
// backend (backend/test/unit.approach-elevation.test.js and
// unit.plan-evaluation.test.js). These tests cover how it is presented.
const timing = { paceMinutesPerMile: 30, ascentMinutesPer1000Ft: 45, stopBufferMinutes: 0 };
const preferences = { ...getDefaultUserPreferences(), maxWindGustMph: 25, minFeelsLikeF: 5, travelWindowHours: 4 };
const bands = [
  { label: 'Approach Terrain', elevationFt: 8200, deltaFromObjectiveFt: -2800, temp: 0, feelsLike: 0, windSpeed: 0, windGust: 0 },
  { label: 'Objective Elevation', elevationFt: 11000, deltaFromObjectiveFt: 0, temp: 0, feelsLike: 0, windSpeed: 0, windGust: 0 },
];
// Overcast so the inversion heuristic stays out of the way unless a test opts in.
const hour = { temp: 20, wind: 12, gust: 28, precipChance: 10, cloudCover: 90, condition: 'Mostly Cloudy' };
const solar = { sunrise: '6:30 AM', sunset: '7:30 PM', dayLength: '13h 00m' };

function safetyData(trend, overrides = {}) {
  return {
    weather: {
      elevation: 11000, elevationForecast: bands, temp: trend[0].temp, windSpeed: trend[0].wind,
      windGust: trend[0].gust, precipChance: trend[0].precipChance, cloudCover: trend[0].cloudCover,
      description: trend[0].condition, humidity: 40, trend, ...overrides,
    },
    solar,
    safety: { score: 80, factors: [] },
  };
}

test('the approach preference defaults on and survives normalization', () => {
  assert.equal(getDefaultUserPreferences().approachElevationAdjustment, true);
  assert.equal(normalizeUserPreferences({}).approachElevationAdjustment, true);
  assert.equal(normalizeUserPreferences({ approachElevationAdjustment: false }).approachElevationAdjustment, false);
  assert.equal(normalizeUserPreferences({ approachElevationAdjustment: 'no' }).approachElevationAdjustment, true);
});

test('a typed trailhead travels with share links and saved plans, and is omitted when estimated', () => {
  const state = {
    view: 'planner', hasObjective: true, position: { lat: 40, lng: -105 }, objectiveName: 'Peak', searchQuery: '',
    forecastDate: '2026-09-23', alpineStartTime: '05:00', targetElevationInput: '',
  };
  assert.match(buildShareQuery({ ...state, trailheadElevationInput: '7200' }), /(?:^|&)th=7200(?:&|$)/);
  assert.doesNotMatch(buildShareQuery(state), /th=/);

  const saved = (plan) => parsePersistedReport({
    version: 3, savedAt: '', safetyData: { ...safetyData([{ ...hour, time: '05:00' }]), location: { lat: 40, lon: -105 } },
    plan: { lat: 40, lon: -105, forecastDate: '2026-09-23', alpineStartTime: '05:00', travelWindowHours: 4, targetElevationInput: '', ...plan },
  });
  assert.equal(saved({ trailheadElevationInput: '7200' })?.plan.trailheadElevationInput, '7200');
  assert.equal(saved({})?.plan.trailheadElevationInput, undefined);
});

const clock = (minute) => {
  const h = Math.floor((((minute % 1440) + 1440) % 1440) / 60);
  return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
};
const elevation = (ft) => `${ft.toLocaleString('en-US')} ft`;

// The params the planner sends: the default limits, and an estimated trailhead.
const planFor = (params = {}) => ({
  date: '2026-09-23', start: '05:00', travel_window_hours: '4', max_gust_mph: '25', min_feels_like_f: '5', ascent_min_per_kft: '45',
  approach: 'on', ...params,
});

function approachScenario(params = {}) {
  // Clear and calm before dawn (inversion), then a gusty overcast summit.
  const trend = [
    { time: '05:00', temp: 20, wind: 4, gust: 8, precipChance: 0, cloudCover: 5, condition: 'Clear' },
    { ...hour, time: '06:00' },
    { ...hour, time: '07:00' },
    { ...hour, time: '08:00' },
  ];
  const data = safetyData(trend);
  const evaluation = evaluate(data, planFor(params));
  const hours = buildSkyHours(evaluation.travelWindow.planned.rows, { start: '05:00', sunriseMinutes: 390, sunsetMinutes: 1170 });
  return { data, evaluation, summary: evaluation.travelWindow.planned.approachSummary, hours };
}

test('the brief note says which hours were checked below the summit and how to change it', () => {
  const { hours, summary } = approachScenario();
  const html = renderToStaticMarkup(
    <ApproachNote hours={hours} summary={summary} source="estimated" clock={clock} elevation={elevation} onEdit={() => {}} />,
  );
  assert.match(html, /5 AM–7 AM checked at your estimated elevation/);
  assert.match(html, /~9,500 ft–10,900 ft/);
  assert.match(html, /trailhead estimated/);
  assert.match(html, /Set trailhead/);
  assert.match(html, /Clear, calm conditions: 5 AM–6 AM may be colder at the trailhead than at the summit/);

  const manual = renderToStaticMarkup(<ApproachNote hours={hours} summary={summary} source="manual" clock={clock} elevation={elevation} onEdit={() => {}} />);
  assert.match(manual, /Edit approach/);
  assert.doesNotMatch(renderToStaticMarkup(<ApproachNote hours={hours} summary={summary} source="gpx" clock={clock} elevation={elevation} />), /<button/);
  const summit = approachScenario({ approach: 'off' });
  assert.equal(summit.summary, null);
  assert.equal(renderToStaticMarkup(<ApproachNote hours={summit.hours} summary={summit.summary} source="estimated" clock={clock} elevation={elevation} />), '');
});

test('the day strip marks approach hours visually and for screen readers', () => {
  const { hours, summary } = approachScenario();
  const html = renderToStaticMarkup(<DayStrip hours={hours} approach={summary} clock={clock} elevation={elevation} />);
  assert.equal((html.match(/is-approach/g) || []).length, 2);
  assert.match(html, /5 AM–7 AM checked at your estimated elevation, not the summit/);
  assert.match(html, /title="5 AM · checked near 9,500 ft"/);
});

test('the Forecast chapter shows the same checked hours as the brief and tags them', () => {
  const { data, evaluation } = approachScenario();
  const report = buildPersistedReport(
    { lat: 40, lon: -105, objectiveName: 'Peak', searchQuery: '', forecastDate: '2026-09-23', alpineStartTime: '05:00', travelWindowHours: 4, targetElevationInput: '' },
    { ...data, location: { lat: 40, lon: -105 }, capabilities: { ai: false } },
    { aiBriefNarrative: null, snowVisionAnalysis: null, snowVisionImage: null },
    { preferences },
  );
  assert.deepEqual(evaluation.travelWindow.readings.rows.map((row) => row.pass), evaluation.travelWindow.planned.rows.map((row) => row.pass));
  const adjusted = renderToStaticMarkup(<Forecast report={report} evaluation={evaluation} elevation={elevation} />);
  assert.match(adjusted, /3 of 4 hours<\/strong> cross your limits, starting 6:00 AM/);
  assert.match(adjusted, /2 h are checked at your[\s\S]*not the summit; the chart shows the summit forecast/);
  assert.match(adjusted, /sky-approach-tag[^>]*>~9,500 ft · inversion/);
  assert.match(adjusted, /Checked near 9,500 ft on the approach/);

  const summitEvaluation = approachScenario({ approach: 'off' }).evaluation;
  const summit = renderToStaticMarkup(<Forecast report={report} evaluation={summitEvaluation} elevation={elevation} />);
  assert.match(summit, /3 of 4 hours<\/strong> cross your limits/);
  assert.doesNotMatch(summit, /checked at your/);
  assert.doesNotMatch(summit, /sky-approach-tag/);
});

test('comfort says which approach hours it scored at the party elevation', () => {
  const comfort = { score: 80, label: 'Pleasant', summary: '', scoreVersion: '1.5.0',
    approach: { source: 'manual', trailheadElevationFt: 7000, adjustedHours: 2, inversionHours: 1 } };
  const html = renderToStaticMarkup(<ComfortScore comfort={comfort} elevation={elevation} />);
  assert.match(html, /2 h scored at your estimated elevation on the approach, from[\s\S]*7,000 ft \(from your trailhead\); 1 h scored colder for a likely valley inversion/);
  assert.doesNotMatch(html, /different approach/);
});

test('approach inputs are sent with the plan', () => {
  assert.deepEqual(buildApproachRequestParams({ enabled: false, trailheadElevationFt: 7000, timing }), { approach: 'off' });
  assert.deepEqual(buildApproachRequestParams({ enabled: true, timing }), { ascent_min_per_kft: '45' });
  assert.deepEqual(buildApproachRequestParams({ enabled: true, trailheadElevationFt: 7210.4, timing }), { trailhead_ft: '7210', ascent_min_per_kft: '45' });

  // A long GPX track is thinned to the backend limit but keeps both ends and the summit.
  const displayTrack = Array.from({ length: 201 }, (_, i) => ({
    lat: 0, lon: 0, progress_percent: i / 2, elev_ft: i === 137 ? 11500 : 7000 + Math.min(i, 200 - i) * 30,
  }));
  const params = buildApproachRequestParams({ enabled: true, trailheadElevationFt: 6000, gpxRoute: { distanceMiles: 10, displayTrack }, timing });
  assert.equal(params.trailhead_ft, undefined, 'the route wins over a typed trailhead');
  const pairs = params.approach_route.split(',').map((pair) => pair.split(':').map(Number));
  assert.ok(pairs.length <= 64);
  assert.deepEqual(pairs[0], [0, 7000]);
  assert.ok(pairs.some(([, ft]) => ft === 11500));
  assert.equal(pairs[pairs.length - 1][1], 7000);
  assert.ok(pairs.every(([minute], i) => i === 0 || minute >= pairs[i - 1][0]));
});

