'use strict';

const {
  MAX_FREE_MONTHLY_USAGE_LIMIT,
  getMonthlyWindow,
  parseFreeMonthlyUsageLimit,
  resolveFreeMonthlyUsageLimit,
  validateFreeMonthlyUsageLimit,
} = require('./monthly-usage-limit');

const REPORT_USAGE_SETTINGS_KEY = 'report_usage_limits';
const LEGACY_USAGE_SETTINGS_KEY = 'monthly_usage_limits';

const summarizeReportUsage = ({ usedReports, tierKey, freeLimitReports, window }) => {
  const resolvedTierKey = tierKey === 'premium' ? 'premium' : 'free';
  const unlimited = resolvedTierKey === 'premium';
  const limitReports = unlimited ? null : freeLimitReports;
  const normalizedUsedReports = Math.max(0, Math.round(Number(usedReports) || 0));
  return {
    tierKey: resolvedTierKey,
    unlimited,
    usedReports: normalizedUsedReports,
    limitReports,
    remainingReports: unlimited ? null : Math.max(0, limitReports - normalizedUsedReports),
    percentUsed: unlimited
      ? null
      : Math.min(100, Math.round((normalizedUsedReports / limitReports) * 1000) / 10),
    ...window,
    exhausted: unlimited ? false : normalizedUsedReports >= limitReports,
  };
};

class ReportUsageLimitError extends Error {
  constructor(usage) {
    super('Monthly generated report limit reached. Your allowance resets at the start of next month.');
    this.name = 'ReportUsageLimitError';
    this.code = 'REPORT_USAGE_LIMIT_REACHED';
    this.statusCode = 429;
    this.usage = usage;
  }
}

class ReportUsageUnavailableError extends Error {
  constructor(message = 'Report usage is temporarily unavailable. Please try again later.') {
    super(message);
    this.name = 'ReportUsageUnavailableError';
    this.code = 'REPORT_USAGE_UNAVAILABLE';
    this.statusCode = 503;
  }
}

const createReportUsageLimitService = ({
  database,
  freeMonthlyUsageLimit,
  settingsStore = null,
  now = Date.now,
} = {}) => {
  const environmentFreeLimitReports = resolveFreeMonthlyUsageLimit(freeMonthlyUsageLimit);
  let freeLimitReports = environmentFreeLimitReports;
  const available = Boolean(
    database?.configured
    && typeof database.query === 'function'
    && typeof database.transaction === 'function'
  );

  const getSettings = () => ({
    persistent: Boolean(settingsStore?.configured),
    freeMonthlyReportUsageLimit: freeLimitReports,
    environmentFreeMonthlyReportUsageLimit: environmentFreeLimitReports,
    maxFreeMonthlyUsageLimit: MAX_FREE_MONTHLY_USAGE_LIMIT,
  });

  const initializeSettings = async () => {
    if (typeof settingsStore?.getAdminSetting !== 'function') return getSettings();
    const persisted = await settingsStore.getAdminSetting(REPORT_USAGE_SETTINGS_KEY)
      ?? await settingsStore.getAdminSetting(LEGACY_USAGE_SETTINGS_KEY);
    const persistedLimit = persisted?.freeMonthlyReportUsageLimit ?? persisted?.freeMonthlyUsageLimit;
    if (persistedLimit !== undefined) {
      freeLimitReports = parseFreeMonthlyUsageLimit(
        persistedLimit,
        environmentFreeLimitReports,
      );
    }
    return getSettings();
  };

  const updateSettings = async ({ freeMonthlyReportUsageLimit: nextLimit } = {}) => {
    const validatedLimit = validateFreeMonthlyUsageLimit(nextLimit);
    const next = { freeMonthlyReportUsageLimit: validatedLimit };
    try {
      if (typeof settingsStore?.setAdminSetting === 'function') {
        await settingsStore.setAdminSetting(REPORT_USAGE_SETTINGS_KEY, next);
      }
    } catch (error) {
      const persistenceError = new Error('Usage limits could not be saved.');
      persistenceError.code = 'USAGE_SETTINGS_PERSIST_FAILED';
      persistenceError.cause = error;
      throw persistenceError;
    }
    freeLimitReports = validatedLimit;
    return getSettings();
  };

  const getUserUsageWith = async (query, userId, tierKey = 'free') => {
    const window = getMonthlyWindow(now());
    let policy;
    let result;
    try {
      policy = await query(`
        SELECT limits ->> 'monthlyUsageLimit' AS limit_override_reports,
               limits ->> 'resetAt' AS usage_reset_at
        FROM entitlements
        WHERE user_id = $1
          AND feature_key = 'report_usage'
          AND (valid_until IS NULL OR valid_until > NOW())
        LIMIT 1
      `, [userId]);
      const resetAt = new Date(policy?.rows?.[0]?.usage_reset_at).getTime();
      const monthStart = new Date(window.periodStart).getTime();
      const monthEnd = new Date(window.periodEnd).getTime();
      const effectivePeriodStart = Number.isFinite(resetAt) && resetAt > monthStart && resetAt < monthEnd
        ? new Date(resetAt).toISOString()
        : window.periodStart;
      result = await query(`
        SELECT COUNT(*)::bigint AS used_reports
        FROM saved_reports
        WHERE user_id = $1
          AND created_at >= $2
          AND created_at < $3
      `, [userId, effectivePeriodStart, window.periodEnd]);
      const limitOverrideReports = parseFreeMonthlyUsageLimit(
        policy?.rows?.[0]?.limit_override_reports,
        null,
      );
      const summary = summarizeReportUsage({
        usedReports: result?.rows?.[0]?.used_reports,
        tierKey,
        freeLimitReports: limitOverrideReports ?? freeLimitReports,
        window: { ...window, periodStart: effectivePeriodStart },
      });
      return {
        ...summary,
        limitSource: summary.unlimited ? 'unlimited' : limitOverrideReports ? 'custom' : 'default',
      };
    } catch (error) {
      throw new ReportUsageUnavailableError();
    }
  };

  const getUserUsage = async (userId, tierKey = 'free') => {
    if (!available) throw new ReportUsageUnavailableError();
    if (!userId) throw new TypeError('userId is required');
    return getUserUsageWith(database.query, userId, tierKey);
  };

  const consumeReportSlot = async (userId, tierKey = 'free', createReport) => {
    if (!available) throw new ReportUsageUnavailableError();
    if (!userId) throw new TypeError('userId is required');
    if (typeof createReport !== 'function') throw new TypeError('createReport callback is required');

    return database.transaction(async (query) => {
      try {
        await query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [userId]);
      } catch (error) {
        throw new ReportUsageUnavailableError();
      }
      const usage = await getUserUsageWith(query, userId, tierKey);
      if (usage.exhausted) throw new ReportUsageLimitError(usage);

      const result = await createReport(query);
      return {
        result,
        reportUsage: {
          ...summarizeReportUsage({
            usedReports: usage.usedReports + 1,
            tierKey: usage.tierKey,
            freeLimitReports: usage.limitReports ?? freeLimitReports,
            window: {
              periodStart: usage.periodStart,
              periodEnd: usage.periodEnd,
              resetAt: usage.resetAt,
            },
          }),
          limitSource: usage.limitSource,
        },
      };
    });
  };

  return {
    available,
    get freeLimitReports() { return freeLimitReports; },
    consumeReportSlot,
    getSettings,
    getUserUsage,
    initializeSettings,
    updateSettings,
  };
};

module.exports = {
  ReportUsageLimitError,
  ReportUsageUnavailableError,
  createReportUsageLimitService,
  summarizeReportUsage,
  validateFreeMonthlyUsageLimit,
};
