const express = require('express');
const request = require('supertest');

const { parseItineraryStages, registerItineraryRoutes } = require('../src/routes/itineraries');

const USAGE = {
  tierKey: 'guest',
  unlimited: false,
  usedRuns: 1,
  limitRuns: 3,
  remainingRuns: 2,
  percentUsed: 33.3,
  periodStart: null,
  periodEnd: null,
  resetAt: null,
  exhausted: false,
};

const usageServiceFor = (overrides = {}) => ({
  available: true,
  reserve: jest.fn().mockResolvedValue({ reservationId: 'reservation-id', duplicate: false, usage: USAGE }),
  finish: jest.fn().mockResolvedValue(USAGE),
  ...overrides,
});

const echoInvoker = () => jest.fn(async (query) => ({
  statusCode: 200,
  payload: { forecast: { selectedDate: query.date }, location: { lat: Number(query.lat), lon: Number(query.lon) } },
}));

const makeApp = ({ usageService = usageServiceFor(), invokeSafetyHandler = echoInvoker(), ensureFeatureEnabled, fetchElevationFt } = {}) => {
  const app = express();
  app.use(express.json());
  registerItineraryRoutes({
    app,
    usageService,
    invokeSafetyHandler,
    fetchElevationFt,
    ...(ensureFeatureEnabled ? { ensureFeatureEnabled } : {}),
    isProduction: false,
  });
  return app;
};

const TRAILHEAD = { name: 'Snow Lakes TH', lat: 47.53, lon: -120.71, elevationFt: 1350 };
const CAMP_1 = { name: 'Nada Lake', lat: 47.49, lon: -120.76, elevationFt: 4950 };
const CAMP_2 = { name: 'Upper Enchantments', lat: 47.48, lon: -120.82, elevationFt: 7600 };
const PASS = { name: 'Aasgard Pass', lat: 47.48, lon: -120.84 };

const threeDays = () => ({
  startDate: '2026-09-30',
  activity: 'backpacking',
  name: 'Enchantments traverse',
  stages: [
    { start: '07:00', travelHours: 7, from: TRAILHEAD, to: CAMP_1 },
    { start: '08:00', travelHours: 6, from: CAMP_1, to: CAMP_2, checkpoints: [PASS] },
    { start: '07:30', travelHours: 8, from: CAMP_2, to: TRAILHEAD },
  ],
});

const post = (app, body = threeDays(), key = 'itinerary-1') => request(app)
  .post('/api/itineraries/check')
  .set('Idempotency-Key', key)
  .send(body);

test('checks each day at its camp and each high point, one usage run in total', async () => {
  const usageService = usageServiceFor();
  const invokeSafetyHandler = echoInvoker();
  const response = await post(makeApp({ usageService, invokeSafetyHandler }));

  expect(response.status).toBe(200);
  expect(invokeSafetyHandler).toHaveBeenCalledTimes(4);
  expect(response.body.failedCount).toBe(0);
  expect(response.body.stages.map((stage) => stage.date)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02']);
  expect(response.body.stages[1].checkpoints).toEqual([
    expect.objectContaining({ name: 'Aasgard Pass', report: expect.objectContaining({ location: { lat: 47.48, lon: -120.84 } }) }),
  ]);
  expect(usageService.reserve).toHaveBeenCalledTimes(1);
  expect(usageService.reserve).toHaveBeenCalledWith(expect.objectContaining({
    metadata: { kind: 'itinerary', durationDays: 3, startDate: '2026-09-30' },
  }));
  expect(usageService.finish).toHaveBeenCalledWith(expect.objectContaining({ succeeded: true }));

  const queries = invokeSafetyHandler.mock.calls.map(([query]) => query);
  const campChecks = queries.filter((query) => query.name !== 'Aasgard Pass');
  expect(campChecks.map((query) => [query.lat, query.date, query.start, query.travel_window_hours])).toEqual([
    ['47.49', '2026-09-30', '07:00', '7'],
    ['47.48', '2026-10-01', '08:00', '6'],
    ['47.53', '2026-10-02', '07:30', '8'],
  ]);
  // Nights follow every day but the last, which ends at the exit.
  expect(campChecks.map((query) => query.camp_night)).toEqual(['1', '1', undefined]);
  expect(queries.every((query) => query.activity === 'backpacking')).toBe(true);
  // The day's start elevation feeds the approach hours.
  expect(campChecks[0].trailhead_ft).toBe('1350');
  const passCheck = queries.find((query) => query.name === 'Aasgard Pass');
  expect(passCheck).toMatchObject({ date: '2026-10-01', start: '08:00', travel_window_hours: '6', trailhead_ft: '4950' });
  expect(passCheck.camp_night).toBeUndefined();
});

test('an unknown start elevation or a layover day turns the approach off', async () => {
  const invokeSafetyHandler = echoInvoker();
  const body = threeDays();
  body.stages[0].from = { ...TRAILHEAD, elevationFt: null };
  body.stages[1] = { start: '09:00', travelHours: 6, from: CAMP_1, to: CAMP_1 };
  body.stages[2].from = CAMP_1;
  await post(makeApp({ invokeSafetyHandler }), body);
  const queries = invokeSafetyHandler.mock.calls.map(([query]) => query);
  expect(queries[0]).toMatchObject({ approach: 'off' });
  expect(queries[0].trailhead_ft).toBeUndefined();
  expect(queries[1]).toMatchObject({ approach: 'off' });
  expect(queries[2]).toMatchObject({ trailhead_ft: '4950' });
});

test('looks up a start elevation the client did not know', async () => {
  const invokeSafetyHandler = echoInvoker();
  const fetchElevationFt = jest.fn(async (lat) => (lat === 47.49 ? { elevationFt: 4987.6 } : { elevationFt: null }));
  const body = threeDays();
  body.stages[1].from = { ...CAMP_1, elevationFt: null };
  body.stages[2].from = { ...CAMP_2, elevationFt: undefined };
  const response = await post(makeApp({ invokeSafetyHandler, fetchElevationFt }), body);
  expect(fetchElevationFt).toHaveBeenCalledTimes(2);
  expect(response.body.stages.map((stage) => stage.fromElevationFt)).toEqual([1350, 4988, null]);
  const queries = invokeSafetyHandler.mock.calls.map(([query]) => query);
  expect(queries.find((query) => query.date === '2026-10-01' && query.name === 'Upper Enchantments')).toMatchObject({ trailhead_ft: '4988' });
  expect(queries.find((query) => query.date === '2026-10-02')).toMatchObject({ approach: 'off' });
});

test('a day that fails stays in place as null and is counted', async () => {
  const invokeSafetyHandler = jest.fn(async (query) => (query.date === '2026-10-01' && query.name !== 'Aasgard Pass'
    ? { statusCode: 502, payload: null }
    : { statusCode: 200, payload: { forecast: { selectedDate: query.date } } }));
  const response = await post(makeApp({ invokeSafetyHandler }));

  expect(response.status).toBe(200);
  expect(response.body.failedCount).toBe(1);
  expect(response.body.stages).toHaveLength(3);
  expect(response.body.stages[1].report).toBeNull();
  expect(response.body.stages[1].checkpoints[0].report).not.toBeNull();
  expect(response.body.stages[2].report).toMatchObject({ forecast: { selectedDate: '2026-10-02' } });
});

test('refunds the run when nothing could be checked', async () => {
  const usageService = usageServiceFor();
  const response = await post(makeApp({
    usageService,
    invokeSafetyHandler: jest.fn().mockRejectedValue(new Error('upstream down')),
  }));
  expect(response.status).toBe(502);
  expect(usageService.finish).toHaveBeenCalledWith(expect.objectContaining({ succeeded: false }));
});

test('returns the quota contract when the multi-day limit is reached', async () => {
  const limitError = Object.assign(new Error('Guest multi-day forecast limit reached.'), {
    code: 'MULTI_DAY_USAGE_LIMIT_REACHED',
    statusCode: 429,
    usage: { ...USAGE, remainingRuns: 0, exhausted: true },
  });
  const usageService = usageServiceFor({ reserve: jest.fn().mockRejectedValue(limitError), finish: jest.fn() });
  const invokeSafetyHandler = echoInvoker();
  const response = await post(makeApp({ usageService, invokeSafetyHandler }));
  expect(response.status).toBe(429);
  expect(response.body).toMatchObject({ code: 'MULTI_DAY_USAGE_LIMIT_REACHED', multiDayUsage: { exhausted: true } });
  expect(invokeSafetyHandler).not.toHaveBeenCalled();
});

test('rejects invalid itineraries before spending an allowance', async () => {
  const usageService = usageServiceFor();
  const invokeSafetyHandler = echoInvoker();
  const app = makeApp({ usageService, invokeSafetyHandler });
  const invalid = [
    { ...threeDays(), startDate: '2026-9-30' },
    { ...threeDays(), stages: threeDays().stages.slice(0, 1) },
    { ...threeDays(), stages: Array.from({ length: 8 }, () => threeDays().stages[0]) },
    { ...threeDays(), stages: [{ ...threeDays().stages[0], travelHours: 0 }, threeDays().stages[1]] },
    { ...threeDays(), stages: [{ ...threeDays().stages[0], start: '7am' }, threeDays().stages[1]] },
    { ...threeDays(), stages: [{ ...threeDays().stages[0], to: { lat: null, lon: -120 } }, threeDays().stages[1]] },
    { ...threeDays(), stages: [{ ...threeDays().stages[0], checkpoints: [PASS, PASS, PASS] }, threeDays().stages[1]] },
  ];
  for (const body of invalid) {
    const response = await post(app, body);
    expect(response.status).toBe(400);
  }
  const noKey = await request(app).post('/api/itineraries/check').send(threeDays());
  expect(noKey.status).toBe(400);
  expect(usageService.reserve).not.toHaveBeenCalled();
  expect(invokeSafetyHandler).not.toHaveBeenCalled();
});

test('rejects itineraries when trip planning is disabled', async () => {
  const usageService = usageServiceFor();
  const response = await post(makeApp({
    usageService,
    ensureFeatureEnabled: () => {
      throw Object.assign(new Error('This feature is unavailable'), { code: 'FEATURE_DISABLED', statusCode: 503 });
    },
  }));
  expect(response.status).toBe(503);
  expect(response.body.code).toBe('FEATURE_DISABLED');
  expect(usageService.reserve).not.toHaveBeenCalled();
});

test('the summary view returns compact evidence per day instead of full reports', async () => {
  const invokeSafetyHandler = jest.fn(async (query) => ({
    statusCode: 200,
    payload: {
      forecast: { selectedDate: query.date },
      safety: { score: 72, primaryHazard: 'Wind' },
      weather: { elevation: 4950, trend: [{ temp: 40, gust: 30, precipChance: null }, { temp: 35, gust: null, precipChance: 20 }] },
      ...(query.camp_night ? { campNight: { status: 'ok', severity: 'moderate' } } : {}),
    },
  }));
  const body = { ...threeDays(), view: 'summary' };
  const response = await post(makeApp({ invokeSafetyHandler }), body);
  expect(response.status).toBe(200);
  const [first] = response.body.stages;
  expect(first.report).toBeUndefined();
  expect(first.summary).toMatchObject({
    safetyScore: 72,
    elevationFt: 4950,
    weather: { lowTempF: 35, peakGustMph: 30, peakPrecipChancePct: 20, hoursMissingGust: 1, hoursMissingPrecipChance: 1 },
    campNight: { status: 'ok', severity: 'moderate' },
  });
  expect(response.body.stages[2].summary.campNight).toBeNull();
  expect(response.body.stages[1].checkpoints[0]).toMatchObject({ name: 'Aasgard Pass', checked: true });
});

test('an MCP-verified user is counted as that account, not as a guest', async () => {
  const usageService = usageServiceFor();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.mcpUser = { id: 'mcp-user' }; next(); });
  registerItineraryRoutes({
    app,
    usageService,
    invokeSafetyHandler: echoInvoker(),
    accountService: { available: true, getUserForSession: jest.fn().mockResolvedValue(null) },
    tierService: { getAccountTier: jest.fn().mockResolvedValue({ key: 'premium' }) },
    isProduction: false,
  });
  const response = await post(app);
  expect(response.status).toBe(200);
  expect(response.headers['set-cookie']).toBeUndefined();
  expect(usageService.reserve).toHaveBeenCalledWith(expect.objectContaining({ userId: 'mcp-user', anonymousId: null, tierKey: 'premium' }));
});

test('parses stage points and drops an out-of-range elevation', () => {
  const stages = parseItineraryStages([
    { start: '07:00', travelHours: 7.4, from: { ...TRAILHEAD, elevationFt: 99999 }, to: CAMP_1 },
    { start: '07:00', travelHours: 7, from: CAMP_1, to: TRAILHEAD },
  ]);
  expect(stages[0]).toMatchObject({ travelHours: 7, from: { name: 'Snow Lakes TH', elevationFt: null }, checkpoints: [] });
});
