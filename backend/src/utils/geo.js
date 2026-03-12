const { point } = require('@turf/helpers');
const booleanPointInPolygon = require('@turf/boolean-point-in-polygon').default;
const { createFetchWithTimeout } = require('./http-client');
const { createCache, normalizeCoordKey } = require('./cache');
const { logger } = require('./logger');

const FT_PER_METER = 3.28084;
const MAX_REASONABLE_ELEVATION_FT = 20000;

const toRadians = (value) => (value * Math.PI) / 180;

const haversineKm = (latA, lonA, latB, lonB) => {
  const earthRadiusKm = 6371;
  const dLat = toRadians(latB - latA);
  const dLon = toRadians(lonB - lonA);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
};

const formatIsoDateUtc = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
};

const shiftIsoDateUtc = (isoDate, deltaDays) => {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return null;
  }
  const base = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) {
    return null;
  }
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return formatIsoDateUtc(base);
};

const collectGeometryPositions = (geometry, output = []) => {
  if (!geometry || !geometry.coordinates) {
    return output;
  }
  const walk = (node) => {
    if (!Array.isArray(node)) {
      return;
    }
    if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
      output.push(node);
      return;
    }
    for (const child of node) {
      walk(child);
    }
  };
  walk(geometry.coordinates);
  return output;
};

const minDistanceKmToFeatureVertices = (feature, lat, lon) => {
  const positions = collectGeometryPositions(feature?.geometry);
  if (!positions.length) {
    return Number.POSITIVE_INFINITY;
  }
  let minDistance = Number.POSITIVE_INFINITY;
  for (const [featureLon, featureLat] of positions) {
    const distanceKm = haversineKm(lat, lon, featureLat, featureLon);
    if (distanceKm < minDistance) {
      minDistance = distanceKm;
    }
  }
  return minDistance;
};

const isWithinUtahBounds = (lat, lon) =>
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  lat >= 36.8 &&
  lat <= 42.3 &&
  lon >= -114.2 &&
  lon <= -108.8;

const findMatchingAvalancheZone = (features, lat, lon, maxFallbackDistanceKm = 40) => {
  if (!Array.isArray(features) || !features.length || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { feature: null, mode: 'none', fallbackDistanceKm: null };
  }

  const pt = point([lon, lat]);
  for (const feature of features) {
    try {
      if (booleanPointInPolygon(pt, feature)) {
        return { feature, mode: 'polygon', fallbackDistanceKm: 0 };
      }
    } catch {
      // Ignore invalid polygon payloads and continue.
    }
  }

  let nearestFeature = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const feature of features) {
    const distanceKm = minDistanceKmToFeatureVertices(feature, lat, lon);
    if (distanceKm < nearestDistance) {
      nearestDistance = distanceKm;
      nearestFeature = feature;
    }
  }

  if (nearestFeature && nearestDistance <= maxFallbackDistanceKm) {
    return { feature: nearestFeature, mode: 'nearest', fallbackDistanceKm: nearestDistance };
  }

  // Utah polygons in the map layer can miss high-Uinta objective points by a wide margin.
  // If a point is clearly in Utah and standard fallback fails, allow a larger UAC-only nearest-zone fallback.
  if (isWithinUtahBounds(lat, lon)) {
    let nearestUacFeature = null;
    let nearestUacDistance = Number.POSITIVE_INFINITY;
    for (const feature of features) {
      if (String(feature?.properties?.center_id || '').toUpperCase() !== 'UAC') {
        continue;
      }
      const distanceKm = minDistanceKmToFeatureVertices(feature, lat, lon);
      if (distanceKm < nearestUacDistance) {
        nearestUacDistance = distanceKm;
        nearestUacFeature = feature;
      }
    }
    const utahFallbackDistanceKm = Math.max(maxFallbackDistanceKm, 90);
    if (nearestUacFeature && nearestUacDistance <= utahFallbackDistanceKm) {
      return { feature: nearestUacFeature, mode: 'nearest', fallbackDistanceKm: nearestUacDistance };
    }
  }

  return { feature: null, mode: 'none', fallbackDistanceKm: nearestDistance };
};

const createElevationService = ({ fetchWithTimeout, requestTimeoutMs }) => {
  const elevationCache = createCache({ name: 'elevation', ttlMs: 7 * 24 * 60 * 60 * 1000, staleTtlMs: 23 * 24 * 60 * 60 * 1000, maxEntries: 500 });

  const _fetchObjectiveElevationFtUncached = async (lat, lon, fetchOptions) => {
    try {
      const usgsRes = await fetchWithTimeout(
        `https://epqs.nationalmap.gov/v1/json?x=${lon}&y=${lat}&units=Feet&wkid=4326`,
        fetchOptions,
      );
      if (usgsRes.ok) {
        const usgsData = await usgsRes.json();
        const usgsElevationFt = Number(usgsData?.value);
        if (Number.isFinite(usgsElevationFt) && usgsElevationFt > -1000 && usgsElevationFt <= MAX_REASONABLE_ELEVATION_FT) {
          return { elevationFt: Math.round(usgsElevationFt), source: 'USGS 3DEP elevation service' };
        }
      }
    } catch (error) {
      logger.warn({ err: error }, 'Elevation USGS lookup failed');
    }

    try {
      const openMeteoRes = await fetchWithTimeout(
        `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`,
        fetchOptions,
      );
      if (openMeteoRes.ok) {
        const openMeteoData = await openMeteoRes.json();
        const elevationMeters = Number(openMeteoData?.elevation?.[0]);
        const elevationFt = Number.isFinite(elevationMeters) ? Math.round(elevationMeters * FT_PER_METER) : null;
        if (Number.isFinite(elevationFt) && elevationFt > -1000 && elevationFt <= MAX_REASONABLE_ELEVATION_FT) {
          return { elevationFt, source: 'Open-Meteo elevation API' };
        }
      }
    } catch (error) {
      logger.warn({ err: error }, 'Elevation Open-Meteo lookup failed');
    }

    return { elevationFt: null, source: null };
  };

  const fetchObjectiveElevationFt = (lat, lon, fetchOptions) => {
    const key = normalizeCoordKey(lat, lon);
    return elevationCache.getOrFetch(key, () => _fetchObjectiveElevationFtUncached(lat, lon, fetchOptions));
  };

  return { elevationCache, fetchObjectiveElevationFt };
};

module.exports = {
  FT_PER_METER,
  MAX_REASONABLE_ELEVATION_FT,
  toRadians,
  haversineKm,
  formatIsoDateUtc,
  shiftIsoDateUtc,
  collectGeometryPositions,
  minDistanceKmToFeatureVertices,
  isWithinUtahBounds,
  findMatchingAvalancheZone,
  createElevationService,
};
