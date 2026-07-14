const express = require('express');
const request = require('supertest');

const {
  createWatchFingerprint,
  normalizeObjectiveWatch,
  registerObjectiveWatchRoutes,
} = require('../src/routes/objective-watches');

const USER_ID = '8c696be4-e175-4b6a-965b-82bdf3758e0c';
const WATCH_ID = '510b78d9-dae0-42aa-bad3-6be54a49625c';
const CREATED_AT = new Date('2026-07-14T08:00:00.000Z');
const SNAPSHOT = {
  version: 2,
  savedAt: CREATED_AT.toISOString(),
  plan: {
    lat: 46.8523,
    lon: -121.7603,
    objectiveName: 'Mount Rainier',
    searchQuery: 'Mount Rainier',
    forecastDate: '2026-07-15',
    alpineStartTime: '05:30',
    targetElevationInput: '14410',
    travelWindowHours: 12,
  },
  safetyData: {
    location: { lat: 46.8523, lon: -121.7603 },
    weather: { temp: 35 },
    safety: { score: 72 },
  },
};

const makeApp = ({ query = jest.fn(), user = { id: USER_ID }, ensureFeatureEnabled } = {}) => {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  registerObjectiveWatchRoutes({
    app,
    database: { configured: true, query },
    accountService: {
      available: true,
      getUserForSession: jest.fn().mockResolvedValue(user),
    },
    ...(ensureFeatureEnabled ? { ensureFeatureEnabled } : {}),
  });
  return app;
};

test('normalizes an objective watch and produces a stable coordinate fingerprint', () => {
  const watch = normalizeObjectiveWatch(SNAPSHOT);
  expect(watch.title).toBe('Mount Rainier');
  expect(watch.fingerprint).toBe('46.8523:-121.7603');
  expect(createWatchFingerprint(46.85234, -121.76034)).toBe(watch.fingerprint);
  expect(() => normalizeObjectiveWatch({ ...SNAPSHOT, plan: { ...SNAPSHOT.plan, lat: 100 } })).toThrow('valid latitude');
});

test('loads a matching objective watch with its comparison baseline', async () => {
  const query = jest.fn().mockResolvedValue({
    rows: [{
      id: WATCH_ID,
      title: 'Mount Rainier',
      plan: SNAPSHOT.plan,
      baseline_report: SNAPSHOT,
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
    }],
  });
  const response = await request(makeApp({ query }))
    .get('/api/account/objective-watches?lat=46.8523&lon=-121.7603')
    .set('Cookie', 'bc_session=test-session');

  expect(response.status).toBe(200);
  expect(response.body.watch.id).toBe(WATCH_ID);
  expect(response.body.watch.baselineReport.savedAt).toBe(SNAPSHOT.savedAt);
  expect(query.mock.calls[0][1]).toEqual([USER_ID, '46.8523:-121.7603']);
});

test('lists watched objectives for the signed-in account without returning baseline payloads', async () => {
  const secondWatchId = '8ed9f6ea-a737-4cd1-bc02-3b3561591592';
  const query = jest.fn().mockResolvedValue({
    rows: [
      {
        id: WATCH_ID,
        title: 'Mount Rainier',
        plan: SNAPSHOT.plan,
        created_at: CREATED_AT,
        updated_at: CREATED_AT,
      },
      {
        id: secondWatchId,
        title: 'Mount Baker',
        plan: { ...SNAPSHOT.plan, lat: 48.7768, lon: -121.8144, objectiveName: 'Mount Baker' },
        created_at: CREATED_AT,
        updated_at: CREATED_AT,
      },
    ],
  });
  const response = await request(makeApp({ query }))
    .get('/api/account/objective-watches')
    .set('Cookie', 'bc_session=test-session');

  expect(response.status).toBe(200);
  expect(response.body.watches).toHaveLength(2);
  expect(response.body.watches[0]).toMatchObject({ id: WATCH_ID, title: 'Mount Rainier' });
  expect(response.body.watches[0]).not.toHaveProperty('baselineReport');
  expect(query.mock.calls[0][0]).toContain('ORDER BY updated_at DESC, id DESC');
  expect(query.mock.calls[0][1]).toEqual([USER_ID]);
});

test('creates or explicitly updates a watch baseline for the signed-in account', async () => {
  const query = jest.fn().mockResolvedValue({
    rows: [{
      id: WATCH_ID,
      title: 'Mount Rainier',
      plan: SNAPSHOT.plan,
      baseline_report: SNAPSHOT,
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
    }],
  });
  const response = await request(makeApp({ query }))
    .post('/api/account/objective-watches')
    .set('Cookie', 'bc_session=test-session')
    .send({ report: SNAPSHOT });

  expect(response.status).toBe(201);
  expect(response.body.watch.title).toBe('Mount Rainier');
  const [sql, params] = query.mock.calls[0];
  expect(sql).toContain('ON CONFLICT (user_id, fingerprint) DO UPDATE');
  expect(params.slice(0, 3)).toEqual([USER_ID, '46.8523:-121.7603', 'Mount Rainier']);
  expect(JSON.parse(params[3])).toEqual(SNAPSHOT.plan);
  expect(JSON.parse(params[4]).savedAt).toBe(SNAPSHOT.savedAt);
});

test('deletes only watches owned by the signed-in account', async () => {
  const query = jest.fn().mockResolvedValue({ rows: [{ id: WATCH_ID }] });
  const response = await request(makeApp({ query }))
    .delete(`/api/account/objective-watches/${WATCH_ID}`)
    .set('Cookie', 'bc_session=test-session');

  expect(response.status).toBe(204);
  expect(query.mock.calls[0][1]).toEqual([WATCH_ID, USER_ID]);
});

test('updates email alert preference only for an account-owned watch', async () => {
  const query = jest.fn().mockResolvedValue({
    rows: [{
      id: WATCH_ID,
      title: 'Mount Rainier',
      plan: SNAPSHOT.plan,
      baseline_report: SNAPSHOT,
      notifications_enabled: true,
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
    }],
  });
  const response = await request(makeApp({ query }))
    .patch(`/api/account/objective-watches/${WATCH_ID}`)
    .set('Cookie', 'bc_session=test-session')
    .send({ notificationsEnabled: true });

  expect(response.status).toBe(200);
  expect(response.body.watch.notificationsEnabled).toBe(true);
  expect(query.mock.calls[0][1]).toEqual([WATCH_ID, USER_ID, true]);
});

test('requires an account before reading objective watches', async () => {
  const query = jest.fn();
  const response = await request(makeApp({ query, user: null })).get('/api/account/objective-watches');
  expect(response.status).toBe(401);
  expect(query).not.toHaveBeenCalled();
});

test('rejects objective watch requests before account or database access when disabled', async () => {
  const query = jest.fn();
  const ensureFeatureEnabled = jest.fn(() => {
    const error = new Error('This feature is unavailable');
    error.code = 'FEATURE_DISABLED';
    error.statusCode = 503;
    throw error;
  });

  const response = await request(makeApp({ query, ensureFeatureEnabled }))
    .get('/api/account/objective-watches');

  expect(response.status).toBe(503);
  expect(response.body).toEqual({ error: 'This feature is unavailable', code: 'FEATURE_DISABLED' });
  expect(query).not.toHaveBeenCalled();
});
