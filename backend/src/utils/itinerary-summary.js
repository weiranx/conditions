'use strict';

const { toFiniteOrNull } = require('./numbers');

// A compact, evidence-only view of one itinerary day for clients that cannot
// take a week of full reports (the MCP tools, saved-trip listings). It keeps
// missing values null, partial-data flags and source times, and makes no
// go/no-go call: that stays with the client that knows the user's limits.

const peak = (rows, key) => {
  const values = rows.map((row) => toFiniteOrNull(row?.[key])).filter((value) => value !== null);
  return values.length ? Math.max(...values) : null;
};
const low = (rows, key) => {
  const values = rows.map((row) => toFiniteOrNull(row?.[key])).filter((value) => value !== null);
  return values.length ? Math.min(...values) : null;
};

const summarizeReport = (report) => {
  if (!report || typeof report !== 'object') return null;
  const weather = report.weather || {};
  const trend = Array.isArray(weather.trend) ? weather.trend : [];
  const alerts = Array.isArray(report.alerts?.alerts) ? report.alerts.alerts : [];
  const assessmentStatus = report.safety?.assessmentStatus || null;
  return {
    location: report.location || null,
    selectedDate: report.forecast?.selectedDate || null,
    selectedStartTime: report.forecast?.selectedStartTime || null,
    selectedEndTime: report.forecast?.selectedEndTime || null,
    elevationFt: toFiniteOrNull(weather.elevation),
    safetyScore: assessmentStatus === 'insufficient_evidence' ? null : toFiniteOrNull(report.safety?.score),
    assessmentStatus,
    primaryHazard: report.safety?.primaryHazard || null,
    weather: {
      description: weather.description || null,
      forecastIssuedTime: weather.issuedTime || weather.generatedTime || null,
      hoursInWindow: trend.length,
      lowTempF: low(trend, 'temp'),
      highTempF: peak(trend, 'temp'),
      minFeelsLikeF: low(trend, 'feelsLike'),
      peakWindMph: peak(trend, 'wind'),
      peakGustMph: peak(trend, 'gust'),
      peakPrecipChancePct: peak(trend, 'precipChance'),
      hoursMissingGust: trend.filter((row) => toFiniteOrNull(row?.gust) === null).length,
      hoursMissingPrecipChance: trend.filter((row) => toFiniteOrNull(row?.precipChance) === null).length,
      thunderstormHours: trend.filter((row) => /thunder|t-storm|tstm|lightning/iu.test(String(row?.condition || ''))).length,
    },
    alerts: {
      status: report.alerts?.status || null,
      activeCount: toFiniteOrNull(report.alerts?.activeCount) ?? alerts.length,
      headlines: alerts.slice(0, 3).map((alert) => alert?.event || alert?.headline || null).filter(Boolean),
    },
    avalanche: {
      relevant: report.avalanche?.relevant ?? null,
      coverageStatus: report.avalanche?.coverageStatus || null,
      dangerLevel: toFiniteOrNull(report.avalanche?.dangerLevel),
      dangerUnknown: report.avalanche?.dangerUnknown ?? null,
      center: report.avalanche?.center || null,
    },
    airQuality: {
      usAqi: toFiniteOrNull(report.airQuality?.usAqi),
      category: report.airQuality?.category || null,
    },
    campNight: report.campNight || null,
    partialData: report.partialData === true,
    apiWarning: report.apiWarning || null,
    generatedAt: report.generatedAt || null,
  };
};

/** Summaries for each day and high point of a checked itinerary, in day order. */
const summarizeItineraryStages = (stages) => (Array.isArray(stages) ? stages : []).map((stage) => ({
  index: stage?.index ?? null,
  date: stage?.date ?? null,
  fromElevationFt: stage?.fromElevationFt ?? null,
  checked: Boolean(stage?.report),
  summary: summarizeReport(stage?.report),
  checkpoints: (Array.isArray(stage?.checkpoints) ? stage.checkpoints : []).map((checkpoint) => ({
    name: checkpoint?.name || null,
    lat: checkpoint?.lat ?? null,
    lon: checkpoint?.lon ?? null,
    checked: Boolean(checkpoint?.report),
    summary: summarizeReport(checkpoint?.report),
  })),
}));

module.exports = {
  summarizeItineraryStages,
  summarizeReport,
};
