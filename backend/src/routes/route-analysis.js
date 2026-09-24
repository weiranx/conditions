const { createCache, normalizeCoordKey, normalizeTextKey } = require('../utils/cache');
const { assertAIFeatureEnabled } = require('../utils/ai-client');
const { compactReportForAI } = require('../utils/ai-report-context');
const { assertFeatureEnabled, getFeatureFlags } = require('../utils/feature-flags');
const { logger } = require('../utils/logger');
const { describeUnitsInstruction } = require('../utils/units-instruction');
const {
  getDisabledScoreFeatureLabels,
  removeDisabledNarrativeReferences,
  sanitizeReportForFeatureFlags,
} = require('../utils/report-feature-filter');
const { createRouteDataService, buildRouteTerrainProfile } = require('../utils/route-data');
const { denyUnconfiguredAccountAccess } = require('../auth/account-access');
const { finiteNumber, serializeWaypointReports } = require('../utils/route-briefing');
const { toFiniteOrNull } = require('../utils/numbers');
const { parseClockToMinutes } = require('../utils/time');
const {
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
} = require('../utils/route-timing');

const withTimeout = (promise, ms, label) => {
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
      ms,
    );
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
};

const MAX_SUPPLIED_WAYPOINTS = 8;
const MAX_TRACK_POINTS = 600;
const ROUTE_SHAPES = new Set(['out-and-back', 'loop', 'point-to-point']);
// A generated landmark this close to the objective, and not the objective itself,
// has the objective's coordinates rather than its own.
const COPIED_OBJECTIVE_COORDINATE_KM = 0.25;
// Above Everest's summit, a generated landmark elevation is a hallucination.
const MAX_GENERATED_ELEVATION_FT = 29100;
const MAX_WAYPOINT_DISTANCE_FROM_OBJECTIVE_KM = 200;
// A mapped trail that comes within this distance of the objective is preferred
// over AI-generated landmarks; one farther off is only a fallback.
const MAX_MAPPED_GAP_KM = 2;
// An AI landmark found on the map within this distance of a mapped checkpoint names it.
const MAPPED_NAME_MATCH_KM = 0.6;
const ROUTE_ANALYSIS_MAX_TOKENS = 8192;

// Named routes and landmarks don't change day to day, so AI answers are kept for a
// week without background regeneration, which would also reshuffle checkpoints.
const routeSuggestionsCache = createCache({ name: 'route-suggestions', ttlMs: 7 * 24 * 60 * 60 * 1000, maxEntries: 100 });
const waypointCache = createCache({ name: 'waypoints', ttlMs: 7 * 24 * 60 * 60 * 1000, maxEntries: 200 });
// Mapped trail lookups (NPS, then Overpass) change rarely and Overpass is shared
// infrastructure; a miss is kept too, so a route without a mapped trail isn't
// looked up on every analysis.
const mappedRouteCache = createCache({ name: 'mapped-routes', ttlMs: 24 * 60 * 60 * 1000, maxEntries: 200 });
const nominatimGeocodeCache = createCache({ name: 'nominatim-geocode', ttlMs: 24 * 60 * 60 * 1000, staleTtlMs: 6 * 24 * 60 * 60 * 1000, maxEntries: 500 });

// Number(null) and Number('') are 0, so check for absence before converting.
const knownElevation = (value) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

const pick = (obj, keys) => {
  if (!obj || typeof obj !== 'object') return {};
  return keys.reduce((acc, k) => {
    if (obj[k] !== undefined) acc[k] = obj[k];
    return acc;
  }, {});
};

// `fractions` (0–1 per checkpoint, from computeCheckpointFractions) places each
// arrival within the travel window; without it, route progress or even spacing is used.
// `offsets` (minutes after the start, from the traveler's pace) place arrivals directly.
const buildCheckpointSchedule = (waypoints, date, start = '06:00', travelWindowHours = 12, fractions = null, offsets = null) => {
  const [year, month, day] = String(date).split('-').map(Number);
  const [hour, minute] = String(start || '06:00').split(':').map(Number);
  const baseMs = Date.UTC(year, month - 1, day, hour, minute);
  const safeHours = Math.max(1, Math.min(24, Math.round(Number(travelWindowHours) || 12)));
  // Minutes after the start, set by pace, place each arrival directly.
  if (Array.isArray(offsets)) {
    const last = offsets[offsets.length - 1];
    return waypoints.map((_, index) => {
      const offsetMinutes = Math.max(0, Math.round(offsets[index]));
      const eta = new Date(baseMs + offsetMinutes * 60 * 1000);
      return {
        date: eta.toISOString().slice(0, 10),
        time: eta.toISOString().slice(11, 16),
        offsetMinutes,
        progressPercent: last > 0 ? Math.round((offsets[index] / last) * 100) : 0,
      };
    });
  }
  return waypoints.map((waypoint, index) => {
    const fallbackProgress = waypoints.length > 1 ? (index / (waypoints.length - 1)) * 100 : 0;
    const progress = Array.isArray(fractions) && Number.isFinite(fractions[index])
      ? Math.max(0, Math.min(100, fractions[index] * 100))
      : Number.isFinite(Number(waypoint.progress_percent))
        ? Math.max(0, Math.min(100, Number(waypoint.progress_percent)))
        : fallbackProgress;
    const offsetMinutes = Math.round(safeHours * 60 * progress / 100);
    const eta = new Date(baseMs + offsetMinutes * 60 * 1000);
    return {
      date: eta.toISOString().slice(0, 10),
      time: eta.toISOString().slice(11, 16),
      offsetMinutes,
      progressPercent: Math.round(progress),
    };
  });
};

const buildDeterministicRouteBriefing = (summaries, failedWaypointNames = [], units = null, routeTiming = null) => {
  const available = summaries.filter((summary) => summary.dataAvailable);
  const scored = available.filter((summary) => finiteNumber(summary.score));
  const worst = scored.reduce((current, summary) => (!current || Number(summary.score) < Number(current.score) ? summary : current), null);
  const peakValue = (key) => {
    const values = available.map((summary) => summary.weather?.[key]).filter(finiteNumber);
    return values.length ? Math.max(...values) : null;
  };
  const peakGust = peakValue('windGust');
  const peakPrecip = peakValue('precipChance');
  const gustText = peakGust === null ? 'Gust forecasts are unavailable.'
    : `Peak modeled gust at available checkpoints is ${Math.round(peakGust * (units?.wind === 'kph' ? 1.609344 : 1))} ${units?.wind === 'kph' ? 'km/h' : 'mph'}.`;
  const precipText = peakPrecip === null ? 'Precipitation probabilities are unavailable.'
    : `Peak precipitation chance at available checkpoints is ${Math.round(peakPrecip)}%.`;
  const incompleteWeather = available.some((summary) => !finiteNumber(summary.weather?.windGust) || !finiteNumber(summary.weather?.precipChance));
  const hazards = available.filter((summary) => summary.primaryHazard && summary.primaryHazard !== 'None')
    .map((summary) => `${summary.name}: ${summary.primaryHazard}`).join('; ');
  const avalancheConcerns = available.filter((summary) => summary.avalanche?.risk)
    .map((summary) => `${summary.name}: ${summary.avalanche.risk} avalanche danger`).join('; ');
  const alerted = available.filter((summary) => summary.activeAlerts > 0).map((summary) => summary.name);
  const incomplete = summaries.filter((summary) => summary.partialData).map((summary) => summary.name);
  const dark = available.filter((summary) => summary.daylight === 'dark').map((summary) => `${summary.name} (${summary.etaTime})`);
  const concerns = [
    avalancheConcerns,
    dark.length ? `Estimated arrival falls outside daylight at ${dark.join(', ')}; plan for slower travel and navigation in the dark.` : '',
    alerted.length ? `Active alerts at ${alerted.join(', ')}; read the official alert details.` : '',
    incomplete.length ? `Some source data is incomplete at ${incomplete.join(', ')}.` : '',
  ].filter(Boolean).join(' ');
  const first = available[0];
  const last = available[available.length - 1];
  const timing = first && last ? `${first.name} at ${first.etaTime} to ${last.name} at ${last.etaTime}` : 'the planned route window';
  const missing = failedWaypointNames.length
    ? ` Data is missing at ${failedWaypointNames.join(', ')} and must be treated as unknown.`
    : '';
  return [
    `HAZARD ZONES: ${worst ? `${worst.name} has the least modeled margin at ${worst.etaTime} with a score of ${Math.round(worst.score)}${worst.tier ? ` (${worst.tier})` : ''}.` : 'No checkpoint score is available.'}${missing}${hazards ? ` Reported primary hazards: ${hazards}.` : ''}`,
    `WEATHER WINDOW: Checkpoint forecasts follow estimated arrival times from ${timing}. ${gustText} ${precipText}${incompleteWeather ? ' Weather coverage is incomplete; missing values are unknown.' : ''}`,
    `OTHER CONCERNS: ${concerns ? `${concerns} ` : ''}This briefing uses forecast and modeled checkpoint data. Verify official alerts, route access, surface conditions, and any unavailable checkpoint before departure.`,
    `DECISION POINTS: Reassess at each timed checkpoint${worst ? `, especially before ${worst.name}` : ''}. Turn around when observed conditions arrive earlier or are worse than the checkpoint forecast.${routeTiming?.turnaround ? ` At your pace, turn around at ${routeTiming.turnaround.objectiveName} by ${routeTiming.turnaround.byPlanEnd} to finish within the planned window${routeTiming.turnaround.byDark ? `, and by ${routeTiming.turnaround.byDark} to finish before sunset` : ''}.` : ''}`,
    `BOTTOM LINE: ${available.some((summary) => (finiteNumber(summary.score) && summary.score < 40) || summary.tier === 'Extreme') ? 'The route contains a low-margin checkpoint and should not be treated as a go.' : !scored.length ? 'Checkpoint scores are unavailable; there is insufficient evidence for a route decision.' : 'Use the timed checkpoints as verification gates rather than a guarantee.'} Rebuild the route brief when timing or pace changes.`,
  ].join('\n');
};

const parseJsonArrayFromAI = (text) => {
  // Strip markdown code fences and XML-like tags that models sometimes wrap around JSON
  let cleaned = text
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```/g, '')
    .replace(/<\/?[a-z][\w-]*>/gi, '');

  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON array found in AI response: ${text.slice(0, 200)}`);
  }
  let raw = cleaned.slice(start, end + 1);

  // Fix trailing commas before } or ]
  raw = raw.replace(/,\s*([}\]])/g, '$1');

  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse JSON from AI: ${e.message}\nRaw: ${raw.slice(0, 300)}`);
  }
};

const sanitizeGeneratedWaypoints = (rawWaypoints) => {
  if (!Array.isArray(rawWaypoints) || rawWaypoints.length < 2 || rawWaypoints.length > MAX_SUPPLIED_WAYPOINTS) {
    throw new Error(`AI waypoints must contain between 2 and ${MAX_SUPPLIED_WAYPOINTS} entries`);
  }

  return rawWaypoints.map((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`AI waypoint ${index + 1} must be an object`);
    }
    const name = String(raw.name || '').trim().slice(0, 100);
    if (!name || /\b(?:checkpoint|waypoint)\s*(?:#\s*)?\d+\b/i.test(name)) {
      throw new Error(`AI waypoint ${index + 1} must use a specific place name`);
    }
    const lat = Number(raw.lat);
    const lon = Number(raw.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new Error(`AI waypoint ${index + 1} must have valid coordinates`);
    }
    // Generated elevations may be kept when the terrain lookup is skipped or
    // fails, so drop implausible ones (the prompt's own example is 0 ft).
    const elevation = raw.elev_ft == null ? null : Number(raw.elev_ft);
    const plausible = Number.isFinite(elevation) && elevation > 0 && elevation <= MAX_GENERATED_ELEVATION_FT;
    const { objective, elev_ft: _generatedElevation, ...rest } = raw;
    return {
      ...rest,
      name,
      lat,
      lon,
      ...(plausible ? { elev_ft: Math.round(elevation) } : {}),
      ...(objective === true ? { objective: true } : {}),
    };
  });
};

// A loop's last landmark is its trailhead again: the same name, or practically the same place.
const LOOP_CLOSE_KM = 0.5;

/**
 * Where the objective sits in generated landmarks and how the route runs past it.
 * Landmarks after the objective either close a loop back at the trailhead or
 * continue a traverse to somewhere else; with none, the route is an out-and-back.
 */
const classifyGeneratedRoute = (waypoints) => {
  const flagged = waypoints.findIndex((waypoint) => waypoint.objective === true);
  const objectiveIndex = flagged >= 0 ? flagged : waypoints.length - 1;
  if (objectiveIndex === waypoints.length - 1) return { objectiveIndex, routeShape: 'out-and-back' };
  const first = waypoints[0];
  const last = waypoints[waypoints.length - 1];
  const closes = normalizeTextKey(first.name) === normalizeTextKey(last.name)
    || haversineKm(first.lat, first.lon, last.lat, last.lon) < LOOP_CLOSE_KM;
  return { objectiveIndex, routeShape: closes ? 'loop' : 'point-to-point' };
};

// Haversine distance in km between two lat/lon points
const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const sanitizeSuppliedWaypoints = (rawWaypoints, peakLat, peakLon) => {
  if (rawWaypoints == null) return null;
  if (!Array.isArray(rawWaypoints)) {
    throw new Error('waypoints must be an array');
  }
  if (rawWaypoints.length < 2 || rawWaypoints.length > MAX_SUPPLIED_WAYPOINTS) {
    throw new Error(`waypoints must contain between 2 and ${MAX_SUPPLIED_WAYPOINTS} entries`);
  }

  return rawWaypoints.map((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`waypoints[${index}] must be an object`);
    }
    const lat = Number(raw.lat);
    const lon = Number(raw.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new Error(`waypoints[${index}] must have valid lat and lon coordinates`);
    }
    if (haversineKm(peakLat, peakLon, lat, lon) > MAX_WAYPOINT_DISTANCE_FROM_OBJECTIVE_KM) {
      throw new Error(`waypoints[${index}] is too far from the selected objective`);
    }
    const elevation = raw.elev_ft == null ? null : Number(raw.elev_ft);
    if (elevation !== null && (!Number.isFinite(elevation) || elevation < -2000 || elevation > 30000)) {
      throw new Error(`waypoints[${index}].elev_ft must be a plausible elevation in feet`);
    }
    const distance = raw.distance_miles == null ? null : Number(raw.distance_miles);
    if (distance !== null && (!Number.isFinite(distance) || distance < 0 || distance > 1000)) {
      throw new Error(`waypoints[${index}].distance_miles must be between 0 and 1000`);
    }
    const progress = raw.progress_percent == null ? null : Number(raw.progress_percent);
    if (progress !== null && (!Number.isFinite(progress) || progress < 0 || progress > 100)) {
      throw new Error(`waypoints[${index}].progress_percent must be between 0 and 100`);
    }
    return {
      name: String(raw.name || `Route checkpoint ${index + 1}`).trim().slice(0, 100) || `Route checkpoint ${index + 1}`,
      lat,
      lon,
      ...(elevation !== null ? { elev_ft: Math.round(elevation) } : {}),
      ...(distance !== null ? { distance_miles: Number(distance.toFixed(2)) } : {}),
      ...(progress !== null ? { progress_percent: Math.round(progress) } : {}),
      source: 'gpx',
    };
  });
};

const sanitizeRouteMetadata = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const finiteOrNull = (value, min, max, precision = 0) => {
    if (value == null) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) return null;
    return Number(number.toFixed(precision));
  };
  return {
    fileName: String(raw.fileName || 'Imported route.gpx').slice(0, 200),
    pointCount: finiteOrNull(raw.pointCount, 2, 100000),
    distanceMiles: finiteOrNull(raw.distanceMiles, 0, 1000, 2),
    elevationGainFt: finiteOrNull(raw.elevationGainFt, 0, 100000),
    minElevationFt: finiteOrNull(raw.minElevationFt, -2000, 30000),
    maxElevationFt: finiteOrNull(raw.maxElevationFt, -2000, 30000),
    routeShape: raw.routeShape === 'closed route' || raw.routeShape === 'point-to-point' ? raw.routeShape : null,
  };
};

/**
 * A GPX track's elevation along its length, [miles, elevFt | null] per point,
 * so arrivals and the approach can follow every climb and descent between
 * checkpoints. Null when not supplied.
 */
const sanitizeSuppliedTrack = (raw) => {
  if (raw == null) return null;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_TRACK_POINTS) {
    throw new Error(`track must contain between 2 and ${MAX_TRACK_POINTS} points`);
  }
  const track = raw.map((point, index) => {
    const miles = Number(Array.isArray(point) ? point[0] : point?.miles);
    const rawElevation = Array.isArray(point) ? point[1] : point?.elevFt;
    const elevFt = rawElevation == null ? null : Number(rawElevation);
    if (!Number.isFinite(miles) || miles < 0 || miles > 1000) throw new Error(`track[${index}] must have a distance between 0 and 1000 miles`);
    if (elevFt !== null && (!Number.isFinite(elevFt) || elevFt < -2000 || elevFt > 30000)) throw new Error(`track[${index}] must have a plausible elevation in feet`);
    return { miles, elevFt };
  });
  if (track.some((point, index) => index > 0 && point.miles < track[index - 1].miles)) throw new Error('track distances must not decrease');
  return track[track.length - 1].miles > 0 ? track : null;
};

const clockAfter = (start, minutes) => {
  const [hour, minute] = String(start || '06:00').split(':').map(Number);
  const total = ((((hour * 60 + minute + Math.round(minutes)) % 1440) + 1440) % 1440);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

// Geocode a waypoint name near the peak using Nominatim (cached 24h), return { lat, lon } or null
const geocodeWaypoint = async (name, peakLat, peakLon, fetchWithTimeout, fetchHeaders) => {
  const cacheKey = `${normalizeTextKey(name)}|${normalizeCoordKey(peakLat, peakLon)}`;
  return nominatimGeocodeCache.getOrFetch(cacheKey, async () => {
    const viewbox = `${peakLon - 0.5},${peakLat + 0.5},${peakLon + 0.5},${peakLat - 0.5}`;
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(name)}&limit=3&bounded=1&viewbox=${viewbox}`;
    const res = await fetchWithTimeout(url, { headers: fetchHeaders });
    if (!res.ok) return null;
    const results = await res.json();
    if (!results.length) return null;

    let best = null;
    let bestDist = Infinity;
    for (const r of results) {
      const d = haversineKm(peakLat, peakLon, parseFloat(r.lat), parseFloat(r.lon));
      if (d < bestDist) {
        bestDist = d;
        best = r;
      }
    }
    if (best && bestDist < 15) {
      return { lat: parseFloat(best.lat), lon: parseFloat(best.lon) };
    }
    return null;
  }).catch(() => null);
};

// Checkpoint labels that only say where along the route a point is.
const GENERIC_CHECKPOINT_NAME = /^(?:route (?:start|finish)|high point|low point|\d{1,3}% checkpoint|route checkpoint \d+|.+ (?:start|checkpoint \d+))$/i;
// Map features whose names mean something on the ground; roads and admin areas don't.
const NAMEABLE_CATEGORIES = new Set(['natural', 'tourism', 'leisure', 'waterway', 'water', 'mountain_pass', 'amenity', 'place']);
const EXACT_PLACE_KM = 0.1;
const NEARBY_PLACE_KM = 0.4;

// The named map feature at a point (Nominatim reverse, cached), or null.
const reverseGeocodePlace = (lat, lon, fetchWithTimeout, fetchHeaders) => nominatimGeocodeCache.getOrFetch(
  `reverse|${Number(lat).toFixed(4)}|${Number(lon).toFixed(4)}`,
  async () => {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${lat}&lon=${lon}`;
    const res = await fetchWithTimeout(url, { headers: fetchHeaders });
    if (!res?.ok) return null;
    const place = await res.json();
    const name = String(place?.name || '').trim().slice(0, 80);
    if (!name || !NAMEABLE_CATEGORIES.has(String(place?.category || ''))) return null;
    const km = haversineKm(lat, lon, Number(place.lat), Number(place.lon));
    return Number.isFinite(km) && km <= NEARBY_PLACE_KM ? { name, km } : null;
  },
).catch(() => null);

/**
 * Give checkpoints that only have a positional label ("40% checkpoint", "Route
 * start") the name of a map feature at or near them: "Crystal Lake", or "Near
 * Crystal Lake", "High point near Crystal Lake". Lookups run one at a time, as
 * Nominatim asks; a failed lookup keeps the label.
 */
const nameGenericCheckpoints = async (waypoints, { fetchWithTimeout, fetchHeaders, skip = new Set() }) => {
  for (const waypoint of waypoints) {
    if (skip.has(waypoint) || !GENERIC_CHECKPOINT_NAME.test(String(waypoint.name || ''))) continue;
    const place = await withTimeout(reverseGeocodePlace(waypoint.lat, waypoint.lon, fetchWithTimeout, fetchHeaders), 5000, 'Checkpoint name lookup').catch(() => null);
    if (!place) continue;
    const role = /^high point$/i.test(waypoint.name) ? 'High point'
      : /^low point$/i.test(waypoint.name) ? 'Low point'
        : /start$/i.test(waypoint.name) ? 'Start'
          : /^route finish$/i.test(waypoint.name) ? 'Finish' : null;
    waypoint.name = place.km <= EXACT_PLACE_KM ? place.name : role ? `${role} near ${place.name}` : `Near ${place.name}`;
  }
};

/**
 * Name checkpoints on a mapped trail after the AI's landmarks: each landmark the
 * map search finds within MAPPED_NAME_MATCH_KM of a checkpoint lends it its name,
 * and the objective takes the objective landmark's name. Positions stay on the
 * mapped trail; unmatched checkpoints keep their trail-based names.
 */
const nameMappedCheckpoints = async (waypoints, landmarks, { safeLat, safeLon, safePeak, fetchWithTimeout, fetchHeaders }) => {
  if (!Array.isArray(landmarks) || !landmarks.length || waypoints.length < 2) return;
  const objectiveIndex = landmarks.findIndex((landmark) => landmark.objective === true);
  const objectiveLandmark = landmarks[objectiveIndex >= 0 ? objectiveIndex : landmarks.length - 1];
  waypoints[waypoints.length - 1].name = objectiveLandmark?.name || safePeak;
  const others = landmarks.filter((landmark) => landmark !== objectiveLandmark);
  const located = await Promise.all(others.map(async (landmark) => ({
    name: landmark.name,
    geo: await geocodeWaypoint(landmark.name, safeLat, safeLon, fetchWithTimeout, fetchHeaders),
  })));
  const named = new Set([waypoints.length - 1]);
  for (const { name, geo } of located) {
    if (!geo) continue;
    let best = -1;
    let bestKm = MAPPED_NAME_MATCH_KM;
    waypoints.forEach((waypoint, index) => {
      if (named.has(index)) return;
      const km = haversineKm(waypoint.lat, waypoint.lon, geo.lat, geo.lon);
      if (km <= bestKm) {
        best = index;
        bestKm = km;
      }
    });
    if (best >= 0) {
      waypoints[best].name = name;
      named.add(best);
    }
  }
};

const describeTiming = ({ basis, mode, roundTrip, routeShape, travelWindowHours, pace, paceSource, stopMinutes, estimatedMinutes, windowFit, turnaround }, daylightEnabled = true) => {
  const weighting = basis === 'distance-and-vert'
    ? `weighted by segment distance and elevation change (${pace.minutesPerMile} min per mile, ${pace.ascentMinutesPer1000Ft} min per 1,000 ft of climbing${paceSource === 'user' ? ' from the traveler\'s pace settings' : ', a default ratio'})`
    : basis === 'distance'
      ? 'weighted by segment distance only because some checkpoint elevations are unknown'
      : basis === 'progress' ? 'spaced by reported route progress' : 'spaced evenly because route distances are unknown';
  const hours = (minutes) => `${Math.round((minutes / 60) * 10) / 10} hours`;
  const arrivals = mode === 'pace'
    ? `ETAs follow the traveler's own pace (${pace.minutesPerMile} min per mile, ${pace.ascentMinutesPer1000Ft} min per 1,000 ft of climbing, descents at a third of that, plus ${stopMinutes} minutes of stops spread across the outing), about ${hours(estimatedMinutes)} in all against a planned ${travelWindowHours}-hour window${windowFit === 'longer' ? ', so the outing runs past the planned window' : windowFit === 'shorter' ? ', so it finishes well inside the planned window' : ''}. They are estimates.${turnaround ? ` To finish within the plan, turn around at ${turnaround.objectiveName} by ${turnaround.byPlanEnd}${turnaround.byDark ? ` (by ${turnaround.byDark} to finish before sunset)` : ''}.` : ''}`
    : `ETAs spread the planned ${travelWindowHours}-hour window across checkpoints, ${weighting}. They are estimates, not a pace prediction.`;
  return `${arrivals}${roundTrip ? ' The route is treated as an out-and-back: the objective is reached part-way through the outing and the checkpoints after it (leg "return") retrace the same route back to the start, the final one being the estimated return to the start.' : ''}${routeShape === 'loop' ? ' The route is a loop: checkpoints after the objective continue around it, and the final checkpoint is the return to the start.' : routeShape === 'point-to-point' ? ' The route is a traverse or one-way trip: it finishes somewhere other than where it starts.' : ''}${daylightEnabled ? ' arrivalDaylight marks whether an ETA falls between that checkpoint\'s sunrise and sunset.' : ''}`;
};

const registerRouteAnalysisRoutes = ({
  app,
  askAI,
  invokeSafetyHandler,
  fetchWithTimeout,
  fetchHeaders,
  ensureAccountAccess = denyUnconfiguredAccountAccess,
  ensureRouteAnalysisEnabled = () => assertFeatureEnabled('routeAnalysis'),
  ensureGpxImportEnabled = () => assertFeatureEnabled('gpxImport'),
  ensureAIEnabled = () => assertAIFeatureEnabled('routeAnalysis'),
  getProductFeatureFlags = getFeatureFlags,
  fetchElevationFt = null,
}) => {
  const routeDataService = createRouteDataService({
    fetchWithTimeout,
    fetchHeaders,
    haversineKm,
  });
  // GET /api/route-suggestions?peak=Mt+Whitney&lat=36.578&lon=-118.292
  app.get('/api/route-suggestions', async (req, res) => {
    const { peak, lat, lon } = req.query;
    if (!peak || !lat || !lon) {
      return res.status(400).json({ error: 'peak, lat, and lon are required' });
    }
    const safePeak = String(peak).slice(0, 200);
    const safeLat = Number(lat);
    const safeLon = Number(lon);
    if (!Number.isFinite(safeLat) || !Number.isFinite(safeLon)) {
      return res.status(400).json({ error: 'lat and lon must be valid numbers' });
    }
    try {
      ensureRouteAnalysisEnabled();
    } catch (error) {
      return res.status(error.statusCode || 503).json({ error: error.message || 'Route analysis is unavailable' });
    }
    if (!(await ensureAccountAccess(req, res))) return;
    try {
      ensureAIEnabled();
    } catch (error) {
      return res.status(503).json({ error: error.message || 'AI features are unavailable' });
    }

    try {
      const suggestCacheKey = `${normalizeTextKey(safePeak)}|${normalizeCoordKey(safeLat, safeLon)}`;
      const routes = await routeSuggestionsCache.getOrFetch(suggestCacheKey, async () => {
        const text = await askAI(
          `List all well-known hiking, climbing, and scrambling routes for ${safePeak} near coordinates (${safeLat}, ${safeLon}) in the United States. Include 3 routes covering a range of difficulty levels.
Return ONLY a valid JSON array with no explanation, no markdown, no code fences:
[{"name":"Route Name","distance_rt_miles":22,"elev_gain_ft":6100,"class":"Class 1","description":"One sentence description."}]`,
          { maxTokens: 2048, tier: 'fast', feature: 'route-suggestions', userId: req.accountUser.id }
        );
        return parseJsonArrayFromAI(text);
      });
      return res.json(routes);
    } catch (err) {
      logger.error({ err }, 'route-suggestions error');
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/route-analysis
  // Body: { peak, route, lat, lon, date, start, travel_window_hours, units, waypoints?, route_metadata?, pace?, route_distance_rt_miles? }
  app.post('/api/route-analysis', async (req, res) => {
    const { peak, route, lat, lon, date, start, travel_window_hours, units, waypoints, route_metadata, pace, route_distance_rt_miles, route_shape, track } = req.body;
    if (!peak || !route || lat == null || lon == null || !date) {
      return res.status(400).json({ error: 'peak, route, lat, lon, and date are required' });
    }
    const safePeak = String(peak).slice(0, 200);
    const safeRoute = String(route).slice(0, 200);
    const safeLat = toFiniteOrNull(lat);
    const safeLon = toFiniteOrNull(lon);
    if (safeLat === null || safeLon === null) {
      return res.status(400).json({ error: 'lat and lon must be valid numbers' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD format' });
    }
    if (start && !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) {
      return res.status(400).json({ error: 'start must be HH:MM format (00:00–23:59)' });
    }
    let suppliedWaypoints;
    try {
      suppliedWaypoints = sanitizeSuppliedWaypoints(waypoints, safeLat, safeLon);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    const routeMetadata = suppliedWaypoints ? sanitizeRouteMetadata(route_metadata) : null;
    let suppliedTrack = null;
    try {
      suppliedTrack = suppliedWaypoints ? sanitizeSuppliedTrack(track) : null;
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    // How the traveler says the route runs past its objective; null leaves it to the route.
    const requestedShape = ROUTE_SHAPES.has(route_shape) ? route_shape : null;
    const userPace = sanitizeRoutePace(pace);
    // Round-trip length of a suggested route, used to scale checkpoint distances.
    const routeDistanceRtMiles = toFiniteOrNull(route_distance_rt_miles);
    const knownRouteDistanceRtMiles = routeDistanceRtMiles !== null && routeDistanceRtMiles > 0 && routeDistanceRtMiles <= 1000 ? routeDistanceRtMiles : null;
    try {
      ensureRouteAnalysisEnabled();
    } catch (error) {
      return res.status(error.statusCode || 503).json({ error: error.message || 'Route analysis is unavailable' });
    }
    if (suppliedWaypoints) {
      try {
        ensureGpxImportEnabled();
      } catch (error) {
        return res.status(error.statusCode || 503).json({ error: error.message || 'GPX import is unavailable' });
      }
    }
    if (!(await ensureAccountAccess(req, res))) return;
    let aiFeatureEnabled = true;
    try {
      ensureAIEnabled();
    } catch (error) {
      aiFeatureEnabled = false;
    }

    // A client that accepts NDJSON gets progress lines as the analysis runs, then
    // the result (or an error) as the last line. The stream starts once the route
    // is found, so a request that fails before then still gets a plain status.
    const streaming = String(req.headers?.accept || '').includes('application/x-ndjson');
    let streamStarted = false;
    const emit = (event) => {
      if (!streaming) return;
      if (!streamStarted) {
        streamStarted = true;
        res.status(200);
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        // no-transform keeps compression from buffering the progress lines.
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
      }
      res.write(`${JSON.stringify(event)}\n`);
    };

    try {
      // Step 1: Use authoritative GPX checkpoints when provided. For named routes,
      // mapped trail geometry (NPS, then OpenStreetMap) comes first when it reaches
      // the objective, with AI landmarks naming points along it. Otherwise the AI's
      // named landmarks are used, and mapped geometry is the fallback.
      let routeSource = 'generated';
      let routeSourceDetails = null;
      let routeGeometry = null;
      let waypointsCopy;
      let routeShape = 'out-and-back';
      // Where the objective sits among the checkpoints, when landmarks continue past it.
      let objectiveIndex = null;
      const locatedAtObjectiveByMistake = new Set();
      const generateLandmarks = () => {
        // Version the cache key so older generic "checkpoint 2" results are not
        // reused after tightening the waypoint-name contract.
        const wpCacheKey = `named-v3|${normalizeTextKey(safePeak)}|${normalizeTextKey(safeRoute)}|${normalizeCoordKey(safeLat, safeLon)}`;
        return waypointCache.getOrFetch(wpCacheKey, async () => {
          let lastError;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const waypointText = await withTimeout(askAI(
              `Return 4-5 real, named landmarks along the "${safeRoute}" on ${safePeak} near (${safeLat}, ${safeLon}).
Use the specific proper name of each trailhead, junction, camp, lake, pass, ridge feature, or summit that a traveler would recognize on a map. The objective's entry must use its proper name and have "objective": true. Never use generic labels such as "Checkpoint 2", "Waypoint 3", "route start", or "route objective". If the route does not have enough reliably named landmarks, return fewer entries rather than inventing names.
List them in travel order, starting at the trailhead. For an out-and-back route, end at the objective. For a loop, continue past the objective around the loop and end with the starting trailhead again. For a traverse that finishes somewhere else, continue past the objective to that finish.
Return ONLY a valid JSON array with no explanation, no markdown, no code fences:
[{"name":"Specific Place Name","lat":0.0,"lon":0.0,"elev_ft":0,"objective":false}]`,
              { maxTokens: 1024, tier: 'fast', feature: 'route-waypoints', userId: req.accountUser.id }
            ), 20000, 'Waypoint lookup');
            try {
              return sanitizeGeneratedWaypoints(parseJsonArrayFromAI(waypointText));
            } catch (error) {
              lastError = error;
            }
          }
          throw lastError;
        });
      };
      const useMappedRoute = (mapped) => {
        routeSource = mapped.source;
        routeSourceDetails = {
          sourceLabel: mapped.sourceLabel,
          matchedName: mapped.matchedName,
          matchScore: mapped.matchScore,
          metadata: mapped.metadata,
        };
        routeGeometry = Array.isArray(mapped.geometry) ? mapped.geometry : null;
        waypointsCopy = mapped.waypoints.map((waypoint) => ({ ...waypoint }));
        waypointsCopy[waypointsCopy.length - 1].name = safePeak;
      };
      if (suppliedWaypoints) {
        routeSource = 'gpx';
        waypointsCopy = suppliedWaypoints.map((waypoint) => ({ ...waypoint }));
      } else {
        // The mapped lookup and the AI landmarks don't depend on each other.
        const [mappedSettled, landmarksSettled] = await Promise.allSettled([
          mappedRouteCache.getOrFetch(
            `${normalizeTextKey(safePeak)}|${normalizeTextKey(safeRoute)}|${normalizeCoordKey(safeLat, safeLon)}`,
            () => routeDataService.resolveMappedRoute({ peak: safePeak, route: safeRoute, lat: safeLat, lon: safeLon }),
          ),
          aiFeatureEnabled ? generateLandmarks() : Promise.resolve(null),
        ]);
        const mappedRoute = mappedSettled.status === 'fulfilled' && mappedSettled.value?.waypoints?.length >= 2 ? mappedSettled.value : null;
        const generatedWaypoints = landmarksSettled.status === 'fulfilled' ? landmarksSettled.value : null;
        const mappedReachesObjective = mappedRoute && !(mappedRoute.gapKm > MAX_MAPPED_GAP_KM);
        if (mappedRoute && (mappedReachesObjective || !generatedWaypoints)) {
          useMappedRoute(mappedRoute);
          if (generatedWaypoints) {
            await nameMappedCheckpoints(waypointsCopy, generatedWaypoints, { safeLat, safeLon, safePeak, fetchWithTimeout, fetchHeaders });
          }
        } else if (generatedWaypoints) {
          // Clone so summit pinning doesn't mutate the cached array.
          waypointsCopy = generatedWaypoints.map(({ objective, ...wp }) => ({ ...wp }));
          const shape = classifyGeneratedRoute(generatedWaypoints);
          routeShape = shape.routeShape;
          objectiveIndex = shape.objectiveIndex;
          const summit = waypointsCopy[shape.objectiveIndex];
          summit.lat = safeLat;
          summit.lon = safeLon;
          // A loop ends where it began, so its last checkpoint takes the trailhead's place.
          const loopEnd = routeShape === 'loop' ? waypointsCopy[waypointsCopy.length - 1] : null;

          await Promise.all(
            waypointsCopy.filter((wp) => wp !== summit && wp !== loopEnd).map(async (wp) => {
              const geo = await geocodeWaypoint(wp.name, safeLat, safeLon, fetchWithTimeout, fetchHeaders);
              if (geo) {
                wp.lat = geo.lat;
                wp.lon = geo.lon;
                wp.geocodingVerified = true;
              } else {
                wp.geocodingVerified = false;
                // Unfound landmarks keep the AI's coordinates, which are sometimes
                // just the objective's, echoed from the prompt. A terrain lookup
                // there would give a trailhead the summit's elevation.
                if (haversineKm(wp.lat, wp.lon, safeLat, safeLon) < COPIED_OBJECTIVE_COORDINATE_KM) {
                  locatedAtObjectiveByMistake.add(wp);
                }
              }
            })
          );
          if (loopEnd) {
            const start = waypointsCopy[0];
            Object.assign(loopEnd, {
              name: `Return to ${start.name}`,
              lat: start.lat,
              lon: start.lon,
              geocodingVerified: start.geocodingVerified,
            });
            if (knownElevation(start.elev_ft) !== null) loopEnd.elev_ft = start.elev_ft;
            if (locatedAtObjectiveByMistake.has(start)) locatedAtObjectiveByMistake.add(loopEnd);
          }
        } else if (aiFeatureEnabled && landmarksSettled.status === 'rejected') {
          throw landmarksSettled.reason;
        } else {
          return res.status(503).json({
            error: 'AI waypoint generation is unavailable. Import a GPX route or enter a mapped trail name.',
          });
        }
      }

      emit({ type: 'stage', stage: 'locating', routeSource, checkpointCount: waypointsCopy.length });
      // GPX and mapped checkpoints without a landmark name take one from the map.
      if (routeSource !== 'generated') {
        await nameGenericCheckpoints(waypointsCopy, { fetchWithTimeout, fetchHeaders });
      }

      // Step 2: Estimate arrival times, then evaluate each checkpoint at its ETA
      // instead of applying the trailhead start time to every point on the route.
      // Fill missing elevations first so climbing and descent can weight timing.
      // AI-generated elevations are unverified and may not match the geocoded or
      // pinned coordinates, so a terrain lookup replaces them when it succeeds.
      const replaceElevations = routeSource === 'generated';
      if (typeof fetchElevationFt === 'function') {
        await Promise.all(waypointsCopy.map(async (wp) => {
          if (locatedAtObjectiveByMistake.has(wp)) return;
          if (!replaceElevations && knownElevation(wp.elev_ft) !== null) return;
          try {
            const { elevationFt } = await withTimeout(Promise.resolve(fetchElevationFt(wp.lat, wp.lon)), 10000, 'Checkpoint elevation') || {};
            if (Number.isFinite(elevationFt)) wp.elev_ft = Math.round(elevationFt);
          } catch (err) {
            logger.warn({ err }, 'Checkpoint elevation lookup failed');
          }
        }));
      }
      // Shape the outing. GPX tracks already cover it; a one-way track is retraced
      // when the traveler says it is an out-and-back. Named and mapped routes run
      // to the objective and, unless the landmarks already continue past it, are
      // retraced back down (out-and-back), closed back to the start (loop), or
      // left to finish there (one way).
      const naturalShape = routeSource === 'gpx'
        ? (routeMetadata?.routeShape === 'closed route' ? 'loop' : 'point-to-point')
        : routeShape;
      let effectiveShape = requestedShape ?? naturalShape;
      // Unknown way back from the objective: the loop's return can't be timed by pace.
      let returnPathUnknown = false;
      if (routeSource === 'gpx') {
        if (effectiveShape === 'out-and-back' && naturalShape === 'loop') effectiveShape = 'loop';
      } else if (effectiveShape !== naturalShape) {
        const objectiveAt = objectiveIndex ?? waypointsCopy.length - 1;
        // Drop landmarks past the objective when the chosen shape doesn't follow them.
        if (naturalShape !== 'out-and-back') waypointsCopy = waypointsCopy.slice(0, objectiveAt + 1);
        if (effectiveShape === 'loop') {
          waypointsCopy = appendLoopEnd(waypointsCopy);
          returnPathUnknown = true;
          if (locatedAtObjectiveByMistake.has(waypointsCopy[0])) locatedAtObjectiveByMistake.add(waypointsCopy[waypointsCopy.length - 1]);
        }
        objectiveIndex = objectiveAt;
      }
      routeShape = effectiveShape;
      const roundTrip = effectiveShape === 'out-and-back' && !(routeSource === 'gpx' && naturalShape !== 'point-to-point');
      const outboundWaypoints = waypointsCopy;
      if (objectiveIndex === null) objectiveIndex = outboundWaypoints.length - 1;
      let distanceBasis = null;
      if (roundTrip) {
        waypointsCopy = appendReturnCheckpoint(waypointsCopy);
        // Return checkpoints share their outbound twin's coordinates, mislocated or not.
        waypointsCopy.slice(outboundWaypoints.length).forEach((point, index) => {
          if (locatedAtObjectiveByMistake.has(outboundWaypoints[outboundWaypoints.length - 2 - index])) locatedAtObjectiveByMistake.add(point);
        });
      }
      if (routeSource !== 'gpx') {
        distanceBasis = assignRouteDistances(waypointsCopy, haversineKm, knownRouteDistanceRtMiles, {
          measuredAlongTrail: routeSource === 'nps' || routeSource === 'openstreetmap',
        });
        const progress = computeDistanceProgress(waypointsCopy, haversineKm);
        waypointsCopy.forEach((waypoint, index) => {
          if (progress) waypoint.progress_percent = progress[index];
          else delete waypoint.progress_percent;
        });
      } else if (roundTrip) {
        // A retraced GPX track: the return checkpoints continue its distances.
        assignRouteDistances(waypointsCopy, haversineKm, null, { measuredAlongTrail: true });
        const total = waypointsCopy[waypointsCopy.length - 1].distance_miles;
        waypointsCopy.forEach((waypoint) => {
          if (Number.isFinite(waypoint.distance_miles) && total > 0) waypoint.progress_percent = Math.round((waypoint.distance_miles / total) * 100);
        });
      }
      const routePace = userPace || DEFAULT_ROUTE_PACE;
      const { basis: timingBasis, fractions, movingMinutes: checkpointMovingMinutes } = computeCheckpointFractions(waypointsCopy, { haversineKm, pace: routePace });
      const travelWindowHours = Math.max(1, Math.min(24, Math.round(Number(travel_window_hours) || 12)));
      // Arrivals follow the traveler's own pace when the route's length is known:
      // a GPX track, a mapped trail, or a named route scaled to its listed length.
      // Otherwise they are spread across the planned duration.
      const gpxDistancesKnown = routeSource === 'gpx' && waypointsCopy.every((waypoint) => Number.isFinite(waypoint.distance_miles));
      const trackForTiming = suppliedTrack && gpxDistancesKnown ? (roundTrip ? mirrorTrack(suppliedTrack) : suppliedTrack) : null;
      const paceMode = Boolean(userPace) && !returnPathUnknown && (
        trackForTiming !== null
        || (timingBasis === 'distance-and-vert' && (gpxDistancesKnown || distanceBasis === 'along-trail' || distanceBasis === 'route-length'))
      );
      const stopMinutes = paceMode ? (userPace.stopBufferMinutes ?? 0) : 0;
      let estimatedMinutes = null;
      let checkpointSchedule;
      if (paceMode) {
        let movingOffsets;
        if (trackForTiming) {
          const timeline = buildTrackTimeline(trackForTiming, routePace);
          movingOffsets = waypointsCopy.map((waypoint) => minutesAtMiles(trackForTiming, timeline, waypoint.distance_miles));
        } else {
          movingOffsets = fractions.map((fraction) => fraction * checkpointMovingMinutes);
        }
        const moving = movingOffsets[movingOffsets.length - 1];
        // Stops are spread across the outing so it ends when the trip does.
        const scale = moving > 0 ? (moving + stopMinutes) / moving : 1;
        estimatedMinutes = Math.round(moving + stopMinutes);
        checkpointSchedule = buildCheckpointSchedule(waypointsCopy, date, start || '06:00', 24, null, movingOffsets.map((offset) => offset * scale));
      } else {
        checkpointSchedule = buildCheckpointSchedule(waypointsCopy, date, start || '06:00', travelWindowHours, fractions);
      }
      waypointsCopy.forEach((waypoint, index) => {
        waypoint.eta_date = checkpointSchedule[index].date;
        waypoint.eta_time = checkpointSchedule[index].time;
        waypoint.offset_minutes = checkpointSchedule[index].offsetMinutes;
      });
      emit({
        type: 'stage',
        stage: 'forecasts',
        checkpoints: waypointsCopy.map((wp) => ({ name: wp.name, etaTime: wp.eta_time, ...(wp.leg ? { leg: wp.leg } : {}) })),
      });
      const safetySettled = await Promise.allSettled(
        waypointsCopy.map((wp, index) =>
          withTimeout(Promise.resolve().then(() => invokeSafetyHandler(
            { lat: String(wp.lat), lon: String(wp.lon), date: checkpointSchedule[index].date, start: checkpointSchedule[index].time, travel_window_hours: '1', name: `Route waypoint: ${wp.name || 'unnamed'}` },
            { suppressReportLog: true },
          )), 60000, `Safety check for ${wp.name}`)
            .then((value) => {
              const weather = value?.statusCode === 200 ? value.payload?.weather : null;
              emit({ type: 'checkpoint', index, dataAvailable: Boolean(weather), ...(weather ? { weather: pick(weather, ['temp', 'windGust', 'precipChance', 'description']) } : {}) });
              return value;
            }, (error) => {
              emit({ type: 'checkpoint', index, dataAvailable: false });
              throw error;
            })
        )
      );

      // Step 3: Build a compact per-waypoint summary for the UI (waypoint list,
      // elevation/score chart) — this is a display concern, separate from what
      // gets fed to the AI below.
      const featureFlags = getProductFeatureFlags();
      const avalancheEnabled = featureFlags.avalancheDetails !== false;
      const summaries = waypointsCopy.map((wp, i) => {
        const settled = safetySettled[i];
        const dataAvailable = settled.status === 'fulfilled' && settled.value?.statusCode === 200 && Boolean(settled.value?.payload);
        const rawPayload = dataAvailable ? settled.value.payload : {};
        const p = sanitizeReportForFeatureFlags(rawPayload, featureFlags);
        // An unknown elevation stays null rather than becoming 0 ft.
        // The forecast there describes the objective, not a mislocated landmark.
        const forecastElevationFt = locatedAtObjectiveByMistake.has(wp) ? null : knownElevation(p.weather?.elevation);
        const resolvedElevationFt = knownElevation(wp.elev_ft) ?? (forecastElevationFt !== null ? Math.round(forecastElevationFt) : null);
        wp.elev_ft = resolvedElevationFt;
        const daylight = dataAvailable ? classifyDaylight(wp.eta_time, p.solar) : null;
        const avyRelevant = Boolean(p.avalanche && p.avalanche.relevant !== false);
        const snowDepthIn = p.snowpack?.snotel?.snowDepthIn ?? p.snowpack?.nohrsc?.snowDepthIn ?? null;
        const hasSnow = snowDepthIn != null && snowDepthIn > 0;
        return {
          name: wp.name,
          elev_ft: resolvedElevationFt,
          ...(wp.distance_miles != null ? { distance_miles: wp.distance_miles } : {}),
          ...(wp.progress_percent != null ? { progress_percent: wp.progress_percent } : {}),
          ...(wp.leg ? { leg: wp.leg } : {}),
          // A generated landmark the map search couldn't find keeps the AI's coordinates.
          ...(wp.geocodingVerified === false ? { locationEstimated: true } : {}),
          etaDate: wp.eta_date,
          etaTime: wp.eta_time,
          offsetMinutes: wp.offset_minutes,
          ...(daylight ? { daylight } : {}),
          dataAvailable,
          score: finiteNumber(p.safety?.score) ? p.safety.score : null,
          tier: p.safety?.tier ?? null,
          primaryHazard: p.safety?.primaryHazard ?? null,
          partialData: p.partialData === true,
          weather: pick(p.weather, ['temp', 'feelsLike', 'windSpeed', 'windGust', 'description', 'precipChance']),
          ...(avyRelevant ? { avalanche: pick(p.avalanche, ['risk', 'dangerLevel', 'bottomLine']) } : {}),
          activeAlerts: Array.isArray(p.alerts?.alerts) ? p.alerts.alerts.length : 0,
          ...(hasSnow ? { snowDepthIn } : {}),
        };
      });
      // Terrain sampling describes the mapped geometry once, not the retraced return.
      const terrainProfile = buildRouteTerrainProfile(outboundWaypoints, haversineKm);
      // With a way back, when to turn around at the objective to finish by the
      // plan's end, and by sunset where the route ends.
      let turnaround = null;
      if (paceMode && (roundTrip || routeShape === 'loop') && objectiveIndex < waypointsCopy.length - 1) {
        const objectiveOffset = waypointsCopy[objectiveIndex].offset_minutes;
        const returnMinutes = waypointsCopy[waypointsCopy.length - 1].offset_minutes - objectiveOffset;
        const finishSettled = safetySettled[waypointsCopy.length - 1];
        const sunset = parseClockToMinutes(finishSettled.status === 'fulfilled' ? finishSettled.value?.payload?.solar?.sunset : null);
        const [startHour, startMinute] = String(start || '06:00').split(':').map(Number);
        const startClock = startHour * 60 + startMinute;
        turnaround = {
          objectiveName: waypointsCopy[objectiveIndex].name,
          objectiveEta: waypointsCopy[objectiveIndex].eta_time,
          returnMinutes,
          byPlanEnd: clockAfter(start, travelWindowHours * 60 - returnMinutes),
          ...(sunset !== null ? { byDark: clockAfter('00:00', sunset - returnMinutes), sunset: clockAfter('00:00', sunset) } : {}),
          // Whether the objective is reached before those times, in minutes after the start.
          marginToPlanEndMinutes: travelWindowHours * 60 - returnMinutes - objectiveOffset,
          ...(sunset !== null ? { marginToDarkMinutes: sunset - startClock - returnMinutes - objectiveOffset } : {}),
        };
      }
      const timing = {
        basis: timingBasis,
        mode: paceMode ? 'pace' : 'window',
        roundTrip,
        // A GPX track's shape is only reported when known: closed, or set by the traveler.
        ...(routeSource !== 'gpx' || requestedShape || routeShape === 'loop' ? { routeShape } : {}),
        ...(requestedShape ? { shapeSource: 'traveler' } : {}),
        travelWindowHours,
        pace: routePace,
        paceSource: userPace ? 'user' : 'default',
        ...(distanceBasis ? { distanceBasis } : {}),
        ...(paceMode ? {
          stopMinutes,
          estimatedMinutes,
          windowFit: describeWindowFit(estimatedMinutes, travelWindowHours * 60),
        } : {}),
        ...(trackForTiming ? { trackTimed: true } : {}),
        ...(turnaround ? { turnaround } : {}),
      };

      // Step 4: Synthesize — feed the AI the raw safety report per waypoint (bounded),
      // the same raw-data approach used for the score card's AI analysis, instead of
      // pre-summarizing which signals matter.
      const rawWaypointReports = waypointsCopy.map((wp, i) => {
        const settled = safetySettled[i];
        const dataAvailable = settled.status === 'fulfilled' && settled.value?.statusCode === 200 && Boolean(settled.value?.payload);
        return {
          name: wp.name,
          elev_ft: wp.elev_ft,
          ...(wp.distance_miles != null ? { distance_miles: wp.distance_miles } : {}),
          ...(wp.progress_percent != null ? { progress_percent: wp.progress_percent } : {}),
          ...(wp.leg ? { leg: wp.leg } : {}),
          ...(summaries[i].daylight ? { arrivalDaylight: summaries[i].daylight } : {}),
          etaDate: wp.eta_date,
          etaTime: wp.eta_time,
          offsetMinutes: wp.offset_minutes,
          dataAvailable,
          report: dataAvailable ? compactReportForAI(sanitizeReportForFeatureFlags(settled.value.payload, featureFlags)) : null,
        };
      });
      const failedWaypointNames = rawWaypointReports.filter((r) => !r.dataAvailable).map((r) => r.name).filter(Boolean);
      const partialData = failedWaypointNames.length > 0 || summaries.some((summary) => summary.partialData);
      const reportsJson = serializeWaypointReports(rawWaypointReports);
      const disabledDomains = getDisabledScoreFeatureLabels(featureFlags);
      const disabledDomainInstruction = disabledDomains.length === 0
        ? ''
        : `\nDisabled product domains: ${disabledDomains.join(', ')}. Do not mention them, infer them, recommend domain-specific checks or gear, or refer the user to their sources.\n`;

      let analysisSource = 'deterministic';
      let generatedAnalysis = buildDeterministicRouteBriefing(summaries, failedWaypointNames, units, timing);
      if (aiFeatureEnabled && summaries.some((summary) => summary.dataAvailable)) {
        emit({ type: 'stage', stage: 'briefing' });
        try {
          const aiAnalysis = await withTimeout(askAI(
            `${describeUnitsInstruction(units)}

You are analyzing backcountry conditions for a trip on ${safePeak}.
Route: ${safeRoute}
Route source: ${routeSource === 'gpx'
          ? 'user-supplied GPX track with authoritative checkpoint coordinates'
          : routeSource === 'nps'
            ? 'National Park Service public trail geometry'
            : routeSource === 'openstreetmap'
              ? 'OpenStreetMap mapped trail geometry'
              : 'generated named-route waypoints'}
${routeSourceDetails ? `Mapped route match: ${JSON.stringify(routeSourceDetails)}` : ''}
${routeMetadata ? `Recorded GPX metadata: ${JSON.stringify(routeMetadata)}` : ''}
${terrainProfile ? `Sampled terrain profile: ${JSON.stringify(terrainProfile)}` : ''}
Date: ${date}${start ? `, Start time: ${start}` : ''}
Checkpoint timing: ${describeTiming(timing, featureFlags.daylightTimeline !== false)}
${failedWaypointNames.length ? `\nNo data is available for these waypoints: ${failedWaypointNames.join(', ')} (report is null below). Do not fabricate conditions for them — note the gap and reason from the waypoints that do have data.\n` : ''}
Safety report per waypoint in route travel order (JSON; reportCondensed and omittedReportFields identify abridged evidence, never assume omitted fields are clear):
${reportsJson}
${disabledDomainInstruction}

Turn the route data into a decision-ready field briefing rather than a compressed recap or raw-data inventory. Reference specific waypoint names, elevations, distances or progress, times, and actual values. Explain how and why conditions change along the route, how hazards may combine, and what the traveler should do with that information. Distinguish observed, forecast, modeled, and missing evidence when the reports provide that context. Do not assume pace or method of travel. Only discuss hazards present in the reports, and clearly note unavailable waypoint data. Never invent a terrain feature, route detail, timing threshold, or condition that is not supported by the supplied route metadata, terrain profile, or waypoint reports.

Return exactly these five labeled sections, each on its own line, with no other introduction or closing:
HAZARD ZONES: 3-5 sentences identifying where conditions materially change by named waypoint, elevation, distance, or progress and explaining the practical consequence of each change.
WEATHER WINDOW: 2-4 sentences explaining how conditions evolve across the selected travel window, the best-supported timing advantage, and the time-based signs that should trigger reassessment.
OTHER CONCERNS: 2-4 sentences covering only relevant secondary hazards such as ${avalancheEnabled ? 'avalanche conditions, ' : ''}terrain surface, freezing level, heat, fire, air quality, thunderstorms, or missing data, including interactions with the main hazard.
DECISION POINTS: 2-4 sentences naming specific checkpoints or condition thresholds where the traveler should pause, verify conditions, turn around, or choose lower-exposure terrain. If exact thresholds are unavailable, state what observable change matters instead of inventing a number.
BOTTOM LINE: 2-3 sentences stating go, go-with-caution, or no-go, identifying the decisive evidence, and explaining what new observation or forecast change would alter that conclusion. Never soften a NO-GO reported at any relevant waypoint.

Aim for a substantive 300-550 word briefing when the route evidence supports it. Do not pad sparse data, repeat the same point in multiple sections, or give generic backcountry advice that is unrelated to the reports.

Use plain, calm language that feels like advice from an experienced trip partner. Plain text only: no markdown, headings, bullets, numbered lists, "#" characters, or asterisks.`,
            { maxTokens: ROUTE_ANALYSIS_MAX_TOKENS, feature: 'route-analysis', userId: req.accountUser.id }
          ), 60000, 'Route synthesis');
          if (typeof aiAnalysis !== 'string' || !aiAnalysis.trim()) throw new Error('Empty route synthesis');
          generatedAnalysis = aiAnalysis;
          analysisSource = 'ai';
        } catch (err) {
          logger.warn({ err }, 'Route synthesis unavailable; returning checkpoint briefing');
        }
      }
      const analysis = removeDisabledNarrativeReferences(generatedAnalysis, featureFlags);

      const payload = {
        waypoints: waypointsCopy,
        summaries,
        analysis,
        analysisSource,
        featureFlags,
        partialData,
        routeSource,
        timing,
        ...(routeSourceDetails ? { routeSourceDetails } : {}),
        ...(routeGeometry ? { routeGeometry } : {}),
        ...(terrainProfile ? { terrainProfile } : {}),
        ...(routeMetadata ? { routeMetadata } : {}),
      };
      if (streamStarted) {
        emit({ type: 'result', payload });
        return res.end();
      }
      return res.json(payload);
    } catch (err) {
      logger.error({ err }, 'route-analysis error');
      const error = 'Failed to analyze route: ' + err.message;
      if (streamStarted) {
        emit({ type: 'error', status: 500, error });
        return res.end();
      }
      return res.status(500).json({ error });
    }
  });
};

module.exports = {
  ROUTE_ANALYSIS_MAX_TOKENS,
  buildCheckpointSchedule,
  buildDeterministicRouteBriefing,
  registerRouteAnalysisRoutes,
  withTimeout,
};
