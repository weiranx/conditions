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
  expect(calculateNextCheckAt(PLAN, new Date('2026-07-16T00:00:00.000Z')).toISOString()).toBe('2026-07-16T01:00:00.000Z');
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
    },
    {
      id: 'watch-2',
      title: 'Mount Rainier duplicate',
      plan: PLAN,
      baseline_report: { safetyData: safetyPayload() },
      last_snapshot: null,
      consecutive_failures: 0,
      notifications_enabled: false,
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
});
