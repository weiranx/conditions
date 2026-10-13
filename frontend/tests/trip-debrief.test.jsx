import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { parseGpxRecordedTrack, parseGpxText } from '../src/lib/gpx';
import { formatDuration, thinTrackPoints } from '../src/lib/trip-debrief';

const bootstrap = new JSDOM('<html><body></body></html>');
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: bootstrap.window.navigator });
const { createRoot } = await import('react-dom/client');
const { TripDebrief } = await import('../src/field/TripDebrief');
bootstrap.window.close();
delete globalThis.window;
delete globalThis.document;
if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
else delete globalThis.navigator;

const GPX = `<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
  <trk><name>Morning Hike</name><trkseg>
    <trkpt lat="40.0000" lon="-105.6"><ele>2743.2</ele><time>2026-07-10T13:30:00Z</time></trkpt>
    <trkpt lat="40.0100" lon="-105.6"><ele>2900.0</ele><time>2026-07-10T14:00:00Z</time></trkpt>
    <trkpt lat="40.0200" lon="-105.6"><ele>3048.0</ele><time>2026-07-10T14:30:00Z</time></trkpt>
    <trkpt lat="bad" lon="-105.6"><ele>3048.0</ele></trkpt>
  </trkseg></trk>
</gpx>`;

const withDomParser = (fn) => {
  const dom = new JSDOM('');
  const previous = globalThis.DOMParser;
  globalThis.DOMParser = dom.window.DOMParser;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = previous;
  }
};

test('a recorded GPX keeps every point with its elevation and timestamp', () => {
  const { name, points } = withDomParser(() => parseGpxRecordedTrack(GPX, 'hike.gpx'));
  assert.equal(name, 'Morning Hike');
  assert.equal(points.length, 3);
  assert.deepEqual(points[0], { lat: 40, lon: -105.6, ele: 2743.2, time: '2026-07-10T13:30:00.000Z' });
  // The route parser still reads the same file as before.
  const route = withDomParser(() => parseGpxText(GPX, 'hike.gpx'));
  assert.equal(route.pointCount, 3);
  assert.equal(route.maxElevationFt, 10000);
});

test('long tracks are thinned before upload, keeping the ends and the high point', () => {
  const points = Array.from({ length: 12000 }, (_, i) => ({ lat: 40 + i * 1e-5, lon: -105, ele: i === 7777 ? 4000 : 3000 }));
  const thinned = thinTrackPoints(points, 5000);
  assert.ok(thinned.length <= 5000);
  assert.equal(thinned[0], points[0]);
  assert.equal(thinned.at(-1), points.at(-1));
  assert.ok(thinned.includes(points[7777]));
  assert.equal(thinTrackPoints(points.slice(0, 10), 5000).length, 10);
});

test('durations read in hours and minutes', () => {
  assert.equal(formatDuration(140), '2h 20m');
  assert.equal(formatDuration(45), '45m');
  assert.equal(formatDuration(null), '—');
});

const report = {
  version: 1,
  savedAt: '2026-07-11T00:00:00Z',
  plan: { lat: 40, lon: -105.6, objectiveName: 'Test Peak', searchQuery: '', forecastDate: '2026-07-10', alpineStartTime: '07:00', targetElevationInput: '', travelWindowHours: 3 },
  preferences: null,
  safetyData: { location: { lat: 40, lon: -105.6 }, forecast: { selectedStartTime: '2026-07-10T07:00:00-06:00' }, weather: {}, safety: {} },
  ai: { aiBriefNarrative: 'long text', snowVisionAnalysis: null, snowVisionImage: 'data:image/png;base64,AAAA', reportChatMessages: [] },
  route: { routeSuggestions: null, routeAnalysis: null, customRouteName: '', gpxRoute: null },
};

const comparison = {
  version: 1,
  timeZone: 'America/Denver',
  track: {
    pointCount: 3, originalPointCount: 3, downsampled: false, hasTimes: true, hasElevation: true,
    distanceMiles: 4.02, gainFt: 2010, lossFt: 1990, maxElevationFt: 11000, minElevationFt: 9000,
    elapsedMinutes: 140, movingMinutes: 120, stoppedMinutes: 20, movingMinutesPerMile: 29.9,
    startTime: '2026-07-10T13:30:00.000Z', finishTime: '2026-07-10T15:50:00.000Z', date: '2026-07-10',
    startClock: '07:30', finishClock: '09:50',
    highPoint: { lat: 40.03, lon: -105.6, elevationFt: 11000, clock: '08:50' },
    pace: {
      climbing: { miles: 2, gainFt: 2000, movingMinutes: 80, minutesPerMile: 40, verticalFtPerHour: 1500 },
      descending: { miles: 2, lossFt: 2000, movingMinutes: 40, minutesPerMile: 20, verticalFtPerHour: 3000 },
      flat: null,
    },
  },
  plan: {
    date: '2026-07-10', activity: 'hiking', activityLabel: 'Hiking', startClock: '07:00', travelWindowHours: 3,
    endClock: '10:00', turnaroundClock: '08:50', darkTurnaroundClock: null, sunriseClock: '05:40', sunsetClock: '20:25',
    pace: { minutesPerMile: 30, ascentMinutesPer1000Ft: 45, stopBufferMinutes: 30, source: 'route-your-pace' },
    route: { name: 'Loop', distanceMiles: 4.2, gainFt: 2100, source: 'gpx' },
    estimatedMinutes: 200, estimateSource: 'route-analysis',
  },
  differences: {
    dateMatches: true, startMinutes: 30, elapsedVsWindowMinutes: -40, elapsedVsEstimateMinutes: -60,
    finishMarginToPlanEndMinutes: 10, finishMarginToSunsetMinutes: 635, highPointMarginToTurnaroundMinutes: 0,
    distanceMiles: -0.18, gainFt: -90, plannedMovingMinutes: 240, paceRatio: 0.5, stoppedVsPlannedMinutes: -10,
    matchingPace: { minutesPerMile: 15, ascentMinutesPer1000Ft: 23, stopBufferMinutes: 20 },
  },
  hours: [
    { time: '2026-07-10T13:00:00.000Z', clock: '07:00', date: '2026-07-10', miles: 0.8, lowElevationFt: 9000, highElevationFt: 10450,
      forecast: { tempF: 41, windMph: 10, gustMph: 18, precipChance: 5, condition: 'Sunny', elevationFt: 11000 },
      atHigh: { elevationFt: 10450, tempF: 43, feelsLikeF: 39, windMph: 9, gustMph: 17 },
      atLow: { elevationFt: 9000, tempF: 48, feelsLikeF: 45, windMph: 6, gustMph: 13 } },
    { time: '2026-07-10T14:00:00.000Z', clock: '08:00', date: '2026-07-10', miles: 1.6, lowElevationFt: 10450, highElevationFt: 11000,
      forecast: null, atHigh: null, atLow: null },
  ],
  forecastSummary: { hours: 1, maxGustMph: 17, maxWindMph: 9, minTempF: 43, maxPrecipChance: 5 },
  notes: ['Example note from the comparison.'],
};

async function mount(t, handler) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, DOMParser: globalThis.DOMParser };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    const result = await handler();
    return Response.json(result.body, { status: result.status ?? 200 });
  };
  const root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(<TripDebrief report={report} aiAvailable formatClock={(clock) => `[${clock}]`} />);
  });
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
    if (previous.DOMParser === undefined) delete globalThis.DOMParser;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  const chooseFile = async (file) => act(async () => {
    const input = document.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const typeNotes = async (value) => act(async () => {
    const area = document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(area, value);
    area.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const click = async (text) => act(async () => {
    const button = [...document.querySelectorAll('button')].find((el) => el.textContent.includes(text));
    assert.ok(button, `Button ${text} exists`);
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { dom, requests, chooseFile, typeNotes, click };
}

test('debriefs a recorded GPX against the saved report', async (t) => {
  const narrative = '**Pace.** You moved at half the planned time.\n\n**Conditions.** You noted stronger gusts.\n\n**For next time**\n- Plan 15 min/mi.';
  const { requests, chooseFile, typeNotes, click } = await mount(t, () => ({ body: { comparison, narrative, narrativeStatus: 'ok' } }));
  const compareButton = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('Compare with the plan'));
  assert.equal(compareButton.disabled, true);

  await chooseFile(new File([GPX], 'hike.gpx', { type: 'application/gpx+xml' }));
  assert.match(document.body.textContent, /Morning Hike · 3 points/);
  await typeNotes('Gusts much stronger than forecast on the ridge');
  await click('Compare with the plan');

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/api\/trip-debrief$/);
  assert.equal(requests[0].body.track.points.length, 3);
  assert.equal(requests[0].body.track.points[2].time, '2026-07-10T14:30:00.000Z');
  assert.equal(requests[0].body.notes, 'Gusts much stronger than forecast on the ridge');
  assert.equal(requests[0].body.report.ai, undefined, 'AI text and images stay behind');
  assert.equal(requests[0].body.report.plan.objectiveName, 'Test Peak');

  const text = document.body.textContent;
  assert.match(text, /Start\[07:00\]\[07:30\]30m later/);
  assert.match(text, /Distance4\.2 mi4\.0 mi−0\.2 mi/);
  assert.match(text, /Gain2,100 ft2,010 ft−90 ft/);
  assert.match(text, /Matching pace: 15 min\/mi \+ 23 min per 1,000 ft/);
  assert.match(text, /11,000 ft at \[08:50\]/);
  assert.match(text, /10m before plan end · 10h 35m before sunset/);
  assert.match(text, /Forecast for the hours you were out/);
  assert.match(text, /9,000–10,450 ft43°F \(48°F low\)9 g17 mph5%/);
  assert.match(text, /No forecast for this hour/);
  assert.match(text, /Example note from the comparison/);
  assert.ok(document.querySelector('.trip-debrief-narrative'), 'The written debrief is shown');
  assert.match(document.querySelector('.trip-debrief-narrative').textContent, /half the planned time/);
});

test('shows the comparison without a written debrief when AI is off', async (t) => {
  const { chooseFile, click } = await mount(t, () => ({ body: { comparison, narrative: null, narrativeStatus: 'unavailable' } }));
  await chooseFile(new File([GPX], 'hike.gpx'));
  await click('Compare with the plan');
  assert.match(document.body.textContent, /Distance4\.2 mi4\.0 mi/);
  assert.equal(document.querySelector('.trip-debrief-narrative'), null);
});

test('reports a file that is not GPX and an API error', async (t) => {
  const { chooseFile, click } = await mount(t, () => ({ status: 401, body: { error: 'Sign in to debrief a trip.' } }));
  await chooseFile(new File(['hello'], 'notes.txt'));
  assert.match(document.querySelector('[role="alert"]').textContent, /\.gpx extension/);
  await chooseFile(new File([GPX], 'hike.gpx'));
  await click('Compare with the plan');
  assert.match(document.querySelector('[role="alert"]').textContent, /Sign in to debrief a trip/);
});
