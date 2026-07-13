const {
  DEFAULT_FREE_MONTHLY_REPORT_LIMIT,
  ReportUsageUnavailableError,
  createReportUsageLimitService,
  parseMonthlyReportLimit,
} = require('../src/auth/report-usage-limit');

const USER_ID = '8c696be4-e175-4b6a-965b-82bdf3758e0c';
const NOW = () => Date.parse('2026-07-13T08:00:00.000Z');

const makeDatabase = (query) => ({
  configured: true,
  query,
  transaction: jest.fn((callback) => callback(query)),
});

test('parses a bounded monthly Free report allowance', () => {
  expect(parseMonthlyReportLimit('75')).toBe(75);
  expect(parseMonthlyReportLimit('0')).toBe(DEFAULT_FREE_MONTHLY_REPORT_LIMIT);
  expect(parseMonthlyReportLimit('not-a-number')).toBe(DEFAULT_FREE_MONTHLY_REPORT_LIMIT);
  expect(parseMonthlyReportLimit('10001')).toBe(DEFAULT_FREE_MONTHLY_REPORT_LIMIT);
});

test('summarizes Free and Premium report usage for the current UTC month', async () => {
  const query = jest.fn().mockResolvedValue({ rows: [{ used_reports: '17' }] });
  const service = createReportUsageLimitService({
    database: makeDatabase(query),
    freeMonthlyReportLimit: 50,
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
  });
  await expect(service.getUserUsage(USER_ID, 'premium')).resolves.toMatchObject({
    tierKey: 'premium',
    unlimited: true,
    usedReports: 17,
    limitReports: null,
    remainingReports: null,
    percentUsed: null,
    exhausted: false,
  });
  expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM saved_reports'), [
    USER_ID,
    '2026-07-01T00:00:00.000Z',
    '2026-08-01T00:00:00.000Z',
  ]);
});

test('atomically locks, checks, and consumes one report slot', async () => {
  const inserted = { rows: [{ id: 'report-id' }] };
  const query = jest.fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ used_reports: '49' }] })
    .mockResolvedValueOnce(inserted);
  const database = makeDatabase(query);
  const service = createReportUsageLimitService({
    database,
    freeMonthlyReportLimit: 50,
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
    .mockResolvedValueOnce({ rows: [{ used_reports: '50' }] });
  const service = createReportUsageLimitService({
    database: makeDatabase(query),
    freeMonthlyReportLimit: 50,
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
