'use strict';

const { randomBytes } = require('crypto');
const { readSessionToken } = require('../auth/account-access');
const { FREE_ACCOUNT_TIER } = require('../auth/account-tier');
const { createReportUsageLimitService } = require('../auth/report-usage-limit');

const MAX_SAVED_REPORT_BYTES = 4 * 1024 * 1024;
const SAVED_REPORT_LIST_LIMIT = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,64}$/u;

const createShareToken = () => randomBytes(18).toString('base64url');

class SavedReportValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'SavedReportValidationError';
    this.statusCode = statusCode;
  }
}

const normalizeTimestamp = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

const normalizeReportCount = (value) => {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Generated report count is unavailable.');
  }
  return count;
};

const normalizeSavedReport = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SavedReportValidationError('Provide a valid report snapshot.');
  }
  if (!value.plan || typeof value.plan !== 'object' || Array.isArray(value.plan)) {
    throw new SavedReportValidationError('The report snapshot is missing its plan.');
  }
  if (!value.safetyData || typeof value.safetyData !== 'object' || Array.isArray(value.safetyData)) {
    throw new SavedReportValidationError('The report snapshot is missing report data.');
  }

  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SAVED_REPORT_BYTES) {
    throw new SavedReportValidationError('This generated report is too large to add to history.', 413);
  }
  const title = String(value.plan.objectiveName || '').trim().replace(/\s+/gu, ' ').slice(0, 160)
    || 'Backcountry report';
  return { report: value, serialized, title };
};

const mapSavedReportSummary = (row) => ({
  id: row.id,
  shareToken: row.share_token,
  title: row.title,
  objectiveName: row.objective_name || row.title,
  forecastDate: row.forecast_date || null,
  alpineStartTime: row.alpine_start_time || null,
  score: row.score !== null && row.score !== undefined && row.score !== '' && Number.isFinite(Number(row.score))
    ? Number(row.score)
    : null,
  hasAi: Boolean(row.has_ai),
  createdAt: normalizeTimestamp(row.created_at),
  updatedAt: normalizeTimestamp(row.updated_at),
});

const registerSavedReportRoutes = ({
  app,
  database,
  accountService,
  tierService,
  reportUsageService = createReportUsageLimitService({ database }),
} = {}) => {
  const setNoStore = (res) => res.setHeader('Cache-Control', 'no-store');

  const requireUser = async (req, res) => {
    setNoStore(res);
    if (!accountService?.available || typeof accountService.getUserForSession !== 'function') {
      res.status(503).json({ error: 'Accounts are temporarily unavailable. Please try again later.' });
      return null;
    }
    try {
      const user = await accountService.getUserForSession(readSessionToken(req));
      if (!user) {
        res.status(401).json({ error: 'Sign in to view generated report history.', code: 'ACCOUNT_REQUIRED' });
        return null;
      }
      return user;
    } catch (error) {
      req.log?.error({ err: error }, 'Generated report account verification failed');
      res.status(503).json({ error: 'Account verification is temporarily unavailable. Please try again.' });
      return null;
    }
  };

  const ensureDatabase = (res) => {
    if (database?.configured && typeof database.query === 'function') return true;
    res.status(503).json({ error: 'Report history is temporarily unavailable. Please try again later.' });
    return false;
  };

  const getAccountTier = async (req, user) => {
    if (typeof tierService?.getAccountTier !== 'function') return { ...FREE_ACCOUNT_TIER };
    try {
      return await tierService.getAccountTier(user.id);
    } catch (error) {
      req.log?.warn({ err: error, userId: user.id }, 'Generated report account tier could not be loaded');
      return { ...FREE_ACCOUNT_TIER };
    }
  };

  const handleError = (req, res, error) => {
    if (error instanceof SavedReportValidationError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    if (error?.code === 'REPORT_USAGE_LIMIT_REACHED') {
      return res.status(429).json({
        error: error.message,
        code: error.code,
        reportUsage: error.usage,
      });
    }
    if (error?.code === 'REPORT_USAGE_UNAVAILABLE') {
      return res.status(503).json({ error: error.message, code: error.code });
    }
    req.log?.error({ err: error }, 'Generated report request failed');
    return res.status(500).json({ error: 'Report history request failed. Please try again.' });
  };

  app.get('/api/reports/shared/:shareToken', async (req, res) => {
    setNoStore(res);
    if (!ensureDatabase(res)) return;
    const shareToken = String(req.params.shareToken || '');
    if (!SHARE_TOKEN_PATTERN.test(shareToken)) {
      return res.status(404).json({ error: 'Shared report not found.' });
    }
    try {
      const result = await database.query(`
        SELECT title, report, created_at, updated_at
        FROM saved_reports
        WHERE share_token = $1
        LIMIT 1
      `, [shareToken]);
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: 'Shared report not found.' });
      return res.json({
        report: {
          title: row.title,
          snapshot: row.report,
          createdAt: normalizeTimestamp(row.created_at),
          updatedAt: normalizeTimestamp(row.updated_at),
        },
      });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.get('/api/account/reports', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user || !ensureDatabase(res)) return;
    try {
      const result = await database.query(`
        SELECT id, share_token, title, created_at, updated_at,
               report #>> '{plan,objectiveName}' AS objective_name,
               report #>> '{plan,forecastDate}' AS forecast_date,
               report #>> '{plan,alpineStartTime}' AS alpine_start_time,
               report #>> '{safetyData,safety,score}' AS score,
               (
                 NULLIF(report #>> '{ai,aiBriefNarrative}', '') IS NOT NULL
                 OR NULLIF(report #>> '{ai,snowVisionAnalysis}', '') IS NOT NULL
                 OR report #>> '{route,routeAnalysis,analysisSource}' = 'ai'
                 OR CASE
                   WHEN jsonb_typeof(report #> '{ai,reportChatMessages}') = 'array'
                     THEN jsonb_array_length(report #> '{ai,reportChatMessages}') > 0
                   ELSE FALSE
                 END
               ) AS has_ai
        FROM saved_reports
        WHERE user_id = $1
        ORDER BY updated_at DESC, id DESC
        LIMIT $2
      `, [user.id, SAVED_REPORT_LIST_LIMIT]);
      return res.json({ reports: result.rows.map(mapSavedReportSummary) });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.get('/api/account/reports/comparison-baseline', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user || !ensureDatabase(res)) return;
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const forecastDate = String(req.query.forecastDate || '');
    const alpineStartTime = String(req.query.alpineStartTime || '');
    const excludeReportId = req.query.excludeReportId ? String(req.query.excludeReportId) : null;
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'Provide valid objective coordinates.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(forecastDate) || !/^\d{2}:\d{2}$/u.test(alpineStartTime)) {
      return res.status(400).json({ error: 'Provide a valid forecast date and start time.' });
    }
    if (excludeReportId && !UUID_PATTERN.test(excludeReportId)) {
      return res.status(400).json({ error: 'Invalid report ID.' });
    }
    try {
      const result = await database.query(`
        SELECT id, report, created_at, updated_at
        FROM saved_reports
        WHERE user_id = $1
          AND ABS((report #>> '{plan,lat}')::double precision - $2) <= 0.001
          AND ABS((report #>> '{plan,lon}')::double precision - $3) <= 0.001
          AND report #>> '{plan,forecastDate}' = $4
          AND report #>> '{plan,alpineStartTime}' = $5
          AND ($6::uuid IS NULL OR id <> $6::uuid)
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `, [user.id, lat, lon, forecastDate, alpineStartTime, excludeReportId]);
      const row = result.rows[0];
      return res.json({
        baseline: row ? {
          reportId: row.id,
          snapshot: row.report,
          createdAt: normalizeTimestamp(row.created_at),
          updatedAt: normalizeTimestamp(row.updated_at),
        } : null,
      });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.get('/api/account/reports/:reportId', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user || !ensureDatabase(res)) return;
    if (!UUID_PATTERN.test(String(req.params.reportId || ''))) {
      return res.status(400).json({ error: 'Invalid report ID.' });
    }
    try {
      const result = await database.query(`
        SELECT id, share_token, title, report, created_at, updated_at
        FROM saved_reports
        WHERE id = $1 AND user_id = $2
        LIMIT 1
      `, [req.params.reportId, user.id]);
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: 'Generated report not found.' });
      return res.json({
        report: {
          id: row.id,
          shareToken: row.share_token,
          title: row.title,
          snapshot: row.report,
          createdAt: normalizeTimestamp(row.created_at),
          updatedAt: normalizeTimestamp(row.updated_at),
        },
      });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.post('/api/account/reports', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user || !ensureDatabase(res)) return;
    try {
      const normalized = normalizeSavedReport(req.body?.report);
      if (!reportUsageService?.available || typeof reportUsageService.consumeReportSlot !== 'function') {
        return res.status(503).json({
          error: 'Report usage is temporarily unavailable. Please try again later.',
          code: 'REPORT_USAGE_UNAVAILABLE',
        });
      }
      const accountTier = await getAccountTier(req, user);
      const shareToken = createShareToken();
      const { result, reportUsage } = await reportUsageService.consumeReportSlot(
        user.id,
        accountTier.key,
        async (query) => {
          const createdReport = await query(`
            INSERT INTO saved_reports (user_id, share_token, title, report)
            VALUES ($1, $2, $3, $4::jsonb)
            RETURNING id, share_token, title, created_at, updated_at
          `, [user.id, shareToken, normalized.title, normalized.serialized]);
          const countResult = await query(`
            SELECT COUNT(*)::bigint AS report_count
            FROM saved_reports
            WHERE user_id = $1
          `, [user.id]);
          return {
            createdReport,
            reportCount: normalizeReportCount(countResult?.rows?.[0]?.report_count),
          };
        },
      );
      const row = result.createdReport.rows[0];
      return res.status(201).json({
        report: {
          id: row.id,
          shareToken: row.share_token,
          title: row.title,
          createdAt: normalizeTimestamp(row.created_at),
          updatedAt: normalizeTimestamp(row.updated_at),
        },
        reportCount: result.reportCount,
        reportUsage,
      });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.put('/api/account/reports/:reportId', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user || !ensureDatabase(res)) return;
    if (!UUID_PATTERN.test(String(req.params.reportId || ''))) {
      return res.status(400).json({ error: 'Invalid report ID.' });
    }
    try {
      const normalized = normalizeSavedReport(req.body?.report);
      const result = await database.query(`
        UPDATE saved_reports
        SET report = jsonb_set(
              jsonb_set(report, '{ai}', COALESCE($3::jsonb -> 'ai', '{}'::jsonb), true),
              '{route}', COALESCE($3::jsonb -> 'route', '{}'::jsonb), true
            ),
            updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING id, share_token, title, created_at, updated_at
      `, [req.params.reportId, user.id, normalized.serialized]);
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: 'Generated report not found.' });
      return res.json({
        report: {
          id: row.id,
          shareToken: row.share_token,
          title: row.title,
          createdAt: normalizeTimestamp(row.created_at),
          updatedAt: normalizeTimestamp(row.updated_at),
        },
      });
    } catch (error) {
      return handleError(req, res, error);
    }
  });
};

module.exports = {
  MAX_SAVED_REPORT_BYTES,
  SAVED_REPORT_LIST_LIMIT,
  SHARE_TOKEN_PATTERN,
  SavedReportValidationError,
  createShareToken,
  mapSavedReportSummary,
  normalizeSavedReport,
  registerSavedReportRoutes,
};
