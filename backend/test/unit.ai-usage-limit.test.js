const {
  AIUsageLimitError,
  AIUsageUnavailableError,
  DEFAULT_MONTHLY_TOKEN_LIMIT,
  createAIUsageLimitService,
  getMonthlyWindow,
  parseMonthlyTokenLimit,
} = require('../src/auth/ai-usage-limit');

const USER_ID = '8c696be4-e175-4b6a-965b-82bdf3758e0c';

test('parses a bounded monthly token allowance and builds UTC month windows', () => {
  expect(parseMonthlyTokenLimit('500000')).toBe(500_000);
  expect(parseMonthlyTokenLimit('0')).toBe(DEFAULT_MONTHLY_TOKEN_LIMIT);
  expect(parseMonthlyTokenLimit('not-a-number')).toBe(DEFAULT_MONTHLY_TOKEN_LIMIT);
  expect(getMonthlyWindow('2026-07-31T23:30:00-07:00')).toEqual({
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-09-01T00:00:00.000Z',
    resetAt: '2026-09-01T00:00:00.000Z',
  });
});

test('summarizes provider-reported tokens for one user in the current month', async () => {
  const query = jest.fn().mockResolvedValue({ rows: [{ used_tokens: '125050' }] });
  const service = createAIUsageLimitService({
    database: { configured: true, query },
    monthlyTokenLimit: 250_000,
    now: () => Date.parse('2026-07-13T08:00:00.000Z'),
  });

  await expect(service.getUserUsage(USER_ID)).resolves.toEqual({
    usedTokens: 125_050,
    limitTokens: 250_000,
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

test('blocks a user whose monthly allowance is exhausted', async () => {
  const service = createAIUsageLimitService({
    database: {
      configured: true,
      query: jest.fn().mockResolvedValue({ rows: [{ used_tokens: '250001' }] }),
    },
    monthlyTokenLimit: 250_000,
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
