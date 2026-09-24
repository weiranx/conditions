'use strict';

// Days of a multi-day comparison: each day's weather decision, the checks
// behind it, peak readings over the travel window, and a rank.
//
// The comparison covers weather and travel-window checks. Compare days leaves
// avalanche out (each day's full report covers it); Compare objectives keeps it.

const { computeFeelsLikeF } = require('./weather-normalizers');
const { evaluateDecision, trendRowsCoveringWindow } = require('./decision');
const { buildTravelWindowInsights, buildTravelWindowRows, snowDepthForReport } = require('./travel-window');
const { checkSummary } = require('./verdict');
const { toFiniteOrNull } = require('./numbers');

const DECISION_PRIORITY = { GO: 2, CAUTION: 1, 'NO-GO': 0 };

// The highest of the readings that exist; a missing reading is not a calm or dry one.
const peakReading = (values) => {
  const known = values.map(toFiniteOrNull).filter((value) => value !== null);
  return known.length ? Math.max(...known) : null;
};

const completeReading = (point) =>
  [point?.temp, point?.wind, point?.gust, point?.precipChance].every((value) => toFiniteOrNull(value) !== null);

const roundOrNull = (value) => (value === null ? null : Math.round(value));

const LIMIT_NAMES = {
  'Gust above limit': 'wind gusts',
  'Precip above limit': 'rain / snow chance',
  'Feels-like below limit': 'cold',
  'Heat above limit': 'heat',
  'Severe weather risk': 'severe weather',
  'Deep snow / postholing risk': 'deep snow',
};

// Names the limits behind a day with no clean hour, most widespread first;
// some (heat below the decision's own threshold, deep snow) raise no caution
// of their own.
const everyHourCrossesALimit = (rows) => {
  const hours = new Map();
  rows.forEach((row) => row.failedRuleLabels.forEach((label) => hours.set(label, (hours.get(label) || 0) + 1)));
  const crossed = [...hours]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label]) => LIMIT_NAMES[label] ?? label.toLowerCase());
  return `No hour is within all of your limits${crossed.length ? ` (${crossed.join(', ')})` : ''}.`;
};

/**
 * Sorts best first: the decision, then the report score, then hours with every
 * reading present and within the limits, so missing readings never win a tie.
 * Days with equal values rank the same.
 */
const rankValue = ({ decisionLevel, score, travelCompletePassHours }) =>
  (DECISION_PRIORITY[decisionLevel] ?? 0) * 100000 + (score === null ? -1 : score) * 100 + travelCompletePassHours;

/**
 * One day of the comparison.
 * @param {object} report the day's /api/safety payload
 * @param {object} context plan context for the day (no turnaround)
 * @param {{ requiredHours?: number }} options
 */
const buildTripDay = (report, context, { requiredHours = 1 } = {}) => {
  const { start, travelWindowHours } = context;
  const weather = report?.weather || {};
  const decision = evaluateDecision(report, context);
  const trend = Array.isArray(weather.trend) ? weather.trend : [];
  const trendWindow = trend.slice(0, travelWindowHours);
  const planTrend = trend.slice(0, trendRowsCoveringWindow(start, travelWindowHours));
  // Legacy hour checks over the first N readings: a missing gust or
  // precipitation reading counts as zero here. travelCompletePassHours and
  // the ranking count only hours with every reading present.
  const travelRows = buildTravelWindowRows(trendWindow, context, { snowDepthIn: snowDepthForReport(report) });
  const insights = buildTravelWindowInsights(travelRows, context.units.timeStyle);
  const noCleanHoursCaution = travelRows.length > 0 && insights.passHours === 0 && decision.level !== 'NO-GO';
  const decisionLevel = noCleanHoursCaution ? 'CAUTION' : decision.level;
  const limitingChecks = decisionLevel === 'NO-GO'
    ? decision.blockers
    : decisionLevel === 'CAUTION'
      ? [...(noCleanHoursCaution ? [everyHourCrossesALimit(travelRows)] : []), ...decision.cautions]
      : [];
  const rawScore = toFiniteOrNull(report?.safety?.score);
  const score = rawScore !== null ? Math.round(rawScore) : null;
  const gust = toFiniteOrNull(weather.windGust);
  const precip = toFiniteOrNull(weather.precipChance);
  const airQuality = report?.airQuality || {};
  const airQualityCategory = airQuality.forecast?.category || airQuality.category || null;
  const travelCompletePassHours = travelRows.filter((row, hour) => row.pass && completeReading(trendWindow[hour])).length;
  const day = {
    date: /^\d{4}-\d{2}-\d{2}$/.test(report?.forecast?.selectedDate || '') ? report.forecast.selectedDate : context.date,
    decisionLevel,
    decisionHeadline: noCleanHoursCaution
      ? 'No travel hour meets every threshold — re-time the start, shorten the objective, or choose another day.'
      : decision.headline,
    /** Messages that set a CAUTION or NO-GO decision, most limiting first. Empty for GO. */
    limitingChecks,
    /** The lead sentence of each limiting check, once each. */
    concerns: [...new Set(limitingChecks.map(checkSummary).filter(Boolean))],
    score,
    weatherDescription: String(weather.description || 'Unknown'),
    tempHighF: toFiniteOrNull(weather.dailyTempHighF ?? weather.temperatureContext24h?.maxTempF),
    tempLowF: toFiniteOrNull(weather.dailyTempLowF ?? weather.temperatureContext24h?.minTempF),
    windGustMph: gust,
    peakGustMph: peakReading([gust, ...planTrend.map((point) => point?.gust)]),
    windDirection: weather.windDirection || null,
    precipChance: roundOrNull(precip),
    peakPrecipChance: roundOrNull(peakReading([weather.precipChance, ...planTrend.map((point) => point?.precipChance)])),
    peakFeelsLikeF: peakReading(planTrend.map((point) => {
      const temp = toFiniteOrNull(point?.temp);
      return temp === null ? null : computeFeelsLikeF(temp, toFiniteOrNull(point?.wind) ?? 0);
    })),
    expectedRainIn: toFiniteOrNull(report?.rainfall?.expected?.rainWindowIn),
    expectedSnowIn: toFiniteOrNull(report?.rainfall?.expected?.snowWindowIn),
    humidityPct: roundOrNull(toFiniteOrNull(weather.humidity)),
    cloudCoverPct: roundOrNull(toFiniteOrNull(weather.cloudCover)),
    isDaytime: typeof weather.isDaytime === 'boolean' ? weather.isDaytime : null,
    travelSummary: `${insights.passHours}/${travelRows.length}h passing`,
    travelPassHours: insights.passHours,
    travelCompletePassHours,
    travelTotalHours: travelRows.length,
    travelBestWindow: insights.bestWindow,
    sunrise: report?.solar?.sunrise || null,
    sunset: report?.solar?.sunset || null,
    dayLength: report?.solar?.dayLength || null,
    visibilityLevel: weather.visibilityRisk?.level || null,
    visibilitySummary: weather.visibilityRisk?.summary || null,
    alertCount: Math.max(0, Math.round(Number(report?.alerts?.activeCount) || 0)),
    airQualityAqi: roundOrNull(toFiniteOrNull(airQuality.forecast?.usAqi ?? airQuality.usAqi)),
    airQualityCategory: String(airQualityCategory || '').trim().toLowerCase() === 'unknown' ? null : airQualityCategory,
    comfortScore: toFiniteOrNull(report?.pleasantness?.score),
    comfortLabel: report?.pleasantness?.label || null,
    partialData: Boolean(report?.partialData),
    apiWarning: report?.apiWarning || null,
    sourceIssuedTime: weather.issuedTime || null,
    /** The readings from departure to the end of the plan, including its final partial hour. */
    hourlyWeather: planTrend,
  };
  day.rankValue = rankValue(day);
  // Only days with complete evidence for the whole window can be ranked.
  day.rankable = !day.partialData && day.score !== null && day.travelTotalHours >= requiredHours;
  return day;
};

const diffOrNull = (current, previous) => (current != null && previous != null ? Math.round((current - previous) * 10) / 10 : null);

/** Days in date order, each with its change from the day before. */
const withDayDeltas = (days) => {
  const rows = [...days].sort((a, b) => a.date.localeCompare(b.date));
  rows.forEach((row, index) => {
    const previous = rows[index - 1];
    row.deltas = previous
      ? {
        score: diffOrNull(row.score, previous.score),
        tempHighF: diffOrNull(row.tempHighF, previous.tempHighF),
        tempLowF: diffOrNull(row.tempLowF, previous.tempLowF),
        windGustMph: diffOrNull(row.windGustMph, previous.windGustMph),
        precipChance: diffOrNull(row.precipChance, previous.precipChance),
      }
      : null;
  });
  return rows;
};

/** Best first; ties share a rank value. */
const rankDays = (days) => {
  const ordered = [...days].sort((a, b) => b.rankValue - a.rankValue);
  const best = ordered[0] || null;
  return {
    order: ordered.map((day) => day.date),
    bestDate: best?.date ?? null,
    tiedWithBest: best ? ordered.filter((day) => day !== best && day.rankValue === best.rankValue).map((day) => day.date) : [],
  };
};

/** The day or days that stand out on one measurement. */
const buildHighlights = (days) => [
  { key: 'calmest', label: 'Calmest day', metric: (day) => (day.peakGustMph === null ? null : -day.peakGustMph) },
  { key: 'driest', label: 'Lowest rain / snow chance', metric: (day) => (day.peakPrecipChance === null ? null : -day.peakPrecipChance) },
  { key: 'within-limits', label: 'Most hours within limits', metric: (day) => (day.travelTotalHours > 0 ? day.travelPassHours : null) },
].map(({ key, label, metric }) => {
  const measured = days.filter((day) => metric(day) !== null);
  const maximum = Math.max(...measured.map(metric));
  return { key, label, dates: measured.filter((day) => metric(day) === maximum).map((day) => day.date) };
});

/** A note for days the comparison could not include. */
const tripNote = ({ requestedDays, loadedDays, failedDays }) => {
  if (failedDays > 0) {
    return failedDays === 1 ? '1 day could not be loaded and was skipped.' : `${failedDays} days could not be loaded and were skipped.`;
  }
  if (loadedDays < requestedDays) {
    return loadedDays === 1
      ? 'Only 1 day is available inside the current forecast range.'
      : `Only ${loadedDays} days are available inside the current forecast range.`;
  }
  return null;
};

const WEATHER_WINDOW_LABEL = { GO: 'WEATHER CLEAR', CAUTION: 'WEATHER CAUTION', 'NO-GO': 'WEATHER BLOCKED' };

/**
 * What the chat about Compare days reads: each day's decision, the checks
 * behind it, and the hourly readings for the travel window. Full reports stay
 * out; a week of them is several times the size the chat accepts.
 */
const buildTripChatContext = ({ days, ranking, objective, context, featureFlags = {}, note = null }) => {
  const enabled = (key) => featureFlags?.[key] !== false;
  return {
    contextType: 'multi-day-trip-plan',
    featureFlags,
    objective,
    plan: {
      dailyStartTime: context.start,
      travelWindowHours: context.travelWindowHours,
      days: days.length,
      scope: "Weather and travel-window checks only. Avalanche conditions are excluded; each day's full report covers every hazard.",
      forecastNote: note,
    },
    limits: {
      maxWindGustMph: context.limits.maxWindGustMph,
      maxPrecipChancePct: context.limits.maxPrecipChance,
      minFeelsLikeF: context.limits.minFeelsLikeF,
      maxFeelsLikeF: context.limits.maxFeelsLikeF,
    },
    displayUnits: {
      temperature: context.units.temperature,
      wind: context.units.wind,
      elevation: context.units.elevation,
      time: context.units.timeStyle,
    },
    ranking: {
      method: 'Weather decision, then report score, then hours with every reading present and within the limits.',
      bestDate: ranking.bestDate,
      datesTiedWithBest: ranking.tiedWithBest,
    },
    days: days.map((day) => ({
      date: day.date,
      weatherWindowLabel: WEATHER_WINDOW_LABEL[day.decisionLevel],
      decisionLevel: day.decisionLevel,
      decisionHeadline: day.decisionHeadline,
      limitingChecks: day.limitingChecks,
      weatherWindowScore: day.score,
      weatherDescription: day.weatherDescription,
      temperatureHighF: day.tempHighF,
      temperatureLowF: day.tempLowF,
      departureWindGustMph: day.windGustMph,
      peakWindGustMph: day.peakGustMph,
      windDirection: day.windDirection,
      departurePrecipitationChancePct: day.precipChance,
      peakPrecipitationChancePct: day.peakPrecipChance,
      expectedRainIn: day.expectedRainIn,
      expectedSnowIn: day.expectedSnowIn,
      cloudCoverPct: day.cloudCoverPct,
      travelHoursWithinLimits: day.travelPassHours,
      travelHoursEvaluated: day.travelTotalHours,
      longestStretchWithinLimits: day.travelBestWindow,
      ...(enabled('daylightTimeline') ? { sunrise: day.sunrise, sunset: day.sunset, daylightLength: day.dayLength } : {}),
      ...(enabled('weatherContextDetails') ? { visibilityRisk: day.visibilityLevel, visibilitySummary: day.visibilitySummary } : {}),
      activeWeatherAlerts: day.alertCount,
      ...(enabled('airQualityDetails') ? { airQualityAqi: day.airQualityAqi, airQualityCategory: day.airQualityCategory } : {}),
      partialData: day.partialData,
      dataWarning: day.apiWarning,
      forecastIssuedTime: day.sourceIssuedTime,
      hourlyTravelWindow: day.hourlyWeather.map((hour) => ({
        time: hour.time,
        temperatureF: hour.temp,
        windMph: hour.wind,
        gustMph: hour.gust,
        precipitationChancePct: hour.precipChance,
        condition: hour.condition,
      })),
    })),
  };
};

module.exports = {
  rankValue,
  buildTripDay,
  withDayDeltas,
  rankDays,
  buildHighlights,
  tripNote,
  buildTripChatContext,
};
