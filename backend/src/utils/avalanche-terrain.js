'use strict';

// Aspects and elevation bands: which slopes a wind loads, and which slopes and
// bands an avalanche problem's location covers.

const ASPECT_ROSE_ORDER = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
// Ring order is inner → outer: near treeline, above treeline, below treeline.
const ELEVATION_ROSE_ORDER = ['middle', 'upper', 'lower'];

const COMPASS_DEGREES = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

const windDirectionToDegrees = (direction) => {
  if (!direction) return null;
  const normalized = String(direction).trim().toUpperCase();
  if (normalized === 'CALM' || normalized === 'VRB' || normalized === 'VARIABLE') return null;
  return Number.isFinite(COMPASS_DEGREES[normalized]) ? COMPASS_DEGREES[normalized] : null;
};

/** The three aspects downwind of a wind: where it deposits snow. */
const leewardAspectsFromWind = (direction) => {
  const windDegrees = windDirectionToDegrees(direction);
  if (windDegrees === null) return [];
  const centerIndex = Math.round(((windDegrees + 180) % 360) / 45) % 8;
  return [...new Set([
    ASPECT_ROSE_ORDER[(centerIndex + 7) % 8],
    ASPECT_ROSE_ORDER[centerIndex],
    ASPECT_ROSE_ORDER[(centerIndex + 1) % 8],
  ])];
};

/** The aspects either side of the lee, which a wind can cross-load. */
const secondaryCrossLoadingAspects = (direction) => {
  const directionDeg = windDirectionToDegrees(direction);
  if (directionDeg === null) return [];
  const centerIndex = Math.round(((directionDeg + 180) % 360) / 45) % ASPECT_ROSE_ORDER.length;
  return [...new Set([
    ASPECT_ROSE_ORDER[(centerIndex + 2) % ASPECT_ROSE_ORDER.length],
    ASPECT_ROSE_ORDER[(centerIndex + ASPECT_ROSE_ORDER.length - 2) % ASPECT_ROSE_ORDER.length],
  ])];
};

const getLocationEntries = (location) => {
  if (!location) return [];
  if (Array.isArray(location)) return location.map((entry) => String(entry)).filter(Boolean);
  if (typeof location === 'string') return location.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (typeof location === 'object') {
    const result = [];
    for (const [key, value] of Object.entries(location)) {
      if (key) result.push(key);
      if (Array.isArray(value)) value.forEach((item) => result.push(String(item)));
      else if (value !== null && value !== undefined) result.push(String(value));
    }
    return result.filter(Boolean);
  }
  return [];
};

/** Aspects and elevation bands named in a problem's location ("north upper", "all aspects", …). */
const parseTerrainFromLocation = (location) => {
  const aspects = new Set();
  const elevations = new Set();
  getLocationEntries(location).forEach((rawEntry) => {
    const entry = rawEntry.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
    const tokenSet = new Set(entry.split(/\s+/).filter(Boolean));
    const includesAny = (values) => values.some((value) => tokenSet.has(value));

    if (/\ball\s+aspects?\b|\ball\s+slopes?\b/.test(entry)) ASPECT_ROSE_ORDER.forEach((aspect) => aspects.add(aspect));
    if (/\bnorthwest\b|\bnw\b/.test(entry)) aspects.add('NW');
    if (/\bnortheast\b|\bne\b/.test(entry)) aspects.add('NE');
    if (/\bsouthwest\b|\bsw\b/.test(entry)) aspects.add('SW');
    if (/\bsoutheast\b|\bse\b/.test(entry)) aspects.add('SE');
    if (/\bnorth\b/.test(entry) && !/\bnorthwest\b|\bnortheast\b/.test(entry)) aspects.add('N');
    if (/\bsouth\b/.test(entry) && !/\bsouthwest\b|\bsoutheast\b/.test(entry)) aspects.add('S');
    if (/\beast\b/.test(entry) && !/\bnortheast\b|\bsoutheast\b/.test(entry)) aspects.add('E');
    if (/\bwest\b/.test(entry) && !/\bnorthwest\b|\bsouthwest\b/.test(entry)) aspects.add('W');

    const hasUpper = /\bupper\b|\babove\b|\balpine\b|\babove\s*treeline\b|\babove\s*tl\b|\batl\b/.test(entry);
    const hasLower = /\blower\b|\bbelow\b|\bbelow\s*treeline\b|\bbelow\s*tl\b|\bbtl\b/.test(entry);
    const hasTreelineWord = /\btreeline\b|\bnear\s*treeline\b|\bat\s*treeline\b|\bntl\b/.test(entry);
    const hasMiddle = /\bmiddle\b|\bmid\b|\bnear\b/.test(entry) || (hasTreelineWord && !hasUpper && !hasLower);
    if (/\ball\s+elevations?\b/.test(entry)) {
      ELEVATION_ROSE_ORDER.forEach((band) => elevations.add(band));
    } else {
      if (hasUpper || includesAny(['atl'])) elevations.add('upper');
      if (hasMiddle || includesAny(['ntl'])) elevations.add('middle');
      if (hasLower || includesAny(['btl'])) elevations.add('lower');
    }
  });
  return { aspects, elevations };
};

module.exports = {
  ASPECT_ROSE_ORDER,
  ELEVATION_ROSE_ORDER,
  windDirectionToDegrees,
  leewardAspectsFromWind,
  secondaryCrossLoadingAspects,
  getLocationEntries,
  parseTerrainFromLocation,
};
