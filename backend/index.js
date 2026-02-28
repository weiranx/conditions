const { point } = require('@turf/helpers');
const booleanPointInPolygon = require('@turf/boolean-point-in-polygon').default;
const { createApp } = require('./src/server/create-app');
const { startServer: startBackendServer } = require('./src/server/start-server');
const {
  PORT,
  IS_PRODUCTION,
  DEBUG_AVY,
  REQUEST_TIMEOUT_MS,
  AVALANCHE_MAP_LAYER_TTL_MS,
  SNOTEL_STATION_CACHE_TTL_MS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  CORS_ALLOWLIST,
} = require('./src/server/runtime');
const { DEFAULT_FETCH_HEADERS, createFetchWithTimeout } = require('./src/utils/http-client');
const {
  parseWindMph,
  estimateWindGustFromWindSpeed,
  inferWindGustFromPeriods,
  normalizeWindDirection,
  findNearestWindDirection,
  findNearestCardinalFromDegreeSeries,
} = require('./src/utils/wind');
const {
  parseIsoTimeToMs,
  parseIsoTimeToMsWithReference,
  parseStartClock,
  buildPlannedStartIso,
  findClosestTimeIndex,
  parseClockToMinutes,
  formatMinutesToClock,
  parseIsoClockMinutes,
  clampTravelWindowHours,
  normalizeUtcIsoTimestamp,
} = require('./src/utils/time');
const {
  computeFeelsLikeF,
  celsiusToF,
  normalizeNoaaDewPointF,
  normalizePressureHpa,
  normalizeNoaaPressureHpa,
  clampPercent,
  inferNoaaCloudCoverFromIcon,
  inferNoaaCloudCoverFromForecastText,
  resolveNoaaCloudCover,
  toFiniteNumberOrNull,
} = require('./src/utils/weather-normalizers');
const { buildVisibilityRisk, buildElevationForecastBands } = require('./src/utils/visibility-risk');
const {
  isWeatherFieldMissing,
  blendNoaaWeatherWithFallback,
  dateKeyInTimeZone,
  buildTemperatureContext24h,
  hourLabelFromIso,
  createWeatherDataService,
} = require('./src/utils/weather-data');
const { normalizeHttpUrl } = require('./src/utils/url-utils');
const {
  ALERT_SEVERITY_RANK,
  normalizeAlertSeverity,
  formatAlertSeverity,
  getHigherSeverity,
  normalizeNwsAlertText,
  normalizeNwsAreaList,
  classifyUsAqi,
  createUnavailableAirQualityData,
  createUnavailableAlertsData,
  resolveNwsAlertSourceLink,
  createAlertsService,
} = require('./src/utils/alerts');
const {
  mmToInches,
  cmToInches,
  buildPrecipitationSummaryForAi,
  createUnavailableRainfallData,
  createPrecipitationService,
} = require('./src/utils/precipitation');
const { createUnavailableFireRiskData, buildFireRiskData } = require('./src/utils/fire-risk');
const { createUnavailableHeatRiskData, buildHeatRiskData } = require('./src/utils/heat-risk');
const { createSnowpackService } = require('./src/utils/snowpack');
const {
  firstNonEmptyString,
  parseAvalancheDetailPayloads,
  normalizeAvalancheProblemCollection,
  getAvalancheProblemsFromDetail,
  pickBestAvalancheDetailCandidate,
  inferAvalancheExpiresTime,
  buildUtahForecastJsonUrl,
  extractUtahAvalancheAdvisory,
} = require('./src/utils/avalanche-detail');
const { deriveTerrainCondition, deriveTrailStatus } = require('./src/utils/terrain-condition');
const { buildLayeringGearSuggestions } = require('./src/utils/gear-suggestions');
const { createSatOneLinerBuilder } = require('./src/utils/sat-oneliner');
const { registerSearchRoutes } = require('./src/routes/search');
const { registerHealthRoutes } = require('./src/routes/health');
const { registerSafetyRoute, createSafetyInvoker } = require('./src/routes/safety');
const { registerSatOneLinerRoute } = require('./src/routes/sat-oneliner');
const { logReportRequest, registerReportLogsRoute } = require('./src/routes/report-logs');
const POPULAR_PEAKS = require('./peaks.json');

const avyLog = (...args) => {
  if (DEBUG_AVY) {
    console.log(...args);
  }
};
const app = createApp({
  isProduction: IS_PRODUCTION,
  corsAllowlist: CORS_ALLOWLIST,
  rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
  rateLimitMaxRequests: RATE_LIMIT_MAX_REQUESTS,
});

const AVALANCHE_UNKNOWN_MESSAGE =
  "No official avalanche center forecast covers this objective. Avalanche terrain can still be dangerous. Treat conditions as unknown and use conservative terrain choices.";
const AVALANCHE_OFF_SEASON_MESSAGE =
  "Local avalanche center is not currently issuing forecasts for this zone (likely off-season). This does not imply zero risk; assess snow and terrain conditions directly.";
const AVALANCHE_LEVEL_LABELS = ['No Rating', 'Low', 'Moderate', 'Considerable', 'High', 'Extreme'];
const FT_PER_METER = 3.28084;
const MAX_REASONABLE_ELEVATION_FT = 20000;

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



const buildSatOneLiner = createSatOneLinerBuilder({ parseStartClock, computeFeelsLikeF });



const AVALANCHE_WINTER_MONTHS = new Set([10, 11, 0, 1, 2, 3]); // Nov-Apr
const AVALANCHE_SHOULDER_MONTHS = new Set([4, 9]); // May, Oct
const AVALANCHE_MATERIAL_SNOW_DEPTH_IN = 6;
const AVALANCHE_MATERIAL_SWE_IN = 1.5;
const AVALANCHE_MEASURABLE_SNOW_DEPTH_IN = 2;
const AVALANCHE_MEASURABLE_SWE_IN = 0.5;

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
  const snotelDistanceKm = parseFiniteNumber(snotel?.distanceKm);
  const snotelNearObjective = snotelDistanceKm === null || snotelDistanceKm <= 80;

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


const calculateSafetyScore = ({
  weatherData,
  avalancheData,
  alertsData,
  airQualityData,
  fireRiskData,
  heatRiskData,
  rainfallData,
  selectedDate,
  solarData,
  selectedStartClock,
  selectedTravelWindowHours = null,
}) => {
  const explanations = [];
  const factors = [];
  const groupCaps = {
    avalanche: 55,
    weather: 42,
    alerts: 24,
    airQuality: 20,
    fire: 18,
  };

  const mapHazardToGroup = (hazard) => {
    const normalized = String(hazard || '').toLowerCase();
    if (normalized.includes('avalanche')) return 'avalanche';
    if (normalized.includes('alert')) return 'alerts';
    if (normalized.includes('air quality')) return 'airQuality';
    if (normalized.includes('fire')) return 'fire';
    return 'weather';
  };

  const applyFactor = (hazard, impact, message, source) => {
    if (!Number.isFinite(impact) || impact <= 0) {
      return;
    }
    factors.push({ hazard, impact, source, message, group: mapHazardToGroup(hazard) });
    explanations.push(message);
  };

  const weatherDescription = String(weatherData?.description || '').toLowerCase();
  const wind = parseFloat(weatherData?.windSpeed);
  const gust = parseFloat(weatherData?.windGust);
  const precipChance = parseFloat(weatherData?.precipChance);
  const humidity = parseFloat(weatherData?.humidity);
  const tempF = parseFloat(weatherData?.temp);
  const feelsLikeF = Number.isFinite(parseFloat(weatherData?.feelsLike)) ? parseFloat(weatherData?.feelsLike) : tempF;
  const isDaytime = weatherData?.isDaytime;
  const visibilityRiskScoreRaw = Number(weatherData?.visibilityRisk?.score);
  const visibilityRiskScore = Number.isFinite(visibilityRiskScoreRaw) ? visibilityRiskScoreRaw : null;
  const visibilityRiskLevel = String(weatherData?.visibilityRisk?.level || '').trim();
  const visibilityActiveHoursRaw = Number(weatherData?.visibilityRisk?.activeHours);
  const visibilityActiveHours = Number.isFinite(visibilityActiveHoursRaw) ? visibilityActiveHoursRaw : null;

  const normalizedRisk = String(avalancheData?.risk || '').toLowerCase();
  const avalancheRelevant = avalancheData?.relevant !== false;
  const avalancheUnknown = avalancheRelevant
    && Boolean(avalancheData?.dangerUnknown || normalizedRisk.includes('unknown') || normalizedRisk.includes('no forecast'));
  const avalancheDangerLevel = Number(avalancheData?.dangerLevel);
  const avalancheProblemCount = Array.isArray(avalancheData?.problems) ? avalancheData.problems.length : 0;

  const alertsStatus = String(alertsData?.status || '');
  const alertsCount = Number(alertsData?.activeCount);
  const highestAlertSeverity = normalizeAlertSeverity(alertsData?.highestSeverity);
  const alertEvents =
    Array.isArray(alertsData?.alerts) && alertsData.alerts.length
      ? [...new Set(alertsData.alerts.map((alert) => alert.event).filter(Boolean))].slice(0, 3)
      : [];

  const usAqi = Number(airQualityData?.usAqi);
  const airQualityStatus = String(airQualityData?.status || '').toLowerCase();
  const airQualityRelevantForScoring = airQualityStatus !== 'not_applicable_future_date';
  const aqiCategory = String(airQualityData?.category || 'Unknown');

  const trend = Array.isArray(weatherData?.trend) ? weatherData.trend : [];
  const requestedWindowHours = clampTravelWindowHours(selectedTravelWindowHours, 12);
  const effectiveTrendWindowHours = Math.max(1, trend.length || requestedWindowHours);
  const trendTemps = trend.map((item) => Number(item?.temp)).filter(Number.isFinite);
  const trendGusts = trend.map((item) => Number.isFinite(Number(item?.gust)) ? Number(item.gust) : Number(item?.wind)).filter(Number.isFinite);
  const trendPrecips = trend.map((item) => Number(item?.precipChance)).filter(Number.isFinite);
  const trendFeelsLike = trend
    .map((item) => {
      const rowTemp = Number(item?.temp);
      const rowWind = Number.isFinite(Number(item?.wind)) ? Number(item.wind) : Number.isFinite(Number(item?.gust)) ? Number(item.gust) : 0;
      if (!Number.isFinite(rowTemp)) return Number.NaN;
      return computeFeelsLikeF(rowTemp, Number.isFinite(rowWind) ? rowWind : 0);
    })
    .filter(Number.isFinite);
  const tempRange = trendTemps.length ? Math.max(...trendTemps) - Math.min(...trendTemps) : 0;
  const trendMinFeelsLike = trendFeelsLike.length ? Math.min(...trendFeelsLike) : feelsLikeF;
  const trendMaxFeelsLike = trendFeelsLike.length ? Math.max(...trendFeelsLike) : feelsLikeF;
  const trendPeakPrecip = trendPrecips.length ? Math.max(...trendPrecips) : precipChance;
  const trendPeakGust = trendGusts.length ? Math.max(...trendGusts) : Number.isFinite(gust) ? gust : 0;
  const severeWindHours = trend.filter((item) => {
    const rowWind = Number(item?.wind);
    const rowGust = Number.isFinite(Number(item?.gust)) ? Number(item.gust) : rowWind;
    return (Number.isFinite(rowWind) && rowWind >= 30) || (Number.isFinite(rowGust) && rowGust >= 45);
  }).length;
  const strongWindHours = trend.filter((item) => {
    const rowWind = Number(item?.wind);
    const rowGust = Number.isFinite(Number(item?.gust)) ? Number(item.gust) : rowWind;
    return (Number.isFinite(rowWind) && rowWind >= 20) || (Number.isFinite(rowGust) && rowGust >= 30);
  }).length;
  const highPrecipHours = trendPrecips.filter((value) => value >= 60).length;
  const moderatePrecipHours = trendPrecips.filter((value) => value >= 40).length;
  const coldExposureHours = trendFeelsLike.filter((value) => value <= 15).length;
  const extremeColdHours = trendFeelsLike.filter((value) => value <= 0).length;
  const heatExposureHours = trendFeelsLike.filter((value) => value >= 85).length;
  const rainfallTotals = rainfallData?.totals || {};
  const rainfallExpected = rainfallData?.expected || {};
  const rainPast24hIn = Number(rainfallTotals?.rainPast24hIn ?? rainfallTotals?.past24hIn);
  const snowPast24hIn = Number(rainfallTotals?.snowPast24hIn);
  const expectedRainWindowIn = Number(rainfallExpected?.rainWindowIn);
  const expectedSnowWindowIn = Number(rainfallExpected?.snowWindowIn);
  const sunriseMinutes = parseClockToMinutes(solarData?.sunrise);
  const selectedStartMinutes = parseClockToMinutes(selectedStartClock) ?? parseIsoClockMinutes(weatherData?.forecastStartTime);
  const isNightBeforeSunrise =
    isDaytime === false
    && Number.isFinite(selectedStartMinutes)
    && Number.isFinite(sunriseMinutes)
    && selectedStartMinutes < sunriseMinutes;
  const forecastStartMs = parseIsoTimeToMs(weatherData?.forecastStartTime);
  const selectedDateMs =
    typeof selectedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)
      ? Date.parse(`${selectedDate}T00:00:00Z`)
      : null;
  const forecastLeadHoursRaw =
    forecastStartMs !== null
      ? (forecastStartMs - Date.now()) / (1000 * 60 * 60)
      : Number.isFinite(selectedDateMs)
        ? (selectedDateMs - Date.now()) / (1000 * 60 * 60)
        : null;
  const forecastLeadHours = Number.isFinite(forecastLeadHoursRaw) ? Number(forecastLeadHoursRaw) : null;
  const alertsRelevantForSelectedTime = forecastLeadHours === null || forecastLeadHours <= 48;

  if (avalancheRelevant) {
    if (avalancheUnknown) {
      applyFactor('Avalanche Uncertainty', 16, AVALANCHE_UNKNOWN_MESSAGE, 'Avalanche center coverage');
    } else if (Number.isFinite(avalancheDangerLevel)) {
      if (avalancheDangerLevel >= 4 || normalizedRisk.includes('high') || normalizedRisk.includes('extreme')) {
        applyFactor('Avalanche', 52, 'High avalanche danger reported. Avoid avalanche terrain and steep loaded slopes.', 'Avalanche center forecast');
      } else if (avalancheDangerLevel === 3 || normalizedRisk.includes('considerable')) {
        applyFactor('Avalanche', 34, 'Considerable avalanche danger. Conservative terrain selection and strict spacing are required.', 'Avalanche center forecast');
      } else if (avalancheDangerLevel === 2 || normalizedRisk.includes('moderate')) {
        applyFactor('Avalanche', 15, 'Moderate avalanche danger. Evaluate snowpack and avoid connected terrain traps.', 'Avalanche center forecast');
      } else if (avalancheDangerLevel === 1) {
        applyFactor('Avalanche', 4, 'Low avalanche danger still requires basic avalanche precautions in suspect terrain.', 'Avalanche center forecast');
      }
    }

    if (avalancheProblemCount >= 3) {
      applyFactor(
        'Avalanche',
        6,
        `${avalancheProblemCount} avalanche problems are listed by the center, increasing snowpack complexity.`,
        'Avalanche problem list',
      );
    }
  }

  const effectiveWind = Math.max(
    Number.isFinite(wind) ? wind : 0,
    Number.isFinite(gust) ? gust : 0,
    Number.isFinite(trendPeakGust) ? trendPeakGust : 0,
  );
  if (effectiveWind >= 50 || (Number.isFinite(wind) && wind >= 35)) {
    applyFactor(
      'Wind',
      20,
      `Severe wind exposure expected (start wind ${Math.round(Number.isFinite(wind) ? wind : 0)} mph, gust ${Math.round(Number.isFinite(gust) ? gust : effectiveWind)} mph, trend peak ${Math.round(effectiveWind)} mph).`,
      'NOAA hourly forecast',
    );
  } else if (effectiveWind >= 40 || (Number.isFinite(wind) && wind >= 25)) {
    applyFactor(
      'Wind',
      12,
      `Strong winds expected (start wind ${Math.round(Number.isFinite(wind) ? wind : 0)} mph, gust ${Math.round(Number.isFinite(gust) ? gust : effectiveWind)} mph, trend peak ${Math.round(effectiveWind)} mph).`,
      'NOAA hourly forecast',
    );
  } else if (effectiveWind >= 30 || (Number.isFinite(wind) && wind >= 18)) {
    applyFactor('Wind', 6, `Moderate wind signal (trend peak ${Math.round(effectiveWind)} mph) may affect exposed movement.`, 'NOAA hourly forecast');
  }

  if (severeWindHours >= 4) {
    applyFactor('Wind', 8, `${severeWindHours}/${trend.length} trend hours are severe wind windows (>=30 mph sustained or >=45 mph gust).`, 'NOAA hourly trend');
  } else if (severeWindHours >= 2) {
    applyFactor('Wind', 5, `${severeWindHours}/${trend.length} trend hours show severe wind windows.`, 'NOAA hourly trend');
  } else if (strongWindHours >= 6) {
    applyFactor('Wind', 4, `${strongWindHours}/${trend.length} trend hours are windy (>=20 mph sustained or >=30 mph gust).`, 'NOAA hourly trend');
  } else if (strongWindHours >= 3) {
    applyFactor('Wind', 2, `${strongWindHours}/${trend.length} trend hours are windy and may reduce margin on exposed terrain.`, 'NOAA hourly trend');
  }

  if (Number.isFinite(trendPeakPrecip) && trendPeakPrecip >= 80) {
    applyFactor('Storm', 12, `Peak precipitation chance in the window reaches ${Math.round(trendPeakPrecip)}%.`, 'NOAA hourly forecast');
  } else if (Number.isFinite(trendPeakPrecip) && trendPeakPrecip >= 60) {
    applyFactor('Storm', 8, `Peak precipitation chance in the window reaches ${Math.round(trendPeakPrecip)}%.`, 'NOAA hourly forecast');
  } else if (Number.isFinite(trendPeakPrecip) && trendPeakPrecip >= 40) {
    applyFactor('Storm', 4, `Peak precipitation chance in the window reaches ${Math.round(trendPeakPrecip)}%.`, 'NOAA hourly forecast');
  }

  if (highPrecipHours >= 4) {
    applyFactor('Storm', 7, `${highPrecipHours}/${trend.length} trend hours are high precip windows (>=60%).`, 'NOAA hourly trend');
  } else if (highPrecipHours >= 2) {
    applyFactor('Storm', 4, `${highPrecipHours}/${trend.length} trend hours are high precip windows.`, 'NOAA hourly trend');
  } else if (moderatePrecipHours >= 6) {
    applyFactor('Storm', 3, `${moderatePrecipHours}/${trend.length} trend hours are moderate precip windows (>=40%).`, 'NOAA hourly trend');
  }

  if (/thunderstorm|lightning|blizzard/.test(weatherDescription)) {
    applyFactor('Storm', 18, `Convective or severe weather signal in forecast: "${weatherData.description}".`, 'NOAA short forecast');
  } else if (/snow|sleet|freezing rain|ice/.test(weatherDescription)) {
    applyFactor('Winter Weather', 10, `Frozen precipitation in forecast ("${weatherData.description}") increases travel hazard.`, 'NOAA short forecast');
  }

  if (visibilityRiskScore !== null) {
    let visibilityImpact = 0;
    if (visibilityRiskScore >= 80) {
      visibilityImpact = 12;
    } else if (visibilityRiskScore >= 60) {
      visibilityImpact = 9;
    } else if (visibilityRiskScore >= 40) {
      visibilityImpact = 6;
    } else if (visibilityRiskScore >= 20) {
      visibilityImpact = 3;
    }
    if (visibilityImpact > 0) {
      const activeHoursNote =
        visibilityActiveHours !== null && trend.length > 0
          ? ` ${Math.round(visibilityActiveHours)}/${trend.length} trend hours show reduced-visibility signal.`
          : '';
      applyFactor(
        'Visibility',
        visibilityImpact,
        `Whiteout/visibility risk is ${visibilityRiskLevel || 'elevated'} (${Math.round(visibilityRiskScore)}/100).${activeHoursNote}`,
        weatherData?.visibilityRisk?.source || 'Derived weather visibility model',
      );
    }
  } else if (/fog|smoke|haze/.test(weatherDescription)) {
    applyFactor('Visibility', 6, `Reduced-visibility weather in forecast ("${weatherData.description}").`, 'NOAA short forecast');
  }

  if (Number.isFinite(trendMinFeelsLike) && trendMinFeelsLike <= -10) {
    applyFactor('Cold', 15, `Minimum apparent temperature in the window is ${Math.round(trendMinFeelsLike)}F.`, 'NOAA temp + windchill');
  } else if (Number.isFinite(trendMinFeelsLike) && trendMinFeelsLike <= 0) {
    applyFactor('Cold', 10, `Very cold apparent temperature in the window (${Math.round(trendMinFeelsLike)}F).`, 'NOAA temp + windchill');
  } else if (Number.isFinite(trendMinFeelsLike) && trendMinFeelsLike <= 15) {
    applyFactor('Cold', 6, `Cold apparent temperature in the window (${Math.round(trendMinFeelsLike)}F).`, 'NOAA temp + windchill');
  } else if (Number.isFinite(trendMinFeelsLike) && trendMinFeelsLike <= 25) {
    applyFactor('Cold', 3, `Cool apparent temperatures (${Math.round(trendMinFeelsLike)}F) reduce comfort and dexterity margin.`, 'NOAA temp + windchill');
  }

  if (extremeColdHours >= 3) {
    applyFactor('Cold', 6, `${extremeColdHours}/${trend.length} trend hours are at or below 0F apparent temperature.`, 'NOAA hourly trend');
  } else if (coldExposureHours >= 5) {
    applyFactor('Cold', 4, `${coldExposureHours}/${trend.length} trend hours are at or below 15F apparent temperature.`, 'NOAA hourly trend');
  }

  const heatRiskLevel = Number(heatRiskData?.level);
  if (Number.isFinite(heatRiskLevel) && heatRiskLevel >= 4) {
    applyFactor('Heat', 14, `Heat risk is ${heatRiskData?.label || 'Extreme'} with significant heat-stress potential in the selected window.`, heatRiskData?.source || 'Heat risk synthesis');
  } else if (Number.isFinite(heatRiskLevel) && heatRiskLevel >= 3) {
    applyFactor('Heat', 10, `Heat risk is ${heatRiskData?.label || 'High'} in the selected window.`, heatRiskData?.source || 'Heat risk synthesis');
  } else if (Number.isFinite(heatRiskLevel) && heatRiskLevel >= 2) {
    applyFactor('Heat', 6, `Heat risk is ${heatRiskData?.label || 'Elevated'} in the selected window.`, heatRiskData?.source || 'Heat risk synthesis');
  } else if (Number.isFinite(heatRiskLevel) && heatRiskLevel >= 1) {
    applyFactor('Heat', 2, `Heat risk is ${heatRiskData?.label || 'Guarded'}; monitor pace and hydration.`, heatRiskData?.source || 'Heat risk synthesis');
  } else if (Number.isFinite(trendMaxFeelsLike) && trendMaxFeelsLike >= 90) {
    applyFactor('Heat', 6, `Peak apparent temperature in the window reaches ${Math.round(trendMaxFeelsLike)}F.`, 'NOAA temp + humidity');
  } else if (Number.isFinite(trendMaxFeelsLike) && trendMaxFeelsLike >= 82 && heatExposureHours >= 4) {
    applyFactor('Heat', 3, `${heatExposureHours}/${trend.length} trend hours are warm (>=85F apparent).`, 'NOAA hourly trend');
  }

  if (rainfallData?.fallbackMode === 'zeroed_totals') {
    applyFactor('Surface Conditions', 4, 'Precipitation data unavailable (upstream outage) — surface conditions are unknown; treat as potentially hazardous.', rainfallData?.source || 'Open-Meteo precipitation history');
  } else if (Number.isFinite(rainPast24hIn) && rainPast24hIn >= 0.75) {
    applyFactor('Surface Conditions', 7, `Recent rainfall is heavy (${rainPast24hIn.toFixed(2)} in in 24h), increasing slick/trail-softening risk.`, rainfallData?.source || 'Open-Meteo precipitation history');
  } else if (Number.isFinite(rainPast24hIn) && rainPast24hIn >= 0.3) {
    applyFactor('Surface Conditions', 4, `Recent rainfall (${rainPast24hIn.toFixed(2)} in in 24h) can create slippery or muddy travel.`, rainfallData?.source || 'Open-Meteo precipitation history');
  }

  if (Number.isFinite(snowPast24hIn) && snowPast24hIn >= 6) {
    applyFactor('Surface Conditions', 8, `Recent snowfall is substantial (${snowPast24hIn.toFixed(1)} in in 24h), increasing trail and route uncertainty.`, rainfallData?.source || 'Open-Meteo precipitation history');
  } else if (Number.isFinite(snowPast24hIn) && snowPast24hIn >= 2) {
    applyFactor('Surface Conditions', 4, `Recent snowfall (${snowPast24hIn.toFixed(1)} in in 24h) can hide surface hazards and slow travel.`, rainfallData?.source || 'Open-Meteo precipitation history');
  }

  if (Number.isFinite(expectedRainWindowIn) && expectedRainWindowIn >= 0.5) {
    applyFactor('Storm', 6, `Expected rain in selected travel window is ${expectedRainWindowIn.toFixed(2)} in.`, rainfallData?.source || 'Open-Meteo precipitation forecast');
  } else if (Number.isFinite(expectedRainWindowIn) && expectedRainWindowIn >= 0.2) {
    applyFactor('Storm', 3, `Expected rain in selected travel window is ${expectedRainWindowIn.toFixed(2)} in.`, rainfallData?.source || 'Open-Meteo precipitation forecast');
  }

  if (Number.isFinite(expectedSnowWindowIn) && expectedSnowWindowIn >= 4) {
    applyFactor('Winter Weather', 7, `Expected snowfall in selected travel window is ${expectedSnowWindowIn.toFixed(1)} in.`, rainfallData?.source || 'Open-Meteo precipitation forecast');
  } else if (Number.isFinite(expectedSnowWindowIn) && expectedSnowWindowIn >= 1.5) {
    applyFactor('Winter Weather', 3, `Expected snowfall in selected travel window is ${expectedSnowWindowIn.toFixed(1)} in.`, rainfallData?.source || 'Open-Meteo precipitation forecast');
  }

  if (isDaytime === false && !isNightBeforeSunrise) {
    applyFactor('Darkness', 5, 'Selected forecast period is nighttime, reducing navigation margin and terrain visibility.', 'NOAA isDaytime flag');
  }

  if (Number.isFinite(tempRange) && tempRange >= 18) {
    applyFactor(
      'Weather Volatility',
      6,
      `Large ${effectiveTrendWindowHours}-hour temperature swing (${Math.round(tempRange)}F) suggests unstable conditions.`,
      'NOAA hourly trend',
    );
  }
  if (Number.isFinite(trendPeakGust) && trendPeakGust >= 45 && (!Number.isFinite(gust) || gust < 45)) {
    applyFactor('Wind', 6, `Peak gusts in the next ${effectiveTrendWindowHours} hours reach ${Math.round(trendPeakGust)} mph.`, 'NOAA hourly trend');
  }

  if (forecastLeadHours !== null && forecastLeadHours > 6) {
    let uncertaintyImpact = 2;
    if (forecastLeadHours >= 96) {
      uncertaintyImpact = 10;
    } else if (forecastLeadHours >= 72) {
      uncertaintyImpact = 8;
    } else if (forecastLeadHours >= 48) {
      uncertaintyImpact = 6;
    } else if (forecastLeadHours >= 24) {
      uncertaintyImpact = 4;
    }
    if (!alertsRelevantForSelectedTime) {
      uncertaintyImpact += 2;
    }
    applyFactor(
      'Forecast Uncertainty',
      Math.min(14, uncertaintyImpact),
      `Selected start is ${Math.round(forecastLeadHours)}h ahead; confidence is lower because fewer real-time feeds can be projected.`,
      'Forecast lead time',
    );
  }

  if (alertsRelevantForSelectedTime && Number.isFinite(alertsCount) && alertsCount > 0) {
    const listedEvents = alertEvents.length ? ` (${alertEvents.join(', ')})` : '';
    if (highestAlertSeverity === 'extreme') {
      applyFactor('Official Alert', 24, `${alertsCount} active NWS alert(s)${listedEvents} with EXTREME severity.`, 'NOAA/NWS Active Alerts');
    } else if (highestAlertSeverity === 'severe') {
      applyFactor('Official Alert', 16, `${alertsCount} active NWS alert(s)${listedEvents} with severe impacts possible.`, 'NOAA/NWS Active Alerts');
    } else if (highestAlertSeverity === 'moderate') {
      applyFactor('Official Alert', 10, `${alertsCount} active NWS alert(s)${listedEvents} indicate moderate hazard.`, 'NOAA/NWS Active Alerts');
    } else {
      applyFactor('Official Alert', 5, `${alertsCount} active NWS alert(s)${listedEvents} are in effect.`, 'NOAA/NWS Active Alerts');
    }
  }

  if (airQualityRelevantForScoring && Number.isFinite(usAqi)) {
    if (usAqi >= 201) {
      applyFactor('Air Quality', 20, `Air quality is hazardous (US AQI ${Math.round(usAqi)}).`, 'Open-Meteo Air Quality');
    } else if (usAqi >= 151) {
      applyFactor('Air Quality', 14, `Air quality is unhealthy (US AQI ${Math.round(usAqi)}).`, 'Open-Meteo Air Quality');
    } else if (usAqi >= 101) {
      applyFactor(
        'Air Quality',
        8,
        `Air quality is unhealthy for sensitive groups (US AQI ${Math.round(usAqi)}).`,
        'Open-Meteo Air Quality',
      );
    } else if (usAqi >= 51) {
      applyFactor('Air Quality', 3, `Air quality is moderate (US AQI ${Math.round(usAqi)}).`, 'Open-Meteo Air Quality');
    }
  }

  const fireLevel = fireRiskData?.level != null ? Number(fireRiskData.level) : null;
  if (fireLevel !== null && Number.isFinite(fireLevel) && fireLevel >= 4) {
    applyFactor('Fire Danger', 16, 'Extreme fire-weather/alert signal for this objective window.', fireRiskData?.source || 'Fire risk synthesis');
  } else if (fireLevel !== null && Number.isFinite(fireLevel) && fireLevel >= 3) {
    applyFactor('Fire Danger', 10, 'High fire-weather signal: elevated spread potential or fire-weather alerts.', fireRiskData?.source || 'Fire risk synthesis');
  } else if (fireLevel !== null && Number.isFinite(fireLevel) && fireLevel >= 2) {
    applyFactor('Fire Danger', 5, 'Elevated fire risk signal from weather, smoke, or alert context.', fireRiskData?.source || 'Fire risk synthesis');
  }

  const rawGroupImpacts = factors.reduce((acc, factor) => {
    const group = factor.group || 'weather';
    acc[group] = (acc[group] || 0) + Number(factor.impact || 0);
    return acc;
  }, {});
  const groupImpacts = Object.entries(rawGroupImpacts).reduce((acc, [group, rawImpact]) => {
    const cap = Number(groupCaps[group] || 100);
    const raw = Number.isFinite(rawImpact) ? Math.round(rawImpact) : 0;
    const capped = Math.min(raw, cap);
    acc[group] = { raw, capped, cap };
    return acc;
  }, {});
  const totalCappedImpact = Object.values(groupImpacts).reduce((sum, entry) => sum + Number(entry.capped || 0), 0);
  const score = Math.max(0, Math.round(100 - totalCappedImpact));

  let confidence = 100;
  const confidenceReasons = [];
  const applyConfidencePenalty = (points, reason) => {
    if (!Number.isFinite(points) || points <= 0) {
      return;
    }
    confidence -= points;
    if (reason) {
      confidenceReasons.push(reason);
    }
  };

  const weatherDataUnavailable = weatherDescription.includes('weather data unavailable');
  if (weatherDataUnavailable) {
    applyFactor('Weather Unavailable', 20, 'All weather data is unavailable — wind, precipitation, and temperature conditions are unknown.', 'System');
    applyConfidencePenalty(30, 'Complete weather data unavailable — do not rely on this report for go/no-go decisions.');
  }

  const nowMs = Date.now();
  const weatherIssuedMs = parseIsoTimeToMs(weatherData?.issuedTime);
  if (!weatherDataUnavailable && weatherIssuedMs === null) {
    applyConfidencePenalty(8, 'Weather issue time unavailable.');
  } else if (!weatherDataUnavailable && weatherIssuedMs !== null) {
    const weatherAgeHours = (nowMs - weatherIssuedMs) / (1000 * 60 * 60);
    if (weatherAgeHours > 18) {
      applyConfidencePenalty(12, `Weather issuance is ${Math.round(weatherAgeHours)}h old.`);
    } else if (weatherAgeHours > 10) {
      applyConfidencePenalty(7, `Weather issuance is ${Math.round(weatherAgeHours)}h old.`);
    } else if (weatherAgeHours > 6) {
      applyConfidencePenalty(4, `Weather issuance is ${Math.round(weatherAgeHours)}h old.`);
    }
  }

  if (trend.length < 6) {
    applyConfidencePenalty(6, 'Limited hourly trend depth (<6 points).');
  }

  if (avalancheRelevant) {
    if (avalancheUnknown) {
      applyConfidencePenalty(20, 'Avalanche danger is unknown for this objective.');
    } else {
      const avalanchePublishedMs = parseIsoTimeToMs(avalancheData?.publishedTime);
      if (avalanchePublishedMs === null) {
        applyConfidencePenalty(8, 'Avalanche bulletin publish time unavailable.');
      } else {
        const avalancheAgeHours = (nowMs - avalanchePublishedMs) / (1000 * 60 * 60);
        if (avalancheAgeHours > 72) {
          applyConfidencePenalty(12, `Avalanche bulletin is ${Math.round(avalancheAgeHours)}h old.`);
        } else if (avalancheAgeHours > 48) {
          applyConfidencePenalty(8, `Avalanche bulletin is ${Math.round(avalancheAgeHours)}h old.`);
        } else if (avalancheAgeHours > 24) {
          applyConfidencePenalty(4, `Avalanche bulletin is ${Math.round(avalancheAgeHours)}h old.`);
        }
      }
    }
  }

  if (alertsRelevantForSelectedTime && alertsData?.status === 'unavailable') {
    applyConfidencePenalty(8, 'NWS alerts feed unavailable.');
  } else if (!alertsRelevantForSelectedTime) {
    applyConfidencePenalty(4, 'NWS alerts are current-state only and not forecast-valid for the selected start time.');
  }
  if (airQualityRelevantForScoring && airQualityData?.status === 'unavailable') {
    applyConfidencePenalty(6, 'Air quality feed unavailable.');
  } else if (airQualityRelevantForScoring && airQualityData?.status === 'no_data') {
    applyConfidencePenalty(3, 'Air quality point data unavailable.');
  }
  const rainfallAnchorMs = parseIsoTimeToMs(rainfallData?.anchorTime);
  if (rainfallData?.status === 'unavailable') {
    applyConfidencePenalty(5, 'Precipitation history feed unavailable.');
  } else if (rainfallData?.status === 'no_data') {
    applyConfidencePenalty(3, 'Precipitation history has no usable anchor/sample data.');
  } else if (rainfallData?.fallbackMode === 'zeroed_totals') {
    applyConfidencePenalty(8, 'Precipitation totals are fallback estimates due upstream feed outage.');
  } else if (rainfallAnchorMs === null) {
    applyConfidencePenalty(3, 'Precipitation anchor time unavailable.');
  } else {
    const rainfallAgeHours = (nowMs - rainfallAnchorMs) / (1000 * 60 * 60);
    if (rainfallAgeHours > 36) {
      applyConfidencePenalty(7, `Precipitation anchor is ${Math.round(rainfallAgeHours)}h old.`);
    } else if (rainfallAgeHours > 18) {
      applyConfidencePenalty(4, `Precipitation anchor is ${Math.round(rainfallAgeHours)}h old.`);
    } else if (rainfallAgeHours > 10) {
      applyConfidencePenalty(2, `Precipitation anchor is ${Math.round(rainfallAgeHours)}h old.`);
    }
  }
  if (forecastLeadHours !== null && forecastLeadHours >= 72) {
    applyConfidencePenalty(8, `Selected start is ${Math.round(forecastLeadHours)}h ahead (lower forecast certainty).`);
  } else if (forecastLeadHours !== null && forecastLeadHours >= 48) {
    applyConfidencePenalty(6, `Selected start is ${Math.round(forecastLeadHours)}h ahead (lower forecast certainty).`);
  } else if (forecastLeadHours !== null && forecastLeadHours >= 24) {
    applyConfidencePenalty(4, `Selected start is ${Math.round(forecastLeadHours)}h ahead (lower forecast certainty).`);
  }
  if (!fireRiskData || fireRiskData.status === 'unavailable') {
    applyConfidencePenalty(3, 'Fire risk synthesis unavailable.');
  }

  confidence = Math.max(20, Math.min(100, Math.round(confidence)));

  const factorsSorted = [...factors].sort((a, b) => b.impact - a.impact);
  const primaryHazard = factorsSorted[0]?.hazard || 'None';
  const sourcesUsed = [
    'NOAA/NWS hourly forecast',
    avalancheRelevant ? 'Avalanche center forecast' : null,
    alertsRelevantForSelectedTime && (alertsData?.status === 'ok' || alertsData?.status === 'none' || alertsData?.status === 'none_for_selected_start')
      ? 'NOAA/NWS active alerts'
      : null,
    airQualityRelevantForScoring && (airQualityData?.status === 'ok' || airQualityData?.status === 'no_data')
      ? 'Open-Meteo air quality'
      : null,
    (rainfallData?.status === 'ok' || rainfallData?.status === 'partial' || rainfallData?.status === 'no_data') && rainfallData?.fallbackMode !== 'zeroed_totals'
      ? 'Open-Meteo precipitation history/forecast'
      : null,
    heatRiskData?.status === 'ok' ? 'Heat risk synthesis (forecast + lower-terrain adjustment)' : null,
    fireRiskData?.status === 'ok' ? 'Fire risk synthesis (NOAA + NWS + AQI)' : null,
  ].filter(Boolean);

  return {
    score,
    confidence,
    primaryHazard,
    explanations: explanations.length > 0 ? explanations : ['Conditions appear stable for the selected plan window.'],
    factors: factorsSorted,
    groupImpacts,
    confidenceReasons,
    sourcesUsed,
    airQualityCategory: aqiCategory,
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

  const maxLevel = Math.max(...levels);
  const minLevel = Math.min(...levels);
  const maxCount = levels.filter((level) => level === maxLevel).length;

  return maxLevel;
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

const fetchWithTimeout = createFetchWithTimeout(REQUEST_TIMEOUT_MS);
let avalancheMapLayerCache = {
  fetchedAt: 0,
  data: null,
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

const fetchObjectiveElevationFt = async (lat, lon, fetchOptions) => {
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
    console.warn('[Elevation] USGS lookup failed:', error.message);
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
    console.warn('[Elevation] Open-Meteo lookup failed:', error.message);
  }

  return { elevationFt: null, source: null };
};

const getAvalancheMapLayer = async (fetchOptions) => {
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
      avyLog(`[Avy] map-layer refresh failed, serving cached copy: ${error.message}`);
      return avalancheMapLayerCache.data;
    }
    throw error;
  }
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

const { createUnavailableSnowpackData, fetchSnowpackData } = createSnowpackService({
  fetchWithTimeout,
  formatIsoDateUtc,
  shiftIsoDateUtc,
  haversineKm,
  stationCacheTtlMs: SNOTEL_STATION_CACHE_TTL_MS,
});

const { createUnavailableWeatherData, fetchOpenMeteoWeatherFallback } = createWeatherDataService({
  fetchWithTimeout,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
});

const { fetchWeatherAlertsData, fetchAirQualityData } = createAlertsService({ fetchWithTimeout });

const { fetchRecentRainfallData } = createPrecipitationService({
  fetchWithTimeout,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
});

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

const safetyHandler = async (req, res) => {
  const startedAt = Date.now();
  const { lat, lon, date, start, travel_window_hours: travelWindowHoursRaw, travelWindowHours, name } = req.query;
  const logName = typeof name === 'string' ? name.trim() || null : null;
  const logIp = req.ip || null;
  const logUserAgent = req.headers['user-agent'] || null;
  const baseLogFields = { ip: logIp, userAgent: logUserAgent, name: logName };

  if (!lat || !lon) {
    logReportRequest({ statusCode: 400, lat: lat || null, lon: lon || null, date: date || null, durationMs: Date.now() - startedAt, ...baseLogFields });
    return res.status(400).json({ error: 'Latitude and longitude are required' });
  }

  const parsedLat = Number(lat);
  const parsedLon = Number(lon);
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon) || parsedLat < -90 || parsedLat > 90 || parsedLon < -180 || parsedLon > 180) {
    logReportRequest({ statusCode: 400, lat: parsedLat, lon: parsedLon, date: date || null, durationMs: Date.now() - startedAt, ...baseLogFields });
    return res.status(400).json({ error: 'Latitude/longitude must be valid decimal coordinates.' });
  }

  const requestedDate = typeof date === 'string' ? date.trim() : '';
  if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    logReportRequest({ statusCode: 400, lat: parsedLat, lon: parsedLon, date: requestedDate, durationMs: Date.now() - startedAt, ...baseLogFields });
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
  }
  const requestedStartClock = parseStartClock(typeof start === 'string' ? start : '');
  const requestedTravelWindowHours = clampTravelWindowHours(
    typeof travelWindowHoursRaw === 'string' ? travelWindowHoursRaw : typeof travelWindowHours === 'string' ? travelWindowHours : null,
    12,
  );

  // Pre-initialize everything to avoid "access before initialization" errors
  let avalancheData = createUnknownAvalancheData("no_center_coverage");
  let solarData = { sunrise: "N/A", sunset: "N/A", dayLength: "N/A" };
  let gearSuggestions = [];
  let weatherData = createUnavailableWeatherData({ lat: parsedLat, lon: parsedLon, forecastDate: requestedDate || null });
  let trailStatus = "Unknown";
  let terrainConditionData = deriveTerrainCondition(weatherData);
  let selectedForecastDate = requestedDate || null;
  let selectedForecastPeriod = null;
  let forecastDateRange = { start: null, end: null };
  let alertsData = createUnavailableAlertsData("unavailable");
  let airQualityData = createUnavailableAirQualityData("unavailable");
  let rainfallData = createUnavailableRainfallData("unavailable");
  let snowpackData = createUnavailableSnowpackData("unavailable");
  let fireRiskData = createUnavailableFireRiskData("unavailable");
  let heatRiskData = createUnavailableHeatRiskData("unavailable");

  try {
    const fetchOptions = { headers: DEFAULT_FETCH_HEADERS };
    const avyMapLayerPromise = getAvalancheMapLayer(fetchOptions);

    try {
      // 1. Get NOAA grid data
      const pointsRes = await fetchWithTimeout(`https://api.weather.gov/points/${parsedLat},${parsedLon}`, fetchOptions);
      if (!pointsRes.ok) throw new Error('Failed to fetch NOAA points (Location might be outside US)');
      const pointsData = await pointsRes.json();
      const pointElevationMeters = Number(pointsData?.properties?.elevation?.value);
      let objectiveElevationFt = Number.isFinite(pointElevationMeters) ? Math.round(pointElevationMeters * FT_PER_METER) : null;
      let objectiveElevationSource = Number.isFinite(pointElevationMeters) ? 'NOAA points metadata' : null;
      if (!Number.isFinite(objectiveElevationFt)) {
        const fallbackElevation = await fetchObjectiveElevationFt(parsedLat, parsedLon, fetchOptions);
        objectiveElevationFt = fallbackElevation.elevationFt;
        objectiveElevationSource = fallbackElevation.source;
      }

      const hourlyForecastUrl = pointsData.properties.forecastHourly;

      // 2. Get Forecasts
      const hourlyRes = await fetchWithTimeout(hourlyForecastUrl, fetchOptions);
      if (!hourlyRes.ok) throw new Error(`NOAA hourly forecast failed: ${hourlyRes.status}`);
      const hourlyData = await hourlyRes.json();

      const periods = hourlyData?.properties?.periods || [];
      if (!periods.length) throw new Error('No hourly forecast data available for this location');

      const availableDates = [...new Set(periods.map((p) => (p.startTime || '').slice(0, 10)).filter(Boolean))];
      forecastDateRange = { start: availableDates[0] || null, end: availableDates[availableDates.length - 1] || null };

      if (!selectedForecastDate) {
        selectedForecastDate = (periods[0].startTime || '').slice(0, 10);
      }

      let forecastStartIndex = periods.findIndex((p) => (p.startTime || '').slice(0, 10) === selectedForecastDate);
      if (forecastStartIndex === -1 && requestedDate) {
        logReportRequest({ statusCode: 400, lat: parsedLat, lon: parsedLon, date: requestedDate, durationMs: Date.now() - startedAt, ...baseLogFields });
        return res.status(400).json({
          error: 'Requested forecast date is outside NOAA forecast range',
          details: `Choose a date between ${forecastDateRange.start} and ${forecastDateRange.end}.`,
          availableRange: forecastDateRange
        });
      }
      if (forecastStartIndex === -1) forecastStartIndex = 0;
      const dayPeriods = periods
        .map((period, idx) => ({ period, idx }))
        .filter((entry) => (entry.period?.startTime || '').slice(0, 10) === selectedForecastDate);

      if (requestedStartClock && dayPeriods.length > 0) {
        const targetIso = buildPlannedStartIso({
          selectedDate: selectedForecastDate,
          startClock: requestedStartClock,
          referenceIso: dayPeriods[0].period?.startTime || null,
        });
        const targetMs = parseIsoTimeToMs(targetIso);
        if (targetMs !== null) {
          const firstAtOrAfter = dayPeriods.find((entry) => {
            const periodStartMs = parseIsoTimeToMs(entry.period?.startTime);
            return periodStartMs !== null && periodStartMs >= targetMs;
          });
          if (firstAtOrAfter) {
            forecastStartIndex = firstAtOrAfter.idx;
          } else {
            forecastStartIndex = dayPeriods[dayPeriods.length - 1].idx;
          }
        }
      }

      selectedForecastPeriod = periods[forecastStartIndex];

      // Build 24-hour temperature context from selected period for freeze/thaw and day/night analysis.
      const temperatureContextPoints = periods
        .slice(forecastStartIndex, forecastStartIndex + 24)
        .map((p) => ({
          timeIso: p?.startTime || null,
          tempF: Number.isFinite(Number(p?.temperature)) ? Number(p.temperature) : null,
          isDaytime: typeof p?.isDaytime === 'boolean' ? p.isDaytime : null,
        }));
      const temperatureContext24h = buildTemperatureContext24h({
        points: temperatureContextPoints,
        timeZone: pointsData?.properties?.timeZone || null,
        windowHours: 24,
      });

      const forecastTrendHours = clampTravelWindowHours(requestedTravelWindowHours, 12);
      // Build trend window from selected hour using user-selected travel window length (up to 24h).
      const hourlyTrend = periods.slice(forecastStartIndex, forecastStartIndex + forecastTrendHours).map((p, offset) => {
        const rowIndex = forecastStartIndex + offset;
        const windSpeedValue = parseWindMph(p.windSpeed, 0);
        const { gustMph: windGustValue } = inferWindGustFromPeriods(periods, rowIndex, windSpeedValue);
        const trendTemp = Number.isFinite(p.temperature) ? p.temperature : 0;
        const trendPrecip = Number.isFinite(p?.probabilityOfPrecipitation?.value) ? p.probabilityOfPrecipitation.value : 0;
        const trendHumidity = Number.isFinite(p?.relativeHumidity?.value) ? p.relativeHumidity.value : null;
        const trendDewPoint = normalizeNoaaDewPointF(p?.dewpoint);
        const trendCloudCover = resolveNoaaCloudCover(p).value;
        const trendPressure = normalizeNoaaPressureHpa(p?.barometricPressure);

        return {
          time: hourLabelFromIso(p.startTime, pointsData?.properties?.timeZone || null),
          timeIso: p.startTime || null,
          temp: trendTemp,
          wind: windSpeedValue,
          gust: windGustValue,
          windDirection: findNearestWindDirection(periods, rowIndex),
          precipChance: trendPrecip,
          humidity: trendHumidity,
          dewPoint: Number.isFinite(Number(trendDewPoint)) ? Number(trendDewPoint) : null,
          cloudCover: Number.isFinite(Number(trendCloudCover)) ? Number(trendCloudCover) : null,
          pressure: trendPressure,
          condition: p.shortForecast || 'Unknown',
          isDaytime: typeof p?.isDaytime === 'boolean' ? p.isDaytime : null,
        };
      });

      const currentWindSpeed = parseWindMph(selectedForecastPeriod?.windSpeed, 0);
      const inferredCurrentGust = inferWindGustFromPeriods(periods, forecastStartIndex, currentWindSpeed);
      const currentWindGust = inferredCurrentGust.gustMph;
      const currentCloudCover = resolveNoaaCloudCover(selectedForecastPeriod);
      const windGustSource =
        inferredCurrentGust.source === 'reported'
          ? 'NOAA'
          : inferredCurrentGust.source === 'inferred_nearby'
            ? 'NOAA (inferred from nearby gust hours)'
            : 'Estimated from NOAA sustained wind';
      const currentTemp = Number.isFinite(selectedForecastPeriod?.temperature) ? selectedForecastPeriod.temperature : 0;
      const feelsLike = computeFeelsLikeF(currentTemp, currentWindSpeed);
      const currentDewPoint = normalizeNoaaDewPointF(selectedForecastPeriod?.dewpoint);
      const currentPressure = normalizeNoaaPressureHpa(selectedForecastPeriod?.barometricPressure);
      const elevationForecastBands = buildElevationForecastBands({
        baseElevationFt: objectiveElevationFt,
        tempF: currentTemp,
        windSpeedMph: currentWindSpeed,
        windGustMph: currentWindGust,
      });

      weatherData = {
        temp: currentTemp,
        feelsLike: feelsLike,
        dewPoint: currentDewPoint,
        elevation: objectiveElevationFt,
        elevationSource: objectiveElevationSource,
        elevationUnit: 'ft',
        description: selectedForecastPeriod?.shortForecast || 'Unknown',
        windSpeed: currentWindSpeed,
        windGust: currentWindGust,
        windDirection: findNearestWindDirection(periods, forecastStartIndex),
        pressure: currentPressure,
        humidity: Number.isFinite(selectedForecastPeriod?.relativeHumidity?.value) ? selectedForecastPeriod.relativeHumidity.value : 0,
        cloudCover: currentCloudCover.value,
        precipChance: Number.isFinite(selectedForecastPeriod?.probabilityOfPrecipitation?.value) ? selectedForecastPeriod.probabilityOfPrecipitation.value : 0,
        isDaytime: selectedForecastPeriod?.isDaytime ?? null,
        issuedTime: hourlyData?.properties?.updateTime || hourlyData?.properties?.generatedAt || null,
        timezone: pointsData?.properties?.timeZone || null,
        forecastStartTime: selectedForecastPeriod?.startTime || null,
        forecastEndTime: selectedForecastPeriod?.endTime || null,
        forecastDate: selectedForecastDate,
        trend: hourlyTrend,
        temperatureContext24h,
        visibilityRisk: null,
        sourceDetails: {
          primary: 'NOAA',
          blended: false,
          fieldSources: {
            temp: 'NOAA',
            feelsLike: 'NOAA',
            dewPoint: Number.isFinite(Number(currentDewPoint)) ? 'NOAA' : 'Unavailable',
            description: 'NOAA',
            windSpeed: 'NOAA',
            windGust: windGustSource,
            windDirection: 'NOAA',
            pressure: currentPressure !== null ? 'NOAA' : 'Unavailable',
            humidity: 'NOAA',
            cloudCover: currentCloudCover.source,
            precipChance: 'NOAA',
            isDaytime: 'NOAA',
            issuedTime: 'NOAA',
            timezone: 'NOAA',
            forecastStartTime: 'NOAA',
            forecastEndTime: 'NOAA',
            trend: 'NOAA',
            temperatureContext24h: 'NOAA',
            visibilityRisk: 'Derived from NOAA weather fields',
          },
        },
        elevationForecast: elevationForecastBands,
        elevationForecastNote:
          objectiveElevationFt !== null
            ? `Estimated from objective elevation down through terrain bands using lapse-rate adjustments per 1,000 ft. Baseline elevation source: ${objectiveElevationSource || 'unknown source'}.`
            : 'Objective elevation unavailable from NOAA and fallback elevation services; elevation-based estimate could not be generated.',
        forecastLink: `https://forecast.weather.gov/MapClick.php?lat=${parsedLat}&lon=${parsedLon}`
      };

      weatherData.visibilityRisk = buildVisibilityRisk(weatherData);

      if (!weatherData.windDirection && currentWindSpeed <= 2) {
        weatherData.windDirection = 'CALM';
      }

      terrainConditionData = deriveTerrainCondition(weatherData);
      trailStatus = terrainConditionData.label;

      // NOAA remains primary; supplement missing/noisy fields with Open-Meteo when needed.
      if (
        !weatherData.windDirection ||
        !weatherData.issuedTime ||
        weatherData.pressure === null ||
        weatherData.pressure === undefined ||
        weatherData.cloudCover === null ||
        weatherData.cloudCover === undefined ||
        (Array.isArray(weatherData.trend) && weatherData.trend.length < 6)
      ) {
        try {
          const supplement = await fetchOpenMeteoWeatherFallback({
            lat: parsedLat,
            lon: parsedLon,
            selectedDate: selectedForecastDate,
            startClock: requestedStartClock,
            fetchOptions,
            objectiveElevationFt,
            objectiveElevationSource,
            trendHours: requestedTravelWindowHours,
          });
          const blended = blendNoaaWeatherWithFallback(weatherData, supplement.weatherData);
          weatherData = blended.weatherData;
          if (blended.usedSupplement) {
            terrainConditionData = deriveTerrainCondition(weatherData);
            trailStatus = terrainConditionData.label;
            console.warn(`NOAA weather supplemented with Open-Meteo fields: ${blended.supplementedFields.join(', ')}`);
          }
        } catch (supplementError) {
          console.warn('NOAA weather supplement from Open-Meteo failed; continuing with NOAA-only weather.', supplementError);
        }
      }

      // 2.5 Get Solar Data
      try {
        const solarDate = selectedForecastDate || requestedDate || new Date().toISOString().slice(0, 10);
        const solarRes = await fetchWithTimeout(`https://api.sunrisesunset.io/json?lat=${parsedLat}&lng=${parsedLon}&date=${solarDate}`, fetchOptions);
        if (solarRes.ok) {
          const solarJson = await solarRes.json();
          if (solarJson.status === "OK") {
            solarData = {
              sunrise: solarJson.results.sunrise,
              sunset: solarJson.results.sunset,
              dayLength: solarJson.results.day_length
            };
          }
        }
      } catch (e) {
        console.error("Solar API error:", e);
      }
    } catch (weatherError) {
      console.error("Weather API error:", weatherError);
      if (!selectedForecastDate) {
        selectedForecastDate = requestedDate || new Date().toISOString().slice(0, 10);
      }

      try {
        let fallbackElevationFt = typeof weatherData?.elevation === 'number' ? weatherData.elevation : null;
        let fallbackElevationSource = weatherData?.elevationSource || null;
        if (!Number.isFinite(fallbackElevationFt)) {
          const fallbackElevation = await fetchObjectiveElevationFt(parsedLat, parsedLon, fetchOptions);
          fallbackElevationFt = fallbackElevation.elevationFt;
          fallbackElevationSource = fallbackElevation.source;
        }

        const fallback = await fetchOpenMeteoWeatherFallback({
          lat: parsedLat,
          lon: parsedLon,
          selectedDate: selectedForecastDate,
          startClock: requestedStartClock,
          fetchOptions,
          objectiveElevationFt: Number.isFinite(fallbackElevationFt) ? fallbackElevationFt : null,
          objectiveElevationSource: fallbackElevationSource,
          trendHours: requestedTravelWindowHours,
        });

        weatherData = fallback.weatherData;
        selectedForecastDate = fallback.selectedForecastDate;
        terrainConditionData = fallback.terrainCondition || deriveTerrainCondition(weatherData);
        trailStatus = terrainConditionData.label;
        forecastDateRange = fallback.forecastDateRange;
        console.warn("NOAA weather unavailable; served Open-Meteo fallback weather.");
      } catch (fallbackError) {
        console.error("Weather fallback API error:", fallbackError);
        weatherData = createUnavailableWeatherData({ lat: parsedLat, lon: parsedLon, forecastDate: selectedForecastDate });
        terrainConditionData = deriveTerrainCondition(weatherData);
        trailStatus = terrainConditionData.label;
      }
    }

  const airQualityTargetTime =
    selectedForecastPeriod?.startTime ||
    (selectedForecastDate ? `${selectedForecastDate}T12:00:00Z` : new Date().toISOString());
  const objectiveTimeZone = typeof weatherData?.timezone === 'string' ? weatherData.timezone.trim() : '';
  const objectiveTodayDate = dateKeyInTimeZone(new Date(), objectiveTimeZone || null);
  const selectedDateForAirQuality = selectedForecastDate || requestedDate || objectiveTodayDate;
  const useCurrentDayAirQuality =
    Boolean(selectedDateForAirQuality)
    && Boolean(objectiveTodayDate)
    && selectedDateForAirQuality === objectiveTodayDate;
  const alertTargetTimeIso = buildPlannedStartIso({
    selectedDate: selectedForecastDate || requestedDate || '',
    startClock: requestedStartClock,
    referenceIso: weatherData?.forecastStartTime || selectedForecastPeriod?.startTime || weatherData?.issuedTime || null,
  });

  const parallelBatchPromise = Promise.allSettled([
    fetchWeatherAlertsData(parsedLat, parsedLon, fetchOptions, alertTargetTimeIso),
    useCurrentDayAirQuality
      ? fetchAirQualityData(parsedLat, parsedLon, airQualityTargetTime, fetchOptions)
      : Promise.resolve({
          ...createUnavailableAirQualityData('not_applicable_future_date'),
          note: 'Air quality is current-day only and is not applied to future-date forecasts.',
        }),
    fetchRecentRainfallData(parsedLat, parsedLon, alertTargetTimeIso || airQualityTargetTime, requestedTravelWindowHours, fetchOptions),
    fetchSnowpackData(parsedLat, parsedLon, selectedForecastDate, fetchOptions),
  ]);

	    // 3. Get Live Avalanche Data using Map Layer + Point in Polygon
	    try {
	      const avyJson = await avyMapLayerPromise;
	      if (avyJson?.features) {
        const zoneMatch = findMatchingAvalancheZone(avyJson.features, parsedLat, parsedLon);
        const matchingZone = zoneMatch.feature;

	        if (matchingZone) {
            if (zoneMatch.mode === 'nearest') {
              avyLog(
                `[Avy] No direct polygon match for ${parsedLat},${parsedLon}; using nearest zone fallback ` +
                  `at ${Math.round(Number(zoneMatch.fallbackDistanceKm || 0))} km.`,
              );
            }
	          const props = matchingZone.properties;
	          const zoneId = matchingZone.id; // Use the feature ID (e.g. 1648 for West Slopes South)
	          const levelMap = ["None", "Low", "Moderate", "Considerable", "High", "Extreme"];
	          const mainLvl = parseInt(props.danger_level) || 0;
          const reportedRisk = String(props.danger || "").trim();
          const normalizedRisk = reportedRisk.toLowerCase();
          const travelAdviceText = String(props.travel_advice || "");
          const normalizedTravelAdvice = travelAdviceText.toLowerCase();
          const offSeasonFlag = props.off_season === true;
          const hasIssuedWindow = Boolean(props.start_date || props.end_date);
          const hasNoForecastLanguage = /no (current )?avalanche forecast|outside (the )?forecast season|not issuing forecasts|forecast season has ended|off[- ]?season/.test(
            `${normalizedRisk} ${normalizedTravelAdvice}`,
          );
          const hasRatedDangerWord = /low|moderate|considerable|high|extreme/.test(normalizedRisk);
          const noRatingForecast = mainLvl <= 0 && !hasRatedDangerWord;
          const centerNoActiveForecast =
            offSeasonFlag
            || hasNoForecastLanguage
            || (!hasIssuedWindow && noRatingForecast);
          
			          avalancheData = {
			            center: props.center,
			            center_id: props.center_id,
			            zone: props.name,
			            risk: centerNoActiveForecast ? "Unknown" : (reportedRisk || "No Rating"),
			            dangerLevel: (centerNoActiveForecast || noRatingForecast) ? 0 : mainLvl,
			            dangerUnknown: centerNoActiveForecast || noRatingForecast,
                  relevant: true,
                  relevanceReason: null,
			            coverageStatus: centerNoActiveForecast ? "no_active_forecast" : "reported",
			            link: resolveAvalancheCenterLink({
                    centerId: props.center_id,
                    link: props.link,
                    centerLink: props.center_link,
                    lat: parsedLat,
                    lon: parsedLon,
                  }),
			            bottomLine: centerNoActiveForecast
                    ? (cleanForecastText(travelAdviceText) || AVALANCHE_OFF_SEASON_MESSAGE)
                    : props.travel_advice, // Primary Fallback
			            problems: [],
			            publishedTime: centerNoActiveForecast ? null : (props.start_date || props.published_time || null),
                  expiresTime: centerNoActiveForecast ? null : firstNonEmptyString(props.end_date, props.expires, props.expire_time),
	            elevations: (centerNoActiveForecast || noRatingForecast)
                ? null
                : (() => {
                    const parseLevel = (val) => {
                      const n = parseInt(val);
                      return Number.isFinite(n) ? n : mainLvl;
                    };
                    const l = parseLevel(props.danger_low);
                    const m = parseLevel(props.danger_mid);
                    const u = parseLevel(props.danger_high);
                    return {
                      below: { level: l, label: levelMap[l] || 'Unknown' },
                      at: { level: m, label: levelMap[m] || 'Unknown' },
                      above: { level: u, label: levelMap[u] || 'Unknown' }
                    };
                  })()
	          };

		          // TRY TO GET THE REAL BOTTOM LINE BY PRODUCT ID
			          try {
			            avyLog(`[Avy] Zone: ${props.name}, ID: ${zoneId}, Center: ${props.center_id}`);
		            let detailDet = null;
                let detailProblems = [];
		            const normalizedLink = normalizeExternalLink(props.link);
		            const zoneSlugRaw = normalizedLink?.split('#/')[1] || normalizedLink?.split('/').filter(Boolean).pop();
		            const zoneSlug = zoneSlugRaw ? String(zoneSlugRaw).trim().replace(/^\/+|\/+$/g, '') : null;
		            const detailAttempts = [];

	            if (props.center_id && zoneId) {
	              detailAttempts.push({
	                label: 'center forecast query',
	                url: `https://api.avalanche.org/v2/public/product?type=forecast&center_id=${props.center_id}&zone_id=${zoneId}`
	              });
	            }
	            if (zoneId) {
	              detailAttempts.push({
	                label: 'product id query',
	                url: `https://api.avalanche.org/v2/public/product/${zoneId}`
	              });
	            }
	            if (props.center_id && zoneSlug) {
	              detailAttempts.push({
	                label: 'slug forecast query',
	                url: `https://api.avalanche.org/v2/public/product?type=forecast&center_id=${props.center_id}&zone_id=${encodeURIComponent(zoneSlug)}`
	              });
	            }

		            const detailSettled = await Promise.allSettled(
                detailAttempts.map(async (attempt) => {
                  avyLog(`[Avy] Trying ${attempt.label}: ${attempt.url}`);
                  const candidateRes = await fetchWithTimeout(attempt.url, fetchOptions);
                  if (!candidateRes.ok) throw new Error(`${attempt.label} HTTP ${candidateRes.status}`);
                  const candidateText = await candidateRes.text();
                  const candidatePayloads = parseAvalancheDetailPayloads(candidateText);
                  if (!candidatePayloads.length) throw new Error(`${attempt.label} non-JSON payload`);
                  const bestCandidate = pickBestAvalancheDetailCandidate({
                    payloads: candidatePayloads,
                    centerId: props.center_id,
                    zoneId,
                    zoneSlug,
                    zoneName: props.name,
                    cleanForecastText,
                  });
                  if (!bestCandidate) throw new Error(`${attempt.label} shell data`);
                  return { attempt, ...bestCandidate };
                })
              );
              const detailWinners = detailSettled
                .filter((r) => r.status === 'fulfilled')
                .map((r) => r.value)
                .sort((a, b) => b.score - a.score);
              if (detailWinners.length) {
                const winner = detailWinners[0];
                detailDet = winner.candidate;
                detailProblems = winner.problems;
                avyLog(
                  `[Avy] Using ${winner.attempt.label} for ${props.center_id} ` +
                    `(parallel winner, score ${winner.score}, problems ${detailProblems.length}).`,
                );
              } else {
                detailSettled.forEach((r, i) => {
                  if (r.status === 'rejected') {
                    avyLog(`[Avy] ${detailAttempts[i]?.label} parse/fetch error: ${r.reason?.message || r.reason}`);
                  }
                });
              }

		            // MWAC occasionally returns generic API link values; prefer a direct forecast page link fallback.
		            if (props.center_id === 'MWAC') {
		              if (!avalancheData.link || avalancheData.link.includes('api.avalanche.org') || avalancheData.link.length < 30) {
		                avalancheData.link = "https://www.mountwashingtonavalanchecenter.org/forecasts/#/presidential-range";
		              }
		            }

		            // CAIC-specific behavior:
		            // Prefer official center text and do not inject generated summaries.
			            if (props.center_id === 'CAIC') {
			               avyLog('[Avy] CAIC detected. Preferring official center summary text.');
                   avalancheData.link = resolveAvalancheCenterLink({
                     centerId: props.center_id,
                     link: props.link,
                     centerLink: props.center_link,
                     lat: parsedLat,
                     lon: parsedLon,
                   });
		            }

	            if (detailDet) {
	              let det = detailDet;
	              if (det && Object.keys(det).length > 5) { // Ensure it's not an empty shell
	                // Try all known summary field names used by different centers
	                const finalBL = det.bottom_line || 
	                                det.bottom_line_summary || 
                                det.bottom_line_summary_text || 
                                det.overall_summary || 
                                det.summary;
                
	                avyLog(`[Avy] Data retrieved for ${props.center_id}. BL length: ${finalBL?.length || 0}`);
                
                if (det.published_time || det.updated_at) {
                  avalancheData.publishedTime = det.published_time || det.updated_at;
                }
                const inferredExpiry = inferAvalancheExpiresTime(det);
                if (inferredExpiry) {
                  avalancheData.expiresTime = inferredExpiry;
                }

                if (finalBL && finalBL.length > 20) {
                  avalancheData.bottomLine = cleanForecastText(finalBL);
                }
                
	                const fetchedProblems = detailProblems.length > 0
                    ? detailProblems
                    : getAvalancheProblemsFromDetail(det);
	                if (fetchedProblems.length > 0) {
	                  avalancheData.problems = fetchedProblems;
	                }

                // Update elevations if the product has more specific data
                const safeLevel = (val) => { const n = parseInt(val, 10); return Number.isFinite(n) ? n : 0; };
                if (det.danger && det.danger.length > 0) {
                   const currentDay = det.danger.find(d => d.valid_day === 'current') || det.danger[0];
                   const safeLabel = (lvl) => (Array.isArray(levelMap) && levelMap[lvl]) ? levelMap[lvl] : 'Unknown';
                   avalancheData.elevations = {
                     below: { level: safeLevel(currentDay.lower), label: safeLabel(safeLevel(currentDay.lower)) },
                     at: { level: safeLevel(currentDay.middle), label: safeLabel(safeLevel(currentDay.middle)) },
                     above: { level: safeLevel(currentDay.upper), label: safeLabel(safeLevel(currentDay.upper)) }
                   };
                } else if (det.danger_low) {
                  const safeLabel = (lvl) => (Array.isArray(levelMap) && levelMap[lvl]) ? levelMap[lvl] : 'Unknown';
                  avalancheData.elevations = {
                    below: { level: safeLevel(det.danger_low), label: safeLabel(safeLevel(det.danger_low)) },
                    at: { level: safeLevel(det.danger_mid), label: safeLabel(safeLevel(det.danger_mid)) },
                    above: { level: safeLevel(det.danger_high), label: safeLabel(safeLevel(det.danger_high)) }
	                  };
	                }
	              }
		            } else {
		              avyLog(`[Avy] Fetch Failed: no usable detail payload from forecast/product endpoints.`);
		            }
		          } catch (e) { avyLog("[Avy] Error:", e.message); }

          // Scraper Fallback for Detail
	          const hasGenericBottomLine =
	            !avalancheData.bottomLine ||
	            avalancheData.bottomLine === props.travel_advice ||
	            avalancheData.bottomLine.startsWith("OFFICIAL SUMMARY:");
	          const hasDetailedBottomLine =
	            typeof avalancheData.bottomLine === 'string' &&
	            avalancheData.bottomLine.length >= 120 &&
	            !hasGenericBottomLine;
	          const scrapeLink = normalizeExternalLink(props.link);
	          const shouldScrape =
	            (hasGenericBottomLine ||
	              (!avalancheData.problems.length && !hasDetailedBottomLine) ||
	              (props.center_id === 'CAIC' && (avalancheData.bottomLine || '').length < 180)) &&
	            !!scrapeLink;
		          if (shouldScrape) {
			            avyLog(`[Avy] Engaging Scraper Fallback for ${props.center_id}`);
			            try {
                let resolvedViaCenterJson = false;

                // UAC publishes machine-readable advisory JSON at /forecast/{zone}/json.
                if (props.center_id === 'UAC') {
                  const uacJsonUrl = buildUtahForecastJsonUrl(scrapeLink || props.link || props.center_link || '');
                  if (uacJsonUrl) {
                    try {
                      const uacRes = await fetchWithTimeout(uacJsonUrl, { headers: DEFAULT_FETCH_HEADERS });
                      if (uacRes.ok) {
                        const uacPayloads = parseAvalancheDetailPayloads(await uacRes.text());
                        const uacAdvisory = extractUtahAvalancheAdvisory(uacPayloads[0]);
                        if (uacAdvisory?.bottomLine || (uacAdvisory?.problems && uacAdvisory.problems.length > 0)) {
                          if (uacAdvisory.bottomLine && uacAdvisory.bottomLine.length > 20) {
                            avalancheData.bottomLine = cleanForecastText(uacAdvisory.bottomLine);
                          }
                          if (Array.isArray(uacAdvisory.problems) && uacAdvisory.problems.length > 0) {
                            avalancheData.problems = normalizeAvalancheProblemCollection(uacAdvisory.problems);
                          }
                          if (uacAdvisory.publishedTime) {
                            avalancheData.publishedTime = uacAdvisory.publishedTime;
                          }
                          resolvedViaCenterJson = true;
                          avyLog('[Avy] UAC advisory JSON fallback applied.');
                        } else {
                          avyLog('[Avy] UAC advisory JSON returned no usable bottom line/problems.');
                        }
                      } else {
                        avyLog(`[Avy] UAC advisory JSON request failed with status ${uacRes.status}.`);
                      }
                    } catch (uacErr) {
                      avyLog('[Avy] UAC advisory JSON fallback failed:', uacErr.message);
                    }
                  }
                }

                if (!resolvedViaCenterJson) {
			              const pageRes = await fetchWithTimeout(scrapeLink, { headers: DEFAULT_FETCH_HEADERS });
                  if (!pageRes.ok) {
                    avyLog(`[scraper] Non-OK response (${pageRes.status}) from ${scrapeLink}, skipping HTML scrape`);
                  } else {
                  const pageText = await pageRes.text();
                  const bottomLineCandidates = [];

              // Try searching for JSON embedded in the page (common in Drupal/React sites)
              // Look for "bottom_line" or "summary" keys in any script tag or large object
              const blMatch = pageText.match(/"(bottom_line|bottom_line_summary|overall_summary)"\s*:\s*"([^"]+)"/);
              
              if (blMatch && blMatch[2]) {
                bottomLineCandidates.push(blMatch[2].replace(/\\"/g, '"'));
              } else {
                 // Final desperate check: Look for known HTML classes or IDs used by these centers
                 // CAIC: field--name-field-avalanche-summary, MSAC: field-item
                 const htmlSummary = pageText.match(/class="[^"]*(field--name-field-avalanche-summary|field-bottom-line)[^"]*"[^>]*>([\s\S]*?)<\/div>/);
                 if (htmlSummary && htmlSummary[2]) {
                    bottomLineCandidates.push(htmlSummary[2]);
                 } else {
                    // Check for large text block with "summary" key in likely JSON
                    const possibleLargeText = pageText.match(/"summary"\s*:\s*"([^"]{100,})"/);
                    if (possibleLargeText && possibleLargeText[1]) {
                      bottomLineCandidates.push(possibleLargeText[1].replace(/\\"/g, '"'));
                    }
                 }
              }

              // CAIC pages often embed forecast text in hydrated JSON.
              if (props.center_id === 'CAIC') {
                const nextDataMatch = pageText.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
                if (nextDataMatch && nextDataMatch[1]) {
                  try {
                    const nextJson = JSON.parse(nextDataMatch[1]);
                    const serialized = JSON.stringify(nextJson);
                    for (const m of serialized.matchAll(/"(?:bottom_line|bottomLine|summary|forecastSummary|discussion)"\s*:\s*"([^"]{80,})"/g)) {
                      if (m[1]) bottomLineCandidates.push(m[1].replace(/\\"/g, '"'));
                    }
	                  } catch (nextErr) {
	                    avyLog("[Avy] __NEXT_DATA__ parse failed:", nextErr.message);
	                  }
                }
              }

                  const bestBottomLine = pickBestBottomLine(bottomLineCandidates);
                  if (bestBottomLine) {
                    avalancheData.bottomLine = bestBottomLine;
                  }
	              
                  // If we still only have the travel advice, label it clearly as Official Summary
                  if (avalancheData.bottomLine === props.travel_advice) {
                     avalancheData.bottomLine = `OFFICIAL SUMMARY: ${props.travel_advice}`;
                  }

                  const problemMatches = [...pageText.matchAll(/"avalanche_problem_id":\s*\d+,\s*"name"\s*:\s*"([^"]+)"/g)];
                  if (problemMatches.length > 0) {
                    const distinctProblems = [...new Set(problemMatches.map(m => m[1]))];
                    avalancheData.problems = normalizeAvalancheProblemCollection(distinctProblems.map((name) => ({ name })));
                  }

                  const lowerMatch = pageText.match(/"danger_lower"\s*:\s*(\d)/);
                  const middleMatch = pageText.match(/"danger_middle"\s*:\s*(\d)/);
                  const upperMatch = pageText.match(/"danger_upper"\s*:\s*(\d)/);

                  if (lowerMatch && middleMatch && upperMatch) {
                     const l = parseInt(lowerMatch[1]);
                     const m = parseInt(middleMatch[1]);
                     const u = parseInt(upperMatch[1]);
                     const safeLabel = (lvl) => (Array.isArray(levelMap) && levelMap[lvl]) ? levelMap[lvl] : 'Unknown';
                     avalancheData.elevations = {
                       below: { level: l, label: safeLabel(l) },
                       at: { level: m, label: safeLabel(m) },
                       above: { level: u, label: safeLabel(u) }
                     };
                  }
                  } // end if (pageRes.ok)
                }
		            } catch (scrapeErr) {
		              avyLog("[Avy] Scrape failed:", scrapeErr.message);
		              // Ensure we fallback gracefully
              if (avalancheData.bottomLine === props.travel_advice) {
                 avalancheData.bottomLine = `OFFICIAL SUMMARY: ${props.travel_advice}`;
              }
	            }
	          }

          if (centerNoActiveForecast) {
            const offSeasonFallback = createUnknownAvalancheData("no_active_forecast");
            avalancheData = {
              ...offSeasonFallback,
              center: props.center || offSeasonFallback.center,
              center_id: props.center_id || null,
              zone: props.name || null,
              link: resolveAvalancheCenterLink({
                centerId: props.center_id,
                link: props.link,
                centerLink: props.center_link,
                lat: parsedLat,
                lon: parsedLon,
              }),
              bottomLine: cleanForecastText(travelAdviceText) || offSeasonFallback.bottomLine,
            };
          }
	        }
	      }
			    } catch (e) {
      console.error("Avalanche API error:", e);
      if (avalancheData.dangerUnknown) {
        avalancheData = createUnknownAvalancheData("temporarily_unavailable");
      }
    }

    avalancheData = applyDerivedOverallAvalancheDanger(avalancheData);

    const avalancheTargetMs = parseIsoTimeToMs(alertTargetTimeIso);
    const avalancheExpiresMs = parseIsoTimeToMsWithReference(avalancheData?.expiresTime, alertTargetTimeIso);
    if (
      avalancheData?.coverageStatus === 'reported' &&
      avalancheTargetMs !== null &&
      avalancheExpiresMs !== null &&
      avalancheTargetMs > avalancheExpiresMs
    ) {
      avalancheData = {
        ...avalancheData,
        coverageStatus: 'expired_for_selected_start',
        dangerUnknown: true,
        bottomLine: cleanForecastText(
          `${avalancheData?.bottomLine || ''} NOTE: This bulletin expires before the selected start time. Treat this as stale guidance and verify the latest avalanche center update before departure.`,
        ),
      };
    }

    if (avalancheData?.coverageStatus === 'reported' && avalancheData?.publishedTime) {
      const pubMs = parseIsoTimeToMs(avalancheData.publishedTime);
      if (pubMs !== null) {
        const ageHours = (Date.now() - pubMs) / (1000 * 60 * 60);
        if (ageHours > 72) {
          avalancheData = {
            ...avalancheData,
            dangerUnknown: true,
            staleWarning: '72h',
            bottomLine: cleanForecastText(
              `${avalancheData?.bottomLine || ''} NOTE: This bulletin is over 72 hours old and should be treated as expired. Check the avalanche center for a current forecast before departure.`
            ),
          };
        } else if (ageHours > 48) {
          avalancheData = { ...avalancheData, staleWarning: '48h' };
        }
      }
    }

    const [alertsResult, airQualityResult, rainfallResult, snowpackResult] = await parallelBatchPromise;

    if (alertsResult.status === 'fulfilled') {
      alertsData = alertsResult.value;
    } else {
      console.warn('[Alerts] fetch failed:', alertsResult.reason?.message || alertsResult.reason);
      alertsData = createUnavailableAlertsData("unavailable");
    }

    if (airQualityResult.status === 'fulfilled') {
      airQualityData = airQualityResult.value;
    } else {
      console.warn('[AirQuality] fetch failed:', airQualityResult.reason?.message || airQualityResult.reason);
      airQualityData = createUnavailableAirQualityData("unavailable");
    }

    if (rainfallResult.status === 'fulfilled') {
      rainfallData = rainfallResult.value;
    } else {
      console.warn('[Rainfall] fetch failed:', rainfallResult.reason?.message || rainfallResult.reason);
      rainfallData = createUnavailableRainfallData("unavailable");
    }

    if (snowpackResult.status === 'fulfilled') {
      snowpackData = snowpackResult.value;
    } else {
      console.warn('[Snowpack] fetch failed:', snowpackResult.reason?.message || snowpackResult.reason);
      snowpackData = createUnavailableSnowpackData("unavailable");
    }

    terrainConditionData = deriveTerrainCondition(weatherData, snowpackData, rainfallData);
    trailStatus = terrainConditionData.label;

    if (terrainConditionData?.code === 'spring_snow' && solarData?.sunrise) {
      const sunriseMin = parseClockToMinutes(solarData.sunrise);
      const startMin = parseClockToMinutes(requestedStartClock);
      if (Number.isFinite(sunriseMin) && Number.isFinite(startMin) && startMin > sunriseMin + 120) {
        terrainConditionData = {
          ...terrainConditionData,
          summary: terrainConditionData.summary + ` Start time is after the corn-snow window (valid ~sunrise to ${formatMinutesToClock(sunriseMin + 120)}). Surface may already be softening.`,
        };
      }
    }

    fireRiskData = buildFireRiskData({
      weatherData,
      alertsData,
      airQualityData,
    });
    heatRiskData = buildHeatRiskData({ weatherData });

    const avalancheRelevance = evaluateAvalancheRelevance({
      lat: parsedLat,
      selectedDate: selectedForecastDate,
      weatherData,
      avalancheData,
      snowpackData,
      rainfallData,
    });
    avalancheData = {
      ...avalancheData,
      relevant: avalancheRelevance.relevant,
      relevanceReason: avalancheRelevance.reason,
    };

    gearSuggestions = buildLayeringGearSuggestions({
      weatherData,
      trailStatus,
      avalancheData,
      airQualityData,
      alertsData,
      rainfallData,
      snowpackData,
      fireRiskData,
    });

    const analysis = calculateSafetyScore({
      weatherData,
      avalancheData,
      alertsData,
      airQualityData,
      fireRiskData,
      heatRiskData,
      rainfallData,
      selectedDate: selectedForecastDate,
      solarData,
      selectedStartClock: requestedStartClock,
      selectedTravelWindowHours: requestedTravelWindowHours,
    });
    const todayDate = new Date().toISOString().slice(0, 10);
    const avalancheSummaryForAi = avalancheData.relevant === false
      ? `Avalanche hazard is de-emphasized for this objective (${avalancheData.relevanceReason || 'low snow relevance'}).`
      : avalancheData.dangerUnknown
        ? "Avalanche forecast coverage unavailable for this objective. Risk is unknown."
        : `Avalanche danger is Level ${avalancheData.dangerLevel}.`;
    const alertsSummaryForAi =
      Number(alertsData.activeCount) > 0
        ? `${alertsData.activeCount} active NWS alert(s) (highest severity: ${alertsData.highestSeverity}).`
        : "No active NWS alerts for this point.";
    const airQualitySummaryForAi = Number.isFinite(Number(airQualityData.usAqi))
      ? `US AQI ${airQualityData.usAqi} (${airQualityData.category}).`
      : airQualityData?.status === 'not_applicable_future_date'
        ? 'Air quality is current-day only and is not applied to this future-date forecast.'
        : "Air quality data unavailable.";
    const rainfallSummaryForAi = buildPrecipitationSummaryForAi(rainfallData);
    const snowpackSummaryForAi = snowpackData?.summary
      ? `Snowpack: ${snowpackData.summary}`
      : 'Snowpack observations unavailable.';
    const fireSummaryForAi = fireRiskData?.status === 'ok'
      ? `Fire risk ${fireRiskData.label} (${fireRiskData.reasons?.[0] || 'no notable signal'}).`
      : 'Fire risk signal unavailable.';

    const responseGeneratedAt = new Date().toISOString();
    const stampGeneratedTime = (value) => {
      if (!value || typeof value !== 'object') {
        return value;
      }
      if (typeof value.generatedTime === 'string' && value.generatedTime.trim()) {
        return value;
      }
      return { ...value, generatedTime: responseGeneratedAt };
    };

    const responsePayload = {
      generatedAt: responseGeneratedAt,
		      location: { lat: parsedLat, lon: parsedLon },
	      forecast: {
	        selectedDate: selectedForecastDate,
	        selectedStartTime: selectedForecastPeriod?.startTime || weatherData?.forecastStartTime || null,
	        selectedEndTime: selectedForecastPeriod?.endTime || weatherData?.forecastEndTime || null,
	        isFuture: selectedForecastDate > todayDate,
	        availableRange: forecastDateRange
	      },
      weather: stampGeneratedTime(weatherData),
      solar: solarData,
      avalanche: stampGeneratedTime(avalancheData),
      alerts: stampGeneratedTime(alertsData),
      airQuality: stampGeneratedTime(airQualityData),
      rainfall: stampGeneratedTime(rainfallData),
      snowpack: stampGeneratedTime(snowpackData),
      fireRisk: fireRiskData,
      heatRisk: stampGeneratedTime(heatRiskData),
      gear: gearSuggestions,
	      trail: trailStatus,
      terrainCondition: terrainConditionData,
	      safety: analysis,
	      aiAnalysis: `Terrain Report (${selectedForecastDate}): ${trailStatus} conditions. ${weatherData.temp}F with ${weatherData.humidity}% humidity. ${rainfallSummaryForAi} ${avalancheSummaryForAi} ${alertsSummaryForAi} ${airQualitySummaryForAi} ${snowpackSummaryForAi} ${fireSummaryForAi} ${analysis.explanations.join(' ')}`
	    };
	    delete responsePayload.activity;
    logReportRequest({ statusCode: 200, lat: parsedLat, lon: parsedLon, date: selectedForecastDate, startTime: requestedStartClock || null, safetyScore: analysis.score, partialData: false, durationMs: Date.now() - startedAt, ...baseLogFields });
	    res.json(responsePayload);
  } catch (error) {
    console.error('API Error:', error);
    if (res.headersSent) {
      return;
    }

    const todayDate = new Date().toISOString().slice(0, 10);
    const fallbackSelectedDate = selectedForecastDate || requestedDate || todayDate;

    const safeWeatherData =
      weatherData && typeof weatherData === 'object'
        ? weatherData
        : createUnavailableWeatherData({ lat: parsedLat, lon: parsedLon, forecastDate: fallbackSelectedDate });
    const safeAvalancheData =
      avalancheData && typeof avalancheData === 'object'
        ? avalancheData
        : createUnknownAvalancheData("temporarily_unavailable");
    const safeAlertsData =
      alertsData && typeof alertsData === 'object'
        ? alertsData
        : createUnavailableAlertsData("unavailable");
    const safeAirQualityData =
      airQualityData && typeof airQualityData === 'object'
        ? airQualityData
        : createUnavailableAirQualityData("unavailable");
    const safeRainfallData =
      rainfallData && typeof rainfallData === 'object'
        ? rainfallData
        : createUnavailableRainfallData("unavailable");
    const safeSnowpackData =
      snowpackData && typeof snowpackData === 'object'
        ? snowpackData
        : createUnavailableSnowpackData("unavailable");
    const safeFireRiskData =
      fireRiskData && typeof fireRiskData === 'object'
        ? fireRiskData
        : createUnavailableFireRiskData("unavailable");
    const safeHeatRiskData =
      heatRiskData && typeof heatRiskData === 'object'
        ? heatRiskData
        : createUnavailableHeatRiskData("unavailable");
    const safeTerrainCondition = deriveTerrainCondition(safeWeatherData, safeSnowpackData, safeRainfallData);
    const safeTrailStatus = safeTerrainCondition?.label || trailStatus || "⚠️ Data Partially Unavailable";

    const analysis = calculateSafetyScore({
      weatherData: safeWeatherData,
      avalancheData: safeAvalancheData,
      alertsData: safeAlertsData,
      airQualityData: safeAirQualityData,
      fireRiskData: safeFireRiskData,
      heatRiskData: safeHeatRiskData,
      rainfallData: safeRainfallData,
      selectedDate: fallbackSelectedDate,
      solarData,
      selectedStartClock: requestedStartClock,
      selectedTravelWindowHours: requestedTravelWindowHours,
    });

    const avalancheSummaryForAi = safeAvalancheData.relevant === false
      ? `Avalanche hazard is de-emphasized for this objective (${safeAvalancheData.relevanceReason || 'low snow relevance'}).`
      : safeAvalancheData.dangerUnknown
        ? "Avalanche forecast coverage unavailable for this objective. Risk is unknown."
        : `Avalanche danger is Level ${safeAvalancheData.dangerLevel}.`;
    const alertsSummaryForAi =
      Number(safeAlertsData.activeCount) > 0
        ? `${safeAlertsData.activeCount} active NWS alert(s) (highest severity: ${safeAlertsData.highestSeverity}).`
        : "No active NWS alerts for this point.";
    const airQualitySummaryForAi = Number.isFinite(Number(safeAirQualityData.usAqi))
      ? `US AQI ${safeAirQualityData.usAqi} (${safeAirQualityData.category}).`
      : safeAirQualityData?.status === 'not_applicable_future_date'
        ? 'Air quality is current-day only and is not applied to this future-date forecast.'
        : "Air quality data unavailable.";
    const rainfallSummaryForAi = buildPrecipitationSummaryForAi(safeRainfallData);
    const snowpackSummaryForAi = safeSnowpackData?.summary
      ? `Snowpack: ${safeSnowpackData.summary}`
      : 'Snowpack observations unavailable.';
    const fireSummaryForAi = safeFireRiskData?.status === 'ok'
      ? `Fire risk ${safeFireRiskData.label} (${safeFireRiskData.reasons?.[0] || 'no notable signal'}).`
      : 'Fire risk signal unavailable.';

    const fallbackGeneratedAt = new Date().toISOString();
    const stampGeneratedTime = (value) => {
      if (!value || typeof value !== 'object') {
        return value;
      }
      if (typeof value.generatedTime === 'string' && value.generatedTime.trim()) {
        return value;
      }
      return { ...value, generatedTime: fallbackGeneratedAt };
    };

    const fallbackResponsePayload = {
      generatedAt: fallbackGeneratedAt,
	      location: { lat: parsedLat, lon: parsedLon },
	      forecast: {
	        selectedDate: fallbackSelectedDate,
	        selectedStartTime: selectedForecastPeriod?.startTime || safeWeatherData?.forecastStartTime || null,
	        selectedEndTime: selectedForecastPeriod?.endTime || safeWeatherData?.forecastEndTime || null,
	        isFuture: fallbackSelectedDate > todayDate,
	        availableRange: forecastDateRange
	      },
      weather: stampGeneratedTime(safeWeatherData),
      solar: solarData,
      avalanche: stampGeneratedTime(safeAvalancheData),
      alerts: stampGeneratedTime(safeAlertsData),
      airQuality: stampGeneratedTime(safeAirQualityData),
      rainfall: stampGeneratedTime(safeRainfallData),
      snowpack: stampGeneratedTime(safeSnowpackData),
      fireRisk: safeFireRiskData,
      heatRisk: stampGeneratedTime(safeHeatRiskData),
      gear: gearSuggestions,
      trail: safeTrailStatus,
      terrainCondition: safeTerrainCondition,
      safety: analysis,
	      partialData: true,
	      apiWarning: error?.message || 'One or more upstream data providers failed during this request.',
	      aiAnalysis: `Terrain Report (${fallbackSelectedDate}): ${safeTrailStatus} conditions. ${safeWeatherData.temp}F with ${safeWeatherData.humidity}% humidity. ${rainfallSummaryForAi} ${avalancheSummaryForAi} ${alertsSummaryForAi} ${airQualitySummaryForAi} ${snowpackSummaryForAi} ${fireSummaryForAi} ${analysis.explanations.join(' ')}`
	    };
	    delete fallbackResponsePayload.activity;
    logReportRequest({ statusCode: 200, lat: parsedLat, lon: parsedLon, date: fallbackSelectedDate, startTime: requestedStartClock || null, safetyScore: analysis.score, partialData: true, durationMs: Date.now() - startedAt, ...baseLogFields });
	    res.status(200).json(fallbackResponsePayload);
  }
};

registerSafetyRoute({ app, safetyHandler });
const invokeSafetyHandler = createSafetyInvoker({ safetyHandler });

registerSatOneLinerRoute({
  app,
  invokeSafetyHandler,
  buildSatOneLiner,
  parseStartClock,
});

registerSearchRoutes({
  app,
  fetchWithTimeout,
  defaultFetchHeaders: DEFAULT_FETCH_HEADERS,
  peaks: POPULAR_PEAKS,
});
registerHealthRoutes(app);
registerReportLogsRoute(app);

const startServer = () => startBackendServer({ app, port: PORT });

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
  normalizeWindDirection,
  parseStartClock,
  buildPlannedStartIso,
  buildLayeringGearSuggestions,
  buildFireRiskData,
  buildHeatRiskData,
  calculateSafetyScore,
  findMatchingAvalancheZone,
  resolveAvalancheCenterLink,
  resolveNwsAlertSourceLink,
  evaluateAvalancheRelevance,
  deriveTerrainCondition,
  deriveTrailStatus,
  deriveOverallDangerLevelFromElevations,
  applyDerivedOverallAvalancheDanger,
  parseAvalancheDetailPayloads,
  pickBestAvalancheDetailCandidate,
  normalizeAvalancheProblemCollection,
  buildUtahForecastJsonUrl,
  extractUtahAvalancheAdvisory,
  buildSatOneLiner,
};
