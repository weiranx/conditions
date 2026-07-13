'use strict';

const {
  getMonthlyWindow,
} = require('./monthly-usage-limit');

const DEFAULT_FREE_MONTHLY_TOKEN_LIMIT = 250_000;
const MAX_MONTHLY_TOKEN_LIMIT = 100_000_000;
const AI_USAGE_SETTINGS_KEY = 'ai_usage_limits';

const parseMonthlyTokenLimit = (value, fallback = DEFAULT_FREE_MONTHLY_TOKEN_LIMIT) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_MONTHLY_TOKEN_LIMIT
    ? Math.round(parsed)
    : fallback;
};

const validateMonthlyTokenLimit = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_MONTHLY_TOKEN_LIMIT) {
    const error = new TypeError(
      `Monthly AI token limit must be between 1 and ${MAX_MONTHLY_TOKEN_LIMIT.toLocaleString()}.`,
    );
    error.code = 'INVALID_AI_USAGE_LIMIT';
    throw error;
  }
  return Math.round(parsed);
};

class AIUsageLimitError extends Error {
  constructor(usage) {
    super('Monthly AI token limit reached. Your allowance resets at the start of next month.');
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
  freeMonthlyTokenLimit = process.env.AI_FREE_MONTHLY_TOKEN_LIMIT
    || process.env.AI_USER_MONTHLY_TOKEN_LIMIT,
  settingsStore = null,
  now = Date.now,
} = {}) => {
  const environmentFreeLimitTokens = parseMonthlyTokenLimit(freeMonthlyTokenLimit);
  let freeLimitTokens = environmentFreeLimitTokens;
  const available = Boolean(database?.configured && typeof database.query === 'function');

  const getLimitTokens = (tierKey = 'free', overrideTokens = null) => (
    tierKey === 'premium'
      ? null
      : parseMonthlyTokenLimit(overrideTokens, freeLimitTokens)
  );

  const getSettings = () => ({
    persistent: Boolean(settingsStore?.configured),
    freeMonthlyAITokenLimit: freeLimitTokens,
    environmentFreeMonthlyAITokenLimit: environmentFreeLimitTokens,
    maxMonthlyAITokenLimit: MAX_MONTHLY_TOKEN_LIMIT,
  });

  const initializeSettings = async () => {
    if (typeof settingsStore?.getAdminSetting !== 'function') return getSettings();
    const persisted = await settingsStore.getAdminSetting(AI_USAGE_SETTINGS_KEY);
    const persistedLimit = persisted?.freeMonthlyAITokenLimit ?? persisted?.freeMonthlyTokenLimit;
    if (persistedLimit !== undefined) {
      freeLimitTokens = parseMonthlyTokenLimit(
        persistedLimit,
        environmentFreeLimitTokens,
      );
    }
    return getSettings();
  };

  const updateSettings = async ({ freeMonthlyAITokenLimit: nextLimit } = {}) => {
    const validatedLimit = validateMonthlyTokenLimit(nextLimit);
    const next = { freeMonthlyAITokenLimit: validatedLimit };
    try {
      if (typeof settingsStore?.setAdminSetting === 'function') {
        await settingsStore.setAdminSetting(AI_USAGE_SETTINGS_KEY, next);
      }
    } catch (error) {
      const persistenceError = new Error('Usage limits could not be saved.');
      persistenceError.code = 'USAGE_SETTINGS_PERSIST_FAILED';
      persistenceError.cause = error;
      throw persistenceError;
    }
    freeLimitTokens = validatedLimit;
    return getSettings();
  };

  const getUserUsage = async (userId, tierKey = 'free') => {
    if (!available) throw new AIUsageUnavailableError();
    if (!userId) throw new TypeError('userId is required');

    const resolvedTierKey = tierKey === 'premium' ? 'premium' : 'free';
    const window = getMonthlyWindow(now());
    let policy;
    let result;
    try {
      policy = await database.query(`
        SELECT limits ->> 'monthlyTokenLimit' AS limit_override_tokens,
               limits ->> 'resetAt' AS usage_reset_at
        FROM entitlements
        WHERE user_id = $1
          AND feature_key = 'ai_usage'
          AND (valid_until IS NULL OR valid_until > NOW())
        LIMIT 1
      `, [userId]);
      const resetAt = new Date(policy?.rows?.[0]?.usage_reset_at).getTime();
      const monthStart = new Date(window.periodStart).getTime();
      const monthEnd = new Date(window.periodEnd).getTime();
      const effectivePeriodStart = Number.isFinite(resetAt) && resetAt > monthStart && resetAt < monthEnd
        ? new Date(resetAt).toISOString()
        : window.periodStart;
      result = await database.query(`
        SELECT COUNT(*) FILTER (WHERE status = 'success')::bigint AS used_requests,
               COALESCE(SUM(total_tokens), 0)::bigint AS used_tokens
        FROM ai_usage_events
        WHERE user_id = $1
          AND created_at >= $2
          AND created_at < $3
      `, [userId, effectivePeriodStart, window.periodEnd]);
      window.periodStart = effectivePeriodStart;
    } catch (error) {
      throw new AIUsageUnavailableError();
    }

    const usedRequests = Math.max(0, Math.round(Number(result?.rows?.[0]?.used_requests) || 0));
    const usedTokens = Math.max(0, Math.round(Number(result?.rows?.[0]?.used_tokens) || 0));
    const limitOverrideTokens = parseMonthlyTokenLimit(
      policy?.rows?.[0]?.limit_override_tokens,
      null,
    );
    const unlimited = resolvedTierKey === 'premium';
    const limitTokens = getLimitTokens(resolvedTierKey, limitOverrideTokens);
    const remainingTokens = unlimited ? null : Math.max(0, limitTokens - usedTokens);
    return {
      tierKey: resolvedTierKey,
      unlimited,
      usedRequests,
      usedTokens,
      limitTokens,
      limitSource: unlimited ? 'unlimited' : limitOverrideTokens ? 'custom' : 'default',
      remainingTokens,
      percentUsed: unlimited
        ? null
        : Math.min(100, Math.round((usedTokens / limitTokens) * 1000) / 10),
      ...window,
      exhausted: unlimited ? false : usedTokens >= limitTokens,
    };
  };

  const assertUserCanGenerate = async (userId, tierKey = 'free') => {
    const usage = await getUserUsage(userId, tierKey);
    if (usage.exhausted) throw new AIUsageLimitError(usage);
    return usage;
  };

  return {
    available,
    get freeLimitTokens() { return freeLimitTokens; },
    getLimitTokens,
    get limitTokens() { return freeLimitTokens; },
    assertUserCanGenerate,
    getSettings,
    getUserUsage,
    initializeSettings,
    updateSettings,
  };
};

module.exports = {
  AIUsageLimitError,
  AIUsageUnavailableError,
  DEFAULT_FREE_MONTHLY_TOKEN_LIMIT,
  MAX_MONTHLY_TOKEN_LIMIT,
  createAIUsageLimitService,
  getMonthlyWindow,
  parseMonthlyTokenLimit,
  validateMonthlyTokenLimit,
};
