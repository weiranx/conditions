// Place search results for the plan form: the app's peak catalog and OpenStreetMap
// (Nominatim) matches, named compactly ("Mount Si, King County, Washington") with the
// kind of place and its summit elevation, backcountry features ahead of towns, and
// shops and offices left out.

const FEET_PER_METER = 3.28084;

const normalizeSearchText = (value = '') =>
  String(value)
    .toLowerCase()
    .replace(/[.,()]/g, ' ')
    .replace(/\bmt\b/g, 'mount')
    .replace(/\s+/g, ' ')
    .trim();

/** Every query word starts a word of the name ("teton grand", "mount rain"), or the name contains the query. */
const nameMatchesQuery = (name, query) => {
  const normalizedName = normalizeSearchText(name);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  if (normalizedName.includes(normalizedQuery)) return true;
  const nameWords = normalizedName.split(' ');
  return normalizedQuery.split(' ').every((word) => nameWords.some((nameWord) => nameWord.startsWith(word)));
};

const catalogResult = (peak, resultClass) => ({
  ...peak,
  type: 'peak',
  class: resultClass,
  kind: 'Peak',
});

const matchCatalogPeaks = (peaks, query) =>
  peaks.filter((peak) => nameMatchesQuery(peak.name, query)).map((peak) => catalogResult(peak, 'natural'));

const popularCatalogPeaks = (peaks, count) => peaks.slice(0, count).map((peak) => catalogResult(peak, 'popular'));

// Nominatim class → type → label. A class entry of a string labels every type.
const KIND_LABELS = {
  natural: {
    peak: 'Peak', volcano: 'Volcano', saddle: 'Saddle', ridge: 'Ridge', arete: 'Ridge', cliff: 'Cliff',
    glacier: 'Glacier', water: 'Lake', spring: 'Spring', valley: 'Valley', rock: 'Rock', bare_rock: 'Rock',
    scree: 'Scree', wood: 'Forest', hot_spring: 'Hot spring', cave_entrance: 'Cave', couloir: 'Couloir',
    wetland: 'Meadow', grassland: 'Meadow', heath: 'Meadow', arch: 'Arch', beach: 'Beach', canyon: 'Canyon',
    gorge: 'Canyon', plateau: 'Plateau', hill: 'Hill', dune: 'Dune', bay: 'Bay', cape: 'Point', peninsula: 'Point',
  },
  // Nominatim files lakes under `water` (water=lake), not natural=water.
  water: { lake: 'Lake', reservoir: 'Reservoir', pond: 'Pond', tarn: 'Lake', river: 'River', lagoon: 'Lake' },
  mountain_pass: 'Pass',
  waterway: { river: 'River', stream: 'Stream', waterfall: 'Waterfall', rapids: 'Rapids' },
  highway: { trailhead: 'Trailhead', path: 'Trail', footway: 'Trail', bridleway: 'Trail', track: 'Track' },
  landuse: { meadow: 'Meadow', forest: 'Forest' },
  leisure: { nature_reserve: 'Nature reserve', park: 'Park' },
  boundary: { national_park: 'Park', protected_area: 'Protected area' },
  tourism: {
    camp_site: 'Campground', alpine_hut: 'Hut', wilderness_hut: 'Hut', viewpoint: 'Viewpoint', picnic_site: 'Picnic site',
    attraction: 'Attraction',
  },
  amenity: { parking: 'Parking', shelter: 'Shelter', ranger_station: 'Ranger station' },
  place: {
    city: 'Town', town: 'Town', village: 'Town', hamlet: 'Town', locality: 'Locality', island: 'Island',
  },
};

const kindLabel = (osmClass, osmType) => {
  const entry = KIND_LABELS[osmClass];
  if (typeof entry === 'string') return entry;
  return entry?.[osmType] || null;
};

// Places a backcountry plan starts from or aims at, ahead of towns and everything else.
const OUTDOOR_CLASSES = new Set(['natural', 'mountain_pass', 'waterway', 'water']);
// Labeled, but ranked with towns: an attraction may be a museum.
const TOWN_TIER = new Set(['place', 'boundary:administrative', 'tourism:attraction']);
// Businesses never make a plan's objective; "Enchantments" is otherwise three gift shops.
const EXCLUDED_CLASSES = new Set(['shop', 'office', 'craft', 'building', 'healthcare']);
// Streets and subdivisions that share a summit's name ("Cascade Pass" in Minnesota).
const EXCLUDED_TYPES = new Set([
  'highway:residential', 'highway:service', 'highway:living_street', 'highway:unclassified', 'highway:bus_stop',
  'landuse:residential', 'landuse:commercial', 'landuse:retail', 'landuse:industrial',
]);

const isExcludedPlace = (item) =>
  EXCLUDED_CLASSES.has(item.class) || EXCLUDED_TYPES.has(`${item.class}:${item.type}`);

const placeTier = (osmClass, osmType) => {
  if (TOWN_TIER.has(osmClass) || TOWN_TIER.has(`${osmClass}:${osmType}`)) return 1;
  if (OUTDOOR_CLASSES.has(osmClass) || kindLabel(osmClass, osmType)) return 0;
  if (osmClass === 'boundary') return 1;
  return 2;
};

/** OpenStreetMap `ele` tags: metres unless marked in feet ("4392", "3373.5", "14411 ft", "14,411'"). */
const parseElevationFt = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase().replace(/,/g, '');
  const match = text.match(/^(-?\d+(?:\.\d+)?)\s*(m|meters?|metres?|ft|feet|foot|')?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const inFeet = ['ft', 'feet', 'foot', "'"].includes(match[2]);
  const feet = inFeet ? amount : amount * FEET_PER_METER;
  // Lowest and highest ground in the United States; a bare 0 is a placeholder more often than sea level.
  if (!Number.isFinite(feet) || amount === 0 || feet < -300 || feet > 20400) return null;
  return Math.round(feet);
};

const primaryPlaceName = (item) => {
  const named = typeof item.name === 'string' ? item.name.trim() : '';
  if (named) return named;
  return String(item.display_name || '').split(',')[0].trim();
};

/** "Mount Si, King County, Washington" rather than the full address with postcode and country. */
const compactPlaceName = (item) => {
  const primary = primaryPlaceName(item);
  const address = item.address || {};
  const locality = address.county || address.city || address.town || address.village || address.hamlet || null;
  const parts = [primary, locality, address.state].filter(Boolean);
  const unique = parts.filter(
    (part, index) => parts.findIndex((other) => normalizeSearchText(other) === normalizeSearchText(part)) === index,
  );
  return unique.length > 1 ? unique.join(', ') : String(item.display_name || primary);
};

const toPlaceResult = (item) => {
  const lat = parseFloat(item.lat);
  const lon = parseFloat(item.lon);
  const name = compactPlaceName(item);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const result = { name, lat, lon, type: item.type, class: item.class };
  // Towns often arrive as their administrative boundary.
  const kind = kindLabel(item.class, item.type)
    || (item.class === 'boundary' && item.type === 'administrative' ? kindLabel('place', item.addresstype) : null);
  if (kind) result.kind = kind;
  const elevationFt = parseElevationFt(item.extratags?.ele);
  if (elevationFt !== null) result.elevationFt = elevationFt;
  return result;
};

const importanceOf = (item) => (Number.isFinite(Number(item.importance)) ? Number(item.importance) : 0);

/**
 * Nominatim search results, businesses and streets removed, outdoor features first. Within a
 * tier the most prominent place leads ("hanging lake" → Glenwood Canyon), unless the search
 * was biased to an area: then Nominatim's order, which puts places in that area first, stands.
 */
const rankPlaceResults = (items, { biased = false } = {}) =>
  (Array.isArray(items) ? items : [])
    .filter((item) => item && !isExcludedPlace(item))
    .map((item, index) => ({ item, index, tier: placeTier(item.class, item.type), importance: importanceOf(item) }))
    .sort((a, b) => a.tier - b.tier || (biased ? 0 : b.importance - a.importance) || a.index - b.index)
    .map(({ item }) => toPlaceResult(item))
    .filter(Boolean);

// Nominatim prefers matches inside a viewbox without dropping others, so "snow lake" near
// Seattle finds the Alpine Lakes one while "half dome" still finds Yosemite. The centre is
// rounded to whole degrees so nearby plans share cached results.
const BIAS_HALF_HEIGHT_DEGREES = 1.5;
const BIAS_HALF_WIDTH_DEGREES = 2;

/** `near=lat,lon` → a rounded search-bias box, or null when absent or out of range. */
const parseSearchBias = (value) => {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Math.round(Number(match[1]));
  const lon = Math.round(Number(match[2]));
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
  return {
    key: `${lat},${lon}`,
    viewbox: [lon - BIAS_HALF_WIDTH_DEGREES, lat + BIAS_HALF_HEIGHT_DEGREES, lon + BIAS_HALF_WIDTH_DEGREES, lat - BIAS_HALF_HEIGHT_DEGREES].join(','),
  };
};

module.exports = {
  parseSearchBias,
  normalizeSearchText,
  nameMatchesQuery,
  matchCatalogPeaks,
  popularCatalogPeaks,
  parseElevationFt,
  compactPlaceName,
  rankPlaceResults,
};
