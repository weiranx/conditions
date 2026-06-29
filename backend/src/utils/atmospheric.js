/**
 * Atmospheric signals: derived (wind chill, precip-type, moon) plus an
 * assembler that merges those with fetched signals (UV, freezing/snow level,
 * thunder probability) into a single `atmosphere` payload section.
 *
 * Pure functions only — no network. Fetching lives in atmospheric-fetch.js.
 */

const { FT_PER_METER } = require('./geo');

const toFiniteOrNull = (value) => {
  // Treat null/undefined/'' as missing — Number() would coerce these to 0.
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

/**
 * NWS wind chill (°F). Only defined for temp <= 50°F and wind >= 3 mph;
 * returns null when not applicable so callers can hide the field.
 */
const computeWindChillF = (tempF, windMph) => {
  const t = toFiniteOrNull(tempF);
  const w = toFiniteOrNull(windMph);
  if (t === null || w === null) {
    return null;
  }
  if (t > 50 || w < 3) {
    return null;
  }
  const chill =
    35.74 + 0.6215 * t - 35.75 * Math.pow(w, 0.16) + 0.4275 * t * Math.pow(w, 0.16);
  return Math.round(chill);
};

/**
 * Classify the likely precipitation type for the planned window.
 * Uses snow level vs objective elevation when available, otherwise falls back
 * to surface temperature. Returns a stable code plus a human label and reason.
 */
const classifyPrecipType = ({
  tempF,
  precipChance,
  description,
  snowLevelFt,
  freezingLevelFt,
  elevationFt,
} = {}) => {
  const chance = toFiniteOrNull(precipChance);
  const temp = toFiniteOrNull(tempF);
  const snowLevel = toFiniteOrNull(snowLevelFt);
  const freezingLevel = toFiniteOrNull(freezingLevelFt);
  const elevation = toFiniteOrNull(elevationFt);
  const text = String(description || '').toLowerCase();

  const explicitFreezing = /freezing rain|freezing drizzle|wintry mix|ice/.test(text);

  // No meaningful precipitation expected.
  if (chance !== null && chance < 15 && !explicitFreezing) {
    return { code: 'none', label: 'No precip expected', reason: `Precipitation chance ${chance}%.` };
  }

  // Freezing rain: warm layer aloft (freezing level above the objective) but a
  // sub-freezing surface, or the forecast text explicitly calls it out.
  const subFreezingSurface = temp !== null && temp <= 32;
  const warmLayerAloft =
    freezingLevel !== null && elevation !== null && freezingLevel > elevation + 500;
  if (explicitFreezing || (subFreezingSurface && warmLayerAloft)) {
    return {
      code: 'freezing',
      label: 'Freezing rain / ice',
      reason: explicitFreezing
        ? 'Forecast text indicates freezing precipitation.'
        : 'Sub-freezing surface beneath a warmer layer aloft favors freezing rain.',
    };
  }

  // Snow vs rain via snow level relative to the objective elevation.
  if (snowLevel !== null && elevation !== null) {
    if (elevation >= snowLevel + 250) {
      return {
        code: 'snow',
        label: 'Snow',
        reason: `Objective (${Math.round(elevation)} ft) is above the snow level (${Math.round(snowLevel)} ft).`,
      };
    }
    if (elevation <= snowLevel - 250) {
      return {
        code: 'rain',
        label: 'Rain',
        reason: `Objective (${Math.round(elevation)} ft) is below the snow level (${Math.round(snowLevel)} ft).`,
      };
    }
    return {
      code: 'mix',
      label: 'Rain / snow mix',
      reason: `Objective (${Math.round(elevation)} ft) straddles the snow level (~${Math.round(snowLevel)} ft).`,
    };
  }

  // Fallback: surface temperature thresholds.
  if (temp !== null) {
    if (temp <= 32) {
      return { code: 'snow', label: 'Snow', reason: `Surface temperature ${temp}°F.` };
    }
    if (temp <= 37) {
      return { code: 'mix', label: 'Rain / snow mix', reason: `Surface temperature ${temp}°F near freezing.` };
    }
    return { code: 'rain', label: 'Rain', reason: `Surface temperature ${temp}°F.` };
  }

  return { code: 'unknown', label: 'Unknown', reason: 'Insufficient data to classify precipitation type.' };
};

const MOON_PHASE_NAMES = [
  { name: 'New moon', emoji: '🌑' },
  { name: 'Waxing crescent', emoji: '🌒' },
  { name: 'First quarter', emoji: '🌓' },
  { name: 'Waxing gibbous', emoji: '🌔' },
  { name: 'Full moon', emoji: '🌕' },
  { name: 'Waning gibbous', emoji: '🌖' },
  { name: 'Last quarter', emoji: '🌗' },
  { name: 'Waning crescent', emoji: '🌘' },
];

const SYNODIC_MONTH = 29.53058867;
// Reference new moon: 2000-01-06 18:14 UTC.
const KNOWN_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14, 0);

/**
 * Moon phase + illumination for a given date.
 * Returns phase fraction (0..1 of the synodic cycle), illuminated fraction
 * (0..1), a phase name and emoji. Accurate to ~1 day, sufficient for planning
 * alpine starts by moonlight.
 */
const computeMoonPhase = (dateInput) => {
  const date = dateInput ? new Date(dateInput) : new Date();
  const ms = date.getTime();
  if (!Number.isFinite(ms)) {
    return null;
  }
  const daysSince = (ms - KNOWN_NEW_MOON_MS) / 86_400_000;
  let phase = (daysSince % SYNODIC_MONTH) / SYNODIC_MONTH;
  if (phase < 0) phase += 1;

  // Illuminated fraction from phase angle.
  const illumination = Math.round(((1 - Math.cos(2 * Math.PI * phase)) / 2) * 100) / 100;

  const index = Math.round(phase * 8) % 8;
  const { name, emoji } = MOON_PHASE_NAMES[index];
  return {
    phase: Math.round(phase * 1000) / 1000,
    illumination,
    name,
    emoji,
    ageDays: Math.round(phase * SYNODIC_MONTH * 10) / 10,
  };
};

const uvCategory = (uvIndex) => {
  const uv = toFiniteOrNull(uvIndex);
  if (uv === null) return null;
  if (uv < 3) return 'Low';
  if (uv < 6) return 'Moderate';
  if (uv < 8) return 'High';
  if (uv < 11) return 'Very High';
  return 'Extreme';
};

const thunderCategory = (probability) => {
  const p = toFiniteOrNull(probability);
  if (p === null) return null;
  if (p < 10) return 'Low';
  if (p < 30) return 'Moderate';
  if (p < 60) return 'Elevated';
  return 'High';
};

/**
 * Assemble the `atmosphere` payload section from weather/solar context and the
 * fetched signals. All fields degrade to null individually.
 */
const buildAtmosphericData = ({ weatherData, fetched, generatedTime } = {}) => {
  const w = weatherData || {};
  const f = fetched || {};

  const windChill = computeWindChillF(w.temp, w.windSpeed);
  const freezingLevelFt = toFiniteOrNull(f.freezingLevelFt);
  const snowLevelFt = toFiniteOrNull(f.snowLevelFt);

  const precip = classifyPrecipType({
    tempF: w.temp,
    precipChance: w.precipChance,
    description: w.description,
    snowLevelFt,
    freezingLevelFt,
    elevationFt: w.elevation,
  });

  const moon = computeMoonPhase(f.date || w.forecastStartTime || w.forecastDate || null);
  const uvIndex = toFiniteOrNull(f.uvIndex);
  const uvIndexMax = toFiniteOrNull(f.uvIndexMax);
  const thunderProbability = toFiniteOrNull(f.thunderProbability);

  const sources = {
    uvIndex: uvIndex !== null ? f.uvSource || 'Open-Meteo' : 'Unavailable',
    freezingLevel: freezingLevelFt !== null ? f.freezingLevelSource || 'Open-Meteo' : 'Unavailable',
    snowLevel: snowLevelFt !== null ? f.snowLevelSource || 'NOAA gridpoint' : 'Unavailable',
    thunderProbability: thunderProbability !== null ? f.thunderSource || 'NOAA gridpoint' : 'Unavailable',
    windChill: windChill !== null ? 'Derived (NWS wind chill formula)' : 'Not applicable',
    precipType: 'Derived from temperature, snow level, and forecast text',
    moon: 'Calculated',
  };

  return {
    uvIndex,
    uvIndexMax,
    uvCategory: uvCategory(uvIndex),
    windChill,
    freezingLevelFt: freezingLevelFt !== null ? Math.round(freezingLevelFt) : null,
    snowLevelFt: snowLevelFt !== null ? Math.round(snowLevelFt) : null,
    thunderProbability,
    thunderCategory: thunderCategory(thunderProbability),
    precipType: precip,
    moon,
    sources,
    generatedTime: generatedTime || new Date().toISOString(),
  };
};

module.exports = {
  FT_PER_METER,
  computeWindChillF,
  classifyPrecipType,
  computeMoonPhase,
  uvCategory,
  thunderCategory,
  buildAtmosphericData,
};
