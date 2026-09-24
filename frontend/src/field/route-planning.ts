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
    /** Route length the x axis spans, in miles, when spaced by distance. */
    spanMiles: axis === "distance" ? span : null,
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
  const flags = checkpointLimitFlags(point, limits);
  if (flags.feelsLike || flags.gust || flags.precip) return "over";
  const { windGust, precipChance } = point.weather;
  return hasRouteNumber(windGust) && hasRouteNumber(precipChance) && checkpointFeelsLike(point) !== null ? "within" : "missing";
}

/** Feels-like at a checkpoint, given or derived from temperature and wind; null when unknown. */
export function checkpointFeelsLike(point: RouteWaypointSummary): number | null {
  const { feelsLike, temp, windSpeed } = point.weather;
  return hasRouteNumber(feelsLike) ? feelsLike
    : hasRouteNumber(temp) && hasRouteNumber(windSpeed) ? computeFeelsLikeF(temp, windSpeed) : null;
}

/** Which of a checkpoint's readings cross the user's limits; unknown readings never do. */
export function checkpointLimitFlags(point: RouteWaypointSummary, limits: Limits) {
  if (!point.dataAvailable) return { feelsLike: false, gust: false, precip: false };
  const { windGust, precipChance } = point.weather;
  const feelsLike = checkpointFeelsLike(point);
  return {
    feelsLike: feelsLike !== null && (feelsLike < limits.minFeelsLikeF || feelsLike > limits.maxFeelsLikeF),
    gust: hasRouteNumber(windGust) && windGust > limits.maxWindGustMph,
    precip: hasRouteNumber(precipChance) && precipChance > limits.maxPrecipChance,
  };
}

/**
 * Round distance gridlines along the profile's x axis, in its 20–980 frame
 * units. `unitsPerMile` picks the display unit (1 for miles, 1.609344 for km)
 * so the ticks land on round numbers in that unit.
 */
export function buildDistanceTicks(spanMiles: number | null, unitsPerMile = 1): { x: number; value: number }[] {
  if (!hasRouteNumber(spanMiles) || spanMiles <= 0) return [];
  const span = spanMiles * unitsPerMile;
  const step = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100].find((s) => span / s <= 6) ?? 100;
  const ticks: { x: number; value: number }[] = [];
  for (let value = 0; value <= span + 1e-9; value += step) {
    ticks.push({ value: Math.round(value * 10) / 10, x: 20 + (value / span) * 960 });
  }
  return ticks;
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
  const distance = timing.distanceBasis === "straight-line"
    ? " Distances are straight lines between checkpoints, so the trail is longer."
    : timing.distanceBasis === "route-length"
      ? " Distances are scaled to the route's listed length."
      : "";
  const shape = timing.roundTrip
    ? " The route is treated as an out-and-back, so the checkpoints after the objective retrace it back to the start."
    : timing.routeShape === "loop"
      ? " The route is a loop, so the checkpoints after the objective continue around it back to the start."
      : timing.routeShape === "point-to-point"
        ? " The route is a traverse, so it finishes somewhere other than where it starts."
        : "";
  return `${spread}${shape}${distance}`;
}

/** "2026-09-09" → "Wed, Sep 9", read as a calendar date rather than a UTC instant. */
export function formatEtaDate(isoDate: string | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || "");
  if (!match) return isoDate || "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

export function formatLegDuration(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes / 5) * 5);
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export type RouteLegSummary = {
  minutes: number | null;
  elevationDeltaFt: number | null;
  distanceMiles: number | null;
};

/** Time, elevation change and distance between consecutive checkpoints; unknowns stay null. */
export function buildRouteLegs(summaries: RouteWaypointSummary[]): RouteLegSummary[] {
  return summaries.slice(1).map((next, i) => {
    const previous = summaries[i];
    const minutes = hasRouteNumber(next.offsetMinutes) && hasRouteNumber(previous.offsetMinutes)
      ? next.offsetMinutes - previous.offsetMinutes : null;
    const elevationDeltaFt = hasRouteNumber(next.elev_ft) && hasRouteNumber(previous.elev_ft)
      ? next.elev_ft - previous.elev_ft : null;
    const distanceMiles = hasRouteNumber(next.distance_miles) && hasRouteNumber(previous.distance_miles)
      && next.distance_miles >= previous.distance_miles ? next.distance_miles - previous.distance_miles : null;
    return { minutes: minutes !== null && minutes >= 0 ? minutes : null, elevationDeltaFt, distanceMiles };
  });
}

/** Rounded elevation gridlines for the profile, in its 30–155 frame units. */
export function buildProfileTicks(low: number, high: number): { y: number; feet: number }[] {
  const span = Math.max(100, high - low);
  const step = [100, 200, 250, 500, 1000, 2000, 2500, 5000].find((s) => span / s <= 4) ?? 5000;
  const ticks: { y: number; feet: number }[] = [];
  for (let feet = Math.ceil(low / step) * step; feet <= high; feet += step) {
    ticks.push({ feet, y: 155 - ((feet - low) / span) * 125 });
  }
  return ticks;
}

export type RouteBriefingSection = { key: string; label: string; text: string };

const BRIEFING_LABELS = ["Hazard zones", "Weather window", "Other concerns", "Decision points", "Gear check", "Bottom line"];

/**
 * Split a six-part route briefing ("HAZARD ZONES: …") into its sections. Returns
 * null for free-form text so it can be shown as written.
 */
export function splitRouteBriefing(text: string | null | undefined): RouteBriefingSection[] | null {
  if (!text) return null;
  const pattern = new RegExp(`(?:^|\\s)(${BRIEFING_LABELS.join("|")})\\s*:\\s*`, "gi");
  const matches = [...text.matchAll(pattern)];
  if (matches.length < 2) return null;
  return matches.map((match, i) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? text.length : text.length;
    const label = BRIEFING_LABELS.find((l) => l.toLowerCase() === match[1].toLowerCase()) ?? match[1];
    return { key: label.toLowerCase().replace(/\s+/g, "-"), label, text: text.slice(start, end).trim() };
  }).filter((section) => section.text);
}
