import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adjustPointToElevation,
  buildApproachProfile,
  elevationAtMinute,
  highestElevationBetween,
  isInversionLikely,
} from '../src/app/approach-elevation';
import { buildPlannedReportWeatherRows } from '../src/field/report-weather';
import { evaluateBackcountryDecision } from '../src/app/decision';
import { getDefaultUserPreferences, normalizeUserPreferences } from '../src/app/preferences';
import { buildShareQuery } from '../src/app/url-state';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildReportWeatherRows } from '../src/field/report-weather';
import { buildSkyHours } from '../src/field/sky/sky-model';
import { ApproachNote } from '../src/field/sky/ApproachNote';
import { DayStrip } from '../src/field/sky/DayStrip';
import { Forecast } from '../src/field/Forecast';
import { buildPersistedReport } from '../src/app/report-storage';
import { buildApproachRequestParams, comfortApproachIsStale, summarizeApproachHours } from '../src/app/approach-elevation';
import { ComfortScore } from '../src/field/ComfortScore';
import { parsePersistedReport } from '../src/app/report-storage';

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

test('approach profile prefers the GPX track, then a typed trailhead, then the lowest forecast band', () => {
  const estimated = buildApproachProfile({ objectiveElevationFt: 11000, elevationBands: bands, timing });
  assert.equal(estimated.source, 'estimated');
  assert.equal(estimated.trailheadElevationFt, 8200);
  // 2,800 ft at 45 min per 1,000 ft.
  assert.equal(Math.round(estimated.timeline[1].minute), 126);

  const manual = buildApproachProfile({ objectiveElevationFt: 11000, trailheadElevationFt: 7000, elevationBands: bands, timing });
  assert.equal(manual.source, 'manual');
  assert.equal(manual.trailheadElevationFt, 7000);

  const gpxRoute = {
    distanceMiles: 8,
    displayTrack: [
      { lat: 0, lon: 0, elev_ft: 7500, progress_percent: 0 },
      { lat: 0, lon: 0, elev_ft: 11000, progress_percent: 50 },
      { lat: 0, lon: 0, elev_ft: 7500, progress_percent: 100 },
    ],
  };
  const gpx = buildApproachProfile({ objectiveElevationFt: 11000, trailheadElevationFt: 7000, gpxRoute, elevationBands: bands, timing });
  assert.equal(gpx.source, 'gpx');
  assert.equal(gpx.trailheadElevationFt, 7500);
  // 4 mi at 30 min/mi plus 3,500 ft at 45 min per 1,000 ft up; the descent has no climb.
  assert.deepEqual(gpx.timeline.map((entry) => Math.round(entry.minute)), [0, 278, 398]);
  assert.equal(elevationAtMinute(gpx, 398), 7500);
});

test('no approach is modeled without a meaningful drop below the objective', () => {
  assert.equal(buildApproachProfile({ objectiveElevationFt: 11000, trailheadElevationFt: 10900, timing }), null);
  assert.equal(buildApproachProfile({ objectiveElevationFt: null, trailheadElevationFt: 7000, timing }), null);
  assert.equal(buildApproachProfile({ objectiveElevationFt: 11000, timing }), null);
});

test('each hour is scored at its highest point and never above the objective', () => {
  const profile = buildApproachProfile({ objectiveElevationFt: 11000, trailheadElevationFt: 8000, timing });
  assert.equal(highestElevationBetween(profile, 0, 60), 8000 + 3000 * (60 / 135));
  assert.equal(highestElevationBetween(profile, 120, 180), 11000);
  assert.equal(highestElevationBetween({ ...profile, timeline: [{ minute: 0, elevationFt: 12000 }] }, 0, 60), 11000);
});

test('lapse-rate adjustment warms and calms the approach, with warming capped', () => {
  const adjusted = adjustPointToElevation(hour, 11000, 8000, { minuteOfDay: 12 * 60 });
  assert.equal(adjusted.temp, 20 + 10); // 3 kft × 3.3°F = 9.9°F, rounded
  assert.equal(adjusted.wind, 6);
  assert.equal(adjusted.gust, 21);
  assert.equal(adjusted.precipChance, 10);
  assert.equal(adjusted.inversionRisk, false);

  const capped = adjustPointToElevation(hour, 11000, 5000, { minuteOfDay: 12 * 60 });
  assert.equal(capped.temp, 30);

  const missing = adjustPointToElevation({ ...hour, temp: NaN, gust: null }, 11000, 8000, { minuteOfDay: 720 });
  assert.ok(Number.isNaN(missing.temp));
  assert.equal(missing.gust, null);
});

test('inversions are expected on clear, calm nights and mornings only', () => {
  const clearCalm = { ...hour, wind: 4, gust: 8, cloudCover: 10, condition: 'Clear' };
  const context = (minuteOfDay) => ({ minuteOfDay, sunriseMinutes: 390, sunsetMinutes: 1170 });
  assert.equal(isInversionLikely(clearCalm, context(5 * 60)), true);
  assert.equal(isInversionLikely(clearCalm, context(7 * 60 + 30)), true, 'persists after sunrise');
  assert.equal(isInversionLikely(clearCalm, context(13 * 60)), false, 'mixed out by afternoon');
  assert.equal(isInversionLikely(clearCalm, context(21 * 60)), true, 'forms after sunset');
  assert.equal(isInversionLikely({ ...clearCalm, wind: 20 }, context(5 * 60)), false, 'wind mixes the valley');
  assert.equal(isInversionLikely({ ...clearCalm, cloudCover: 90 }, context(5 * 60)), false, 'clouds trap heat');
  assert.equal(isInversionLikely({ ...clearCalm, cloudCover: null, condition: 'Overcast' }, context(5 * 60)), false);
  assert.equal(isInversionLikely({ ...clearCalm, cloudCover: 100, condition: 'Patchy Fog' }, context(5 * 60)), true, 'valley fog marks a cold pool');
  assert.equal(isInversionLikely({ ...clearCalm, precipChance: 70 }, context(5 * 60)), false);
  // Without solar times, fall back to the forecast's day/night flag and the clock.
  assert.equal(isInversionLikely({ ...clearCalm, isDaytime: false }, { minuteOfDay: 12 * 60 }), true);
  assert.equal(isInversionLikely(clearCalm, { minuteOfDay: 8 * 60 }), true);
});

test('a likely inversion cools the approach instead of warming it, within a cap', () => {
  const clearCalm = { ...hour, temp: 20, wind: 4, gust: 8, cloudCover: 10, condition: 'Clear' };
  const context = { minuteOfDay: 5 * 60, sunriseMinutes: 390, sunsetMinutes: 1170 };
  const adjusted = adjustPointToElevation(clearCalm, 11000, 8000, context);
  assert.equal(adjusted.inversionRisk, true);
  assert.equal(adjusted.temp, 14); // 3 kft × 2°F colder
  assert.equal(adjustPointToElevation(clearCalm, 11000, 4000, context).temp, 12); // capped at 8°F
});

test('early hours at the trailhead no longer fail on summit gusts, later hours still do', () => {
  const trend = ['05:00', '06:00', '07:00', '08:00'].map((time) => ({ ...hour, time }));
  const data = safetyData(trend);
  const plan = { start: '05:00', date: '2026-09-23' };

  const summitOnly = buildPlannedReportWeatherRows(data, preferences, 4, plan);
  assert.deepEqual(summitOnly.map((row) => row.pass), [false, false, false, false]);
  assert.equal(summitOnly[0].elevationFt, undefined);

  const approach = buildApproachProfile({ objectiveElevationFt: 11000, trailheadElevationFt: 7000, timing });
  const rows = buildPlannedReportWeatherRows(data, preferences, 4, { ...plan, approach });
  // Climb 4,000 ft over 3 h: tops of hour 1 and 2 are ~8,300 and ~9,700 ft.
  assert.deepEqual(rows.map((row) => row.elevationFt), [8333, 9667, 11000, 11000]);
  assert.deepEqual(rows.map((row) => row.approachAdjusted), [true, true, false, false]);
  assert.deepEqual(rows.map((row) => row.pass), [true, true, false, false]);
  assert.ok(rows[0].gust < 25);
  assert.equal(rows[2].gust, 28);
});

test('storm and precipitation signals are never adjusted for elevation', () => {
  const trend = [{ ...hour, time: '05:00', gust: 10, precipChance: 80, condition: 'Thunderstorms' }];
  const approach = buildApproachProfile({ objectiveElevationFt: 11000, trailheadElevationFt: 7000, timing });
  const [row] = buildPlannedReportWeatherRows(safetyData(trend), preferences, 1, { start: '05:00', date: '2026-09-23', approach });
  assert.equal(row.approachAdjusted, true);
  assert.equal(row.pass, false);
  assert.ok(row.failedRuleLabels.includes('Precip above limit'));
  assert.ok(row.failedRuleLabels.includes('Severe weather risk'));
});

test('a clear, calm alpine start can fail at the trailhead because of an inversion', () => {
  // 8°F at the objective passes a 5°F limit; the cold pool puts the trailhead at 0°F.
  const trend = [{ time: '04:00', temp: 8, wind: 2, gust: 5, precipChance: 0, cloudCover: 5, condition: 'Clear' }];
  const approach = buildApproachProfile({ objectiveElevationFt: 11000, trailheadElevationFt: 7000, timing });
  const plan = { start: '04:00', date: '2026-09-23' };
  assert.equal(buildPlannedReportWeatherRows(safetyData(trend), preferences, 1, plan)[0].pass, true);
  const [row] = buildPlannedReportWeatherRows(safetyData(trend), preferences, 1, { ...plan, approach });
  assert.equal(row.inversionRisk, true);
  assert.equal(row.pass, false);
  assert.ok(row.failedRuleLabels.includes('Feels-like below limit'));
});

test('the go/no-go decision scores approach hours at the party elevation', () => {
  // Gusts are high only while the party would still be low on the approach:
  // climbing 5,000 ft over 225 min tops out near 7,300 and 8,700 ft in the first two hours.
  const trend = [
    { ...hour, time: '05:00', gust: 32 },
    { ...hour, time: '06:00', gust: 28 },
    { ...hour, time: '07:00', gust: 18 },
    { ...hour, time: '08:00', gust: 18 },
  ];
  const data = safetyData(trend);
  const gustCaution = (decision) => [...decision.cautions, ...decision.blockers].some((item) => /Wind gusts reach/.test(item));
  assert.equal(gustCaution(evaluateBackcountryDecision(data, '05:00', preferences)), true);
  const approach = buildApproachProfile({ objectiveElevationFt: 11000, trailheadElevationFt: 6000, timing });
  assert.equal(gustCaution(evaluateBackcountryDecision(data, '05:00', preferences, { approach })), false);
});

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

function approachScenario() {
  // Clear and calm before dawn (inversion), then a gusty overcast summit.
  const trend = [
    { time: '05:00', temp: 20, wind: 4, gust: 8, precipChance: 0, cloudCover: 5, condition: 'Clear' },
    { ...hour, time: '06:00' },
    { ...hour, time: '07:00' },
    { ...hour, time: '08:00' },
  ];
  const data = safetyData(trend);
  const approach = buildApproachProfile({ objectiveElevationFt: 11000, elevationBands: bands, timing });
  const plan = { start: '05:00', date: '2026-09-23', approach };
  const rows = buildPlannedReportWeatherRows(data, preferences, 4, plan);
  const hours = buildSkyHours(rows, { start: '05:00', sunriseMinutes: 390, sunsetMinutes: 1170 });
  return { data, approach, rows, hours };
}

test('the approach summary lists adjusted spans, elevation range and inversion hours', () => {
  const { hours } = approachScenario();
  const summary = summarizeApproachHours(hours);
  assert.equal(summary.adjustedHours, 2);
  assert.deepEqual(summary.adjustedRuns, [{ start: 0, end: 1 }]);
  assert.deepEqual(summary.inversionRuns, [{ start: 0, end: 0 }]);
  assert.equal(summarizeApproachHours([{ approachAdjusted: false, elevationFt: 11000 }]), null);
});

test('the brief note says which hours were checked below the summit and how to change it', () => {
  const { hours } = approachScenario();
  const html = renderToStaticMarkup(
    <ApproachNote hours={hours} source="estimated" clock={clock} elevation={elevation} onEdit={() => {}} />,
  );
  assert.match(html, /5 AM–7 AM checked at your estimated elevation/);
  assert.match(html, /~9,500 ft–10,900 ft/);
  assert.match(html, /trailhead estimated/);
  assert.match(html, /Set trailhead/);
  assert.match(html, /Clear, calm conditions: 5 AM–6 AM may be colder at the trailhead than at the summit/);

  const manual = renderToStaticMarkup(<ApproachNote hours={hours} source="manual" clock={clock} elevation={elevation} onEdit={() => {}} />);
  assert.match(manual, /Edit approach/);
  assert.doesNotMatch(renderToStaticMarkup(<ApproachNote hours={hours} source="gpx" clock={clock} elevation={elevation} />), /<button/);
  const summit = buildSkyHours(buildPlannedReportWeatherRows(safetyData([{ ...hour, time: '05:00' }]), preferences, 1, { start: '05:00', date: '2026-09-23' }),
    { start: '05:00', sunriseMinutes: 390, sunsetMinutes: 1170 });
  assert.equal(renderToStaticMarkup(<ApproachNote hours={summit} source="estimated" clock={clock} elevation={elevation} />), '');
});

test('the day strip marks approach hours visually and for screen readers', () => {
  const { hours } = approachScenario();
  const html = renderToStaticMarkup(<DayStrip hours={hours} clock={clock} elevation={elevation} />);
  assert.equal((html.match(/is-approach/g) || []).length, 2);
  assert.match(html, /5 AM–7 AM checked at your estimated elevation, not the summit/);
  assert.match(html, /title="5 AM · checked near 9,500 ft"/);
});

test('the Forecast chapter checks the same hours as the brief and tags them', () => {
  const { data, approach, rows } = approachScenario();
  const forecastRows = buildReportWeatherRows(data, preferences, 4, { profile: approach, start: '05:00' });
  assert.deepEqual(forecastRows.map((row) => row.pass), rows.map((row) => row.pass));
  assert.deepEqual(forecastRows.map((row) => row.elevationFt), rows.map((row) => row.elevationFt));

  const report = buildPersistedReport(
    { lat: 40, lon: -105, objectiveName: 'Peak', searchQuery: '', forecastDate: '2026-09-23', alpineStartTime: '05:00', travelWindowHours: 4, targetElevationInput: '' },
    { ...data, location: { lat: 40, lon: -105 }, capabilities: { ai: false } },
    { aiBriefNarrative: null, snowVisionAnalysis: null, snowVisionImage: null },
    { preferences },
  );
  const adjusted = renderToStaticMarkup(<Forecast report={report} approach={approach} elevation={elevation} />);
  assert.match(adjusted, /3 of 4 hours<\/strong> cross your limits, starting 6:00 AM/);
  assert.match(adjusted, /2 h are checked at your[\s\S]*not the summit; the chart shows the summit forecast/);
  assert.match(adjusted, /sky-approach-tag[^>]*>~9,500 ft · inversion/);
  assert.match(adjusted, /Checked near 9,500 ft on the approach/);

  const summit = renderToStaticMarkup(<Forecast report={report} elevation={elevation} />);
  assert.match(summit, /3 of 4 hours<\/strong> cross your limits/);
  assert.doesNotMatch(summit, /checked at your/);
  assert.doesNotMatch(summit, /sky-approach-tag/);
});

test('a cold caution caused by a likely inversion says so', () => {
  const trend = [{ time: '4 AM', temp: 8, wind: 2, gust: 5, precipChance: 0, cloudCover: 5, condition: 'Clear' }];
  const data = safetyData(trend);
  const approach = buildApproachProfile({ objectiveElevationFt: 11000, trailheadElevationFt: 7000, timing });
  const caution = (decision) => decision.cautions.find((item) => /Apparent temperature/.test(item)) || '';
  assert.equal(caution(evaluateBackcountryDecision(data, '04:00', preferences)), '');
  assert.match(caution(evaluateBackcountryDecision(data, '04:00', preferences, { approach })),
    /near the trailhead: clear, calm conditions can pool colder air in the valley than at the summit/);
});

test('approach inputs are sent to the backend for comfort scoring', () => {
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

test('a comfort score from a different approach is flagged as out of date', () => {
  const approach = buildApproachProfile({ objectiveElevationFt: 11000, trailheadElevationFt: 7000, timing });
  const comfort = (extra) => ({ score: 80, label: 'Pleasant', summary: '', scoreVersion: '1.5.0', ...extra });
  const scored = { source: 'manual', trailheadElevationFt: 7000, adjustedHours: 2, inversionHours: 1 };
  assert.equal(comfortApproachIsStale(comfort({ approach: scored }), approach), false);
  assert.equal(comfortApproachIsStale(comfort({ approach: { ...scored, trailheadElevationFt: 8000 } }), approach), true);
  assert.equal(comfortApproachIsStale(comfort({}), approach), true, 'scored at the objective, plan now has an approach');
  assert.equal(comfortApproachIsStale(comfort({ approach: scored }), null), true, 'approach turned off since');
  assert.equal(comfortApproachIsStale(comfort({ scoreVersion: '1.4.0' }), approach), false, 'older models are left alone');

  const html = renderToStaticMarkup(<ComfortScore comfort={comfort({ approach: scored })} approach={approach} elevation={elevation} />);
  assert.match(html, /2 h scored at your estimated elevation on the approach, from[\s\S]*7,000 ft \(from your trailhead\); 1 h scored colder for a likely valley inversion/);
  assert.doesNotMatch(html, /different approach/);
  const stale = renderToStaticMarkup(<ComfortScore comfort={comfort({ approach: { ...scored, trailheadElevationFt: 8000 } })} approach={approach} elevation={elevation} />);
  assert.match(stale, /Comfort was scored for a different approach than your current plan/);
});
