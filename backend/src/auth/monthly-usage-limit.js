'use strict';

const DEFAULT_FREE_MONTHLY_USAGE_LIMIT = 50;
const MAX_FREE_MONTHLY_USAGE_LIMIT = 10_000;

const parseFreeMonthlyUsageLimit = (value, fallback = DEFAULT_FREE_MONTHLY_USAGE_LIMIT) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_FREE_MONTHLY_USAGE_LIMIT
    ? Math.round(parsed)
    : fallback;
};

const resolveFreeMonthlyUsageLimit = (value) => parseFreeMonthlyUsageLimit(
  value
    ?? process.env.FREE_MONTHLY_USAGE_LIMIT
    ?? process.env.REPORT_FREE_MONTHLY_LIMIT,
);

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

module.exports = {
  DEFAULT_FREE_MONTHLY_USAGE_LIMIT,
  MAX_FREE_MONTHLY_USAGE_LIMIT,
  getMonthlyWindow,
  parseFreeMonthlyUsageLimit,
  resolveFreeMonthlyUsageLimit,
};
