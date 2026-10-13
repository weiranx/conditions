'use strict';

// A finished trip compared with the saved report that planned it: the recorded
// GPX track (distance, climb, moving time, pace on climbs and descents) against
// the plan's start, duration, pace, turnaround and daylight, and the hourly
// forecast for the hours actually spent out, at the elevations reached.
//
// This is the debrief's source of truth; the AI write-up only explains it. It
// claims nothing about whether the forecast verified: the report holds a
// forecast, not observations. Units are always miles, feet, °F and mph.

const { estimateAtElevation } = require('./terrain-window');
const { activityProfile, normalizeActivity } = require('./activity-profiles');
const { DEFAULT_ROUTE_PACE, sanitizeRoutePace } = require('./route-timing');
const { parseIsoTimeToMs, parseClockToMinutes, parseStartClock } = require('./time');
const { toFiniteOrNull: num } = require('./numbers');

const FT_PER_METER = 3.28084;
const METERS_PER_MILE = 1609.344;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Most track points compared; longer tracks are thinned evenly. */
const MAX_DEBRIEF_POINTS = 5000;
// A climb or drop counts once the smoothed elevation has moved this far from
// the last turning point, so GPS jitter on flat ground adds no gain.
const ELEVATION_HYSTERESIS_FT = 10;
// Moving: walking pace over the ground, or climbing/descending steadily on steep ground.
const MIN_MOVING_MPH = 0.5;
const MIN_MOVING_VERTICAL_FT_PER_HOUR = 300;
// Pace on climbs, descents and flats is read over stretches this long, at this grade.
const PACE_STRETCH_MILES = 0.1;
const CLIMB_GRADE = 0.05;
// Descending costs a third of the climbing rate, as in route-timing.js.
const DESCENT_SHARE_OF_ASCENT = 1 / 3;
// Plausible recorded trips: a later point at most this long after the first.
const MAX_TRIP_HOURS = 72;

const round = (value, digits = 0) => {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const haversineMeters = (a, b) => {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin((lat2 - lat1) / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(toRadians(b.lon - a.lon) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

const readPointTime = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  return parseIsoTimeToMs(value);
};

/**
 * The track's usable points as { lat, lon, eleFt, timeMs }: `ele` is metres, as
 * GPX records it, and `time` an ISO timestamp or epoch milliseconds. Points
 * without a valid position are dropped; timestamps that run backwards are
 * dropped (the point is kept). Longer tracks are thinned evenly to `maxPoints`,
 * always keeping the first, last and highest points.
 */
const sanitizeTrackPoints = (rawPoints, { maxPoints = MAX_DEBRIEF_POINTS } = {}) => {
  if (!Array.isArray(rawPoints)) return { points: [], originalCount: 0, downsampled: false };
  const points = [];
  let lastTime = null;
  for (const raw of rawPoints) {
    if (!isRecord(raw)) continue;
    const lat = num(raw.lat);
    const lon = num(raw.lon);
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const eleMeters = num(raw.ele);
    let timeMs = readPointTime(raw.time);
    if (timeMs !== null && lastTime !== null && timeMs < lastTime) timeMs = null;
    if (timeMs !== null) lastTime = timeMs;
    points.push({
      lat,
      lon,
      eleFt: eleMeters !== null && eleMeters > -500 && eleMeters < 9000 ? eleMeters * FT_PER_METER : null,
      timeMs,
    });
  }
  const originalCount = points.length;
  if (points.length <= maxPoints) return { points, originalCount, downsampled: false };
  let highest = -1;
  points.forEach((point, index) => {
    if (point.eleFt !== null && (highest < 0 || point.eleFt > points[highest].eleFt)) highest = index;
  });
  const keep = new Set([0, points.length - 1]);
  if (highest >= 0) keep.add(highest);
  const slots = maxPoints - keep.size;
  for (let i = 0; i < slots; i += 1) keep.add(Math.round(((i + 1) * (points.length - 1)) / (slots + 1)));
  const thinned = [...keep].sort((a, b) => a - b).map((index) => points[index]);
  return { points: thinned, originalCount, downsampled: true };
};

/** Median of three neighbours: removes single-point GPS spikes and keeps real climbs and both ends exactly. */
const smoothElevations = (values) => values.map((value, index) => {
  if (value === null || index === 0 || index === values.length - 1) return value;
  const window = [values[index - 1], value, values[index + 1]].filter((entry) => entry !== null);
  if (window.length < 3) return value;
  return window.sort((a, b) => a - b)[1];
});

/** Gain and loss counted only once the elevation has moved past the hysteresis from the last turning point. */
const accumulateGainLoss = (elevations, thresholdFt = ELEVATION_HYSTERESIS_FT) => {
  let anchor = null;
  let gain = 0;
  let loss = 0;
  for (const value of elevations) {
    if (value === null) continue;
    if (anchor === null) {
      anchor = value;
      continue;
    }
    if (value - anchor >= thresholdFt) {
      gain += value - anchor;
      anchor = value;
    } else if (anchor - value >= thresholdFt) {
      loss += anchor - value;
      anchor = value;
    }
  }
  return { gainFt: gain, lossFt: loss };
};

const emptyStretch = () => ({ miles: 0, movingMinutes: 0, verticalFt: 0 });

/**
 * Distance, climb, moving time and pace of a recorded track (sanitized points).
 * Times are epoch milliseconds; without timestamps every time field is null.
 */
const summarizeTrack = (points) => {
  const elevations = smoothElevations(points.map((point) => point.eleFt));
  const withElevation = elevations.filter((value) => value !== null);
  const hasElevation = withElevation.length >= 2;
  const timed = points.filter((point) => point.timeMs !== null);
  const startMs = timed.length ? timed[0].timeMs : null;
  const finishMs = timed.length ? timed[timed.length - 1].timeMs : null;
  const hasTimes = timed.length >= 2 && finishMs > startMs && finishMs - startMs <= MAX_TRIP_HOURS * HOUR_MS;

  let meters = 0;
  let movingMs = 0;
  const stretches = { climb: emptyStretch(), descent: emptyStretch(), flat: emptyStretch() };
  let chunk = { meters: 0, movingMs: 0, rise: 0 };
  const closeChunk = () => {
    if (chunk.meters <= 0) return;
    const grade = hasElevation ? chunk.rise / (chunk.meters * FT_PER_METER) : 0;
    const kind = grade >= CLIMB_GRADE ? 'climb' : grade <= -CLIMB_GRADE ? 'descent' : 'flat';
    stretches[kind].miles += chunk.meters / METERS_PER_MILE;
    stretches[kind].movingMinutes += chunk.movingMs / MINUTE_MS;
    stretches[kind].verticalFt += Math.abs(chunk.rise);
    chunk = { meters: 0, movingMs: 0, rise: 0 };
  };
  let highIndex = -1;
  for (let index = 0; index < points.length; index += 1) {
    if (elevations[index] !== null && (highIndex < 0 || elevations[index] > elevations[highIndex])) highIndex = index;
    if (index === 0) continue;
    const previous = points[index - 1];
    const point = points[index];
    const segmentMeters = haversineMeters(previous, point);
    const rise = elevations[index] !== null && elevations[index - 1] !== null ? elevations[index] - elevations[index - 1] : 0;
    let segmentMovingMs = 0;
    if (hasTimes && previous.timeMs !== null && point.timeMs !== null && point.timeMs > previous.timeMs) {
      const hours = (point.timeMs - previous.timeMs) / HOUR_MS;
      const mph = segmentMeters / METERS_PER_MILE / hours;
      const verticalRate = Math.abs(rise) / hours;
      if (mph >= MIN_MOVING_MPH || verticalRate >= MIN_MOVING_VERTICAL_FT_PER_HOUR) segmentMovingMs = point.timeMs - previous.timeMs;
    }
    meters += segmentMeters;
    movingMs += segmentMovingMs;
    chunk.meters += segmentMeters;
    chunk.movingMs += segmentMovingMs;
    chunk.rise += rise;
    if (chunk.meters / METERS_PER_MILE >= PACE_STRETCH_MILES) closeChunk();
  }
  closeChunk();

  const { gainFt, lossFt } = hasElevation ? accumulateGainLoss(elevations) : { gainFt: null, lossFt: null };
  const describeStretch = (stretch, vertical) => {
    if (stretch.miles < 0.05) return null;
    const minutes = hasTimes ? stretch.movingMinutes : null;
    return {
      miles: round(stretch.miles, 2),
      ...(vertical ? { [vertical]: round(stretch.verticalFt) } : {}),
      movingMinutes: round(minutes),
      minutesPerMile: minutes !== null && minutes > 0 ? round(minutes / stretch.miles, 1) : null,
      ...(vertical
        ? { verticalFtPerHour: minutes !== null && minutes > 0 ? round(stretch.verticalFt / (minutes / 60)) : null }
        : {}),
    };
  };
  const distanceMiles = meters / METERS_PER_MILE;
  const movingMinutes = hasTimes ? movingMs / MINUTE_MS : null;
  const high = highIndex >= 0 ? points[highIndex] : null;
  return {
    pointCount: points.length,
    hasTimes,
    hasElevation,
    distanceMiles: round(distanceMiles, 2),
    gainFt: round(gainFt),
    lossFt: round(lossFt),
    maxElevationFt: hasElevation ? round(Math.max(...withElevation)) : null,
    minElevationFt: hasElevation ? round(Math.min(...withElevation)) : null,
    startMs: hasTimes ? startMs : null,
    finishMs: hasTimes ? finishMs : null,
    elapsedMinutes: hasTimes ? round((finishMs - startMs) / MINUTE_MS) : null,
    movingMinutes: round(movingMinutes),
    stoppedMinutes: hasTimes ? round((finishMs - startMs) / MINUTE_MS - movingMinutes) : null,
    movingMinutesPerMile: movingMinutes !== null && distanceMiles > 0 ? round(movingMinutes / distanceMiles, 1) : null,
    highPoint: high && hasElevation ? {
      lat: round(high.lat, 5),
      lon: round(high.lon, 5),
      elevationFt: round(elevations[highIndex]),
      timeMs: hasTimes ? high.timeMs : null,
    } : null,
    pace: {
      climbing: describeStretch(stretches.climb, 'gainFt'),
      descending: describeStretch(stretches.descent, 'lossFt'),
      flat: describeStretch(stretches.flat, null),
    },
    elevations,
  };
};

// --- Local time at the objective --------------------------------------------

const zoneOffsetMinutes = (timeZone, ms) => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(ms));
    const get = (type) => Number(parts.find((part) => part.type === type)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return Number.isFinite(asUtc) ? Math.round((asUtc - ms) / MINUTE_MS) : null;
  } catch {
    return null;
  }
};

const suffixOffsetMinutes = (iso) => {
  const match = /([+-])(\d{2}):?(\d{2})$/.exec(String(iso || '').trim());
  if (match) return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
  return /Z$/i.test(String(iso || '').trim()) ? 0 : null;
};

/**
 * Local clock at the objective: the report's IANA time zone when it has one,
 * else the fixed offset its forecast times carry, else UTC.
 */
const buildLocalClock = (safety) => {
  const timeZone = typeof safety?.weather?.timezone === 'string' ? safety.weather.timezone.trim() : '';
  const zoneWorks = timeZone && zoneOffsetMinutes(timeZone, Date.now()) !== null;
  const fixedOffset = [safety?.forecast?.selectedStartTime, safety?.weather?.forecastStartTime, safety?.weather?.trend?.[0]?.timeIso]
    .map(suffixOffsetMinutes)
    .find((value) => value !== null);
  const offsetAt = (ms) => (zoneWorks ? zoneOffsetMinutes(timeZone, ms) : fixedOffset ?? 0);
  const source = zoneWorks ? 'timezone' : fixedOffset !== undefined ? 'forecast-offset' : 'utc';
  const parts = (ms) => {
    if (!Number.isFinite(ms)) return null;
    const local = new Date(ms + offsetAt(ms) * MINUTE_MS).toISOString();
    return { date: local.slice(0, 10), clock: local.slice(11, 16) };
  };
  /** Epoch ms of a local date and minutes after its midnight. */
  const instant = (date, minutes) => {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(minutes)) return null;
    const [y, m, d] = date.split('-').map(Number);
    const wall = Date.UTC(y, m - 1, d) + minutes * MINUTE_MS;
    const guess = wall - offsetAt(wall) * MINUTE_MS;
    return wall - offsetAt(guess) * MINUTE_MS;
  };
  return { parts, instant, source, timeZone: zoneWorks ? timeZone : null };
};

// --- The plan in the saved report -------------------------------------------

/** A saved report payload ({ plan, safetyData, route, preferences }) or a bare /api/safety payload. */
const unwrapReport = (report) => {
  const safety = isRecord(report?.safetyData) ? report.safetyData : isRecord(report) ? report : {};
  return {
    safety,
    savedPlan: isRecord(report?.plan) ? report.plan : {},
    route: isRecord(report?.route) ? report.route : {},
    preferences: isRecord(report?.preferences) ? report.preferences : {},
  };
};

const firstString = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim() ?? null;

const clockFromIso = (iso) => {
  const match = /T(\d{2}):(\d{2})/.exec(String(iso || ''));
  return match ? `${match[1]}:${match[2]}` : null;
};

const minutesToClock = (minutes) => {
  if (!Number.isFinite(minutes)) return null;
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
};

/** The pace the plan assumed, and where it came from. */
const readPlannedPace = ({ timing, params, preferences, activity }) => {
  const profile = activityProfile(activity);
  const profileStop = profile.timing?.stopBufferMinutes ?? 0;
  const routePace = sanitizeRoutePace(timing?.pace);
  if (routePace) {
    return {
      ...routePace,
      stopBufferMinutes: routePace.stopBufferMinutes ?? round(num(timing?.stopMinutes)) ?? profileStop,
      source: timing?.paceSource === 'user' ? 'route-your-pace' : 'route-default',
    };
  }
  const paramPace = sanitizeRoutePace({
    minutesPerMile: params?.pace_min_per_mi,
    ascentMinutesPer1000Ft: params?.ascent_min_per_kft,
    stopBufferMinutes: params?.stop_min,
  });
  if (paramPace) return { ...paramPace, stopBufferMinutes: paramPace.stopBufferMinutes ?? profileStop, source: 'plan' };
  const saved = isRecord(preferences?.activityRouteTiming) ? preferences.activityRouteTiming[activity] : null;
  const preferencePace = saved && sanitizeRoutePace({
    minutesPerMile: saved.runnerPaceMinutesPerMile,
    ascentMinutesPer1000Ft: saved.runnerAscentMinutesPer1000Ft,
    stopBufferMinutes: saved.runnerStopBufferMinutes,
  });
  if (preferencePace) return { ...preferencePace, stopBufferMinutes: preferencePace.stopBufferMinutes ?? profileStop, source: 'preferences' };
  const timingProfile = profile.timing;
  if (timingProfile) {
    return {
      minutesPerMile: timingProfile.paceMinutesPerMile,
      ascentMinutesPer1000Ft: timingProfile.ascentMinutesPer1000Ft,
      stopBufferMinutes: timingProfile.stopBufferMinutes,
      source: 'activity',
    };
  }
  return { ...DEFAULT_ROUTE_PACE, stopBufferMinutes: 0, source: 'default' };
};

/** The planned route's length and climb: the GPX route, the analyzed route, or the chosen suggestion. */
const readPlannedRoute = (route) => {
  const analysis = isRecord(route.routeAnalysis) ? route.routeAnalysis : null;
  const timing = isRecord(analysis?.timing) ? analysis.timing : null;
  const outAndBack = timing?.routeShape === 'out-and-back';
  const gpx = isRecord(route.gpxRoute) ? route.gpxRoute : null;
  if (gpx && num(gpx.distanceMiles) > 0) {
    // A one-way GPX line walked out and back covers it twice.
    const doubled = outAndBack && gpx.routeShape === 'point-to-point';
    const gain = num(gpx.elevationGainFt);
    return {
      name: firstString(route.customRouteName, gpx.name),
      distanceMiles: round(num(gpx.distanceMiles) * (doubled ? 2 : 1), 2),
      gainFt: gain === null ? null : round(gain * (doubled ? 2 : 1)),
      source: 'gpx',
    };
  }
  const metadata = isRecord(analysis?.routeMetadata) ? analysis.routeMetadata : null;
  if (metadata && num(metadata.distanceMiles) > 0) {
    const doubled = outAndBack && metadata.routeShape === 'point-to-point';
    const gain = num(metadata.elevationGainFt);
    return {
      name: firstString(analysis.routeName, route.customRouteName, metadata.fileName),
      distanceMiles: round(num(metadata.distanceMiles) * (doubled ? 2 : 1), 2),
      gainFt: gain === null ? null : round(gain * (doubled ? 2 : 1)),
      source: 'route-analysis',
    };
  }
  const name = firstString(route.customRouteName, analysis?.routeName);
  const suggestion = Array.isArray(route.routeSuggestions) && name
    ? route.routeSuggestions.find((option) => isRecord(option) && option.name === name)
    : null;
  if (suggestion && num(suggestion.distance_rt_miles) > 0) {
    return {
      name,
      distanceMiles: round(num(suggestion.distance_rt_miles), 2),
      gainFt: round(num(suggestion.elev_gain_ft)),
      estimatedHours: num(suggestion.estimated_hours),
      source: 'suggestion',
    };
  }
  return name ? { name, distanceMiles: null, gainFt: null, source: null } : null;
};

/** Moving minutes over a stretch at a pace: distance, climbing, and descent at a third of the climbing rate. */
const movingMinutesAtPace = (miles, gainFt, lossFt, pace) => {
  if (!pace || !Number.isFinite(miles)) return null;
  return miles * pace.minutesPerMile
    + ((gainFt || 0) / 1000) * pace.ascentMinutesPer1000Ft
    + ((lossFt || 0) / 1000) * pace.ascentMinutesPer1000Ft * DESCENT_SHARE_OF_ASCENT;
};

const readPlan = (report, clock) => {
  const { safety, savedPlan, route, preferences } = unwrapReport(report);
  const evaluation = isRecord(safety.evaluation) ? safety.evaluation : {};
  const evaluatedPlan = isRecord(evaluation.plan) ? evaluation.plan : {};
  const params = isRecord(evaluation.params) ? evaluation.params : {};
  const forecast = isRecord(safety.forecast) ? safety.forecast : {};
  const analysis = isRecord(route.routeAnalysis) ? route.routeAnalysis : null;
  const timing = isRecord(analysis?.timing) ? analysis.timing : null;

  const date = firstString(evaluatedPlan.date, savedPlan.forecastDate, forecast.selectedDate, safety.weather?.forecastDate);
  const startClock = parseStartClock(evaluatedPlan.start)
    || parseStartClock(savedPlan.alpineStartTime)
    || parseStartClock(forecast.requestedStartTime)
    || clockFromIso(forecast.selectedStartTime);
  const windowHours = num(evaluatedPlan.travelWindowHours) ?? num(savedPlan.travelWindowHours) ?? num(timing?.travelWindowHours);
  const activity = normalizeActivity(firstString(evaluatedPlan.activity, forecast.activity, params.activity));
  const startMinutes = parseClockToMinutes(startClock);
  const startMs = clock.instant(date, startMinutes);
  const endMs = startMs !== null && windowHours !== null ? startMs + windowHours * HOUR_MS : null;
  const turnaround = isRecord(timing?.turnaround) ? timing.turnaround : null;
  const turnaroundClock = minutesToClock(parseClockToMinutes(firstString(turnaround?.byPlanEnd, evaluatedPlan.turnaroundTime)));
  const darkTurnaroundClock = minutesToClock(parseClockToMinutes(turnaround?.byDark));
  const sunsetMinutes = parseClockToMinutes(firstString(safety.solar?.sunset));
  const sunriseMinutes = parseClockToMinutes(firstString(safety.solar?.sunrise));
  const pace = readPlannedPace({ timing, params, preferences, activity });
  const plannedRoute = readPlannedRoute(route);

  let estimatedMinutes = num(timing?.estimatedMinutes);
  let estimateSource = estimatedMinutes !== null ? 'route-analysis' : null;
  if (estimatedMinutes === null && plannedRoute?.distanceMiles > 0) {
    const gain = plannedRoute.gainFt ?? 0;
    // Planned routes come back to the start (closed, out-and-back, suggested round trips), so they lose what they gain.
    estimatedMinutes = movingMinutesAtPace(plannedRoute.distanceMiles, gain, gain, pace) + pace.stopBufferMinutes;
    estimateSource = 'pace';
  }
  if (estimatedMinutes === null && plannedRoute?.estimatedHours) {
    estimatedMinutes = plannedRoute.estimatedHours * 60;
    estimateSource = 'suggestion';
  }

  const turnaroundMs = turnaroundClock ? clock.instant(date, parseClockToMinutes(turnaroundClock)) : null;
  return {
    date,
    activity,
    activityLabel: activityProfile(activity).label,
    startClock,
    startMs,
    travelWindowHours: windowHours,
    endMs,
    endClock: endMs !== null ? clock.parts(endMs).clock : null,
    turnaroundClock,
    turnaroundMs: turnaroundMs !== null && startMs !== null && turnaroundMs < startMs ? turnaroundMs + 24 * HOUR_MS : turnaroundMs,
    darkTurnaroundClock,
    sunriseClock: minutesToClock(sunriseMinutes),
    sunsetClock: minutesToClock(sunsetMinutes),
    sunsetMs: clock.instant(date, sunsetMinutes),
    pace,
    route: plannedRoute,
    estimatedMinutes: round(estimatedMinutes),
    estimateSource,
  };
};

// --- The forecast for the hours out -----------------------------------------

/** Each hourly forecast reading with the instant its hour starts. */
const readForecastHours = (safety, clock, date) => {
  const trend = Array.isArray(safety.weather?.trend) ? safety.weather.trend : [];
  let dayShift = 0;
  let previousMinutes = null;
  return trend.flatMap((row) => {
    if (!isRecord(row)) return [];
    let startMs = parseIsoTimeToMs(typeof row.timeIso === 'string' && /([zZ]|[+-]\d{2}:?\d{2})$/.test(row.timeIso.trim()) ? row.timeIso : null);
    if (startMs === null) {
      // Older rows carry only a local clock: lay them out from the plan's date.
      const minutes = parseClockToMinutes(row.time) ?? parseClockToMinutes(clockFromIso(row.timeIso));
      if (minutes === null) return [];
      if (previousMinutes !== null && minutes < previousMinutes) dayShift += 1;
      previousMinutes = minutes;
      startMs = clock.instant(date, minutes + dayShift * 1440);
      if (startMs === null) return [];
    }
    return [{ startMs, row }];
  });
};

const readNumber = (value) => {
  const parsed = num(value);
  return parsed === null ? null : round(parsed);
};

/**
 * The forecast for every hour the track spans, beside where the track was that
 * hour: its lowest and highest elevation, and the forecast moved to those
 * elevations with the report's lapse-rate model.
 */
const buildHoursOut = ({ safety, clock, date, points, elevations, track }) => {
  if (!track.hasTimes) return { hours: [], hoursWithoutForecast: 0 };
  const forecastElevationFt = num(safety.weather?.elevation);
  const forecast = readForecastHours(safety, clock, date);
  const firstHour = Math.floor(track.startMs / HOUR_MS) * HOUR_MS;
  const hours = [];
  let hoursWithoutForecast = 0;
  for (let hourStart = firstHour; hourStart < track.finishMs; hourStart += HOUR_MS) {
    const hourEnd = hourStart + HOUR_MS;
    let low = null;
    let high = null;
    let firstIndex = -1;
    let lastIndex = -1;
    points.forEach((point, index) => {
      if (point.timeMs === null || point.timeMs < hourStart || point.timeMs >= hourEnd) return;
      if (firstIndex < 0) firstIndex = index;
      lastIndex = index;
      const ele = elevations[index];
      if (ele === null) return;
      low = low === null ? ele : Math.min(low, ele);
      high = high === null ? ele : Math.max(high, ele);
    });
    let miles = 0;
    for (let index = Math.max(1, firstIndex); firstIndex >= 0 && index <= lastIndex; index += 1) {
      miles += haversineMeters(points[index - 1], points[index]) / METERS_PER_MILE;
    }
    // The forecast hour this clock hour falls in (rows are hourly; the closest start within the hour).
    const match = forecast.find((entry) => entry.startMs <= hourStart + 30 * MINUTE_MS && entry.startMs + HOUR_MS > hourStart + 30 * MINUTE_MS);
    const local = clock.parts(hourStart);
    const entry = {
      time: new Date(hourStart).toISOString(),
      clock: local.clock,
      date: local.date,
      miles: round(miles, 2),
      lowElevationFt: round(low),
      highElevationFt: round(high),
      forecast: null,
      atHigh: null,
      atLow: null,
    };
    if (match) {
      const { row } = match;
      entry.forecast = {
        tempF: readNumber(row.temp),
        windMph: readNumber(row.wind),
        gustMph: readNumber(row.gust),
        precipChance: readNumber(row.precipChance),
        condition: typeof row.condition === 'string' ? row.condition.slice(0, 80) : null,
        elevationFt: forecastElevationFt === null ? null : round(forecastElevationFt),
      };
      const base = { temp: num(row.temp), wind: num(row.wind), gust: num(row.gust) ?? Number.NaN };
      const canMove = forecastElevationFt !== null && base.temp !== null && base.wind !== null;
      const at = (elevationFt) => {
        if (!canMove || elevationFt === null) return null;
        const estimate = estimateAtElevation(base, elevationFt - forecastElevationFt);
        return {
          elevationFt: round(elevationFt),
          tempF: estimate.temp,
          feelsLikeF: readNumber(estimate.feelsLike),
          windMph: estimate.windSpeed,
          gustMph: Number.isFinite(base.gust) ? estimate.windGust : null,
        };
      };
      entry.atHigh = at(high);
      entry.atLow = low !== null && high !== null && high - low >= 300 ? at(low) : null;
    } else {
      hoursWithoutForecast += 1;
    }
    hours.push(entry);
  }
  return { hours, hoursWithoutForecast };
};

const minutesBetween = (fromMs, toMs) => (Number.isFinite(fromMs) && Number.isFinite(toMs) ? round((toMs - fromMs) / MINUTE_MS) : null);

const maxOf = (values) => {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.max(...finite) : null;
};

const minOf = (values) => {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.min(...finite) : null;
};

/** Planned against actual, in miles, feet and minutes, with the forecast for the hours out. */
const buildTripDebrief = ({ report, points: rawPoints, maxPoints = MAX_DEBRIEF_POINTS }) => {
  const { safety } = unwrapReport(report);
  const clock = buildLocalClock(safety);
  const { points, originalCount, downsampled } = sanitizeTrackPoints(rawPoints, { maxPoints });
  if (points.length < 2) {
    const error = new Error('The track needs at least two points with a latitude and longitude.');
    error.code = 'TRACK_TOO_SHORT';
    throw error;
  }
  const { elevations, ...track } = summarizeTrack(points);
  const plan = readPlan(report, clock);
  const startLocal = track.hasTimes ? clock.parts(track.startMs) : null;
  const finishLocal = track.hasTimes ? clock.parts(track.finishMs) : null;
  const highLocal = track.highPoint?.timeMs ? clock.parts(track.highPoint.timeMs) : null;

  // The plan's pace over the ground actually covered, without stops: what the
  // plan assumed this exact track would take on the move.
  const plannedMovingMinutes = round(movingMinutesAtPace(track.distanceMiles, track.gainFt, track.lossFt, plan.pace));
  const paceRatio = track.movingMinutes > 0 && plannedMovingMinutes > 0 ? round(track.movingMinutes / plannedMovingMinutes, 2) : null;
  const { hours, hoursWithoutForecast } = buildHoursOut({ safety, clock, date: plan.date, points, elevations, track });

  const notes = [];
  if (downsampled) notes.push(`The track had ${originalCount.toLocaleString('en-US')} points; ${points.length.toLocaleString('en-US')} evenly spaced points were compared.`);
  if (!track.hasTimes) notes.push('The track has no usable timestamps, so start, duration, pace and the hours out could not be compared.');
  if (!track.hasElevation) notes.push('The track has no elevations, so climb, descent and conditions by elevation could not be compared.');
  const dateMatches = startLocal && plan.date ? startLocal.date === plan.date : null;
  if (dateMatches === false) notes.push(`The track starts on ${startLocal.date}, not the report's planned date (${plan.date}); the forecast compared is for the planned date's hours only.`);
  if (track.hasTimes && hours.length && hoursWithoutForecast === hours.length) notes.push('The report has no hourly forecast for the hours this track was recorded.');
  else if (hoursWithoutForecast > 0) notes.push(`${hoursWithoutForecast} of the ${hours.length} hours out are outside the report's hourly forecast.`);
  if (clock.source === 'utc') notes.push('The report has no time zone, so clock times are UTC.');

  const forecastHours = hours.filter((hour) => hour.forecast);
  const { startMs: trackStartMs, finishMs: trackFinishMs, highPoint, ...trackSummary } = track;
  const { timeMs: highPointMs, ...highPointPlace } = highPoint || {};
  return {
    version: 1,
    units: { distance: 'mi', elevation: 'ft', temperature: 'F', wind: 'mph', duration: 'min' },
    timeZone: clock.timeZone,
    track: {
      ...trackSummary,
      originalPointCount: originalCount,
      downsampled,
      startTime: track.hasTimes ? new Date(trackStartMs).toISOString() : null,
      finishTime: track.hasTimes ? new Date(trackFinishMs).toISOString() : null,
      date: startLocal?.date ?? null,
      startClock: startLocal?.clock ?? null,
      finishClock: finishLocal?.clock ?? null,
      highPoint: highPoint ? { ...highPointPlace, clock: highLocal?.clock ?? null } : null,
    },
    plan: {
      date: plan.date,
      activity: plan.activity,
      activityLabel: plan.activityLabel,
      startClock: plan.startClock,
      travelWindowHours: plan.travelWindowHours,
      endClock: plan.endClock,
      turnaroundClock: plan.turnaroundClock,
      darkTurnaroundClock: plan.darkTurnaroundClock,
      sunriseClock: plan.sunriseClock,
      sunsetClock: plan.sunsetClock,
      pace: plan.pace,
      route: plan.route,
      estimatedMinutes: plan.estimatedMinutes,
      estimateSource: plan.estimateSource,
    },
    differences: {
      dateMatches,
      /** Positive: started later than planned. */
      startMinutes: dateMatches === false ? null : minutesBetween(plan.startMs, track.startMs),
      /** Positive: out longer than the planned travel window. */
      elapsedVsWindowMinutes: track.elapsedMinutes !== null && plan.travelWindowHours !== null
        ? round(track.elapsedMinutes - plan.travelWindowHours * 60) : null,
      /** Positive: out longer than the plan's estimate for the route. */
      elapsedVsEstimateMinutes: track.elapsedMinutes !== null && plan.estimatedMinutes !== null
        ? round(track.elapsedMinutes - plan.estimatedMinutes) : null,
      /** Positive: finished before the planned window ended. */
      finishMarginToPlanEndMinutes: dateMatches === false ? null : minutesBetween(track.hasTimes ? track.finishMs : null, plan.endMs),
      /** Positive: finished before sunset. */
      finishMarginToSunsetMinutes: dateMatches === false ? null : minutesBetween(track.hasTimes ? track.finishMs : null, plan.sunsetMs),
      /** Positive: reached the high point before the planned turnaround. */
      highPointMarginToTurnaroundMinutes: dateMatches === false ? null : minutesBetween(highPointMs ?? null, plan.turnaroundMs),
      distanceMiles: plan.route?.distanceMiles > 0 ? round(track.distanceMiles - plan.route.distanceMiles, 2) : null,
      gainFt: Number.isFinite(plan.route?.gainFt) && track.gainFt !== null ? round(track.gainFt - plan.route.gainFt) : null,
      /** Moving minutes the planned pace gives for the track as traveled (no stops). */
      plannedMovingMinutes: track.hasTimes ? plannedMovingMinutes : null,
      /** Actual moving time over that: above 1 slower than planned, below 1 faster. */
      paceRatio,
      stoppedVsPlannedMinutes: track.stoppedMinutes !== null ? round(track.stoppedMinutes - plan.pace.stopBufferMinutes) : null,
      /** The planned pace scaled to this trip's moving time. */
      matchingPace: paceRatio !== null ? {
        minutesPerMile: round(plan.pace.minutesPerMile * paceRatio),
        ascentMinutesPer1000Ft: round(plan.pace.ascentMinutesPer1000Ft * paceRatio),
        stopBufferMinutes: track.stoppedMinutes,
      } : null,
    },
    hours,
    forecastSummary: forecastHours.length ? {
      hours: forecastHours.length,
      maxGustMph: maxOf(forecastHours.map((hour) => hour.atHigh?.gustMph ?? hour.forecast.gustMph)),
      maxWindMph: maxOf(forecastHours.map((hour) => hour.atHigh?.windMph ?? hour.forecast.windMph)),
      minTempF: minOf(forecastHours.map((hour) => hour.atHigh?.tempF ?? hour.forecast.tempF)),
      maxPrecipChance: maxOf(forecastHours.map((hour) => hour.forecast.precipChance)),
    } : null,
    notes,
  };
};

module.exports = {
  MAX_DEBRIEF_POINTS,
  ELEVATION_HYSTERESIS_FT,
  accumulateGainLoss,
  buildLocalClock,
  buildTripDebrief,
  readPlan,
  sanitizeTrackPoints,
  smoothElevations,
  summarizeTrack,
};
