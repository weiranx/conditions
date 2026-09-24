import type { RouteAnalysisResult, RouteShapeChoice, RouteTiming, RouteWaypointSummary } from "../hooks/useRouteAnalysis";
import { computeFeelsLikeF } from "../app/planner-helpers";

export function hasRouteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Checkpoints placed along the route by distance (or progress, or order) and
 * height. Needs two known elevations; an unknown one is drawn between its
 * neighbours and flagged `estimated`, never given a number of its own.
 */
export function buildCheckpointProfile(summaries: RouteWaypointSummary[]) {
  const known = summaries.map((p) => (hasRouteNumber(p.elev_ft) ? p.elev_ft : null));
  const knownValues = known.filter((value): value is number => value !== null);
  if (summaries.length < 2 || knownValues.length < 2) return null;
  const low = Math.min(...knownValues);
  const high = Math.max(...knownValues);
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
  // Unknown elevations sit on the straight line between the known ones either side.
  const elevations = known.map((value, i) => {
    if (value !== null) return value;
    let before = i - 1;
    while (before >= 0 && known[before] === null) before -= 1;
    let after = i + 1;
    while (after < known.length && known[after] === null) after += 1;
    if (before < 0) return known[after] as number;
    if (after >= known.length) return known[before] as number;
    const gap = positions[after] - positions[before];
    const t = gap > 0 ? (positions[i] - positions[before]) / gap : (i - before) / (after - before);
    return (known[before] as number) + ((known[after] as number) - (known[before] as number)) * t;
  });
  return {
    axis,
    low,
    high,
    /** Route length the x axis spans, in miles, when spaced by distance. */
    spanMiles: axis === "distance" ? span : null,
    points: elevations.map((elevation, i) => ({
      x: 20 + ((positions[i] - first) / span) * 960,
      y: 155 - ((elevation - low) / Math.max(100, high - low)) * 125,
      estimated: known[i] === null,
    })),
  };
}

type Limits = { maxWindGustMph: number; maxPrecipChance: number; minFeelsLikeF: number; maxFeelsLikeF: number };

/** One of the user's limits that a checkpoint forecast crosses, in mph, % and °F. */
export type CheckpointBreach = { kind: "gust" | "precip" | "cold" | "heat"; value: number; limit: number };

/** Feels-like at a checkpoint, given or derived from temperature and wind; null when unknown. */
export function checkpointFeelsLike(point: RouteWaypointSummary): number | null {
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

export type CheckpointTone = "within" | "over" | "hazard" | "missing";

/** Avalanche danger from Considerable (3) up is flagged along the route. */
const AVALANCHE_HAZARD_LEVEL = 3;

/** An official hazard at a checkpoint: an active weather alert, or Considerable or higher avalanche danger. */
export type CheckpointHazard =
  | { kind: "alert"; count: number }
  | { kind: "avalanche"; level: number; risk: string | null };

/** Hazards the checkpoint's own forecast reports; a missing forecast reports none. */
export function checkpointHazards(point: RouteWaypointSummary): CheckpointHazard[] {
  if (!point.dataAvailable) return [];
  const hazards: CheckpointHazard[] = [];
  if (hasRouteNumber(point.activeAlerts) && point.activeAlerts > 0) hazards.push({ kind: "alert", count: point.activeAlerts });
  const level = point.avalanche?.dangerLevel;
  if (hasRouteNumber(level) && level >= AVALANCHE_HAZARD_LEVEL) hazards.push({ kind: "avalanche", level, risk: point.avalanche?.risk || null });
  return hazards;
}

/**
 * How a checkpoint's forecast sits against the user's limits. A measured breach
 * always wins, then an official hazard (alert or avalanche danger); otherwise the
 * checkpoint is "missing" unless gust, rain chance and feels-like (given, or
 * derived from temperature and wind) are all known, since a partial forecast
 * cannot confirm the checkpoint is within every limit.
 */
export function checkpointTone(point: RouteWaypointSummary, limits: Limits): CheckpointTone {
  if (!point.dataAvailable) return "missing";
  if (checkpointBreaches(point, limits).length) return "over";
  if (checkpointHazards(point).length) return "hazard";
  const { windGust, precipChance } = point.weather;
  return hasRouteNumber(windGust) && hasRouteNumber(precipChance) && checkpointFeelsLike(point) !== null ? "within" : "missing";
}

/** Which of a checkpoint's readings cross the user's limits; unknown readings never do. */
export function checkpointLimitFlags(point: RouteWaypointSummary, limits: Limits) {
  const kinds = new Set(checkpointBreaches(point, limits).map((breach) => breach.kind));
  return { feelsLike: kinds.has("cold") || kinds.has("heat"), gust: kinds.has("gust"), precip: kinds.has("precip") };
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

export type RouteStopSummary = {
  name: string;
  eta: string | null;
  tone: CheckpointTone;
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
    tone: CheckpointTone;
    stops: RouteStopSummary[];
    /** Each stop's place along the route and height, from 0 to 1; null when fewer than two elevations are known. */
    profile: { x: number; y: number }[] | null;
    overCount: number;
    /** Checkpoints within the user's limits but under an official alert or avalanche danger. */
    hazardCount: number;
    missingCount: number;
    firstOver: { name: string; eta: string | null; breach: CheckpointBreach } | null;
    firstHazard: { name: string; eta: string | null; hazard: CheckpointHazard } | null;
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
  const hazardIndex = stops.findIndex((stop) => stop.tone === "hazard");
  const hazardCount = stops.filter((stop) => stop.tone === "hazard").length;
  const missingCount = stops.filter((stop) => stop.tone === "missing").length;
  const last = summaries.at(-1);
  const lastDistance = last?.distance_miles;
  const metaDistance = analysis.routeMetadata?.distanceMiles;
  const metaGain = analysis.routeMetadata?.elevationGainFt;
  return {
    state: "checked",
    name: label,
    // No checkpoint forecast at all confirms nothing about the route.
    tone: overCount ? "over" : hazardCount ? "hazard" : missingCount || !stops.length ? "missing" : "within",
    stops,
    profile: profile?.points.map((point) => ({ x: (point.x - 20) / 960, y: (155 - point.y) / 125 })) ?? null,
    overCount,
    hazardCount,
    missingCount,
    firstOver: overIndex >= 0
      ? { name: stops[overIndex].name, eta: stops[overIndex].eta, breach: checkpointBreaches(summaries[overIndex], limits)[0] }
      : null,
    firstHazard: hazardIndex >= 0
      ? { name: stops[hazardIndex].name, eta: stops[hazardIndex].eta, hazard: checkpointHazards(summaries[hazardIndex])[0] }
      : null,
    finish: last?.etaTime ? { eta: last.etaTime, dark: last.daylight === "dark", returnToStart: last.leg === "return" || analysis.timing?.routeShape === "loop" } : null,
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

type ObjectiveHour = { timeIso?: string | null; temp: number | null; gust: number | null; precipChance?: number | null };

/**
 * The objective's own hourly forecast for a checkpoint's arrival hour, matched on
 * the local date and hour in the forecast's timestamp; null when the report has no such hour.
 */
export function objectiveHourAt(trend: ObjectiveHour[] | null | undefined, etaDate: string | undefined, etaTime: string | undefined): ObjectiveHour | null {
  if (!etaDate || !/^\d{2}:\d{2}$/.test(etaTime || "")) return null;
  const key = `${etaDate}T${(etaTime as string).slice(0, 2)}`;
  return (trend || []).find((hour) => typeof hour.timeIso === "string" && hour.timeIso.startsWith(key)) ?? null;
}

/**
 * How a checkpoint's forecast differs from the objective's at the same hour: the
 * checkpoint's reading minus the objective's, null where either is unknown.
 */
export function compareCheckpointToObjective(point: RouteWaypointSummary, objective: ObjectiveHour | null) {
  if (!objective || !point.dataAvailable) return null;
  const diff = (a: unknown, b: unknown) => (hasRouteNumber(a) && hasRouteNumber(b) ? a - b : null);
  const result = {
    temp: diff(point.weather.temp, objective.temp),
    gust: diff(point.weather.windGust, objective.gust),
    precip: diff(point.weather.precipChance, objective.precipChance),
  };
  return result.temp === null && result.gust === null && result.precip === null ? null : result;
}

/** "an active weather alert" or "Considerable avalanche danger", to follow a colon. */
export function describeCheckpointHazard(hazard: CheckpointHazard): string {
  if (hazard.kind === "alert") return hazard.count === 1 ? "an active weather alert" : `${hazard.count} active weather alerts`;
  return `${hazard.risk || `level ${hazard.level}`} avalanche danger`;
}

/** What changed in the plan since a route was analyzed; empty when nothing did or the analysis predates the record. */
export function describeStaleRouteAnalysis(analysis: RouteAnalysisResult | null, plan: {
  date: string; start: string; travelWindowHours: number; lat: number; lon: number;
  routeShape?: RouteShapeChoice; pace?: { minutesPerMile: number; ascentMinutesPer1000Ft: number; stopBufferMinutes?: number };
}): string[] {
  const request = analysis?.request;
  if (!request) return [];
  const changes: string[] = [];
  if (Math.abs(request.lat - plan.lat) > 0.0005 || Math.abs(request.lon - plan.lon) > 0.0005) changes.push("objective");
  if (request.date !== plan.date) changes.push("date");
  if (request.start !== plan.start) changes.push("start time");
  // Even arrivals set by pace are checked against it, for the fit and the turnaround.
  if (request.travelWindowHours !== plan.travelWindowHours) changes.push("planned duration");
  if (plan.routeShape && (request.routeShape ?? "auto") !== plan.routeShape) changes.push("route shape");
  // Only arrivals set by pace depend on it.
  const paced = request.pace;
  if (analysis.timing?.mode === "pace" && paced && plan.pace && (paced.minutesPerMile !== plan.pace.minutesPerMile
    || paced.ascentMinutesPer1000Ft !== plan.pace.ascentMinutesPer1000Ft
    || (paced.stopBufferMinutes ?? 0) !== (plan.pace.stopBufferMinutes ?? 0))) changes.push("pace");
  return changes;
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
  const spread = timing.mode === "pace"
    ? `Arrivals follow your pace: ${timing.pace.minutesPerMile} min per mile${timing.basis === "distance" && !timing.trackTimed
      ? " (some checkpoint elevations are unknown, so climbing isn't counted and arrivals may be early)"
      : `, ${timing.pace.ascentMinutesPer1000Ft} min per 1,000 ft of climbing, descents at a third of that`}${timing.stopMinutes ? `, and ${timing.stopMinutes} min of stops spread along the way` : ""}${timing.trackTimed ? ", over every climb and descent of your track" : ""}.`
    : timing.basis === "distance-and-vert"
    ? `Arrivals spread ${window} by distance and climbing${timing.paceSource === "user" ? ", weighted by your pace settings" : ""}.`
    : timing.basis === "distance"
      ? `Arrivals spread ${window} by distance only; some checkpoint elevations are unknown, so climbing is not weighted.`
      : timing.basis === "progress"
        ? `Arrivals spread ${window} by route progress, not terrain-adjusted pace.`
        : `Arrivals are spaced evenly across ${window} because route distances are unknown.`;
  const distance = timing.distanceBasis === "straight-line"
    ? " Distances are straight lines between checkpoints, so the trail is longer."
    : timing.distanceBasis === "along-trail"
      ? " Distances are measured along the mapped trail."
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

/** "about 9.5 h" from minutes, to the nearest half hour. */
export function formatRouteHours(minutes: number): string {
  const hours = Math.round((minutes / 60) * 2) / 2;
  return `${hours % 1 ? hours.toFixed(1) : hours} h`;
}

/** Whole hours for the planned duration that fits a pace estimate, within the planner's 1–24 h. */
export function hoursToFit(minutes: number): number {
  return Math.max(1, Math.min(24, Math.ceil(minutes / 60)));
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
