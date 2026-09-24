'use strict';

const { assertFeatureEnabled } = require('../utils/feature-flags');
const { toFiniteOrNull } = require('../utils/numbers');
const { buildPlanContext, pickPlanParams } = require('../utils/plan-context');
const { readEvaluation } = require('../utils/plan-evaluation');
const {
  EXTENDED_START_TIME_SCENARIO_TIMES,
  START_TIME_SCENARIO_TIMES,
  buildStartTimeScenario,
  compareStartTimeScenarios,
  includeUserStartTimeScenario,
} = require('../utils/start-time-scenarios');
const { buildDayOverDay } = require('../utils/day-over-day');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/u;

const addUtcDays = (isoDate, days) => {
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

/** The objective and plan of a comparison request; null when it is not valid. */
const readComparisonRequest = (query) => {
  const lat = toFiniteOrNull(query?.lat);
  const lon = toFiniteOrNull(query?.lon);
  const params = pickPlanParams(query);
  if (lat === null || lat < -90 || lat > 90 || lon === null || lon < -180 || lon > 180) return null;
  if (!DATE_PATTERN.test(params.date || '') || !TIME_PATTERN.test(params.start || '')) return null;
  return { lat, lon, params };
};

/**
 * Reports for the same objective and plan at other dates or departures. Each
 * comes back evaluated for the plan's limits, units and approach.
 */
const createPlanReportLoader = (invokeSafetyHandler) => async ({ lat, lon, params }, overrides) => {
  try {
    const result = await invokeSafetyHandler(
      { ...params, ...overrides, lat: String(lat), lon: String(lon) },
      { suppressReportLog: true },
    );
    const report = result.statusCode >= 200 && result.statusCode < 300 && result.payload && typeof result.payload === 'object'
      ? result.payload
      : null;
    const evaluation = readEvaluation(report);
    return report && evaluation ? { report, evaluation } : null;
  } catch {
    return null;
  }
};

const registerPlanComparisonRoutes = ({
  app,
  invokeSafetyHandler,
  ensureStartTimesEnabled = () => assertFeatureEnabled('startTimeComparisons'),
}) => {
  const loadPlanReport = createPlanReportLoader(invokeSafetyHandler);

  /**
   * GET /api/start-time-scenarios?lat&lon&date&start&travel_window_hours&<plan params>[&set=extended]
   * The planned trip at other departures, ranked, with the suggested start.
   */
  app.get('/api/start-time-scenarios', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      ensureStartTimesEnabled();
    } catch (error) {
      return res.status(error?.statusCode || 503).json({ error: error?.message || 'Start-time comparisons are unavailable.' });
    }
    const request = readComparisonRequest(req.query);
    if (!request) return res.status(400).json({ error: 'Provide a valid location, date and start time.' });
    const context = buildPlanContext(request.params);
    const presets = req.query.set === 'extended' ? EXTENDED_START_TIME_SCENARIO_TIMES : START_TIME_SCENARIO_TIMES;
    const times = includeUserStartTimeScenario(presets, context.start);
    const loaded = await Promise.all(times.map((start) => loadPlanReport(request, { start })));
    const scenarios = loaded.flatMap((entry, index) => (entry
      ? [buildStartTimeScenario(times[index], entry.report, entry.evaluation, context.travelWindowHours)]
      : []));
    return res.json({
      comparison: compareStartTimeScenarios(scenarios, { ...context, plannedStart: context.start }),
      requestedTimes: times,
      error: scenarios.length === times.length ? null : 'Some departure scenarios could not be evaluated.',
    });
  });

  /**
   * GET /api/day-over-day?lat&lon&date&start&travel_window_hours&<plan params>
   * The plan's report against the same plan a day earlier.
   */
  app.get('/api/day-over-day', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const request = readComparisonRequest(req.query);
    if (!request) return res.status(400).json({ error: 'Provide a valid location, date and start time.' });
    const context = buildPlanContext(request.params);
    const previousDate = addUtcDays(context.date, -1);
    const [current, previous] = await Promise.all([
      loadPlanReport(request, {}),
      loadPlanReport(request, { date: previousDate }),
    ]);
    const comparison = current && previous && previous.report.forecast?.selectedDate === previousDate
      ? buildDayOverDay({
        current: current.report,
        previous: previous.report,
        previousDate,
        startTime: context.start,
        travelWindowHours: context.travelWindowHours,
        units: context.units,
      })
      : null;
    return res.json({ comparison });
  });
};

module.exports = {
  registerPlanComparisonRoutes,
};
