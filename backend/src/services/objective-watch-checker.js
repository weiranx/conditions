'use strict';

const { createHash, randomUUID } = require('crypto');
const { toFiniteOrNull: finiteNumber } = require('../utils/numbers');

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

const planDateHasEnded = (plan, now, timeZone = null) => {
  const date = String(plan?.forecastDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return true;
  // Forecast dates belong to the objective's timezone, not the server's day.
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(now);
      const part = (type) => parts.find((value) => value.type === type).value;
      return date < `${part('year')}-${part('month')}-${part('day')}`;
    } catch {
      // Older snapshots may lack a usable timezone; retain the global grace.
    }
  }
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

// Re-check with the activity the reference snapshot was scored for. Snapshots
// scored before activity weighting carry no safety.activity and keep scoring as
// general backcountry, so a watch never reports a jump caused by the model.
const watchScoringActivity = (watch) => {
  const activity = (watch.last_snapshot || watch.baseline_report?.safetyData)?.safety?.activity;
  return typeof activity === 'string' && activity ? activity : null;
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

// NWS statuses that mean the alert feed answered. Anything else ('unavailable')
// is an outage, and its empty alert list says nothing about active alerts.
const ANSWERED_ALERT_STATUSES = new Set(['ok', 'none', 'none_for_selected_start']);
const AVALANCHE_DANGER_LABELS = ['No rating', 'Low', 'Moderate', 'Considerable', 'High', 'Extreme'];

// Each compared signal and the reason keys that report it getting worse or better.
const SIGNAL_REASON_KEYS = {
  score: ['score_drop', 'score_improvement'],
  tier: ['risk_tier', 'risk_tier_improvement'],
  avalancheDanger: ['avalanche_danger', 'avalanche_danger_improvement'],
  closureTitles: ['new_closure', 'closure_lifted'],
  alertKeys: ['new_weather_alert', 'weather_alert_cleared'],
  maxWindGust: ['wind_gust', 'wind_gust_improvement'],
  maxPrecipChance: ['precipitation', 'precipitation_improvement'],
  terrainImpact: ['terrain_condition', 'terrain_condition_improvement'],
  // Along an analyzed route saved with the watch's report, at each checkpoint's arrival.
  routeMaxWindGust: ['route_wind_gust', 'route_wind_gust_improvement'],
  routeMaxPrecipChance: ['route_precipitation', 'route_precipitation_improvement'],
  routeAlertKeys: ['route_weather_alert', 'route_weather_alert_cleared'],
};
// Route checkpoints re-checked per watch; each is a safety report.
const MAX_ROUTE_CHECKPOINTS = 10;
const COMPARED_SIGNALS = Object.keys(SIGNAL_REASON_KEYS);
const IMPROVEMENT_REASON_KEYS = new Set(Object.values(SIGNAL_REASON_KEYS).map(([, better]) => better));

const SCORE_CHANGE_POINTS = 10;
const WIND_GUST_ALERT_MPH = 35;
const WIND_GUST_JUMP_FLOOR_MPH = 25;
const WIND_GUST_JUMP_MPH = 15;
const PRECIP_ALERT_PERCENT = 60;
// A threshold crossing must also move by this much, so a forecast hovering at
// the line does not report a change on every check.
const WIND_GUST_CROSSING_MARGIN_MPH = 5;
const PRECIP_CROSSING_MARGIN_PERCENT = 10;

const readAvalancheDanger = (avalanche) => {
  if (!avalanche || typeof avalanche !== 'object' || avalanche.dangerUnknown === true) return null;
  const level = finiteNumber(avalanche.dangerLevel);
  return level !== null && level >= 1 && level <= 5 ? Math.round(level) : null;
};

const readAlertKeys = (alerts) => {
  if (!alerts || typeof alerts !== 'object' || !Array.isArray(alerts.alerts)) return null;
  if (alerts.status !== undefined && !ANSWERED_ALERT_STATUSES.has(alerts.status)) return null;
  return uniqueSorted(alerts.alerts.map((alert) => `${alert?.event || 'Weather alert'}:${alert?.severity || ''}`));
};

const readClosureTitles = (closures) => {
  if (!closures || typeof closures !== 'object' || closures.available !== true || !Array.isArray(closures.alerts)) {
    return null;
  }
  return uniqueSorted(closures.alerts.map((closure) => closure?.title));
};

// Missing sources read as unknown (null or ''), never as zero danger or an
// empty alert list: an outage must not look like conditions improving.
const extractWatchSignals = (payload) => {
  const weatherTrend = Array.isArray(payload?.weather?.trend) ? payload.weather.trend : [];
  const tier = String(payload?.safety?.tier || '').trim();
  const terrainImpact = String(payload?.terrainCondition?.impact || '').trim().toLowerCase();
  return {
    partial: payload?.partialData === true,
    score: finiteNumber(payload?.safety?.score),
    tier: tierRank(tier) > 0 ? tier : '',
    avalancheDanger: readAvalancheDanger(payload?.avalanche),
    maxWindGust: maxFinite([payload?.weather?.windGust, ...weatherTrend.map((point) => point?.gust)]),
    maxPrecipChance: maxFinite([payload?.weather?.precipChance, ...weatherTrend.map((point) => point?.precipChance)]),
    terrainImpact: terrainRank(terrainImpact) > 0 ? terrainImpact : '',
    closureTitles: readClosureTitles(payload?.localConditions?.closures),
    alertKeys: readAlertKeys(payload?.alerts),
  };
};

// Reference signals come back from JSONB; accept only well-formed values.
const readStoredSignals = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const tier = String(value.tier || '').trim();
  const terrainImpact = String(value.terrainImpact || '').trim().toLowerCase();
  const avalancheDanger = finiteNumber(value.avalancheDanger);
  return {
    score: finiteNumber(value.score),
    tier: tierRank(tier) > 0 ? tier : '',
    avalancheDanger: avalancheDanger !== null && avalancheDanger >= 1 && avalancheDanger <= 5 ? Math.round(avalancheDanger) : null,
    maxWindGust: finiteNumber(value.maxWindGust),
    maxPrecipChance: finiteNumber(value.maxPrecipChance),
    terrainImpact: terrainRank(terrainImpact) > 0 ? terrainImpact : '',
    closureTitles: Array.isArray(value.closureTitles) ? uniqueSorted(value.closureTitles) : null,
    alertKeys: Array.isArray(value.alertKeys) ? uniqueSorted(value.alertKeys) : null,
    routeMaxWindGust: finiteNumber(value.routeMaxWindGust),
    routeMaxPrecipChance: finiteNumber(value.routeMaxPrecipChance),
    routeAlertKeys: Array.isArray(value.routeAlertKeys) ? uniqueSorted(value.routeAlertKeys) : null,
  };
};

/**
 * The analyzed route saved with a watch's report: each checkpoint's place and its
 * arrival in minutes after the start, so it can be re-timed from the watch's plan.
 * Null when the report has no route analysis.
 */
const readWatchRoute = (watch) => {
  const waypoints = watch?.baseline_report?.route?.routeAnalysis?.waypoints;
  if (!Array.isArray(waypoints)) return null;
  const points = waypoints
    .map((point) => ({
      name: String(point?.name || 'Route checkpoint').slice(0, 100),
      lat: finiteNumber(point?.lat),
      lon: finiteNumber(point?.lon),
      offsetMinutes: finiteNumber(point?.offset_minutes),
    }))
    .filter((point) => point.lat !== null && point.lon !== null && point.offsetMinutes !== null && point.offsetMinutes >= 0)
    .slice(0, MAX_ROUTE_CHECKPOINTS);
  return points.length >= 2 ? points : null;
};

/** A checkpoint's arrival date and clock from the plan's date and start, plus its offset. */
const checkpointArrival = (plan, offsetMinutes) => {
  const start = /^\d{2}:\d{2}$/u.test(String(plan?.alpineStartTime || '')) ? plan.alpineStartTime : '06:00';
  const at = new Date(`${plan.forecastDate}T${start}:00.000Z`);
  if (Number.isNaN(at.getTime())) return null;
  const arrival = new Date(at.getTime() + Math.round(offsetMinutes) * 60 * 1000);
  return { date: arrival.toISOString().slice(0, 10), start: arrival.toISOString().slice(11, 16) };
};

/**
 * Gusts, rain chance and alerts along a watch's route, each checkpoint checked at
 * its arrival on the watch's current plan. Null without a route; an unanswered or
 * partial checkpoint leaves the route signals unknown rather than calm.
 */
const extractRouteSignals = (payloads) => {
  if (!Array.isArray(payloads) || !payloads.length || payloads.some((payload) => !payload || payload.partialData === true)) {
    return { routeMaxWindGust: null, routeMaxPrecipChance: null, routeAlertKeys: null };
  }
  const readings = (key, trendKey) => payloads.flatMap((payload) => [
    payload.weather?.[key],
    ...(Array.isArray(payload.weather?.trend) ? payload.weather.trend.slice(0, 1).map((point) => point?.[trendKey]) : []),
  ]);
  const alertSets = payloads.map((payload) => readAlertKeys(payload.alerts));
  return {
    routeMaxWindGust: maxFinite(readings('windGust', 'gust')),
    routeMaxPrecipChance: maxFinite(readings('precipChance', 'precipChance')),
    routeAlertKeys: alertSets.some((keys) => keys === null) ? null : uniqueSorted(alertSets.flat()),
  };
};

const isKnownSignal = (value) => value !== null && value !== undefined && value !== '';

const formatAlertKey = (key) => {
  const separator = key.lastIndexOf(':');
  const event = separator >= 0 ? key.slice(0, separator) : key;
  const severity = separator >= 0 ? key.slice(separator + 1).trim() : '';
  return severity && severity.toLowerCase() !== 'unknown' ? `${event} (${severity})` : event;
};

const listItems = (items, format = (item) => item) => {
  const shown = items.slice(0, 2).map(format).join('; ');
  return items.length > 2 ? `${shown}; and ${items.length - 2} more` : shown;
};

const avalancheDangerLabel = (level) => `${AVALANCHE_DANGER_LABELS[level]} (${level})`;

const summarizeDirection = (reasons) => {
  const worse = reasons.some((reason) => reason.direction === 'worse');
  const better = reasons.some((reason) => reason.direction === 'better');
  if (worse && better) return 'mixed';
  if (worse) return 'worse';
  return better ? 'better' : null;
};

// Compares only signals known on both sides, and lists what got worse first.
const compareWatchSignals = (reference, current) => {
  const reasons = [];
  const add = (key, direction, label) => reasons.push({ key, direction, label });
  const known = (signal) => isKnownSignal(reference?.[signal]) && isKnownSignal(current?.[signal]);

  if (known('score')) {
    const from = Math.round(reference.score);
    const to = Math.round(current.score);
    if (reference.score - current.score >= SCORE_CHANGE_POINTS) add('score_drop', 'worse', `Conditions score dropped from ${from} to ${to}.`);
    if (current.score - reference.score >= SCORE_CHANGE_POINTS) add('score_improvement', 'better', `Conditions score improved from ${from} to ${to}.`);
  }
  if (known('tier')) {
    const from = tierRank(reference.tier);
    const to = tierRank(current.tier);
    if (from > 0 && to > from) add('risk_tier', 'worse', `Risk tier increased from ${reference.tier} to ${current.tier}.`);
    if (to > 0 && from > to) add('risk_tier_improvement', 'better', `Risk tier decreased from ${reference.tier} to ${current.tier}.`);
  }
  if (known('avalancheDanger')) {
    const from = reference.avalancheDanger;
    const to = current.avalancheDanger;
    if (to > from) add('avalanche_danger', 'worse', `Avalanche danger increased from ${avalancheDangerLabel(from)} to ${avalancheDangerLabel(to)}.`);
    if (to < from) add('avalanche_danger_improvement', 'better', `Avalanche danger decreased from ${avalancheDangerLabel(from)} to ${avalancheDangerLabel(to)}.`);
  }
  if (known('closureTitles')) {
    const before = new Set(reference.closureTitles);
    const after = new Set(current.closureTitles);
    const added = current.closureTitles.filter((title) => !before.has(title));
    const lifted = reference.closureTitles.filter((title) => !after.has(title));
    if (added.length > 0) add('new_closure', 'worse', `New access or closure notice: ${listItems(added)}.`);
    if (lifted.length > 0) add('closure_lifted', 'better', `Access or closure notice cleared: ${listItems(lifted)}.`);
  }
  if (known('alertKeys')) {
    const before = new Set(reference.alertKeys);
    const after = new Set(current.alertKeys);
    const added = current.alertKeys.filter((alert) => !before.has(alert));
    const cleared = reference.alertKeys.filter((alert) => !after.has(alert));
    if (added.length > 0) add('new_weather_alert', 'worse', `New weather alert: ${listItems(added, formatAlertKey)}.`);
    if (cleared.length > 0) add('weather_alert_cleared', 'better', `Weather alert cleared: ${listItems(cleared, formatAlertKey)}.`);
  }
  const compareGusts = (signal, [worseKey, betterKey], where) => {
    if (!known(signal)) return;
    const from = reference[signal];
    const to = current[signal];
    const rose = (to >= WIND_GUST_ALERT_MPH && from < WIND_GUST_ALERT_MPH && to - from >= WIND_GUST_CROSSING_MARGIN_MPH)
      || (to >= WIND_GUST_JUMP_FLOOR_MPH && to - from >= WIND_GUST_JUMP_MPH);
    const eased = (from >= WIND_GUST_ALERT_MPH && to < WIND_GUST_ALERT_MPH && from - to >= WIND_GUST_CROSSING_MARGIN_MPH)
      || (from >= WIND_GUST_JUMP_FLOOR_MPH && from - to >= WIND_GUST_JUMP_MPH);
    if (rose) add(worseKey, 'worse', `${where}eak gusts increased from ${Math.round(from)} mph to ${Math.round(to)} mph.`);
    if (eased) add(betterKey, 'better', `${where}eak gusts decreased from ${Math.round(from)} mph to ${Math.round(to)} mph.`);
  };
  const comparePrecip = (signal, [worseKey, betterKey], where) => {
    if (!known(signal)) return;
    const from = reference[signal];
    const to = current[signal];
    if (to >= PRECIP_ALERT_PERCENT && from < PRECIP_ALERT_PERCENT && to - from >= PRECIP_CROSSING_MARGIN_PERCENT) {
      add(worseKey, 'worse', `${where}recipitation chance increased from ${Math.round(from)}% to ${Math.round(to)}%.`);
    }
    if (from >= PRECIP_ALERT_PERCENT && to < PRECIP_ALERT_PERCENT && from - to >= PRECIP_CROSSING_MARGIN_PERCENT) {
      add(betterKey, 'better', `${where}recipitation chance decreased from ${Math.round(from)}% to ${Math.round(to)}%.`);
    }
  };
  compareGusts('maxWindGust', SIGNAL_REASON_KEYS.maxWindGust, 'P');
  comparePrecip('maxPrecipChance', SIGNAL_REASON_KEYS.maxPrecipChance, 'P');
  if (known('terrainImpact')) {
    const from = terrainRank(reference.terrainImpact);
    const to = terrainRank(current.terrainImpact);
    if (from > 0 && to > from) add('terrain_condition', 'worse', `Terrain impact increased from ${reference.terrainImpact} to ${current.terrainImpact}.`);
    if (to > 0 && from > to) add('terrain_condition_improvement', 'better', `Terrain impact decreased from ${reference.terrainImpact} to ${current.terrainImpact}.`);
  }

  // Along the route: the worst checkpoint reading at its arrival, and any alert at a checkpoint.
  if (known('routeAlertKeys')) {
    const before = new Set(reference.routeAlertKeys);
    const after = new Set(current.routeAlertKeys);
    const added = current.routeAlertKeys.filter((alert) => !before.has(alert));
    const cleared = reference.routeAlertKeys.filter((alert) => !after.has(alert));
    if (added.length > 0) add('route_weather_alert', 'worse', `New weather alert along the route: ${listItems(added, formatAlertKey)}.`);
    if (cleared.length > 0) add('route_weather_alert_cleared', 'better', `Weather alert cleared along the route: ${listItems(cleared, formatAlertKey)}.`);
  }
  compareGusts('routeMaxWindGust', SIGNAL_REASON_KEYS.routeMaxWindGust, 'Along the route, p');
  comparePrecip('routeMaxPrecipChance', SIGNAL_REASON_KEYS.routeMaxPrecipChance, 'Along the route, p');

  return [
    ...reasons.filter((reason) => reason.direction === 'worse'),
    ...reasons.filter((reason) => reason.direction === 'better'),
  ];
};

const buildSignalChange = (reference, current, checkedAt) => {
  const reasons = compareWatchSignals(reference, current);
  if (reasons.length === 0) return null;
  return {
    checkedAt: new Date(checkedAt).toISOString(),
    direction: summarizeDirection(reasons),
    reasons,
    previous: reference,
    current,
  };
};

const buildMeaningfulChange = (previousPayload, currentPayload, checkedAt) => {
  if (!previousPayload || !currentPayload || currentPayload.partialData === true) return null;
  return buildSignalChange(extractWatchSignals(previousPayload), extractWatchSignals(currentPayload), checkedAt);
};

// Checks compare against the value last reported for each signal, not the
// previous check, so a slow drift still adds up to a reported change. A signal
// the reference lacks is filled from the first check that has it.
const advanceReferenceSignals = (reference, current, reasons) => {
  const reported = new Set(reasons.map((reason) => reason.key));
  return Object.fromEntries(COMPARED_SIGNALS.map((signal) => {
    const changed = SIGNAL_REASON_KEYS[signal].some((key) => reported.has(key));
    const value = changed || !isKnownSignal(reference?.[signal]) ? current?.[signal] : reference[signal];
    return [signal, value ?? null];
  }));
};

// Stored changes from before reasons carried a direction infer it from their key.
const normalizeWatchChange = (change) => {
  if (!change || typeof change !== 'object' || Array.isArray(change)) return null;
  const reasons = (Array.isArray(change.reasons) ? change.reasons : [])
    .filter((reason) => reason && typeof reason === 'object')
    .map((reason) => ({
      ...reason,
      direction: reason.direction === 'worse' || reason.direction === 'better'
        ? reason.direction
        : IMPROVEMENT_REASON_KEYS.has(String(reason.key || '')) ? 'better' : 'worse',
    }));
  return { ...change, reasons, direction: summarizeDirection(reasons) };
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
             watches.title, watches.plan, users.email, users.display_name
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
      const change = normalizeWatchChange(event.change);
      // Alerts promise risk increases; an event queued before directions were
      // recorded may only describe improvements.
      if (change?.direction === 'better') {
        await database.query(`
          UPDATE objective_watch_events
          SET notification_status = 'not_requested'
          WHERE id = $1
        `, [event.id]);
        continue;
      }
      try {
        await emailService.sendObjectiveWatchChangeEmail({
          eventId: String(event.id),
          changeKey: event.change_key,
          watchId: event.watch_id,
          title: event.title,
          plan: event.plan,
          change,
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
             watches.baseline_report, watches.last_snapshot, watches.reference_signals, watches.consecutive_failures,
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
    let completed = 0;
    for (const watch of dueResult.rows) {
      const key = buildPlanKey(watch.plan);
      const timeZone = watch.last_snapshot?.weather?.timezone
        || watch.baseline_report?.safetyData?.weather?.timezone;
      if (!key || planDateHasEnded(watch.plan, checkedAt, timeZone)) {
        if (!key) invalid += 1;
        else completed += 1;
        await database.query(`
          UPDATE objective_watches
          SET last_attempted_at = $2, next_check_at = NULL,
              check_claimed_at = NULL, check_claim_token = NULL
          WHERE id = $1 AND check_claim_token = $3::uuid
        `, [watch.id, checkedAt.toISOString(), claimToken]);
        continue;
      }
      const groupKey = `${key}:${watchScoringActivity(watch) || ''}`;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(watch);
    }

    let checked = 0;
    let changed = 0;
    let failed = 0;
    // Watches of the same route and plan share one set of checkpoint reports.
    const routeChecks = new Map();
    const checkWatchRoute = (watch) => {
      const points = readWatchRoute(watch);
      if (!points) return Promise.resolve(null);
      const key = JSON.stringify([watch.plan.forecastDate, watch.plan.alpineStartTime, points]);
      if (!routeChecks.has(key)) {
        routeChecks.set(key, Promise.all(points.map(async (point) => {
          const arrival = checkpointArrival(watch.plan, point.offsetMinutes);
          if (!arrival) return null;
          try {
            const result = await invokeSafetyHandler({
              lat: String(point.lat),
              lon: String(point.lon),
              date: arrival.date,
              start: arrival.start,
              travel_window_hours: '1',
              name: `Route checkpoint: ${point.name}`,
            }, { suppressReportLog: true });
            return result?.statusCode === 200 ? result.payload : null;
          } catch {
            return null;
          }
        })).then(extractRouteSignals));
      }
      return routeChecks.get(key);
    };
    await mapWithConcurrency([...groups.values()], concurrency, async (group) => {
      const sample = group[0];
      try {
        const result = await invokeSafetyHandler({
          lat: String(sample.plan.lat),
          lon: String(sample.plan.lon),
          date: sample.plan.forecastDate,
          start: sample.plan.alpineStartTime,
          travel_window_hours: String(sample.plan.travelWindowHours || 12),
          ...(watchScoringActivity(sample) ? { activity: watchScoringActivity(sample) } : {}),
          name: sample.title,
        }, { suppressReportLog: true });
        // A date that has rolled out of the forecast is finished, not a
        // provider outage. This also handles legacy snapshots without a zone.
        const rangeStart = result?.payload?.availableRange?.start;
        if (result?.statusCode === 400
          && /^\d{4}-\d{2}-\d{2}$/u.test(String(rangeStart || ''))
          && sample.plan.forecastDate < rangeStart
          && sample.plan.forecastDate < checkedAt.toISOString().slice(0, 10)) {
          for (const watch of group) {
            await database.query(`
              UPDATE objective_watches
              SET next_check_at = NULL, check_claimed_at = NULL, check_claim_token = NULL
              WHERE id = $1 AND check_claim_token = $2::uuid
            `, [watch.id, claimToken]);
            completed += 1;
          }
          return;
        }
        if (result?.statusCode !== 200 || !result.payload) {
          throw new Error(result?.payload?.error || `Safety report returned ${result?.statusCode || 'no response'}.`);
        }

        const objectiveSignals = extractWatchSignals(result.payload);
        const partial = objectiveSignals.partial;
        for (const watch of group) {
          // A route that couldn't be checked stays unknown; the objective still is.
          const routeSignals = partial ? null : await checkWatchRoute(watch);
          const currentSignals = routeSignals ? { ...objectiveSignals, ...routeSignals } : objectiveSignals;
          // Without stored reference signals (a new or re-baselined watch, or
          // one saved before they existed) compare with the latest snapshot,
          // else the baseline, so an upgrade does not replay old drift as new.
          const referenceSignals = readStoredSignals(watch.reference_signals)
            || extractWatchSignals(watch.last_snapshot || watch.baseline_report?.safetyData || null);
          const change = partial ? null : buildSignalChange(referenceSignals, currentSignals, checkedAt);
          const nextReference = partial ? null : advanceReferenceSignals(referenceSignals, currentSignals, change?.reasons || []);
          const premium = watch.tier_key === 'premium';
          const nextCheckAt = premium ? calculateNextCheckAt(watch.plan, checkedAt, standardIntervalMinutes) : null;
          const checkStatus = partial ? 'partial' : change ? 'changed' : 'unchanged';
          const updateResult = await database.query(`
            UPDATE objective_watches
            SET last_attempted_at = $2, last_checked_at = $2, next_check_at = $3,
                last_snapshot = COALESCE($4::jsonb, last_snapshot),
                last_change = COALESCE($5::jsonb, last_change), consecutive_failures = 0,
                reference_signals = COALESCE($7::jsonb, reference_signals),
                check_claimed_at = NULL, check_claim_token = NULL
            WHERE id = $1 AND check_claim_token = $6::uuid
            RETURNING id
          `, [
            watch.id,
            checkedAt.toISOString(),
            nextCheckAt?.toISOString() || null,
            partial ? null : JSON.stringify(result.payload),
            change ? JSON.stringify(change) : null,
            claimToken,
            nextReference ? JSON.stringify(nextReference) : null,
          ]);
          if (updateResult?.rowCount === 0) continue;
          await database.query(`
            INSERT INTO objective_watch_checks (watch_id, check_type, status, summary, change, checked_at)
            VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
          `, [
            watch.id,
            manual ? 'manual' : 'automatic',
            checkStatus,
            JSON.stringify(currentSignals),
            change ? JSON.stringify(change) : null,
            checkedAt.toISOString(),
          ]);
          checked += 1;

          if (change) {
            // Email alerts promise risk increases; improvements stay in-app.
            const notificationStatus = premium && watch.notifications_enabled && watch.email && watch.email_verified_at
              && change.direction !== 'better'
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
      completed,
      uniquePlans: groups.size,
      notificationsSent,
      checkedAt: checkedAt.toISOString(),
    };
  };

  return { run, deliverPendingNotifications };
};

module.exports = {
  OBJECTIVE_WATCH_CLAIM_LEASE_MS,
  advanceReferenceSignals,
  buildChangeKey,
  buildMeaningfulChange,
  buildPlanKey,
  buildSignalChange,
  calculateNextCheckAt,
  createObjectiveWatchChecker,
  extractWatchSignals,
  normalizeWatchChange,
  planDateHasEnded,
  readWatchRoute,
};
