const {
  AIUsageLimitError,
  AIUsageUnavailableError,
  DEFAULT_FREE_MONTHLY_TOKEN_LIMIT,
  createAIUsageLimitService,
  getMonthlyWindow,
  parseMonthlyTokenLimit,
} = require('../src/auth/ai-usage-limit');

const USER_ID = '8c696be4-e175-4b6a-965b-82bdf3758e0c';

test('parses the monthly AI token allowance and builds UTC month windows', () => {
  expect(parseMonthlyTokenLimit('400000')).toBe(400_000);
  expect(parseMonthlyTokenLimit('0')).toBe(DEFAULT_FREE_MONTHLY_TOKEN_LIMIT);
  expect(parseMonthlyTokenLimit('not-a-number')).toBe(DEFAULT_FREE_MONTHLY_TOKEN_LIMIT);
  expect(parseMonthlyTokenLimit('100000001')).toBe(DEFAULT_FREE_MONTHLY_TOKEN_LIMIT);
  expect(getMonthlyWindow('2026-07-31T23:30:00-07:00')).toEqual({
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-09-01T00:00:00.000Z',
    resetAt: '2026-09-01T00:00:00.000Z',
  });
});

test('summarizes AI token usage while retaining request analytics', async () => {
  const query = jest.fn().mockResolvedValue({ rows: [{ used_requests: '25', used_tokens: '125050' }] });
  const service = createAIUsageLimitService({
    database: { configured: true, query },
    freeMonthlyTokenLimit: 250_000,
    now: () => Date.parse('2026-07-13T08:00:00.000Z'),
  });

  await expect(service.getUserUsage(USER_ID)).resolves.toEqual({
    tierKey: 'free',
    unlimited: false,
    usedRequests: 25,
    usedTokens: 125_050,
    limitTokens: 250_000,
    limitSource: 'default',
    remainingTokens: 124_950,
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

test('tracks Premium usage without applying a token ceiling', async () => {
  const service = createAIUsageLimitService({
    database: {
      configured: true,
      query: jest.fn().mockResolvedValue({ rows: [{ used_requests: '75', used_tokens: '300000' }] }),
    },
    freeMonthlyTokenLimit: 250_000,
    now: () => Date.parse('2026-07-13T08:00:00.000Z'),
  });

  await expect(service.getUserUsage(USER_ID, 'premium')).resolves.toEqual({
    tierKey: 'premium',
    unlimited: true,
    usedRequests: 75,
    usedTokens: 300_000,
    limitTokens: null,
    limitSource: 'unlimited',
    remainingTokens: null,
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
    limitTokens: 250_000,
    exhausted: true,
  });
});

test('uses a current per-user allowance override for Free accounts', async () => {
  const service = createAIUsageLimitService({
    database: {
      configured: true,
      query: jest.fn().mockResolvedValue({
        rows: [{ used_requests: '20', used_tokens: '125000', limit_override_tokens: '400000' }],
      }),
    },
    freeMonthlyTokenLimit: 250_000,
    now: () => Date.parse('2026-07-13T08:00:00.000Z'),
  });

  await expect(service.getUserUsage(USER_ID)).resolves.toMatchObject({
    usedRequests: 20,
    usedTokens: 125_000,
    limitTokens: 400_000,
    limitSource: 'custom',
    remainingTokens: 275_000,
    percentUsed: 31.3,
    exhausted: false,
  });
});

test('starts metered AI usage at the latest administrator reset point', async () => {
  const query = jest.fn()
    .mockResolvedValueOnce({
      rows: [{
        limit_override_tokens: '400000',
        usage_reset_at: '2026-07-10T12:30:00.000Z',
      }],
    })
    .mockResolvedValueOnce({ rows: [{ used_requests: '2', used_tokens: '2500' }] });
  const service = createAIUsageLimitService({
    database: { configured: true, query },
    freeMonthlyTokenLimit: 250_000,
    now: () => Date.parse('2026-07-13T08:00:00.000Z'),
  });

  await expect(service.getUserUsage(USER_ID)).resolves.toMatchObject({
    usedRequests: 2,
    usedTokens: 2_500,
    limitTokens: 400_000,
    limitSource: 'custom',
    periodStart: '2026-07-10T12:30:00.000Z',
  });
  expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('FROM ai_usage_events'), [
    USER_ID,
    '2026-07-10T12:30:00.000Z',
    '2026-08-01T00:00:00.000Z',
  ]);
});

test('loads and persists the administrator default Free allowance', async () => {
  const settingsStore = {
    configured: true,
    getAdminSetting: jest.fn().mockResolvedValue({ freeMonthlyAITokenLimit: 400_000 }),
    setAdminSetting: jest.fn().mockResolvedValue(undefined),
  };
  const service = createAIUsageLimitService({
    database: { configured: true, query: jest.fn() },
    freeMonthlyTokenLimit: 250_000,
    settingsStore,
  });

  await expect(service.initializeSettings()).resolves.toEqual({
    persistent: true,
    freeMonthlyAITokenLimit: 400_000,
    environmentFreeMonthlyAITokenLimit: 250_000,
    maxMonthlyAITokenLimit: 100_000_000,
  });
  await expect(service.updateSettings({ freeMonthlyAITokenLimit: 500_000 })).resolves.toMatchObject({
    freeMonthlyAITokenLimit: 500_000,
  });
  expect(settingsStore.setAdminSetting).toHaveBeenCalledWith(
    'ai_usage_limits',
    { freeMonthlyAITokenLimit: 500_000 },
  );
  expect(service.getLimitTokens('free')).toBe(500_000);
  await expect(service.updateSettings({ freeMonthlyAITokenLimit: 0 })).rejects.toMatchObject({
    code: 'INVALID_AI_USAGE_LIMIT',
  });
});

test('blocks a user whose monthly allowance is exhausted', async () => {
  const service = createAIUsageLimitService({
    database: {
      configured: true,
      query: jest.fn().mockResolvedValue({ rows: [{ used_requests: '50', used_tokens: '250001' }] }),
    },
    freeMonthlyTokenLimit: 250_000,
    now: () => Date.parse('2026-07-13T08:00:00.000Z'),
  });

  await expect(service.assertUserCanGenerate(USER_ID)).rejects.toMatchObject({
    name: AIUsageLimitError.name,
    code: 'AI_USAGE_LIMIT_REACHED',
    statusCode: 429,
    usage: expect.objectContaining({ exhausted: true, remainingTokens: 0 }),
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
