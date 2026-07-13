'use strict';

const {
  DEFAULT_FREE_MONTHLY_USAGE_LIMIT,
  MAX_FREE_MONTHLY_USAGE_LIMIT,
  getMonthlyWindow,
  parseFreeMonthlyUsageLimit,
  resolveFreeMonthlyUsageLimit,
  validateFreeMonthlyUsageLimit,
} = require('./monthly-usage-limit');

const AI_USAGE_SETTINGS_KEY = 'ai_usage_limits';
const LEGACY_USAGE_SETTINGS_KEY = 'monthly_usage_limits';

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
  settingsStore = null,
  now = Date.now,
} = {}) => {
  const environmentFreeLimitRequests = resolveFreeMonthlyUsageLimit(freeMonthlyUsageLimit);
  let freeLimitRequests = environmentFreeLimitRequests;
  const available = Boolean(database?.configured && typeof database.query === 'function');

  const getLimitRequests = (tierKey = 'free', overrideRequests = null) => (
    tierKey === 'premium'
      ? null
      : parseFreeMonthlyUsageLimit(overrideRequests, freeLimitRequests)
  );

  const getSettings = () => ({
    persistent: Boolean(settingsStore?.configured),
    freeMonthlyAIUsageLimit: freeLimitRequests,
    environmentFreeMonthlyAIUsageLimit: environmentFreeLimitRequests,
    maxFreeMonthlyUsageLimit: MAX_FREE_MONTHLY_USAGE_LIMIT,
  });

  const initializeSettings = async () => {
    if (typeof settingsStore?.getAdminSetting !== 'function') return getSettings();
    const persisted = await settingsStore.getAdminSetting(AI_USAGE_SETTINGS_KEY)
      ?? await settingsStore.getAdminSetting(LEGACY_USAGE_SETTINGS_KEY);
    const persistedLimit = persisted?.freeMonthlyAIUsageLimit ?? persisted?.freeMonthlyUsageLimit;
    if (persistedLimit !== undefined) {
      freeLimitRequests = parseFreeMonthlyUsageLimit(
        persistedLimit,
        environmentFreeLimitRequests,
      );
    }
    return getSettings();
  };

  const updateSettings = async ({ freeMonthlyAIUsageLimit: nextLimit } = {}) => {
    const validatedLimit = validateFreeMonthlyUsageLimit(nextLimit);
    const next = { freeMonthlyAIUsageLimit: validatedLimit };
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
    freeLimitRequests = validatedLimit;
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
        SELECT limits ->> 'monthlyUsageLimit' AS limit_override_requests,
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
    const limitOverrideRequests = parseFreeMonthlyUsageLimit(
      policy?.rows?.[0]?.limit_override_requests,
      null,
    );
    const unlimited = resolvedTierKey === 'premium';
    const limitRequests = getLimitRequests(resolvedTierKey, limitOverrideRequests);
    const remainingRequests = unlimited ? null : Math.max(0, limitRequests - usedRequests);
    return {
      tierKey: resolvedTierKey,
      unlimited,
      usedRequests,
      usedTokens,
      limitRequests,
      limitSource: unlimited ? 'unlimited' : limitOverrideRequests ? 'custom' : 'default',
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
    get freeLimitRequests() { return freeLimitRequests; },
    getLimitRequests,
    get limitRequests() { return freeLimitRequests; },
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
  DEFAULT_FREE_MONTHLY_USAGE_LIMIT,
  MAX_FREE_MONTHLY_USAGE_LIMIT,
  createAIUsageLimitService,
  getMonthlyWindow,
  parseFreeMonthlyUsageLimit,
  validateFreeMonthlyUsageLimit,
};
