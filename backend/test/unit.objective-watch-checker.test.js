const {
  OBJECTIVE_WATCH_CLAIM_LEASE_MS,
  advanceReferenceSignals,
  buildMeaningfulChange,
  buildSignalChange,
  calculateNextCheckAt,
  createObjectiveWatchChecker,
  extractWatchSignals,
  normalizeWatchChange,
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
  localConditions: { closures: { available: true, alerts: closures } },
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

test('detects material condition improvements', () => {
  const previous = {
    ...safetyPayload({
      score: 50,
      danger: 4,
      gust: 45,
      precip: 80,
      closures: [{ title: 'Road closed' }],
      alerts: [{ event: 'Winter Storm Warning', severity: 'Severe' }],
    }),
    terrainCondition: { impact: 'high' },
  };
  const current = safetyPayload({ score: 75, danger: 2, gust: 20, precip: 30 });
  const change = buildMeaningfulChange(previous, current, new Date('2026-07-14T00:00:00.000Z'));

  expect(change.reasons.map((reason) => reason.key)).toEqual(expect.arrayContaining([
    'score_improvement',
    'risk_tier_improvement',
    'avalanche_danger_improvement',
    'closure_lifted',
    'weather_alert_cleared',
    'wind_gust_improvement',
    'precipitation_improvement',
    'terrain_condition_improvement',
  ]));
  expect(change.reasons.map((reason) => reason.label).join(' ')).toMatch(/improved|decreased|cleared/i);
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

test.each([
  ['2026-07-26T06:59:59Z', 'America/Los_Angeles', 200, null, 1, 0, 0],
  ['2026-07-26T07:00:00Z', 'America/Los_Angeles', 200, null, 0, 1, 0],
  ['2026-07-25T15:00:00Z', 'Asia/Tokyo', 200, null, 0, 1, 0],
  ['2026-07-26T07:50:00Z', null, 400, '2026-07-26', 1, 1, 0],
  ['2026-07-26T07:50:00Z', 'invalid-zone', 400, '2026-07-26', 1, 1, 0],
  ['2026-07-26T07:50:00Z', null, 503, '2026-07-26', 1, 0, 1],
  ['2026-07-26T07:50:00Z', null, 400, null, 1, 0, 1],
  ['2026-07-25T20:00:00Z', null, 400, '2026-07-26', 1, 0, 1],
  ['2026-07-24T20:00:00Z', null, 400, '2026-07-24', 1, 0, 1],
])('handles watch expiry at %s in %s with response %s/%s', async (at, timezone, statusCode, start, calls, completed, failed) => {
  const row = {
    id: 'watch-1', title: 'Mineral King',
    plan: { ...PLAN, forecastDate: '2026-07-25' },
    baseline_report: { safetyData: { ...safetyPayload(), weather: { timezone } } },
    tier_key: 'premium', consecutive_failures: 0,
  };
  const query = jest.fn(async (sql) => ({
    rows: sql.includes('FROM objective_watches watches') ? [row] : [],
  }));
  const invokeSafetyHandler = jest.fn().mockResolvedValue({
    statusCode,
    payload: statusCode === 200 ? safetyPayload() : {
      error: 'Requested forecast date is outside NOAA forecast range', availableRange: { start },
    },
  });
  const checker = createObjectiveWatchChecker({
    database: { configured: true, query }, invokeSafetyHandler,
    log: { warn: jest.fn() }, now: () => new Date(at),
  });
  expect(await checker.run()).toMatchObject({ failed, completed });
  expect(invokeSafetyHandler).toHaveBeenCalledTimes(calls);
  expect(query.mock.calls.filter(([sql]) => sql.includes('SET consecutive_failures'))).toHaveLength(failed);
  if (completed) {
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO objective_watch_checks'))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.includes('last_snapshot ='))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.includes('check_claim_token = NULL'))).toBe(true);
  }
});

describe('change direction and missing sources', () => {
  const at = new Date('2026-07-14T00:00:00.000Z');
  const keys = (change) => change?.reasons.map((reason) => reason.key) || [];

  test('tags every reason and the change with a direction, listing risk increases first', () => {
    const worse = buildMeaningfulChange(safetyPayload(), safetyPayload({ score: 55 }), at);
    expect(worse.direction).toBe('worse');
    expect(worse.reasons.every((reason) => reason.direction === 'worse')).toBe(true);

    const better = buildMeaningfulChange(safetyPayload({ score: 55 }), safetyPayload({ score: 80 }), at);
    expect(better.direction).toBe('better');
    expect(better.reasons.every((reason) => reason.direction === 'better')).toBe(true);

    const mixed = buildMeaningfulChange(
      safetyPayload({ gust: 45 }),
      safetyPayload({ gust: 15, alerts: [{ event: 'Winter Storm Warning', severity: 'Severe' }] }),
      at,
    );
    expect(mixed.direction).toBe('mixed');
    expect(keys(mixed)).toEqual(['new_weather_alert', 'wind_gust_improvement']);
  });

  test('labels readings with their units and avalanche danger with its name', () => {
    const change = buildMeaningfulChange(
      safetyPayload(),
      safetyPayload({ danger: 3, gust: 40, alerts: [{ event: 'Winter Storm Warning', severity: 'Severe' }] }),
      at,
    );
    const labels = change.reasons.map((reason) => reason.label);
    expect(labels).toContain('Peak gusts increased from 15 mph to 40 mph.');
    expect(labels).toContain('Avalanche danger increased from Low (1) to Considerable (3).');
    expect(labels).toContain('New weather alert: Winter Storm Warning (Severe).');
  });

  test('never reads an unavailable source as a cleared alert, lifted closure or lower danger', () => {
    const previous = safetyPayload({
      danger: 3,
      closures: [{ title: 'Road closed' }],
      alerts: [{ event: 'Winter Storm Warning', severity: 'Severe' }],
    });
    const outage = {
      ...safetyPayload(),
      avalanche: { dangerLevel: 0, dangerUnknown: true, coverageStatus: 'temporarily_unavailable' },
      alerts: { status: 'unavailable', alerts: [] },
      localConditions: { closures: { available: false } },
    };
    expect(buildMeaningfulChange(previous, outage, at)).toBeNull();
    expect(extractWatchSignals(outage)).toMatchObject({ avalancheDanger: null, alertKeys: null, closureTitles: null });

    // A center's "no rating" is not a lower danger either.
    expect(buildMeaningfulChange(previous, { ...previous, avalanche: { dangerLevel: 0 } }, at)).toBeNull();
    // Answered feeds with nothing active do clear what was there.
    const answered = {
      ...previous,
      alerts: { status: 'none', alerts: [] },
      localConditions: { closures: { available: true, alerts: [] } },
    };
    expect(keys(buildMeaningfulChange(previous, answered, at))).toEqual(['closure_lifted', 'weather_alert_cleared']);
  });

  test('does not call a reading that was unknown before an increase', () => {
    const unknown = { ...safetyPayload(), safety: { score: 80 }, terrainCondition: {} };
    const known = { ...safetyPayload(), terrainCondition: { impact: 'high' } };
    expect(buildMeaningfulChange(unknown, known, at)).toBeNull();
  });

  test('requires gust and precipitation threshold crossings to clear a margin', () => {
    expect(buildMeaningfulChange(safetyPayload({ gust: 33 }), safetyPayload({ gust: 36 }), at)).toBeNull();
    expect(keys(buildMeaningfulChange(safetyPayload({ gust: 30 }), safetyPayload({ gust: 36 }), at))).toEqual(['wind_gust']);
    expect(buildMeaningfulChange(safetyPayload({ gust: 36 }), safetyPayload({ gust: 34 }), at)).toBeNull();
    expect(buildMeaningfulChange(safetyPayload({ precip: 55 }), safetyPayload({ precip: 62 }), at)).toBeNull();
    expect(keys(buildMeaningfulChange(safetyPayload({ precip: 50 }), safetyPayload({ precip: 62 }), at))).toEqual(['precipitation']);
  });

  test('advances only reported signals and fills signals the reference lacked', () => {
    const reference = { ...extractWatchSignals(safetyPayload({ score: 80, gust: 20 })), alertKeys: null };
    const current = extractWatchSignals(safetyPayload({ score: 66, gust: 28 }));
    const change = buildSignalChange(reference, current, at);
    expect(keys(change)).toEqual(['score_drop']);
    const next = advanceReferenceSignals(reference, current, change.reasons);
    expect(next).toMatchObject({ score: 66, tier: 'Low', maxWindGust: 20, alertKeys: [] });
    expect(next).not.toHaveProperty('partial');
  });

  test('infers the direction of changes stored before directions were recorded', () => {
    expect(normalizeWatchChange({ reasons: [{ key: 'score_improvement', label: 'Better.' }] })).toMatchObject({
      direction: 'better',
      reasons: [{ key: 'score_improvement', direction: 'better' }],
    });
    expect(normalizeWatchChange({ reasons: [{ key: 'wind_gust' }, { key: 'closure_lifted' }] }).direction).toBe('mixed');
    expect(normalizeWatchChange(null)).toBeNull();
  });
});

describe('reference signals across checks', () => {
  const premiumRow = (overrides = {}) => ({
    id: 'watch-1',
    user_id: '8c696be4-e175-4b6a-965b-82bdf3758e0c',
    title: 'Mount Rainier',
    plan: PLAN,
    baseline_report: { safetyData: safetyPayload({ score: 80 }) },
    last_snapshot: null,
    reference_signals: null,
    consecutive_failures: 0,
    notifications_enabled: true,
    email: 'climber@example.com',
    email_verified_at: new Date(),
    tier_key: 'premium',
    ...overrides,
  });
  const createHarness = (row) => {
    const state = { reference: row.reference_signals, snapshot: row.last_snapshot };
    const query = jest.fn(async (sql, params) => {
      if (sql.includes('WITH candidate_watches AS')) {
        return { rows: [{ ...row, reference_signals: state.reference, last_snapshot: state.snapshot }] };
      }
      if (sql.includes('last_checked_at = $2')) {
        if (params[6]) state.reference = JSON.parse(params[6]);
        if (params[3]) state.snapshot = JSON.parse(params[3]);
        return { rows: [{ id: row.id }], rowCount: 1 };
      }
      return { rows: [] };
    });
    let payload = null;
    const checker = createObjectiveWatchChecker({
      database: { configured: true, query },
      invokeSafetyHandler: jest.fn(async () => ({ statusCode: 200, payload })),
      emailService: { available: false },
      log: { warn: jest.fn() },
      now: () => new Date('2026-07-14T00:00:00.000Z'),
    });
    return {
      state,
      query,
      check: async (next) => {
        payload = next;
        query.mockClear();
        return checker.run();
      },
      events: () => query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO objective_watch_events')),
    };
  };

  test('reports gradual drift that no single check crosses', async () => {
    const harness = createHarness(premiumRow());
    expect(await harness.check(safetyPayload({ score: 74 }))).toMatchObject({ checked: 1, changed: 0 });
    expect(harness.state.reference.score).toBe(80);
    expect(await harness.check(safetyPayload({ score: 69 }))).toMatchObject({ checked: 1, changed: 1 });
    const change = JSON.parse(harness.events()[0][1][2]);
    expect(change.reasons.map((reason) => reason.label)).toContain('Conditions score dropped from 80 to 69.');
    expect(harness.state.reference.score).toBe(69);
    expect(await harness.check(safetyPayload({ score: 66 }))).toMatchObject({ changed: 0 });
  });

  test('compares with the latest snapshot when a watch has no stored reference', async () => {
    const harness = createHarness(premiumRow({ last_snapshot: safetyPayload({ score: 70 }) }));
    expect(await harness.check(safetyPayload({ score: 65 }))).toMatchObject({ changed: 0 });
    expect(harness.state.reference.score).toBe(70);
  });

  test('fills a source that was unavailable in the baseline from the first check that has it', async () => {
    const baseline = { ...safetyPayload(), alerts: { status: 'unavailable', alerts: [] } };
    const harness = createHarness(premiumRow({ baseline_report: { safetyData: baseline } }));
    expect(await harness.check({ ...safetyPayload(), alerts: { status: 'none', alerts: [] } })).toMatchObject({ changed: 0 });
    expect(harness.state.reference.alertKeys).toEqual([]);
    const warning = safetyPayload({ alerts: [{ event: 'Winter Storm Warning', severity: 'Severe' }] });
    expect(await harness.check(warning)).toMatchObject({ changed: 1 });
  });

  test('keeps the reference when a check returns partial data', async () => {
    const harness = createHarness(premiumRow({ reference_signals: extractWatchSignals(safetyPayload({ score: 80 })) }));
    expect(await harness.check({ ...safetyPayload({ score: 40 }), partialData: true })).toMatchObject({ checked: 1, changed: 0 });
    const update = harness.query.mock.calls.find(([sql]) => sql.includes('last_checked_at = $2'));
    expect(update[0]).toContain('reference_signals = COALESCE($7::jsonb, reference_signals)');
    expect(update[1][6]).toBeNull();
    expect(harness.state.reference.score).toBe(80);
  });

  test('queues email for risk increases but keeps improvements in the app', async () => {
    const worse = createHarness(premiumRow());
    await worse.check(safetyPayload({ score: 55 }));
    expect(worse.events()[0][1][3]).toBe('pending');

    const better = createHarness(premiumRow({ baseline_report: { safetyData: safetyPayload({ score: 55 }) } }));
    await better.check(safetyPayload({ score: 80 }));
    expect(better.events()).toHaveLength(1);
    expect(better.events()[0][1][3]).toBe('not_requested');
  });
});

test('delivers risk-increase emails with the plan and skips queued improvement-only events', async () => {
  const worseChange = { reasons: [{ key: 'wind_gust', label: 'Peak gusts increased from 20 mph to 40 mph.' }] };
  const betterChange = { reasons: [{ key: 'score_improvement', label: 'Conditions score improved from 55 to 80.' }] };
  const query = jest.fn(async (sql) => {
    if (sql.includes('FROM objective_watch_events events')) {
      return { rows: [
        { id: 1, change_key: 'a', change: betterChange, watch_id: 'watch-1', title: 'Mount Rainier', plan: PLAN, email: 'climber@example.com' },
        { id: 2, change_key: 'b', change: worseChange, watch_id: 'watch-1', title: 'Mount Rainier', plan: PLAN, email: 'climber@example.com' },
      ] };
    }
    return { rows: [] };
  });
  const sendObjectiveWatchChangeEmail = jest.fn().mockResolvedValue({});
  const checker = createObjectiveWatchChecker({
    database: { configured: true, query },
    invokeSafetyHandler: jest.fn(),
    emailService: { available: true, sendObjectiveWatchChangeEmail },
  });

  expect(await checker.deliverPendingNotifications()).toBe(1);
  expect(sendObjectiveWatchChangeEmail).toHaveBeenCalledTimes(1);
  expect(sendObjectiveWatchChangeEmail.mock.calls[0][0]).toMatchObject({
    eventId: '2',
    plan: PLAN,
    change: { direction: 'worse', reasons: [{ key: 'wind_gust', direction: 'worse' }] },
  });
  const skipped = query.mock.calls.find(([sql]) => sql.includes("SET notification_status = 'not_requested'"));
  expect(skipped[1]).toEqual([1]);
});

describe('watched routes', () => {
  const routeReport = {
    safetyData: safetyPayload(),
    route: {
      routeAnalysis: {
        waypoints: [
          { name: 'Trailhead', lat: 46.78, lon: -121.74, offset_minutes: 0 },
          { name: 'Camp Muir', lat: 46.83, lon: -121.73, offset_minutes: 300 },
          { name: 'Return to Trailhead', lat: 46.78, lon: -121.74, offset_minutes: 600, leg: 'return' },
        ],
      },
    },
  };
  const createRouteHarness = (baseline = routeReport) => {
    const state = { reference: null };
    const row = {
      id: 'watch-route', user_id: '8c696be4-e175-4b6a-965b-82bdf3758e0c', title: 'Rainier via Muir', plan: PLAN,
      baseline_report: baseline, last_snapshot: null, consecutive_failures: 0, notifications_enabled: false, tier_key: 'premium',
    };
    const query = jest.fn(async (sql, params) => {
      if (sql.includes('WITH candidate_watches AS')) return { rows: [{ ...row, reference_signals: state.reference }] };
      if (sql.includes('last_checked_at = $2')) {
        if (params[6]) state.reference = JSON.parse(params[6]);
        return { rows: [{ id: row.id }], rowCount: 1 };
      }
      return { rows: [] };
    });
    let routeGust = 20;
    let routeAlerts = [];
    let routeFails = false;
    const calls = [];
    const invokeSafetyHandler = jest.fn(async (queryParams) => {
      calls.push(queryParams);
      if (String(queryParams.name).startsWith('Route checkpoint')) {
        if (routeFails) return { statusCode: 503, payload: { error: 'down' } };
        return { statusCode: 200, payload: safetyPayload({ gust: queryParams.start === '11:00' ? routeGust : 10, alerts: routeAlerts }) };
      }
      return { statusCode: 200, payload: safetyPayload() };
    });
    const checker = createObjectiveWatchChecker({
      database: { configured: true, query }, invokeSafetyHandler, emailService: { available: false },
      log: { warn: jest.fn() }, now: () => new Date('2026-07-14T00:00:00.000Z'),
    });
    return {
      state, calls,
      set: (next) => { ({ routeGust = routeGust, routeAlerts = routeAlerts, routeFails = routeFails } = next); },
      check: async () => { query.mockClear(); calls.length = 0; return { summary: await checker.run(), query }; },
      changes: (q) => q.mock.calls.filter(([sql]) => sql.includes('INSERT INTO objective_watch_events')).map((call) => JSON.parse(call[1][2])),
    };
  };

  test('re-checks the saved route at each checkpoint\'s arrival on the plan and reports worse gusts and new alerts along it', async () => {
    const harness = createRouteHarness();
    const first = await harness.check();
    expect(first.summary).toMatchObject({ checked: 1, changed: 0 });
    // Arrivals re-timed from the plan's 06:00 start: +0, +5 h, +10 h.
    expect(harness.calls.filter((call) => call.name.startsWith('Route')).map((call) => [call.date, call.start, call.travel_window_hours]))
      .toEqual([['2026-07-17', '06:00', '1'], ['2026-07-17', '11:00', '1'], ['2026-07-17', '16:00', '1']]);
    expect(harness.state.reference).toMatchObject({ routeMaxWindGust: 20, routeAlertKeys: [] });

    harness.set({ routeGust: 42, routeAlerts: [{ event: 'Wind Advisory', severity: 'Moderate' }] });
    const second = await harness.check();
    expect(second.summary).toMatchObject({ changed: 1 });
    const [change] = harness.changes(second.query);
    expect(change.direction).toBe('worse');
    expect(change.reasons.map((reason) => reason.label)).toEqual([
      'New weather alert along the route: Wind Advisory (Moderate).',
      'Along the route, peak gusts increased from 20 mph to 42 mph.',
    ]);
  });

  test('a route checkpoint that fails leaves the route unknown instead of calm', async () => {
    const harness = createRouteHarness();
    await harness.check();
    harness.set({ routeFails: true, routeGust: 60 });
    const result = await harness.check();
    expect(result.summary).toMatchObject({ checked: 1, changed: 0 });
    expect(harness.state.reference.routeMaxWindGust).toBe(20);
  });

  test('a watch without a route analysis checks only the objective', async () => {
    const harness = createRouteHarness({ safetyData: safetyPayload() });
    await harness.check();
    expect(harness.calls).toHaveLength(1);
    expect(harness.state.reference.routeMaxWindGust).toBeNull();
  });

  test('a long route is sampled evenly and keeps its final arrival', () => {
    const { readWatchRoute } = require('../src/services/objective-watch-checker');
    const waypoints = Array.from({ length: 13 }, (_, i) => ({ name: `P${i}`, lat: 46 + i * 0.01, lon: -121, offset_minutes: i * 30 }));
    const points = readWatchRoute({ baseline_report: { route: { routeAnalysis: { waypoints } } } });
    expect(points).toHaveLength(10);
    expect(points[0].name).toBe('P0');
    expect(points.at(-1).name).toBe('P12');
    expect(points.map((point) => point.offsetMinutes)).toEqual([...points.map((point) => point.offsetMinutes)].sort((a, b) => a - b));
  });
});
