'use strict';

const NPS_TRAILS_URL = 'https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Trails_Geographic/FeatureServer/0';
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const normalizeName = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const GENERIC_ROUTE_TOKENS = new Set(['trail', 'route', 'path', 'track', 'road', 'mount', 'mountain']);

const tokens = (value) => normalizeName(value).split(/\s+/)
  .filter((token) => token.length >= 3 && !GENERIC_ROUTE_TOKENS.has(token));

const nameScore = (candidate, requestedRoute, peak) => {
  const candidateName = normalizeName(candidate);
  if (!candidateName) return 0;
  const routeName = normalizeName(requestedRoute);
  if (routeName && candidateName === routeName) return 100;
  let score = routeName && (candidateName.includes(routeName) || routeName.includes(candidateName)) ? 60 : 0;
  const routeTokens = tokens(requestedRoute);
  const peakTokens = tokens(peak);
  score += routeTokens.filter((token) => candidateName.includes(token)).length * 12;
  score += peakTokens.filter((token) => candidateName.includes(token)).length * 4;
  return score;
};

const sampleCoordinates = (coordinates, maxPoints = 8) => {
  const valid = (Array.isArray(coordinates) ? coordinates : [])
    .map((coordinate) => ({ lon: Number(coordinate?.[0]), lat: Number(coordinate?.[1]) }))
    .filter((coordinate) => Number.isFinite(coordinate.lat) && Number.isFinite(coordinate.lon));
  if (valid.length <= maxPoints) return valid;
  return Array.from({ length: maxPoints }, (_, index) => valid[Math.round((index * (valid.length - 1)) / (maxPoints - 1))]);
};

const MILES_PER_KM = 0.621371;
// Trail segments whose ends are this close are treated as one continuous trail.
const JOIN_KM = 0.05;
// Checkpoints taken along a mapped trail, the start and the objective included.
const MAPPED_CHECKPOINT_COUNT = 6;
// Points kept of the mapped line for drawing the route on a map.
const MAX_GEOMETRY_POINTS = 200;

const toPoints = (coordinates) => (Array.isArray(coordinates) ? coordinates : [])
  .map((coordinate) => (Array.isArray(coordinate)
    ? { lon: Number(coordinate[0]), lat: Number(coordinate[1]) }
    : { lat: Number(coordinate?.lat), lon: Number(coordinate?.lon) }))
  .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));

/**
 * Join trail pieces end to end into one line, starting from `first`. Mapped
 * trails are often split into many ways or paths; any piece with an end within
 * JOIN_KM of the line's start or end is added, reversed when needed.
 */
const stitchLines = (first, others, haversineKm) => {
  let line = [...first];
  const remaining = others.filter((piece) => piece !== first && piece.length >= 2);
  const near = (a, b) => haversineKm(a.lat, a.lon, b.lat, b.lon) <= JOIN_KM;
  let joined = true;
  while (joined && remaining.length) {
    joined = false;
    for (let index = 0; index < remaining.length; index += 1) {
      const piece = remaining[index];
      const head = line[0];
      const tail = line[line.length - 1];
      if (near(tail, piece[0])) line = [...line, ...piece.slice(1)];
      else if (near(tail, piece[piece.length - 1])) line = [...line, ...[...piece].reverse().slice(1)];
      else if (near(head, piece[piece.length - 1])) line = [...piece.slice(0, -1), ...line];
      else if (near(head, piece[0])) line = [...[...piece].reverse().slice(0, -1), ...line];
      else continue;
      remaining.splice(index, 1);
      joined = true;
      break;
    }
  }
  return line;
};

const cumulativeKm = (points, haversineKm) => points.reduce((totals, point, index) => {
  totals.push(index === 0 ? 0 : totals[index - 1] + haversineKm(points[index - 1].lat, points[index - 1].lon, point.lat, point.lon));
  return totals;
}, []);

/**
 * Run a mapped line from its trailhead to the objective. The point nearest the
 * objective ends the approach; when the trail carries on past it, the longer side
 * is taken as the approach. The objective itself is added when the trail stops
 * short of it. Also returns how far the trail comes from the objective.
 */
const orientToObjective = (points, objectiveLat, objectiveLon, haversineKm) => {
  if (points.length < 2) return { points, gapKm: Infinity };
  const distances = points.map((point) => haversineKm(point.lat, point.lon, objectiveLat, objectiveLon));
  const nearest = distances.indexOf(Math.min(...distances));
  const before = points.slice(0, nearest + 1);
  const after = points.slice(nearest).reverse();
  const length = (line) => cumulativeKm(line, haversineKm).at(-1) || 0;
  const approach = length(before) >= length(after) ? before : after;
  const gapKm = distances[nearest];
  const oriented = gapKm > 0.1 ? [...approach, { lat: objectiveLat, lon: objectiveLon }] : [...approach.slice(0, -1), { lat: objectiveLat, lon: objectiveLon }];
  return { points: oriented.length >= 2 ? oriented : [approach[0], { lat: objectiveLat, lon: objectiveLon }], gapKm };
};

/** Indexes of points at even distances along a line, both ends included. */
const evenDistanceIndexes = (cumulative, count) => {
  const total = cumulative[cumulative.length - 1];
  if (cumulative.length <= count || !(total > 0)) return cumulative.map((_, index) => index);
  const picked = [0];
  for (let slot = 1; slot < count - 1; slot += 1) {
    const target = (total * slot) / (count - 1);
    let best = picked[picked.length - 1] + 1;
    for (let index = best; index < cumulative.length - (count - slot); index += 1) {
      if (Math.abs(cumulative[index] - target) < Math.abs(cumulative[best] - target)) best = index;
    }
    picked.push(best);
  }
  picked.push(cumulative.length - 1);
  return picked;
};

/**
 * Checkpoints along a mapped trail, with each one's distance measured along the
 * trail itself rather than in straight lines between checkpoints, plus a thinned
 * copy of the line for drawing it.
 */
const buildMappedRoute = ({ line, name, source, objectiveLat, objectiveLon, haversineKm }) => {
  const { points, gapKm } = orientToObjective(line, objectiveLat, objectiveLon, haversineKm);
  const cumulative = cumulativeKm(points, haversineKm);
  const totalKm = cumulative[cumulative.length - 1];
  const indexes = evenDistanceIndexes(cumulative, MAPPED_CHECKPOINT_COUNT);
  const stride = Math.max(1, Math.ceil(points.length / MAX_GEOMETRY_POINTS));
  const geometry = points
    .map((point, index) => ({ lat: Number(point.lat.toFixed(6)), lon: Number(point.lon.toFixed(6)), distance_miles: Number((cumulative[index] * MILES_PER_KM).toFixed(2)) }))
    .filter((_, index) => index % stride === 0 || index === points.length - 1);
  return {
    gapKm,
    lengthMiles: Number((totalKm * MILES_PER_KM).toFixed(2)),
    geometry,
    waypoints: indexes.map((pointIndex, index) => ({
      name: index === 0
        ? `${name} start`
        : index === indexes.length - 1
          ? `${name} objective`
          : `${name} checkpoint ${index + 1}`,
      lat: points[pointIndex].lat,
      lon: points[pointIndex].lon,
      distance_miles: Number((cumulative[pointIndex] * MILES_PER_KM).toFixed(2)),
      progress_percent: totalKm > 0 ? Math.round((cumulative[pointIndex] / totalKm) * 100) : Math.round((index / Math.max(1, indexes.length - 1)) * 100),
      source,
    })),
  };
};

const createRouteDataService = ({ fetchWithTimeout, fetchHeaders = {}, haversineKm, requestTimeoutMs = 15000 } = {}) => {
  const fetchNpsRoute = async ({ route, peak, lat, lon }) => {
    const params = new URLSearchParams({
      f: 'json',
      geometry: `${lon},${lat}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      outSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      distance: '20',
      units: 'esriSRUnit_Kilometer',
      outFields: 'TRLNAME,TRLALTNAME,MAPLABEL,TRLSTATUS,TRLSURFACE,TRLCLASS,UNITCODE,UNITNAME,SEASONAL,SEASDESC,EDITDATE',
      returnGeometry: 'true',
      resultRecordCount: '200',
    });
    const response = await fetchWithTimeout(`${NPS_TRAILS_URL}/query?${params.toString()}`, { headers: fetchHeaders }, requestTimeoutMs);
    if (!response.ok) return null;
    const payload = await response.json();
    const candidates = (payload?.features || []).map((feature) => {
      const attributes = feature?.attributes || {};
      const candidateName = attributes.TRLNAME || attributes.TRLALTNAME || attributes.MAPLABEL || '';
      return { feature, candidateName, score: nameScore(candidateName, route, peak) };
    }).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best || (normalizeName(route) && best.score < 12)) return null;
    // Every piece of the same named trail, joined onto the best match's longest path.
    const sameName = candidates.filter((candidate) => normalizeName(candidate.candidateName) === normalizeName(best.candidateName));
    const piecesOf = (candidate) => (Array.isArray(candidate.feature?.geometry?.paths) ? candidate.feature.geometry.paths : []).map(toPoints);
    const bestPieces = piecesOf(best);
    const pieces = [...bestPieces, ...sameName.filter((candidate) => candidate !== best).flatMap(piecesOf)];
    const first = bestPieces.reduce((longest, piece) => (piece.length > longest.length ? piece : longest), []);
    if (first.length < 2) return null;
    const mapped = buildMappedRoute({ line: stitchLines(first, pieces, haversineKm), name: best.candidateName || route, source: 'nps', objectiveLat: lat, objectiveLon: lon, haversineKm });
    return {
      source: 'nps',
      sourceLabel: 'National Park Service public trail geometry',
      matchedName: best.candidateName,
      matchScore: best.score,
      metadata: best.feature?.attributes || {},
      ...mapped,
    };
  };

  const fetchOsmRoute = async ({ route, peak, lat, lon }) => {
    const queryToken = [...tokens(route), ...tokens(peak)].sort((a, b) => b.length - a.length)[0];
    if (!queryToken) return null;
    const safeToken = queryToken.replace(/[\\"\[\](){}.*+?^$|]/g, '\\$&');
    const query = `[out:json][timeout:18];way(around:20000,${lat},${lon})["highway"~"^(path|footway|track)$"]["name"~"${safeToken}",i];out tags geom;`;
    let payload = null;
    for (const endpoint of OVERPASS_URLS) {
      try {
        const response = await fetchWithTimeout(endpoint, {
          method: 'POST',
          headers: { ...fetchHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ data: query }).toString(),
        }, requestTimeoutMs);
        if (!response.ok) continue;
        payload = await response.json();
        break;
      } catch {
        payload = null;
      }
    }
    const candidates = (payload?.elements || []).map((element) => ({
      element,
      candidateName: element?.tags?.name || '',
      score: nameScore(element?.tags?.name, route, peak),
    })).filter((candidate) => candidate.score > 0 && Array.isArray(candidate.element?.geometry))
      .sort((a, b) => b.score - a.score || b.element.geometry.length - a.element.geometry.length);
    const best = candidates[0];
    if (!best || (normalizeName(route) && best.score < 12)) return null;
    // OpenStreetMap splits a trail into many ways; join those sharing its name.
    const sameName = candidates.filter((candidate) => normalizeName(candidate.candidateName) === normalizeName(best.candidateName));
    const pieces = sameName.map((candidate) => toPoints(candidate.element.geometry));
    const first = pieces[sameName.indexOf(best)];
    if (first.length < 2) return null;
    const mapped = buildMappedRoute({ line: stitchLines(first, pieces, haversineKm), name: best.candidateName || route, source: 'openstreetmap', objectiveLat: lat, objectiveLon: lon, haversineKm });
    return {
      source: 'openstreetmap',
      sourceLabel: 'OpenStreetMap mapped trail geometry',
      matchedName: best.candidateName,
      matchScore: best.score,
      metadata: best.element?.tags || {},
      ...mapped,
    };
  };

  const resolveMappedRoute = async (input) => {
    try {
      const nps = await fetchNpsRoute(input);
      if (nps) return nps;
    } catch {
      // Continue to the community trail fallback.
    }
    try {
      return await fetchOsmRoute(input);
    } catch {
      return null;
    }
  };

  return { resolveMappedRoute, fetchNpsRoute, fetchOsmRoute };
};

const bearingDegrees = (from, to) => {
  const toRad = (value) => (value * Math.PI) / 180;
  const toDeg = (value) => (value * 180) / Math.PI;
  const lat1 = toRad(Number(from?.lat));
  const lat2 = toRad(Number(to?.lat));
  const deltaLon = toRad(Number(to?.lon) - Number(from?.lon));
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

const cardinal = (bearing) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(bearing / 45) % 8];

const buildRouteTerrainProfile = (waypoints, haversineKm) => {
  const points = (Array.isArray(waypoints) ? waypoints : []).filter((point) => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lon)));
  if (points.length < 2) return null;
  let distanceKm = 0;
  let elevationGainFt = 0;
  let maxGradePct = null;
  const aspects = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const segmentKm = haversineKm(previous.lat, previous.lon, current.lat, current.lon);
    distanceKm += segmentKm;
    aspects.push(cardinal(bearingDegrees(previous, current)));
    // Number(null) is 0, so an unknown elevation must not become sea level.
    const previousElevation = previous?.elev_ft == null ? NaN : Number(previous.elev_ft);
    const currentElevation = current?.elev_ft == null ? NaN : Number(current.elev_ft);
    if (Number.isFinite(previousElevation) && Number.isFinite(currentElevation) && segmentKm > 0.03) {
      const deltaFt = currentElevation - previousElevation;
      if (deltaFt > 0) elevationGainFt += deltaFt;
      const grade = Math.abs(deltaFt) / (segmentKm * 3280.84) * 100;
      maxGradePct = maxGradePct === null ? grade : Math.max(maxGradePct, grade);
    }
  }
  const aspectCounts = aspects.reduce((counts, aspect) => ({ ...counts, [aspect]: (counts[aspect] || 0) + 1 }), {});
  return {
    sampledPointCount: points.length,
    sampledDistanceMiles: Math.round(distanceKm * 0.621371 * 100) / 100,
    sampledElevationGainFt: Math.round(elevationGainFt),
    maxSampledGradePct: maxGradePct === null ? null : Math.round(maxGradePct),
    dominantTravelAspects: Object.entries(aspectCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([aspect]) => aspect),
    note: 'Derived from sampled route geometry and waypoint elevations; this is not a substitute for a detailed slope-angle map.',
  };
};

module.exports = {
  createRouteDataService,
  buildMappedRoute,
  buildRouteTerrainProfile,
  nameScore,
  sampleCoordinates,
  stitchLines,
};
