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

/** Share of the trailhead-to-objective drop at which the in-between bands sit. */
const ROUTE_BAND_STEPS = [
  { label: 'Trailhead', share: 1 },
  { label: 'Mid Route', share: 0.5 },
  { label: 'Near Objective', share: 0.2 },
  { label: 'Objective Elevation', share: 0 },
];
/** Below this drop the default bands already describe the route. */
const MIN_TRAILHEAD_DROP_FT = 300;

/**
 * The forecast bands step down from the objective by fixed amounts. When the
 * trailhead is known (typed, GPX, or an analyzed route), span the bands from
 * that trailhead to the objective instead, so the lowest band is where the
 * party actually starts. Uses the objective band's readings and the same
 * lapse-rate model; returns the bands unchanged when either is missing.
 */
export function bandsFromTrailhead(bands: ElevationForecastBand[], trailheadElevationFt: number | null | undefined): ElevationForecastBand[] {
  const objective = bands.find((band) => band.deltaFromObjectiveFt === 0);
  if (!objective || typeof trailheadElevationFt !== 'number' || !Number.isFinite(trailheadElevationFt)) return bands;
  const dropFt = objective.elevationFt - Math.max(0, trailheadElevationFt);
  if (dropFt < MIN_TRAILHEAD_DROP_FT) return bands;
  const base = { temp: objective.temp, wind: objective.windSpeed, gust: objective.windGust };
  if (!Number.isFinite(base.temp) || !Number.isFinite(base.wind)) return bands;
  const seen = new Set<number>();
  return ROUTE_BAND_STEPS
    .map(({ label, share }) => {
      // The trailhead keeps its exact elevation; in-between bands round to 100 ft.
      const delta = share === 1 ? -Math.round(dropFt) : share === 0 ? 0 : -Math.round((dropFt * share) / 100) * 100;
      return { label, elevationFt: objective.elevationFt + delta, deltaFromObjectiveFt: delta, ...estimateAtElevation(base, delta) };
    })
    .filter((band) => !seen.has(band.elevationFt) && Boolean(seen.add(band.elevationFt)))
    .sort((a, b) => a.elevationFt - b.elevationFt);
}
