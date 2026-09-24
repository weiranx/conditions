'use strict';

const { assertFeatureEnabled } = require('../utils/feature-flags');
const { toFiniteOrNull } = require('../utils/numbers');
const { summarizeItineraryStages } = require('../utils/itinerary-summary');
const { assessItinerary, buildItineraryChatContext } = require('../utils/itinerary-assessment');
const { buildPlanContext, isCalendarDate, pickPlanParams } = require('../utils/plan-context');
const {
  addUtcDays,
  resolveMultiDayCaller,
  sendUsageUnavailable,
  usageServiceReady,
} = require('./multi-day-access');

// A multi-day itinerary: one stage per day, from the trailhead or last night's
// camp to tonight's camp (or the exit on the last day). Each stage is checked
// with the single-day safety pipeline at its camp, plus any high points the
// day crosses; the night after every stage but the last is read at the camp.
// The response carries the assessment: each day and night, and the verdict.

const MIN_STAGES = 2;
const MAX_STAGES = 7;
const MAX_CHECKPOINTS_PER_STAGE = 2;
const MAX_BAIL_POINTS = 10;
// Set per day by the route; a client's own values for these are ignored.
const STAGE_PLAN_KEYS = ['date', 'start', 'travel_window_hours', 'activity', 'approach', 'trailhead_ft', 'ascent_min_per_kft', 'approach_route', 'approach_checkpoints', 'target_elevation_ft'];
// Parallel safety checks per request; an itinerary can need 21.
const STAGE_CHECK_CONCURRENCY = 6;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/u;
const MIN_ELEVATION_FT = -1500;
const MAX_ELEVATION_FT = 30000;

const INVALID_REQUEST = 'Provide a start date and 2–7 days, each with a start time, 1–24 travel hours, and valid start and end points.';

const parsePoint = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const lat = toFiniteOrNull(raw.lat);
  const lon = toFiniteOrNull(raw.lon);
  if (lat === null || lat < -90 || lat > 90 || lon === null || lon < -180 || lon > 180) return null;
  const elevationFt = toFiniteOrNull(raw.elevationFt);
  return {
    name: String(raw.name || '').trim().slice(0, 100),
    lat,
    lon,
    elevationFt: elevationFt !== null && elevationFt >= MIN_ELEVATION_FT && elevationFt <= MAX_ELEVATION_FT ? elevationFt : null,
  };
};

const samePlace = (a, b) => Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5;

/** The validated stages, or null when any part of the request is invalid. */
const parseItineraryStages = (rawStages) => {
  if (!Array.isArray(rawStages) || rawStages.length < MIN_STAGES || rawStages.length > MAX_STAGES) return null;
  const stages = [];
  for (const raw of rawStages) {
    const start = String(raw?.start || '').trim();
    const travelHours = Math.round(Number(raw?.travelHours));
    const from = parsePoint(raw?.from);
    const to = parsePoint(raw?.to);
    const rawCheckpoints = raw?.checkpoints ?? [];
    if (!TIME_PATTERN.test(start) || !Number.isInteger(travelHours) || travelHours < 1 || travelHours > 24 || !from || !to) return null;
    if (!Array.isArray(rawCheckpoints) || rawCheckpoints.length > MAX_CHECKPOINTS_PER_STAGE) return null;
    const checkpoints = rawCheckpoints.map(parsePoint);
    if (checkpoints.some((point) => !point)) return null;
    stages.push({ start, travelHours, from, to, checkpoints });
  }
  return stages;
};

// Where the day starts shapes the approach hours. An unknown start elevation,
// or a layover at camp, scores every hour at the checked point instead of
// guessing a climb from the lowest forecast band.
const approachQuery = (stage) => (stage.from.elevationFt !== null && !samePlace(stage.from, stage.to)
  ? { trailhead_ft: String(stage.from.elevationFt) }
  : { approach: 'off' });

// A camp picked from search or the map has no elevation yet. Look up each
// day's start once (the elevation service caches, and the safety checks for
// the same points reuse it) so the approach hours are not guessed.
const fillStartElevations = async (stages, fetchElevationFt) => {
  if (typeof fetchElevationFt !== 'function') return;
  await Promise.all(stages.map(async (stage) => {
    if (stage.from.elevationFt !== null || samePlace(stage.from, stage.to)) return;
    try {
      const result = await fetchElevationFt(stage.from.lat, stage.from.lon);
      const elevationFt = toFiniteOrNull(result?.elevationFt);
      if (elevationFt !== null && elevationFt >= MIN_ELEVATION_FT && elevationFt <= MAX_ELEVATION_FT) {
        stage.from.elevationFt = Math.round(elevationFt);
      }
    } catch {
      // Unknown stays unknown: the day is then scored at the checked point.
    }
  }));
};

/** Run `task` over `items` with at most `limit` in flight, keeping order. */
const mapWithConcurrency = async (items, limit, task) => {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

const registerItineraryRoutes = ({
  app,
  accountService,
  tierService,
  usageService,
  invokeSafetyHandler,
  // (lat, lon) => { elevationFt }; fills in start points the client could not.
  fetchElevationFt = null,
  ensureFeatureEnabled = () => assertFeatureEnabled('tripPlanning'),
  isProduction = process.env.NODE_ENV === 'production',
} = {}) => {
  app.post('/api/itineraries/check', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      ensureFeatureEnabled();
    } catch (error) {
      return res.status(error?.statusCode || 503).json({
        error: error?.message || 'Multi-day trip planning is unavailable.',
        ...(error?.code ? { code: error.code } : {}),
      });
    }
    const startDate = String(req.body?.startDate || '').trim();
    const stages = parseItineraryStages(req.body?.stages);
    const name = String(req.body?.name || '').trim().slice(0, 200);
    // The traveler's limits and units; every day and high point is checked against them.
    const planSettings = Object.fromEntries(Object.entries(
      pickPlanParams(req.body?.plan && typeof req.body.plan === 'object' ? req.body.plan : {}),
    ).filter(([key]) => !STAGE_PLAN_KEYS.includes(key)));
    const bailPoints = (Array.isArray(req.body?.bailPoints) ? req.body.bailPoints : [])
      .slice(0, MAX_BAIL_POINTS).map(parsePoint).filter(Boolean);
    const activity = typeof req.body?.activity === 'string' ? req.body.activity.trim().slice(0, 40) : '';
    // 'summary' returns compact evidence per day instead of full reports (MCP clients).
    const summaryView = req.body?.view === 'summary';
    const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
    // A shaped but nonexistent date ("2026-02-30") would roll into March.
    if (!isCalendarDate(startDate) || !stages) {
      return res.status(400).json({ error: INVALID_REQUEST });
    }
    if (!idempotencyKey || idempotencyKey.length > 128) {
      return res.status(400).json({ error: 'A valid Idempotency-Key header is required.' });
    }
    if (!usageServiceReady(usageService)) return sendUsageUnavailable(res);

    const caller = await resolveMultiDayCaller({ req, res, accountService, tierService, isProduction });
    if (!caller) return undefined;
    const { user, accountTier, anonymousId } = caller;
    const finish = (reservation, succeeded) => usageService.finish({
      reservationId: reservation.reservationId,
      userId: user?.id,
      anonymousId,
      tierKey: accountTier.key,
      succeeded,
    });

    let reservation = null;
    try {
      reservation = await usageService.reserve({
        userId: user?.id,
        anonymousId,
        tierKey: accountTier.key,
        idempotencyKey,
        metadata: { kind: 'itinerary', durationDays: stages.length, startDate },
      });

      await fillStartElevations(stages, fetchElevationFt);
      const checks = stages.flatMap((stage, index) => {
        const date = addUtcDays(startDate, index);
        const base = {
          ...planSettings,
          date,
          start: stage.start,
          travel_window_hours: String(stage.travelHours),
          activity: activity || undefined,
          ...approachQuery(stage),
        };
        const lastStage = index === stages.length - 1;
        return [
          { stageIndex: index, checkpointIndex: null, query: { ...base, lat: String(stage.to.lat), lon: String(stage.to.lon), name: stage.to.name || name || undefined, ...(lastStage ? {} : { camp_night: '1' }) } },
          ...stage.checkpoints.map((point, checkpointIndex) => ({
            stageIndex: index,
            checkpointIndex,
            query: { ...base, lat: String(point.lat), lon: String(point.lon), name: point.name || undefined },
          })),
        ];
      });
      const reports = await mapWithConcurrency(checks, STAGE_CHECK_CONCURRENCY, async ({ query }) => {
        try {
          const result = await invokeSafetyHandler(query, { suppressReportLog: true });
          return result.statusCode >= 200 && result.statusCode < 300 && result.payload && typeof result.payload === 'object'
            ? result.payload
            : null;
        } catch {
          return null;
        }
      });

      // A stage that failed stays in its place as null: the trip's weak link
      // may be the day that could not be checked.
      const stageResults = stages.map((stage, index) => ({
        index,
        date: addUtcDays(startDate, index),
        fromElevationFt: stage.from.elevationFt,
        report: null,
        checkpoints: stage.checkpoints.map((point) => ({ name: point.name, lat: point.lat, lon: point.lon, report: null })),
      }));
      checks.forEach((check, checkIndex) => {
        const stageResult = stageResults[check.stageIndex];
        if (check.checkpointIndex === null) stageResult.report = reports[checkIndex];
        else stageResult.checkpoints[check.checkpointIndex].report = reports[checkIndex];
      });
      const failedCount = stageResults.filter((stage) => !stage.report).length;
      const checkedAt = new Date().toISOString();
      const plannedStages = stages.map((stage, index) => ({
        ...stage,
        index,
        date: addUtcDays(startDate, index),
        layover: samePlace(stage.from, stage.to),
      }));
      const assessment = assessItinerary({
        stages: plannedStages,
        results: stageResults,
        planSettings,
        activity,
        todayDate: checkedAt.slice(0, 10),
        bailPoints,
      });

      if (reports.every((report) => !report)) {
        // A replayed key belongs to a run that already succeeded; keep it counted.
        if (!reservation.duplicate) await finish(reservation, false);
        return res.status(502).json({ error: 'Could not check this itinerary right now. Try again in a moment.' });
      }
      const multiDayUsage = await finish(reservation, true);
      const firstReport = stageResults.find((stage) => stage.report)?.report;
      return res.json({
        startDate,
        checkedAt,
        stages: summaryView ? summarizeItineraryStages(stageResults) : stageResults,
        assessment,
        ...(summaryView ? {} : {
          chatContext: buildItineraryChatContext({
            name: name || plannedStages[0].from.name,
            checkedAt,
            startDate,
            stages: plannedStages,
            assessment,
            context: buildPlanContext({ ...planSettings, activity }),
            featureFlags: firstReport?.featureFlags || {},
            bailPoints,
          }),
        }),
        failedCount,
        multiDayUsage,
      });
    } catch (error) {
      if (reservation?.reservationId && !reservation.duplicate) {
        await finish(reservation, false).catch(() => undefined);
      }
      const statusCode = Number(error?.statusCode) || 500;
      if (statusCode >= 500) req.log?.error({ err: error }, 'Itinerary check failed');
      return res.status(statusCode).json({
        error: error?.message || 'Itinerary check failed.',
        code: error?.code || 'ITINERARY_CHECK_FAILED',
        ...(error?.usage ? { multiDayUsage: error.usage } : {}),
      });
    }
  });
};

module.exports = {
  MAX_CHECKPOINTS_PER_STAGE,
  MAX_STAGES,
  MIN_STAGES,
  parseItineraryStages,
  registerItineraryRoutes,
};
