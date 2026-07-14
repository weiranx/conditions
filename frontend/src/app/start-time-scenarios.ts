import type { DecisionLevel, SafetyData, SummitDecision, UserPreferences } from './types';
import { normalizedDecisionScore, decisionLevelRank } from './decision';
import { parseSolarClockMinutes, parseTimeInputMinutes } from './core';
import { computeFeelsLikeF } from './planner-helpers';

export const START_TIME_SCENARIO_TIMES = ['04:00', '06:00', '08:00'] as const;
export const EXTENDED_START_TIME_SCENARIO_TIMES = [
  '03:00',
  '04:00',
  '05:00',
  '06:00',
  '07:00',
  '08:00',
  '09:00',
  '10:00',
] as const;

function scenarioTimeMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return (hours * 60) + minutes;
}

export function includeUserStartTimeScenario(
  presetTimes: readonly string[],
  userStartTime: string,
): string[] {
  const userMinutes = scenarioTimeMinutes(userStartTime);
  if (userMinutes === null || presetTimes.length === 0) return [...presetTimes];

  const normalizedUserTime = `${String(Math.floor(userMinutes / 60)).padStart(2, '0')}:${String(userMinutes % 60).padStart(2, '0')}`;
  if (presetTimes.includes(normalizedUserTime)) return [...presetTimes];

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
  result[closestIndex] = normalizedUserTime;
  return result.sort((a, b) => (scenarioTimeMinutes(a) ?? 0) - (scenarioTimeMinutes(b) ?? 0));
}

export type StartTimeScenarioRisk = 'Storm / lightning' | 'Wind' | 'Heat' | 'Precipitation' | 'Avalanche' | 'Visibility' | 'Daylight';

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
  stormHours: number;
  cleanHours: number;
  visibilityHours: number;
  data: SafetyData;
}

export interface StartTimeScenarioComparison {
  scenarios: StartTimeScenario[];
  bestStartTime: string;
  drivingRisk: StartTimeScenarioRisk;
  recommendationReason: string;
  effectivelyTied: boolean;
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
  const avalancheRelevant = Boolean(data.avalanche && data.avalanche.relevant !== false);
  const avalancheKnown = avalancheRelevant && !data.avalanche?.dangerUnknown && data.avalanche?.coverageStatus === 'reported';
  const avalancheLevel = avalancheKnown && Number.isFinite(Number(data.avalanche?.dangerLevel))
    ? Number(data.avalanche?.dangerLevel)
    : null;
  const avalancheLabel = !data.avalanche
    ? ''
    : !avalancheRelevant
    ? 'Not relevant'
    : avalancheLevel !== null
      ? `D${avalancheLevel}`
      : 'Unknown';
  const stormHours = trend.filter((point) => /thunder|lightning|hail|tornado|convective/i.test(point.condition || '')).length;
  const visibilityHours = Math.max(0, Number(data.weather?.visibilityRisk?.activeHours) || 0);
  const cleanHours = Math.max(0, trend.length - stormHours);

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
    stormHours,
    cleanHours,
    visibilityHours,
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
    case 'Storm / lightning':
      return scenario.stormHours / Math.max(1, preferences.travelWindowHours);
    case 'Visibility':
      return scenario.visibilityHours / Math.max(1, preferences.travelWindowHours);
    case 'Daylight':
      return scenario.daylightRemainingMinutes === null ? 0 : Math.max(0, 180 - scenario.daylightRemainingMinutes) / 180;
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
    if (b.cleanHours !== a.cleanHours) return b.cleanHours - a.cleanHours;
    const daylightA = a.daylightRemainingMinutes ?? -Infinity;
    const daylightB = b.daylightRemainingMinutes ?? -Infinity;
    if (daylightB !== daylightA) return daylightB - daylightA;
    return a.startTime.localeCompare(b.startTime);
  });
  const best = sorted[0];
  const avalancheAvailable = scenarios.some((scenario) => Boolean(scenario.data.avalanche));
  const risks: Exclude<StartTimeScenarioRisk, 'Daylight'>[] = [
    'Storm / lightning',
    'Wind',
    'Heat',
    'Precipitation',
    ...(avalancheAvailable ? ['Avalanche' as const] : []),
    'Visibility',
  ];
  const normalizedSpread: Record<Exclude<StartTimeScenarioRisk, 'Daylight'>, number> = {
    'Storm / lightning': range(scenarios.map((scenario) => scenario.stormHours)) / Math.max(1, preferences.travelWindowHours),
    Wind: range(scenarios.map((scenario) => scenario.peakGustMph)) / Math.max(1, preferences.maxWindGustMph),
    Heat: range(scenarios.map((scenario) => scenario.peakFeelsLikeF)) / 15,
    Precipitation: range(scenarios.map((scenario) => scenario.peakPrecipChance)) / Math.max(1, preferences.maxPrecipChance),
    Avalanche: range(scenarios.map((scenario) => scenario.avalancheLevel)) / 2,
    Visibility: range(scenarios.map((scenario) => scenario.visibilityHours)) / Math.max(1, preferences.travelWindowHours),
  };
  const hasMeaningfulSpread = risks.some((risk) => normalizedSpread[risk] > 0.01);
  const changingRisk = [...risks].sort((a, b) => {
    const spreadDelta = normalizedSpread[b] - normalizedSpread[a];
    if (Math.abs(spreadDelta) > 0.001) return spreadDelta;
    return riskPressure(best, b, preferences) - riskPressure(best, a, preferences);
  })[0];
  const drivingRisk: StartTimeScenarioRisk = hasMeaningfulSpread ? changingRisk : 'Daylight';
  const scoreRange = range(scenarios.map((scenario) => scenario.score));
  const sameDecisionLevel = scenarios.every((scenario) => scenario.decision.level === best.decision.level);
  const effectivelyTied = sameDecisionLevel && scoreRange <= 1;
  const cleanHourRange = range(scenarios.map((scenario) => scenario.cleanHours));
  const levelLabel: Record<DecisionLevel, string> = { GO: 'go', CAUTION: 'caution', 'NO-GO': 'no-go' };
  const recommendationReason = effectivelyTied
    ? cleanHourRange > 0
      ? `Overall scores are effectively tied; ${best.startTime} keeps ${best.cleanHours} of ${preferences.travelWindowHours} hours free of a thunderstorm signal and preserves the most daylight margin.`
      : `Overall scores are effectively tied; ${best.startTime} is shown first because it preserves the most daylight margin.`
    : hasMeaningfulSpread
      ? `${drivingRisk} changes most across these departure windows; ${best.startTime} has the strongest overall ${levelLabel[best.decision.level]} assessment.`
      : `${best.startTime} has the strongest score and daylight margin; the compared hazard values otherwise change little.`;

  return {
    scenarios: sorted,
    bestStartTime: best.startTime,
    drivingRisk,
    recommendationReason,
    effectivelyTied,
  };
}
