import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Route } from '../src/field/Route';
import { WorkspacePlan } from '../src/field/WorkspacePlan';
import { publishAiAvailability } from '../src/hooks/useAiAvailability';
import {
  buildCheckpointProfile,
  compareCheckpointToObjective,
  describeStaleRouteAnalysis,
  objectiveHourAt,
} from '../src/field/route-planning';
import { formatClockForStyle } from '../src/app/core';
import { parseGpxText } from '../src/lib/gpx';
import { buildPersistedReport, parsePersistedReport } from '../src/app/report-storage';
import { makeReport } from '../dev/mock-data.mjs';
import { getDefaultUserPreferences } from '../src/app/preferences';

function parseGpx(xml) {
  const dom = new JSDOM('');
  const previous = globalThis.DOMParser;
  globalThis.DOMParser = dom.window.DOMParser;
  try {
    return parseGpxText(`<gpx>${xml}</gpx>`);
  } finally {
    if (previous === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = previous;
    dom.window.close();
  }
}

test('GPX skips missing and blank coordinates instead of inventing zero coordinates', () => {
  const valid = '<trkpt lat="34" lon="-117"/><trkpt lat="34.01" lon="-117"/>';
  const malformed = '<trkpt lon="-117"/><trkpt lat="34"/><trkpt lat=" " lon="-117"/><trkpt lat="34" lon=""/>';
  const baseline = parseGpx(`<trk><trkseg>${valid}</trkseg></trk>`);
  const route = parseGpx(`<trk><trkseg>${valid}${malformed}</trkseg></trk>`);
  assert.equal(route.pointCount, 2);
  assert.equal(route.distanceMiles, baseline.distanceMiles);
  assert.deepEqual(route.checkpoints, baseline.checkpoints);
  assert.throws(() => parseGpx(`<rte><rtept lon="1"/><rtept lat="1"/></rte>`), /at least two valid/);
  assert.equal(parseGpx('<rte><rtept lat="0" lon="0"/><rtept lat="0" lon="0.01"/></rte>').pointCount, 2);
});

test('GPX display tracks stay within the saved-report limit and survive a round trip', () => {
  for (const count of [999, 1000, 1500, 2000]) {
    const points = Array.from({ length: count }, (_, i) =>
      `<trkpt lat="${(34 + i * 0.0001).toFixed(5)}" lon="-117"><ele>${1000 + i}</ele></trkpt>`).join('');
    const route = parseGpx(`<trk><trkseg>${points}</trkseg></trk>`);
    assert.ok(route.displayTrack.length <= 500, `${count} points gave ${route.displayTrack.length}`);
    assert.equal(route.displayTrack[0].progress_percent, 0);
    assert.equal(route.displayTrack.at(-1).progress_percent, 100);
    const snapshot = buildPersistedReport(
      { lat: 34, lon: -117, objectiveName: 'Loop', searchQuery: '', forecastDate: '2026-09-06', alpineStartTime: '07:00', targetElevationInput: '', travelWindowHours: 10 },
      makeReport({ lat: 34, lon: -117 }, 'clear'),
      { aiBriefNarrative: null, snowVisionAnalysis: null, snowVisionImage: null, reportChatMessages: [] },
      { route: { routeSuggestions: null, routeAnalysis: null, customRouteName: '', gpxRoute: route } },
    );
    assert.deepEqual(parsePersistedReport(JSON.parse(JSON.stringify(snapshot))).route.gpxRoute, route);
  }
});

test('GPX checkpoints always include the high point and a deep low point, named by the file where it can', () => {
  // 101 points north: down into a canyon, up to a summit at 70%, then down to the finish.
  const elevation = (i) => (i <= 20 ? 2000 - i * 15 : i <= 70 ? 1700 + (i - 20) * 30 : 3200 - (i - 70) * 20);
  const track = Array.from({ length: 101 }, (_, i) =>
    `<trkpt lat="${(40 + i * 0.001).toFixed(4)}" lon="-105"><ele>${elevation(i)}</ele></trkpt>`).join('');
  const route = parseGpx(`<wpt lat="40.0401" lon="-105.0001"><name>Hidden Lake</name></wpt>
    <wpt lat="41" lon="-105"><name>Far away</name></wpt><trk><trkseg>${track}</trkseg></trk>`);
  const names = route.checkpoints.map((checkpoint) => checkpoint.name);
  assert.ok(route.checkpoints.length >= 6 && route.checkpoints.length <= 7, names.join(', '));
  assert.equal(names[0], 'Route start');
  assert.equal(names.at(-1), 'Route finish');
  const high = route.checkpoints.find((checkpoint) => checkpoint.name === 'High point');
  assert.equal(high.elev_ft, route.maxElevationFt);
  assert.equal(route.checkpoints.find((checkpoint) => checkpoint.name === 'Low point').elev_ft, Math.round(1700 * 3.28084));
  assert.ok(names.includes('Hidden Lake'));
  assert.ok(!names.includes('Far away'));
  const distances = route.checkpoints.map((checkpoint) => checkpoint.distance_miles);
  assert.deepEqual(distances, [...distances].sort((a, b) => a - b));
});

test('GPX route elements do not add distance or ascent across disconnected routes', () => {
  const first = '<rte><rtept lat="34" lon="-117"><ele>100</ele></rtept><rtept lat="34.01" lon="-117"><ele>110</ele></rtept></rte>';
  const second = '<rte><rtept lat="40" lon="-117"><ele>1000</ele></rtept><rtept lat="40.01" lon="-117"><ele>1010</ele></rtept></rte>';
  const combined = parseGpx(first + second);
  assert.equal(combined.pointCount, 4);
  assert.ok(Math.abs(combined.distanceMiles - parseGpx(first).distanceMiles - parseGpx(second).distanceMiles) <= 0.02);
  assert.equal(combined.elevationGainFt, 66);
});


const point = (overrides = {}) => ({
  name: 'Trailhead', elev_ft: 6000, distance_miles: 0, progress_percent: 0,
  etaDate: '2026-09-08', etaTime: '23:00', dataAvailable: true, score: 70,
  weather: { temp: 32, windGust: 20, precipChance: 0 }, activeAlerts: 0,
  ...overrides,
});
const result = (summaries) => ({ summaries, waypoints: [], partialData: false,
  analysis: 'Checkpoint evidence.', routeSource: 'generated' });
const workspace = (overrides = {}) => ({
  safetyData: { capabilities: { routeAnalysis: true } },
  routeAnalysis: result([point(), point({ name: 'Summit', distance_miles: 5, elev_ft: 9000,
    etaDate: '2026-09-09', etaTime: '03:00', progress_percent: 100 })]),
  preferences: { elevationUnit: 'ft' }, featureFlags: { gpxImport: true },
  objectiveName: 'Test mountain', position: { lat: 46, lng: -121 },
  forecastDate: '2026-09-08', alpineStartTime: '23:00', travelWindowHours: 4,
  objectiveTimezone: 'America/Los_Angeles', customRouteName: '', plannedRouteName: '',
  handleAnalyzePlannedRoute: () => {}, setCustomRouteName: () => {}, routeShape: 'auto', setRouteShape: () => {},
  routeSuggestions: [{ name: 'West ridge', class: 'Class 2', distance_rt_miles: 10, elev_gain_ft: 3000 }],
  formatElevationDisplay: n => `${n} ft`, formatDistanceDisplay: n => `${n} mi`,
  formatElevationDeltaDisplay: n => `+${n} ft`, formatTempDisplay: n => `${n}°F`,
  formatWindDisplay: n => `${n} mph`,
  // Arrival clocks pass through as sent unless a test checks the user's time style.
  formatClockForStyle: (value) => value,
  ...overrides,
});

test('profile respects uneven cumulative distance, with progress and order fallbacks', () => {
  const summaries = [point(), point({ distance_miles: 1, progress_percent: 25 }), point({ distance_miles: 10, progress_percent: 100 })];
  const profile = buildCheckpointProfile(summaries);
  assert.equal(profile.axis, 'distance');
  assert.deepEqual(profile.points.map(p => p.x), [20, 116, 980]);
  summaries[1].distance_miles = null;
  const progress = buildCheckpointProfile(summaries);
  assert.equal(progress.axis, 'progress');
  assert.equal(progress.points[1].x, 260);
  summaries[1].progress_percent = null;
  const order = buildCheckpointProfile(summaries);
  assert.equal(order.axis, 'order');
  assert.equal(order.points[1].x, 500);
});

test('profile rejects unavailable elevations and handles flat, duplicate and reversed distances', () => {
  for (const invalid of [null, undefined, NaN, Infinity, '5000']) {
    assert.equal(buildCheckpointProfile([point(), point({ elev_ft: invalid })]), null);
  }
  assert.equal(buildCheckpointProfile([]), null);
  assert.equal(buildCheckpointProfile([point()]), null);
  for (const distances of [[0, 0, 0], [0, 5, 2]]) {
    const profile = buildCheckpointProfile(distances.map(distance_miles => point({ elev_ft: 0, distance_miles })));
    assert.equal(profile.axis, 'order');
    assert.ok(profile.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  }
});

test('an unknown elevation between known ones is drawn between them and flagged, never given a number', () => {
  const profile = buildCheckpointProfile([
    point({ elev_ft: 6000, distance_miles: 0 }),
    point({ elev_ft: null, distance_miles: 2 }),
    point({ elev_ft: 9000, distance_miles: 4 }),
    point({ elev_ft: null, distance_miles: 6 }),
  ]);
  assert.deepEqual(profile.points.map((p) => p.estimated), [false, true, false, true]);
  assert.equal(profile.low, 6000);
  assert.equal(profile.high, 9000);
  // Halfway along, halfway up; past the last known elevation, level with it.
  assert.equal(profile.points[1].y, (profile.points[0].y + profile.points[2].y) / 2);
  assert.equal(profile.points[3].y, profile.points[2].y);
  const html = renderToStaticMarkup(<Route workspace={workspace({ routeAnalysis: result([
    point(), point({ name: 'Col', elev_ft: null, distance_miles: 2 }), point({ name: 'Summit', elev_ft: 9000, distance_miles: 4 }),
  ]) })} />);
  assert.match(html, /Elevation unknown/);
  assert.match(html, /Col.*Elevation unavailable/);
});

test('an alert or Considerable avalanche danger flags a checkpoint that is within every limit', () => {
  const calm = { temp: 40, feelsLike: 35, windGust: 10, precipChance: 10 };
  assert.equal(checkpointTone(point({ weather: calm }), limits), 'within');
  assert.equal(checkpointTone(point({ weather: calm, activeAlerts: 1 }), limits), 'hazard');
  assert.equal(checkpointTone(point({ weather: calm, avalanche: { risk: 'Considerable', dangerLevel: 3 } }), limits), 'hazard');
  assert.equal(checkpointTone(point({ weather: calm, avalanche: { risk: 'Moderate', dangerLevel: 2 } }), limits), 'within');
  // A crossed limit still leads; a missing forecast reports no hazard.
  assert.equal(checkpointTone(point({ weather: { ...calm, windGust: 45 }, activeAlerts: 2 }), limits), 'over');
  assert.equal(checkpointTone(point({ dataAvailable: false, activeAlerts: 3 }), limits), 'missing');
  const html = renderToStaticMarkup(<Route workspace={workspace({ preferences: { elevationUnit: 'ft', ...limits },
    routeAnalysis: result([point({ weather: calm }), point({ name: 'Summit', weather: calm, elev_ft: 9000, distance_miles: 5,
      avalanche: { risk: 'High', dangerLevel: 4 } })]) })} />);
  assert.match(html, /1 checkpoint is under a weather alert or avalanche danger/);
  assert.match(html, /High avalanche danger/);
});

test('a checkpoint is compared with the objective at the same local hour', () => {
  const trend = [
    { timeIso: '2026-09-08T22:00:00-07:00', temp: 30, gust: 30, precipChance: 20 },
    { timeIso: '2026-09-08T23:00:00-07:00', temp: 28, gust: 35, precipChance: 20 },
  ];
  assert.equal(objectiveHourAt(trend, '2026-09-08', '23:40').temp, 28);
  assert.equal(objectiveHourAt(trend, '2026-09-09', '23:40'), null);
  assert.deepEqual(compareCheckpointToObjective(point({ weather: { temp: 34, windGust: 20, precipChance: 20 } }), trend[1]),
    { temp: 6, gust: -15, precip: 0 });
  assert.equal(compareCheckpointToObjective(point({ dataAvailable: false }), trend[1]), null);
  const html = renderToStaticMarkup(<Route workspace={workspace({ preferences: { elevationUnit: 'ft', temperatureUnit: 'f', windSpeedUnit: 'mph' },
    safetyData: { capabilities: { routeAnalysis: true }, weather: { trend } } })} />);
  assert.match(html, /Vs\. objective<\/dt><dd>\+4°F · gusts −15 mph · rain −20%/);
});

test('a changed plan marks the analysis as out of date: date, start, duration, shape, and pace when arrivals follow it', () => {
  const plan = { date: '2026-09-08', start: '23:00', travelWindowHours: 4, lat: 46, lon: -121 };
  const pace = { minutesPerMile: 30, ascentMinutesPer1000Ft: 45, stopBufferMinutes: 45 };
  const analysis = { ...result([point()]), request: { ...plan, routeShape: 'auto', pace } };
  assert.deepEqual(describeStaleRouteAnalysis(analysis, { ...plan, routeShape: 'auto', pace }), []);
  assert.deepEqual(describeStaleRouteAnalysis(analysis, { ...plan, start: '05:00', travelWindowHours: 6 }), ['start time', 'planned duration']);
  assert.deepEqual(describeStaleRouteAnalysis(analysis, { ...plan, routeShape: 'loop' }), ['route shape']);
  // Pace only matters when it set the arrivals.
  const slower = { ...pace, minutesPerMile: 40 };
  assert.deepEqual(describeStaleRouteAnalysis(analysis, { ...plan, pace: slower }), []);
  assert.deepEqual(describeStaleRouteAnalysis({ ...analysis, timing: { mode: 'pace' } }, { ...plan, pace: slower }), ['pace']);
  assert.deepEqual(describeStaleRouteAnalysis({ ...analysis, request: undefined }, { ...plan, date: '2026-09-10' }), []);
  const html = renderToStaticMarkup(<Route workspace={workspace({ routeAnalysis: analysis, alpineStartTime: '05:00',
    plannedRouteName: 'West ridge', customRouteName: 'West ridge' })} />);
  assert.match(html, /start time changed after this route was analyzed/);
});

const pacedTiming = (overrides = {}) => ({
  basis: 'distance-and-vert', mode: 'pace', roundTrip: true, routeShape: 'out-and-back', travelWindowHours: 4,
  pace: { minutesPerMile: 30, ascentMinutesPer1000Ft: 60 }, paceSource: 'user', stopMinutes: 30,
  estimatedMinutes: 430, windowFit: 'longer', trackTimed: true,
  turnaround: { objectiveName: 'Summit', objectiveEta: '10:18', returnMinutes: 172, byPlanEnd: '07:08', byDark: '16:38',
    sunset: '19:30', marginToPlanEndMinutes: -190, marginToDarkMinutes: 380 },
  ...overrides,
});

test('arrivals by pace show the estimate, a way to plan for it, and when to turn around', () => {
  let planned = null;
  const summaries = [point(), point({ name: 'Summit', elev_ft: 9000, distance_miles: 4 }),
    point({ name: 'Return to Trailhead', leg: 'return', distance_miles: 8 })];
  const html = renderToStaticMarkup(<Route workspace={workspace({
    routeAnalysis: { ...result(summaries), timing: pacedTiming() },
    updatePreferences: (update) => { planned = update; },
  })} />);
  assert.match(html, /Arrivals follow your pace: 30 min per mile, 60 min per 1,000 ft of climbing, descents at a third of that, and 30 min of stops spread along the way, over every climb and descent of your track\./);
  assert.match(html, /At your pace this outing takes about 7 h, 30 min of stops included;\s*the plan is 4 h, so the last checkpoints fall after it ends/);
  assert.match(html, /Planned time<\/dt><dd>4 h<\/dd><small>7 h at your pace/);
  assert.match(html, /Turn around by<\/dt><dd>07:08<\/dd><small>You reach Summit later/);
  assert.match(html, /Before dark<\/dt><dd>16:38/);
  assert.match(html, /Return by the same route · turn around by 07:08/);
  const doc = new JSDOM(html).window.document;
  assert.ok([...doc.querySelectorAll('.sky-route-fit button')].some((b) => b.textContent === 'Plan 8 h'));
  assert.equal(planned, null);
  // A fitting estimate raises no notice.
  const fits = renderToStaticMarkup(<Route workspace={workspace({ routeAnalysis: { ...result(summaries), timing: pacedTiming({ windowFit: 'fits', estimatedMinutes: 250 }) } })} />);
  assert.doesNotMatch(fits, /sky-route-fit/);
});

test('the chapter offers the route shape, and asks about a one-way GPX track', () => {
  let shape = null;
  const gpx = { name: 'Up only', fileName: 'up.gpx', checkpoints: [{}, {}], routeShape: 'point-to-point', distanceMiles: 4 };
  const html = renderToStaticMarkup(<Route workspace={workspace({ importedGpxRoute: gpx, plannedRouteName: 'Up only',
    routeShape: 'auto', setRouteShape: (value) => { shape = value; } })} />);
  const doc = new JSDOM(html).window.document;
  const buttons = [...doc.querySelectorAll('.sky-route-shape button')].map((b) => [b.textContent, b.getAttribute('aria-pressed')]);
  assert.deepEqual(buttons, [['As drawn', 'true'], ['Out and back', 'false'], ['Loop', 'false'], ['One way', 'false']]);
  assert.match(html, /This track ends away from where it starts/);
  const chosen = renderToStaticMarkup(<Route workspace={workspace({ importedGpxRoute: gpx, plannedRouteName: 'Up only', routeShape: 'out-and-back' })} />);
  assert.doesNotMatch(chosen, /This track ends away/);
  assert.equal(shape, null);
});

test('unverified generated locations are called out once per place', () => {
  const html = renderToStaticMarkup(<Route workspace={workspace({ routeAnalysis: result([
    point(),
    point({ name: 'Lost Lake', locationEstimated: true, distance_miles: 2 }),
    point({ name: 'Summit', elev_ft: 9000, distance_miles: 4 }),
    point({ name: 'Lost Lake', locationEstimated: true, leg: 'return', distance_miles: 6 }),
  ]) })} />);
  assert.match(html, /One checkpoint wasn(?:'|&#x27;)t found on the map/);
  assert.match(html, /location estimated/);
});

test('itinerary keeps every arrival date and route uncertainty visible', () => {
  const html = renderToStaticMarkup(<Route workspace={workspace()} />);
  const doc = new JSDOM(html).window.document;
  assert.equal(doc.querySelectorAll('.field-route-stop').length, 2);
  assert.match(doc.querySelector('.field-route-itinerary').textContent, /Tue, Sep 8.*Wed, Sep 9/);
  // Choosing a route happens in the plan; the chapter only re-runs or renames it.
  assert.doesNotMatch(html, /Import GPX|Find routes|Route options/);
  assert.match(html, /2 of 2 forecasts returned/);
  assert.match(html, /not been verified against a mapped trail/);
  assert.match(html, /not terrain-adjusted pace/);
});

test('missing checkpoint forecasts never display zero alerts, score, or weather as evidence', () => {
  const html = renderToStaticMarkup(<Route workspace={workspace({ routeAnalysis: result([
    point({ dataAvailable: false, score: 0, weather: { temp: 0, windGust: 0, precipChance: 0 } }),
  ]) })} />);
  assert.match(html, /0 of 1 forecasts returned/);
  assert.match(html, /Missing forecast/);
  assert.match(html, /<dt>Alerts<\/dt><dd>—<\/dd>/);
  assert.doesNotMatch(html, /0 alerts|0\/100|0°F|0 mph|>0%/);
  assert.match(html, /Some checkpoints have incomplete source data/);
});

test('empty results and unavailable services provide a useful next step', () => {
  const html = renderToStaticMarkup(<Route workspace={workspace({ routeAnalysis: result([]), routeSuggestions: [],
    safetyData: { capabilities: { routeAnalysis: false } } })} />);
  assert.match(html, /No checkpoint forecasts were returned/);
  assert.match(html, /unavailable on this server/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test('checkpoint selection updates detail and clamps when a shorter saved route loads', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async () => new Response(JSON.stringify({ ai: { available: true } }));
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close(); Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  await act(async () => root.render(<Route workspace={workspace({ viewingHistoryReport: true })} />));
  await act(async () => document.querySelectorAll('.field-route-stop')[1].click());
  assert.equal(document.querySelector('#field-route-checkpoint-detail h3').textContent, 'Summit');
  assert.equal(document.querySelectorAll('.field-route-stop')[1].getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelector('input'), null);
  await act(async () => root.render(<Route workspace={workspace({ viewingHistoryReport: true,
    routeAnalysis: result([point({ name: 'Replacement checkpoint' })]) })} />));
  assert.equal(document.querySelector('.field-route-stop').getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelector('#field-route-checkpoint-detail h3').textContent, 'Replacement checkpoint');
});

import { checkpointTone } from '../src/field/route-planning';
import { knownFeet } from '../src/field/sky/status';

const limits = { maxWindGustMph: 25, maxPrecipChance: 60, minFeelsLikeF: 5, maxFeelsLikeF: 95 };

test('checkpoints are within limits only when every limit can be checked', () => {
  const full = { temp: 40, windSpeed: 5, windGust: 20, precipChance: 10, feelsLike: 38 };
  assert.equal(checkpointTone(point({ weather: full }), limits), 'within');
  assert.equal(checkpointTone(point({ weather: { ...full, windGust: undefined } }), limits), 'missing');
  assert.equal(checkpointTone(point({ weather: { ...full, precipChance: undefined } }), limits), 'missing');
  assert.equal(checkpointTone(point({ weather: { temp: 40, windGust: 20, precipChance: 10 } }), limits), 'missing');
  assert.equal(checkpointTone(point({ weather: { temp: 40, windSpeed: 5, windGust: 20, precipChance: 10 } }), limits), 'within');
  assert.equal(checkpointTone(point({ dataAvailable: false, weather: full }), limits), 'missing');
});

test('a known breach outranks missing readings, including the heat ceiling', () => {
  assert.equal(checkpointTone(point({ weather: { windGust: 31 } }), limits), 'over');
  assert.equal(checkpointTone(point({ weather: { temp: 100, windSpeed: 2, windGust: 5, precipChance: 0, feelsLike: 101 } }), limits), 'over');
  assert.equal(checkpointTone(point({ weather: { windGust: 5, precipChance: 0, feelsLike: -2 } }), limits), 'over');
});

test('a missing elevation stays missing instead of becoming 0 ft', () => {
  assert.equal(knownFeet(null), null);
  assert.equal(knownFeet(undefined), null);
  assert.equal(knownFeet(''), null);
  assert.equal(knownFeet('10738'), 10738);
  assert.equal(knownFeet(0), 0);
});

import { describeRouteTiming } from '../src/field/route-planning';

test('timing note explains how arrivals were estimated, and keeps the legacy note for old saves', () => {
  const timing = { basis: 'distance-and-vert', roundTrip: true, travelWindowHours: 9, pace: { minutesPerMile: 30, ascentMinutesPer1000Ft: 45 }, paceSource: 'user' };
  assert.match(describeRouteTiming(timing), /your 9-hour plan by distance and climbing, weighted by your pace settings/);
  assert.match(describeRouteTiming(timing), /out-and-back/);
  assert.match(describeRouteTiming({ ...timing, basis: 'distance', roundTrip: false }), /elevations are unknown, so climbing is not weighted/);
  assert.doesNotMatch(describeRouteTiming({ ...timing, roundTrip: false }), /out-and-back/);
  assert.match(describeRouteTiming(undefined), /not terrain-adjusted pace/);
});

test('an out-and-back shows the return time and flags arrivals after dark', () => {
  const analysis = {
    ...result([
      point({ etaTime: '06:00', etaDate: '2026-09-08', daylight: 'dark' }),
      point({ name: 'Summit', elev_ft: 9000, etaTime: '11:00', daylight: 'day' }),
      point({ name: 'Return to Trailhead', leg: 'return', etaTime: '20:30', daylight: 'dark' }),
    ]),
    timing: { basis: 'distance-and-vert', roundTrip: true, travelWindowHours: 14, pace: { minutesPerMile: 20, ascentMinutesPer1000Ft: 30 }, paceSource: 'default' },
  };
  const html = renderToStaticMarkup(<Route workspace={workspace({ routeAnalysis: analysis })} />);
  const doc = new JSDOM(html).window.document;
  assert.match(doc.querySelector('.sky-lead').textContent, /Summit, at 11:00 and are back at the start around 20:30, after dark\./);
  const stops = [...doc.querySelectorAll('.field-route-stop')].map((stop) => stop.textContent);
  assert.match(stops[0], /After dark/);
  assert.doesNotMatch(stops[1], /After dark/);
  assert.match(stops[2], /After dark/);
  assert.match(html, /your 14-hour plan by distance and climbing\./);
  assert.match(html, /checkpoints after the objective retrace it back to the start/);
});

import { buildProfileTicks, buildRouteLegs, formatEtaDate, formatLegDuration, splitRouteBriefing } from '../src/field/route-planning';

test('arrival dates and leg durations read naturally', () => {
  assert.equal(formatEtaDate('2026-09-09'), 'Wed, Sep 9');
  assert.equal(formatEtaDate(undefined), '');
  assert.equal(formatLegDuration(215), '3 h 35 min');
  assert.equal(formatLegDuration(120), '2 h');
  assert.equal(formatLegDuration(42), '40 min');
});

test('legs report time, climb and distance only when both ends know them', () => {
  const legs = buildRouteLegs([
    point({ offsetMinutes: 0, elev_ft: 6000, distance_miles: 0 }),
    point({ offsetMinutes: 150, elev_ft: 8500, distance_miles: 3.5 }),
    point({ offsetMinutes: 300, elev_ft: null, distance_miles: 5 }),
    point({ offsetMinutes: 420, elev_ft: 6000, leg: 'return', distance_miles: undefined }),
  ]);
  assert.deepEqual(legs[0], { minutes: 150, elevationDeltaFt: 2500, distanceMiles: 3.5 });
  assert.deepEqual(legs[1], { minutes: 150, elevationDeltaFt: null, distanceMiles: 1.5 });
  assert.deepEqual(legs[2], { minutes: 120, elevationDeltaFt: null, distanceMiles: null });
});

test('profile gridlines use round elevations inside the drawn range', () => {
  const ticks = buildProfileTicks(6500, 10000);
  assert.deepEqual(ticks.map((t) => t.feet), [7000, 8000, 9000, 10000]);
  assert.equal(ticks.at(-1).y, 30);
  assert.ok(ticks.every((t) => t.y >= 30 && t.y <= 155));
});

test('briefings split into sections without a gear check, free text stays as written', () => {
  const sections = splitRouteBriefing('HAZARD ZONES: Wind on the ridge.\nGEAR CHECK: Shell; headlamp.\nBOTTOM LINE: Go early.');
  assert.deepEqual(sections.map((s) => [s.key, s.text]), [
    ['hazard-zones', 'Wind on the ridge.'], ['gear-check', 'Shell; headlamp.'], ['bottom-line', 'Go early.'],
  ]);
  assert.equal(splitRouteBriefing('Checkpoint evidence.'), null);
  const html = renderToStaticMarkup(<Route workspace={workspace({ routeAnalysis: { ...result([point()]),
    analysis: 'HAZARD ZONES: Wind on the ridge. GEAR CHECK: Shell; headlamp. BOTTOM LINE: Go early.' } })} />);
  const doc = new JSDOM(html).window.document;
  assert.equal(doc.querySelector('.sky-route-bottom p').textContent, 'Go early.');
  // Gear lives in the Gear & actions chapter, so an older analysis's gear check is not repeated here.
  assert.deepEqual([...doc.querySelectorAll('.sky-route-brief-part h3')].map((h) => h.textContent), ['Hazard zones']);
  assert.doesNotMatch(html, /Shell; headlamp/);
});

test('arrival clocks follow the time style, and loops finish back at the start', () => {
  const html = renderToStaticMarkup(<Route workspace={workspace({
    preferences: { elevationUnit: 'ft', timeStyle: '12h' },
    formatClockForStyle: (value, style) => formatClockForStyle(value, style),
    routeAnalysis: { ...result([point({ etaTime: '06:00' }), point({ name: 'Summit', elev_ft: 9000, etaTime: '11:30' }),
      point({ name: 'Return to Trailhead', etaTime: '17:15' })]),
    timing: { basis: 'distance', roundTrip: false, routeShape: 'loop', travelWindowHours: 12, pace: { minutesPerMile: 20, ascentMinutesPer1000Ft: 30 }, paceSource: 'default' } },
  })} />);
  assert.match(html, /6:00 AM/);
  assert.match(html, /5:15 PM/);
  assert.doesNotMatch(html, />17:15</);
  assert.match(html, /Back at start/);
  assert.match(html, /The route is a loop/);
});

test('no stop is called the high point when every elevation is unknown', () => {
  const analysis = result([
    point({ elev_ft: null, etaTime: '06:00' }),
    point({ name: 'Summit', elev_ft: null, etaTime: '11:00' }),
    point({ name: 'Return to Trailhead', leg: 'return', elev_ft: null, etaTime: '16:00' }),
  ]);
  const html = renderToStaticMarkup(<Route workspace={workspace({ routeAnalysis: analysis })} />);
  const doc = new JSDOM(html).window.document;
  assert.doesNotMatch(doc.querySelector('.sky-lead').textContent, /high point/);
  const facts = [...doc.querySelectorAll('.sky-stat-strip dt')].map((dt) => dt.textContent);
  assert.ok(!facts.includes('Top out'));
  assert.ok(!facts.includes('High point'));
  assert.ok(facts.includes('Back at start'));
});

test('the chapter re-runs the planned GPX route rather than importing another', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async () => new Response(JSON.stringify({ ai: { available: true } }));
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close(); Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  let runs = 0;
  const gpx = { name: 'Loop', fileName: 'loop.gpx', distanceMiles: 6, elevationGainFt: 1200, checkpoints: [{}, {}, {}] };
  await act(async () => root.render(<Route workspace={workspace({ routeAnalysis: null, importedGpxRoute: gpx,
    plannedRouteName: 'Loop', handleAnalyzePlannedRoute: () => { runs += 1; } })} />));
  assert.match(document.querySelector('.sky-route-choose').textContent, /Loop · your GPX track, 3 checkpoints/);
  assert.equal(document.querySelector('.sky-route-choose input'), null);
  const analyze = document.querySelector('.sky-route-choose .field-button-primary');
  assert.equal(analyze.textContent, 'Analyze route');
  await act(async () => analyze.click());
  assert.equal(runs, 1);
});

test('without a planned route the chapter cannot analyze a blank name', () => {
  const html = renderToStaticMarkup(<Route workspace={workspace({ routeAnalysis: null })} />);
  const doc = new JSDOM(html).window.document;
  assert.equal(doc.querySelector('.sky-route-choose .field-button-primary').disabled, true);
  assert.match(html, /Name a route to check conditions along it/);
});

const planWorkspace = (overrides = {}) => ({
  ...workspace(),
  searchWrapperRef: { current: null }, searchInputRef: { current: null },
  preferences: { ...getDefaultUserPreferences(), elevationUnit: 'ft', defaultActivity: 'hiking' },
  formatTempDisplay: (f) => `${f}°F`,
  searchQuery: 'Test mountain', showSuggestions: false, suggestions: [], activeSuggestionIndex: -1,
  hasObjective: true, objectiveDraftDirty: false, featureFlags: { gpxImport: true, routeAnalysis: true },
  todayDate: '2026-09-08', maxForecastDate: '2026-09-15', travelWindowHoursDraft: '4',
  routeLoading: false, routeLoadingState: null, routeError: null, accountUser: null,
  customRouteName: 'West ridge', plannedRouteName: 'West ridge', importedGpxRoute: null,
  ...overrides,
});

test('the plan carries the route: a name, suggestions to pick from, or the imported GPX track', () => {
  const named = new JSDOM(renderToStaticMarkup(<WorkspacePlan workspace={planWorkspace()} />)).window.document;
  const step = named.querySelector('.sky-plan-route');
  assert.equal(step.open, true);
  assert.match(step.querySelector('summary').textContent, /Route.*West ridge/);
  assert.equal(step.querySelector('.sky-plan-route-name input').value, 'West ridge');
  const option = step.querySelector('.sky-plan-route-options button');
  assert.equal(option.getAttribute('aria-pressed'), 'true');
  assert.match(option.textContent, /West ridge.*Class 2 · 10 mi round trip · \+3000 ft gain · about \d+ h at your pace/);
  assert.match(step.textContent, /Sign in to check conditions/);

  const gpx = new JSDOM(renderToStaticMarkup(<WorkspacePlan workspace={planWorkspace({ customRouteName: '',
    plannedRouteName: 'Loop', accountUser: { id: 'u1' },
    importedGpxRoute: { name: 'Loop', fileName: 'loop.gpx', distanceMiles: 6, elevationGainFt: 1200, checkpoints: [{}, {}] } })} />)).window.document;
  const gpxStep = gpx.querySelector('.sky-plan-route');
  assert.equal(gpxStep.querySelector('.sky-plan-route-name'), null);
  assert.match(gpxStep.textContent, /Checkpoints come from your GPX track, 2 along the way/);
  assert.match(gpxStep.textContent, /Once your brief is ready, analyze the route in its Route chapter/);

  const blank = new JSDOM(renderToStaticMarkup(<WorkspacePlan workspace={planWorkspace({ customRouteName: '',
    plannedRouteName: '', routeSuggestions: null })} />)).window.document;
  assert.equal(blank.querySelector('.sky-plan-route').open, false);
  assert.match(blank.querySelector('.sky-plan-route summary').textContent, /Optional/);

  const flagOff = planWorkspace({ featureFlags: { routeAnalysis: false } });
  assert.doesNotMatch(renderToStaticMarkup(<WorkspacePlan workspace={flagOff} />), /sky-plan-route/);
  const comparison = renderToStaticMarkup(<WorkspacePlan workspace={planWorkspace({ tripStartDate: '2026-09-08',
    tripStartTime: '07:00', tripDurationDays: 3 })} comparison />);
  assert.doesNotMatch(comparison, /sky-plan-route/);
});

// Last in the file: the published availability is shared module state.
test('the plan does not offer route suggestions when the server has no route AI', () => {
  const previous = globalThis.window;
  globalThis.window = { dispatchEvent: () => true };
  try {
    publishAiAvailability({ available: true, features: { routeAnalysis: { available: false } } });
  } finally {
    globalThis.window = previous;
  }
  const doc = new JSDOM(renderToStaticMarkup(<WorkspacePlan workspace={planWorkspace({ accountUser: { id: 'u1' } })} />)).window.document;
  const suggest = [...doc.querySelectorAll('.sky-plan-route button')].find((b) => b.textContent === 'Suggest routes');
  assert.equal(suggest.disabled, true);
  assert.match(doc.querySelector('.sky-plan-route-hint').textContent, /unavailable on this server/);
});
