const { normalizeHttpUrl } = require('./url-utils');

const AVALANCHE_UNKNOWN_MESSAGE =
  "No official avalanche center forecast covers this objective. Avalanche terrain can still be dangerous. Treat conditions as unknown and use conservative terrain choices.";
const AVALANCHE_OFF_SEASON_MESSAGE =
  "Local avalanche center is not currently issuing forecasts for this zone (likely off-season). This does not imply zero risk; assess snow and terrain conditions directly.";
const AVALANCHE_LEVEL_LABELS = ['No Rating', 'Low', 'Moderate', 'Considerable', 'High', 'Extreme'];
const AVALANCHE_WINTER_MONTHS = new Set([10, 11, 0, 1, 2, 3]); // Nov-Apr
const AVALANCHE_SHOULDER_MONTHS = new Set([4, 9]); // May, Oct
const AVALANCHE_MATERIAL_SNOW_DEPTH_IN = 6;
const AVALANCHE_MATERIAL_SWE_IN = 1.5;
const AVALANCHE_MEASURABLE_SNOW_DEPTH_IN = 2;
const AVALANCHE_MEASURABLE_SWE_IN = 0.5;

const createUnknownAvalancheData = (coverageStatus = "no_center_coverage") => {
  const isTemporarilyUnavailable = coverageStatus === "temporarily_unavailable";
  const isOffSeason = coverageStatus === "no_active_forecast";
  return {
    center: isTemporarilyUnavailable
      ? "Avalanche Data Unavailable"
      : isOffSeason
        ? "Avalanche Forecast Off-Season"
        : "No Avalanche Center Coverage",
    center_id: null,
    zone: null,
    risk: "Unknown",
    dangerLevel: 0,
    dangerUnknown: true,
    coverageStatus,
    link: null,
    bottomLine: isTemporarilyUnavailable
      ? "Avalanche center data could not be retrieved right now. Avalanche terrain can still be dangerous. Treat risk as unknown and use conservative terrain choices."
      : isOffSeason
        ? AVALANCHE_OFF_SEASON_MESSAGE
      : AVALANCHE_UNKNOWN_MESSAGE,
    problems: [],
    publishedTime: null,
    expiresTime: null,
    generatedTime: null,
    elevations: null,
    relevant: true,
    relevanceReason: null,
  };
};

const parseForecastMonth = (dateValue) => {
  if (typeof dateValue !== 'string' || !dateValue.trim()) {
    return null;
  }
  const match = dateValue.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const month = parseInt(match[2], 10) - 1;
  return Number.isFinite(month) && month >= 0 && month <= 11 ? month : null;
};

const parseFiniteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const evaluateSnowpackSignal = (snowpackData) => {
  if (!snowpackData || typeof snowpackData !== 'object') {
    return { hasSignal: false, hasNoSignal: false, hasObservedPresence: false, reason: null };
  }

  const snotel = snowpackData?.snotel || null;
  const nohrsc = snowpackData?.nohrsc || null;
  const cdec = snowpackData?.cdec || null;
  const snotelDistanceKm = parseFiniteNumber(snotel?.distanceKm);
  const snotelNearObjective = snotelDistanceKm === null || snotelDistanceKm <= 120;

  const depthSamples = [];
  const sweSamples = [];

  const snotelDepthIn = parseFiniteNumber(snotel?.snowDepthIn);
  const snotelSweIn = parseFiniteNumber(snotel?.sweIn);
  if (snotelNearObjective && snotelDepthIn !== null) depthSamples.push(snotelDepthIn);
  if (snotelNearObjective && snotelSweIn !== null) sweSamples.push(snotelSweIn);

  const nohrscDepthIn = parseFiniteNumber(nohrsc?.snowDepthIn);
  const nohrscSweIn = parseFiniteNumber(nohrsc?.sweIn);
  if (nohrscDepthIn !== null) depthSamples.push(nohrscDepthIn);
  if (nohrscSweIn !== null) sweSamples.push(nohrscSweIn);

  const cdecDistanceKm = parseFiniteNumber(cdec?.distanceKm);
  const cdecNearObjective = cdecDistanceKm === null || cdecDistanceKm <= 120;
  const cdecDepthIn = parseFiniteNumber(cdec?.snowDepthIn);
  const cdecSweIn = parseFiniteNumber(cdec?.sweIn);
  if (cdecNearObjective && cdecDepthIn !== null) depthSamples.push(cdecDepthIn);
  if (cdecNearObjective && cdecSweIn !== null) sweSamples.push(cdecSweIn);

  const hasObservations = depthSamples.length > 0 || sweSamples.length > 0;
  if (!hasObservations) {
    return { hasSignal: false, hasNoSignal: false, hasObservedPresence: false, reason: null };
  }

  const maxDepthIn = depthSamples.length ? Math.max(...depthSamples) : null;
  const maxSweIn = sweSamples.length ? Math.max(...sweSamples) : null;

  const hasMaterialSnowpackSignal =
    (maxDepthIn !== null && maxDepthIn >= AVALANCHE_MATERIAL_SNOW_DEPTH_IN) ||
    (maxSweIn !== null && maxSweIn >= AVALANCHE_MATERIAL_SWE_IN);
  const hasModerateSnowpackPresence =
    (maxDepthIn !== null && maxDepthIn >= AVALANCHE_MEASURABLE_SNOW_DEPTH_IN) ||
    (maxSweIn !== null && maxSweIn >= AVALANCHE_MEASURABLE_SWE_IN);

  const hasLowSnowpackSignal =
    (maxDepthIn !== null && maxDepthIn <= 1) &&
    (maxSweIn === null || maxSweIn <= 0.25);

  if (hasMaterialSnowpackSignal) {
    const parts = [];
    if (maxDepthIn !== null) parts.push(`depth ~${maxDepthIn.toFixed(1)} in`);
    if (maxSweIn !== null) parts.push(`SWE ~${maxSweIn.toFixed(1)} in`);
    return {
      hasSignal: true,
      hasMaterialSignal: true,
      hasMeasurablePresence: true,
      hasNoSignal: false,
      hasObservedPresence: true,
      reason: `Snowpack Snapshot shows material snowpack (${parts.join(', ')}).`,
    };
  }

  if (hasModerateSnowpackPresence) {
    const parts = [];
    if (maxDepthIn !== null) parts.push(`depth ~${maxDepthIn.toFixed(1)} in`);
    if (maxSweIn !== null) parts.push(`SWE ~${maxSweIn.toFixed(1)} in`);
    return {
      hasSignal: false,
      hasMaterialSignal: false,
      hasMeasurablePresence: true,
      hasNoSignal: false,
      hasObservedPresence: true,
      reason: `Snowpack Snapshot shows measurable snowpack (${parts.join(', ')}), below material avalanche relevance threshold.`,
    };
  }

  if (hasLowSnowpackSignal) {
    const parts = [];
    if (maxDepthIn !== null) parts.push(`depth ~${maxDepthIn.toFixed(1)} in`);
    if (maxSweIn !== null) parts.push(`SWE ~${maxSweIn.toFixed(2)} in`);
    return {
      hasSignal: false,
      hasMaterialSignal: false,
      hasMeasurablePresence: false,
      hasNoSignal: true,
      hasObservedPresence: false,
      reason: `Snowpack Snapshot shows very low snow signal (${parts.join(', ')}).`,
    };
  }

  return {
    hasSignal: false,
    hasMaterialSignal: false,
    hasMeasurablePresence: false,
    hasNoSignal: false,
    hasObservedPresence: true,
    reason: 'Snowpack Snapshot is mixed/patchy and below material avalanche threshold; use weather and season context.',
  };
};

const evaluateAvalancheRelevance = ({ lat, selectedDate, weatherData, avalancheData, snowpackData, rainfallData }) => {
  if (avalancheData?.coverageStatus === 'expired_for_selected_start') {
    return {
      relevant: true,
      reason: 'Avalanche product expired before the selected start time; shown as stale guidance only.',
    };
  }

  if (avalancheData?.coverageStatus === 'reported' && avalancheData?.staleWarning === '72h') {
    return {
      relevant: true,
      reason: 'Avalanche bulletin is over 72 hours old and should be treated as expired. Check the avalanche center for a current forecast.',
    };
  }

  const hasOfficialCoverage = avalancheData?.coverageStatus === 'reported' && avalancheData?.dangerUnknown !== true;
  if (hasOfficialCoverage) {
    return {
      relevant: true,
      reason: 'Official avalanche center forecast covers this objective.',
    };
  }

  const expectedSnowWindowIn = Number(rainfallData?.expected?.snowWindowIn);
  if (Number.isFinite(expectedSnowWindowIn) && expectedSnowWindowIn >= 6) {
    return { relevant: true, reason: 'Significant snow accumulation (≥6 in) expected during the travel window — active loading increases avalanche cycle risk.' };
  }

  const objectiveElevationFt = parseFloat(weatherData?.elevation);
  const tempF = parseFloat(weatherData?.temp);
  const feelsLikeF = parseFloat(weatherData?.feelsLike);
  const precipChance = parseFloat(weatherData?.precipChance);
  const description = String(weatherData?.description || '').toLowerCase();
  const month = parseForecastMonth(selectedDate || weatherData?.forecastDate || '');
  const highLatitude = Math.abs(Number(lat)) >= 42;
  const highElevation = Number.isFinite(objectiveElevationFt) && objectiveElevationFt >= 8500;
  const midElevation = Number.isFinite(objectiveElevationFt) && objectiveElevationFt >= 6500;
  const isWinterWindow = month !== null && (AVALANCHE_WINTER_MONTHS.has(month) || (highElevation && month === 4));
  const isShoulderWindow = month !== null && !isWinterWindow && AVALANCHE_SHOULDER_MONTHS.has(month);
  const seasonUnknown = month === null;
  const snowpackSignal = evaluateSnowpackSignal(snowpackData);

  const hasWintrySignal =
    /snow|sleet|blizzard|ice|freezing|wintry|graupel|flurr|rime/.test(description) ||
    (Number.isFinite(tempF) && tempF <= 34) ||
    (Number.isFinite(feelsLikeF) && feelsLikeF <= 30) ||
    (Number.isFinite(precipChance) && precipChance >= 50 && Number.isFinite(tempF) && tempF <= 38);

  if (hasWintrySignal) {
    return {
      relevant: true,
      reason: 'Forecast includes wintry signals (snow/ice/freezing conditions).',
    };
  }

  if (snowpackSignal.hasMaterialSignal || snowpackSignal.hasSignal) {
    return {
      relevant: true,
      reason: snowpackSignal.reason || 'Snowpack Snapshot indicates meaningful snowpack.',
    };
  }

  if (snowpackSignal.hasMeasurablePresence) {
    if (highElevation && (isWinterWindow || isShoulderWindow || seasonUnknown)) {
      return {
        relevant: true,
        reason: `${snowpackSignal.reason || 'Snowpack Snapshot shows measurable snowpack.'} Elevation/season context keeps avalanche relevance on.`,
      };
    }
    if (midElevation && highLatitude && (isWinterWindow || seasonUnknown)) {
      return {
        relevant: true,
        reason: `${snowpackSignal.reason || 'Snowpack Snapshot shows measurable snowpack.'} Winter latitude/elevation context keeps avalanche relevance on.`,
      };
    }
    return {
      relevant: false,
      reason: `${snowpackSignal.reason || 'Snowpack Snapshot shows measurable snowpack.'} Keep monitoring, but avalanche forecasting is de-emphasized until snowpack reaches material levels or wintry signals increase.`,
    };
  }

  if (snowpackSignal.hasNoSignal && (
    avalancheData?.coverageStatus === 'no_active_forecast' ||
    avalancheData?.coverageStatus === 'no_center_coverage'
  )) {
    return {
      relevant: false,
      reason:
        avalancheData?.coverageStatus === 'no_active_forecast'
          ? `${snowpackSignal.reason || 'Snowpack Snapshot shows low snow signal.'} Local avalanche center is out of forecast season.`
          : `${snowpackSignal.reason || 'Snowpack Snapshot shows low snow signal.'} No local avalanche center coverage for this objective.`,
    };
  }

  if (avalancheData?.coverageStatus === 'no_active_forecast' && !isWinterWindow && !isShoulderWindow) {
    return {
      relevant: false,
      reason: 'Local avalanche center is out of forecast season for this objective/date.',
    };
  }

  if (highElevation && (isWinterWindow || isShoulderWindow || seasonUnknown)) {
    return {
      relevant: true,
      reason: 'High-elevation objective has meaningful seasonal snow potential.',
    };
  }

  if (midElevation && highLatitude && (isWinterWindow || seasonUnknown)) {
    return {
      relevant: true,
      reason: 'Mid-elevation objective in winter window at snow-prone latitude.',
    };
  }

  if (snowpackSignal.hasNoSignal && !isWinterWindow && !isShoulderWindow) {
    return {
      relevant: false,
      reason: snowpackSignal.reason || 'Snowpack Snapshot shows low snow signal for this objective window.',
    };
  }

  return {
    relevant: false,
    reason: 'Objective appears typically low-snow for the selected season and forecast.',
  };
};

const decodeHtmlEntities = (input = "") => {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
};

const cleanForecastText = (input = "") => {
  return decodeHtmlEntities(input)
    .replace(/<[^>]*>?/gm, " ")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const scoreBottomLineCandidate = (text = "") => {
  let score = text.length;
  if (/avalanche|danger|snow|terrain|slab|trigger|wind/i.test(text)) score += 200;
  if (text.length > 1500) score -= 250;
  return score;
};

const pickBestBottomLine = (candidates = []) => {
  const cleaned = candidates.map(cleanForecastText).filter(Boolean).filter(t => t.length >= 40);
  if (!cleaned.length) return null;
  return cleaned.sort((a, b) => scoreBottomLineCandidate(b) - scoreBottomLineCandidate(a))[0];
};

const normalizeExternalLink = (value) => {
  const normalized = normalizeHttpUrl(value);
  if (!normalized) {
    return null;
  }
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    if (host === 'www.nwac.us') {
      parsed.hostname = 'nwac.us';
    } else if (host === 'mountwashingtonavalanchecenter.org') {
      parsed.hostname = 'www.mountwashingtonavalanchecenter.org';
    } else if (host === 'avalanche.state.co.us' && parsed.pathname.toLowerCase() === '/home') {
      parsed.pathname = '/';
    }
    return parsed.toString();
  } catch {
    return normalized;
  }
};

const isAvalancheApiLink = (value) =>
  typeof value === 'string' && /^https?:\/\/api\.avalanche\.(org|state\.co\.us)\b/i.test(value.trim());

const isCaicHomepageLink = (value) =>
  typeof value === 'string' && /^https?:\/\/(?:www\.)?avalanche\.state\.co\.us\/?(?:[?#].*)?$/i.test(value.trim());

const formatCoordinateForLink = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric.toFixed(5);
};

const buildCaicForecastLink = (lat, lon) => {
  const latParam = formatCoordinateForLink(lat);
  const lonParam = formatCoordinateForLink(lon);
  if (!latParam || !lonParam) {
    return 'https://avalanche.state.co.us/';
  }
  return `https://avalanche.state.co.us/?lat=${encodeURIComponent(latParam)}&lng=${encodeURIComponent(lonParam)}`;
};

const resolveAvalancheCenterLink = ({ centerId, link, centerLink, lat, lon }) => {
  const primaryLink = normalizeExternalLink(link);
  const fallbackLink = normalizeExternalLink(centerLink);
  const nonApiLink = [primaryLink, fallbackLink].find((candidate) => candidate && !isAvalancheApiLink(candidate));

  if (centerId === 'CAIC') {
    if (nonApiLink) {
      try {
        const parsed = new URL(nonApiLink);
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        const hasCoordinateParams = Boolean(parsed.searchParams.get('lat')) && Boolean(parsed.searchParams.get('lng') || parsed.searchParams.get('lon'));
        if (host === 'avalanche.state.co.us' && hasCoordinateParams) {
          return nonApiLink;
        }
      } catch {
        // Fall through to existing CAIC handling.
      }
    }
    if (nonApiLink && !isCaicHomepageLink(nonApiLink)) {
      return nonApiLink;
    }
    return buildCaicForecastLink(lat, lon);
  }

  return nonApiLink || primaryLink || fallbackLink || null;
};

const normalizeAvalancheLevel = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.min(5, Math.max(0, Math.round(numeric)));
};

const deriveOverallDangerLevelFromElevations = (elevations, fallbackLevel = 0) => {
  const fallback = normalizeAvalancheLevel(fallbackLevel);
  if (!elevations || typeof elevations !== 'object') {
    return fallback;
  }

  const levels = [elevations.above, elevations.at, elevations.below]
    .map((band) => normalizeAvalancheLevel(band?.level))
    .filter((level) => Number.isFinite(level) && level > 0);

  if (levels.length === 0) {
    return fallback;
  }

  return Math.max(...levels);
};

const applyDerivedOverallAvalancheDanger = (avalancheData) => {
  if (!avalancheData || typeof avalancheData !== 'object') {
    return avalancheData;
  }
  if (avalancheData.dangerUnknown || avalancheData.coverageStatus !== 'reported') {
    return avalancheData;
  }

  const derivedLevel = deriveOverallDangerLevelFromElevations(avalancheData.elevations, avalancheData.dangerLevel);
  return {
    ...avalancheData,
    dangerLevel: derivedLevel,
    risk: AVALANCHE_LEVEL_LABELS[derivedLevel] || avalancheData.risk || 'Unknown',
  };
};

module.exports = {
  AVALANCHE_UNKNOWN_MESSAGE,
  AVALANCHE_OFF_SEASON_MESSAGE,
  AVALANCHE_LEVEL_LABELS,
  AVALANCHE_WINTER_MONTHS,
  AVALANCHE_SHOULDER_MONTHS,
  createUnknownAvalancheData,
  evaluateSnowpackSignal,
  evaluateAvalancheRelevance,
  decodeHtmlEntities,
  cleanForecastText,
  scoreBottomLineCandidate,
  pickBestBottomLine,
  normalizeExternalLink,
  isAvalancheApiLink,
  isCaicHomepageLink,
  formatCoordinateForLink,
  buildCaicForecastLink,
  resolveAvalancheCenterLink,
  normalizeAvalancheLevel,
  deriveOverallDangerLevelFromElevations,
  applyDerivedOverallAvalancheDanger,
};
