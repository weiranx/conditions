'use strict';

const DEFAULT_MONTHLY_TOKEN_LIMIT = 250_000;
const MAX_MONTHLY_TOKEN_LIMIT = 100_000_000;

const parseMonthlyTokenLimit = (value, fallback = DEFAULT_MONTHLY_TOKEN_LIMIT) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_MONTHLY_TOKEN_LIMIT
    ? Math.round(parsed)
    : fallback;
};

const getMonthlyWindow = (value = Date.now()) => {
  const current = new Date(value);
  if (!Number.isFinite(current.getTime())) throw new TypeError('A valid date is required');
  const periodStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    resetAt: periodEnd.toISOString(),
  };
};

class AIUsageLimitError extends Error {
  constructor(usage) {
    super('Monthly AI usage limit reached. Your allowance resets at the start of next month.');
    this.name = 'AIUsageLimitError';
    this.code = 'AI_USAGE_LIMIT_REACHED';
    this.statusCode = 429;
    this.usage = usage;
  }
}

class AIUsageUnavailableError extends Error {
  constructor(message = 'AI usage is temporarily unavailable. Please try again later.') {
    super(message);
    this.name = 'AIUsageUnavailableError';
    this.code = 'AI_USAGE_UNAVAILABLE';
    this.statusCode = 503;
  }
}

const createAIUsageLimitService = ({
  database,
  monthlyTokenLimit = process.env.AI_USER_MONTHLY_TOKEN_LIMIT,
  now = Date.now,
} = {}) => {
  const limitTokens = parseMonthlyTokenLimit(monthlyTokenLimit);
  const available = Boolean(database?.configured && typeof database.query === 'function');

  const getUserUsage = async (userId) => {
    if (!available) throw new AIUsageUnavailableError();
    if (!userId) throw new TypeError('userId is required');

    const window = getMonthlyWindow(now());
    let result;
    try {
      result = await database.query(`
        SELECT COALESCE(SUM(total_tokens), 0)::bigint AS used_tokens
        FROM ai_usage_events
        WHERE user_id = $1
          AND created_at >= $2
          AND created_at < $3
      `, [userId, window.periodStart, window.periodEnd]);
    } catch (error) {
      throw new AIUsageUnavailableError();
    }

    const usedTokens = Math.max(0, Math.round(Number(result?.rows?.[0]?.used_tokens) || 0));
    const remainingTokens = Math.max(0, limitTokens - usedTokens);
    return {
      usedTokens,
      limitTokens,
      remainingTokens,
      percentUsed: Math.min(100, Math.round((usedTokens / limitTokens) * 1000) / 10),
      ...window,
      exhausted: usedTokens >= limitTokens,
    };
  };

  const assertUserCanGenerate = async (userId) => {
    const usage = await getUserUsage(userId);
    if (usage.exhausted) throw new AIUsageLimitError(usage);
    return usage;
  };

  return {
    available,
    limitTokens,
    assertUserCanGenerate,
    getUserUsage,
  };
};

module.exports = {
  AIUsageLimitError,
  AIUsageUnavailableError,
  DEFAULT_MONTHLY_TOKEN_LIMIT,
  createAIUsageLimitService,
  getMonthlyWindow,
  parseMonthlyTokenLimit,
};
