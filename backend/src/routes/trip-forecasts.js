'use strict';

const crypto = require('node:crypto');
const { FREE_ACCOUNT_TIER } = require('../auth/account-tier');
const { parseCookies, readSessionToken } = require('../auth/account-access');
const { assertFeatureEnabled } = require('../utils/feature-flags');
const { toFiniteOrNull } = require('../utils/numbers');
const { buildPlanContext, pickPlanParams } = require('../utils/plan-context');
const {
  buildHighlights,
  buildTripChatContext,
  buildTripDay,
  rankDays,
  tripNote,
  withDayDeltas,
} = require('../utils/trip-days');

const GUEST_MULTI_DAY_COOKIE_NAME = 'bc_trip_guest';
const MIN_TRIP_DAYS = 2;
const MAX_TRIP_DAYS = 7;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const addUtcDays = (isoDate, days) => {
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const registerTripForecastRoutes = ({
  app,
  accountService,
  tierService,
  usageService,
  invokeSafetyHandler,
  ensureFeatureEnabled = () => assertFeatureEnabled('tripPlanning'),
  isProduction = process.env.NODE_ENV === 'production',
} = {}) => {
  app.post('/api/trip-forecasts', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      ensureFeatureEnabled();
    } catch (error) {
      return res.status(error?.statusCode || 503).json({
        error: error?.message || 'Multi-day trip planning is unavailable.',
        ...(error?.code ? { code: error.code } : {}),
      });
    }
    // null or '' is a missing coordinate, not 0° (Number(null) === 0).
    const lat = toFiniteOrNull(req.body?.lat);
    const lon = toFiniteOrNull(req.body?.lon);
    const startDate = String(req.body?.startDate || '').trim();
    const startTime = String(req.body?.startTime || '').trim();
    const durationDays = Math.round(Number(req.body?.durationDays));
    const travelWindowHours = Math.round(Number(req.body?.travelWindowHours));
    const objectiveName = String(req.body?.objectiveName || '').trim().slice(0, 200);
    // Tailors each day's gear list; the safety handler falls back to backcountry.
    const activity = typeof req.body?.activity === 'string' ? req.body.activity.trim().slice(0, 40) : '';
    // The traveler's limits and units; each day is checked against them at the
    // objective, since an approach belongs to one objective and route.
    const planSettings = {
      ...pickPlanParams(req.body?.plan && typeof req.body.plan === 'object' ? req.body.plan : {}),
      approach: 'off',
    };
    // Compare days is a weather comparison; Compare objectives keeps avalanche danger in the decision.
    const includeAvalanche = req.body?.includeAvalanche === true;
    // Days the traveler asked for, before the forecast range cut the request short.
    const requestedDays = Math.max(durationDays, Math.round(Number(req.body?.requestedDays)) || 0);
    const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();

    if (
      lat === null || lat < -90 || lat > 90
      || lon === null || lon < -180 || lon > 180
      || !DATE_PATTERN.test(startDate)
      || !TIME_PATTERN.test(startTime)
      || !Number.isInteger(durationDays) || durationDays < MIN_TRIP_DAYS || durationDays > MAX_TRIP_DAYS
      || !Number.isInteger(travelWindowHours) || travelWindowHours < 1 || travelWindowHours > 24
    ) {
      return res.status(400).json({ error: 'Provide a valid location, start time, 2–7 day duration, and travel window.' });
    }
    if (!idempotencyKey || idempotencyKey.length > 128) {
      return res.status(400).json({ error: 'A valid Idempotency-Key header is required.' });
    }
    if (!usageService?.available || typeof usageService.reserve !== 'function' || typeof usageService.finish !== 'function') {
      return res.status(503).json({
        error: 'Multi-day forecast usage is temporarily unavailable. Please try again later.',
        code: 'MULTI_DAY_USAGE_UNAVAILABLE',
      });
    }

    let user = null;
    const sessionToken = readSessionToken(req);
    if (sessionToken && (!accountService?.available || typeof accountService.getUserForSession !== 'function')) {
      return res.status(503).json({
        error: 'Account verification is temporarily unavailable. Please try again.',
        code: 'ACCOUNT_VERIFICATION_UNAVAILABLE',
      });
    }
    if (accountService?.available && typeof accountService.getUserForSession === 'function') {
      try {
        user = await accountService.getUserForSession(sessionToken);
      } catch (error) {
        req.log?.warn({ err: error }, 'Multi-day account session could not be loaded');
        return res.status(503).json({
          error: 'Account verification is temporarily unavailable. Please try again.',
          code: 'ACCOUNT_VERIFICATION_UNAVAILABLE',
        });
      }
    }

    let accountTier = { ...FREE_ACCOUNT_TIER };
    let anonymousId = null;
    if (user && typeof tierService?.getAccountTier === 'function') {
      try {
        accountTier = await tierService.getAccountTier(user.id);
      } catch (error) {
        req.log?.warn({ err: error, userId: user.id }, 'Multi-day account tier could not be loaded');
      }
    } else if (!user) {
      const storedAnonymousId = parseCookies(req.headers.cookie)[GUEST_MULTI_DAY_COOKIE_NAME];
      anonymousId = UUID_PATTERN.test(String(storedAnonymousId || ''))
        ? storedAnonymousId
        : crypto.randomUUID();
      if (anonymousId !== storedAnonymousId) {
        res.cookie(GUEST_MULTI_DAY_COOKIE_NAME, anonymousId, {
          httpOnly: true,
          sameSite: 'lax',
          secure: isProduction,
          path: '/',
          maxAge: 365 * 24 * 60 * 60 * 1000,
        });
      }
    }

    let reservation = null;
    try {
      reservation = await usageService.reserve({
        userId: user?.id,
        anonymousId,
        tierKey: accountTier.key,
        idempotencyKey,
        metadata: { durationDays, startDate },
      });

      const dates = Array.from({ length: durationDays }, (_, index) => addUtcDays(startDate, index));
      const results = await Promise.all(dates.map(async (date) => {
        try {
          const result = await invokeSafetyHandler({
            ...planSettings,
            lat: String(lat),
            lon: String(lon),
            date,
            start: startTime,
            travel_window_hours: String(travelWindowHours),
            activity: activity || undefined,
            name: objectiveName || undefined,
          }, { suppressReportLog: true });
          return result.statusCode >= 200 && result.statusCode < 300 && result.payload && typeof result.payload === 'object'
            ? result.payload
            : null;
        } catch {
          return null;
        }
      }));
      // One report per requested date; a report for another date is not that day's forecast.
      const reports = [...new Map(results
        .filter((report) => report && dates.includes(report.forecast?.selectedDate))
        .map((report) => [report.forecast.selectedDate, report])).values()];
      if (reports.length === 0) {
        // A replayed key belongs to a run that already succeeded; keep it counted.
        if (!reservation.duplicate) {
          await usageService.finish({
            reservationId: reservation.reservationId,
            userId: user?.id,
            anonymousId,
            tierKey: accountTier.key,
            succeeded: false,
          });
        }
        return res.status(502).json({ error: 'Could not load multi-day forecasts right now. Try again in a moment.' });
      }
      const multiDayUsage = await usageService.finish({
        reservationId: reservation.reservationId,
        userId: user?.id,
        anonymousId,
        tierKey: accountTier.key,
        succeeded: true,
      });
      const days = withDayDeltas(reports.map((report) => ({
        ...buildTripDay(report, buildPlanContext({
          ...planSettings,
          date: report.forecast.selectedDate,
          start: startTime,
          travel_window_hours: String(travelWindowHours),
          activity,
        }, report, { withTurnaround: false, ignoreAvalancheForDecision: !includeAvalanche }), { requiredHours: travelWindowHours }),
        safetyData: report,
      })));
      const ranking = rankDays(days);
      const failedCount = durationDays - days.length;
      const note = tripNote({ requestedDays, loadedDays: days.length, failedDays: failedCount });
      const context = buildPlanContext({ ...planSettings, start: startTime, travel_window_hours: String(travelWindowHours), activity });
      return res.json({
        days,
        ranking,
        highlights: buildHighlights(days),
        note,
        chatContext: buildTripChatContext({
          days,
          ranking,
          context,
          note,
          featureFlags: reports[0].featureFlags || {},
          objective: {
            name: objectiveName || 'Selected objective',
            latitude: lat,
            longitude: lon,
            timezone: reports[0].weather?.timezone || null,
          },
        }),
        failedCount,
        multiDayUsage,
      });
    } catch (error) {
      if (reservation?.reservationId && !reservation.duplicate) {
        await usageService.finish({
          reservationId: reservation.reservationId,
          userId: user?.id,
          anonymousId,
          tierKey: accountTier.key,
          succeeded: false,
        }).catch(() => undefined);
      }
      const statusCode = Number(error?.statusCode) || 500;
      if (statusCode >= 500) req.log?.error({ err: error }, 'Multi-day forecast request failed');
      return res.status(statusCode).json({
        error: error?.message || 'Multi-day forecast request failed.',
        code: error?.code || 'MULTI_DAY_FORECAST_FAILED',
        ...(error?.usage ? { multiDayUsage: error.usage } : {}),
      });
    }
  });
};

module.exports = {
  GUEST_MULTI_DAY_COOKIE_NAME,
  MAX_TRIP_DAYS,
  MIN_TRIP_DAYS,
  registerTripForecastRoutes,
};
