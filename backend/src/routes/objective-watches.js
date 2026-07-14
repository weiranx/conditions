'use strict';

const { readSessionToken } = require('../auth/account-access');
const { assertFeatureEnabled } = require('../utils/feature-flags');
const { normalizeSavedReport } = require('./saved-reports');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

const createWatchFingerprint = (lat, lon) => `${lat.toFixed(4)}:${lon.toFixed(4)}`;

const normalizeObjectiveWatch = (value) => {
  const normalizedReport = normalizeSavedReport(value);
  const lat = normalizeCoordinate(value.plan.lat, -90, 90, 'latitude');
  const lon = normalizeCoordinate(value.plan.lon, -180, 180, 'longitude');
  return {
    title: normalizedReport.title,
    fingerprint: createWatchFingerprint(lat, lon),
    plan: value.plan,
    baselineReport: value,
    serializedPlan: JSON.stringify(value.plan),
    serializedReport: normalizedReport.serialized,
  };
};

const normalizeTimestamp = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

const mapObjectiveWatch = (row, { includeBaseline = false } = {}) => ({
  id: row.id,
  title: row.title,
  plan: row.plan,
  ...(includeBaseline ? { baselineReport: row.baseline_report } : {}),
  createdAt: normalizeTimestamp(row.created_at),
  updatedAt: normalizeTimestamp(row.updated_at),
});

const registerObjectiveWatchRoutes = ({
  app,
  database,
  accountService,
  ensureFeatureEnabled = () => assertFeatureEnabled('objectiveWatch'),
} = {}) => {
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

  const handleError = (req, res, error) => {
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
      const hasCoordinates = req.query.lat !== undefined || req.query.lon !== undefined;
      if (hasCoordinates) {
        const lat = normalizeCoordinate(req.query.lat, -90, 90, 'latitude');
        const lon = normalizeCoordinate(req.query.lon, -180, 180, 'longitude');
        const result = await database.query(`
          SELECT id, title, plan, baseline_report, created_at, updated_at
          FROM objective_watches
          WHERE user_id = $1 AND fingerprint = $2
          LIMIT 1
        `, [user.id, createWatchFingerprint(lat, lon)]);
        return res.json({ watch: result.rows[0] ? mapObjectiveWatch(result.rows[0], { includeBaseline: true }) : null });
      }
      const result = await database.query(`
        SELECT id, title, plan, created_at, updated_at
        FROM objective_watches
        WHERE user_id = $1
        ORDER BY updated_at DESC, id DESC
        LIMIT 100
      `, [user.id]);
      return res.json({ watches: result.rows.map((row) => mapObjectiveWatch(row)) });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.post('/api/account/objective-watches', async (req, res) => {
    if (!requireFeature(res)) return;
    const user = await requireUser(req, res);
    if (!user || !ensureDatabase(res)) return;
    try {
      const watch = normalizeObjectiveWatch(req.body?.report);
      const result = await database.query(`
        INSERT INTO objective_watches (user_id, fingerprint, title, plan, baseline_report)
        VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
        ON CONFLICT (user_id, fingerprint) DO UPDATE
        SET title = EXCLUDED.title,
            plan = EXCLUDED.plan,
            baseline_report = EXCLUDED.baseline_report,
            updated_at = NOW()
        RETURNING id, title, plan, baseline_report, created_at, updated_at
      `, [user.id, watch.fingerprint, watch.title, watch.serializedPlan, watch.serializedReport]);
      return res.status(201).json({ watch: mapObjectiveWatch(result.rows[0], { includeBaseline: true }) });
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
  normalizeObjectiveWatch,
  registerObjectiveWatchRoutes,
};
