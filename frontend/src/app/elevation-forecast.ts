import type { ElevationForecastBand } from './types';
import {
  GUST_INCREASE_MPH_PER_1000FT,
  TEMP_LAPSE_F_PER_1000FT,
  WIND_INCREASE_MPH_PER_1000FT,
} from './constants';
import { computeFeelsLikeF } from './planner-helpers';

/** Objective-elevation readings (°F, mph) for one hour. */
export interface ElevationBase {
  temp: number;
  wind: number;
  gust: number;
}

/**
 * Estimate conditions `deltaFt` above (or below) the objective using the same
 * lapse-rate model the backend uses for the start-hour bands.
 */
export function estimateAtElevation(base: ElevationBase, deltaFt: number) {
  const deltaKft = deltaFt / 1000;
  const temp = Math.round(base.temp - deltaKft * TEMP_LAPSE_F_PER_1000FT);
  const windSpeed = Math.max(0, Math.round(base.wind + deltaKft * WIND_INCREASE_MPH_PER_1000FT));
  const windGust = Number.isFinite(base.gust)
    ? Math.max(windSpeed, Math.round(base.gust + deltaKft * GUST_INCREASE_MPH_PER_1000FT))
    : windSpeed;
  return { temp, feelsLike: computeFeelsLikeF(temp, windSpeed), windSpeed, windGust };
}

/** Re-derive the elevation bands from a different hour's objective readings. */
export function rebaseElevationBands(bands: ElevationForecastBand[], base: ElevationBase): ElevationForecastBand[] {
  if (!Number.isFinite(base.temp) || !Number.isFinite(base.wind)) return bands;
  return bands.map((band) => ({ ...band, ...estimateAtElevation(base, band.deltaFromObjectiveFt) }));
}
