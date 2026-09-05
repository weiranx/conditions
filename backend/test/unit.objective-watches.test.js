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
  tierService,
  checker,
  scheduler,
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
    tierService: tierService === undefined
      ? { getAccountTier: jest.fn().mockResolvedValue({ key: tierKey }) }
      : tierService,
    ...(checker ? { checker } : {}),
    ...(scheduler ? { scheduler } : {}),
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
  expect(() => normalizeObjectiveWatch({ ...SNAPSHOT, plan: { ...SNAPSHOT.plan, forecastDate: '2026-02-29' } })).toThrow('valid forecast date');
  expect(() => normalizeObjectiveWatch({ ...SNAPSHOT, plan: { ...SNAPSHOT.plan, forecastDate: '2026-99-99' } })).toThrow('valid forecast date');
  expect(() => normalizeObjectiveWatch({ ...SNAPSHOT, plan: { ...SNAPSHOT.plan, forecastDate: '0000-01-01' } })).toThrow('valid forecast date');
  expect(() => normalizeObjectiveWatch({ ...SNAPSHOT, plan: { ...SNAPSHOT.plan, forecastDate: '2024-02-29' } })).not.toThrow();
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
        last_attempted_at: CREATED_AT,
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
  expect(response.body.watches[0]).toMatchObject({
    id: WATCH_ID,
    title: 'Mount Rainier',
    lastAttemptedAt: CREATED_AT.toISOString(),
  });
  expect(response.body.watches[0]).not.toHaveProperty('baselineReport');
  expect(query.mock.calls[0][0]).toContain('ORDER BY updated_at DESC, id DESC');
  expect(query.mock.calls[0][1]).toEqual([USER_ID, 14]);
  expect(query.mock.calls[0][0]).toContain('checks.watch_id = objective_watches.id');
  expect(query.mock.calls[0][0]).toContain('ORDER BY checks.checked_at DESC, checks.id DESC');
  expect(response.body.policy).toMatchObject({ tierKey: 'free', historyDays: 14 });
});

test('returns the configured cadence and stopped state with the watch policy', async () => {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  const scheduler = {
    getStatus: jest.fn().mockResolvedValue({ enabled: false, checkIntervalMinutes: 30 }),
  };
  const response = await request(makeApp({ query, tierKey: 'premium', scheduler }))
    .get('/api/account/objective-watches')
    .set('Cookie', 'bc_session=test-session');

  expect(response.status).toBe(200);
  expect(response.body.policy).toMatchObject({
    automaticChecks: true,
    schedulerEnabled: false,
    checkIntervalMinutes: 30,
  });
  expect(scheduler.getStatus).toHaveBeenCalledTimes(1);
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
  expect(sql).not.toContain('last_attempted_at = NULL');
  expect(params.slice(0, 3)).toEqual([USER_ID, '46.8523:-121.7603:2026-07-15:05:30:12', 'Mount Rainier']);
  expect(JSON.parse(params[3])).toEqual(SNAPSHOT.plan);
  expect(JSON.parse(params[4]).savedAt).toBe(SNAPSHOT.savedAt);
  expect(params[5]).toBe(false);
  expect(query.mock.calls.some(([statement]) => statement.includes('COUNT(*)'))).toBe(false);
});

test('preserves the manual refresh cooldown when replacing a same-plan baseline', async () => {
  let lastAttemptedAt = CREATED_AT;
  const watchRow = () => ({
    id: WATCH_ID,
    title: 'Mount Rainier',
    plan: SNAPSHOT.plan,
    baseline_report: SNAPSHOT,
    last_attempted_at: lastAttemptedAt,
    last_checked_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  });
  const query = jest.fn(async (sql) => {
    if (sql.includes('SELECT id FROM users')) return { rows: [{ id: USER_ID }] };
    if (sql.includes('WHERE user_id = $1 AND fingerprint = $2')) return { rows: [{ id: WATCH_ID }] };
    if (sql.includes('INSERT INTO objective_watches')) {
      if (sql.includes('last_attempted_at = NULL')) lastAttemptedAt = null;
      return { rows: [watchRow()] };
    }
    if (sql.includes('FROM objective_watches')) return { rows: [watchRow()] };
    return { rows: [] };
  });
  const checker = { run: jest.fn() };
  const app = makeApp({
    query,
    checker,
    now: () => CREATED_AT.getTime() + 60 * 1000,
  });

  const baselineResponse = await request(app)
    .post('/api/account/objective-watches')
    .set('Cookie', 'bc_session=test-session')
    .send({ report: SNAPSHOT });
  const immediateRefresh = await request(app)
    .post(`/api/account/objective-watches/${WATCH_ID}/refresh`)
    .set('Cookie', 'bc_session=test-session');

  expect(baselineResponse.status).toBe(201);
  expect(baselineResponse.body.watch.lastAttemptedAt).toBe(CREATED_AT.toISOString());
  expect(immediateRefresh.status).toBe(429);
  expect(immediateRefresh.body).toMatchObject({
    code: 'OBJECTIVE_WATCH_REFRESH_COOLDOWN',
    retryAt: new Date(CREATED_AT.getTime() + 5 * 60 * 1000).toISOString(),
  });
  expect(checker.run).not.toHaveBeenCalled();
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
  const countCall = query.mock.calls.find(([sql]) => sql.includes('COUNT(*)'));
  expect(countCall[0]).toContain("TO_CHAR((NOW() - INTERVAL '14 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD')");
  expect(countCall[0]).not.toContain("(plan->>'forecastDate')::date");
  expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO objective_watches'))).toBe(false);
});

test('fails mutations closed when account tier benefits cannot be loaded', async () => {
  const query = jest.fn();
  const tierService = { getAccountTier: jest.fn().mockRejectedValue(new Error('database offline')) };
  const response = await request(makeApp({ query, tierService }))
    .post('/api/account/objective-watches')
    .set('Cookie', 'bc_session=test-session')
    .send({ report: SNAPSHOT });

  expect(response.status).toBe(503);
  expect(response.body).toEqual({
    error: 'Objective Watch account benefits are temporarily unavailable. Please try again.',
    code: 'OBJECTIVE_WATCH_POLICY_UNAVAILABLE',
  });
  expect(query).not.toHaveBeenCalled();
});

test('keeps read-only watch access available with Free policy when tier lookup fails', async () => {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  const tierService = { getAccountTier: jest.fn().mockRejectedValue(new Error('database offline')) };
  const response = await request(makeApp({ query, tierService }))
    .get('/api/account/objective-watches')
    .set('Cookie', 'bc_session=test-session');

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ watches: [], policy: { tierKey: 'free' } });
  expect(query).toHaveBeenCalledTimes(1);
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

test('allows disabling email alerts when account tier lookup fails', async () => {
  const query = jest.fn().mockResolvedValue({
    rows: [{
      id: WATCH_ID,
      title: 'Mount Rainier',
      plan: SNAPSHOT.plan,
      baseline_report: SNAPSHOT,
      notifications_enabled: false,
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
    }],
  });
  const tierService = { getAccountTier: jest.fn().mockRejectedValue(new Error('database offline')) };
  const response = await request(makeApp({ query, tierService }))
    .patch(`/api/account/objective-watches/${WATCH_ID}`)
    .set('Cookie', 'bc_session=test-session')
    .send({ notificationsEnabled: false });

  expect(response.status).toBe(200);
  expect(response.body.watch.notificationsEnabled).toBe(false);
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][1]).toEqual([WATCH_ID, USER_ID, false]);
});

test('fails closed when enabling email alerts and account tier lookup fails', async () => {
  const query = jest.fn();
  const tierService = { getAccountTier: jest.fn().mockRejectedValue(new Error('database offline')) };
  const response = await request(makeApp({ query, tierService }))
    .patch(`/api/account/objective-watches/${WATCH_ID}`)
    .set('Cookie', 'bc_session=test-session')
    .send({ notificationsEnabled: true });

  expect(response.status).toBe(503);
  expect(response.body).toMatchObject({ code: 'OBJECTIVE_WATCH_POLICY_UNAVAILABLE' });
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
  expect(checker.run).toHaveBeenCalledWith(expect.objectContaining({
    watchId: WATCH_ID,
    userId: USER_ID,
    manual: true,
    manualCooldownMinutes: 5,
    claimToken: expect.any(String),
  }));
});

test('returns not found when a watch is deleted after a successful manual check', async () => {
  const row = {
    id: WATCH_ID,
    title: 'Mount Rainier',
    plan: SNAPSHOT.plan,
    baseline_report: SNAPSHOT,
    last_checked_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  };
  let fullSelectCount = 0;
  const query = jest.fn(async (sql) => {
    if (sql.includes('SET last_attempted_at = $3')) return { rows: [{ id: WATCH_ID }] };
    if (sql.includes('SELECT id, title, plan, baseline_report')) {
      fullSelectCount += 1;
      return { rows: fullSelectCount === 1 ? [row] : [] };
    }
    return { rows: [] };
  });
  const checker = { run: jest.fn().mockResolvedValue({ checked: 1, failed: 0, invalid: 0 }) };
  const response = await request(makeApp({ query, checker, now: () => CREATED_AT.getTime() }))
    .post(`/api/account/objective-watches/${WATCH_ID}/refresh`)
    .set('Cookie', 'bc_session=test-session');

  expect(response.status).toBe(404);
  expect(response.body).toEqual({ error: 'Objective watch not found.' });
  expect(checker.run).toHaveBeenCalledWith(expect.objectContaining({
    watchId: WATCH_ID,
    userId: USER_ID,
    manual: true,
    claimToken: expect.any(String),
  }));
});

test('rejects a concurrent manual refresh before repeating policy or database work', async () => {
  const rows = [{
    id: WATCH_ID,
    title: 'Mount Rainier',
    plan: SNAPSHOT.plan,
    baseline_report: SNAPSHOT,
    last_checked_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  }];
  const query = jest.fn().mockResolvedValue({ rows });
  let signalStarted;
  let releaseCheck;
  const checkStarted = new Promise((resolve) => { signalStarted = resolve; });
  const pendingCheck = new Promise((resolve) => { releaseCheck = resolve; });
  const checker = {
    run: jest.fn(() => {
      signalStarted();
      return pendingCheck;
    }),
  };
  const app = makeApp({ query, checker });
  const firstResponsePromise = request(app)
    .post(`/api/account/objective-watches/${WATCH_ID}/refresh`)
    .set('Cookie', 'bc_session=test-session')
    .then((response) => response);
  await checkStarted;

  const concurrentResponse = await request(app)
    .post(`/api/account/objective-watches/${WATCH_ID}/refresh`)
    .set('Cookie', 'bc_session=test-session');
  releaseCheck({ checked: 1, failed: 0, invalid: 0 });
  const firstResponse = await firstResponsePromise;

  expect(firstResponse.status).toBe(200);
  expect(concurrentResponse.status).toBe(409);
  expect(concurrentResponse.body.code).toBe('OBJECTIVE_WATCH_REFRESH_IN_PROGRESS');
  expect(checker.run).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledTimes(4);
});

test('rejects a manual refresh when the scheduler wins the database claim race', async () => {
  const automaticClaimToken = '8ed9f6ea-a737-4cd1-bc02-3b3561591592';
  let schedulerClaimed = false;
  const row = () => ({
    id: WATCH_ID,
    title: 'Mount Rainier',
    plan: SNAPSHOT.plan,
    baseline_report: SNAPSHOT,
    last_attempted_at: schedulerClaimed ? CREATED_AT : null,
    last_checked_at: null,
    check_claimed_at: schedulerClaimed ? CREATED_AT : null,
    check_claim_token: schedulerClaimed ? automaticClaimToken : null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  });
  const query = jest.fn(async (sql) => {
    if (sql.includes('SET last_attempted_at = $3')) {
      schedulerClaimed = true;
      return { rows: [] };
    }
    if (sql.includes('FROM objective_watches')) return { rows: [row()] };
    return { rows: [] };
  });
  const checker = { run: jest.fn() };
  const response = await request(makeApp({ query, checker, now: () => CREATED_AT.getTime() }))
    .post(`/api/account/objective-watches/${WATCH_ID}/refresh`)
    .set('Cookie', 'bc_session=test-session');

  expect(response.status).toBe(409);
  expect(response.body.code).toBe('OBJECTIVE_WATCH_REFRESH_IN_PROGRESS');
  expect(checker.run).not.toHaveBeenCalled();
  const routeClaim = query.mock.calls.find(([sql]) => sql.includes('SET last_attempted_at = $3'));
  expect(routeClaim[0]).toContain('check_claimed_at IS NULL');
  expect(routeClaim[0]).toContain('check_claimed_at <= $6');
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

test('persists the manual refresh cooldown when the checker fails', async () => {
  let currentTimeMs = CREATED_AT.getTime();
  let lastAttemptedAt = null;
  const row = () => ({
    id: WATCH_ID,
    title: 'Mount Rainier',
    plan: SNAPSHOT.plan,
    baseline_report: SNAPSHOT,
    last_attempted_at: lastAttemptedAt,
    last_checked_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  });
  const query = jest.fn(async (sql, params) => {
    if (sql.includes('SET last_attempted_at = $3')) {
      const cooldownThreshold = new Date(params[3]).getTime();
      if (lastAttemptedAt && lastAttemptedAt.getTime() > cooldownThreshold) return { rows: [] };
      lastAttemptedAt = new Date(params[2]);
      return { rows: [{ id: WATCH_ID }] };
    }
    if (sql.includes('FROM objective_watches')) return { rows: [row()] };
    return { rows: [] };
  });
  const checker = { run: jest.fn().mockResolvedValue({ checked: 0, failed: 1, invalid: 0 }) };
  const app = makeApp({ query, checker, now: () => currentTimeMs });

  const failedResponse = await request(app)
    .post(`/api/account/objective-watches/${WATCH_ID}/refresh`)
    .set('Cookie', 'bc_session=test-session');
  currentTimeMs += 60 * 1000;
  const immediateRetry = await request(app)
    .post(`/api/account/objective-watches/${WATCH_ID}/refresh`)
    .set('Cookie', 'bc_session=test-session');

  expect(failedResponse.status).toBe(502);
  expect(lastAttemptedAt.toISOString()).toBe(CREATED_AT.toISOString());
  expect(immediateRetry.status).toBe(429);
  expect(immediateRetry.body).toMatchObject({
    code: 'OBJECTIVE_WATCH_REFRESH_COOLDOWN',
    retryAt: new Date(CREATED_AT.getTime() + 5 * 60 * 1000).toISOString(),
  });
  expect(checker.run).toHaveBeenCalledTimes(1);
  const claimCall = query.mock.calls.find(([sql]) => sql.includes('SET last_attempted_at = $3'));
  expect(claimCall[0]).toContain('COALESCE(last_attempted_at, last_checked_at) <= $4');
});

test('releases a route-owned database claim when the checker throws', async () => {
  let activeClaimToken = null;
  let lastAttemptedAt = null;
  const row = () => ({
    id: WATCH_ID,
    title: 'Mount Rainier',
    plan: SNAPSHOT.plan,
    baseline_report: SNAPSHOT,
    last_attempted_at: lastAttemptedAt,
    last_checked_at: null,
    check_claimed_at: activeClaimToken ? CREATED_AT : null,
    check_claim_token: activeClaimToken,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  });
  const query = jest.fn(async (sql, params) => {
    if (sql.includes('SET last_attempted_at = $3')) {
      lastAttemptedAt = new Date(params[2]);
      activeClaimToken = params[4];
      return { rows: [{ id: WATCH_ID }] };
    }
    if (sql.includes('SET check_claimed_at = NULL, check_claim_token = NULL')) {
      if (activeClaimToken === params[2]) activeClaimToken = null;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM objective_watches')) return { rows: [row()] };
    return { rows: [] };
  });
  const checker = { run: jest.fn().mockRejectedValue(new Error('scheduler settings unavailable')) };
  const response = await request(makeApp({ query, checker, now: () => CREATED_AT.getTime() }))
    .post(`/api/account/objective-watches/${WATCH_ID}/refresh`)
    .set('Cookie', 'bc_session=test-session');

  expect(response.status).toBe(500);
  expect(activeClaimToken).toBeNull();
  expect(lastAttemptedAt.toISOString()).toBe(CREATED_AT.toISOString());
  const releaseCall = query.mock.calls.find(([sql]) => sql.includes('SET check_claimed_at = NULL'));
  expect(releaseCall[0]).not.toContain('last_attempted_at');
  expect(releaseCall[1]).toEqual([WATCH_ID, USER_ID, expect.any(String)]);
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

test('includes the latest check without exposing internal errors or private check fields', async () => {
  const query = jest.fn().mockResolvedValue({ rows: [{
    id: WATCH_ID, title: 'Mount Rainier', plan: SNAPSHOT.plan,
    created_at: CREATED_AT, updated_at: CREATED_AT,
    latest_check: { id: 42, check_type: 'automatic', status: 'failed',
      summary: null, change: null, error: 'private upstream token and endpoint',
      checked_at: CREATED_AT, watch_id: WATCH_ID },
  }, { id: 'no-check', title: 'Mount Baker', plan: SNAPSHOT.plan,
    created_at: CREATED_AT, updated_at: CREATED_AT, latest_check: null }] });
  const response = await request(makeApp({ query, tierKey: 'premium' }))
    .get('/api/account/objective-watches');
  expect(response.status).toBe(200);
  expect(response.body.watches[0].latestCheck).toEqual({
    id: '42', checkType: 'automatic', status: 'failed', summary: null, change: null,
    error: 'Conditions data was unavailable for this check.', checkedAt: CREATED_AT.toISOString(),
  });
  expect(response.body.watches[1].latestCheck).toBeNull();
  expect(query.mock.calls[0][1]).toEqual([USER_ID, 90]);
});
