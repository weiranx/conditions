'use strict';

const { createHash, randomUUID } = require('crypto');

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_CHECK_INTERVAL_MINUTES = 180;
const ONE_HOUR_MS = 60 * 60 * 1000;
const FORTY_EIGHT_HOURS_MS = 48 * ONE_HOUR_MS;
const PLAN_DATE_EXPIRY_GRACE_MS = 14 * ONE_HOUR_MS;
const CHANGE_RETENTION_DAYS = 90;
const CHECK_RETENTION_DAYS = 90;
const OBJECTIVE_WATCH_CLAIM_LEASE_MS = 15 * 60 * 1000;

const ACCOUNT_TIER_JOIN = `
  LEFT JOIN LATERAL (
    SELECT CASE
      WHEN LOWER(account_subscription.plan_key) = 'premium'
        OR LEFT(LOWER(account_subscription.plan_key), 8) = 'premium_'
      THEN 'premium'
      ELSE 'free'
    END AS tier_key
    FROM subscriptions account_subscription
    WHERE account_subscription.user_id = watches.user_id
      AND LOWER(account_subscription.status) IN ('active', 'trialing')
      AND (account_subscription.current_period_end IS NULL OR account_subscription.current_period_end > NOW())
      AND (
        (LOWER(account_subscription.provider) = 'admin' AND LOWER(account_subscription.plan_key) IN ('free', 'premium'))
        OR LOWER(account_subscription.plan_key) = 'premium'
        OR LEFT(LOWER(account_subscription.plan_key), 8) = 'premium_'
      )
    ORDER BY CASE WHEN LOWER(account_subscription.provider) = 'admin' THEN 0 ELSE 1 END,
             account_subscription.updated_at DESC
    LIMIT 1
  ) account_tier ON TRUE
`;

const finiteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const maxFinite = (values) => {
  const finite = values.map(finiteNumber).filter((value) => value !== null);
  return finite.length > 0 ? Math.max(...finite) : null;
};

const uniqueSorted = (values) => [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].sort();

const tierRank = (value) => {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('extreme')) return 5;
  if (normalized.includes('high')) return 4;
  if (normalized.includes('elevated') || normalized.includes('considerable')) return 3;
  if (normalized.includes('caution') || normalized.includes('moderate')) return 2;
  if (normalized.includes('low')) return 1;
  return 0;
};

const terrainRank = (value) => ({ low: 1, moderate: 2, high: 3 }[String(value || '').toLowerCase()] || 0);

const parsePlannedStart = (plan) => {
  const date = String(plan?.forecastDate || '');
  const time = /^\d{2}:\d{2}$/u.test(String(plan?.alpineStartTime || '')) ? plan.alpineStartTime : '12:00';
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return null;
  const parsed = new Date(`${date}T${time}:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const planDateHasEnded = (plan, now) => {
  const date = String(plan?.forecastDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return true;
  const end = new Date(`${date}T23:59:59.999Z`);
  return Number.isNaN(end.getTime()) || now.getTime() > end.getTime() + PLAN_DATE_EXPIRY_GRACE_MS;
};

const calculateNextCheckAt = (plan, checkedAt, standardIntervalMinutes = DEFAULT_CHECK_INTERVAL_MINUTES) => {
  const now = new Date(checkedAt);
  if (Number.isNaN(now.getTime()) || planDateHasEnded(plan, now)) return null;
  const plannedStart = parsePlannedStart(plan);
  const untilStartMs = plannedStart ? plannedStart.getTime() - now.getTime() : 0;
  const parsedIntervalMinutes = Number(standardIntervalMinutes);
  const normalizedIntervalMinutes = Number.isFinite(parsedIntervalMinutes) && parsedIntervalMinutes >= 5
    ? parsedIntervalMinutes
    : DEFAULT_CHECK_INTERVAL_MINUTES;
  const cadenceMinutes = untilStartMs > FORTY_EIGHT_HOURS_MS
    ? normalizedIntervalMinutes
    : Math.min(normalizedIntervalMinutes, 60);
  const cadenceMs = cadenceMinutes * 60 * 1000;
  return new Date(now.getTime() + cadenceMs);
};

const buildPlanKey = (plan) => {
  const lat = finiteNumber(plan?.lat);
  const lon = finiteNumber(plan?.lon);
  if (lat === null || lon === null) return null;
  return [
    lat.toFixed(4),
    lon.toFixed(4),
    String(plan?.forecastDate || ''),
    String(plan?.alpineStartTime || ''),
    String(plan?.travelWindowHours || 12),
  ].join(':');
};

const extractWatchSignals = (payload) => {
  const weatherTrend = Array.isArray(payload?.weather?.trend) ? payload.weather.trend : [];
  const closures = Array.isArray(payload?.localConditions?.closures?.alerts)
    ? payload.localConditions.closures.alerts
    : [];
  const alerts = Array.isArray(payload?.alerts?.alerts) ? payload.alerts.alerts : [];
  return {
    partial: payload?.partialData === true,
    score: finiteNumber(payload?.safety?.score),
    tier: String(payload?.safety?.tier || ''),
    avalancheDanger: finiteNumber(payload?.avalanche?.dangerLevel),
    maxWindGust: maxFinite([payload?.weather?.windGust, ...weatherTrend.map((point) => point?.gust)]),
    maxPrecipChance: maxFinite([payload?.weather?.precipChance, ...weatherTrend.map((point) => point?.precipChance)]),
    terrainImpact: String(payload?.terrainCondition?.impact || ''),
    closureTitles: uniqueSorted(closures.map((closure) => closure?.title)),
    alertKeys: uniqueSorted(alerts.map((alert) => `${alert?.event || 'Weather alert'}:${alert?.severity || ''}`)),
  };
};

const buildMeaningfulChange = (previousPayload, currentPayload, checkedAt) => {
  if (!previousPayload || !currentPayload || currentPayload.partialData === true) return null;
  const previous = extractWatchSignals(previousPayload);
  const current = extractWatchSignals(currentPayload);
  const reasons = [];

  if (previous.score !== null && current.score !== null && previous.score - current.score >= 10) {
    reasons.push({ key: 'score_drop', label: `Conditions score dropped from ${Math.round(previous.score)} to ${Math.round(current.score)}.` });
  }
  if (tierRank(current.tier) > tierRank(previous.tier)) {
    reasons.push({ key: 'risk_tier', label: `Risk tier increased from ${previous.tier || 'unknown'} to ${current.tier}.` });
  }
  if (previous.avalancheDanger !== null && current.avalancheDanger !== null && current.avalancheDanger > previous.avalancheDanger) {
    reasons.push({ key: 'avalanche_danger', label: `Avalanche danger increased from ${previous.avalancheDanger} to ${current.avalancheDanger}.` });
  }

  const previousClosures = new Set(previous.closureTitles);
  const newClosures = current.closureTitles.filter((title) => !previousClosures.has(title));
  if (newClosures.length > 0) {
    reasons.push({ key: 'new_closure', label: `New access or closure notice: ${newClosures.slice(0, 2).join('; ')}.` });
  }

  const previousAlerts = new Set(previous.alertKeys);
  const newAlerts = current.alertKeys.filter((alert) => !previousAlerts.has(alert));
  if (newAlerts.length > 0) {
    reasons.push({ key: 'new_weather_alert', label: `New weather alert: ${newAlerts.slice(0, 2).join('; ')}.` });
  }

  if (
    current.maxWindGust !== null
    && previous.maxWindGust !== null
    && ((current.maxWindGust >= 35 && previous.maxWindGust < 35)
      || (current.maxWindGust >= 25 && current.maxWindGust - previous.maxWindGust >= 15))
  ) {
    reasons.push({ key: 'wind_gust', label: `Peak gusts increased from ${Math.round(previous.maxWindGust)} to ${Math.round(current.maxWindGust)} mph.` });
  }
  if (
    current.maxPrecipChance !== null
    && previous.maxPrecipChance !== null
    && current.maxPrecipChance >= 60
    && previous.maxPrecipChance < 60
  ) {
    reasons.push({ key: 'precipitation', label: `Precipitation chance increased from ${Math.round(previous.maxPrecipChance)}% to ${Math.round(current.maxPrecipChance)}%.` });
  }
  if (terrainRank(current.terrainImpact) > terrainRank(previous.terrainImpact)) {
    reasons.push({ key: 'terrain_condition', label: `Terrain impact increased from ${previous.terrainImpact || 'unknown'} to ${current.terrainImpact}.` });
  }

  if (reasons.length === 0) return null;
  return {
    checkedAt: new Date(checkedAt).toISOString(),
    reasons,
    previous,
    current,
  };
};

const buildChangeKey = (watchId, change) => createHash('sha256')
  .update(`${watchId}:${String(change?.checkedAt || '').slice(0, 13)}:${JSON.stringify(change?.current || {})}:${JSON.stringify(change?.reasons?.map((reason) => reason.key) || [])}`)
  .digest('hex');

const mapWithConcurrency = async (items, concurrency, handler) => {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await handler(items[index]);
    }
  });
  await Promise.all(workers);
};

const createObjectiveWatchChecker = ({
  database,
  invokeSafetyHandler,
  emailService,
  log = console,
  now = () => new Date(),
  getCheckIntervalMinutes = async () => DEFAULT_CHECK_INTERVAL_MINUTES,
  createClaimToken = randomUUID,
  concurrency = Number(process.env.OBJECTIVE_WATCH_CONCURRENCY) || DEFAULT_CONCURRENCY,
  batchSize = Number(process.env.OBJECTIVE_WATCH_BATCH_SIZE) || DEFAULT_BATCH_SIZE,
} = {}) => {
  const deliverPendingNotifications = async () => {
    if (!emailService?.available || typeof emailService.sendObjectiveWatchChangeEmail !== 'function') return 0;
    const result = await database.query(`
      SELECT events.id, events.change_key, events.change, watches.id AS watch_id,
             watches.title, users.email, users.display_name
      FROM objective_watch_events events
      JOIN objective_watches watches ON watches.id = events.watch_id
      JOIN users ON users.id = watches.user_id
      ${ACCOUNT_TIER_JOIN}
      WHERE events.notification_status IN ('pending', 'failed')
        AND events.notification_attempts < 3
        AND watches.notifications_enabled = TRUE
        AND users.email IS NOT NULL
        AND users.email_verified_at IS NOT NULL
        AND COALESCE(account_tier.tier_key, 'free') = 'premium'
      ORDER BY events.created_at ASC
      LIMIT 20
    `);
    let sent = 0;
    for (const event of result.rows) {
      try {
        await emailService.sendObjectiveWatchChangeEmail({
          eventId: String(event.id),
          changeKey: event.change_key,
          watchId: event.watch_id,
          title: event.title,
          change: event.change,
          to: event.email,
          displayName: event.display_name,
        });
        await database.query(`
          UPDATE objective_watch_events
          SET notification_status = 'sent', notification_attempts = notification_attempts + 1,
              notification_error = NULL, notified_at = NOW()
          WHERE id = $1
        `, [event.id]);
        sent += 1;
      } catch (error) {
        await database.query(`
          UPDATE objective_watch_events
          SET notification_status = 'failed', notification_attempts = notification_attempts + 1,
              notification_error = $2
          WHERE id = $1
        `, [event.id, String(error?.message || 'Email delivery failed').slice(0, 500)]);
        log.warn?.({ err: error, watchId: event.watch_id }, 'Objective Watch notification failed');
      }
    }
    return sent;
  };

  const run = async ({
    watchId = null,
    userId = null,
    manual = false,
    manualCooldownMinutes = 5,
    claimToken: providedClaimToken = null,
  } = {}) => {
    if (!database?.configured || typeof database.query !== 'function') {
      const error = new Error('Objective Watch checks require PostgreSQL.');
      error.code = 'DATABASE_UNAVAILABLE';
      throw error;
    }
    if (typeof invokeSafetyHandler !== 'function') {
      throw new Error('Objective Watch checks require the safety report invoker.');
    }

    const checkedAt = now();
    const standardIntervalMinutes = await getCheckIntervalMinutes();
    const claimToken = providedClaimToken || createClaimToken();
    const usesExistingClaim = manual && Boolean(providedClaimToken);
    const parsedManualCooldownMinutes = Number(manualCooldownMinutes);
    const manualCooldownMs = Number.isFinite(parsedManualCooldownMinutes) && parsedManualCooldownMinutes > 0
      ? parsedManualCooldownMinutes * 60 * 1000
      : 5 * 60 * 1000;
    const leaseExpiredBefore = new Date(checkedAt.getTime() - OBJECTIVE_WATCH_CLAIM_LEASE_MS).toISOString();
    const manualCooldownBefore = new Date(checkedAt.getTime() - manualCooldownMs).toISOString();
    await database.query(`
      UPDATE objective_watches
      SET next_check_at = NULL
      WHERE next_check_at IS NOT NULL
        AND CASE
          WHEN plan->>'forecastDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            THEN plan->>'forecastDate'
          ELSE NULL
        END < TO_CHAR((NOW() - INTERVAL '14 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD')
    `);
    await database.query(`
      DELETE FROM objective_watch_events
      WHERE checked_at < NOW() - INTERVAL '${CHANGE_RETENTION_DAYS} days'
    `);
    await database.query(`
      DELETE FROM objective_watch_checks
      WHERE checked_at < NOW() - INTERVAL '${CHECK_RETENTION_DAYS} days'
    `);

    const dueResult = await database.query(`
      WITH candidate_watches AS (
        SELECT watches.id
        FROM objective_watches watches
        JOIN users ON users.id = watches.user_id
        ${ACCOUNT_TIER_JOIN}
        WHERE users.status = 'active'
          AND (
            (
              $8::boolean = TRUE
              AND watches.id = $2::uuid
              AND watches.user_id = $3::uuid
              AND watches.check_claim_token = $4::uuid
            )
            OR (
              $8::boolean = FALSE
              AND (watches.check_claimed_at IS NULL OR watches.check_claimed_at <= $6::timestamptz)
              AND (
                COALESCE(watches.last_attempted_at, watches.last_checked_at) IS NULL
                OR COALESCE(watches.last_attempted_at, watches.last_checked_at) <= $7::timestamptz
              )
              AND (
                ($2::uuid IS NOT NULL AND watches.id = $2::uuid AND watches.user_id = $3::uuid)
                OR (
                  $2::uuid IS NULL
                  AND COALESCE(account_tier.tier_key, 'free') = 'premium'
                  AND (watches.next_check_at IS NULL OR watches.next_check_at <= NOW())
                  AND CASE
                    WHEN watches.plan->>'forecastDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                      THEN watches.plan->>'forecastDate'
                    ELSE NULL
                  END >= TO_CHAR((NOW() - INTERVAL '14 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD')
                )
              )
            )
          )
        ORDER BY watches.next_check_at ASC, watches.id ASC
        LIMIT $1
        FOR UPDATE OF watches SKIP LOCKED
      ), claimed_watches AS (
        UPDATE objective_watches watches
        SET check_claimed_at = $5::timestamptz,
            check_claim_token = $4::uuid,
            last_attempted_at = $5::timestamptz
        FROM candidate_watches candidates
        WHERE watches.id = candidates.id
        RETURNING watches.*
      )
      SELECT watches.id, watches.user_id, watches.title, watches.plan,
             watches.baseline_report, watches.last_snapshot, watches.consecutive_failures,
             watches.notifications_enabled, users.email, users.display_name, users.email_verified_at,
             COALESCE(account_tier.tier_key, 'free') AS tier_key
      FROM claimed_watches watches
      JOIN users ON users.id = watches.user_id
      ${ACCOUNT_TIER_JOIN}
      ORDER BY watches.next_check_at ASC, watches.id ASC
    `, [
      Math.min(Math.max(1, Math.round(batchSize)), 500),
      manual ? watchId : null,
      manual ? userId : null,
      claimToken,
      checkedAt.toISOString(),
      leaseExpiredBefore,
      manualCooldownBefore,
      usesExistingClaim,
    ]);

    const groups = new Map();
    let invalid = 0;
    for (const watch of dueResult.rows) {
      const key = buildPlanKey(watch.plan);
      if (!key || planDateHasEnded(watch.plan, checkedAt)) {
        invalid += 1;
        await database.query(`
          UPDATE objective_watches
          SET last_attempted_at = $2, next_check_at = NULL,
              check_claimed_at = NULL, check_claim_token = NULL
          WHERE id = $1 AND check_claim_token = $3::uuid
        `, [watch.id, checkedAt.toISOString(), claimToken]);
        continue;
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(watch);
    }

    let checked = 0;
    let changed = 0;
    let failed = 0;
    await mapWithConcurrency([...groups.values()], concurrency, async (group) => {
      const sample = group[0];
      try {
        const result = await invokeSafetyHandler({
          lat: String(sample.plan.lat),
          lon: String(sample.plan.lon),
          date: sample.plan.forecastDate,
          start: sample.plan.alpineStartTime,
          travel_window_hours: String(sample.plan.travelWindowHours || 12),
          name: sample.title,
        }, { suppressReportLog: true });
        if (result?.statusCode !== 200 || !result.payload) {
          throw new Error(result?.payload?.error || `Safety report returned ${result?.statusCode || 'no response'}.`);
        }

        for (const watch of group) {
          const previousPayload = watch.last_snapshot || watch.baseline_report?.safetyData || null;
          const change = buildMeaningfulChange(previousPayload, result.payload, checkedAt);
          const premium = watch.tier_key === 'premium';
          const nextCheckAt = premium ? calculateNextCheckAt(watch.plan, checkedAt, standardIntervalMinutes) : null;
          const checkStatus = result.payload.partialData === true ? 'partial' : change ? 'changed' : 'unchanged';
          const checkSummary = extractWatchSignals(result.payload);
          const updateResult = await database.query(`
            UPDATE objective_watches
            SET last_attempted_at = $2, last_checked_at = $2, next_check_at = $3,
                last_snapshot = COALESCE($4::jsonb, last_snapshot),
                last_change = COALESCE($5::jsonb, last_change), consecutive_failures = 0,
                check_claimed_at = NULL, check_claim_token = NULL
            WHERE id = $1 AND check_claim_token = $6::uuid
            RETURNING id
          `, [
            watch.id,
            checkedAt.toISOString(),
            nextCheckAt?.toISOString() || null,
            result.payload.partialData === true ? null : JSON.stringify(result.payload),
            change ? JSON.stringify(change) : null,
            claimToken,
          ]);
          if (updateResult?.rowCount === 0) continue;
          await database.query(`
            INSERT INTO objective_watch_checks (watch_id, check_type, status, summary, change, checked_at)
            VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
          `, [
            watch.id,
            manual ? 'manual' : 'automatic',
            checkStatus,
            JSON.stringify(checkSummary),
            change ? JSON.stringify(change) : null,
            checkedAt.toISOString(),
          ]);
          checked += 1;

          if (change) {
            const notificationStatus = premium && watch.notifications_enabled && watch.email && watch.email_verified_at
              ? 'pending'
              : 'not_requested';
            await database.query(`
              INSERT INTO objective_watch_events (watch_id, change_key, change, notification_status, checked_at)
              VALUES ($1, $2, $3::jsonb, $4, $5)
              ON CONFLICT (watch_id, change_key) DO NOTHING
            `, [watch.id, buildChangeKey(watch.id, change), JSON.stringify(change), notificationStatus, checkedAt.toISOString()]);
            changed += 1;
          }
        }
      } catch (error) {
        failed += group.length;
        log.warn?.({ err: error, watchCount: group.length }, 'Objective Watch condition refresh failed');
        for (const watch of group) {
          const failureCount = Math.max(0, Number(watch.consecutive_failures) || 0) + 1;
          const retryHours = Math.min(3, 2 ** Math.max(0, failureCount - 1));
          const retryAt = watch.tier_key === 'premium'
            ? new Date(checkedAt.getTime() + retryHours * ONE_HOUR_MS)
            : null;
          const updateResult = await database.query(`
            UPDATE objective_watches
            SET consecutive_failures = $2, next_check_at = $3, last_attempted_at = $4,
                check_claimed_at = NULL, check_claim_token = NULL
            WHERE id = $1 AND check_claim_token = $5::uuid
            RETURNING id
          `, [watch.id, failureCount, retryAt?.toISOString() || null, checkedAt.toISOString(), claimToken]);
          if (updateResult?.rowCount === 0) continue;
          await database.query(`
            INSERT INTO objective_watch_checks (watch_id, check_type, status, error, checked_at)
            VALUES ($1, $2, 'failed', $3, $4)
          `, [
            watch.id,
            manual ? 'manual' : 'automatic',
            String(error?.message || 'Conditions check failed.').slice(0, 500),
            checkedAt.toISOString(),
          ]);
        }
      }
    });

    const notificationsSent = manual ? 0 : await deliverPendingNotifications();
    return {
      due: dueResult.rows.length,
      checked,
      changed,
      failed,
      invalid,
      uniquePlans: groups.size,
      notificationsSent,
      checkedAt: checkedAt.toISOString(),
    };
  };

  return { run, deliverPendingNotifications };
};

module.exports = {
  OBJECTIVE_WATCH_CLAIM_LEASE_MS,
  buildChangeKey,
  buildMeaningfulChange,
  buildPlanKey,
  calculateNextCheckAt,
  createObjectiveWatchChecker,
  extractWatchSignals,
  planDateHasEnded,
};
