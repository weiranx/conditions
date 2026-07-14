interface MultiDayUsageBase {
  unlimited: boolean;
  usedRuns: number;
  exhausted: boolean;
}

export type AccountMultiDayUsage = MultiDayUsageBase & {
  tierKey: 'free' | 'premium';
  periodStart: string;
  periodEnd: string;
  resetAt: string;
} & (
  | {
    unlimited: true;
    tierKey: 'premium';
    limitRuns: null;
    remainingRuns: null;
    percentUsed: null;
    exhausted: false;
  }
  | {
    unlimited: false;
    limitRuns: number;
    remainingRuns: number;
    percentUsed: number;
  }
);

export type GuestMultiDayUsage = MultiDayUsageBase & {
  tierKey: 'guest';
  unlimited: false;
  limitRuns: number;
  remainingRuns: number;
  percentUsed: number;
  periodStart: null;
  periodEnd: null;
  resetAt: null;
};

export type MultiDayUsage = AccountMultiDayUsage | GuestMultiDayUsage;

export function parseMultiDayUsage(value: unknown): MultiDayUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const tierKey = record.tierKey;
  const unlimited = record.unlimited === true;
  if (
    tierKey !== 'guest' && tierKey !== 'free' && tierKey !== 'premium'
    || typeof record.unlimited !== 'boolean'
    || typeof record.usedRuns !== 'number' || !Number.isFinite(record.usedRuns)
    || typeof record.exhausted !== 'boolean'
  ) return null;

  if (tierKey === 'guest') {
    if (
      unlimited
      || [record.limitRuns, record.remainingRuns, record.percentUsed]
        .some((field) => typeof field !== 'number' || !Number.isFinite(field))
      || record.periodStart !== null || record.periodEnd !== null || record.resetAt !== null
    ) return null;
    return {
      tierKey: 'guest',
      unlimited: false,
      usedRuns: record.usedRuns,
      limitRuns: record.limitRuns as number,
      remainingRuns: record.remainingRuns as number,
      percentUsed: record.percentUsed as number,
      periodStart: null,
      periodEnd: null,
      resetAt: null,
      exhausted: record.exhausted,
    };
  }

  if (['periodStart', 'periodEnd', 'resetAt'].some((field) => typeof record[field] !== 'string')) return null;
  const accountTierKey: 'free' | 'premium' = tierKey === 'premium' ? 'premium' : 'free';
  const base = {
    tierKey: accountTierKey,
    usedRuns: record.usedRuns,
    periodStart: record.periodStart as string,
    periodEnd: record.periodEnd as string,
    resetAt: record.resetAt as string,
  } as const;
  if (unlimited) {
    if (
      tierKey !== 'premium'
      || record.limitRuns !== null || record.remainingRuns !== null || record.percentUsed !== null
      || record.exhausted
    ) return null;
    return {
      ...base,
      tierKey: 'premium',
      unlimited: true,
      limitRuns: null,
      remainingRuns: null,
      percentUsed: null,
      exhausted: false,
    };
  }
  if ([record.limitRuns, record.remainingRuns, record.percentUsed]
    .some((field) => typeof field !== 'number' || !Number.isFinite(field))) return null;
  return {
    ...base,
    unlimited: false,
    limitRuns: record.limitRuns as number,
    remainingRuns: record.remainingRuns as number,
    percentUsed: record.percentUsed as number,
    exhausted: record.exhausted,
  };
}

export function parseAccountMultiDayUsage(value: unknown): AccountMultiDayUsage | null {
  const usage = parseMultiDayUsage(value);
  return usage?.tierKey === 'guest' ? null : usage;
}
