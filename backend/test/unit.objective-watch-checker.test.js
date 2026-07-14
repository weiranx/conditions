const {
  buildMeaningfulChange,
  calculateNextCheckAt,
  createObjectiveWatchChecker,
  extractWatchSignals,
} = require('../src/services/objective-watch-checker');

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

test('uses three-hour checks normally, hourly checks inside 48 hours, and stops expired plans', () => {
  expect(calculateNextCheckAt(PLAN, new Date('2026-07-14T00:00:00.000Z')).toISOString()).toBe('2026-07-14T03:00:00.000Z');
  expect(calculateNextCheckAt(PLAN, new Date('2026-07-14T00:00:00.000Z'), 360).toISOString()).toBe('2026-07-14T06:00:00.000Z');
  expect(calculateNextCheckAt(PLAN, new Date('2026-07-16T00:00:00.000Z')).toISOString()).toBe('2026-07-16T01:00:00.000Z');
  expect(calculateNextCheckAt(PLAN, new Date('2026-07-16T00:00:00.000Z'), 360).toISOString()).toBe('2026-07-16T01:00:00.000Z');
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
  expect(query.mock.calls.filter(([sql]) => sql.includes('SET last_checked_at'))).toHaveLength(2);
  expect(query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO objective_watch_events'))).toHaveLength(2);
  const checkCalls = query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO objective_watch_checks'));
  expect(checkCalls).toHaveLength(2);
  expect(checkCalls[0][1].slice(1, 3)).toEqual(['automatic', 'changed']);
  const dueCall = query.mock.calls.find(([sql]) => sql.includes('COALESCE(account_tier.tier_key'));
  expect(dueCall[0]).toContain("COALESCE(account_tier.tier_key, 'free') = 'premium'");
  expect(dueCall[1]).toEqual([100, null, null]);
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
  expect(dueCall[1]).toEqual([
    100,
    '510b78d9-dae0-42aa-bad3-6be54a49625c',
    '8c696be4-e175-4b6a-965b-82bdf3758e0c',
  ]);
  const updateCall = query.mock.calls.find(([sql]) => sql.includes('SET last_checked_at'));
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
  const checkCall = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO objective_watch_checks'));
  expect(checkCall[1]).toEqual(['watch-1', 'automatic', 'Provider timed out', '2026-07-14T00:00:00.000Z']);
});
