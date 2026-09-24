'use strict';

// Everything the report derives from the traveler's plan, in one block:
// the GO / CAUTION / NO-GO decision, hour-by-hour checks against their limits,
// the hour that most needs attention, wind loading, the comfort score for
// their approach, what each source means for the plan (in their units), and
// terrain by elevation, aspect and hour.
//
// Pure: no upstream calls. /api/safety attaches it to each report, and
// /api/evaluate recomputes it when the plan changes after the report loaded
// (new limits or units, a saved report opened under other settings).

const { evaluateDecision } = require('./decision');
const { buildCriticalWindow } = require('./critical-window');
const { buildPlannedRows, buildReadingRows, buildTravelWindowInsights } = require('./travel-window');
const { adjustPointToElevation, summarizeApproachHours } = require('./approach-elevation');
const { calculatePleasantnessScore } = require('./pleasantness-score');
const { buildPlannedStartIso } = require('./time');
const { buildPlanContext } = require('./plan-context');
const { clockMinutes, parseSolarClockMinutes } = require('./display-format');
const { buildWindLoading, windLoadingOverlapCaution } = require('./wind-loading');
const { buildDecisionSummary, buildFieldSignals, buildVerdict } = require('./verdict');
const { buildReportInterpretation } = require('./report-interpretation');
const { buildElevationByHour, buildTerrainView } = require('./terrain-window');

const EVALUATION_VERSION = 1;

const ROW_NUMBER_FIELDS = ['temp', 'feelsLike', 'wind', 'gust', 'precipChance'];

// Missing readings are NaN while rows are built; on the wire they are null.
const finiteOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const serializeRow = (row) => {
  const out = { ...row };
  for (const field of ROW_NUMBER_FIELDS) out[field] = finiteOrNull(row[field]);
  if (row.objectiveReading) {
    out.objectiveReading = {
      temp: finiteOrNull(row.objectiveReading.temp),
      wind: finiteOrNull(row.objectiveReading.wind),
      gust: finiteOrNull(row.objectiveReading.gust),
    };
  }
  return out;
};

const rowSet = (rows, timeStyle) => ({
  rows: rows.map(serializeRow),
  insights: buildTravelWindowInsights(rows, timeStyle),
  approachSummary: summarizeApproachHours(rows),
});

const comfortForPlan = (report, context) => {
  if (!report?.weather || typeof report.weather !== 'object') return null;
  const selectedDate = context.date || report.forecast?.selectedDate || null;
  const selectedStartTime = buildPlannedStartIso({
    selectedDate,
    startClock: context.start,
    referenceIso: report.weather.forecastStartTime || report.forecast?.selectedStartTime || report.weather.issuedTime || null,
  });
  return calculatePleasantnessScore({
    weatherData: report.weather,
    airQualityData: report.airQuality,
    selectedStartTime,
    selectedTravelWindowHours: context.travelWindowHours,
    scoreFeatures: report.featureFlags || null,
    approach: context.resolvedApproach,
  });
};

/**
 * Each travel-window reading's temperature at the trailhead, for comparing the
 * bottom of the route with the summit; null without an approach well below it.
 */
const trailheadTemperatures = (report, trendWindow, approach) => {
  if (!approach || approach.trailheadElevationFt >= approach.objectiveElevationFt - 500) return null;
  const sunriseMinutes = parseSolarClockMinutes(report?.solar?.sunrise);
  const sunsetMinutes = parseSolarClockMinutes(report?.solar?.sunset);
  return {
    trailheadElevationFt: Math.round(approach.trailheadElevationFt),
    objectiveElevationFt: Math.round(approach.objectiveElevationFt),
    temps: trendWindow.map((point) => {
      const temp = adjustPointToElevation(point, approach.objectiveElevationFt, approach.trailheadElevationFt, {
        minuteOfDay: clockMinutes(point?.time) ?? 720,
        sunriseMinutes,
        sunsetMinutes,
      }).temp;
      return typeof temp === 'number' && Number.isFinite(temp) ? temp : null;
    }),
  };
};

/**
 * The hour that most needs attention, when any hour carries a risk signal.
 * The first reading can open before an off-the-hour start; it is named by
 * the start time then.
 */
const peakCriticalHour = (peak, start) => {
  if (!peak || peak.score <= 0) return { peak: null, peakTime: null };
  const peakMinute = clockMinutes(peak.time);
  const startMinute = clockMinutes(start);
  const opensBeforeStart = peakMinute !== null && startMinute !== null && startMinute - peakMinute > 0 && startMinute - peakMinute < 60;
  return { peak, peakTime: opensBeforeStart ? start : peak.time };
};

/**
 * @param {object} report  a /api/safety payload (after feature filtering)
 * @param {object} context from buildPlanContext(params, report)
 */
const evaluatePlan = (report, context) => {
  const { start, date, travelWindowHours, units, approach } = context;
  const plannedRows = buildPlannedRows(report, context, travelWindowHours, { start, date: date || '', approach });
  const readingRows = buildReadingRows(report, context, travelWindowHours, approach ? { profile: approach, start } : null);
  const trendWindow = (report?.weather?.trend || []).slice(0, travelWindowHours);
  const criticalWindow = buildCriticalWindow(trendWindow, units);
  const windLoading = buildWindLoading(report, trendWindow, context);
  const decision = evaluateDecision(report, context);
  // Wind building slabs on the bulletin's problem aspects is worth a caution;
  // it does not change the level on its own.
  const overlapCaution = windLoadingOverlapCaution(windLoading);
  if (overlapCaution && !decision.cautions.includes(overlapCaution)) decision.cautions.push(overlapCaution);
  const decisionSummary = buildDecisionSummary(decision);
  const fieldSignals = buildFieldSignals(report?.localConditions, context.limits, context.nowMs);
  const interpretation = buildReportInterpretation(report, context);

  return {
    version: EVALUATION_VERSION,
    evaluatedAt: new Date(context.nowMs).toISOString(),
    // The plan params as received, so a client can tell which plan this is for.
    params: context.params,
    plan: {
      date,
      start,
      travelWindowHours,
      turnaroundTime: context.turnaroundTime,
      activity: context.activity,
      limits: context.limits,
      units,
      approach: approach
        ? {
          source: approach.source,
          trailheadElevationFt: Math.round(approach.trailheadElevationFt),
          objectiveElevationFt: Math.round(approach.objectiveElevationFt),
        }
        : null,
    },
    decision,
    // Failed checks first, the leading reason and action, and the verdict's wording.
    decisionSummary,
    verdict: buildVerdict(report, decision, decisionSummary, fieldSignals),
    fieldSignals,
    travelWindow: {
      // One row per planned hour from the start: the brief, timing and the day strip.
      planned: rowSet(plannedRows, units.timeStyle),
      // One row per hourly reading: the Weather chapter.
      readings: rowSet(readingRows, units.timeStyle),
    },
    criticalWindow: peakCriticalHour(criticalWindow.peak, start),
    windLoading,
    trailheadTemperatures: trailheadTemperatures(report, trendWindow, approach),
    pleasantness: comfortForPlan(report, context),
    interpretation,
    // Terrain by elevation, aspect and planned hour.
    terrain: buildTerrainView(report, {
      rows: plannedRows,
      avalanche: interpretation.avalanche,
      windLoading,
      limits: context.limits,
      approach,
    }),
    // The elevation bands (from a known trailhead), and the plan's target
    // elevation, for each planned hour.
    elevation: buildElevationByHour(report, plannedRows, context.targetElevationFt, approach),
  };
};

/**
 * The report with its evaluation for these plan params. A failed evaluation
 * leaves the report as is (and is passed to onError): the report itself is
 * still worth returning.
 */
const attachPlanEvaluation = (report, params, { onError, ...options } = {}) => {
  if (!report || typeof report !== 'object') return report;
  try {
    return { ...report, evaluation: evaluatePlan(report, buildPlanContext(params, report, options)) };
  } catch (error) {
    onError?.(error);
    return report;
  }
};

/** A report's attached evaluation, or null when it has none. */
const readEvaluation = (report) => {
  const evaluation = report?.evaluation;
  return evaluation?.decision && evaluation?.travelWindow?.planned ? evaluation : null;
};

module.exports = {
  EVALUATION_VERSION,
  evaluatePlan,
  attachPlanEvaluation,
  readEvaluation,
};
