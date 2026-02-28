const { point } = require('@turf/helpers');
const booleanPointInPolygon = require('@turf/boolean-point-in-polygon').default;
const { 
  AVALANCHE_MAP_LAYER_TTL_MS 
} = require('../server/runtime');
const { 
  resolveAvalancheCenterLink 
} = require('./avalanche-scraper');

let avalancheMapLayerCache = {
  fetchedAt: 0,
  data: null,
};

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

const getAvalancheMapLayer = async (fetchWithTimeout, fetchOptions, avyLog) => {
  const now = Date.now();
  if (avalancheMapLayerCache.data && now - avalancheMapLayerCache.fetchedAt < AVALANCHE_MAP_LAYER_TTL_MS) {
    return avalancheMapLayerCache.data;
  }

  try {
    const avyRes = await fetchWithTimeout(`https://api.avalanche.org/v2/public/products/map-layer`, fetchOptions);
    if (!avyRes.ok) {
      throw new Error(`Map layer fetch failed with status ${avyRes.status}`);
    }
    const avyJson = await avyRes.json();
    if (!avyJson || !Array.isArray(avyJson.features)) {
      throw new Error('Map layer response missing features array');
    }

    avalancheMapLayerCache = {
      fetchedAt: now,
      data: avyJson,
    };
    return avyJson;
  } catch (error) {
    if (avalancheMapLayerCache.data) {
      if (avyLog) avyLog(`[Avy] map-layer refresh failed, serving cached copy: ${error.message}`);
      return avalancheMapLayerCache.data;
    }
    throw error;
  }
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

module.exports = {
  haversineKm,
  getAvalancheMapLayer,
  findMatchingAvalancheZone,
};
