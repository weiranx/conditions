'use strict';

const { readSessionToken } = require('../auth/account-access');
const { FREE_ACCOUNT_TIER } = require('../auth/account-tier');
const {
  ObjectiveWatchLimitError,
  ObjectiveWatchPremiumRequiredError,
  resolveObjectiveWatchPolicy,
} = require('../auth/objective-watch-entitlements');
const { assertFeatureEnabled } = require('../utils/feature-flags');
const { normalizeSavedReport } = require('./saved-reports');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

class ObjectiveWatchValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ObjectiveWatchValidationError';
    this.statusCode = statusCode;
  }
}

const normalizeCoordinate = (value, min, max, label) => {
  const coordinate = Number(value);
  if (!Number.isFinite(coordinate) || coordinate < min || coordinate > max) {
    throw new ObjectiveWatchValidationError(`Provide a valid ${label}.`);
  }
  return coordinate;
};

const normalizeWatchPlan = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ObjectiveWatchValidationError('The report snapshot is missing its plan.');
  }
  const lat = normalizeCoordinate(value.lat, -90, 90, 'latitude');
  const lon = normalizeCoordinate(value.lon, -180, 180, 'longitude');
  const forecastDate = String(value.forecastDate || '');
  const alpineStartTime = String(value.alpineStartTime || '');
  const travelWindowHours = Number(value.travelWindowHours);
  if (!DATE_PATTERN.test(forecastDate)) {
    throw new ObjectiveWatchValidationError('Provide a valid forecast date.');
  }
  if (!TIME_PATTERN.test(alpineStartTime)) {
    throw new ObjectiveWatchValidationError('Provide a valid alpine start time.');
  }
  if (!Number.isInteger(travelWindowHours) || travelWindowHours < 1 || travelWindowHours > 24) {
    throw new ObjectiveWatchValidationError('Provide a travel window from 1 to 24 hours.');
  }
  return { ...value, lat, lon, forecastDate, alpineStartTime, travelWindowHours };
};

const createWatchFingerprint = (plan) => [
  plan.lat.toFixed(4),
  plan.lon.toFixed(4),
  plan.forecastDate,
  plan.alpineStartTime,
  plan.travelWindowHours,
].join(':');

const normalizeObjectiveWatch = (value) => {
  const plan = normalizeWatchPlan(value?.plan);
  const report = { ...value, plan };
  const normalizedReport = normalizeSavedReport(report);
  return {
    title: normalizedReport.title,
    fingerprint: createWatchFingerprint(plan),
    plan,
    baselineReport: report,
    serializedPlan: JSON.stringify(plan),
    serializedReport: normalizedReport.serialized,
  };
};

const normalizeTimestamp = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

const mapObjectiveWatch = (row, { includeBaseline = false, policy = null } = {}) => ({
  id: row.id,
  title: row.title,
  plan: row.plan,
  ...(includeBaseline ? { baselineReport: row.baseline_report } : {}),
  lastCheckedAt: normalizeTimestamp(row.last_checked_at),
  nextCheckAt: policy?.automaticChecks === false ? null : normalizeTimestamp(row.next_check_at),
  lastChange: row.last_change || null,
  consecutiveFailures: Math.max(0, Number(row.consecutive_failures) || 0),
  notificationsEnabled: policy?.emailAlerts === false ? false : row.notifications_enabled === true,
  createdAt: normalizeTimestamp(row.created_at),
  updatedAt: normalizeTimestamp(row.updated_at),
});

const mapObjectiveWatchEvent = (row) => ({
  id: String(row.id),
  change: row.change || null,
  checkedAt: normalizeTimestamp(row.checked_at),
});

const mapObjectiveWatchCheck = (row) => ({
  id: String(row.id),
  checkType: row.check_type,
  status: row.status,
  summary: row.summary || null,
  change: row.change || null,
  error: row.error ? 'Conditions data was unavailable for this check.' : null,
  checkedAt: normalizeTimestamp(row.checked_at),
});

const registerObjectiveWatchRoutes = ({
  app,
  database,
  accountService,
  tierService,
  checker,
  now = Date.now,
  ensureFeatureEnabled = () => assertFeatureEnabled('objectiveWatch'),
} = {}) => {
  const activeRefreshes = new Set();
  const setNoStore = (res) => res.setHeader('Cache-Control', 'no-store');

  const requireFeature = (res) => {
    try {
      ensureFeatureEnabled();
      return true;
    } catch (error) {
      res.status(error?.statusCode || 503).json({
        error: error?.message || 'Objective Watch is unavailable.',
        ...(error?.code ? { code: error.code } : {}),
      });
      return false;
    }
  };

  const requireUser = async (req, res) => {
    setNoStore(res);
    if (!accountService?.available || typeof accountService.getUserForSession !== 'function') {
      res.status(503).json({ error: 'Accounts are temporarily unavailable. Please try again later.' });
      return null;
    }
    try {
      const user = await accountService.getUserForSession(readSessionToken(req));
      if (!user) {
        res.status(401).json({ error: 'Sign in to watch an objective.', code: 'ACCOUNT_REQUIRED' });
        return null;
      }
      return user;
    } catch (error) {
      req.log?.error({ err: error }, 'Objective watch account verification failed');
      res.status(503).json({ error: 'Account verification is temporarily unavailable. Please try again.' });
      return null;
    }
  };

  const ensureDatabase = (res) => {
    if (database?.configured && typeof database.query === 'function') return true;
    res.status(503).json({ error: 'Objective watches are temporarily unavailable. Please try again later.' });
    return false;
  };

  const getPolicy = async (req, user) => {
    let tier = { ...FREE_ACCOUNT_TIER };
    if (typeof tierService?.getAccountTier === 'function') {
      try {
        tier = await tierService.getAccountTier(user.id);
      } catch (error) {
        req.log?.warn({ err: error, userId: user.id }, 'Objective Watch tier lookup failed');
      }
    }
    return resolveObjectiveWatchPolicy(tier?.key);
  };

  const handleError = (req, res, error) => {
    if (error instanceof ObjectiveWatchLimitError || error instanceof ObjectiveWatchPremiumRequiredError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
        policy: error.policy,
      });
    }
    if (error instanceof ObjectiveWatchValidationError || error?.name === 'SavedReportValidationError') {
      return res.status(error.statusCode || 400).json({ error: error.message });
    }
    req.log?.error({ err: error }, 'Objective watch request failed');
    return res.status(500).json({ error: 'Objective watch request failed. Please try again.' });
  };

  app.get('/api/account/objective-watches', async (req, res) => {
    if (!requireFeature(res)) return;
    const user = await requireUser(req, res);
    if (!user || !ensureDatabase(res)) return;
    try {
      const policy = await getPolicy(req, user);
      const hasPlanLookup = ['lat', 'lon', 'forecastDate', 'alpineStartTime', 'travelWindowHours']
        .some((key) => req.query[key] !== undefined);
      if (hasPlanLookup) {
        const plan = normalizeWatchPlan(req.query);
        const result = await database.query(`
          SELECT id, title, plan, baseline_report, last_checked_at, next_check_at,
                 last_change, consecutive_failures, notifications_enabled, created_at, updated_at
          FROM objective_watches
          WHERE user_id = $1 AND fingerprint = $2
          LIMIT 1
        `, [user.id, createWatchFingerprint(plan)]);
        return res.json({
          watch: result.rows[0] ? mapObjectiveWatch(result.rows[0], { includeBaseline: true, policy }) : null,
          policy,
        });
      }
      const result = await database.query(`
        SELECT id, title, plan, last_checked_at, next_check_at, last_change,
               consecutive_failures, notifications_enabled, created_at, updated_at
        FROM objective_watches
        WHERE user_id = $1
        ORDER BY updated_at DESC, id DESC
        LIMIT 100
      `, [user.id]);
      return res.json({ watches: result.rows.map((row) => mapObjectiveWatch(row, { policy })), policy });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.post('/api/account/objective-watches', async (req, res) => {
    if (!requireFeature(res)) return;
    const user = await requireUser(req, res);
    if (!user || !ensureDatabase(res)) return;
    try {
      if (typeof database.transaction !== 'function') {
        return res.status(503).json({ error: 'Objective watch limits are temporarily unavailable. Please try again.' });
      }
      const policy = await getPolicy(req, user);
      const watch = normalizeObjectiveWatch(req.body?.report);
      const result = await database.transaction(async (query) => {
        await query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
        const existing = await query(`
          SELECT id
          FROM objective_watches
          WHERE user_id = $1 AND fingerprint = $2
          LIMIT 1
        `, [user.id, watch.fingerprint]);
        if (!existing.rows[0]) {
          const countResult = await query(`
            SELECT COUNT(*)::integer AS active_count
            FROM objective_watches
            WHERE user_id = $1
              AND CASE
                WHEN plan->>'forecastDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                  THEN (plan->>'forecastDate')::date
                ELSE NULL
              END >= ((NOW() - INTERVAL '14 hours') AT TIME ZONE 'UTC')::date
          `, [user.id]);
          if ((Number(countResult.rows[0]?.active_count) || 0) >= policy.activeWatchLimit) {
            throw new ObjectiveWatchLimitError(policy);
          }
        }
        return query(`
          INSERT INTO objective_watches (user_id, fingerprint, title, plan, baseline_report, next_check_at)
          VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, CASE WHEN $6 THEN NOW() ELSE NULL END)
          ON CONFLICT (user_id, fingerprint) DO UPDATE
          SET title = EXCLUDED.title,
              plan = EXCLUDED.plan,
              baseline_report = EXCLUDED.baseline_report,
              last_checked_at = NULL,
              next_check_at = EXCLUDED.next_check_at,
              last_snapshot = NULL,
              last_change = NULL,
              consecutive_failures = 0,
              notifications_enabled = CASE WHEN $6 THEN objective_watches.notifications_enabled ELSE FALSE END,
              updated_at = NOW()
          RETURNING id, title, plan, baseline_report, last_checked_at, next_check_at,
                    last_change, consecutive_failures, notifications_enabled, created_at, updated_at
        `, [user.id, watch.fingerprint, watch.title, watch.serializedPlan, watch.serializedReport, policy.automaticChecks]);
      });
      return res.status(201).json({
        watch: mapObjectiveWatch(result.rows[0], { includeBaseline: true, policy }),
        policy,
      });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.patch('/api/account/objective-watches/:watchId', async (req, res) => {
    if (!requireFeature(res)) return;
    const user = await requireUser(req, res);
    if (!user || !ensureDatabase(res)) return;
    if (!UUID_PATTERN.test(String(req.params.watchId || ''))) {
      return res.status(400).json({ error: 'Invalid objective watch ID.' });
    }
    if (typeof req.body?.notificationsEnabled !== 'boolean') {
      return res.status(400).json({ error: 'notificationsEnabled must be true or false.' });
    }
    try {
      const policy = await getPolicy(req, user);
      if (req.body.notificationsEnabled && !policy.emailAlerts) {
        throw new ObjectiveWatchPremiumRequiredError('Email alerts', policy);
      }
      const result = await database.query(`
        UPDATE objective_watches
        SET notifications_enabled = $3, updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING id, title, plan, baseline_report, last_checked_at, next_check_at,
                  last_change, consecutive_failures, notifications_enabled, created_at, updated_at
      `, [req.params.watchId, user.id, req.body.notificationsEnabled]);
      if (!result.rows[0]) return res.status(404).json({ error: 'Objective watch not found.' });
      return res.json({ watch: mapObjectiveWatch(result.rows[0], { includeBaseline: true, policy }), policy });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.post('/api/account/objective-watches/:watchId/refresh', async (req, res) => {
    if (!requireFeature(res)) return;
    const user = await requireUser(req, res);
    if (!user || !ensureDatabase(res)) return;
    const watchId = String(req.params.watchId || '');
    if (!UUID_PATTERN.test(watchId)) {
      return res.status(400).json({ error: 'Invalid objective watch ID.' });
    }
    if (!checker || typeof checker.run !== 'function') {
      return res.status(503).json({ error: 'Objective Watch refresh is temporarily unavailable.' });
    }
    if (activeRefreshes.has(watchId)) {
      return res.status(409).json({ error: 'This objective watch is already refreshing.', code: 'OBJECTIVE_WATCH_REFRESH_IN_PROGRESS' });
    }
    try {
      const policy = await getPolicy(req, user);
      const current = await database.query(`
        SELECT id, title, plan, baseline_report, last_checked_at, next_check_at,
               last_change, consecutive_failures, notifications_enabled, created_at, updated_at
        FROM objective_watches
        WHERE id = $1 AND user_id = $2
        LIMIT 1
      `, [watchId, user.id]);
      if (!current.rows[0]) return res.status(404).json({ error: 'Objective watch not found.' });

      const lastCheckedAt = normalizeTimestamp(current.rows[0].last_checked_at);
      const cooldownMs = policy.manualRefreshCooldownMinutes * 60 * 1000;
      const retryAtMs = lastCheckedAt ? new Date(lastCheckedAt).getTime() + cooldownMs : 0;
      if (retryAtMs > now()) {
        return res.status(429).json({
          error: `This watch was just refreshed. Try again after ${new Date(retryAtMs).toISOString()}.`,
          code: 'OBJECTIVE_WATCH_REFRESH_COOLDOWN',
          retryAt: new Date(retryAtMs).toISOString(),
          policy,
        });
      }

      activeRefreshes.add(watchId);
      const summary = await checker.run({ watchId, userId: user.id, manual: true });
      if (summary.invalid > 0) {
        return res.status(410).json({ error: 'This objective plan date has ended.', code: 'OBJECTIVE_WATCH_ENDED', policy });
      }
      if (summary.failed > 0 || summary.checked === 0) {
        return res.status(502).json({ error: 'Could not refresh this objective watch. Please try again.', code: 'OBJECTIVE_WATCH_REFRESH_FAILED', policy });
      }
      const refreshed = await database.query(`
        SELECT id, title, plan, baseline_report, last_checked_at, next_check_at,
               last_change, consecutive_failures, notifications_enabled, created_at, updated_at
        FROM objective_watches
        WHERE id = $1 AND user_id = $2
        LIMIT 1
      `, [watchId, user.id]);
      return res.json({
        watch: mapObjectiveWatch(refreshed.rows[0], { includeBaseline: true, policy }),
        policy,
      });
    } catch (error) {
      return handleError(req, res, error);
    } finally {
      activeRefreshes.delete(watchId);
    }
  });

  app.get('/api/account/objective-watches/:watchId/events', async (req, res) => {
    if (!requireFeature(res)) return;
    const user = await requireUser(req, res);
    if (!user || !ensureDatabase(res)) return;
    const watchId = String(req.params.watchId || '');
    if (!UUID_PATTERN.test(watchId)) {
      return res.status(400).json({ error: 'Invalid objective watch ID.' });
    }
    try {
      const policy = await getPolicy(req, user);
      const result = await database.query(`
        SELECT events.id, events.change, events.checked_at
        FROM objective_watch_events events
        JOIN objective_watches watches ON watches.id = events.watch_id
        WHERE watches.id = $1
          AND watches.user_id = $2
          AND events.checked_at >= NOW() - ($3::integer * INTERVAL '1 day')
        ORDER BY events.checked_at DESC, events.id DESC
        LIMIT 100
      `, [watchId, user.id, policy.historyDays]);
      return res.json({ events: result.rows.map(mapObjectiveWatchEvent), policy });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.get('/api/account/objective-watches/:watchId/checks', async (req, res) => {
    if (!requireFeature(res)) return;
    const user = await requireUser(req, res);
    if (!user || !ensureDatabase(res)) return;
    const watchId = String(req.params.watchId || '');
    if (!UUID_PATTERN.test(watchId)) {
      return res.status(400).json({ error: 'Invalid objective watch ID.' });
    }
    try {
      const policy = await getPolicy(req, user);
      const result = await database.query(`
        SELECT checks.id, checks.check_type, checks.status, checks.summary,
               checks.change, checks.error, checks.checked_at
        FROM objective_watch_checks checks
        JOIN objective_watches watches ON watches.id = checks.watch_id
        WHERE watches.id = $1
          AND watches.user_id = $2
          AND checks.checked_at >= NOW() - ($3::integer * INTERVAL '1 day')
        ORDER BY checks.checked_at DESC, checks.id DESC
        LIMIT 1000
      `, [watchId, user.id, policy.historyDays]);
      return res.json({ checks: result.rows.map(mapObjectiveWatchCheck), policy });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.delete('/api/account/objective-watches/:watchId', async (req, res) => {
    if (!requireFeature(res)) return;
    const user = await requireUser(req, res);
    if (!user || !ensureDatabase(res)) return;
    if (!UUID_PATTERN.test(String(req.params.watchId || ''))) {
      return res.status(400).json({ error: 'Invalid objective watch ID.' });
    }
    try {
      const result = await database.query(`
        DELETE FROM objective_watches
        WHERE id = $1 AND user_id = $2
        RETURNING id
      `, [req.params.watchId, user.id]);
      if (!result.rows[0]) return res.status(404).json({ error: 'Objective watch not found.' });
      return res.status(204).end();
    } catch (error) {
      return handleError(req, res, error);
    }
  });
};

module.exports = {
  ObjectiveWatchValidationError,
  createWatchFingerprint,
  mapObjectiveWatch,
  mapObjectiveWatchEvent,
  normalizeObjectiveWatch,
  normalizeWatchPlan,
  registerObjectiveWatchRoutes,
};
