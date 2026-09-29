// A photo for a place: a catalog peak's own, else one of the region (national forest or
// park) that contains it. Search results carry the image, but a report only knows where
// its objective is, so both match by coordinates.
const MATCH_DEGREES = 0.01;

const inRing = (ring, lon, lat) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const withBounds = (region) => {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const ring of region.rings) {
    for (const [lon, lat] of ring) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  }
  return { ...region, bounds: { minLon, maxLon, minLat, maxLat }, boundsArea: (maxLon - minLon) * (maxLat - minLat) };
};

/** Regions ready for lookup: bounds precomputed, smallest first so a park beats the forest around it. */
const prepareRegions = (regions = []) => regions.map(withBounds).sort((a, b) => a.boundsArea - b.boundsArea);

const findRegion = (regions, lat, lon) =>
  regions.find(
    ({ bounds, rings }) =>
      lon >= bounds.minLon && lon <= bounds.maxLon && lat >= bounds.minLat && lat <= bounds.maxLat && rings.some((ring) => inRing(ring, lon, lat)),
  ) ?? null;

const findCatalogPeak = (peaks, lat, lon) => {
  let best = null;
  let bestDistance = Infinity;
  for (const peak of peaks) {
    if (!peak.image) continue;
    const dLat = Math.abs(peak.lat - lat);
    const dLon = Math.abs(peak.lon - lon);
    if (dLat > MATCH_DEGREES || dLon > MATCH_DEGREES) continue;
    if (dLat + dLon < bestDistance) {
      best = peak;
      bestDistance = dLat + dLon;
    }
  }
  return best;
};

/** `{ name, url, …credit }`; `fallback: true` when the photo is of the surrounding region, not the place. */
const findObjectiveImage = (peaks, regions, lat, lon) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const peak = Array.isArray(peaks) ? findCatalogPeak(peaks, lat, lon) : null;
  if (peak) return { name: peak.name, ...peak.image };
  const region = Array.isArray(regions) ? findRegion(regions, lat, lon) : null;
  return region ? { name: region.name, ...region.image, fallback: true } : null;
};

/** Search results without a photo of their own get their region's. */
const attachFallbackImages = (results, regions) =>
  results.map((result) => {
    if (result.image) return result;
    const region = findRegion(regions, Number(result.lat), Number(result.lon));
    return region ? { ...result, image: { name: region.name, ...region.image, fallback: true } } : result;
  });

module.exports = { findObjectiveImage, attachFallbackImages, prepareRegions, findRegion };
