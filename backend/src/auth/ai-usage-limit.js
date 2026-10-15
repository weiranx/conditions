'use strict';

const {
  getMonthlyWindow,
} = require('./monthly-usage-limit');
const { UNPRICED_MODEL_USD_PER_MILLION_TOKENS } = require('../utils/ai-pricing');

const DEFAULT_FREE_MONTHLY_COST_LIMIT_USD = 1;
const MIN_MONTHLY_COST_LIMIT_USD = 0.01;
const MAX_MONTHLY_COST_LIMIT_USD = 10_000;
const AI_USAGE_SETTINGS_KEY = 'ai_usage_limits';
const USD_MICROS = 1_000_000;
const UNPRICED_MICROS_PER_TOKEN = UNPRICED_MODEL_USD_PER_MILLION_TOKENS;

// The spend a call counts against the monthly limit: its estimated cost, or a
// flat per-token charge when its model has no known price.
const BILLED_COST_MICROS_SQL = `CASE
  WHEN metadata ->> 'pricingMatched' = 'false' THEN total_tokens::bigint * ${UNPRICED_MICROS_PER_TOKEN}
  ELSE cost_usd_micros
END`;

const roundCents = (value) => Math.round(value * 100) / 100;
const microsToUsd = (micros) => Math.round(micros) / USD_MICROS;
const usdToMicros = (usd) => Math.round(usd * USD_MICROS);

const isValidCostLimit = (value) => (
  Number.isFinite(value)
  && roundCents(value) >= MIN_MONTHLY_COST_LIMIT_USD
  && value <= MAX_MONTHLY_COST_LIMIT_USD
);

const parseMonthlyCostLimit = (value, fallback = DEFAULT_FREE_MONTHLY_COST_LIMIT_USD) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return isValidCostLimit(parsed) ? roundCents(parsed) : fallback;
};

const formatLimitUsd = (value) => `$${value.toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

const validateMonthlyCostLimit = (value) => {
  const parsed = value === null || value === '' ? NaN : Number(value);
  if (!isValidCostLimit(parsed)) {
    const error = new TypeError(
      `Monthly AI spend limit must be between ${formatLimitUsd(MIN_MONTHLY_COST_LIMIT_USD)} and ${formatLimitUsd(MAX_MONTHLY_COST_LIMIT_USD)}.`,
    );
    error.code = 'INVALID_AI_USAGE_LIMIT';
    throw error;
  }
  return roundCents(parsed);
};

class AIUsageLimitError extends Error {
  constructor(usage) {
    super('Monthly AI spend limit reached. Your allowance resets at the start of next month.');
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
  freeMonthlyCostLimitUsd = process.env.AI_FREE_MONTHLY_COST_LIMIT_USD,
  settingsStore = null,
  now = Date.now,
} = {}) => {
  const environmentFreeLimitUsd = parseMonthlyCostLimit(freeMonthlyCostLimitUsd);
  let freeLimitUsd = environmentFreeLimitUsd;
  const available = Boolean(database?.configured && typeof database.query === 'function');

  const getLimitUsd = (tierKey = 'free', overrideUsd = null) => (
    tierKey === 'premium'
      ? null
      : parseMonthlyCostLimit(overrideUsd, freeLimitUsd)
  );

  const getSettings = () => ({
    persistent: Boolean(settingsStore?.configured),
    freeMonthlyAICostLimitUsd: freeLimitUsd,
    environmentFreeMonthlyAICostLimitUsd: environmentFreeLimitUsd,
    minMonthlyAICostLimitUsd: MIN_MONTHLY_COST_LIMIT_USD,
    maxMonthlyAICostLimitUsd: MAX_MONTHLY_COST_LIMIT_USD,
  });

  const initializeSettings = async () => {
    if (typeof settingsStore?.getAdminSetting !== 'function') return getSettings();
    const persisted = await settingsStore.getAdminSetting(AI_USAGE_SETTINGS_KEY);
    // Token limits saved before spend limits are ignored: tokens do not convert to dollars.
    if (persisted?.freeMonthlyAICostLimitUsd !== undefined) {
      freeLimitUsd = parseMonthlyCostLimit(
        persisted.freeMonthlyAICostLimitUsd,
        environmentFreeLimitUsd,
      );
    }
    return getSettings();
  };

  const updateSettings = async ({ freeMonthlyAICostLimitUsd: nextLimit } = {}) => {
    const validatedLimit = validateMonthlyCostLimit(nextLimit);
    const next = { freeMonthlyAICostLimitUsd: validatedLimit };
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
    freeLimitUsd = validatedLimit;
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
        SELECT limits ->> 'monthlyCostLimitUsd' AS limit_override_usd,
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
               COALESCE(SUM(total_tokens), 0)::bigint AS used_tokens,
               COALESCE(SUM(${BILLED_COST_MICROS_SQL}), 0)::bigint AS used_cost_micros
        FROM ai_usage_events
        WHERE user_id = $1
          AND created_at >= $2
          AND created_at < $3
      `, [userId, effectivePeriodStart, window.periodEnd]);
      window.periodStart = effectivePeriodStart;
    } catch (error) {
      throw new AIUsageUnavailableError();
    }

    const row = result?.rows?.[0];
    const usedRequests = Math.max(0, Math.round(Number(row?.used_requests) || 0));
    const usedTokens = Math.max(0, Math.round(Number(row?.used_tokens) || 0));
    const usedMicros = Math.max(0, Math.round(Number(row?.used_cost_micros) || 0));
    const limitOverrideUsd = parseMonthlyCostLimit(policy?.rows?.[0]?.limit_override_usd, null);
    const unlimited = resolvedTierKey === 'premium';
    const limitUsd = getLimitUsd(resolvedTierKey, limitOverrideUsd);
    const limitMicros = unlimited ? null : usdToMicros(limitUsd);
    return {
      tierKey: resolvedTierKey,
      unlimited,
      usedRequests,
      usedTokens,
      usedUsd: microsToUsd(usedMicros),
      limitUsd,
      limitSource: unlimited ? 'unlimited' : limitOverrideUsd ? 'custom' : 'default',
      remainingUsd: unlimited ? null : microsToUsd(Math.max(0, limitMicros - usedMicros)),
      percentUsed: unlimited
        ? null
        : Math.min(100, Math.round((usedMicros / limitMicros) * 1000) / 10),
      ...window,
      exhausted: unlimited ? false : usedMicros >= limitMicros,
    };
  };

  const assertUserCanGenerate = async (userId, tierKey = 'free') => {
    const usage = await getUserUsage(userId, tierKey);
    if (usage.exhausted) throw new AIUsageLimitError(usage);
    return usage;
  };

  return {
    available,
    get freeLimitUsd() { return freeLimitUsd; },
    getLimitUsd,
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
  BILLED_COST_MICROS_SQL,
  DEFAULT_FREE_MONTHLY_COST_LIMIT_USD,
  MAX_MONTHLY_COST_LIMIT_USD,
  MIN_MONTHLY_COST_LIMIT_USD,
  createAIUsageLimitService,
  formatLimitUsd,
  getMonthlyWindow,
  parseMonthlyCostLimit,
  validateMonthlyCostLimit,
};
