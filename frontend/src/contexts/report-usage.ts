import type { AccountReportUsage } from './account';

export function parseAccountReportUsage(value: unknown): AccountReportUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const dateFields = ['periodStart', 'periodEnd', 'resetAt'] as const;
  const unlimited = record.unlimited === true;
  if (
    typeof record.usedReports !== 'number'
    || !Number.isFinite(record.usedReports)
    || dateFields.some((field) => typeof record[field] !== 'string')
    || typeof record.exhausted !== 'boolean'
    || (record.tierKey !== 'free' && record.tierKey !== 'premium')
    || typeof record.unlimited !== 'boolean'
    || (unlimited && record.tierKey !== 'premium')
    || (unlimited && (
      record.limitReports !== null
      || record.remainingReports !== null
      || record.percentUsed !== null
      || record.exhausted
    ))
    || (!unlimited && [record.limitReports, record.remainingReports, record.percentUsed]
      .some((field) => typeof field !== 'number' || !Number.isFinite(field)))
  ) {
    return null;
  }
  const tierKey: AccountReportUsage['tierKey'] = record.tierKey === 'premium' ? 'premium' : 'free';
  const baseUsage = {
    tierKey,
    usedReports: record.usedReports as number,
    periodStart: record.periodStart as string,
    periodEnd: record.periodEnd as string,
    resetAt: record.resetAt as string,
  };
  if (unlimited) {
    return {
      ...baseUsage,
      tierKey: 'premium',
      unlimited: true,
      limitReports: null,
      remainingReports: null,
      percentUsed: null,
      exhausted: false,
    };
  }
  return {
    ...baseUsage,
    unlimited: false,
    limitReports: record.limitReports as number,
    remainingReports: record.remainingReports as number,
    percentUsed: record.percentUsed as number,
    exhausted: record.exhausted,
  };
}
