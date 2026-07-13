'use strict';

const {
  getMonthlyWindow,
  resolveFreeMonthlyUsageLimit,
} = require('./monthly-usage-limit');

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
  now = Date.now,
} = {}) => {
  const freeLimitReports = resolveFreeMonthlyUsageLimit(freeMonthlyUsageLimit);
  const available = Boolean(
    database?.configured
    && typeof database.query === 'function'
    && typeof database.transaction === 'function'
  );

  const getUserUsageWith = async (query, userId, tierKey = 'free') => {
    const window = getMonthlyWindow(now());
    let result;
    try {
      result = await query(`
        SELECT COUNT(*)::bigint AS used_reports
        FROM saved_reports
        WHERE user_id = $1
          AND created_at >= $2
          AND created_at < $3
      `, [userId, window.periodStart, window.periodEnd]);
    } catch (error) {
      throw new ReportUsageUnavailableError();
    }
    return summarizeReportUsage({
      usedReports: result?.rows?.[0]?.used_reports,
      tierKey,
      freeLimitReports,
      window,
    });
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
        reportUsage: summarizeReportUsage({
          usedReports: usage.usedReports + 1,
          tierKey: usage.tierKey,
          freeLimitReports,
          window: {
            periodStart: usage.periodStart,
            periodEnd: usage.periodEnd,
            resetAt: usage.resetAt,
          },
        }),
      };
    });
  };

  return {
    available,
    freeLimitReports,
    consumeReportSlot,
    getUserUsage,
  };
};

module.exports = {
  ReportUsageLimitError,
  ReportUsageUnavailableError,
  createReportUsageLimitService,
  summarizeReportUsage,
};
