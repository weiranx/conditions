import type { SafetyData, WeatherTrendPoint } from './types';
import { normalizedDecisionScore } from './decision';

type TripWeatherWindowScoreInput = {
  data: SafetyData;
  trendWindow: WeatherTrendPoint[];
  travelPassHours: number;
  travelTotalHours: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteMax(values: unknown[]): number | null {
  const finiteValues = values.flatMap((value) => {
    if (value === null || value === undefined || value === '') return [];
    const parsed = Number(value);
    return Number.isFinite(parsed) ? [parsed] : [];
  });
  return finiteValues.length > 0 ? Math.max(...finiteValues) : null;
}

function hasSafetyFactor(data: SafetyData, pattern: RegExp): boolean {
  return (Array.isArray(data.safety?.factors) ? data.safety.factors : []).some((factor) =>
    pattern.test(String(factor?.hazard || '')),
  );
}

/**
 * Adds resolution below the main safety model's hard hazard thresholds.
 *
 * The primary safety score remains the anchor. This refinement only accounts
 * for mild wind/precipitation that did not already create a safety factor and
 * for preference-based travel hours that do not pass every threshold. Keeping
 * one decimal prevents materially different seven-day windows from collapsing
 * to the same displayed integer without inventing artificial day ordering.
 */
export function calculateTripWeatherWindowScore({
  data,
  trendWindow,
  travelPassHours,
  travelTotalHours,
}: TripWeatherWindowScoreInput): number | null {
  const rawSafetyScore = Number(data.safety?.score);
  if (!Number.isFinite(rawSafetyScore)) return null;

  const baseScore = normalizedDecisionScore(data, { ignoreAvalancheForDecision: true });
  const peakGustMph = finiteMax([
    data.weather?.windGust,
    ...trendWindow.map((point) => point.gust),
  ]);
  const peakPrecipChance = finiteMax([
    data.weather?.precipChance,
    ...trendWindow.map((point) => point.precipChance),
  ]);

  let refinementPenalty = 0;

  // Hard wind and storm factors are already represented in the base score.
  // Below those thresholds, retain enough resolution to compare mild days.
  if (!hasSafetyFactor(data, /^wind$/i) && peakGustMph !== null) {
    refinementPenalty += clamp(peakGustMph - 5, 0, 25) / 8;
  }
  if (!hasSafetyFactor(data, /^(storm|winter weather)$/i) && peakPrecipChance !== null) {
    refinementPenalty += clamp(peakPrecipChance, 0, 40) / 8;
  }

  if (travelTotalHours > 0) {
    const passRatio = clamp(travelPassHours / travelTotalHours, 0, 1);
    refinementPenalty += (1 - passRatio) * 2;
  }

  const refinedScore = clamp(baseScore - refinementPenalty, 0, 100);
  return Math.round(refinedScore * 10) / 10;
}
