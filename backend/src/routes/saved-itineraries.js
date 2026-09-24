'use strict';

const { readSessionToken } = require('../auth/account-access');
const { assertFeatureEnabled } = require('../utils/feature-flags');
const { summarizeItineraryStages } = require('../utils/itinerary-summary');

// Multi-day trips saved from the trip brief. Like saved reports these are
// snapshots: the itinerary as planned and the day-by-day check it was saved
// with. Saving is not metered; the check was, when it ran.

const MAX_SAVED_TRIP_BYTES = 5 * 1024 * 1024;
const SAVED_TRIP_LIST_LIMIT = 100;
// Keeps one account from filling the table; old trips can be deleted.
const MAX_SAVED_TRIPS_PER_USER = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

class SavedTripValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'SavedTripValidationError';
    this.statusCode = statusCode;
  }
}

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeTimestamp = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

const normalizeDate = (value) => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  const text = String(value || '');
  return DATE_PATTERN.test(text) ? text.slice(0, 10) : null;
};

/** The trip to store, or a validation error naming what is wrong. */
const normalizeSavedTrip = (value) => {
  if (!isRecord(value) || !isRecord(value.draft) || !isRecord(value.result)) {
    throw new SavedTripValidationError('Provide a checked trip to save.');
  }
  const { result } = value;
  const stages = Array.isArray(result.stages) ? result.stages : null;
  const results = Array.isArray(result.results) ? result.results : null;
  if (!stages || !results || stages.length < 2 || stages.length > 7 || results.length !== stages.length) {
    throw new SavedTripValidationError('The trip needs 2–7 checked days.');
  }
  const startDate = String(result.startDate || stages[0]?.date || '');
  if (!DATE_PATTERN.test(startDate) || !Number.isFinite(Date.parse(`${startDate}T00:00:00Z`))) {
    throw new SavedTripValidationError('The trip is missing a valid start date.');
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SAVED_TRIP_BYTES) {
    throw new SavedTripValidationError('This trip is too large to save. Remove a high point or two and check it again.', 413);
  }
  const trailhead = isRecord(value.draft.trailhead) ? String(value.draft.trailhead.name || '') : '';
  const title = String(value.title || value.draft.name || (trailhead ? `${trailhead} trip` : '') || '')
    .trim().replace(/\s+/gu, ' ').slice(0, 160) || 'Multi-day trip';
  return { serialized, title, startDate, dayCount: stages.length };
};

const mapTripSummary = (row) => ({
  id: row.id,
  title: row.title,
  startDate: normalizeDate(row.start_date),
  dayCount: Number(row.day_count) || null,
  verdictLevel: row.verdict_level || null,
  checkedAt: normalizeTimestamp(row.checked_at),
  createdAt: normalizeTimestamp(row.created_at),
  updatedAt: normalizeTimestamp(row.updated_at),
});

const registerSavedItineraryRoutes = ({
  app,
  database,
  accountService,
  ensureFeatureEnabled = () => {
    assertFeatureEnabled('tripPlanning');
    assertFeatureEnabled('reportHistory');
  },
} = {}) => {
  const setNoStore = (res) => res.setHeader('Cache-Control', 'no-store');

  const requireFeature = (res) => {
    try {
      ensureFeatureEnabled();
      return true;
    } catch (error) {
      res.status(error?.statusCode || 503).json({
        error: error?.message || 'Saved trips are unavailable.',
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
      const user = req.mcpUser || await accountService.getUserForSession(readSessionToken(req));
      if (!user) {
        res.status(401).json({ error: 'Sign in to save trips.', code: 'ACCOUNT_REQUIRED' });
        return null;
      }
      return user;
    } catch (error) {
      req.log?.error({ err: error }, 'Saved trip account verification failed');
      res.status(503).json({ error: 'Account verification is temporarily unavailable. Please try again.' });
      return null;
    }
  };

  const ensureDatabase = (res) => {
    if (database?.configured && typeof database.query === 'function') return true;
    res.status(503).json({ error: 'Saved trips are temporarily unavailable. Please try again later.' });
    return false;
  };

  const handleError = (req, res, error) => {
    if (error instanceof SavedTripValidationError) return res.status(error.statusCode).json({ error: error.message });
    req.log?.error({ err: error }, 'Saved trip request failed');
    return res.status(500).json({ error: 'Saved trip request failed. Please try again.' });
  };

  const validId = (res, id) => {
    if (UUID_PATTERN.test(String(id || ''))) return true;
    res.status(400).json({ error: 'Invalid trip ID.' });
    return false;
  };

  app.get('/api/account/trips', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user || !ensureDatabase(res)) return;
    try {
      const result = await database.query(`
        SELECT id, title, start_date::text AS start_date, day_count, created_at, updated_at,
               trip #>> '{verdictLevel}' AS verdict_level,
               trip #>> '{result,checkedAt}' AS checked_at
        FROM saved_itineraries
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2
      `, [user.id, SAVED_TRIP_LIST_LIMIT]);
      return res.json({ trips: result.rows.map(mapTripSummary) });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  // ?view=summary drops the full reports for a compact day-by-day view.
  app.get('/api/account/trips/:tripId', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user || !ensureDatabase(res) || !validId(res, req.params.tripId)) return;
    try {
      const result = await database.query(`
        SELECT id, title, start_date::text AS start_date, day_count, trip, created_at, updated_at,
               trip #>> '{verdictLevel}' AS verdict_level,
               trip #>> '{result,checkedAt}' AS checked_at
        FROM saved_itineraries
        WHERE id = $1 AND user_id = $2
        LIMIT 1
      `, [req.params.tripId, user.id]);
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: 'Saved trip not found.' });
      const trip = req.query.view === 'summary'
        ? {
            draft: row.trip?.draft ?? null,
            preferences: row.trip?.preferences ?? null,
            verdictLevel: row.trip?.verdictLevel ?? null,
            checkedAt: row.trip?.result?.checkedAt ?? null,
            stages: row.trip?.result?.stages ?? [],
            days: summarizeItineraryStages(row.trip?.result?.results),
          }
        : row.trip;
      return res.json({ trip: { ...mapTripSummary(row), snapshot: trip } });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.post('/api/account/trips', async (req, res) => {
    if (!requireFeature(res)) return;
    const user = await requireUser(req, res);
    if (!user || !ensureDatabase(res)) return;
    try {
      const normalized = normalizeSavedTrip(req.body?.trip);
      const count = await database.query('SELECT COUNT(*)::integer AS trip_count FROM saved_itineraries WHERE user_id = $1', [user.id]);
      if ((Number(count.rows[0]?.trip_count) || 0) >= MAX_SAVED_TRIPS_PER_USER) {
        throw new SavedTripValidationError(`You can keep up to ${MAX_SAVED_TRIPS_PER_USER} saved trips. Delete an old trip before saving another.`, 409);
      }
      const created = await database.query(`
        INSERT INTO saved_itineraries (user_id, title, start_date, day_count, trip)
        VALUES ($1, $2, $3::date, $4, $5::jsonb)
        RETURNING id, title, start_date::text AS start_date, day_count, created_at, updated_at,
                  trip #>> '{verdictLevel}' AS verdict_level,
                  trip #>> '{result,checkedAt}' AS checked_at
      `, [user.id, normalized.title, normalized.startDate, normalized.dayCount, normalized.serialized]);
      return res.status(201).json({ trip: mapTripSummary(created.rows[0]) });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.delete('/api/account/trips/:tripId', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user || !ensureDatabase(res) || !validId(res, req.params.tripId)) return;
    try {
      const result = await database.query('DELETE FROM saved_itineraries WHERE id = $1 AND user_id = $2', [req.params.tripId, user.id]);
      if (!result.rowCount) return res.status(404).json({ error: 'Saved trip not found.' });
      return res.status(204).end();
    } catch (error) {
      return handleError(req, res, error);
    }
  });
};

module.exports = {
  MAX_SAVED_TRIPS_PER_USER,
  MAX_SAVED_TRIP_BYTES,
  SavedTripValidationError,
  normalizeSavedTrip,
  registerSavedItineraryRoutes,
};
