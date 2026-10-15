const {
  AIUsageLimitError,
  AIUsageUnavailableError,
  DEFAULT_FREE_MONTHLY_COST_LIMIT_USD,
  createAIUsageLimitService,
  getMonthlyWindow,
  parseMonthlyCostLimit,
  validateMonthlyCostLimit,
} = require('../src/auth/ai-usage-limit');

const USER_ID = '8c696be4-e175-4b6a-965b-82bdf3758e0c';

test('parses the monthly AI spend allowance and builds UTC month windows', () => {
  expect(parseMonthlyCostLimit('2.5')).toBe(2.5);
  expect(parseMonthlyCostLimit('1.234')).toBe(1.23);
  expect(parseMonthlyCostLimit('0')).toBe(DEFAULT_FREE_MONTHLY_COST_LIMIT_USD);
  expect(parseMonthlyCostLimit('0.001')).toBe(DEFAULT_FREE_MONTHLY_COST_LIMIT_USD);
  expect(parseMonthlyCostLimit('not-a-number')).toBe(DEFAULT_FREE_MONTHLY_COST_LIMIT_USD);
  expect(parseMonthlyCostLimit('10000.01')).toBe(DEFAULT_FREE_MONTHLY_COST_LIMIT_USD);
  expect(parseMonthlyCostLimit(undefined, null)).toBeNull();
  expect(getMonthlyWindow('2026-07-31T23:30:00-07:00')).toEqual({
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-09-01T00:00:00.000Z',
    resetAt: '2026-09-01T00:00:00.000Z',
  });
});

test('rejects spend limits below a cent or above the maximum', () => {
  expect(validateMonthlyCostLimit('5')).toBe(5);
  expect(validateMonthlyCostLimit(0.01)).toBe(0.01);
  for (const value of [0, 0.001, -1, 10_001, null, '', 'abc']) {
    expect(() => validateMonthlyCostLimit(value)).toThrow(
      expect.objectContaining({ code: 'INVALID_AI_USAGE_LIMIT' }),
    );
  }
});

test('meters AI usage in dollars while retaining request and token analytics', async () => {
  const query = jest.fn().mockResolvedValue({
    rows: [{ used_requests: '25', used_tokens: '125050', used_cost_micros: '500000' }],
  });
  const service = createAIUsageLimitService({
    database: { configured: true, query },
    freeMonthlyCostLimitUsd: 1,
    now: () => Date.parse('2026-07-13T08:00:00.000Z'),
  });

  await expect(service.getUserUsage(USER_ID)).resolves.toEqual({
    tierKey: 'free',
    unlimited: false,
    usedRequests: 25,
    usedTokens: 125_050,
    usedUsd: 0.5,
    limitUsd: 1,
    limitSource: 'default',
    remainingUsd: 0.5,
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

test('charges unpriced models a flat per-token rate', async () => {
  const query = jest.fn().mockResolvedValue({ rows: [{}] });
  const service = createAIUsageLimitService({ database: { configured: true, query } });
  await service.getUserUsage(USER_ID);
  const usageSql = query.mock.calls[1][0];
  expect(usageSql).toContain("metadata ->> 'pricingMatched' = 'false' THEN total_tokens::bigint * 10");
  expect(usageSql).toContain('ELSE cost_usd_micros');
});

test('tracks Premium usage without applying a spend ceiling', async () => {
  const service = createAIUsageLimitService({
    database: {
      configured: true,
      query: jest.fn().mockResolvedValue({
        rows: [{ used_requests: '75', used_tokens: '300000', used_cost_micros: '2400000' }],
      }),
    },
    freeMonthlyCostLimitUsd: 1,
    now: () => Date.parse('2026-07-13T08:00:00.000Z'),
  });

  await expect(service.getUserUsage(USER_ID, 'premium')).resolves.toEqual({
    tierKey: 'premium',
    unlimited: true,
    usedRequests: 75,
    usedTokens: 300_000,
    usedUsd: 2.4,
    limitUsd: null,
    limitSource: 'unlimited',
    remainingUsd: null,
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
    limitUsd: 1,
    exhausted: true,
  });
});

test('uses a current per-user allowance override for Free accounts', async () => {
  const service = createAIUsageLimitService({
    database: {
      configured: true,
      query: jest.fn().mockResolvedValue({
        rows: [{
          used_requests: '20',
          used_tokens: '125000',
          used_cost_micros: '1250000',
          limit_override_usd: '4',
        }],
      }),
    },
    freeMonthlyCostLimitUsd: 1,
    now: () => Date.parse('2026-07-13T08:00:00.000Z'),
  });

  await expect(service.getUserUsage(USER_ID)).resolves.toMatchObject({
    usedRequests: 20,
    usedUsd: 1.25,
    limitUsd: 4,
    limitSource: 'custom',
    remainingUsd: 2.75,
    percentUsed: 31.3,
    exhausted: false,
  });
});

test('ignores a per-user token limit saved before spend limits', async () => {
  const query = jest.fn()
    .mockResolvedValueOnce({ rows: [{ limit_override_usd: null }] })
    .mockResolvedValueOnce({ rows: [{ used_cost_micros: '0' }] });
  const service = createAIUsageLimitService({ database: { configured: true, query }, freeMonthlyCostLimitUsd: 1 });
  await expect(service.getUserUsage(USER_ID)).resolves.toMatchObject({ limitUsd: 1, limitSource: 'default' });
  expect(query.mock.calls[0][0]).toContain("limits ->> 'monthlyCostLimitUsd'");
});

test('starts metered AI usage at the latest administrator reset point', async () => {
  const query = jest.fn()
    .mockResolvedValueOnce({
      rows: [{
        limit_override_usd: '4',
        usage_reset_at: '2026-07-10T12:30:00.000Z',
      }],
    })
    .mockResolvedValueOnce({ rows: [{ used_requests: '2', used_tokens: '2500', used_cost_micros: '9000' }] });
  const service = createAIUsageLimitService({
    database: { configured: true, query },
    freeMonthlyCostLimitUsd: 1,
    now: () => Date.parse('2026-07-13T08:00:00.000Z'),
  });

  await expect(service.getUserUsage(USER_ID)).resolves.toMatchObject({
    usedRequests: 2,
    usedTokens: 2_500,
    usedUsd: 0.009,
    limitUsd: 4,
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
    getAdminSetting: jest.fn().mockResolvedValue({ freeMonthlyAICostLimitUsd: 4 }),
    setAdminSetting: jest.fn().mockResolvedValue(undefined),
  };
  const service = createAIUsageLimitService({
    database: { configured: true, query: jest.fn() },
    freeMonthlyCostLimitUsd: '1.50',
    settingsStore,
  });

  await expect(service.initializeSettings()).resolves.toEqual({
    persistent: true,
    freeMonthlyAICostLimitUsd: 4,
    environmentFreeMonthlyAICostLimitUsd: 1.5,
    minMonthlyAICostLimitUsd: 0.01,
    maxMonthlyAICostLimitUsd: 10_000,
  });
  await expect(service.updateSettings({ freeMonthlyAICostLimitUsd: 2.5 })).resolves.toMatchObject({
    freeMonthlyAICostLimitUsd: 2.5,
  });
  expect(settingsStore.setAdminSetting).toHaveBeenCalledWith(
    'ai_usage_limits',
    { freeMonthlyAICostLimitUsd: 2.5 },
  );
  expect(service.getLimitUsd('free')).toBe(2.5);
  await expect(service.updateSettings({ freeMonthlyAICostLimitUsd: 0 })).rejects.toMatchObject({
    code: 'INVALID_AI_USAGE_LIMIT',
  });
});

test('keeps the deployment default when only a legacy token limit was saved', async () => {
  const service = createAIUsageLimitService({
    database: { configured: true, query: jest.fn() },
    freeMonthlyCostLimitUsd: 1,
    settingsStore: {
      configured: true,
      getAdminSetting: jest.fn().mockResolvedValue({ freeMonthlyAITokenLimit: 400_000 }),
    },
  });
  await expect(service.initializeSettings()).resolves.toMatchObject({ freeMonthlyAICostLimitUsd: 1 });
});

test('blocks a user whose monthly allowance is exhausted', async () => {
  const service = createAIUsageLimitService({
    database: {
      configured: true,
      query: jest.fn().mockResolvedValue({
        rows: [{ used_requests: '50', used_tokens: '250001', used_cost_micros: '1000001' }],
      }),
    },
    freeMonthlyCostLimitUsd: 1,
    now: () => Date.parse('2026-07-13T08:00:00.000Z'),
  });

  await expect(service.assertUserCanGenerate(USER_ID)).rejects.toMatchObject({
    name: AIUsageLimitError.name,
    code: 'AI_USAGE_LIMIT_REACHED',
    statusCode: 429,
    usage: expect.objectContaining({ exhausted: true, remainingUsd: 0, percentUsed: 100 }),
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
