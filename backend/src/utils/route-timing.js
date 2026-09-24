'use strict';

const { parseClockToMinutes } = require('./time');
const { toFiniteOrNull: knownNumber } = require('./numbers');

// Naismith's rule (3 mph plus 30 minutes per 1,000 ft of ascent) sets the
// default ratio between distance and climbing. With the default, only the ratio
// matters: segment effort is normalized onto the user's planned travel window.
// A traveler's own pace (and stop time) instead sets arrivals directly when the
// route's length is known well enough.
const DEFAULT_ROUTE_PACE = Object.freeze({ minutesPerMile: 20, ascentMinutesPer1000Ft: 30 });
// Descending still costs time on rough backcountry terrain; count it at a
// third of the ascent rate so steep descents are not treated as free.
const DESCENT_SHARE_OF_ASCENT = 1 / 3;
const KM_PER_MILE = 1.609344;
const MAX_STOP_MINUTES = 240;
// A pace estimate this close to the planned duration fits it.
const FIT_TOLERANCE_MINUTES = 45;
const FIT_TOLERANCE_SHARE = 0.15;

const sanitizeRoutePace = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const minutesPerMile = knownNumber(raw.minutesPerMile);
  const ascentMinutesPer1000Ft = knownNumber(raw.ascentMinutesPer1000Ft);
  if (minutesPerMile === null || minutesPerMile < 5 || minutesPerMile > 120) return null;
  if (ascentMinutesPer1000Ft === null || ascentMinutesPer1000Ft < 0 || ascentMinutesPer1000Ft > 240) return null;
  const stopBufferMinutes = knownNumber(raw.stopBufferMinutes);
  return {
    minutesPerMile: Math.round(minutesPerMile),
    ascentMinutesPer1000Ft: Math.round(ascentMinutesPer1000Ft),
    ...(stopBufferMinutes !== null && stopBufferMinutes >= 0 && stopBufferMinutes <= MAX_STOP_MINUTES
      ? { stopBufferMinutes: Math.round(stopBufferMinutes) } : {}),
  };
};

/** Moving minutes for one stretch of travel: distance, climbing, and descent at a third of the climbing rate. */
const stretchMinutes = (miles, gainFt, lossFt, pace) => miles * pace.minutesPerMile
  + (gainFt / 1000) * pace.ascentMinutesPer1000Ft
  + (lossFt / 1000) * pace.ascentMinutesPer1000Ft * DESCENT_SHARE_OF_ASCENT;

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
    // A landmark the map search couldn't find is just as unverified on the way back.
    ...(point.geocodingVerified === false ? { geocodingVerified: false } : {}),
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
 * Cumulative share (0–1) of the outing at which each checkpoint is reached,
 * and the outing's moving time at the given pace. Segments are weighted by distance and, when every checkpoint has an
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

  const routePace = pace || DEFAULT_ROUTE_PACE;
  const useVert = points.every((point) => knownNumber(point.elev_ft) !== null);
  const segments = [];
  const efforts = [0];
  for (let index = 1; index < count; index += 1) {
    const current = points[index];
    if (current.leg === 'return') {
      // Retrace outbound segments: climbing becomes descent and vice versa.
      const retraced = index === count - 1 ? segments.splice(0) : segments.splice(-1);
      efforts.push(retraced.reduce((total, segment) => total
        + stretchMinutes(segment.miles, segment.lossFt, segment.gainFt, routePace), 0));
      continue;
    }
    const previous = points[index - 1];
    const miles = segmentMiles(previous, current, haversineKm);
    const deltaFt = useVert ? knownNumber(current.elev_ft) - knownNumber(previous.elev_ft) : 0;
    const segment = { miles, gainFt: Math.max(0, deltaFt), lossFt: Math.max(0, -deltaFt) };
    segments.push(segment);
    efforts.push(stretchMinutes(segment.miles, segment.gainFt, segment.lossFt, routePace));
  }
  const total = efforts.reduce((sum, effort) => sum + effort, 0);
  if (!(total > 0)) return fallback();
  let cumulative = 0;
  return {
    basis: useVert ? 'distance-and-vert' : 'distance',
    // Efforts are minutes at the given pace, so their total is the moving time.
    movingMinutes: total,
    fractions: efforts.map((effort) => {
      cumulative += effort;
      return Math.min(1, cumulative / total);
    }),
  };
};

/**
 * Give an out-and-back route without GPX distances a running distance at each
 * checkpoint, return leg included. Distances measured along a mapped trail are
 * kept. Straight lines between checkpoints undercount
 * a winding trail, so when the route's round-trip length is known they are
 * scaled to it. Returns how the distances were found, or null when they could
 * not be.
 */
const assignRouteDistances = (waypoints, haversineKm, roundTripMiles = null, { measuredAlongTrail = false } = {}) => {
  const points = Array.isArray(waypoints) ? waypoints : [];
  if (points.length < 2 || typeof haversineKm !== 'function' || !points.every(hasCoordinates)) return null;
  // Mapped trails come with distances measured along the trail; keep them, and
  // mirror them for the return, which retraces the same trail.
  const outboundPoints = points.filter((point) => point.leg !== 'return');
  const outboundMiles = outboundPoints.map((point) => knownNumber(point.distance_miles));
  const alongTrail = measuredAlongTrail && outboundPoints.length >= 2
    && outboundMiles.every((miles, index) => miles !== null && miles >= 0 && (index === 0 || miles >= outboundMiles[index - 1]))
    && outboundMiles[outboundMiles.length - 1] > 0;
  if (alongTrail) {
    const total = outboundMiles[outboundMiles.length - 1];
    let returned = 0;
    points.forEach((point) => {
      if (point.leg !== 'return') return;
      // Return checkpoints retrace the outbound ones in reverse order, as appendReturnCheckpoint builds them.
      const twin = outboundMiles[outboundMiles.length - 2 - returned];
      returned += 1;
      point.distance_miles = Math.round((total + (total - (twin ?? 0))) * 100) / 100;
    });
    return 'along-trail';
  }
  const outbound = [];
  const legs = points.slice(1).map((point, index) => {
    // Return checkpoints retrace outbound segments, as in computeCheckpointFractions.
    if (point.leg === 'return') return index === points.length - 2 ? outbound.splice(0) : outbound.splice(-1);
    const miles = haversineKm(points[index].lat, points[index].lon, point.lat, point.lon) / KM_PER_MILE;
    outbound.push(miles);
    return [miles];
  });
  const straightMiles = legs.reduce((sum, retraced) => sum + retraced.reduce((total, miles) => total + miles, 0), 0);
  if (!(straightMiles > 0)) return null;
  // A trail is never shorter than the straight line, so a smaller length is wrong.
  const known = knownNumber(roundTripMiles);
  const scale = known !== null && known >= straightMiles ? known / straightMiles : 1;
  let cumulative = 0;
  points[0].distance_miles = 0;
  legs.forEach((retraced, index) => {
    cumulative += retraced.reduce((total, miles) => total + miles, 0) * scale;
    points[index + 1].distance_miles = Math.round(cumulative * 10) / 10;
  });
  return scale > 1 ? 'route-length' : 'straight-line';
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

/**
 * Moving minutes to each point of a dense track ({ miles, elevFt }), by the same
 * distance, climbing and descent rates as the checkpoints. Unknown elevations
 * add no climbing.
 */
const buildTrackTimeline = (track, pace) => {
  let minutes = 0;
  return track.map((point, index) => {
    if (index > 0) {
      const previous = track[index - 1];
      const miles = Math.max(0, point.miles - previous.miles);
      const delta = knownNumber(point.elevFt) !== null && knownNumber(previous.elevFt) !== null ? point.elevFt - previous.elevFt : 0;
      minutes += stretchMinutes(miles, Math.max(0, delta), Math.max(0, -delta), pace);
    }
    return minutes;
  });
};

/** Minutes at a distance along a track timeline, interpolated between its points. */
const minutesAtMiles = (track, timeline, miles) => {
  if (!(miles > track[0].miles)) return timeline[0];
  for (let index = 1; index < track.length; index += 1) {
    if (miles <= track[index].miles) {
      const span = track[index].miles - track[index - 1].miles;
      const t = span > 0 ? (miles - track[index - 1].miles) / span : 1;
      return timeline[index - 1] + (timeline[index] - timeline[index - 1]) * t;
    }
  }
  return timeline[timeline.length - 1];
};

/** The same track there and back: the return runs it in reverse with distances continuing. */
const mirrorTrack = (track) => {
  const total = track[track.length - 1].miles;
  return [...track, ...track.slice(0, -1).reverse().map((point) => ({ miles: total + (total - point.miles), elevFt: point.elevFt }))];
};

/**
 * A single checkpoint closing a loop back at the start, when the way back isn't
 * known. It is not a retrace, so it carries no return leg.
 */
const appendLoopEnd = (waypoints) => {
  if (!Array.isArray(waypoints) || waypoints.length < 2) return waypoints;
  const start = waypoints[0];
  return [...waypoints, {
    name: `Return to ${start.name || 'route start'}`,
    lat: start.lat,
    lon: start.lon,
    ...(knownNumber(start.elev_ft) !== null ? { elev_ft: knownNumber(start.elev_ft) } : {}),
    ...(start.geocodingVerified === false ? { geocodingVerified: false } : {}),
    source: start.source,
  }];
};

/**
 * Whether the pace estimate fits the planned duration: "longer" or "shorter"
 * when it misses by more than 45 minutes or 15% of the plan, whichever is more.
 */
const describeWindowFit = (estimatedMinutes, windowMinutes) => {
  const tolerance = Math.max(FIT_TOLERANCE_MINUTES, windowMinutes * FIT_TOLERANCE_SHARE);
  const difference = estimatedMinutes - windowMinutes;
  return difference > tolerance ? 'longer' : difference < -tolerance ? 'shorter' : 'fits';
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
  appendLoopEnd,
  appendReturnCheckpoint,
  buildTrackTimeline,
  describeWindowFit,
  minutesAtMiles,
  mirrorTrack,
  assignRouteDistances,
  classifyDaylight,
  computeCheckpointFractions,
  computeDistanceProgress,
  sanitizeRoutePace,
};
