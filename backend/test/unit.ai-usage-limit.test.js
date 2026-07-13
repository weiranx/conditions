const {
  AIUsageLimitError,
  AIUsageUnavailableError,
  createAIUsageLimitService,
} = require('../src/auth/ai-usage-limit');
const {
  DEFAULT_FREE_MONTHLY_USAGE_LIMIT,
  getMonthlyWindow,
  parseFreeMonthlyUsageLimit,
} = require('../src/auth/monthly-usage-limit');

const USER_ID = '8c696be4-e175-4b6a-965b-82bdf3758e0c';

test('parses the shared monthly usage allowance and builds UTC month windows', () => {
  expect(parseFreeMonthlyUsageLimit('75')).toBe(75);
  expect(parseFreeMonthlyUsageLimit('0')).toBe(DEFAULT_FREE_MONTHLY_USAGE_LIMIT);
  expect(parseFreeMonthlyUsageLimit('not-a-number')).toBe(DEFAULT_FREE_MONTHLY_USAGE_LIMIT);
  expect(parseFreeMonthlyUsageLimit('10001')).toBe(DEFAULT_FREE_MONTHLY_USAGE_LIMIT);
  expect(getMonthlyWindow('2026-07-31T23:30:00-07:00')).toEqual({
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-09-01T00:00:00.000Z',
    resetAt: '2026-09-01T00:00:00.000Z',
  });
});

test('summarizes successful AI requests while retaining token analytics', async () => {
  const query = jest.fn().mockResolvedValue({ rows: [{ used_requests: '25', used_tokens: '125050' }] });
  const service = createAIUsageLimitService({
    database: { configured: true, query },
    freeMonthlyUsageLimit: 50,
    now: () => Date.parse('2026-07-13T08:00:00.000Z'),
  });

  await expect(service.getUserUsage(USER_ID)).resolves.toEqual({
    tierKey: 'free',
    unlimited: false,
    usedRequests: 25,
    usedTokens: 125_050,
    limitRequests: 50,
    remainingRequests: 25,
    percentUsed: 50,
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-08-01T00:00:00.000Z',
    resetAt: '2026-08-01T00:00:00.000Z',
    exhausted: false,
  });
  expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE user_id = $1'), [
    USER_ID,
    '2026-07-01T00:00:00.000Z',
    '2026-08-01T00:00:00.000Z',
  ]);
});

test('tracks Premium usage without applying a request ceiling', async () => {
  const service = createAIUsageLimitService({
    database: {
      configured: true,
      query: jest.fn().mockResolvedValue({ rows: [{ used_requests: '75', used_tokens: '300000' }] }),
    },
    freeMonthlyUsageLimit: 50,
    now: () => Date.parse('2026-07-13T08:00:00.000Z'),
  });

  await expect(service.getUserUsage(USER_ID, 'premium')).resolves.toEqual({
    tierKey: 'premium',
    unlimited: true,
    usedRequests: 75,
    usedTokens: 300_000,
    limitRequests: null,
    remainingRequests: null,
    percentUsed: null,
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-08-01T00:00:00.000Z',
    resetAt: '2026-08-01T00:00:00.000Z',
    exhausted: false,
  });
  await expect(service.assertUserCanGenerate(USER_ID, 'premium')).resolves.toMatchObject({
    unlimited: true,
    exhausted: false,
  });
  await expect(service.getUserUsage(USER_ID, 'unknown')).resolves.toMatchObject({
    tierKey: 'free',
    unlimited: false,
    limitRequests: 50,
    exhausted: true,
  });
});

test('blocks a user whose monthly allowance is exhausted', async () => {
  const service = createAIUsageLimitService({
    database: {
      configured: true,
      query: jest.fn().mockResolvedValue({ rows: [{ used_requests: '50', used_tokens: '250001' }] }),
    },
    freeMonthlyUsageLimit: 50,
    now: () => Date.parse('2026-07-13T08:00:00.000Z'),
  });

  await expect(service.assertUserCanGenerate(USER_ID)).rejects.toMatchObject({
    name: AIUsageLimitError.name,
    code: 'AI_USAGE_LIMIT_REACHED',
    statusCode: 429,
    usage: expect.objectContaining({ exhausted: true, remainingRequests: 0 }),
  });
});

test('fails closed when usage storage is unavailable', async () => {
  const unconfigured = createAIUsageLimitService({ database: { configured: false } });
  await expect(unconfigured.getUserUsage(USER_ID)).rejects.toBeInstanceOf(AIUsageUnavailableError);

  const failing = createAIUsageLimitService({
    database: { configured: true, query: jest.fn().mockRejectedValue(new Error('offline')) },
  });
  await expect(failing.getUserUsage(USER_ID)).rejects.toMatchObject({
    code: 'AI_USAGE_UNAVAILABLE',
    statusCode: 503,
  });
});
