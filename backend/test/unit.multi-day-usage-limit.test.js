const {
  MultiDayUsageLimitError,
  MultiDayUsageUnavailableError,
  createMultiDayUsageLimitService,
  summarizeUsage,
} = require('../src/auth/multi-day-usage-limit');

const USER_ID = '8c696be4-e175-4b6a-965b-82bdf3758e0c';
const ANONYMOUS_ID = 'bd4ed9de-e9c3-4f73-a39a-05624ecf2d54';
const NOW = () => Date.parse('2026-07-14T08:00:00.000Z');

const makeDatabase = (query) => ({
  configured: true,
  query,
  transaction: jest.fn((callback) => callback(query)),
});

test('summarizes guest, Free, and Premium multi-day usage contracts', () => {
  const window = {
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-08-01T00:00:00.000Z',
    resetAt: '2026-08-01T00:00:00.000Z',
  };
  expect(summarizeUsage({
    usedRuns: 2,
    identityType: 'guest',
    tierKey: 'guest',
    limitRuns: 3,
    window: null,
  })).toMatchObject({
    tierKey: 'guest', usedRuns: 2, limitRuns: 3, remainingRuns: 1, resetAt: null, exhausted: false,
  });
  expect(summarizeUsage({
    usedRuns: 4,
    identityType: 'account',
    tierKey: 'free',
    limitRuns: 10,
    window,
  })).toMatchObject({
    tierKey: 'free', usedRuns: 4, limitRuns: 10, remainingRuns: 6, percentUsed: 40, exhausted: false,
  });
  expect(summarizeUsage({
    usedRuns: 15,
    identityType: 'account',
    tierKey: 'premium',
    limitRuns: 10,
    window,
  })).toMatchObject({
    tierKey: 'premium', unlimited: true, limitRuns: null, remainingRuns: null, percentUsed: null, exhausted: false,
  });
});

test('loads account usage inside the current UTC month', async () => {
  const query = jest.fn().mockResolvedValue({ rows: [{ used_runs: '4', active_runs: '4' }] });
  const service = createMultiDayUsageLimitService({
    database: makeDatabase(query),
    freeMonthlyLimit: 10,
    now: NOW,
  });

  await expect(service.getUserUsage(USER_ID, 'free')).resolves.toMatchObject({
    tierKey: 'free',
    usedRuns: 4,
    limitRuns: 10,
    remainingRuns: 6,
    periodStart: '2026-07-01T00:00:00.000Z',
    resetAt: '2026-08-01T00:00:00.000Z',
  });
  expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM feature_usage_events'), [
    USER_ID,
    '2026-07-01T00:00:00.000Z',
    '2026-08-01T00:00:00.000Z',
  ]);
});

test('atomically reserves one guest comparison slot', async () => {
  const query = jest.fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ used_runs: '1', active_runs: '1' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'reservation-id' }] });
  const database = makeDatabase(query);
  const service = createMultiDayUsageLimitService({ database, guestLimit: 3, now: NOW });

  await expect(service.reserve({
    anonymousId: ANONYMOUS_ID,
    idempotencyKey: 'request-1',
    metadata: { durationDays: 7 },
  })).resolves.toMatchObject({
    reservationId: 'reservation-id',
    duplicate: false,
    usage: { tierKey: 'guest', usedRuns: 1, remainingRuns: 1, exhausted: false },
  });
  expect(database.transaction).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0]).toEqual([
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`multi_day_forecast:guest:${ANONYMOUS_ID}`],
  ]);
});

test('blocks a guest when all comparison slots are active or completed', async () => {
  const query = jest.fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ used_runs: '2', active_runs: '3' }] });
  const service = createMultiDayUsageLimitService({
    database: makeDatabase(query),
    guestLimit: 3,
    now: NOW,
  });

  await expect(service.reserve({
    anonymousId: ANONYMOUS_ID,
    idempotencyKey: 'request-2',
  })).rejects.toBeInstanceOf(MultiDayUsageLimitError);
});

test('reuses a failed idempotent reservation without consuming another slot', async () => {
  const query = jest.fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({
      rows: [{
        id: 'failed-reservation-id',
        status: 'failed',
        user_id: null,
        anonymous_id: ANONYMOUS_ID,
      }],
    })
    .mockResolvedValueOnce({ rows: [{ used_runs: '1', active_runs: '1' }] })
    .mockResolvedValueOnce({ rows: [] });
  const service = createMultiDayUsageLimitService({
    database: makeDatabase(query),
    guestLimit: 3,
    now: NOW,
  });

  await expect(service.reserve({
    anonymousId: ANONYMOUS_ID,
    idempotencyKey: 'retry-request',
  })).resolves.toMatchObject({
    reservationId: 'failed-reservation-id',
    duplicate: false,
    usage: { usedRuns: 1, remainingRuns: 1 },
  });
  expect(query.mock.calls[3][0]).toContain("SET status = 'pending'");
});

test('fails closed when the usage ledger is unavailable', async () => {
  const service = createMultiDayUsageLimitService({ database: { configured: false } });
  await expect(service.getGuestUsage(ANONYMOUS_ID)).rejects.toBeInstanceOf(MultiDayUsageUnavailableError);
});
