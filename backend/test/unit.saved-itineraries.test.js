const express = require('express');
const request = require('supertest');

const { normalizeSavedTrip, registerSavedItineraryRoutes } = require('../src/routes/saved-itineraries');

const USER = { id: '11111111-1111-4111-8111-111111111111' };
const TRIP_ID = '22222222-2222-4222-8222-222222222222';

const stage = (index) => ({ index, date: `2026-10-0${index + 1}`, start: '07:00', travelHours: 7, from: {}, to: {}, checkpoints: [] });
const trip = (overrides = {}) => ({
  version: 1,
  title: 'Enchantments traverse',
  verdictLevel: 'CAUTION',
  draft: { name: '', trailhead: { name: 'Snow Lakes TH' } },
  preferences: { defaultActivity: 'backpacking' },
  result: {
    checkedAt: '2026-09-24T18:00:00.000Z',
    startDate: '2026-10-01',
    stages: [stage(0), stage(1), stage(2)],
    results: [0, 1, 2].map((index) => ({
      index,
      date: `2026-10-0${index + 1}`,
      report: index === 1 ? null : { safety: { score: 80 }, weather: { elevation: 5000, trend: [{ temp: 40, gust: 12, precipChance: 10 }] } },
      checkpoints: [],
    })),
  },
  ...overrides,
});

const makeApp = ({ query = jest.fn(), user = USER, ensureFeatureEnabled } = {}) => {
  const app = express();
  app.use(express.json({ limit: '6mb' }));
  registerSavedItineraryRoutes({
    app,
    database: { configured: true, query },
    accountService: { available: true, getUserForSession: jest.fn().mockResolvedValue(user) },
    ...(ensureFeatureEnabled ? { ensureFeatureEnabled } : { ensureFeatureEnabled: () => {} }),
  });
  return app;
};

const row = (overrides = {}) => ({
  id: TRIP_ID,
  title: 'Enchantments traverse',
  start_date: new Date('2026-10-01T00:00:00.000Z'),
  day_count: 3,
  verdict_level: 'CAUTION',
  checked_at: '2026-09-24T18:00:00.000Z',
  created_at: '2026-09-24T18:01:00.000Z',
  updated_at: '2026-09-24T18:01:00.000Z',
  ...overrides,
});

test('saves a checked trip with its title, start date and day count', async () => {
  const query = jest.fn()
    .mockResolvedValueOnce({ rows: [{ trip_count: 3 }] })
    .mockResolvedValueOnce({ rows: [row()] });
  const response = await request(makeApp({ query })).post('/api/account/trips').send({ trip: trip() });
  expect(response.status).toBe(201);
  expect(response.body.trip).toEqual({
    id: TRIP_ID,
    title: 'Enchantments traverse',
    startDate: '2026-10-01',
    dayCount: 3,
    verdictLevel: 'CAUTION',
    checkedAt: '2026-09-24T18:00:00.000Z',
    createdAt: '2026-09-24T18:01:00.000Z',
    updatedAt: '2026-09-24T18:01:00.000Z',
  });
  const [, params] = query.mock.calls[1];
  expect(params.slice(0, 4)).toEqual([USER.id, 'Enchantments traverse', '2026-10-01', 3]);
  expect(JSON.parse(params[4]).result.results[1].report).toBeNull();
});

test('refuses a trip that is not a checked 2–7 day itinerary', () => {
  expect(() => normalizeSavedTrip({ draft: {} })).toThrow('Provide a checked trip to save.');
  expect(() => normalizeSavedTrip(trip({ result: { ...trip().result, stages: [stage(0)], results: [{}] } }))).toThrow('2–7 checked days');
  expect(() => normalizeSavedTrip(trip({ result: { ...trip().result, startDate: 'soon', stages: trip().result.stages.map((s) => ({ ...s, date: 'x' })) } }))).toThrow('valid start date');
  expect(normalizeSavedTrip(trip({ title: '', draft: { name: '', trailhead: { name: 'Snow Lakes TH' } } })).title).toBe('Snow Lakes TH trip');
});

test('a trip over the size limit is refused as too large', async () => {
  const huge = trip();
  huge.result.results[0].report.padding = 'x'.repeat(5 * 1024 * 1024);
  const response = await request(makeApp()).post('/api/account/trips').send({ trip: huge });
  expect(response.status).toBe(413);
});

test('stops saving at the per-account cap', async () => {
  const query = jest.fn().mockResolvedValueOnce({ rows: [{ trip_count: 200 }] });
  const response = await request(makeApp({ query })).post('/api/account/trips').send({ trip: trip() });
  expect(response.status).toBe(409);
  expect(query).toHaveBeenCalledTimes(1);
});

test('lists the account’s trips newest first', async () => {
  const query = jest.fn().mockResolvedValue({ rows: [row()] });
  const response = await request(makeApp({ query })).get('/api/account/trips');
  expect(response.status).toBe(200);
  expect(response.body.trips[0]).toMatchObject({ id: TRIP_ID, startDate: '2026-10-01', dayCount: 3 });
  expect(query.mock.calls[0][0]).toMatch(/WHERE user_id = \$1\s+ORDER BY created_at DESC, id DESC/);
});

test('reads a trip in full, or as a compact day-by-day summary', async () => {
  const query = jest.fn().mockResolvedValue({ rows: [row({ trip: trip() })] });
  const app = makeApp({ query });
  const full = await request(app).get(`/api/account/trips/${TRIP_ID}`);
  expect(full.body.trip.snapshot.result.results).toHaveLength(3);
  const summary = await request(app).get(`/api/account/trips/${TRIP_ID}?view=summary`);
  expect(summary.body.trip.snapshot.result).toBeUndefined();
  expect(summary.body.trip.snapshot.days.map((day) => day.checked)).toEqual([true, false, true]);
  expect(summary.body.trip.snapshot.days[0].summary).toMatchObject({ safetyScore: 80, elevationFt: 5000 });
  expect(query.mock.calls[0][1]).toEqual([TRIP_ID, USER.id]);
});

test('a trip that is not the account’s is not found, and bad IDs are refused', async () => {
  const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const app = makeApp({ query });
  expect((await request(app).get(`/api/account/trips/${TRIP_ID}`)).status).toBe(404);
  expect((await request(app).delete(`/api/account/trips/${TRIP_ID}`)).status).toBe(404);
  expect((await request(app).get('/api/account/trips/not-a-uuid')).status).toBe(400);
});

test('deletes a trip', async () => {
  const query = jest.fn().mockResolvedValue({ rowCount: 1 });
  const response = await request(makeApp({ query })).delete(`/api/account/trips/${TRIP_ID}`);
  expect(response.status).toBe(204);
  expect(query.mock.calls[0][1]).toEqual([TRIP_ID, USER.id]);
});

test('requires a signed-in account', async () => {
  const response = await request(makeApp({ user: null })).get('/api/account/trips');
  expect(response.status).toBe(401);
  expect(response.body.code).toBe('ACCOUNT_REQUIRED');
});

test('saving is refused when trip planning or history is off', async () => {
  const query = jest.fn();
  const response = await request(makeApp({
    query,
    ensureFeatureEnabled: () => { throw Object.assign(new Error('This feature is unavailable'), { statusCode: 503, code: 'FEATURE_DISABLED' }); },
  })).post('/api/account/trips').send({ trip: trip() });
  expect(response.status).toBe(503);
  expect(query).not.toHaveBeenCalled();
});
