import type { ElevationForecastBand, SafetyData, WeatherTrendPoint } from './types';
import type { ParsedGpxRoute, RouteTimingProfile } from '../lib/gpx';
import { parseHourLabelToMinutes, parseTimeInputMinutes } from './core';
import {
  GUST_INCREASE_MPH_PER_1000FT,
  TEMP_LAPSE_F_PER_1000FT,
  WIND_INCREASE_MPH_PER_1000FT,
} from './constants';

/**
 * The hourly forecast is issued for the objective, but the first hours of a
 * trip are spent on the approach, often thousands of feet lower. This module
 * estimates where the party is at each planned hour and shifts that hour's
 * temperature and wind to the elevation they are actually at.
 *
 * Precipitation and storm signals are never adjusted: a storm cell does not
 * care how high you are.
 */

/** Approach hours below this drop are scored at objective conditions. */
const MIN_APPROACH_DROP_FT = 300;
/** Lapse-rate warming never credits more than this over the objective reading. */
export const MAX_APPROACH_WARMING_F = 10;
/**
 * Clear, calm nights let cold air drain and pool in valleys, so a trailhead can
 * be colder than the ridge above it. When that pattern is likely, the approach
 * gets no lapse-rate warming and is instead cooled by this much per 1,000 ft
 * below the objective, up to the cap.
 */
export const INVERSION_COOLING_F_PER_1000FT = 2;
export const MAX_INVERSION_COOLING_F = 8;
const INVERSION_MAX_WIND_MPH = 12;
const INVERSION_MAX_CLOUD_COVER = 50;
const INVERSION_MAX_PRECIP_CHANCE = 50;
/** Inversions usually persist for about two hours after sunrise. */
const INVERSION_MORNING_PERSISTENCE_MINUTES = 120;
const DEFAULT_ASCENT_MINUTES_PER_1000FT = 45;

export type ApproachElevationSource = 'gpx' | 'manual' | 'estimated';

export interface ApproachProfile {
  source: ApproachElevationSource;
  trailheadElevationFt: number;
  objectiveElevationFt: number;
  /** Piecewise-linear elevation timeline in minutes after the planned start. */
  timeline: Array<{ minute: number; elevationFt: number }>;
}

export interface ApproachProfileInput {
  objectiveElevationFt: number | null | undefined;
  /** Trailhead elevation the user entered, in feet. */
  trailheadElevationFt?: number | null;
  gpxRoute?: Pick<ParsedGpxRoute, 'distanceMiles' | 'displayTrack'> | null;
  elevationBands?: ElevationForecastBand[] | null;
  timing: RouteTimingProfile;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Elevation over time along a GPX track, using the route timing preferences. */
export function buildGpxElevationTimeline(
  route: Pick<ParsedGpxRoute, 'distanceMiles' | 'displayTrack'>,
  timing: RouteTimingProfile,
): ApproachProfile['timeline'] | null {
  const points = (route.displayTrack || []).filter((point) => finite(point.elev_ft) && finite(point.progress_percent));
  if (points.length < 2 || !finite(route.distanceMiles) || route.distanceMiles <= 0) return null;
  const pace = Math.max(5, timing.paceMinutesPerMile);
  const ascentRate = Math.max(0, timing.ascentMinutesPer1000Ft);
  let moving = 0;
  const raw = points.map((point, index) => {
    if (index > 0) {
      const previous = points[index - 1];
      const miles = Math.max(0, point.progress_percent - previous.progress_percent) / 100 * route.distanceMiles;
      const climb = Math.max(0, (point.elev_ft as number) - (previous.elev_ft as number));
      moving += miles * pace + (climb / 1000) * ascentRate;
    }
    return { minute: moving, elevationFt: point.elev_ft as number };
  });
  if (moving <= 0) return null;
  // Spread stops across the route so the timeline ends when the trip does.
  const scale = (moving + Math.max(0, timing.stopBufferMinutes)) / moving;
  return raw.map((entry) => ({ minute: entry.minute * scale, elevationFt: entry.elevationFt }));
}

/**
 * Model elevation over time. A GPX track with elevations gives the full route
 * (approach, summit and descent). Without one, the party climbs from the
 * trailhead at the ascent rate and then stays at the objective: descent is not
 * modeled, so late hours keep the more severe objective conditions.
 */
export function buildApproachProfile(input: ApproachProfileInput): ApproachProfile | null {
  const objective = Number(input.objectiveElevationFt);
  if (!finite(objective) || objective <= 0) return null;

  const track = input.gpxRoute ? buildGpxElevationTimeline(input.gpxRoute, input.timing) : null;
  if (track) {
    const trailhead = track[0].elevationFt;
    if (objective - Math.min(...track.map((entry) => entry.elevationFt)) < MIN_APPROACH_DROP_FT) return null;
    return { source: 'gpx', trailheadElevationFt: trailhead, objectiveElevationFt: objective, timeline: track };
  }

  const manual = input.trailheadElevationFt;
  const lowestBand = (input.elevationBands || [])
    .filter((band) => finite(band.elevationFt) && finite(band.deltaFromObjectiveFt) && band.deltaFromObjectiveFt < 0)
    .reduce<ElevationForecastBand | null>((lowest, band) => (!lowest || band.elevationFt < lowest.elevationFt ? band : lowest), null);
  const source: ApproachElevationSource = finite(manual) && manual >= 0 ? 'manual' : 'estimated';
  const trailhead = source === 'manual' ? (manual as number) : lowestBand ? objective + lowestBand.deltaFromObjectiveFt : null;
  if (trailhead === null || objective - trailhead < MIN_APPROACH_DROP_FT) return null;

  const ascentRate = input.timing.ascentMinutesPer1000Ft > 0 ? input.timing.ascentMinutesPer1000Ft : DEFAULT_ASCENT_MINUTES_PER_1000FT;
  const ascentMinutes = ((objective - trailhead) / 1000) * ascentRate;
  return {
    source,
    trailheadElevationFt: trailhead,
    objectiveElevationFt: objective,
    timeline: [
      { minute: 0, elevationFt: trailhead },
      { minute: ascentMinutes, elevationFt: objective },
    ],
  };
}

export function elevationAtMinute(profile: ApproachProfile, minute: number): number {
  const { timeline } = profile;
  if (!finite(minute) || minute <= timeline[0].minute) return timeline[0].elevationFt;
  for (let index = 1; index < timeline.length; index += 1) {
    const next = timeline[index];
    if (minute <= next.minute) {
      const previous = timeline[index - 1];
      const span = next.minute - previous.minute;
      const t = span > 0 ? (minute - previous.minute) / span : 1;
      return previous.elevationFt + (next.elevationFt - previous.elevationFt) * t;
    }
  }
  return timeline[timeline.length - 1].elevationFt;
}

/**
 * Highest elevation reached in [startMinute, endMinute). Scoring the high point
 * keeps an hour that climbs onto a ridge at the ridge's conditions. Never above
 * the objective: the forecast is not extrapolated upward.
 */
export function highestElevationBetween(profile: ApproachProfile, startMinute: number, endMinute: number): number {
  const inside = profile.timeline
    .filter((entry) => entry.minute > startMinute && entry.minute < endMinute)
    .map((entry) => entry.elevationFt);
  const high = Math.max(elevationAtMinute(profile, startMinute), elevationAtMinute(profile, endMinute), ...inside);
  return Math.min(profile.objectiveElevationFt, high);
}

export interface InversionContext {
  /** Minutes after local midnight for the hour being scored. */
  minuteOfDay: number;
  sunriseMinutes?: number | null;
  sunsetMinutes?: number | null;
}

const OVERCAST_OR_WET = /overcast|mostly cloudy|^cloudy|rain|snow|shower|drizzle|sleet|storm|thunder/i;

/**
 * Clear, calm nights and early mornings let valleys cool below the slopes
 * above them. Fog is a sign of the same cold pool, so it counts as clear here.
 */
export function isInversionLikely(point: WeatherTrendPoint, context: InversionContext): boolean {
  const minute = ((context.minuteOfDay % 1440) + 1440) % 1440;
  const { sunriseMinutes, sunsetMinutes } = context;
  const dark = finite(sunriseMinutes) && finite(sunsetMinutes)
    ? minute < sunriseMinutes + INVERSION_MORNING_PERSISTENCE_MINUTES || minute >= sunsetMinutes
    : point.isDaytime === false || minute < 9 * 60 || minute >= 19 * 60;
  if (!dark) return false;
  if (finite(point.wind) && point.wind > INVERSION_MAX_WIND_MPH) return false;
  if (finite(point.precipChance) && point.precipChance >= INVERSION_MAX_PRECIP_CHANCE) return false;
  const condition = String(point.condition || '');
  if (/fog/i.test(condition)) return true;
  if (finite(point.cloudCover)) return point.cloudCover <= INVERSION_MAX_CLOUD_COVER;
  return !OVERCAST_OR_WET.test(condition);
}

export interface ElevationAdjustedPoint extends WeatherTrendPoint {
  elevationFt: number;
  inversionRisk: boolean;
}

/**
 * Shift an objective-elevation reading down to where the party is. Wind and
 * gust ease with the standard per-1,000 ft rates. Temperature warms with the
 * lapse rate (capped), unless an inversion is likely, when it cools instead.
 * Readings that are missing stay missing.
 */
export function adjustPointToElevation(
  point: WeatherTrendPoint,
  objectiveElevationFt: number,
  elevationFt: number,
  inversion: InversionContext,
): ElevationAdjustedPoint {
  const dropKft = Math.max(0, objectiveElevationFt - elevationFt) / 1000;
  if (dropKft <= 0) return { ...point, elevationFt: objectiveElevationFt, inversionRisk: false };
  const inversionRisk = isInversionLikely(point, inversion);
  const tempShift = inversionRisk
    ? -Math.min(MAX_INVERSION_COOLING_F, dropKft * INVERSION_COOLING_F_PER_1000FT)
    : Math.min(MAX_APPROACH_WARMING_F, dropKft * TEMP_LAPSE_F_PER_1000FT);
  const wind = finite(point.wind) ? Math.max(0, Math.round(point.wind - dropKft * WIND_INCREASE_MPH_PER_1000FT)) : point.wind;
  const gust = finite(point.gust)
    ? Math.max(finite(wind) ? wind : 0, Math.round(point.gust - dropKft * GUST_INCREASE_MPH_PER_1000FT))
    : point.gust;
  return {
    ...point,
    temp: finite(point.temp) ? Math.round(point.temp + tempShift) : point.temp,
    wind,
    gust,
    elevationFt: Math.round(elevationFt),
    inversionRisk,
  };
}

export interface ApproachHourFlags {
  approachAdjusted?: boolean;
  elevationFt?: number;
  inversionRisk?: boolean;
}

export interface ApproachSummary {
  /** Number of hours scored below the objective. */
  adjustedHours: number;
  lowFt: number;
  highFt: number;
  /** Contiguous index runs of adjusted hours, inclusive. */
  adjustedRuns: Array<{ start: number; end: number }>;
  /** Contiguous index runs of hours where an inversion makes the approach colder. */
  inversionRuns: Array<{ start: number; end: number }>;
}

function indexRuns(flags: boolean[]): Array<{ start: number; end: number }> {
  const runs: Array<{ start: number; end: number }> = [];
  flags.forEach((flag, index) => {
    if (!flag) return;
    const last = runs[runs.length - 1];
    if (last && last.end === index - 1) last.end = index;
    else runs.push({ start: index, end: index });
  });
  return runs;
}

/** What the approach adjustment changed, for plain-language notes; null when nothing was adjusted. */
export function summarizeApproachHours(hours: ApproachHourFlags[]): ApproachSummary | null {
  const adjusted = hours.map((hour) => Boolean(hour.approachAdjusted && finite(hour.elevationFt)));
  const elevations = hours.filter((_, index) => adjusted[index]).map((hour) => hour.elevationFt as number);
  if (!elevations.length) return null;
  return {
    adjustedHours: elevations.length,
    lowFt: Math.min(...elevations),
    highFt: Math.max(...elevations),
    adjustedRuns: indexRuns(adjusted),
    inversionRuns: indexRuns(hours.map((hour, index) => adjusted[index] && Boolean(hour.inversionRisk))),
  };
}

export const APPROACH_SOURCE_LABEL: Record<ApproachElevationSource, string> = {
  gpx: 'from your GPX track',
  manual: 'from your trailhead',
  estimated: 'trailhead estimated',
};

/** Most route points the backend accepts; keep in step with backend/src/utils/approach-elevation.js. */
export const MAX_APPROACH_ROUTE_POINTS = 64;

/** Evenly thin a timeline, always keeping both ends and the high point. */
function thinTimeline(timeline: ApproachProfile['timeline'], limit: number): ApproachProfile['timeline'] {
  if (timeline.length <= limit) return timeline;
  const high = timeline.reduce((best, entry, index) => (entry.elevationFt > timeline[best].elevationFt ? index : best), 0);
  const keep = new Set([0, timeline.length - 1, high]);
  const slots = limit - keep.size;
  for (let i = 1; i <= slots; i += 1) keep.add(Math.round((i * (timeline.length - 1)) / (slots + 1)));
  return [...keep].sort((a, b) => a - b).slice(0, limit).map((index) => timeline[index]);
}

/** Compact "minute:feet,…" form of a timeline, as sent to and echoed by the backend. */
function timelineKey(timeline: ApproachProfile['timeline']): string {
  return thinTimeline(timeline, MAX_APPROACH_ROUTE_POINTS)
    .map((entry) => `${Math.round(entry.minute)}:${Math.round(entry.elevationFt)}`)
    .join(',');
}

/** The timeline a profile would be scored with, comparable to pleasantness.approach.timeline. */
export function approachTimelineKey(profile: ApproachProfile): string {
  return timelineKey(profile.timeline);
}

/**
 * Query parameters that tell /api/safety where the party starts, so the
 * backend comfort score checks approach hours at the same elevation as the
 * brief. The estimated trailhead needs the forecast bands, so the backend
 * derives it itself when no trailhead or route is sent.
 */
export function buildApproachRequestParams(input: {
  enabled: boolean;
  trailheadElevationFt?: number | null;
  gpxRoute?: Pick<ParsedGpxRoute, 'distanceMiles' | 'displayTrack'> | null;
  timing: RouteTimingProfile;
}): Record<string, string> {
  if (!input.enabled) return { approach: 'off' };
  const params: Record<string, string> = {};
  const track = input.gpxRoute ? buildGpxElevationTimeline(input.gpxRoute, input.timing) : null;
  if (track) {
    params.approach_route = timelineKey(track);
  } else if (finite(input.trailheadElevationFt) && input.trailheadElevationFt >= 0) {
    params.trailhead_ft = String(Math.round(input.trailheadElevationFt));
  }
  if (input.timing.ascentMinutesPer1000Ft > 0) params.ascent_min_per_kft = String(Math.round(input.timing.ascentMinutesPer1000Ft));
  return params;
}

// Models before 1.5.0 always scored both ends of the route, so a missing
// approach there says nothing about the plan.
const scoresApproach = (version: string | undefined) => {
  const [major = 0, minor = 0] = String(version || '').split('.').map(Number);
  return major > 1 || (major === 1 && minor >= 5);
};

/** True when the comfort score was computed for a different approach than the current plan. */
export function comfortApproachIsStale(
  comfort: NonNullable<SafetyData['pleasantness']>,
  current: ApproachProfile | null | undefined,
): boolean {
  if (!scoresApproach(comfort.scoreVersion)) return false;
  const scored = comfort.approach ?? null;
  if (!scored || !current) return Boolean(scored) !== Boolean(current);
  if (scored.source !== current.source) return true;
  // The timeline covers ascent rate, pace, stops and route shape, not just the start.
  if (scored.timeline) return scored.timeline !== approachTimelineKey(current);
  return Math.abs(scored.trailheadElevationFt - current.trailheadElevationFt) > 50;
}

const clockMinutes = (value: string) => parseTimeInputMinutes(value) ?? parseHourLabelToMinutes(value);

/**
 * Minutes after the planned start that an hourly reading covers, clipped to
 * the trip. A 05:30 start makes the 05:00 reading cover minutes 0–30 and the
 * 06:00 reading 30–90; the reading's own clock time decides, not its position
 * in the trend. Falls back to the position when either time is unreadable.
 */
export function readingMinutesAfterStart(pointTime: string, startTime: string, index: number): { from: number; to: number } {
  const startMinute = clockMinutes(startTime);
  const pointMinute = clockMinutes(pointTime);
  if (startMinute === null || pointMinute === null) return { from: index * 60, to: index * 60 + 60 };
  let diff = pointMinute - startMinute;
  if (diff < -60) diff += 1440; // past midnight on an overnight trip
  const from = Math.max(0, diff);
  return { from, to: Math.max(from, diff + 60) };
}

/** Shift a trend reading to where the party is during the part of the trip it covers. */
export function adjustReadingForApproach(
  point: WeatherTrendPoint,
  index: number,
  profile: ApproachProfile,
  plan: { start: string; sunriseMinutes?: number | null; sunsetMinutes?: number | null },
): ElevationAdjustedPoint {
  const { from, to } = readingMinutesAfterStart(point.time, plan.start, index);
  const startMinute = clockMinutes(plan.start);
  return adjustPointToElevation(point, profile.objectiveElevationFt, highestElevationBetween(profile, from, to), {
    minuteOfDay: startMinute !== null ? startMinute + from : clockMinutes(point.time) ?? from,
    sunriseMinutes: plan.sunriseMinutes,
    sunsetMinutes: plan.sunsetMinutes,
  });
}
