'use strict';

const { parseClockToMinutes } = require('./time');
const { toFiniteOrNull: knownNumber } = require('./numbers');

// Naismith's rule (3 mph plus 30 minutes per 1,000 ft of ascent) sets the
// default ratio between distance and climbing. Only the ratio matters: segment
// effort is normalized onto the user's planned travel window.
const DEFAULT_ROUTE_PACE = Object.freeze({ minutesPerMile: 20, ascentMinutesPer1000Ft: 30 });
// Descending still costs time on rough backcountry terrain; count it at a
// third of the ascent rate so steep descents are not treated as free.
const DESCENT_SHARE_OF_ASCENT = 1 / 3;
const KM_PER_MILE = 1.609344;

const sanitizeRoutePace = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const minutesPerMile = knownNumber(raw.minutesPerMile);
  const ascentMinutesPer1000Ft = knownNumber(raw.ascentMinutesPer1000Ft);
  if (minutesPerMile === null || minutesPerMile < 5 || minutesPerMile > 120) return null;
  if (ascentMinutesPer1000Ft === null || ascentMinutesPer1000Ft < 0 || ascentMinutesPer1000Ft > 240) return null;
  return { minutesPerMile: Math.round(minutesPerMile), ascentMinutesPer1000Ft: Math.round(ascentMinutesPer1000Ft) };
};

const hasCoordinates = (point) => knownNumber(point?.lat) !== null && knownNumber(point?.lon) !== null;

/**
 * Named, generated and mapped routes run trailhead to objective only, while the
 * planned travel window covers the whole outing. Append the trip back down the
 * same checkpoints, in reverse, so the objective is reached part-way through the
 * window and each checkpoint on the descent is checked at its own arrival time.
 */
const appendReturnCheckpoint = (waypoints) => {
  if (!Array.isArray(waypoints) || waypoints.length < 2) return waypoints;
  const returnLeg = waypoints.slice(0, -1).reverse().map((point) => ({
    name: `Return to ${point.name || 'route start'}`,
    lat: point.lat,
    lon: point.lon,
    ...(knownNumber(point.elev_ft) !== null ? { elev_ft: knownNumber(point.elev_ft) } : {}),
    leg: 'return',
    source: point.source,
  }));
  return [...waypoints, ...returnLeg];
};

const segmentMiles = (previous, current, haversineKm) => {
  const previousDistance = knownNumber(previous?.distance_miles);
  const currentDistance = knownNumber(current?.distance_miles);
  if (previousDistance !== null && currentDistance !== null && currentDistance >= previousDistance) {
    return currentDistance - previousDistance;
  }
  return haversineKm(previous.lat, previous.lon, current.lat, current.lon) / KM_PER_MILE;
};

/**
 * Cumulative share (0–1) of the travel window at which each checkpoint is
 * reached. Segments are weighted by distance and, when every checkpoint has an
 * elevation, by climbing and descent. Each `leg: 'return'` checkpoint retraces
 * the latest outbound segment not yet retraced, so its gain becomes descent and
 * vice versa; the last one retraces all that remain.
 */
const computeCheckpointFractions = (waypoints, { haversineKm, pace } = {}) => {
  const points = Array.isArray(waypoints) ? waypoints : [];
  const count = points.length;
  const fallback = () => {
    const progress = points.map((point) => knownNumber(point?.progress_percent));
    if (progress.every((value) => value !== null)) {
      return { basis: 'progress', fractions: progress.map((value) => Math.max(0, Math.min(100, value)) / 100) };
    }
    return { basis: 'even', fractions: points.map((_, index) => (count > 1 ? index / (count - 1) : 0)) };
  };
  if (count < 2 || typeof haversineKm !== 'function' || !points.every(hasCoordinates)) return fallback();

  const { minutesPerMile, ascentMinutesPer1000Ft } = pace || DEFAULT_ROUTE_PACE;
  const descentMinutesPer1000Ft = ascentMinutesPer1000Ft * DESCENT_SHARE_OF_ASCENT;
  const useVert = points.every((point) => knownNumber(point.elev_ft) !== null);
  const segments = [];
  const efforts = [0];
  for (let index = 1; index < count; index += 1) {
    const current = points[index];
    if (current.leg === 'return') {
      // Retrace outbound segments: climbing becomes descent and vice versa.
      const retraced = index === count - 1 ? segments.splice(0) : segments.splice(-1);
      efforts.push(retraced.reduce((total, segment) => total
        + segment.miles * minutesPerMile
        + (segment.lossFt / 1000) * ascentMinutesPer1000Ft
        + (segment.gainFt / 1000) * descentMinutesPer1000Ft, 0));
      continue;
    }
    const previous = points[index - 1];
    const miles = segmentMiles(previous, current, haversineKm);
    const deltaFt = useVert ? knownNumber(current.elev_ft) - knownNumber(previous.elev_ft) : 0;
    const segment = { miles, gainFt: Math.max(0, deltaFt), lossFt: Math.max(0, -deltaFt) };
    segments.push(segment);
    efforts.push(segment.miles * minutesPerMile
      + (segment.gainFt / 1000) * ascentMinutesPer1000Ft
      + (segment.lossFt / 1000) * descentMinutesPer1000Ft);
  }
  const total = efforts.reduce((sum, effort) => sum + effort, 0);
  if (!(total > 0)) return fallback();
  let cumulative = 0;
  return {
    basis: useVert ? 'distance-and-vert' : 'distance',
    fractions: efforts.map((effort) => {
      cumulative += effort;
      return Math.min(1, cumulative / total);
    }),
  };
};

/** Progress along the whole outing by distance, for routes without GPX distances. */
const computeDistanceProgress = (waypoints, haversineKm) => {
  const points = Array.isArray(waypoints) ? waypoints : [];
  if (points.length < 2 || !points.every(hasCoordinates)) return null;
  const outbound = [];
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    // Return checkpoints retrace outbound segments, as in computeCheckpointFractions.
    const retraced = points[index].leg !== 'return' ? null
      : index === points.length - 1 ? outbound.splice(0) : outbound.splice(-1);
    const miles = retraced
      ? retraced.reduce((sum, value) => sum + value, 0)
      : segmentMiles(points[index - 1], points[index], haversineKm);
    if (!retraced) outbound.push(miles);
    cumulative.push(cumulative[index - 1] + miles);
  }
  const total = cumulative[cumulative.length - 1];
  if (!(total > 0)) return null;
  return cumulative.map((miles) => Math.round((miles / total) * 100));
};

/** Whether a checkpoint's arrival clock falls in daylight, using that checkpoint's own solar data. */
const classifyDaylight = (etaTime, solar) => {
  const eta = parseClockToMinutes(etaTime);
  const sunrise = parseClockToMinutes(solar?.sunrise);
  const sunset = parseClockToMinutes(solar?.sunset);
  if (eta === null || sunrise === null || sunset === null || sunset <= sunrise) return null;
  return eta >= sunrise && eta < sunset ? 'day' : 'dark';
};

module.exports = {
  DEFAULT_ROUTE_PACE,
  appendReturnCheckpoint,
  classifyDaylight,
  computeCheckpointFractions,
  computeDistanceProgress,
  sanitizeRoutePace,
};
