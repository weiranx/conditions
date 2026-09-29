const { createCache } = require('./cache');
const { haversineKm } = require('./geo');

const reverseCache = createCache({ name: 'nominatim-reverse', ttlMs: 24 * 60 * 60 * 1000, staleTtlMs: 6 * 24 * 60 * 60 * 1000, maxEntries: 500 });
const featureCache = createCache({ name: 'gnis-nearby-feature', ttlMs: 7 * 24 * 60 * 60 * 1000, staleTtlMs: 7 * 24 * 60 * 60 * 1000, maxEntries: 500 });

// Map features whose names mean something on the ground; roads and admin areas don't.
const NAMEABLE_CATEGORIES = new Set(['natural', 'tourism', 'leisure', 'waterway', 'water', 'mountain_pass', 'amenity', 'place']);
// Close enough to be the feature itself, or close enough to say "near" it.
const EXACT_PLACE_KM = 0.1;
const NEARBY_PLACE_KM = 0.4;
// A catalog summit this close is what someone meant by a pin on its top.
const CATALOG_PEAK_KM = 0.4;
// Farther out, a landmark still says where a point is: "Near Sluiskin Mountain".
const LANDMARK_KM = 3;
const CATALOG_LANDMARK_KM = 10;
// USGS place names (GNIS): layer 5 holds landforms (summits, gaps, ridges,
// glaciers), layer 7 lakes, springs and other water. Fast and US-wide.
const GNIS_LAYERS_URL = 'https://carto.nationalmap.gov/arcgis/rest/services/geonames/MapServer';
const GNIS_LAYERS = [5, 7];
const GNIS_TIMEOUT_MS = 5000;
// Settlements, smallest first: the nearest one a point is described by.
const LOCALITY_KEYS = ['hamlet', 'village', 'town', 'city', 'municipality'];

const coordKey = (lat, lon) => `${Number(lat).toFixed(4)}|${Number(lon).toFixed(4)}`;

// Nominatim's reverse answer for a point (cached), or null.
const reverseLookup = (lat, lon, fetchWithTimeout, fetchHeaders) => reverseCache.getOrFetch(
  `reverse|${coordKey(lat, lon)}`,
  async () => {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${lat}&lon=${lon}`;
    const res = await fetchWithTimeout(url, { headers: fetchHeaders });
    if (!res?.ok) return null;
    return res.json();
  },
).catch(() => null);

const featureAt = (place, lat, lon) => {
  const name = String(place?.name || '').trim().slice(0, 80);
  if (!name || !NAMEABLE_CATEGORIES.has(String(place?.category || ''))) return null;
  const km = haversineKm(lat, lon, Number(place.lat), Number(place.lon));
  return Number.isFinite(km) && km <= NEARBY_PLACE_KM ? { name, km } : null;
};

// The named map feature at a point, or null.
const reverseGeocodePlace = async (lat, lon, fetchWithTimeout, fetchHeaders) =>
  featureAt(await reverseLookup(lat, lon, fetchWithTimeout, fetchHeaders), lat, lon);

/** The feature's own name when the point is on it, else "Near <feature>". */
const placeLabel = (place) => (place.km <= EXACT_PLACE_KM ? place.name : `Near ${place.name}`);

const nearestCatalogPeak = (peaks, lat, lon, maxKm) => {
  let best = null;
  for (const peak of peaks || []) {
    const km = haversineKm(lat, lon, Number(peak.lat), Number(peak.lon));
    if (Number.isFinite(km) && km <= maxKm && (!best || km < best.km)) {
      best = { name: String(peak.name).split(',')[0].trim(), km };
    }
  }
  return best;
};

/**
 * The nearest named summit, gap, ridge, glacier, lake or spring within
 * LANDMARK_KM, from USGS place names (cached). Null on any failure; the
 * caller falls back to a town or the county.
 */
const nearestLandmark = (lat, lon, fetchWithTimeout, fetchHeaders) => featureCache.getOrFetch(
  `landmark|${coordKey(lat, lon)}`,
  async () => {
    const params = new URLSearchParams({
      geometry: `${lon},${lat}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      distance: String(LANDMARK_KM * 1000),
      units: 'esriSRUnit_Meter',
      outFields: 'gaz_name',
      returnGeometry: 'true',
      outSR: '4326',
      f: 'json',
    });
    const answers = await Promise.all(GNIS_LAYERS.map(async (layer) => {
      try {
        const res = await fetchWithTimeout(`${GNIS_LAYERS_URL}/${layer}/query?${params.toString()}`, { headers: fetchHeaders }, GNIS_TIMEOUT_MS);
        return res?.ok ? await res.json() : null;
      } catch {
        return null;
      }
    }));
    let best = null;
    for (const feature of answers.flatMap((answer) => answer?.features || [])) {
      const name = String(feature?.attributes?.gaz_name || '').trim().slice(0, 80);
      const geometry = feature?.geometry || {};
      // Features come as points, or as several points for a long one (a ridge, a lake's ends).
      const points = Array.isArray(geometry.points) ? geometry.points : [[geometry.x, geometry.y]];
      for (const [pLon, pLat] of points) {
        const km = haversineKm(lat, lon, Number(pLat), Number(pLon));
        if (name && Number.isFinite(km) && (!best || km < best.km)) best = { name, km };
      }
    }
    return best;
  },
).catch(() => null);

/** "Near Packwood", or "Pierce County backcountry" where there is no town. */
const areaLabel = (place) => {
  const address = place?.address || {};
  const locality = LOCALITY_KEYS.map((key) => address[key]).find((value) => typeof value === 'string' && value.trim());
  if (locality) return `Near ${locality.trim().slice(0, 60)}`;
  const county = typeof address.county === 'string' ? address.county.trim() : '';
  return county ? `${county.slice(0, 60)} backcountry` : null;
};

/**
 * What is at a point someone chose on the map: a name to call it by and its
 * ground elevation. The name is the most specific one found: a catalog summit,
 * the named feature on the point, the nearest named landmark, a catalog summit
 * nearby, then the nearest town or the county. Either field can be null.
 */
const describePoint = async ({ lat, lon, peaks, fetchWithTimeout, fetchHeaders, fetchElevationFt }) => {
  const [place, elevation] = await Promise.all([
    reverseLookup(lat, lon, fetchWithTimeout, fetchHeaders),
    fetchElevationFt ? Promise.resolve(fetchElevationFt(lat, lon)).catch(() => null) : null,
  ]);
  const summit = nearestCatalogPeak(peaks, lat, lon, CATALOG_PEAK_KM);
  const feature = featureAt(place, lat, lon);
  let name = summit ? summit.name : feature ? placeLabel(feature) : null;
  if (!name) {
    const landmark = await nearestLandmark(lat, lon, fetchWithTimeout, fetchHeaders);
    const nearbySummit = nearestCatalogPeak(peaks, lat, lon, CATALOG_LANDMARK_KM);
    const closest = [landmark, nearbySummit].filter(Boolean).sort((a, b) => a.km - b.km)[0];
    name = closest ? placeLabel(closest) : areaLabel(place);
  }
  const elevationFt = Number(elevation?.elevationFt);
  return {
    name,
    elevationFt: Number.isFinite(elevationFt) ? Math.round(elevationFt) : null,
  };
};

module.exports = {
  EXACT_PLACE_KM,
  NEARBY_PLACE_KM,
  describePoint,
  reverseGeocodePlace,
};
