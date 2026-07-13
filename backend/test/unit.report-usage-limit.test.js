const {
  ReportUsageUnavailableError,
  createReportUsageLimitService,
} = require('../src/auth/report-usage-limit');
const { createAIUsageLimitService } = require('../src/auth/ai-usage-limit');
const {
  DEFAULT_FREE_MONTHLY_USAGE_LIMIT,
  parseFreeMonthlyUsageLimit,
} = require('../src/auth/monthly-usage-limit');

const USER_ID = '8c696be4-e175-4b6a-965b-82bdf3758e0c';
const NOW = () => Date.parse('2026-07-13T08:00:00.000Z');

const makeDatabase = (query) => ({
  configured: true,
  query,
  transaction: jest.fn((callback) => callback(query)),
});

test('uses the shared bounded monthly Free allowance', () => {
  expect(parseFreeMonthlyUsageLimit('75')).toBe(75);
  expect(parseFreeMonthlyUsageLimit('0')).toBe(DEFAULT_FREE_MONTHLY_USAGE_LIMIT);
  expect(parseFreeMonthlyUsageLimit('not-a-number')).toBe(DEFAULT_FREE_MONTHLY_USAGE_LIMIT);
  expect(parseFreeMonthlyUsageLimit('10001')).toBe(DEFAULT_FREE_MONTHLY_USAGE_LIMIT);

  const database = makeDatabase(jest.fn());
  expect(createAIUsageLimitService({ database, freeMonthlyUsageLimit: 75 }).freeLimitRequests).toBe(75);
  expect(createReportUsageLimitService({ database, freeMonthlyUsageLimit: 75 }).freeLimitReports).toBe(75);
});

test('summarizes Free and Premium report usage for the current UTC month', async () => {
  const query = jest.fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ used_reports: '17' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ used_reports: '17' }] });
  const service = createReportUsageLimitService({
    database: makeDatabase(query),
    freeMonthlyUsageLimit: 50,
    now: NOW,
  });

  await expect(service.getUserUsage(USER_ID, 'free')).resolves.toEqual({
    tierKey: 'free',
    unlimited: false,
    usedReports: 17,
    limitReports: 50,
    remainingReports: 33,
    percentUsed: 34,
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-08-01T00:00:00.000Z',
    resetAt: '2026-08-01T00:00:00.000Z',
    exhausted: false,
    limitSource: 'default',
  });
  await expect(service.getUserUsage(USER_ID, 'premium')).resolves.toMatchObject({
    tierKey: 'premium',
    unlimited: true,
    usedReports: 17,
    limitReports: null,
    remainingReports: null,
    percentUsed: null,
    exhausted: false,
    limitSource: 'unlimited',
  });
  expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('FROM saved_reports'), [
    USER_ID,
    '2026-07-01T00:00:00.000Z',
    '2026-08-01T00:00:00.000Z',
  ]);
});

test('atomically locks, checks, and consumes one report slot', async () => {
  const inserted = { rows: [{ id: 'report-id' }] };
  const query = jest.fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ used_reports: '49' }] })
    .mockResolvedValueOnce(inserted);
  const database = makeDatabase(query);
  const service = createReportUsageLimitService({
    database,
    freeMonthlyUsageLimit: 50,
    now: NOW,
  });
  const createReport = jest.fn((transactionQuery) => transactionQuery('INSERT REPORT'));

  await expect(service.consumeReportSlot(USER_ID, 'free', createReport)).resolves.toEqual({
    result: inserted,
    reportUsage: expect.objectContaining({
      usedReports: 50,
      remainingReports: 0,
      percentUsed: 100,
      exhausted: true,
    }),
  });
  expect(database.transaction).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0]).toEqual([
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [USER_ID],
  ]);
  expect(createReport).toHaveBeenCalledTimes(1);
});

test('blocks Free report creation after the monthly allowance is exhausted', async () => {
  const query = jest.fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ used_reports: '50' }] });
  const service = createReportUsageLimitService({
    database: makeDatabase(query),
    freeMonthlyUsageLimit: 50,
    now: NOW,
  });
  const createReport = jest.fn();

  await expect(service.consumeReportSlot(USER_ID, 'free', createReport)).rejects.toMatchObject({
    code: 'REPORT_USAGE_LIMIT_REACHED',
    statusCode: 429,
    usage: expect.objectContaining({ exhausted: true, remainingReports: 0 }),
  });
  expect(createReport).not.toHaveBeenCalled();
});

test('honors a per-user report allowance and reset point without deleting reports', async () => {
  const query = jest.fn()
    .mockResolvedValueOnce({
      rows: [{
        limit_override_reports: '75',
        usage_reset_at: '2026-07-10T12:30:00.000Z',
      }],
    })
    .mockResolvedValueOnce({ rows: [{ used_reports: '3' }] });
  const service = createReportUsageLimitService({
    database: makeDatabase(query),
    freeMonthlyUsageLimit: 50,
    now: NOW,
  });

  await expect(service.getUserUsage(USER_ID)).resolves.toMatchObject({
    usedReports: 3,
    limitReports: 75,
    limitSource: 'custom',
    remainingReports: 72,
    periodStart: '2026-07-10T12:30:00.000Z',
  });
  expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('FROM saved_reports'), [
    USER_ID,
    '2026-07-10T12:30:00.000Z',
    '2026-08-01T00:00:00.000Z',
  ]);
});

test('loads and persists the administrator default Free report allowance', async () => {
  const settingsStore = {
    configured: true,
    getAdminSetting: jest.fn().mockResolvedValue({ freeMonthlyUsageLimit: 60 }),
    setAdminSetting: jest.fn().mockResolvedValue(undefined),
  };
  const service = createReportUsageLimitService({
    database: makeDatabase(jest.fn()),
    freeMonthlyUsageLimit: 50,
    settingsStore,
  });

  await expect(service.initializeSettings()).resolves.toEqual({
    persistent: true,
    freeMonthlyUsageLimit: 60,
    environmentFreeMonthlyUsageLimit: 50,
    maxFreeMonthlyUsageLimit: 10_000,
  });
  await expect(service.updateSettings({ freeMonthlyUsageLimit: 80 })).resolves.toMatchObject({
    freeMonthlyUsageLimit: 80,
  });
  expect(settingsStore.setAdminSetting).toHaveBeenCalledWith(
    'monthly_usage_limits',
    { freeMonthlyUsageLimit: 80 },
  );
  await expect(service.updateSettings({ freeMonthlyUsageLimit: 0 })).rejects.toMatchObject({
    code: 'INVALID_USAGE_LIMIT',
  });
});

test('fails closed when report usage cannot be checked transactionally', async () => {
  const unconfigured = createReportUsageLimitService({ database: { configured: false } });
  await expect(unconfigured.getUserUsage(USER_ID)).rejects.toBeInstanceOf(ReportUsageUnavailableError);

  const noTransaction = createReportUsageLimitService({
    database: { configured: true, query: jest.fn() },
  });
  expect(noTransaction.available).toBe(false);
  await expect(noTransaction.consumeReportSlot(USER_ID, 'free', jest.fn()))
    .rejects.toBeInstanceOf(ReportUsageUnavailableError);
});
