// The hourly forecast describes the objective, but the first hours of a trip
// are spent on the approach, often thousands of feet lower. This estimates
// where the party is at each planned hour and shifts that hour's temperature
// and wind to it. Precipitation and storm signals are never adjusted: a storm
// cell does not care how high you are.

const { clockMinutes } = require('./display-format');

const TEMP_LAPSE_F_PER_1000FT = 3.3;
const WIND_INCREASE_MPH_PER_1000FT = 2;
const GUST_INCREASE_MPH_PER_1000FT = 2.5;

const MIN_APPROACH_DROP_FT = 300;
const MAX_APPROACH_WARMING_F = 10;
// Clear, calm nights let cold air pool in valleys: the approach is cooled
// instead of warmed while that pattern is likely.
const INVERSION_COOLING_F_PER_1000FT = 2;
const MAX_INVERSION_COOLING_F = 8;
const INVERSION_MAX_WIND_MPH = 12;
const INVERSION_MAX_CLOUD_COVER = 50;
const INVERSION_MAX_PRECIP_CHANCE = 50;
const INVERSION_MORNING_PERSISTENCE_MINUTES = 120;
const DEFAULT_ASCENT_MINUTES_PER_1000FT = 45;

const MAX_ROUTE_POINTS = 64;
const MAX_ROUTE_MINUTES = 48 * 60;
const MIN_ELEVATION_FT = -1500;
const MAX_ELEVATION_FT = 29100;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

const numberParam = (value, min, max) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= min && numeric <= max ? numeric : null;
};

/**
 * Read the optional approach inputs from a /api/safety query.
 *   approach=off               score every hour at the objective
 *   trailhead_ft=7200          trailhead elevation the user entered
 *   ascent_min_per_kft=45      ascent rate for the climb from the trailhead
 *   approach_route=0:7500,...  minute:elevation pairs from an imported GPX track
 * Invalid values are ignored rather than rejected, so a bad optional input
 * never costs the user their report.
 */
// "minute:feet,…" pairs; null when any pair is unreadable or out of range.
const parseTimelineParam = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const pairs = value.split(',');
  if (pairs.length > MAX_ROUTE_POINTS) return null;
  const points = pairs.map((pair) => {
    const [minute, elevationFt] = pair.split(':');
    return {
      minute: numberParam(minute, 0, MAX_ROUTE_MINUTES),
      elevationFt: numberParam(elevationFt, MIN_ELEVATION_FT, MAX_ELEVATION_FT),
    };
  });
  const valid = points.length >= 2
    && points.every((point, index) => point.minute !== null && point.elevationFt !== null
      && (index === 0 || point.minute >= points[index - 1].minute));
  return valid ? points : null;
};

const parseApproachQuery = (query = {}) => {
  if (String(query.approach || '').toLowerCase() === 'off') return { enabled: false };
  const trailheadElevationFt = numberParam(query.trailhead_ft, MIN_ELEVATION_FT, MAX_ELEVATION_FT);
  const ascentMinutesPer1000Ft = numberParam(query.ascent_min_per_kft, 1, 120);
  // A GPX track's timeline, from the start of the track.
  const timeline = parseTimelineParam(query.approach_route);
  // An analyzed route's checkpoints; the first must be the start.
  const checkpoints = parseTimelineParam(query.approach_checkpoints);
  const routeTimeline = checkpoints && checkpoints[0].minute === 0 ? checkpoints : null;
  return { enabled: true, trailheadElevationFt, ascentMinutesPer1000Ft, timeline, routeTimeline };
};

/**
 * Elevation over time. A GPX track wins, then an analyzed route's checkpoints
 * (both give the full route: approach, summit and descent), then a typed
 * trailhead, then the lowest forecast band. Without a route, the party climbs
 * at the ascent rate and then stays at the objective; descent is not modeled.
 */
const buildApproachProfile = ({
  objectiveElevationFt,
  trailheadElevationFt = null,
  timeline = null,
  routeTimeline = null,
  elevationBands = [],
  ascentMinutesPer1000Ft = null,
}) => {
  const objective = Number(objectiveElevationFt);
  if (!finite(objective) || objective <= 0) return null;

  if (Array.isArray(timeline) && timeline.length >= 2) {
    if (objective - Math.min(...timeline.map((entry) => entry.elevationFt)) < MIN_APPROACH_DROP_FT) return null;
    return { source: 'gpx', trailheadElevationFt: timeline[0].elevationFt, objectiveElevationFt: objective, timeline };
  }

  // A route that stays near the objective falls through to the trailhead.
  if (Array.isArray(routeTimeline) && routeTimeline.length >= 2
    && objective - Math.min(...routeTimeline.map((entry) => entry.elevationFt)) >= MIN_APPROACH_DROP_FT) {
    return { source: 'route', trailheadElevationFt: routeTimeline[0].elevationFt, objectiveElevationFt: objective, timeline: routeTimeline };
  }

  const lowestBand = (Array.isArray(elevationBands) ? elevationBands : [])
    .filter((band) => finite(band?.elevationFt) && finite(band?.deltaFromObjectiveFt) && band.deltaFromObjectiveFt < 0)
    .reduce((lowest, band) => (!lowest || band.elevationFt < lowest.elevationFt ? band : lowest), null);
  const source = finite(trailheadElevationFt) && trailheadElevationFt >= 0 ? 'manual' : 'estimated';
  const trailhead = source === 'manual' ? trailheadElevationFt : lowestBand ? objective + lowestBand.deltaFromObjectiveFt : null;
  if (trailhead === null || objective - trailhead < MIN_APPROACH_DROP_FT) return null;

  const rate = finite(ascentMinutesPer1000Ft) && ascentMinutesPer1000Ft > 0 ? ascentMinutesPer1000Ft : DEFAULT_ASCENT_MINUTES_PER_1000FT;
  return {
    source,
    trailheadElevationFt: trailhead,
    objectiveElevationFt: objective,
    timeline: [
      { minute: 0, elevationFt: trailhead },
      { minute: ((objective - trailhead) / 1000) * rate, elevationFt: objective },
    ],
  };
};

const elevationAtMinute = (profile, minute) => {
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
};

/** Highest elevation in [start, end), never above the objective. */
const highestElevationBetween = (profile, startMinute, endMinute) => {
  const inside = profile.timeline
    .filter((entry) => entry.minute > startMinute && entry.minute < endMinute)
    .map((entry) => entry.elevationFt);
  const high = Math.max(elevationAtMinute(profile, startMinute), elevationAtMinute(profile, endMinute), ...inside);
  return Math.min(profile.objectiveElevationFt, high);
};

const OVERCAST_OR_WET = /overcast|mostly cloudy|^cloudy|rain|snow|shower|drizzle|sleet|storm|thunder/i;

/** Clear, calm nights and early mornings let valleys cool below the slopes. */
const isInversionLikely = (point, { minuteOfDay = null, sunriseMinutes = null, sunsetMinutes = null } = {}) => {
  const minute = finite(minuteOfDay) ? ((minuteOfDay % 1440) + 1440) % 1440 : null;
  let dark;
  if (minute !== null && finite(sunriseMinutes) && finite(sunsetMinutes)) {
    dark = minute < sunriseMinutes + INVERSION_MORNING_PERSISTENCE_MINUTES || minute >= sunsetMinutes;
  } else if (minute !== null) {
    dark = point?.isDaytime === false || minute < 9 * 60 || minute >= 19 * 60;
  } else {
    dark = point?.isDaytime === false;
  }
  if (!dark) return false;
  if (finite(point?.wind) && point.wind > INVERSION_MAX_WIND_MPH) return false;
  if (finite(point?.precipChance) && point.precipChance >= INVERSION_MAX_PRECIP_CHANCE) return false;
  const condition = String(point?.condition || '');
  if (/fog/i.test(condition)) return true;
  if (finite(point?.cloudCover)) return point.cloudCover <= INVERSION_MAX_CLOUD_COVER;
  return !OVERCAST_OR_WET.test(condition);
};

/** Shift an objective reading to the party's elevation. Missing values stay missing. */
const adjustPointToElevation = (point, objectiveElevationFt, elevationFt, inversion = {}) => {
  const dropKft = Math.max(0, objectiveElevationFt - elevationFt) / 1000;
  if (dropKft <= 0) return { ...point, elevationFt: objectiveElevationFt, inversionRisk: false };
  const inversionRisk = isInversionLikely(point, inversion);
  const tempShift = inversionRisk
    ? -Math.min(MAX_INVERSION_COOLING_F, dropKft * INVERSION_COOLING_F_PER_1000FT)
    : Math.min(MAX_APPROACH_WARMING_F, dropKft * TEMP_LAPSE_F_PER_1000FT);
  const wind = finite(point?.wind) ? Math.max(0, Math.round(point.wind - dropKft * WIND_INCREASE_MPH_PER_1000FT)) : point?.wind;
  const gust = finite(point?.gust)
    ? Math.max(finite(wind) ? wind : 0, Math.round(point.gust - dropKft * GUST_INCREASE_MPH_PER_1000FT))
    : point?.gust;
  return {
    ...point,
    temp: finite(point?.temp) ? Math.round(point.temp + tempShift) : point?.temp,
    wind,
    gust,
    elevationFt: Math.round(elevationFt),
    inversionRisk,
  };
};

/** "6:30 AM" / "6:30:12 AM" → minutes after midnight. */
const parseSolarClockMinutes = (value) => {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i.exec(String(value || '').trim());
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === 'PM') hour += 12;
  return hour * 60 + Number(match[2]);
};

/**
 * The approach for comfort scoring, from the request's inputs and the loaded
 * forecast; null when disabled or when no approach below the objective is known.
 */
const resolveApproach = ({ approachRequest, weatherData, solarData }) => {
  if (!approachRequest?.enabled) return null;
  const profile = buildApproachProfile({
    objectiveElevationFt: weatherData?.elevation,
    trailheadElevationFt: approachRequest.trailheadElevationFt,
    timeline: approachRequest.timeline,
    routeTimeline: approachRequest.routeTimeline,
    elevationBands: weatherData?.elevationForecast,
    ascentMinutesPer1000Ft: approachRequest.ascentMinutesPer1000Ft,
  });
  return profile ? {
    profile,
    sunriseMinutes: parseSolarClockMinutes(solarData?.sunrise),
    sunsetMinutes: parseSolarClockMinutes(solarData?.sunset),
  } : null;
};

/**
 * Minutes after the planned start that an hourly reading covers, clipped to
 * the trip. A 05:30 start makes the 05:00 reading cover minutes 0–30 and the
 * 06:00 reading 30–90; the reading's own clock time decides, not its position
 * in the trend. Falls back to the position when either time is unreadable.
 */
const readingMinutesAfterStart = (pointTime, startTime, index) => {
  const startMinute = clockMinutes(startTime);
  const pointMinute = clockMinutes(pointTime);
  if (startMinute === null || pointMinute === null) return { from: index * 60, to: index * 60 + 60 };
  let diff = pointMinute - startMinute;
  // Past midnight on an overnight trip. A whole hour before the start is the
  // next-day reading of a 24-hour plan: the trend opens with the start's hour.
  if (diff <= -60) diff += 1440;
  const from = Math.max(0, diff);
  return { from, to: Math.max(from, diff + 60) };
};

/** Shift a trend reading to where the party is during the part of the trip it covers. */
const adjustReadingForApproach = (point, index, profile, plan) => {
  const { from, to } = readingMinutesAfterStart(point?.time, plan.start, index);
  const startMinute = clockMinutes(plan.start);
  return adjustPointToElevation(point, profile.objectiveElevationFt, highestElevationBetween(profile, from, to), {
    minuteOfDay: startMinute !== null ? startMinute + from : clockMinutes(point?.time) ?? from,
    sunriseMinutes: plan.sunriseMinutes,
    sunsetMinutes: plan.sunsetMinutes,
  });
};

const indexRuns = (flags) => {
  const runs = [];
  flags.forEach((flag, index) => {
    if (!flag) return;
    const last = runs[runs.length - 1];
    if (last && last.end === index - 1) last.end = index;
    else runs.push({ start: index, end: index });
  });
  return runs;
};

/** What the approach adjustment changed, for plain-language notes; null when nothing was adjusted. */
const summarizeApproachHours = (hours) => {
  const adjusted = hours.map((hour) => Boolean(hour?.approachAdjusted && finite(hour.elevationFt)));
  const elevations = hours.filter((_, index) => adjusted[index]).map((hour) => hour.elevationFt);
  if (!elevations.length) return null;
  return {
    adjustedHours: elevations.length,
    lowFt: Math.min(...elevations),
    highFt: Math.max(...elevations),
    adjustedRuns: indexRuns(adjusted),
    inversionRuns: indexRuns(hours.map((hour, index) => adjusted[index] && Boolean(hour.inversionRisk))),
  };
};

module.exports = {
  resolveApproach,
  readingMinutesAfterStart,
  adjustReadingForApproach,
  summarizeApproachHours,
  TEMP_LAPSE_F_PER_1000FT,
  MAX_APPROACH_WARMING_F,
  INVERSION_COOLING_F_PER_1000FT,
  MAX_INVERSION_COOLING_F,
  parseApproachQuery,
  buildApproachProfile,
  elevationAtMinute,
  highestElevationBetween,
  isInversionLikely,
  adjustPointToElevation,
  parseSolarClockMinutes,
};
