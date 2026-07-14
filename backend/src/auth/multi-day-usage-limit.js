'use strict';

const { getMonthlyWindow } = require('./monthly-usage-limit');

const MULTI_DAY_FEATURE_KEY = 'multi_day_forecast';
const DEFAULT_FREE_MONTHLY_MULTI_DAY_LIMIT = 10;
const DEFAULT_GUEST_MULTI_DAY_LIMIT = 3;
const MAX_MULTI_DAY_LIMIT = 1_000;
const PENDING_RESERVATION_TTL_MINUTES = 15;

const parseLimit = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_MULTI_DAY_LIMIT
    ? Math.round(parsed)
    : fallback;
};

const summarizeUsage = ({ usedRuns, activeRuns = usedRuns, identityType, tierKey, limitRuns, window }) => {
  const normalizedUsedRuns = Math.max(0, Math.round(Number(usedRuns) || 0));
  const normalizedActiveRuns = Math.max(normalizedUsedRuns, Math.round(Number(activeRuns) || 0));
  const resolvedTierKey = identityType === 'guest'
    ? 'guest'
    : tierKey === 'premium' ? 'premium' : 'free';
  const unlimited = resolvedTierKey === 'premium';
  const resolvedLimit = unlimited ? null : limitRuns;
  return {
    tierKey: resolvedTierKey,
    unlimited,
    usedRuns: normalizedUsedRuns,
    limitRuns: resolvedLimit,
    remainingRuns: unlimited ? null : Math.max(0, resolvedLimit - normalizedActiveRuns),
    percentUsed: unlimited
      ? null
      : Math.min(100, Math.round((normalizedUsedRuns / resolvedLimit) * 1000) / 10),
    periodStart: window?.periodStart ?? null,
    periodEnd: window?.periodEnd ?? null,
    resetAt: window?.resetAt ?? null,
    exhausted: unlimited ? false : normalizedActiveRuns >= resolvedLimit,
  };
};

class MultiDayUsageLimitError extends Error {
  constructor(usage) {
    const message = usage?.tierKey === 'guest'
      ? 'Guest multi-day forecast limit reached. Sign in or create an account to continue.'
      : 'Monthly multi-day forecast limit reached. Your allowance resets at the start of next month.';
    super(message);
    this.name = 'MultiDayUsageLimitError';
    this.code = 'MULTI_DAY_USAGE_LIMIT_REACHED';
    this.statusCode = 429;
    this.usage = usage;
  }
}

class MultiDayUsageUnavailableError extends Error {
  constructor(message = 'Multi-day forecast usage is temporarily unavailable. Please try again later.') {
    super(message);
    this.name = 'MultiDayUsageUnavailableError';
    this.code = 'MULTI_DAY_USAGE_UNAVAILABLE';
    this.statusCode = 503;
  }
}

class MultiDayUsageConflictError extends Error {
  constructor() {
    super('This multi-day forecast request is already running.');
    this.name = 'MultiDayUsageConflictError';
    this.code = 'MULTI_DAY_USAGE_REQUEST_IN_PROGRESS';
    this.statusCode = 409;
  }
}

const createMultiDayUsageLimitService = ({
  database,
  freeMonthlyLimit = process.env.FREE_MONTHLY_MULTI_DAY_LIMIT,
  guestLimit = process.env.GUEST_MULTI_DAY_LIMIT,
  now = Date.now,
} = {}) => {
  const freeLimitRuns = parseLimit(freeMonthlyLimit, DEFAULT_FREE_MONTHLY_MULTI_DAY_LIMIT);
  const guestLimitRuns = parseLimit(guestLimit, DEFAULT_GUEST_MULTI_DAY_LIMIT);
  const available = Boolean(
    database?.configured
    && typeof database.query === 'function'
    && typeof database.transaction === 'function'
  );

  const resolveIdentity = ({ userId, anonymousId, tierKey = 'free' } = {}) => {
    if (Boolean(userId) === Boolean(anonymousId)) {
      throw new TypeError('Exactly one usage identity is required');
    }
    if (userId) {
      return {
        identityType: 'account',
        identityValue: userId,
        tierKey: tierKey === 'premium' ? 'premium' : 'free',
        limitRuns: freeLimitRuns,
        window: getMonthlyWindow(now()),
      };
    }
    return {
      identityType: 'guest',
      identityValue: anonymousId,
      tierKey: 'guest',
      limitRuns: guestLimitRuns,
      window: null,
    };
  };

  const loadCounts = async (query, identity) => {
    const identityColumn = identity.identityType === 'account' ? 'user_id' : 'anonymous_id';
    const params = [identity.identityValue];
    let periodClause = '';
    if (identity.window) {
      params.push(identity.window.periodStart, identity.window.periodEnd);
      periodClause = 'AND created_at >= $2 AND created_at < $3';
    }
    const result = await query(`
      SELECT
        COALESCE(SUM(units) FILTER (WHERE status = 'succeeded'), 0)::bigint AS used_runs,
        COALESCE(SUM(units) FILTER (
          WHERE status = 'succeeded'
             OR (status = 'pending' AND updated_at >= NOW() - INTERVAL '${PENDING_RESERVATION_TTL_MINUTES} minutes')
        ), 0)::bigint AS active_runs
      FROM feature_usage_events
      WHERE ${identityColumn} = $1
        AND feature_key = '${MULTI_DAY_FEATURE_KEY}'
        ${periodClause}
    `, params);
    return {
      usedRuns: Number(result?.rows?.[0]?.used_runs) || 0,
      activeRuns: Number(result?.rows?.[0]?.active_runs) || 0,
    };
  };

  const buildSummary = (identity, counts) => summarizeUsage({
    ...counts,
    identityType: identity.identityType,
    tierKey: identity.tierKey,
    limitRuns: identity.limitRuns,
    window: identity.window,
  });

  const getUsageWith = async (query, input) => {
    const identity = resolveIdentity(input);
    try {
      return buildSummary(identity, await loadCounts(query, identity));
    } catch (error) {
      throw new MultiDayUsageUnavailableError();
    }
  };

  const getUserUsage = async (userId, tierKey = 'free') => {
    if (!available) throw new MultiDayUsageUnavailableError();
    if (!userId) throw new TypeError('userId is required');
    return getUsageWith(database.query, { userId, tierKey });
  };

  const getGuestUsage = async (anonymousId) => {
    if (!available) throw new MultiDayUsageUnavailableError();
    if (!anonymousId) throw new TypeError('anonymousId is required');
    return getUsageWith(database.query, { anonymousId });
  };

  const reserve = async ({ userId, anonymousId, tierKey = 'free', idempotencyKey, metadata = {} } = {}) => {
    if (!available) throw new MultiDayUsageUnavailableError();
    if (!idempotencyKey) throw new TypeError('idempotencyKey is required');
    const identity = resolveIdentity({ userId, anonymousId, tierKey });

    return database.transaction(async (query) => {
      try {
        await query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `${MULTI_DAY_FEATURE_KEY}:${identity.identityType}:${identity.identityValue}`,
        ]);
        const existing = await query(`
          SELECT id, status, user_id, anonymous_id
          FROM feature_usage_events
          WHERE feature_key = $1 AND idempotency_key = $2
          LIMIT 1
        `, [MULTI_DAY_FEATURE_KEY, idempotencyKey]);
        const existingEvent = existing?.rows?.[0];
        const existingIdentity = identity.identityType === 'account'
          ? existingEvent?.user_id
          : existingEvent?.anonymous_id;
        if (existingEvent && String(existingIdentity || '') !== String(identity.identityValue)) {
          throw new MultiDayUsageConflictError();
        }
        if (existingEvent?.status === 'pending') throw new MultiDayUsageConflictError();
        if (existingEvent?.status === 'succeeded') {
          return {
            reservationId: existingEvent.id,
            duplicate: true,
            usage: await getUsageWith(query, { userId, anonymousId, tierKey }),
          };
        }

        const counts = await loadCounts(query, identity);
        const usage = buildSummary(identity, counts);
        if (usage.exhausted) throw new MultiDayUsageLimitError(usage);

        let reservationId;
        if (existingEvent?.status === 'failed') {
          await query(`
            UPDATE feature_usage_events
            SET status = 'pending', metadata = $2::jsonb, updated_at = NOW()
            WHERE id = $1
          `, [existingEvent.id, JSON.stringify(metadata)]);
          reservationId = existingEvent.id;
        } else {
          const identityColumn = identity.identityType === 'account' ? 'user_id' : 'anonymous_id';
          const inserted = await query(`
            INSERT INTO feature_usage_events (
              idempotency_key, ${identityColumn}, feature_key, status, units, metadata
            ) VALUES ($1, $2, $3, 'pending', 1, $4::jsonb)
            RETURNING id
          `, [idempotencyKey, identity.identityValue, MULTI_DAY_FEATURE_KEY, JSON.stringify(metadata)]);
          reservationId = inserted?.rows?.[0]?.id;
        }
        return {
          reservationId,
          duplicate: false,
          usage: buildSummary(identity, {
            usedRuns: counts.usedRuns,
            activeRuns: counts.activeRuns + 1,
          }),
        };
      } catch (error) {
        if (
          error instanceof MultiDayUsageLimitError
          || error instanceof MultiDayUsageConflictError
          || error instanceof MultiDayUsageUnavailableError
        ) throw error;
        throw new MultiDayUsageUnavailableError();
      }
    });
  };

  const finish = async ({ reservationId, userId, anonymousId, tierKey = 'free', succeeded } = {}) => {
    if (!available) throw new MultiDayUsageUnavailableError();
    if (!reservationId) throw new TypeError('reservationId is required');
    try {
      await database.query(`
        UPDATE feature_usage_events
        SET status = $2, updated_at = NOW()
        WHERE id = $1 AND feature_key = $3
      `, [reservationId, succeeded ? 'succeeded' : 'failed', MULTI_DAY_FEATURE_KEY]);
      return await getUsageWith(database.query, { userId, anonymousId, tierKey });
    } catch (error) {
      if (error instanceof MultiDayUsageUnavailableError) throw error;
      throw new MultiDayUsageUnavailableError();
    }
  };

  return {
    available,
    freeLimitRuns,
    guestLimitRuns,
    finish,
    getGuestUsage,
    getUserUsage,
    reserve,
  };
};

module.exports = {
  DEFAULT_FREE_MONTHLY_MULTI_DAY_LIMIT,
  DEFAULT_GUEST_MULTI_DAY_LIMIT,
  MultiDayUsageConflictError,
  MultiDayUsageLimitError,
  MultiDayUsageUnavailableError,
  createMultiDayUsageLimitService,
  summarizeUsage,
};
