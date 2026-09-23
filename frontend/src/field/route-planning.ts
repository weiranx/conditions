import type { RouteTiming, RouteWaypointSummary } from "../hooks/useRouteAnalysis";
import { computeFeelsLikeF } from "../app/planner-helpers";

export function hasRouteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Do not invent elevations or imply equal distances between uneven checkpoints. */
export function buildCheckpointProfile(summaries: RouteWaypointSummary[]) {
  const elevations = summaries.map((p) => p.elev_ft);
  if (summaries.length < 2 || !elevations.every(hasRouteNumber)) return null;
  const low = Math.min(...elevations);
  const high = Math.max(...elevations);
  const distances = summaries.map((p) => p.distance_miles);
  const progress = summaries.map((p) => p.progress_percent);
  const ordered = (values: unknown[]): values is number[] =>
    values.every((value, i) => hasRouteNumber(value) && value >= 0 &&
      (i === 0 || value >= (values[i - 1] as number))) &&
    (values.at(-1) as number) > (values[0] as number);
  const axis = ordered(distances) ? "distance" : ordered(progress) ? "progress" : "order";
  const positions = axis === "distance" ? distances as number[] :
    axis === "progress" ? progress as number[] : summaries.map((_, i) => i);
  const first = positions[0];
  const span = positions[positions.length - 1] - first;
  return {
    axis,
    low,
    high,
    points: elevations.map((_, i) => ({
      x: 20 + ((positions[i] - first) / span) * 960,
      y: 155 - ((elevations[i] - low) / Math.max(100, high - low)) * 125,
    })),
  };
}

type Limits = { maxWindGustMph: number; maxPrecipChance: number; minFeelsLikeF: number; maxFeelsLikeF: number };

/**
 * How a checkpoint's forecast sits against the user's limits. A measured breach
 * always wins; otherwise the checkpoint is "missing" unless gust, rain chance and
 * feels-like (given, or derived from temperature and wind) are all known, since a
 * partial forecast cannot confirm the checkpoint is within every limit.
 */
export function checkpointTone(point: RouteWaypointSummary, limits: Limits): "within" | "over" | "missing" {
  if (!point.dataAvailable) return "missing";
  const { windGust, precipChance, temp, windSpeed } = point.weather;
  const feelsLike = hasRouteNumber(point.weather.feelsLike) ? point.weather.feelsLike
    : hasRouteNumber(temp) && hasRouteNumber(windSpeed) ? computeFeelsLikeF(temp, windSpeed) : null;
  const over = (hasRouteNumber(windGust) && windGust > limits.maxWindGustMph)
    || (hasRouteNumber(precipChance) && precipChance > limits.maxPrecipChance)
    || (feelsLike !== null && (feelsLike < limits.minFeelsLikeF || feelsLike > limits.maxFeelsLikeF));
  if (over) return "over";
  return hasRouteNumber(windGust) && hasRouteNumber(precipChance) && feelsLike !== null ? "within" : "missing";
}

/** Explain how checkpoint arrival times were estimated; older saved analyses have no timing. */
export function describeRouteTiming(timing: RouteTiming | undefined): string {
  if (!timing) return "Estimated arrivals use your planned duration, not terrain-adjusted pace.";
  const window = `your ${timing.travelWindowHours}-hour plan`;
  const spread = timing.basis === "distance-and-vert"
    ? `Arrivals spread ${window} by distance and climbing${timing.paceSource === "user" ? ", weighted by your pace settings" : ""}.`
    : timing.basis === "distance"
      ? `Arrivals spread ${window} by distance only; some checkpoint elevations are unknown, so climbing is not weighted.`
      : timing.basis === "progress"
        ? `Arrivals spread ${window} by route progress, not terrain-adjusted pace.`
        : `Arrivals are spaced evenly across ${window} because route distances are unknown.`;
  return timing.roundTrip ? `${spread} The route is treated as an out-and-back, so the last checkpoint is your return to the start.` : spread;
}
