import type { FreshnessState, SafetyData, SummitDecision, UserPreferences } from './types';
import { alertSeverityRank } from './alert-utils';
import { freshnessClass } from './core';

export type SortableCardKey =
  | 'decisionGate'
  | 'criticalChecks'
  | 'atmosphericData'
  | 'heatRisk'
  | 'nwsAlerts'
  | 'travelWindowPlanner'
  | 'planSnapshot'
  | 'terrainTrailCondition'
  | 'snowpackSnapshot'
  | 'windLoading'
  | 'windLoadingHints'
  | 'recentRainfall'
  | 'fireRisk'
  | 'airQuality'
  | 'sourceFreshness'
  | 'scoreTrace'
  | 'recommendedGear';

export interface CardMeta {
  available: boolean;
  relevant: boolean;
  riskLevel: number;
  score: number;
  rank: number;
  defaultVisible: boolean;
}

export interface ReportCardOrder {
  decisionGate: number;
  scoreCard: number;
  avalancheForecast: number;
  reportColumns: number;
  criticalChecks: number;
  atmosphericData: number;
  heatRisk: number;
  nwsAlerts: number;
  travelWindowPlanner: number;
  planSnapshot: number;
  terrainTrailCondition: number;
  snowpackSnapshot: number;
  windLoading: number;
  windLoadingHints: number;
  recentRainfall: number;
  fireRisk: number;
  airQuality: number;
  sourceFreshness: number;
  scoreTrace: number;
  recommendedGear: number;
  deepDiveData: number;
  cardMeta: Record<SortableCardKey, CardMeta>;
}

export interface CardOrderingInputs {
  safetyData: SafetyData | null;
  decision: SummitDecision | null;
  preferences: UserPreferences;
  travelWindowRows: Array<{ pass: boolean; failedRuleLabels: string[] }>;
  criticalWindow: Array<{ level?: string }>;
  criticalCheckTotal: number;
  criticalCheckFailCount: number;
  avalancheRelevant: boolean;
  avalancheUnknown: boolean;
  windLoadingHintsRelevant: boolean;
  windLoadingLevel: string;
  windLoadingConfidence: string;
  resolvedWindDirection: string | null;
  calmOrVariableSignal: boolean;
  lightWindSignal: boolean;
  trendWindDirections: string[];
  rainfall12hIn: number;
  rainfall24hIn: number;
  rainfall48hIn: number;
  snowfall12hIn: number;
  snowfall24hIn: number;
  snowfall48hIn: number;
  snowpackDepthSignalValues: number[];
  snowpackSweSignalValues: number[];
  hasSnowpackSignal: boolean;
  sourceFreshnessRows: Array<{ issued: string | null; staleHours: number; stateOverride?: FreshnessState }>;
  gearRecommendations: unknown[];
  dayOverDay: unknown;
  fireRiskLevel: number;
  heatRiskLevel: number;
}

export function buildReportCardOrder(inputs: CardOrderingInputs): ReportCardOrder {
  const {
    safetyData, decision, preferences,
    travelWindowRows, criticalWindow,
    criticalCheckTotal, criticalCheckFailCount,
    avalancheRelevant, avalancheUnknown,
    windLoadingHintsRelevant, windLoadingConfidence,
    resolvedWindDirection, calmOrVariableSignal, lightWindSignal, trendWindDirections,
    rainfall12hIn, rainfall24hIn, rainfall48hIn,
    snowfall12hIn, snowfall24hIn, snowfall48hIn,
    snowpackDepthSignalValues, snowpackSweSignalValues, hasSnowpackSignal,
    sourceFreshnessRows, gearRecommendations, dayOverDay,
    fireRiskLevel, heatRiskLevel,
  } = inputs;

  const clampRiskLevel = (value: number): number => Math.max(0, Math.min(5, Math.round(value)));

  const trailText = String(safetyData?.terrainCondition?.label || safetyData?.trail || '').toLowerCase();
  const weatherDescription = String(safetyData?.weather.description || '').toLowerCase();
  const windGustNumeric = Number(safetyData?.weather.windGust);
  const windSpeedNumeric = Number(safetyData?.weather.windSpeed);
  const feelsLikeNumeric = Number(safetyData?.weather.feelsLike ?? safetyData?.weather.temp);
  const precipChanceNumeric = Number(safetyData?.weather.precipChance);
  const aqiNumeric = Number(safetyData?.airQuality?.usAqi);
  const scoreFactors = Array.isArray(safetyData?.safety?.factors) ? safetyData.safety.factors : [];
  const safetyScoreNumeric = Number(safetyData?.safety?.score);
  const weatherAvailable =
    Number.isFinite(Number(safetyData?.weather.temp)) ||
    (weatherDescription.length > 0 && weatherDescription !== 'unknown');
  const travelAvailable = travelWindowRows.length > 0;
  const terrainAvailable = trailText.length > 0 && !/weather unavailable/.test(trailText);
  const rainfallAvailable =
    Number.isFinite(rainfall12hIn) ||
    Number.isFinite(rainfall24hIn) ||
    Number.isFinite(rainfall48hIn) ||
    Number.isFinite(snowfall12hIn) ||
    Number.isFinite(snowfall24hIn) ||
    Number.isFinite(snowfall48hIn);
  const snowpackAvailable = ['ok', 'partial'].includes(String(safetyData?.snowpack?.status || '').toLowerCase());
  const windHintsAvailable =
    windLoadingHintsRelevant &&
    (Boolean(resolvedWindDirection) || calmOrVariableSignal || lightWindSignal || trendWindDirections.length > 0);
  const fireRiskAvailable = String(safetyData?.fireRisk?.status || '').toLowerCase() !== 'unavailable';
  const heatRiskAvailable =
    String(safetyData?.heatRisk?.status || '').toLowerCase() !== 'unavailable' ||
    Number.isFinite(Number(safetyData?.weather.temp)) ||
    Number.isFinite(Number(safetyData?.weather.feelsLike));
  const airQualityAvailable =
    Number.isFinite(aqiNumeric) ||
    Number.isFinite(Number(safetyData?.airQuality?.pm25)) ||
    Number.isFinite(Number(safetyData?.airQuality?.pm10));
  const sourceFreshnessAvailable = sourceFreshnessRows.length > 0;
  const scoreTraceAvailable = scoreFactors.length > 0 || Boolean(dayOverDay);
  const gearAvailable = gearRecommendations.length > 0;
  const planAvailable = Boolean(safetyData?.solar?.sunrise || safetyData?.solar?.sunset || safetyData?.forecast?.selectedDate);
  const alertsCardRelevant = true;
  const alertsList = safetyData?.alerts?.alerts || [];
  const nwsAlertCount = safetyData?.alerts?.activeCount ?? alertsList.length;
  const alertsActive = alertsCardRelevant && nwsAlertCount > 0;
  const highestAlertSeverity = Math.max(
    alertSeverityRank(safetyData?.alerts?.highestSeverity),
    alertsList.reduce((maxSeverity, alert) => Math.max(maxSeverity, alertSeverityRank(alert.severity)), 0),
  );
  const staleSourceCount = sourceFreshnessRows.filter((row) => (row.stateOverride || freshnessClass(row.issued, row.staleHours)) === 'stale').length;
  const missingSourceCount = sourceFreshnessRows.filter((row) => (row.stateOverride || freshnessClass(row.issued, row.staleHours)) === 'missing').length;
  const decisionLevel = decision?.level || 'CAUTION';
  const stormSignal = /thunder|storm|lightning|hail|blizzard/.test(weatherDescription);
  const travelFailHours = travelWindowRows.filter((row) => !row.pass).length;
  const travelFailRatio = travelWindowRows.length > 0 ? travelFailHours / travelWindowRows.length : 0;
  const criticalHighHours = criticalWindow.filter((row) => row.level === 'high').length;
  const criticalWatchHours = criticalWindow.filter((row) => row.level === 'watch').length;
  const daylightCheckFailed = Boolean(
    decision?.checks?.find((check) => /30 min before sunset/i.test(check.label || '') && check.ok === false),
  );
  const maxSnowpackDepth = Math.max(0, ...snowpackDepthSignalValues);
  const maxSnowpackSwe = Math.max(0, ...snowpackSweSignalValues);
  const terrainCode = String(safetyData?.terrainCondition?.code || '').toLowerCase();
  const gustThresholdDelta = Number.isFinite(windGustNumeric) ? windGustNumeric - preferences.maxWindGustMph : 0;
  const precipThresholdDelta = Number.isFinite(precipChanceNumeric) ? precipChanceNumeric - preferences.maxPrecipChance : 0;
  const coldThresholdDelta = Number.isFinite(feelsLikeNumeric) ? preferences.minFeelsLikeF - feelsLikeNumeric : 0;
  const windThresholdDelta = Number.isFinite(windSpeedNumeric) ? windSpeedNumeric - preferences.maxWindGustMph * 0.6 : 0;

  const decisionRiskLevel = decisionLevel === 'NO-GO' ? 5 : decisionLevel === 'CAUTION' ? 3 : 1;
  const criticalChecksRiskLevel =
    criticalCheckFailCount >= 3 ? 5 : criticalCheckFailCount >= 1 ? 4 : decisionLevel === 'NO-GO' ? 4 : 2;
  const atmosphericRiskLevel = (() => {
    if (stormSignal || gustThresholdDelta >= 15 || precipThresholdDelta >= 25) return 5;
    if (gustThresholdDelta >= 8 || precipThresholdDelta >= 10 || coldThresholdDelta >= 10) return 4;
    if (gustThresholdDelta > 0 || precipThresholdDelta > 0 || coldThresholdDelta > 0 || windThresholdDelta > 0) return 3;
    return 2;
  })();
  const heatRiskCardLevel = (() => {
    if (!heatRiskAvailable) return 0;
    if (!Number.isFinite(heatRiskLevel)) return 1;
    if (heatRiskLevel >= 4) return 5;
    if (heatRiskLevel >= 3) return 4;
    if (heatRiskLevel >= 2) return 3;
    if (heatRiskLevel >= 1) return 2;
    return 1;
  })();
  const alertsRiskLevel = (() => {
    if (!alertsCardRelevant) return 0;
    if (alertsActive && highestAlertSeverity >= 4) return 5;
    if (alertsActive && highestAlertSeverity >= 3) return 4;
    if (alertsActive) return 3;
    if (Number(safetyData?.alerts?.totalActiveCount) > 0) return 2;
    return 1;
  })();
  const travelRiskLevel = (() => {
    if (!travelAvailable) return 0;
    if (travelFailRatio >= 0.6 || criticalHighHours >= 3) return 5;
    if (travelFailRatio >= 0.35 || criticalHighHours >= 1) return 4;
    if (travelFailRatio > 0 || criticalWatchHours >= 3) return 3;
    return 2;
  })();
  const terrainRiskLevel = (() => {
    if (!terrainAvailable) return 0;
    if (terrainCode === 'snow_ice') return 4;
    if (['wet_muddy', 'cold_slick', 'dry_loose'].includes(terrainCode)) return 3;
    if (/snow|icy|wet|muddy|slick|loose/.test(trailText)) return 3;
    return 2;
  })();
  const snowpackRiskLevel = (() => {
    if (!snowpackAvailable) return 0;
    if (!avalancheRelevant) return 1;
    if (avalancheUnknown) return 4;
    if (maxSnowpackDepth >= 24 || maxSnowpackSwe >= 8) return 4;
    if (hasSnowpackSignal) return 3;
    return 2;
  })();
  const windLoadingRiskLevel = (() => {
    if (!windHintsAvailable) return 0;
    if (windLoadingConfidence === 'High') return 4;
    if (windLoadingConfidence === 'Moderate') return 3;
    return 2;
  })();
  const rainfallRiskLevel = (() => {
    if (!rainfallAvailable) return 0;
    if ((Number.isFinite(rainfall24hIn) && rainfall24hIn >= 0.75) || (Number.isFinite(snowfall24hIn) && snowfall24hIn >= 8)) return 4;
    if ((Number.isFinite(rainfall24hIn) && rainfall24hIn >= 0.25) || (Number.isFinite(snowfall24hIn) && snowfall24hIn >= 2)) return 3;
    if ((Number.isFinite(rainfall12hIn) && rainfall12hIn > 0) || (Number.isFinite(snowfall12hIn) && snowfall12hIn > 0)) return 2;
    return 1;
  })();
  const sourceFreshnessRiskLevel = (() => {
    if (!sourceFreshnessAvailable) return 0;
    if (missingSourceCount >= 2 || staleSourceCount >= 3) return 4;
    if (missingSourceCount >= 1 || staleSourceCount >= 1) return 3;
    return 1;
  })();
  const fireRiskCardLevel = (() => {
    if (!fireRiskAvailable) return 0;
    if (!Number.isFinite(fireRiskLevel)) return 1;
    if (fireRiskLevel >= 4) return 5;
    if (fireRiskLevel >= 3) return 4;
    if (fireRiskLevel >= 2) return 3;
    return 2;
  })();
  const airQualityRiskLevel = (() => {
    if (!airQualityAvailable) return 0;
    if (!Number.isFinite(aqiNumeric)) return 1;
    if (aqiNumeric > 150) return 5;
    if (aqiNumeric > 100) return 4;
    if (aqiNumeric > 50) return 3;
    return 2;
  })();
  const planRiskLevel = !planAvailable ? 0 : daylightCheckFailed ? 4 : 2;
  const scoreTraceRiskLevel = (() => {
    if (!scoreTraceAvailable) return 0;
    if (!Number.isFinite(safetyScoreNumeric)) return decisionRiskLevel;
    if (safetyScoreNumeric < 42) return 5;
    if (safetyScoreNumeric < 60) return 4;
    if (safetyScoreNumeric < 75) return 3;
    return 2;
  })();
  const recommendedGearRiskLevel = !gearAvailable ? 0 : Math.max(1, decisionRiskLevel - 1);

  const cards: Array<{ key: SortableCardKey; base: number; available: boolean; relevant: boolean; riskLevel: number }> = [
    { key: 'decisionGate', base: 100, available: true, relevant: true, riskLevel: decisionRiskLevel },
    { key: 'criticalChecks', base: 96, available: criticalCheckTotal > 0, relevant: true, riskLevel: criticalChecksRiskLevel },
    { key: 'atmosphericData', base: 94, available: weatherAvailable, relevant: true, riskLevel: atmosphericRiskLevel },
    { key: 'heatRisk', base: 93, available: heatRiskAvailable, relevant: true, riskLevel: heatRiskCardLevel },
    { key: 'nwsAlerts', base: 92, available: alertsCardRelevant, relevant: alertsCardRelevant, riskLevel: alertsRiskLevel },
    { key: 'travelWindowPlanner', base: 90, available: travelAvailable, relevant: true, riskLevel: travelRiskLevel },
    { key: 'terrainTrailCondition', base: 84, available: terrainAvailable, relevant: true, riskLevel: terrainRiskLevel },
    { key: 'snowpackSnapshot', base: 82, available: snowpackAvailable, relevant: true, riskLevel: snowpackRiskLevel },
    {
      key: 'windLoading',
      base: 81,
      available: windHintsAvailable,
      relevant: windLoadingHintsRelevant,
      riskLevel: windLoadingRiskLevel,
    },
    {
      key: 'windLoadingHints',
      base: 80,
      available: windHintsAvailable,
      relevant: windLoadingHintsRelevant,
      riskLevel: windLoadingRiskLevel,
    },
    { key: 'recentRainfall', base: 78, available: rainfallAvailable, relevant: true, riskLevel: rainfallRiskLevel },
    { key: 'sourceFreshness', base: 76, available: sourceFreshnessAvailable, relevant: true, riskLevel: sourceFreshnessRiskLevel },
    { key: 'fireRisk', base: 74, available: fireRiskAvailable, relevant: true, riskLevel: fireRiskCardLevel },
    { key: 'airQuality', base: 72, available: airQualityAvailable, relevant: true, riskLevel: airQualityRiskLevel },
    { key: 'planSnapshot', base: 70, available: planAvailable, relevant: true, riskLevel: planRiskLevel },
    { key: 'scoreTrace', base: 68, available: scoreTraceAvailable, relevant: true, riskLevel: scoreTraceRiskLevel },
    { key: 'recommendedGear', base: 64, available: gearAvailable, relevant: true, riskLevel: recommendedGearRiskLevel },
  ];

  const scored = cards.map((card) => {
    const relevancePenalty = card.relevant ? 0 : 60;
    const availabilityPenalty = card.available ? 0 : 35;
    const normalizedRisk = card.relevant && card.available ? clampRiskLevel(card.riskLevel) : 0;
    const score = card.base + normalizedRisk * 12 - relevancePenalty - availabilityPenalty + (card.available ? 0.25 : 0);
    return { ...card, riskLevel: normalizedRisk, score };
  });

  scored.sort((a, b) => b.score - a.score || b.riskLevel - a.riskLevel || b.base - a.base);
  const sortedKeys = scored.map((entry) => entry.key);
  const innerOrder = new Map<SortableCardKey, number>();
  sortedKeys.forEach((key, idx) => innerOrder.set(key, idx + 10));
  const cardMeta = sortedKeys.reduce<Record<SortableCardKey, CardMeta>>((acc, key, idx) => {
    const entry = scored.find((item) => item.key === key);
    if (!entry) {
      return acc;
    }
    acc[key] = {
      available: entry.available,
      relevant: entry.relevant,
      riskLevel: entry.riskLevel,
      score: entry.score,
      rank: idx + 1,
      defaultVisible: idx < 10 || entry.riskLevel >= 3,
    };
    return acc;
  }, {} as Record<SortableCardKey, CardMeta>);

  return {
    decisionGate: 0,
    scoreCard: 1,
    avalancheForecast: avalancheRelevant ? 2 : 130,
    reportColumns: 3,
    criticalChecks: innerOrder.get('criticalChecks') ?? 11,
    atmosphericData: innerOrder.get('atmosphericData') ?? 12,
    heatRisk: innerOrder.get('heatRisk') ?? 13,
    nwsAlerts: innerOrder.get('nwsAlerts') ?? 14,
    travelWindowPlanner: innerOrder.get('travelWindowPlanner') ?? 15,
    planSnapshot: innerOrder.get('planSnapshot') ?? 16,
    terrainTrailCondition: innerOrder.get('terrainTrailCondition') ?? 17,
    snowpackSnapshot: innerOrder.get('snowpackSnapshot') ?? 18,
    windLoading: innerOrder.get('windLoading') ?? 19,
    windLoadingHints: innerOrder.get('windLoadingHints') ?? 20,
    recentRainfall: innerOrder.get('recentRainfall') ?? 21,
    fireRisk: innerOrder.get('fireRisk') ?? 22,
    airQuality: innerOrder.get('airQuality') ?? 23,
    sourceFreshness: innerOrder.get('sourceFreshness') ?? 24,
    scoreTrace: innerOrder.get('scoreTrace') ?? 25,
    recommendedGear: innerOrder.get('recommendedGear') ?? 26,
    deepDiveData: 140,
    cardMeta,
  };
}
