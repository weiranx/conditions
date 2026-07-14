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

const makeApp = ({
  query = jest.fn(),
  transaction = (callback) => callback(query),
  user = { id: USER_ID },
  tierKey = 'free',
  checker,
  now,
  ensureFeatureEnabled,
} = {}) => {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  registerObjectiveWatchRoutes({
    app,
    database: { configured: true, query, transaction },
    accountService: {
      available: true,
      getUserForSession: jest.fn().mockResolvedValue(user),
    },
    tierService: { getAccountTier: jest.fn().mockResolvedValue({ key: tierKey }) },
    ...(checker ? { checker } : {}),
    ...(now ? { now } : {}),
    ...(ensureFeatureEnabled ? { ensureFeatureEnabled } : {}),
  });
  return app;
};

test('normalizes an objective watch and produces a stable exact-plan fingerprint', () => {
  const watch = normalizeObjectiveWatch(SNAPSHOT);
  expect(watch.title).toBe('Mount Rainier');
  expect(watch.fingerprint).toBe('46.8523:-121.7603:2026-07-15:05:30:12');
  expect(createWatchFingerprint({ ...SNAPSHOT.plan, lat: 46.85234, lon: -121.76034 })).toBe(watch.fingerprint);
  expect(createWatchFingerprint({ ...SNAPSHOT.plan, forecastDate: '2026-07-16' })).not.toBe(watch.fingerprint);
  expect(createWatchFingerprint({ ...SNAPSHOT.plan, alpineStartTime: '06:00' })).not.toBe(watch.fingerprint);
  expect(createWatchFingerprint({ ...SNAPSHOT.plan, travelWindowHours: 8 })).not.toBe(watch.fingerprint);
  expect(() => normalizeObjectiveWatch({ ...SNAPSHOT, plan: { ...SNAPSHOT.plan, lat: 100 } })).toThrow('valid latitude');
  expect(() => normalizeObjectiveWatch({ ...SNAPSHOT, plan: { ...SNAPSHOT.plan, forecastDate: '' } })).toThrow('valid forecast date');
  expect(() => normalizeObjectiveWatch({ ...SNAPSHOT, plan: { ...SNAPSHOT.plan, alpineStartTime: '25:00' } })).toThrow('valid alpine start time');
  expect(() => normalizeObjectiveWatch({ ...SNAPSHOT, plan: { ...SNAPSHOT.plan, travelWindowHours: 25 } })).toThrow('1 to 24 hours');
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
    .get('/api/account/objective-watches?lat=46.8523&lon=-121.7603&forecastDate=2026-07-15&alpineStartTime=05%3A30&travelWindowHours=12')
    .set('Cookie', 'bc_session=test-session');

  expect(response.status).toBe(200);
  expect(response.body.watch.id).toBe(WATCH_ID);
  expect(response.body.watch.baselineReport.savedAt).toBe(SNAPSHOT.savedAt);
  expect(response.body.policy).toMatchObject({ tierKey: 'free', activeWatchLimit: 1, automaticChecks: false });
  expect(query.mock.calls[0][1]).toEqual([USER_ID, '46.8523:-121.7603:2026-07-15:05:30:12']);
});

test('rejects an incomplete exact-plan lookup instead of matching another trip at the same coordinates', async () => {
  const query = jest.fn();
  const response = await request(makeApp({ query }))
    .get('/api/account/objective-watches?lat=46.8523&lon=-121.7603')
    .set('Cookie', 'bc_session=test-session');

  expect(response.status).toBe(400);
  expect(response.body.error).toBe('Provide a valid forecast date.');
  expect(query).not.toHaveBeenCalled();
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
  expect(response.body.policy).toMatchObject({ tierKey: 'free', historyDays: 14 });
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
  expect(response.body.watch.nextCheckAt).toBeNull();
  const [sql, params] = query.mock.calls.find(([statement]) => statement.includes('INSERT INTO objective_watches'));
  expect(sql).toContain('ON CONFLICT (user_id, fingerprint) DO UPDATE');
  expect(params.slice(0, 3)).toEqual([USER_ID, '46.8523:-121.7603:2026-07-15:05:30:12', 'Mount Rainier']);
  expect(JSON.parse(params[3])).toEqual(SNAPSHOT.plan);
  expect(JSON.parse(params[4]).savedAt).toBe(SNAPSHOT.savedAt);
  expect(params[5]).toBe(false);
  expect(query.mock.calls.some(([statement]) => statement.includes('COUNT(*)'))).toBe(false);
});

test('enforces one active watch for Free accounts', async () => {
  const query = jest.fn(async (sql) => {
    if (sql.includes('SELECT id FROM users')) return { rows: [{ id: USER_ID }] };
    if (sql.includes('WHERE user_id = $1 AND fingerprint = $2')) return { rows: [] };
    if (sql.includes('COUNT(*)')) return { rows: [{ active_count: 1 }] };
    return { rows: [] };
  });
  const response = await request(makeApp({ query }))
    .post('/api/account/objective-watches')
    .set('Cookie', 'bc_session=test-session')
    .send({ report: SNAPSHOT });

  expect(response.status).toBe(403);
  expect(response.body).toMatchObject({
    code: 'OBJECTIVE_WATCH_LIMIT_REACHED',
    policy: { tierKey: 'free', activeWatchLimit: 1 },
  });
  expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO objective_watches'))).toBe(false);
});

test('allows Premium accounts to create up to ten active watches and queues automatic checks', async () => {
  const createdRow = {
    id: WATCH_ID,
    title: 'Mount Rainier',
    plan: SNAPSHOT.plan,
    baseline_report: SNAPSHOT,
    next_check_at: CREATED_AT,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  };
  const query = jest.fn(async (sql) => {
    if (sql.includes('SELECT id FROM users')) return { rows: [{ id: USER_ID }] };
    if (sql.includes('WHERE user_id = $1 AND fingerprint = $2')) return { rows: [] };
    if (sql.includes('COUNT(*)')) return { rows: [{ active_count: 9 }] };
    if (sql.includes('INSERT INTO objective_watches')) return { rows: [createdRow] };
    return { rows: [] };
  });
  const response = await request(makeApp({ query, tierKey: 'premium' }))
    .post('/api/account/objective-watches')
    .set('Cookie', 'bc_session=test-session')
    .send({ report: SNAPSHOT });

  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({
    watch: { id: WATCH_ID, nextCheckAt: CREATED_AT.toISOString() },
    policy: { tierKey: 'premium', activeWatchLimit: 10, automaticChecks: true },
  });
  const insertCall = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO objective_watches'));
  expect(insertCall[1][5]).toBe(true);
});

test('deletes only watches owned by the signed-in account', async () => {
  const query = jest.fn().mockResolvedValue({ rows: [{ id: WATCH_ID }] });
  const response = await request(makeApp({ query }))
    .delete(`/api/account/objective-watches/${WATCH_ID}`)
    .set('Cookie', 'bc_session=test-session');

  expect(response.status).toBe(204);
  expect(query.mock.calls[0][1]).toEqual([WATCH_ID, USER_ID]);
});

test('updates email alert preference only for a Premium account-owned watch', async () => {
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
  const response = await request(makeApp({ query, tierKey: 'premium' }))
    .patch(`/api/account/objective-watches/${WATCH_ID}`)
    .set('Cookie', 'bc_session=test-session')
    .send({ notificationsEnabled: true });

  expect(response.status).toBe(200);
  expect(response.body.watch.notificationsEnabled).toBe(true);
  expect(query.mock.calls[0][1]).toEqual([WATCH_ID, USER_ID, true]);
});

test('keeps email alerts Premium-only', async () => {
  const query = jest.fn();
  const response = await request(makeApp({ query }))
    .patch(`/api/account/objective-watches/${WATCH_ID}`)
    .set('Cookie', 'bc_session=test-session')
    .send({ notificationsEnabled: true });

  expect(response.status).toBe(403);
  expect(response.body).toMatchObject({
    code: 'OBJECTIVE_WATCH_PREMIUM_REQUIRED',
    policy: { tierKey: 'free', emailAlerts: false },
  });
  expect(query).not.toHaveBeenCalled();
});

test('manually refreshes a Free watch without enabling automatic scheduling', async () => {
  const rows = [{
    id: WATCH_ID,
    title: 'Mount Rainier',
    plan: SNAPSHOT.plan,
    baseline_report: SNAPSHOT,
    last_checked_at: null,
    next_check_at: CREATED_AT,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  }];
  const query = jest.fn().mockResolvedValue({ rows });
  const checker = { run: jest.fn().mockResolvedValue({ checked: 1, failed: 0, invalid: 0 }) };
  const response = await request(makeApp({ query, checker, now: () => CREATED_AT.getTime() }))
    .post(`/api/account/objective-watches/${WATCH_ID}/refresh`)
    .set('Cookie', 'bc_session=test-session');

  expect(response.status).toBe(200);
  expect(response.body.watch.nextCheckAt).toBeNull();
  expect(checker.run).toHaveBeenCalledWith({ watchId: WATCH_ID, userId: USER_ID, manual: true });
});

test('rate limits repeated manual refreshes', async () => {
  const query = jest.fn().mockResolvedValue({
    rows: [{
      id: WATCH_ID,
      title: 'Mount Rainier',
      plan: SNAPSHOT.plan,
      baseline_report: SNAPSHOT,
      last_checked_at: CREATED_AT,
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
    }],
  });
  const checker = { run: jest.fn() };
  const response = await request(makeApp({
    query,
    checker,
    now: () => CREATED_AT.getTime() + 60 * 1000,
  }))
    .post(`/api/account/objective-watches/${WATCH_ID}/refresh`)
    .set('Cookie', 'bc_session=test-session');

  expect(response.status).toBe(429);
  expect(response.body).toMatchObject({
    code: 'OBJECTIVE_WATCH_REFRESH_COOLDOWN',
    policy: { manualRefreshCooldownMinutes: 5 },
  });
  expect(checker.run).not.toHaveBeenCalled();
});

test('returns tier-aware Objective Watch change history', async () => {
  const query = jest.fn().mockResolvedValue({
    rows: [{ id: '42', change: { reasons: [{ key: 'wind', label: 'Wind increased.' }] }, checked_at: CREATED_AT }],
  });
  const response = await request(makeApp({ query }))
    .get(`/api/account/objective-watches/${WATCH_ID}/events`)
    .set('Cookie', 'bc_session=test-session');

  expect(response.status).toBe(200);
  expect(response.body.events[0]).toMatchObject({ id: '42', checkedAt: CREATED_AT.toISOString() });
  expect(response.body.policy.historyDays).toBe(14);
  expect(query.mock.calls[0][1]).toEqual([WATCH_ID, USER_ID, 14]);
});

test('returns tier-aware history for every Objective Watch check', async () => {
  const query = jest.fn().mockResolvedValue({
    rows: [{
      id: '43',
      check_type: 'automatic',
      status: 'unchanged',
      summary: { score: 72, tier: 'Low' },
      change: null,
      error: null,
      checked_at: CREATED_AT,
    }],
  });
  const response = await request(makeApp({ query, tierKey: 'premium' }))
    .get(`/api/account/objective-watches/${WATCH_ID}/checks`)
    .set('Cookie', 'bc_session=test-session');

  expect(response.status).toBe(200);
  expect(response.body.checks[0]).toMatchObject({
    id: '43',
    checkType: 'automatic',
    status: 'unchanged',
    summary: { score: 72, tier: 'Low' },
    checkedAt: CREATED_AT.toISOString(),
  });
  expect(response.body.policy.historyDays).toBe(90);
  expect(query.mock.calls[0][0]).toContain('FROM objective_watch_checks checks');
  expect(query.mock.calls[0][1]).toEqual([WATCH_ID, USER_ID, 90]);
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
