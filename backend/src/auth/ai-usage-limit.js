'use strict';

const {
  getMonthlyWindow,
  resolveFreeMonthlyUsageLimit,
} = require('./monthly-usage-limit');

class AIUsageLimitError extends Error {
  constructor(usage) {
    super('Monthly AI request limit reached. Your allowance resets at the start of next month.');
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
  freeMonthlyUsageLimit,
  now = Date.now,
} = {}) => {
  const freeLimitRequests = resolveFreeMonthlyUsageLimit(freeMonthlyUsageLimit);
  const available = Boolean(database?.configured && typeof database.query === 'function');

  const getLimitRequests = (tierKey = 'free') => (
    tierKey === 'premium' ? null : freeLimitRequests
  );

  const getUserUsage = async (userId, tierKey = 'free') => {
    if (!available) throw new AIUsageUnavailableError();
    if (!userId) throw new TypeError('userId is required');

    const resolvedTierKey = tierKey === 'premium' ? 'premium' : 'free';
    const unlimited = resolvedTierKey === 'premium';
    const limitRequests = getLimitRequests(resolvedTierKey);
    const window = getMonthlyWindow(now());
    let result;
    try {
      result = await database.query(`
        SELECT COUNT(*) FILTER (WHERE status = 'success')::bigint AS used_requests,
               COALESCE(SUM(total_tokens), 0)::bigint AS used_tokens
        FROM ai_usage_events
        WHERE user_id = $1
          AND created_at >= $2
          AND created_at < $3
      `, [userId, window.periodStart, window.periodEnd]);
    } catch (error) {
      throw new AIUsageUnavailableError();
    }

    const usedRequests = Math.max(0, Math.round(Number(result?.rows?.[0]?.used_requests) || 0));
    const usedTokens = Math.max(0, Math.round(Number(result?.rows?.[0]?.used_tokens) || 0));
    const remainingRequests = unlimited ? null : Math.max(0, limitRequests - usedRequests);
    return {
      tierKey: resolvedTierKey,
      unlimited,
      usedRequests,
      usedTokens,
      limitRequests,
      remainingRequests,
      percentUsed: unlimited
        ? null
        : Math.min(100, Math.round((usedRequests / limitRequests) * 1000) / 10),
      ...window,
      exhausted: unlimited ? false : usedRequests >= limitRequests,
    };
  };

  const assertUserCanGenerate = async (userId, tierKey = 'free') => {
    const usage = await getUserUsage(userId, tierKey);
    if (usage.exhausted) throw new AIUsageLimitError(usage);
    return usage;
  };

  return {
    available,
    freeLimitRequests,
    getLimitRequests,
    limitRequests: freeLimitRequests,
    assertUserCanGenerate,
    getUserUsage,
  };
};

module.exports = {
  AIUsageLimitError,
  AIUsageUnavailableError,
  createAIUsageLimitService,
  getMonthlyWindow,
};
