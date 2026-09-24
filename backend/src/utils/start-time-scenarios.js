'use strict';

// The same trip at other departure times: each departure's decision and
// hazards from its own forecast, ranked, with the hazard that changes most.

const { computeFeelsLikeF } = require('./weather-normalizers');
const { parseSolarClockMinutes, parseTimeInputMinutes } = require('./display-format');
const { decisionLevelRank, normalizedDecisionScore, trendRowsCoveringWindow } = require('./decision');
const { toFiniteOrNull } = require('./numbers');

const START_TIME_SCENARIO_TIMES = ['04:00', '06:00', '08:00'];
const EXTENDED_START_TIME_SCENARIO_TIMES = ['03:00', '04:00', '05:00', '06:00', '07:00', '08:00', '09:00', '10:00'];

const scenarioTimeMinutes = (time) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const clockFromMinutes = (totalMinutes) => {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
};

/** The preset departures with the planned start swapped in for the closest one. */
const includeUserStartTimeScenario = (presetTimes, userStartTime) => {
  const userMinutes = scenarioTimeMinutes(userStartTime);
  if (userMinutes === null || presetTimes.length === 0) return [...presetTimes];
  const userTime = clockFromMinutes(userMinutes);
  if (presetTimes.includes(userTime)) return [...presetTimes];
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  presetTimes.forEach((time, index) => {
    const minutes = scenarioTimeMinutes(time);
    if (minutes === null) return;
    const distance = Math.abs(minutes - userMinutes);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });
  const result = [...presetTimes];
  result[closestIndex] = userTime;
  return result.sort((a, b) => (scenarioTimeMinutes(a) ?? 0) - (scenarioTimeMinutes(b) ?? 0));
};

/** The largest reading, or null when every reading is missing (a gap is not 0). */
const finiteMax = (values) => {
  const finite = values.map(toFiniteOrNull).filter((value) => value !== null);
  return finite.length > 0 ? Math.max(...finite) : null;
};

/**
 * One departure: its evaluation's decision and planned hours, and the peak
 * readings from departure to the end of the plan.
 */
const buildStartTimeScenario = (startTime, report, evaluation, travelWindowHours) => {
  const startMinutes = parseTimeInputMinutes(startTime) ?? 0;
  const durationMinutes = Math.max(1, Math.round(Number(travelWindowHours) || 12)) * 60;
  const weather = report?.weather || {};
  const trend = Array.isArray(weather.trend) ? weather.trend.slice(0, trendRowsCoveringWindow(startTime, travelWindowHours)) : [];
  const returnMinutes = startMinutes + durationMinutes;
  const sunsetMinutes = parseSolarClockMinutes(report?.solar?.sunset);
  const avalanche = report?.avalanche;
  const avalancheRelevant = Boolean(avalanche && avalanche.relevant !== false);
  const avalancheKnown = avalancheRelevant && !avalanche?.dangerUnknown && avalanche?.coverageStatus === 'reported';
  const avalancheLevel = avalancheKnown ? toFiniteOrNull(avalanche?.dangerLevel) : null;
  const stormHours = trend.filter((point) => /thunder|lightning|hail|tornado|convective/i.test(point?.condition || '')).length;
  const feelsLike = (point) => {
    const temp = toFiniteOrNull(point?.temp);
    return temp === null ? null : computeFeelsLikeF(temp, toFiniteOrNull(point?.wind) ?? 0);
  };
  return {
    startTime,
    summitTime: clockFromMinutes(startMinutes + Math.round(durationMinutes / 2)),
    returnTime: clockFromMinutes(returnMinutes),
    returnDayOffset: Math.floor(returnMinutes / 1440),
    daylightRemainingMinutes: sunsetMinutes === null ? null : sunsetMinutes - returnMinutes,
    decision: { level: evaluation.decision.level, headline: evaluation.decision.headline },
    score: normalizedDecisionScore(report),
    peakGustMph: finiteMax([weather.windGust, ...trend.map((point) => point?.gust)]),
    peakFeelsLikeF: finiteMax([weather.feelsLike, weather.temp, ...trend.map(feelsLike)]),
    peakPrecipChance: finiteMax([weather.precipChance, ...trend.map((point) => point?.precipChance)]),
    avalancheLevel,
    avalancheLabel: !avalanche ? '' : !avalancheRelevant ? 'Not relevant' : avalancheLevel !== null ? `D${avalancheLevel}` : 'Unknown',
    hasAvalanche: Boolean(avalanche),
    stormHours,
    cleanHours: Math.max(0, trend.length - stormHours),
    visibilityHours: Math.max(0, Number(weather.visibilityRisk?.activeHours) || 0),
    // The departure's own planned hours, for drawing it on the shared clock.
    planned: {
      rows: evaluation.travelWindow.planned.rows,
      approachSummary: evaluation.travelWindow.planned.approachSummary,
    },
  };
};

const range = (values, fallback = 0) => {
  const finite = values.filter((value) => value !== null && Number.isFinite(value));
  return finite.length > 1 ? Math.max(...finite) - Math.min(...finite) : fallback;
};

const riskPressure = (scenario, risk, limits, travelWindowHours) => {
  switch (risk) {
    case 'Wind': return scenario.peakGustMph === null ? 0 : scenario.peakGustMph / Math.max(1, limits.maxWindGustMph);
    case 'Heat': return scenario.peakFeelsLikeF === null ? 0 : scenario.peakFeelsLikeF / Math.max(1, limits.maxFeelsLikeF);
    case 'Precipitation': return scenario.peakPrecipChance === null ? 0 : scenario.peakPrecipChance / Math.max(1, limits.maxPrecipChance);
    case 'Avalanche': return scenario.avalancheLevel === null ? 0 : scenario.avalancheLevel / 3;
    case 'Storm / lightning': return scenario.stormHours / Math.max(1, travelWindowHours);
    case 'Visibility': return scenario.visibilityHours / Math.max(1, travelWindowHours);
    default: return scenario.daylightRemainingMinutes === null ? 0 : Math.max(0, 180 - scenario.daylightRemainingMinutes) / 180;
  }
};

const LEVEL_WORDS = { GO: 'Go', CAUTION: 'Caution', 'NO-GO': 'No-go' };

/**
 * Rank departures by decision, then score, clean hours and daylight. Name the
 * hazard that changes most between them, and whether another start is worth
 * suggesting over the planned one.
 */
const compareStartTimeScenarios = (scenarios, { limits, travelWindowHours, plannedStart }) => {
  if (scenarios.length === 0) return null;
  const sorted = [...scenarios].sort((a, b) => {
    const levelDelta = decisionLevelRank(b.decision.level) - decisionLevelRank(a.decision.level);
    if (levelDelta !== 0) return levelDelta;
    if (b.score !== a.score) return b.score - a.score;
    if (b.cleanHours !== a.cleanHours) return b.cleanHours - a.cleanHours;
    const daylightA = a.daylightRemainingMinutes ?? -Infinity;
    const daylightB = b.daylightRemainingMinutes ?? -Infinity;
    if (daylightB !== daylightA) return daylightB - daylightA;
    return a.startTime.localeCompare(b.startTime);
  });
  const best = sorted[0];
  const risks = [
    'Storm / lightning',
    'Wind',
    'Heat',
    'Precipitation',
    ...(scenarios.some((scenario) => scenario.hasAvalanche) ? ['Avalanche'] : []),
    'Visibility',
  ];
  const spread = {
    'Storm / lightning': range(scenarios.map((scenario) => scenario.stormHours)) / Math.max(1, travelWindowHours),
    Wind: range(scenarios.map((scenario) => scenario.peakGustMph)) / Math.max(1, limits.maxWindGustMph),
    Heat: range(scenarios.map((scenario) => scenario.peakFeelsLikeF)) / 15,
    Precipitation: range(scenarios.map((scenario) => scenario.peakPrecipChance)) / Math.max(1, limits.maxPrecipChance),
    Avalanche: range(scenarios.map((scenario) => scenario.avalancheLevel)) / 2,
    Visibility: range(scenarios.map((scenario) => scenario.visibilityHours)) / Math.max(1, travelWindowHours),
  };
  const hasMeaningfulSpread = risks.some((risk) => spread[risk] > 0.01);
  const changingRisk = [...risks].sort((a, b) => {
    const spreadDelta = spread[b] - spread[a];
    if (Math.abs(spreadDelta) > 0.001) return spreadDelta;
    return riskPressure(best, b, limits, travelWindowHours) - riskPressure(best, a, limits, travelWindowHours);
  })[0];
  const drivingRisk = hasMeaningfulSpread ? changingRisk : 'Daylight';
  const sameDecisionLevel = scenarios.every((scenario) => scenario.decision.level === best.decision.level);
  const effectivelyTied = sameDecisionLevel && range(scenarios.map((scenario) => scenario.score)) <= 1;
  const allNoGo = scenarios.every((scenario) => scenario.decision.level === 'NO-GO');
  // Only claim what holds for the suggested departure: it is ranked by
  // decision, then score, and need not have the most daylight.
  const daylight = scenarios.map((scenario) => scenario.daylightRemainingMinutes).filter((value) => value !== null && Number.isFinite(value));
  const mostDaylight = daylight.length > 1 && best.daylightRemainingMinutes === Math.max(...daylight);
  const recommendationReason = allNoGo
    ? 'Every departure compared here is a no-go, so changing the start time alone does not clear this plan.'
    : effectivelyTied
      ? `These departures score within a point of each other${mostDaylight ? '; the suggested one leaves the most daylight' : ''}.`
      : hasMeaningfulSpread
        ? `${drivingRisk === 'Storm / lightning' ? 'Storm signal' : drivingRisk} changes most across these departures; the suggested one has the best decision and score.`
        : 'The suggested departure has the best decision and score; the compared hazards otherwise change little.';
  // Suggest another start only when it is clearly better than the plan: a
  // better decision, or a score more than a point higher.
  const planned = scenarios.find((scenario) => scenario.startTime === plannedStart);
  const betterDecision = planned && decisionLevelRank(best.decision.level) > decisionLevelRank(planned.decision.level);
  const clearlyHigherScore = planned && best.score - planned.score > 1;
  const suggestion = allNoGo || effectivelyTied || best.startTime === plannedStart
    ? null
    : !planned
      ? 'has the best decision and score of these departures'
      : betterDecision
        ? `changes the decision to ${LEVEL_WORDS[best.decision.level] || best.decision.level}`
        : clearlyHigherScore
          ? `scores higher (${Math.round(best.score)} vs ${Math.round(planned.score)})`
          : null;

  return {
    scenarios: sorted,
    bestStartTime: best.startTime,
    drivingRisk,
    recommendationReason,
    effectivelyTied,
    allNoGo,
    suggestion,
  };
};

module.exports = {
  START_TIME_SCENARIO_TIMES,
  EXTENDED_START_TIME_SCENARIO_TIMES,
  includeUserStartTimeScenario,
  buildStartTimeScenario,
  compareStartTimeScenarios,
};
