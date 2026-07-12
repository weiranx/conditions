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

const samplePointObjects = (coordinates, maxPoints = 8) => {
  if (coordinates.length <= maxPoints) return coordinates;
  return Array.from({ length: maxPoints }, (_, index) => coordinates[Math.round((index * (coordinates.length - 1)) / (maxPoints - 1))]);
};

const flattenArcGisPaths = (geometry) => {
  const paths = Array.isArray(geometry?.paths) ? geometry.paths : [];
  return paths.reduce((longest, path) => (Array.isArray(path) && path.length > longest.length ? path : longest), []);
};

const ensureObjectiveLast = (coordinates, objectiveLat, objectiveLon, haversineKm) => {
  const result = [...coordinates];
  if (!result.length) return result;
  const firstDistance = haversineKm(result[0].lat, result[0].lon, objectiveLat, objectiveLon);
  const lastDistance = haversineKm(result[result.length - 1].lat, result[result.length - 1].lon, objectiveLat, objectiveLon);
  if (firstDistance < lastDistance) result.reverse();
  const endpoint = result[result.length - 1];
  if (haversineKm(endpoint.lat, endpoint.lon, objectiveLat, objectiveLon) > 0.75) {
    result.push({ lat: objectiveLat, lon: objectiveLon });
  } else {
    result[result.length - 1] = { lat: objectiveLat, lon: objectiveLon };
  }
  return samplePointObjects(result, 8);
};

const toWaypoints = ({ coordinates, name, source }) => coordinates.map((coordinate, index) => ({
  name: index === 0
    ? `${name} start`
    : index === coordinates.length - 1
      ? `${name} objective`
      : `${name} checkpoint ${index + 1}`,
  lat: coordinate.lat,
  lon: coordinate.lon,
  progress_percent: Math.round((index / Math.max(1, coordinates.length - 1)) * 100),
  source,
}));

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
    const raw = flattenArcGisPaths(best.feature?.geometry);
    const sampled = sampleCoordinates(raw, 8);
    if (sampled.length < 2) return null;
    const ordered = ensureObjectiveLast(sampled, lat, lon, haversineKm);
    return {
      source: 'nps',
      sourceLabel: 'National Park Service public trail geometry',
      matchedName: best.candidateName,
      matchScore: best.score,
      metadata: best.feature?.attributes || {},
      waypoints: toWaypoints({ coordinates: ordered, name: best.candidateName || route, source: 'nps' }),
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
    const coordinates = best.element.geometry.map((point) => ({ lat: Number(point?.lat), lon: Number(point?.lon) }));
    const sampled = sampleCoordinates(coordinates.map((point) => [point.lon, point.lat]), 8);
    if (sampled.length < 2) return null;
    const ordered = ensureObjectiveLast(sampled, lat, lon, haversineKm);
    return {
      source: 'openstreetmap',
      sourceLabel: 'OpenStreetMap mapped trail geometry',
      matchedName: best.candidateName,
      matchScore: best.score,
      metadata: best.element?.tags || {},
      waypoints: toWaypoints({ coordinates: ordered, name: best.candidateName || route, source: 'openstreetmap' }),
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
    const previousElevation = Number(previous?.elev_ft);
    const currentElevation = Number(current?.elev_ft);
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
  buildRouteTerrainProfile,
  nameScore,
  sampleCoordinates,
};
