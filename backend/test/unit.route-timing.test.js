jest.mock('../src/utils/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
const {
  appendReturnCheckpoint,
  assignRouteDistances,
  classifyDaylight,
  computeCheckpointFractions,
  computeDistanceProgress,
  sanitizeRoutePace,
} = require('../src/utils/route-timing');
const { haversineKm } = require('../src/utils/geo');
const { buildRouteTerrainProfile } = require('../src/utils/route-data');
const { buildCheckpointSchedule, buildDeterministicRouteBriefing, registerRouteAnalysisRoutes } = require('../src/routes/route-analysis');

// Three checkpoints roughly 1 mile apart along a meridian.
const MILE_DEG = 1.609344 / 111.195;
const at = (miles, elev_ft, extra = {}) => ({ name: `M${miles}`, lat: 40 + miles * MILE_DEG, lon: -105, ...(elev_ft === undefined ? {} : { elev_ft }), ...extra });

test('climbing segments take a larger share of the window than flat ones', () => {
  const { basis, fractions } = computeCheckpointFractions([at(0, 8000), at(1, 8000), at(2, 10000)], { haversineKm });
  expect(basis).toBe('distance-and-vert');
  // Flat mile = 20 min; climbing mile = 20 + 2 * 30 = 80 min.
  expect(fractions[1]).toBeCloseTo(0.2, 2);
  expect(fractions[2]).toBe(1);
});

test('user pace changes the distance-to-climb ratio', () => {
  const { fractions } = computeCheckpointFractions([at(0, 8000), at(1, 8000), at(2, 10000)], {
    haversineKm, pace: { minutesPerMile: 40, ascentMinutesPer1000Ft: 20 },
  });
  // Flat mile = 40 min; climbing mile = 40 + 40 = 80 min.
  expect(fractions[1]).toBeCloseTo(1 / 3, 2);
});

test('GPX distances are used instead of straight-line gaps when they increase', () => {
  const { fractions } = computeCheckpointFractions([
    at(0, 5000, { distance_miles: 0 }), at(1, 5000, { distance_miles: 3 }), at(2, 5000, { distance_miles: 4 }),
  ], { haversineKm });
  expect(fractions[1]).toBeCloseTo(0.75, 2);
});

test('a return checkpoint retraces the outbound route with climbing as descent', () => {
  const route = appendReturnCheckpoint([at(0, 8000), at(2, 10000)]);
  expect(route).toHaveLength(3);
  expect(route[2]).toMatchObject({ name: 'Return to M0', lat: route[0].lat, lon: route[0].lon, elev_ft: 8000, leg: 'return' });
  const { fractions } = computeCheckpointFractions(route, { haversineKm });
  // Up: 40 + 60 = 100 min. Down: 40 + 2 * 10 = 60 min.
  expect(fractions[1]).toBeCloseTo(100 / 160, 2);
  expect(fractions[2]).toBe(1);
  expect(computeDistanceProgress(route, haversineKm)).toEqual([0, 50, 100]);
});

test('out-and-back checkpoints get running distances, return included', () => {
  const route = appendReturnCheckpoint([at(0, 8000), at(1, 8000), at(3, 10000)]);
  expect(assignRouteDistances(route, haversineKm)).toBe('straight-line');
  expect(route.map((point) => point.distance_miles)).toEqual([0, 1, 3, 5, 6]);
});

test('checkpoint distances scale to a known route length, never below the straight line', () => {
  const scaled = appendReturnCheckpoint([at(0, 8000), at(1, 8000), at(3, 10000)]);
  expect(assignRouteDistances(scaled, haversineKm, 12)).toBe('route-length');
  expect(scaled.map((point) => point.distance_miles)).toEqual([0, 2, 6, 10, 12]);
  const tooShort = appendReturnCheckpoint([at(0, 8000), at(3, 10000)]);
  expect(assignRouteDistances(tooShort, haversineKm, 2)).toBe('straight-line');
  expect(tooShort.map((point) => point.distance_miles)).toEqual([0, 3, 6]);
});

test('the return passes back through each outbound checkpoint in reverse', () => {
  const route = appendReturnCheckpoint([at(0, 8000), at(1, 8000), at(2, 10000)]);
  expect(route.map((point) => point.name)).toEqual(['M0', 'M1', 'M2', 'Return to M1', 'Return to M0']);
  expect(route.slice(3).map((point) => point.leg)).toEqual(['return', 'return']);
  expect(route[3]).toMatchObject({ lat: route[1].lat, lon: route[1].lon, elev_ft: 8000 });
  const { fractions } = computeCheckpointFractions(route, { haversineKm });
  // Up: 20 + 80 min. Down the climb: 20 + 20 = 40 min, then the flat mile: 20 min.
  expect(fractions.map((fraction) => Number(fraction.toFixed(3)))).toEqual([0, 0.125, 0.625, 0.875, 1]);
  expect(computeDistanceProgress(route, haversineKm)).toEqual([0, 25, 50, 75, 100]);
});

test('an unknown elevation drops the climb weighting instead of counting as 0 ft', () => {
  const result = computeCheckpointFractions([at(0, 8000), at(1, null), at(2, 10000)], { haversineKm });
  expect(result.basis).toBe('distance');
  expect(result.fractions[1]).toBeCloseTo(0.5, 2);
});

test('timing falls back to progress, then even spacing, without coordinates', () => {
  expect(computeCheckpointFractions([{ progress_percent: 0 }, { progress_percent: 25 }, { progress_percent: 100 }], { haversineKm }))
    .toEqual({ basis: 'progress', fractions: [0, 0.25, 1] });
  expect(computeCheckpointFractions([{}, {}, {}], { haversineKm })).toEqual({ basis: 'even', fractions: [0, 0.5, 1] });
});

test('checkpoint schedule places arrivals by fraction of the window', () => {
  expect(buildCheckpointSchedule([{}, {}, {}], '2026-07-10', '06:00', 10, [0, 0.25, 1]).map((entry) => entry.time))
    .toEqual(['06:00', '08:30', '16:00']);
});

test('pace settings are bounded', () => {
  expect(sanitizeRoutePace({ minutesPerMile: 18.4, ascentMinutesPer1000Ft: 45 })).toEqual({ minutesPerMile: 18, ascentMinutesPer1000Ft: 45 });
  expect(sanitizeRoutePace({ minutesPerMile: 2, ascentMinutesPer1000Ft: 45 })).toBeNull();
  expect(sanitizeRoutePace({ minutesPerMile: 20, ascentMinutesPer1000Ft: null })).toBeNull();
  expect(sanitizeRoutePace('fast')).toBeNull();
});

test('daylight uses the checkpoint sunrise and sunset', () => {
  const solar = { sunrise: '6:12:03 AM', sunset: '7:45:10 PM' };
  expect(classifyDaylight('12:00', solar)).toBe('day');
  expect(classifyDaylight('05:30', solar)).toBe('dark');
  expect(classifyDaylight('19:45', solar)).toBe('dark');
  expect(classifyDaylight('12:00', { sunrise: 'N/A', sunset: 'N/A' })).toBeNull();
  expect(classifyDaylight('12:00', undefined)).toBeNull();
});

test('terrain profile ignores unknown elevations instead of reading them as sea level', () => {
  const profile = buildRouteTerrainProfile([at(0, 8000), at(1, null), at(2, 9000)], haversineKm);
  expect(profile.sampledElevationGainFt).toBe(0);
  expect(profile.maxSampledGradePct).toBeNull();
});

test('deterministic briefing calls out arrivals after dark', () => {
  const text = buildDeterministicRouteBriefing([
    { name: 'Trailhead', etaTime: '05:00', dataAvailable: true, score: 80, daylight: 'dark', weather: { windGust: 10, precipChance: 0 } },
    { name: 'Summit', etaTime: '11:00', dataAvailable: true, score: 70, daylight: 'day', weather: { windGust: 20, precipChance: 10 } },
  ]);
  expect(text).toContain('outside daylight at Trailhead (05:00)');
  expect(text).not.toContain('Summit (11:00)');
});

const mappedHarness = ({ elevations = {}, solar, pace, fetchElevationFt } = {}) => {
  let handler;
  const safetyQueries = [];
  registerRouteAnalysisRoutes({
    app: { get: jest.fn(), post: (path, fn) => { handler = fn; } },
    askAI: jest.fn(),
    invokeSafetyHandler: async (query) => {
      safetyQueries.push(query);
      return { statusCode: 200, payload: { weather: { temp: 40, windGust: 10, precipChance: 0 }, safety: { score: 80 }, ...(solar ? { solar } : {}) } };
    },
    fetchWithTimeout: jest.fn(),
    fetchHeaders: {},
    ensureAccountAccess: async (req) => { req.accountUser = { id: 'test-user' }; return true; },
    ensureRouteAnalysisEnabled: () => {},
    ensureGpxImportEnabled: () => {},
    ensureAIEnabled: () => { throw new Error('AI disabled'); },
    getProductFeatureFlags: () => ({}),
    fetchElevationFt: fetchElevationFt || jest.fn(async (lat) => ({ elevationFt: elevations[lat.toFixed(4)] ?? null })),
  });
  return { handler, safetyQueries, pace };
};

jest.mock('../src/utils/route-data', () => {
  const actual = jest.requireActual('../src/utils/route-data');
  return {
    ...actual,
    createRouteDataService: () => ({
      resolveMappedRoute: async ({ lat, lon }) => ({
        source: 'openstreetmap',
        sourceLabel: 'OpenStreetMap mapped trail geometry',
        matchedName: 'Test Trail',
        matchScore: 100,
        metadata: {},
        waypoints: [
          { name: 'Test Trail start', lat: lat - 2 * (1.609344 / 111.195), lon, progress_percent: 0, source: 'openstreetmap' },
          { name: 'Test Trail checkpoint 2', lat: lat - (1.609344 / 111.195), lon, progress_percent: 50, source: 'openstreetmap' },
          { name: 'Test Trail objective', lat, lon, progress_percent: 100, source: 'openstreetmap' },
        ],
      }),
    }),
  };
});

const runMapped = async (harness, body = {}) => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  await harness.handler({ body: {
    peak: 'Test Peak', route: 'Test Trail', lat: 40, lon: -105, date: '2026-07-10', start: '06:00', travel_window_hours: 10,
    ...(harness.pace ? { pace: harness.pace } : {}), ...body,
  } }, res);
  return res.json.mock.calls[0][0];
};

test('mapped routes reach the objective mid-window and check the return at its own time', async () => {
  const harness = mappedHarness({ elevations: { [(40 - 2 * MILE_DEG).toFixed(4)]: 8000, [(40 - MILE_DEG).toFixed(4)]: 8000, '40.0000': 10000 } });
  const result = await runMapped(harness);
  expect(result.timing).toMatchObject({ basis: 'distance-and-vert', roundTrip: true, travelWindowHours: 10, paceSource: 'default' });
  expect(result.summaries.map((entry) => entry.name)).toEqual([
    // The objective takes the objective's own name rather than the trail's.
    'Test Trail start', 'Test Trail checkpoint 2', 'Test Peak', 'Return to Test Trail checkpoint 2', 'Return to Test Trail start',
  ]);
  expect(result.summaries.map((entry) => entry.elev_ft)).toEqual([8000, 8000, 10000, 8000, 8000]);
  expect(result.summaries.map((entry) => entry.progress_percent)).toEqual([0, 25, 50, 75, 100]);
  expect(result.summaries.at(-1)).toMatchObject({ leg: 'return', etaTime: '16:00' });
  // Up: 20 + 80 = 100 min; down: 40 + 20 = 60 min; 600 min window → 75, 375, 525, 600 min.
  expect(result.summaries.map((entry) => entry.etaTime)).toEqual(['06:00', '07:15', '12:15', '14:45', '16:00']);
  expect(harness.safetyQueries.map((query) => query.start)).toEqual(['06:00', '07:15', '12:15', '14:45', '16:00']);
  expect(result.terrainProfile.sampledPointCount).toBe(3);
  expect(result.analysis).toContain('Return to Test Trail start at 16:00');
});

test('unknown checkpoint elevations stay null instead of becoming 0 ft', async () => {
  const harness = mappedHarness({ fetchElevationFt: jest.fn().mockRejectedValue(new Error('Elevation service down')) });
  const result = await runMapped(harness);
  expect(result.timing.basis).toBe('distance');
  expect(result.summaries.every((entry) => entry.elev_ft === null)).toBe(true);
  expect(result.waypoints.every((entry) => entry.elev_ft === null)).toBe(true);
});

test('user pace is applied and returned, and arrivals after sunset are flagged', async () => {
  const harness = mappedHarness({
    elevations: { [(40 - 2 * MILE_DEG).toFixed(4)]: 8000, [(40 - MILE_DEG).toFixed(4)]: 8000, '40.0000': 10000 },
    solar: { sunrise: '5:45:00 AM', sunset: '3:00:00 PM' },
    pace: { minutesPerMile: 30, ascentMinutesPer1000Ft: 45 },
  });
  const result = await runMapped(harness);
  expect(result.timing).toMatchObject({ paceSource: 'user', pace: { minutesPerMile: 30, ascentMinutesPer1000Ft: 45 } });
  expect(result.summaries.map((entry) => entry.daylight)).toEqual(['day', 'day', 'day', 'day', 'dark']);
  expect(result.analysis).toContain('outside daylight at Return to Test Trail start (16:00)');
});
