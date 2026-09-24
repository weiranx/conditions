import type { RouteAnalysisResult, RouteTiming, RouteWaypointSummary } from "../hooks/useRouteAnalysis";
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

/** One of the user's limits that a checkpoint forecast crosses, in mph, % and °F. */
export type CheckpointBreach = { kind: "gust" | "precip" | "cold" | "heat"; value: number; limit: number };

function checkpointFeelsLike(point: RouteWaypointSummary): number | null {
  const { feelsLike, temp, windSpeed } = point.weather;
  if (hasRouteNumber(feelsLike)) return feelsLike;
  return hasRouteNumber(temp) && hasRouteNumber(windSpeed) ? computeFeelsLikeF(temp, windSpeed) : null;
}

/** Every limit a checkpoint's measured forecast crosses; a missing reading crosses nothing. */
export function checkpointBreaches(point: RouteWaypointSummary, limits: Limits): CheckpointBreach[] {
  if (!point.dataAvailable) return [];
  const { windGust, precipChance } = point.weather;
  const feelsLike = checkpointFeelsLike(point);
  const breaches: CheckpointBreach[] = [];
  if (hasRouteNumber(windGust) && windGust > limits.maxWindGustMph) breaches.push({ kind: "gust", value: windGust, limit: limits.maxWindGustMph });
  if (hasRouteNumber(precipChance) && precipChance > limits.maxPrecipChance) breaches.push({ kind: "precip", value: precipChance, limit: limits.maxPrecipChance });
  if (feelsLike !== null && feelsLike < limits.minFeelsLikeF) breaches.push({ kind: "cold", value: feelsLike, limit: limits.minFeelsLikeF });
  if (feelsLike !== null && feelsLike > limits.maxFeelsLikeF) breaches.push({ kind: "heat", value: feelsLike, limit: limits.maxFeelsLikeF });
  return breaches;
}

/**
 * How a checkpoint's forecast sits against the user's limits. A measured breach
 * always wins; otherwise the checkpoint is "missing" unless gust, rain chance and
 * feels-like (given, or derived from temperature and wind) are all known, since a
 * partial forecast cannot confirm the checkpoint is within every limit.
 */
export function checkpointTone(point: RouteWaypointSummary, limits: Limits): "within" | "over" | "missing" {
  if (!point.dataAvailable) return "missing";
  if (checkpointBreaches(point, limits).length) return "over";
  const { windGust, precipChance } = point.weather;
  return hasRouteNumber(windGust) && hasRouteNumber(precipChance) && checkpointFeelsLike(point) !== null ? "within" : "missing";
}

export type RouteStopSummary = {
  name: string;
  eta: string | null;
  tone: "within" | "over" | "missing";
  dark: boolean;
  elevationFt: number | null;
};

/**
 * The planned route as the report shows it. "checking" while its checkpoints are
 * analyzed, "unchecked" when no analysis exists (and why), "checked" once one does.
 */
export type PlannedRouteSummary =
  | { state: "checking"; name: string; checkpointCount: number | null }
  | { state: "unchecked"; name: string; reason: "failed" | "saved" | "unavailable" | "sign-in" | "not-run" }
  | {
    state: "checked";
    name: string;
    tone: "within" | "over" | "missing";
    stops: RouteStopSummary[];
    /** Each stop's place along the route and height, from 0 to 1; null when an elevation is unknown. */
    profile: { x: number; y: number }[] | null;
    overCount: number;
    missingCount: number;
    firstOver: { name: string; eta: string | null; breach: CheckpointBreach } | null;
    finish: { eta: string; dark: boolean; returnToStart: boolean } | null;
    distanceMiles: number | null;
    gainFt: number | null;
  };

/** The analysis's own route name wins over the plan's, which may have been renamed since. */
function routeLabel(name: string, analysis: RouteAnalysisResult | null): string {
  return analysis?.routeName?.trim() || name.trim() || analysis?.routeSourceDetails?.matchedName?.trim() || "";
}

export function summarizePlannedRoute({ name, analysis, checking, error, limits, signedIn, available, saved }: {
  /** The route chosen in the plan; empty when none is. */
  name: string;
  analysis: RouteAnalysisResult | null;
  /** Set while this route's checkpoints are being analyzed (or the account that may analyze them is loading). */
  checking: { checkpointCount?: number; routeName?: string } | null;
  error: string | null;
  limits: Limits;
  signedIn: boolean;
  /** Whether this server offers route analysis. */
  available: boolean;
  /** A saved snapshot, which can't be analyzed again. */
  saved: boolean;
}): PlannedRouteSummary | null {
  const label = routeLabel(name, analysis) || (analysis ? "Your route" : "");
  if (!label) return null;
  if (!analysis) {
    if (checking) return { state: "checking", name: checking.routeName?.trim() || label, checkpointCount: checking.checkpointCount ?? null };
    const reason = error ? "failed" : saved ? "saved" : !available ? "unavailable" : !signedIn ? "sign-in" : "not-run";
    return { state: "unchecked", name: label, reason };
  }
  const summaries = analysis.summaries;
  const stops = summaries.map((point) => ({
    name: point.name,
    eta: point.etaTime || null,
    tone: checkpointTone(point, limits),
    dark: point.daylight === "dark",
    elevationFt: hasRouteNumber(point.elev_ft) ? point.elev_ft : null,
  }));
  const profile = buildCheckpointProfile(summaries);
  const overIndex = stops.findIndex((stop) => stop.tone === "over");
  const overCount = stops.filter((stop) => stop.tone === "over").length;
  const missingCount = stops.filter((stop) => stop.tone === "missing").length;
  const last = summaries.at(-1);
  const lastDistance = last?.distance_miles;
  const metaDistance = analysis.routeMetadata?.distanceMiles;
  const metaGain = analysis.routeMetadata?.elevationGainFt;
  return {
    state: "checked",
    name: label,
    // No checkpoint forecast at all confirms nothing about the route.
    tone: overCount ? "over" : missingCount || !stops.length ? "missing" : "within",
    stops,
    profile: profile?.points.map((point) => ({ x: (point.x - 20) / 960, y: (155 - point.y) / 125 })) ?? null,
    overCount,
    missingCount,
    firstOver: overIndex >= 0
      ? { name: stops[overIndex].name, eta: stops[overIndex].eta, breach: checkpointBreaches(summaries[overIndex], limits)[0] }
      : null,
    finish: last?.etaTime ? { eta: last.etaTime, dark: last.daylight === "dark", returnToStart: last.leg === "return" } : null,
    distanceMiles: hasRouteNumber(metaDistance) ? metaDistance : hasRouteNumber(lastDistance) ? lastDistance : null,
    gainFt: hasRouteNumber(metaGain) ? metaGain : null,
  };
}

/** "gusts 48 mph, over your 40 mph limit", worded like the hourly limit checks, to follow a colon. */
export function describeCheckpointBreach(breach: CheckpointBreach, format: { temp: (f: number) => string; wind: (mph: number) => string }): string {
  if (breach.kind === "gust") return `gusts ${format.wind(breach.value)}, over your ${format.wind(breach.limit)} limit`;
  if (breach.kind === "precip") return `rain chance ${Math.round(breach.value)}%, over your ${breach.limit}% limit`;
  if (breach.kind === "cold") return `feels like ${format.temp(breach.value)}, below your ${format.temp(breach.limit)} floor`;
  return `feels like ${format.temp(breach.value)}, above your ${format.temp(breach.limit)} ceiling`;
}

/**
 * The route analysis as plain report data for the AI explanation and chat. Readings
 * stay in the analysis's own units (°F, mph, %, ft, miles) and unknowns stay null.
 */
export function buildRouteReportContext(name: string, analysis: RouteAnalysisResult | null) {
  if (!analysis) return null;
  const number = (value: unknown) => (hasRouteNumber(value) ? value : null);
  const meta = analysis.routeMetadata;
  return {
    name: routeLabel(name, analysis) || null,
    source: analysis.routeSourceDetails?.sourceLabel || analysis.routeSource || null,
    basis: "Point forecasts at each checkpoint for its estimated arrival time. The decision level uses the objective's hourly forecast, not these.",
    distanceMiles: number(meta?.distanceMiles),
    elevationGainFt: number(meta?.elevationGainFt),
    maxElevationFt: number(meta?.maxElevationFt),
    partialData: Boolean(analysis.partialData),
    arrivalTiming: analysis.timing?.basis ?? null,
    checkpoints: analysis.summaries.map((point) => ({
      name: point.name,
      elevationFt: number(point.elev_ft),
      distanceMiles: number(point.distance_miles),
      returnLeg: point.leg === "return",
      etaDate: point.etaDate || null,
      etaTime: point.etaTime || null,
      daylight: point.daylight ?? null,
      forecastAvailable: point.dataAvailable,
      ...(point.dataAvailable
        ? {
          description: point.weather.description || null,
          tempF: number(point.weather.temp),
          feelsLikeF: number(point.weather.feelsLike),
          windGustMph: number(point.weather.windGust),
          precipChance: number(point.weather.precipChance),
          avalancheRisk: point.avalanche?.risk || null,
          activeAlerts: number(point.activeAlerts),
        }
        : {}),
    })),
  };
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
    const distanceMiles = next.leg !== "return" && hasRouteNumber(next.distance_miles) && hasRouteNumber(previous.distance_miles)
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
