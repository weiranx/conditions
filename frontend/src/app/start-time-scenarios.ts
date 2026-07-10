import type { DecisionLevel, SafetyData, SummitDecision, UserPreferences } from './types';
import { normalizedDecisionScore, decisionLevelRank } from './decision';
import { parseSolarClockMinutes, parseTimeInputMinutes } from './core';
import { computeFeelsLikeF } from './planner-helpers';

export const START_TIME_SCENARIO_TIMES = ['04:00', '06:00', '08:00'] as const;

export type StartTimeScenarioRisk = 'Wind' | 'Heat' | 'Precipitation' | 'Avalanche';

export interface StartTimeScenario {
  startTime: string;
  summitTime: string;
  returnTime: string;
  returnDayOffset: number;
  daylightRemainingMinutes: number | null;
  decision: SummitDecision;
  score: number;
  peakGustMph: number;
  peakFeelsLikeF: number | null;
  peakPrecipChance: number;
  avalancheLevel: number | null;
  avalancheLabel: string;
  data: SafetyData;
}

export interface StartTimeScenarioComparison {
  scenarios: StartTimeScenario[];
  bestStartTime: string;
  drivingRisk: StartTimeScenarioRisk;
  recommendationReason: string;
}

function clockFromMinutes(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function finiteMax(values: Array<number | null | undefined>, fallback: number): number {
  const finite = values.map(Number).filter(Number.isFinite);
  return finite.length > 0 ? Math.max(...finite) : fallback;
}

export function buildStartTimeScenario(
  startTime: string,
  data: SafetyData,
  decision: SummitDecision,
  preferences: UserPreferences,
): StartTimeScenario {
  const startMinutes = parseTimeInputMinutes(startTime) ?? 0;
  const durationMinutes = Math.max(1, Math.round(Number(preferences.travelWindowHours) || 12)) * 60;
  const trend = Array.isArray(data.weather?.trend) ? data.weather.trend.slice(0, preferences.travelWindowHours) : [];
  const peakGustMph = finiteMax([data.weather?.windGust, ...trend.map((point) => point.gust)], 0);
  const peakPrecipChance = finiteMax([data.weather?.precipChance, ...trend.map((point) => point.precipChance)], 0);
  const peakFeelsLikeF = finiteMax(
    [
      data.weather?.feelsLike,
      data.weather?.temp,
      ...trend.map((point) => computeFeelsLikeF(Number(point.temp), Number(point.wind))),
    ],
    Number.NaN,
  );
  const returnMinutes = startMinutes + durationMinutes;
  const sunsetMinutes = parseSolarClockMinutes(data.solar?.sunset);
  const avalancheRelevant = data.avalanche?.relevant !== false;
  const avalancheKnown = avalancheRelevant && !data.avalanche?.dangerUnknown && data.avalanche?.coverageStatus === 'reported';
  const avalancheLevel = avalancheKnown && Number.isFinite(Number(data.avalanche?.dangerLevel))
    ? Number(data.avalanche.dangerLevel)
    : null;
  const avalancheLabel = !avalancheRelevant
    ? 'Not relevant'
    : avalancheLevel !== null
      ? `D${avalancheLevel}`
      : 'Unknown';

  return {
    startTime,
    summitTime: clockFromMinutes(startMinutes + Math.round(durationMinutes / 2)),
    returnTime: clockFromMinutes(returnMinutes),
    returnDayOffset: Math.floor(returnMinutes / 1440),
    daylightRemainingMinutes: sunsetMinutes === null ? null : sunsetMinutes - returnMinutes,
    decision,
    score: normalizedDecisionScore(data),
    peakGustMph,
    peakFeelsLikeF: Number.isFinite(peakFeelsLikeF) ? peakFeelsLikeF : null,
    peakPrecipChance,
    avalancheLevel,
    avalancheLabel,
    data,
  };
}

function range(values: Array<number | null>, fallback = 0): number {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return finite.length > 1 ? Math.max(...finite) - Math.min(...finite) : fallback;
}

function riskPressure(scenario: StartTimeScenario, risk: StartTimeScenarioRisk, preferences: UserPreferences): number {
  switch (risk) {
    case 'Wind':
      return scenario.peakGustMph / Math.max(1, preferences.maxWindGustMph);
    case 'Heat':
      return scenario.peakFeelsLikeF === null ? 0 : scenario.peakFeelsLikeF / Math.max(1, preferences.maxFeelsLikeF);
    case 'Precipitation':
      return scenario.peakPrecipChance / Math.max(1, preferences.maxPrecipChance);
    case 'Avalanche':
      return scenario.avalancheLevel === null ? 0 : scenario.avalancheLevel / 3;
  }
}

export function compareStartTimeScenarios(
  scenarios: StartTimeScenario[],
  preferences: UserPreferences,
): StartTimeScenarioComparison | null {
  if (scenarios.length === 0) return null;

  const sorted = [...scenarios].sort((a, b) => {
    const levelDelta = decisionLevelRank(b.decision.level) - decisionLevelRank(a.decision.level);
    if (levelDelta !== 0) return levelDelta;
    if (b.score !== a.score) return b.score - a.score;
    const daylightA = a.daylightRemainingMinutes ?? -Infinity;
    const daylightB = b.daylightRemainingMinutes ?? -Infinity;
    if (daylightB !== daylightA) return daylightB - daylightA;
    return a.startTime.localeCompare(b.startTime);
  });
  const best = sorted[0];
  const risks: StartTimeScenarioRisk[] = ['Wind', 'Heat', 'Precipitation', 'Avalanche'];
  const normalizedSpread: Record<StartTimeScenarioRisk, number> = {
    Wind: range(scenarios.map((scenario) => scenario.peakGustMph)) / Math.max(1, preferences.maxWindGustMph),
    Heat: range(scenarios.map((scenario) => scenario.peakFeelsLikeF)) / 15,
    Precipitation: range(scenarios.map((scenario) => scenario.peakPrecipChance)) / Math.max(1, preferences.maxPrecipChance),
    Avalanche: range(scenarios.map((scenario) => scenario.avalancheLevel)) / 2,
  };
  const hasMeaningfulSpread = risks.some((risk) => normalizedSpread[risk] > 0.01);
  const drivingRisk = [...risks].sort((a, b) => {
    const spreadDelta = normalizedSpread[b] - normalizedSpread[a];
    if (Math.abs(spreadDelta) > 0.001) return spreadDelta;
    return riskPressure(best, b, preferences) - riskPressure(best, a, preferences);
  })[0];
  const levelLabel: Record<DecisionLevel, string> = { GO: 'go', CAUTION: 'caution', 'NO-GO': 'no-go' };
  const recommendationReason = hasMeaningfulSpread
    ? `${drivingRisk} changes most across these departure windows; ${best.startTime} has the strongest overall ${levelLabel[best.decision.level]} assessment.`
    : `${drivingRisk} is the leading shared constraint; ${best.startTime} preserves the best score and daylight margin.`;

  return {
    scenarios,
    bestStartTime: best.startTime,
    drivingRisk,
    recommendationReason,
  };
}
