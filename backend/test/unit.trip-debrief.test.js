const express = require('express');
const request = require('supertest');

const {
  ELEVATION_HYSTERESIS_FT,
  accumulateGainLoss,
  buildTripDebrief,
  sanitizeTrackPoints,
  smoothElevations,
} = require('../src/utils/trip-debrief');
const { ACTIVITY_PROFILES } = require('../src/utils/activity-profiles');
const { registerTripDebriefRoute, formatNarrative } = require('../src/routes/trip-debrief');

const METERS_PER_FOOT = 0.3048;
const DEG_PER_MILE = 1609.344 / ((6371000 * Math.PI) / 180);
const START_MS = Date.parse('2026-07-10T13:30:00Z'); // 07:30 in Denver (MDT, -06:00)

/**
 * Up 2 miles north gaining 2,000 ft in 80 minutes, 20 minutes stopped on top,
 * then back down in 40 minutes: one point a minute.
 */
const syntheticTrack = ({ jitterFt = 0 } = {}) => {
  const points = [];
  const baseFt = 9000;
  const push = (minute, miles, ft) => points.push({
    lat: 40 + miles * DEG_PER_MILE,
    lon: -105.6,
    ele: (ft + (jitterFt ? (minute % 2 ? jitterFt : -jitterFt) : 0)) * METERS_PER_FOOT,
    time: new Date(START_MS + minute * 60000).toISOString(),
  });
  for (let minute = 0; minute <= 80; minute += 1) push(minute, (2 * minute) / 80, baseFt + (2000 * minute) / 80);
  for (let minute = 81; minute <= 100; minute += 1) push(minute, 2, baseFt + 2000);
  for (let minute = 101; minute <= 140; minute += 1) push(minute, 2 - (2 * (minute - 100)) / 40, baseFt + 2000 - (2000 * (minute - 100)) / 40);
  return points;
};

const hour = (clock, values) => ({
  time: clock,
  timeIso: `2026-07-10T${clock}:00-06:00`,
  condition: 'Sunny',
  ...values,
});

const savedReport = () => ({
  plan: { forecastDate: '2026-07-10', alpineStartTime: '07:00', travelWindowHours: 3, objectiveName: 'Test Peak' },
  safetyData: {
    location: { lat: 40.03, lon: -105.6 },
    forecast: { selectedDate: '2026-07-10', selectedStartTime: '2026-07-10T07:00:00-06:00', activity: 'hiking' },
    weather: {
      timezone: 'America/Denver',
      elevation: 11000,
      trend: [
        hour('06:00', { temp: 38, wind: 8, gust: 14, precipChance: 0 }),
        hour('07:00', { temp: 41, wind: 10, gust: 18, precipChance: 5 }),
        hour('08:00', { temp: 45, wind: 12, gust: 22, precipChance: 10 }),
        hour('09:00', { temp: 49, wind: 15, gust: 28, precipChance: 30 }),
        hour('10:00', { temp: 52, wind: 16, gust: 30, precipChance: 40 }),
      ],
    },
    solar: { sunrise: '5:40 AM', sunset: '8:25 PM', dayLength: '14h 45m' },
    evaluation: { params: {}, plan: { date: '2026-07-10', start: '07:00', travelWindowHours: 3, activity: 'hiking', turnaroundTime: null } },
  },
  route: {
    customRouteName: 'Test Peak loop',
    gpxRoute: { name: 'Test Peak loop', distanceMiles: 4.2, elevationGainFt: 2100, routeShape: 'closed route' },
    routeAnalysis: {
      timing: {
        mode: 'pace',
        routeShape: 'loop',
        travelWindowHours: 3,
        pace: { minutesPerMile: 30, ascentMinutesPer1000Ft: 45, stopBufferMinutes: 30 },
        paceSource: 'user',
        estimatedMinutes: 200,
        turnaround: { byPlanEnd: '08:50', byDark: '18:10', sunset: '20:25' },
      },
    },
  },
});

describe('trip debrief track math', () => {
  test('distance, gain, loss, moving time and pace on a synthetic out-and-back', () => {
    const { track } = buildTripDebrief({ report: savedReport(), points: syntheticTrack() });
    expect(track.distanceMiles).toBeCloseTo(4, 1);
    expect(Math.abs(track.gainFt - 2000)).toBeLessThanOrEqual(ELEVATION_HYSTERESIS_FT);
    expect(Math.abs(track.lossFt - 2000)).toBeLessThanOrEqual(ELEVATION_HYSTERESIS_FT);
    expect(track.maxElevationFt).toBe(11000);
    expect(track.minElevationFt).toBe(9000);
    expect(track.elapsedMinutes).toBe(140);
    expect(track.movingMinutes).toBe(120);
    expect(track.stoppedMinutes).toBe(20);
    expect(track.startClock).toBe('07:30');
    expect(track.finishClock).toBe('09:50');
    expect(track.date).toBe('2026-07-10');
    expect(track.highPoint).toMatchObject({ elevationFt: 11000, clock: '08:50' });
    expect(track.pace.climbing.minutesPerMile).toBeCloseTo(40, 0);
    expect(track.pace.climbing.verticalFtPerHour).toBeGreaterThan(1400);
    expect(track.pace.climbing.verticalFtPerHour).toBeLessThan(1600);
    expect(track.pace.descending.minutesPerMile).toBeCloseTo(20, 0);
  });

  test('GPS jitter on flat ground adds no climb', () => {
    const flat = Array.from({ length: 200 }, (_, index) => ({
      lat: 40 + index * 0.0001,
      lon: -105,
      ele: (3000 + (index % 2 ? 1.5 : -1.5)) * 1,
      time: new Date(START_MS + index * 30000).toISOString(),
    }));
    const { track } = buildTripDebrief({ report: savedReport(), points: flat });
    expect(track.gainFt).toBe(0);
    expect(track.lossFt).toBe(0);
  });

  test('a single spike is smoothed away and the hysteresis ignores small wobbles', () => {
    expect(smoothElevations([100, 101, 180, 102, 103])).toEqual([100, 101, 102, 103, 103]);
    expect(accumulateGainLoss([100, 105, 98, 104, 100])).toEqual({ gainFt: 0, lossFt: 0 });
    expect(accumulateGainLoss([100, 120, 110, 140])).toEqual({ gainFt: 50, lossFt: 10 });
  });

  test('a jittery climb still counts its real gain', () => {
    const { track } = buildTripDebrief({ report: savedReport(), points: syntheticTrack({ jitterFt: 3 }) });
    expect(Math.abs(track.gainFt - 2000)).toBeLessThanOrEqual(2 * ELEVATION_HYSTERESIS_FT);
  });

  test('long tracks are thinned evenly, keeping the ends and the high point', () => {
    const raw = Array.from({ length: 20000 }, (_, index) => ({ lat: 40 + index * 0.00001, lon: -105, ele: index === 12345 ? 4000 : 3000 }));
    const { points, originalCount, downsampled } = sanitizeTrackPoints(raw, { maxPoints: 5000 });
    expect(originalCount).toBe(20000);
    expect(downsampled).toBe(true);
    expect(points.length).toBeLessThanOrEqual(5000);
    expect(points[0].lat).toBe(raw[0].lat);
    expect(points.at(-1).lat).toBe(raw.at(-1).lat);
    expect(points.some((point) => Math.round(point.eleFt) === Math.round(4000 * 3.28084))).toBe(true);
  });

  test('invalid points are dropped and backwards timestamps are ignored', () => {
    const { points } = sanitizeTrackPoints([
      { lat: 40, lon: -105, time: '2026-07-10T13:00:00Z' },
      { lat: 'x', lon: -105 },
      { lat: 95, lon: -105 },
      { lat: 40.001, lon: -105, time: '2026-07-10T12:00:00Z' },
    ]);
    expect(points).toHaveLength(2);
    expect(points[1].timeMs).toBeNull();
  });
});

describe('trip debrief plan comparison', () => {
  test('compares start, duration, pace, turnaround, daylight and route with the plan', () => {
    const { plan, differences } = buildTripDebrief({ report: savedReport(), points: syntheticTrack() });
    expect(plan).toMatchObject({
      date: '2026-07-10',
      startClock: '07:00',
      travelWindowHours: 3,
      endClock: '10:00',
      turnaroundClock: '08:50',
      sunsetClock: '20:25',
      estimatedMinutes: 200,
      estimateSource: 'route-analysis',
      activity: 'hiking',
    });
    expect(plan.pace).toMatchObject({ minutesPerMile: 30, ascentMinutesPer1000Ft: 45, stopBufferMinutes: 30, source: 'route-your-pace' });
    expect(plan.route).toMatchObject({ distanceMiles: 4.2, gainFt: 2100, source: 'gpx' });
    expect(differences.dateMatches).toBe(true);
    expect(differences.startMinutes).toBe(30);
    expect(differences.elapsedVsWindowMinutes).toBe(-40);
    expect(differences.elapsedVsEstimateMinutes).toBe(-60);
    expect(differences.finishMarginToPlanEndMinutes).toBe(10);
    expect(differences.finishMarginToSunsetMinutes).toBe(10 * 60 + 35);
    expect(differences.highPointMarginToTurnaroundMinutes).toBe(0);
    expect(differences.distanceMiles).toBeCloseTo(-0.2, 1);
    // Planned pace over the ground covered: 4 mi × 30 + 2,000 ft × 45 + 2,000 ft × 15 = 240 min.
    expect(differences.plannedMovingMinutes).toBeGreaterThan(235);
    expect(differences.plannedMovingMinutes).toBeLessThan(245);
    expect(differences.paceRatio).toBe(0.5);
    expect(differences.matchingPace).toMatchObject({ minutesPerMile: 15, ascentMinutesPer1000Ft: 23, stopBufferMinutes: 20 });
  });

  test('the hourly forecast for the hours out, moved to the elevations reached', () => {
    const { hours, forecastSummary } = buildTripDebrief({ report: savedReport(), points: syntheticTrack() });
    expect(hours.map((entry) => entry.clock)).toEqual(['07:00', '08:00', '09:00']);
    const [first, second] = hours;
    expect(first.forecast).toMatchObject({ tempF: 41, windMph: 10, gustMph: 18, precipChance: 5, elevationFt: 11000 });
    // 07:30–07:59 climbs from 9,000 ft to about 10,450 ft: colder up high than the forecast at 11,000 ft says for lower down.
    expect(first.lowElevationFt).toBe(9000);
    expect(first.atHigh.elevationFt).toBeLessThan(11000);
    expect(first.atLow).toMatchObject({ elevationFt: 9000, tempF: 41 + 7 });
    expect(second.highElevationFt).toBe(11000);
    expect(second.atHigh).toMatchObject({ tempF: 45, windMph: 12, gustMph: 22 });
    expect(forecastSummary).toMatchObject({ hours: 3, maxPrecipChance: 30 });
  });

  test('falls back to the activity pace, a route suggestion and plain clocks', () => {
    const report = savedReport();
    delete report.route.gpxRoute;
    delete report.route.routeAnalysis;
    report.route.routeSuggestions = [{ name: 'Test Peak loop', distance_rt_miles: 5, elev_gain_ft: 2500, class: 'Class 1', description: '' }];
    report.safetyData.weather.trend = report.safetyData.weather.trend.map(({ timeIso, ...row }) => row);
    const { plan, hours } = buildTripDebrief({ report, points: syntheticTrack() });
    const { timing } = ACTIVITY_PROFILES.hiking;
    expect(plan.pace).toMatchObject({ minutesPerMile: timing.paceMinutesPerMile, ascentMinutesPer1000Ft: timing.ascentMinutesPer1000Ft, source: 'activity' });
    expect(plan.route).toMatchObject({ distanceMiles: 5, gainFt: 2500, source: 'suggestion' });
    expect(plan.estimateSource).toBe('pace');
    expect(plan.turnaroundClock).toBeNull();
    expect(hours[1].forecast.tempF).toBe(45);
  });

  test('a track without timestamps still compares distance and climb', () => {
    const points = syntheticTrack().map(({ time, ...point }) => point);
    const comparison = buildTripDebrief({ report: savedReport(), points });
    expect(comparison.track.hasTimes).toBe(false);
    expect(comparison.track.distanceMiles).toBeCloseTo(4, 1);
    expect(comparison.differences.startMinutes).toBeNull();
    expect(comparison.differences.gainFt).toBeLessThan(-80);
    expect(comparison.hours).toEqual([]);
    expect(comparison.notes.join(' ')).toMatch(/no usable timestamps/);
  });

  test('a track from another day is flagged and not timed against the plan', () => {
    const points = syntheticTrack().map((point) => ({ ...point, time: new Date(Date.parse(point.time) + 2 * 86400000).toISOString() }));
    const comparison = buildTripDebrief({ report: savedReport(), points });
    expect(comparison.differences.dateMatches).toBe(false);
    expect(comparison.differences.startMinutes).toBeNull();
    expect(comparison.notes.join(' ')).toMatch(/not the report's planned date/);
  });
});

describe('POST /api/trip-debrief', () => {
  const allowAccountAccess = async (req) => {
    req.accountUser = { id: 'user-1' };
    return true;
  };
  const makeApp = (options) => {
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    registerTripDebriefRoute({ app, ensureAccountAccess: allowAccountAccess, ...options });
    return app;
  };
  const body = () => ({ report: savedReport(), track: { points: syntheticTrack() }, notes: 'Gusts much stronger than forecast on the ridge.' });

  test('writes the narrative from the comparison and the notes', async () => {
    const askAI = jest.fn().mockResolvedValue(JSON.stringify({
      pace: 'You moved at about half the planned time.',
      conditions: 'You noted gusts stronger than the 22 mph forecast.',
      suggestions: ['Plan 15 min/mi and 23 min per 1,000 ft.', 'Start on time.'],
    }));
    const response = await request(makeApp({ askAI, ensureFeatureEnabled: () => {} })).post('/api/trip-debrief').send(body());
    expect(response.status).toBe(200);
    expect(response.body.comparison.track.distanceMiles).toBeCloseTo(4, 1);
    expect(response.body.narrativeStatus).toBe('ok');
    expect(response.body.narrative).toMatch(/^\*\*Pace\.\*\* You moved/);
    expect(response.body.narrative).toMatch(/- Start on time\./);
    expect(askAI).toHaveBeenCalledTimes(1);
    const [prompt, options] = askAI.mock.calls[0];
    expect(prompt).toMatch(/Gusts much stronger than forecast on the ridge/);
    expect(prompt).toMatch(/"paceRatio":0.5/);
    expect(options).toMatchObject({ feature: 'trip-debrief', userId: 'user-1', tier: 'primary' });
  });

  test('returns the comparison without a narrative when AI is turned off', async () => {
    const askAI = jest.fn();
    const ensureFeatureEnabled = () => { throw new Error('AI features are unavailable'); };
    const response = await request(makeApp({ askAI, ensureFeatureEnabled })).post('/api/trip-debrief').send(body());
    expect(response.status).toBe(200);
    expect(response.body.narrative).toBeNull();
    expect(response.body.narrativeStatus).toBe('unavailable');
    expect(response.body.comparison.differences.paceRatio).toBe(0.5);
    expect(askAI).not.toHaveBeenCalled();
  });

  test('returns the comparison without a narrative when the traveler turned AI off for the report', async () => {
    const askAI = jest.fn();
    const response = await request(makeApp({ askAI, ensureFeatureEnabled: () => {} })).post('/api/trip-debrief').send({ ...body(), ai: false });
    expect(response.status).toBe(200);
    expect(response.body.narrative).toBeNull();
    expect(response.body.narrativeStatus).toBe('unavailable');
    expect(response.body.comparison.differences.paceRatio).toBe(0.5);
    expect(askAI).not.toHaveBeenCalled();
  });

  test('returns the comparison without a narrative when the AI fails or answers badly', async () => {
    for (const askAI of [jest.fn().mockRejectedValue(new Error('timeout')), jest.fn().mockResolvedValue('not json')]) {
      const response = await request(makeApp({ askAI, ensureFeatureEnabled: () => {} })).post('/api/trip-debrief').send(body());
      expect(response.status).toBe(200);
      expect(response.body.narrative).toBeNull();
      expect(response.body.narrativeStatus).toBe('failed');
      expect(response.body.comparison.track.gainFt).toBeGreaterThan(1900);
    }
  });

  test('requires account access before comparing', async () => {
    const askAI = jest.fn();
    const deny = async (req, res) => { res.status(401).json({ error: 'Sign in' }); return false; };
    const response = await request(makeApp({ askAI, ensureAccountAccess: deny })).post('/api/trip-debrief').send(body());
    expect(response.status).toBe(401);
    expect(askAI).not.toHaveBeenCalled();
  });

  test('rejects a missing report or track', async () => {
    const app = makeApp({ askAI: jest.fn() });
    expect((await request(app).post('/api/trip-debrief').send({ track: { points: syntheticTrack() } })).status).toBe(400);
    expect((await request(app).post('/api/trip-debrief').send({ report: savedReport(), track: { points: [{ lat: 40, lon: -105 }] } })).status).toBe(400);
    expect((await request(app).post('/api/trip-debrief').send({ report: savedReport(), track: { points: [{ lat: 'a' }, { lat: 'b' }] } })).status).toBe(400);
    expect((await request(app).post('/api/trip-debrief').send({ report: savedReport(), track: { points: syntheticTrack() }, notes: 5 })).status).toBe(400);
  });

  test('formatNarrative needs every part', () => {
    expect(formatNarrative('{"pace":"a","conditions":"b","suggestions":[]}')).toBeNull();
    expect(formatNarrative('```json\n{"pace":"**a**","conditions":"b","suggestions":["c","d","e","f"]}\n```'))
      .toBe('**Pace.** a\n\n**Conditions.** b\n\n**For next time**\n- c\n- d\n- e');
  });
});
