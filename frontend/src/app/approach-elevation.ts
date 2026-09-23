import type { ElevationForecastBand, WeatherTrendPoint } from './types';
import type { ParsedGpxRoute, RouteTimingProfile } from '../lib/gpx';
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

function gpxTimeline(
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

  const track = input.gpxRoute ? gpxTimeline(input.gpxRoute, input.timing) : null;
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
