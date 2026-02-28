const CARDINAL_DIRECTIONS = new Set([
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
]);

const normalizeWindDirection = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const raw = value.trim().toUpperCase();
  if (!raw) {
    return null;
  }
  if (raw.includes('CALM')) {
    return 'CALM';
  }
  if (raw.includes('VARIABLE') || raw.includes('VAR')) {
    return 'VRB';
  }

  const cleaned = raw.replace(/[^A-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const compact = cleaned.replace(/\s+/g, '');
  if (CARDINAL_DIRECTIONS.has(compact)) {
    return compact;
  }

  const wordMap = [
    ['NORTH NORTHWEST', 'NNW'],
    ['NORTH NORTHEAST', 'NNE'],
    ['SOUTH SOUTHEAST', 'SSE'],
    ['SOUTH SOUTHWEST', 'SSW'],
    ['EAST NORTHEAST', 'ENE'],
    ['EAST SOUTHEAST', 'ESE'],
    ['WEST NORTHWEST', 'WNW'],
    ['WEST SOUTHWEST', 'WSW'],
    ['NORTHWEST', 'NW'],
    ['NORTHEAST', 'NE'],
    ['SOUTHWEST', 'SW'],
    ['SOUTHEAST', 'SE'],
    ['NORTH', 'N'],
    ['SOUTH', 'S'],
    ['EAST', 'E'],
    ['WEST', 'W'],
  ];
  const cleanedNoSpace = cleaned.replace(/\s+/g, '');
  for (const [needle, normalized] of wordMap) {
    const needleNoSpace = needle.replace(/\s+/g, '');
    if (cleaned.includes(needle) || cleanedNoSpace.includes(needleNoSpace)) {
      return normalized;
    }
  }

  return null;
};

const parseWindMph = (input, fallback = 0) => {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return Math.max(0, Math.round(input));
  }
  if (typeof input !== 'string') {
    return fallback;
  }
  const match = input.match(/-?\d+/);
  if (!match) {
    return fallback;
  }
  const parsed = parseInt(match[0], 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
};

const estimateWindGustFromWindSpeed = (windSpeedMph) => {
  const wind = Number(windSpeedMph);
  if (!Number.isFinite(wind) || wind <= 0) {
    return 0;
  }

  if (wind <= 5) {
    return Math.round(wind + 2);
  }
  if (wind <= 15) {
    return Math.round(wind * 1.25);
  }
  if (wind <= 30) {
    return Math.round(wind * 1.35);
  }
  return Math.round(wind * 1.45);
};

const inferWindGustFromPeriods = (periods, anchorIndex, windSpeedMph) => {
  const wind = Number.isFinite(Number(windSpeedMph)) ? Math.max(0, Math.round(Number(windSpeedMph))) : 0;
  const fallback = Math.max(wind, estimateWindGustFromWindSpeed(wind));

  if (!Array.isArray(periods) || periods.length === 0 || !Number.isInteger(anchorIndex) || anchorIndex < 0 || anchorIndex >= periods.length) {
    return { gustMph: fallback, source: 'estimated_from_wind' };
  }

  const directGust = parseWindMph(periods[anchorIndex]?.windGust, null);
  if (Number.isFinite(directGust)) {
    return { gustMph: Math.max(wind, Math.round(directGust)), source: 'reported' };
  }

  const maxOffset = Math.min(12, periods.length - 1);
  for (let offset = 1; offset <= maxOffset; offset += 1) {
    for (const index of [anchorIndex - offset, anchorIndex + offset]) {
      if (index < 0 || index >= periods.length) {
        continue;
      }
      const nearbyGust = parseWindMph(periods[index]?.windGust, null);
      if (!Number.isFinite(nearbyGust)) {
        continue;
      }

      const nearbyWind = parseWindMph(periods[index]?.windSpeed, null);
      if (Number.isFinite(nearbyWind) && nearbyWind > 0 && wind > 0) {
        const ratio = Math.min(1.8, Math.max(1.05, nearbyGust / nearbyWind));
        return { gustMph: Math.max(wind, Math.round(wind * ratio)), source: 'inferred_nearby' };
      }

      return { gustMph: Math.max(wind, Math.round(nearbyGust)), source: 'inferred_nearby' };
    }
  }

  return { gustMph: fallback, source: 'estimated_from_wind' };
};

const findNearestWindDirection = (periods, anchorIndex) => {
  if (!Array.isArray(periods) || periods.length === 0 || !Number.isInteger(anchorIndex)) {
    return null;
  }
  const direct = normalizeWindDirection(periods[anchorIndex]?.windDirection);
  if (direct) {
    return direct;
  }

  for (let offset = 1; offset < periods.length; offset += 1) {
    const forward = anchorIndex + offset;
    if (forward < periods.length) {
      const forwardDir = normalizeWindDirection(periods[forward]?.windDirection);
      if (forwardDir) {
        return forwardDir;
      }
    }
    const backward = anchorIndex - offset;
    if (backward >= 0) {
      const backwardDir = normalizeWindDirection(periods[backward]?.windDirection);
      if (backwardDir) {
        return backwardDir;
      }
    }
  }
  return null;
};

const windDegreesToCardinal = (degrees) => {
  if (degrees === null || degrees === undefined) {
    return null;
  }
  if (typeof degrees === 'string' && !degrees.trim()) {
    return null;
  }
  const value = Number(degrees);
  if (!Number.isFinite(value)) {
    return null;
  }
  const normalized = ((value % 360) + 360) % 360;
  const labels = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(normalized / 22.5) % 16;
  return labels[index];
};

const findNearestCardinalFromDegreeSeries = (degreeSeries, anchorIndex) => {
  if (!Array.isArray(degreeSeries) || degreeSeries.length === 0 || !Number.isInteger(anchorIndex)) {
    return null;
  }

  const direct = windDegreesToCardinal(degreeSeries[anchorIndex]);
  if (direct) {
    return direct;
  }

  for (let offset = 1; offset < degreeSeries.length; offset += 1) {
    const forward = anchorIndex + offset;
    if (forward < degreeSeries.length) {
      const forwardDirection = windDegreesToCardinal(degreeSeries[forward]);
      if (forwardDirection) {
        return forwardDirection;
      }
    }

    const backward = anchorIndex - offset;
    if (backward >= 0) {
      const backwardDirection = windDegreesToCardinal(degreeSeries[backward]);
      if (backwardDirection) {
        return backwardDirection;
      }
    }
  }

  return null;
};

module.exports = {
  parseWindMph,
  estimateWindGustFromWindSpeed,
  inferWindGustFromPeriods,
  normalizeWindDirection,
  findNearestWindDirection,
  windDegreesToCardinal,
  findNearestCardinalFromDegreeSeries,
};
