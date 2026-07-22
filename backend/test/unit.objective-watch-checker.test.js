const {
  OBJECTIVE_WATCH_CLAIM_LEASE_MS,
  buildMeaningfulChange,
  calculateNextCheckAt,
  createObjectiveWatchChecker,
  extractWatchSignals,
} = require('../src/services/objective-watch-checker');
const fs = require('fs');
const path = require('path');

const PLAN = {
  lat: 46.8523,
  lon: -121.7603,
  forecastDate: '2026-07-17',
  alpineStartTime: '06:00',
  travelWindowHours: 12,
};

const safetyPayload = ({ score = 80, danger = 1, gust = 15, precip = 20, closures = [], alerts = [] } = {}) => ({
  generatedAt: '2026-07-14T00:00:00.000Z',
  weather: { windGust: gust, precipChance: precip, trend: [] },
  avalanche: { dangerLevel: danger },
  alerts: { alerts },
  terrainCondition: { impact: 'low' },
  localConditions: { closures: { alerts: closures } },
  safety: { score, tier: score < 60 ? 'High' : 'Low' },
});

test('attempt migration backfills successful and failed check history and adds lease state', () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, '../migrations/016_objective_watch_attempts.sql'),
    'utf8',
  );
  expect(migration).toContain('GREATEST(');
  expect(migration).toContain('SELECT MAX(checks.checked_at)');
  expect(migration).toContain('FROM objective_watch_checks checks');
  expect(migration).toContain('check_claimed_at TIMESTAMPTZ');
  expect(migration).toContain('check_claim_token UUID');
});

test('uses the configured cadence, caps slower cadences at hourly inside 48 hours, and stops expired plans', () => {
  expect(calculateNextCheckAt(PLAN, new Date('2026-07-14T00:00:00.000Z')).toISOString()).toBe('2026-07-14T03:00:00.000Z');
  expect(calculateNextCheckAt(PLAN, new Date('2026-07-14T00:00:00.000Z'), 360).toISOString()).toBe('2026-07-14T06:00:00.000Z');
  expect(calculateNextCheckAt(PLAN, new Date('2026-07-16T00:00:00.000Z')).toISOString()).toBe('2026-07-16T01:00:00.000Z');
  expect(calculateNextCheckAt(PLAN, new Date('2026-07-16T00:00:00.000Z'), 360).toISOString()).toBe('2026-07-16T01:00:00.000Z');
  expect(calculateNextCheckAt(PLAN, new Date('2026-07-14T00:00:00.000Z'), 30).toISOString()).toBe('2026-07-14T00:30:00.000Z');
  expect(calculateNextCheckAt(PLAN, new Date('2026-07-16T00:00:00.000Z'), 30).toISOString()).toBe('2026-07-16T00:30:00.000Z');
  expect(calculateNextCheckAt(PLAN, new Date('2026-07-18T15:00:00.000Z'))).toBeNull();
});

test('detects material risk increases but ignores small score movement', () => {
  const previous = safetyPayload();
  const current = safetyPayload({ score: 55, danger: 3, gust: 40, precip: 80, closures: [{ title: 'Road closed' }] });
  const change = buildMeaningfulChange(previous, current, new Date('2026-07-14T00:00:00.000Z'));
  expect(change.reasons.map((reason) => reason.key)).toEqual(expect.arrayContaining([
    'score_drop',
    'risk_tier',
    'avalanche_danger',
    'new_closure',
    'wind_gust',
    'precipitation',
  ]));
  expect(buildMeaningfulChange(previous, safetyPayload({ score: 75 }), new Date())).toBeNull();
  expect(extractWatchSignals({})).toMatchObject({ score: null, avalancheDanger: null, maxWindGust: null });
});

test('deduplicates identical plans while updating every due watch', async () => {
  const dueRows = [
    {
      id: 'watch-1',
      title: 'Mount Rainier',
      plan: PLAN,
      baseline_report: { safetyData: safetyPayload() },
      last_snapshot: null,
      consecutive_failures: 0,
      notifications_enabled: false,
      tier_key: 'premium',
    },
    {
      id: 'watch-2',
      title: 'Mount Rainier duplicate',
      plan: PLAN,
      baseline_report: { safetyData: safetyPayload() },
      last_snapshot: null,
      consecutive_failures: 0,
      notifications_enabled: false,
      tier_key: 'premium',
    },
  ];
  const query = jest.fn(async (sql) => {
    if (sql.includes('FROM objective_watches watches')) return { rows: dueRows };
    return { rows: [] };
  });
  const invokeSafetyHandler = jest.fn().mockResolvedValue({
    statusCode: 200,
    payload: safetyPayload({ score: 55 }),
  });
  const checker = createObjectiveWatchChecker({
    database: { configured: true, query },
    invokeSafetyHandler,
    emailService: { available: false },
    log: { warn: jest.fn() },
    now: () => new Date('2026-07-14T00:00:00.000Z'),
  });

  const summary = await checker.run();
  expect(invokeSafetyHandler).toHaveBeenCalledTimes(1);
  expect(summary).toMatchObject({ due: 2, checked: 2, changed: 2, failed: 0, uniquePlans: 1 });
  expect(query.mock.calls.filter(([sql]) => sql.includes('last_checked_at = $2'))).toHaveLength(2);
  expect(query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO objective_watch_events'))).toHaveLength(2);
  const checkCalls = query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO objective_watch_checks'));
  expect(checkCalls).toHaveLength(2);
  expect(checkCalls[0][1].slice(1, 3)).toEqual(['automatic', 'changed']);
  const expiryCall = query.mock.calls.find(([sql]) => sql.includes('SET next_check_at = NULL'));
  expect(expiryCall[0]).toContain("TO_CHAR((NOW() - INTERVAL '14 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD')");
  expect(expiryCall[0]).not.toContain("(plan->>'forecastDate')::date");
  const dueCall = query.mock.calls.find(([sql]) => sql.includes('COALESCE(account_tier.tier_key'));
  expect(dueCall[0]).toContain("COALESCE(account_tier.tier_key, 'free') = 'premium'");
  expect(dueCall[0]).toContain("TO_CHAR((NOW() - INTERVAL '14 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD')");
  expect(dueCall[0]).not.toContain("(watches.plan->>'forecastDate')::date");
  expect(dueCall[1].slice(0, 3)).toEqual([100, null, null]);
  expect(dueCall[1][3]).toEqual(expect.any(String));
  expect(dueCall[1][7]).toBe(false);
});

test('manual Free refreshes update in-app state without scheduling or email', async () => {
  const dueRows = [{
    id: 'watch-1',
    user_id: '8c696be4-e175-4b6a-965b-82bdf3758e0c',
    title: 'Mount Rainier',
    plan: PLAN,
    baseline_report: { safetyData: safetyPayload() },
    last_snapshot: null,
    consecutive_failures: 0,
    notifications_enabled: true,
    email: 'climber@example.com',
    email_verified_at: new Date(),
    tier_key: 'free',
  }];
  const query = jest.fn(async (sql) => {
    if (sql.includes('FROM objective_watches watches')) return { rows: dueRows };
    return { rows: [] };
  });
  const invokeSafetyHandler = jest.fn().mockResolvedValue({
    statusCode: 200,
    payload: safetyPayload({ score: 55 }),
  });
  const checker = createObjectiveWatchChecker({
    database: { configured: true, query },
    invokeSafetyHandler,
    emailService: { available: false },
    now: () => new Date('2026-07-14T00:00:00.000Z'),
  });

  const summary = await checker.run({
    watchId: '510b78d9-dae0-42aa-bad3-6be54a49625c',
    userId: '8c696be4-e175-4b6a-965b-82bdf3758e0c',
    manual: true,
  });
  expect(summary).toMatchObject({ checked: 1, changed: 1, failed: 0 });
  const dueCall = query.mock.calls.find(([sql]) => sql.includes('FROM objective_watches watches'));
  expect(dueCall[1].slice(0, 3)).toEqual([
    100,
    '510b78d9-dae0-42aa-bad3-6be54a49625c',
    '8c696be4-e175-4b6a-965b-82bdf3758e0c',
  ]);
  const updateCall = query.mock.calls.find(([sql]) => sql.includes('last_checked_at = $2'));
  expect(updateCall[0]).toContain('last_attempted_at = $2');
  expect(updateCall[1][2]).toBeNull();
  const eventCall = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO objective_watch_events'));
  expect(eventCall[1][3]).toBe('not_requested');
  const checkCall = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO objective_watch_checks'));
  expect(checkCall[1].slice(1, 3)).toEqual(['manual', 'changed']);
});

test.each([
  ['unchanged', safetyPayload({ score: 75 })],
  ['partial', { ...safetyPayload({ score: 55 }), partialData: true }],
])('records a %s check even when no change event is created', async (expectedStatus, payload) => {
  const dueRows = [{
    id: 'watch-1',
    title: 'Mount Rainier',
    plan: PLAN,
    baseline_report: { safetyData: safetyPayload() },
    last_snapshot: null,
    consecutive_failures: 0,
    notifications_enabled: false,
    tier_key: 'premium',
  }];
  const query = jest.fn(async (sql) => {
    if (sql.includes('FROM objective_watches watches')) return { rows: dueRows };
    return { rows: [] };
  });
  const checker = createObjectiveWatchChecker({
    database: { configured: true, query },
    invokeSafetyHandler: jest.fn().mockResolvedValue({ statusCode: 200, payload }),
    emailService: { available: false },
    now: () => new Date('2026-07-14T00:00:00.000Z'),
  });

  const summary = await checker.run();
  expect(summary).toMatchObject({ checked: 1, changed: 0, failed: 0 });
  expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO objective_watch_events'))).toBe(false);
  const checkCall = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO objective_watch_checks'));
  expect(checkCall[1].slice(1, 3)).toEqual(['automatic', expectedStatus]);
});

test('records failed automatic checks with their retry attempt', async () => {
  const dueRows = [{
    id: 'watch-1',
    title: 'Mount Rainier',
    plan: PLAN,
    baseline_report: { safetyData: safetyPayload() },
    last_snapshot: null,
    consecutive_failures: 0,
    notifications_enabled: false,
    tier_key: 'premium',
  }];
  const query = jest.fn(async (sql) => {
    if (sql.includes('FROM objective_watches watches')) return { rows: dueRows };
    return { rows: [] };
  });
  const checker = createObjectiveWatchChecker({
    database: { configured: true, query },
    invokeSafetyHandler: jest.fn().mockRejectedValue(new Error('Provider timed out')),
    emailService: { available: false },
    log: { warn: jest.fn() },
    now: () => new Date('2026-07-14T00:00:00.000Z'),
  });

  const summary = await checker.run();
  expect(summary).toMatchObject({ checked: 0, changed: 0, failed: 1 });
  const failureCall = query.mock.calls.find(([sql]) => sql.includes('SET consecutive_failures'));
  expect(failureCall[0]).toContain('last_attempted_at = $4');
  expect(failureCall[0]).not.toContain('last_checked_at');
  expect(failureCall[1]).toEqual([
    'watch-1',
    1,
    '2026-07-14T01:00:00.000Z',
    '2026-07-14T00:00:00.000Z',
    expect.any(String),
  ]);
  const checkCall = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO objective_watch_checks'));
  expect(checkCall[1]).toEqual(['watch-1', 'automatic', 'Provider timed out', '2026-07-14T00:00:00.000Z']);
});

test('serializes a route-owned manual claim against an automatic scheduler check', async () => {
  const manualClaimToken = '510b78d9-dae0-42aa-bad3-6be54a49625c';
  const automaticClaimToken = '8ed9f6ea-a737-4cd1-bc02-3b3561591592';
  let activeClaimToken = manualClaimToken;
  const dueRow = {
    id: 'watch-1',
    user_id: '8c696be4-e175-4b6a-965b-82bdf3758e0c',
    title: 'Mount Rainier',
    plan: PLAN,
    baseline_report: { safetyData: safetyPayload() },
    last_snapshot: null,
    consecutive_failures: 0,
    notifications_enabled: false,
    tier_key: 'premium',
  };
  const query = jest.fn(async (sql, params) => {
    if (sql.includes('WITH candidate_watches AS')) {
      const requestedToken = params[3];
      const usesExistingClaim = params[7];
      if (usesExistingClaim && activeClaimToken === requestedToken) return { rows: [dueRow] };
      if (!usesExistingClaim && activeClaimToken === null) {
        activeClaimToken = requestedToken;
        return { rows: [dueRow] };
      }
      return { rows: [] };
    }
    if (sql.includes('last_checked_at = $2')) {
      if (activeClaimToken !== params[5]) return { rows: [], rowCount: 0 };
      activeClaimToken = null;
      return { rows: [{ id: 'watch-1' }], rowCount: 1 };
    }
    return { rows: [] };
  });
  let signalStarted;
  let releaseCheck;
  const checkStarted = new Promise((resolve) => { signalStarted = resolve; });
  const pendingPayload = new Promise((resolve) => { releaseCheck = resolve; });
  const invokeSafetyHandler = jest.fn(() => {
    signalStarted();
    return pendingPayload;
  });
  const tokens = [automaticClaimToken];
  const checker = createObjectiveWatchChecker({
    database: { configured: true, query },
    invokeSafetyHandler,
    emailService: { available: false },
    log: { warn: jest.fn() },
    now: () => new Date('2026-07-14T00:00:00.000Z'),
    createClaimToken: () => tokens.shift(),
  });

  const manualRun = checker.run({
    watchId: 'watch-1',
    userId: dueRow.user_id,
    manual: true,
    claimToken: manualClaimToken,
  });
  await checkStarted;
  const automaticSummary = await checker.run();
  releaseCheck({ statusCode: 200, payload: safetyPayload({ score: 55 }) });
  const manualSummary = await manualRun;

  expect(manualSummary).toMatchObject({ due: 1, checked: 1 });
  expect(automaticSummary).toMatchObject({ due: 0, checked: 0 });
  expect(invokeSafetyHandler).toHaveBeenCalledTimes(1);
  const claimCalls = query.mock.calls.filter(([sql]) => sql.includes('WITH candidate_watches AS'));
  expect(claimCalls).toHaveLength(2);
  expect(claimCalls[0][0]).toContain('FOR UPDATE OF watches SKIP LOCKED');
  expect(claimCalls[1][0]).toContain('COALESCE(watches.last_attempted_at, watches.last_checked_at) <= $7::timestamptz');
  expect(OBJECTIVE_WATCH_CLAIM_LEASE_MS).toBeGreaterThan(0);
});
