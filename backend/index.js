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
const { parseIsoTimeToMs, parseIsoTimeToMsWithReference, parseStartClock, buildPlannedStartIso, findClosestTimeIndex } = require('./src/utils/time');
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
const TEMP_LAPSE_F_PER_1000FT = 3.3;
const WIND_INCREASE_MPH_PER_1000FT = 2;
const GUST_INCREASE_MPH_PER_1000FT = 2.5;
const MAX_REASONABLE_ELEVATION_FT = 20000;
const INCHES_PER_MM = 0.0393701;
const INCHES_PER_CM = 0.393701;

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

const computeFeelsLikeF = (tempF, windMph) => {
  if (!Number.isFinite(tempF)) {
    return tempF;
  }
  if (tempF <= 50 && windMph >= 3) {
    const feelsLike = 35.74 + (0.6215 * tempF) - (35.75 * Math.pow(windMph, 0.16)) + (0.4275 * tempF * Math.pow(windMph, 0.16));
    return Math.round(feelsLike);
  }
  return Math.round(tempF);
};

const celsiusToF = (valueC) => {
  const numeric = Number(valueC);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return (numeric * 9) / 5 + 32;
};

const normalizeNoaaDewPointF = (dewpointField) => {
  const value = Number(dewpointField?.value);
  if (!Number.isFinite(value)) {
    return null;
  }
  const unitCode = String(dewpointField?.unitCode || '').toLowerCase();
  if (unitCode.includes('degc') || unitCode.includes('unit:degc') || unitCode.includes('wmo:degc')) {
    const converted = celsiusToF(value);
    return Number.isFinite(converted) ? Math.round(converted) : null;
  }
  return Math.round(value);
};

const clampPercent = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
};

const inferNoaaCloudCoverFromIcon = (iconUrl) => {
  const icon = String(iconUrl || '').toLowerCase();
  if (!icon) {
    return null;
  }
  const tokens = icon
    .split(/[\/,?]/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.some((token) => token.startsWith('ovc'))) return 95;
  if (tokens.some((token) => token.startsWith('bkn'))) return 75;
  if (tokens.some((token) => token.startsWith('sct'))) return 50;
  if (tokens.some((token) => token.startsWith('few'))) return 20;
  if (tokens.some((token) => token === 'skc' || token === 'clr')) return 5;
  return null;
};

const inferNoaaCloudCoverFromForecastText = (shortForecast) => {
  const text = String(shortForecast || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) {
    return null;
  }
  if (text.includes('overcast')) return 95;
  if (text.includes('mostly cloudy')) return 80;
  if (text.includes('partly cloudy') || text.includes('partly sunny')) return 50;
  if (text.includes('mostly sunny')) return 25;
  if (text.includes('sunny') || text.includes('clear')) return 10;
  if (text.includes('cloudy')) return 70;
  return null;
};

const resolveNoaaCloudCover = (forecastPeriod) => {
  const skyCoverValue = clampPercent(forecastPeriod?.skyCover?.value);
  if (Number.isFinite(skyCoverValue)) {
    return { value: skyCoverValue, source: 'NOAA skyCover' };
  }
  const fromIcon = inferNoaaCloudCoverFromIcon(forecastPeriod?.icon);
  if (Number.isFinite(fromIcon)) {
    return { value: fromIcon, source: 'NOAA icon-derived cloud cover' };
  }
  const fromText = inferNoaaCloudCoverFromForecastText(forecastPeriod?.shortForecast);
  if (Number.isFinite(fromText)) {
    return { value: fromText, source: 'NOAA shortForecast-derived cloud cover' };
  }
  return { value: null, source: 'Unavailable' };
};

const buildSatOneLiner = createSatOneLinerBuilder({ parseStartClock, computeFeelsLikeF });

const buildElevationForecastBands = ({ baseElevationFt, tempF, windSpeedMph, windGustMph }) => {
  if (!Number.isFinite(baseElevationFt) || !Number.isFinite(tempF)) {
    return [];
  }

  const objectiveElevationFt = Math.max(0, Math.round(baseElevationFt));
  const bandTemplates =
    objectiveElevationFt >= 13000
      ? [
          { label: 'Approach Terrain', deltaFromObjectiveFt: -3500 },
          { label: 'Mid Mountain', deltaFromObjectiveFt: -2200 },
          { label: 'Near Objective', deltaFromObjectiveFt: -1000 },
          { label: 'Objective Elevation', deltaFromObjectiveFt: 0 },
        ]
      : objectiveElevationFt >= 9000
        ? [
            { label: 'Approach Terrain', deltaFromObjectiveFt: -2800 },
            { label: 'Mid Mountain', deltaFromObjectiveFt: -1700 },
            { label: 'Near Objective', deltaFromObjectiveFt: -800 },
            { label: 'Objective Elevation', deltaFromObjectiveFt: 0 },
          ]
        : objectiveElevationFt >= 6000
          ? [
              { label: 'Lower Terrain', deltaFromObjectiveFt: -2000 },
              { label: 'Mid Terrain', deltaFromObjectiveFt: -1200 },
              { label: 'Near Objective', deltaFromObjectiveFt: -500 },
              { label: 'Objective Elevation', deltaFromObjectiveFt: 0 },
            ]
          : [
              { label: 'Lower Terrain', deltaFromObjectiveFt: -1000 },
              { label: 'Mid Terrain', deltaFromObjectiveFt: -500 },
              { label: 'Near Objective', deltaFromObjectiveFt: -200 },
              { label: 'Objective Elevation', deltaFromObjectiveFt: 0 },
            ];

  const seenElevations = new Set();
  return bandTemplates
    .map((band) => {
      const elevationFt = Math.max(
        0,
        Math.min(objectiveElevationFt, Math.round(objectiveElevationFt + band.deltaFromObjectiveFt)),
      );
      const actualDeltaFromObjectiveFt = elevationFt - objectiveElevationFt;
      const deltaKft = actualDeltaFromObjectiveFt / 1000;
      const estimatedTempF = Math.round(tempF - (deltaKft * TEMP_LAPSE_F_PER_1000FT));
      const estimatedWindSpeed = Math.max(0, Math.round((windSpeedMph || 0) + (deltaKft * WIND_INCREASE_MPH_PER_1000FT)));
      const estimatedWindGust = Math.max(0, Math.round((windGustMph || 0) + (deltaKft * GUST_INCREASE_MPH_PER_1000FT)));

      return {
        label: band.label,
        deltaFromObjectiveFt: actualDeltaFromObjectiveFt,
        elevationFt,
        temp: estimatedTempF,
        feelsLike: computeFeelsLikeF(estimatedTempF, estimatedWindSpeed),
        windSpeed: estimatedWindSpeed,
        windGust: estimatedWindGust,
      };
    })
    .filter((band) => {
      if (seenElevations.has(band.elevationFt)) {
        return false;
      }
      seenElevations.add(band.elevationFt);
      return true;
    })
    .sort((a, b) => a.elevationFt - b.elevationFt);
};

const createUnavailableWeatherData = ({ lat, lon, forecastDate }) => ({
  temp: 0,
  feelsLike: 0,
  dewPoint: null,
  elevation: null,
  elevationSource: null,
  elevationUnit: 'ft',
  description: 'Weather data unavailable',
  windSpeed: 0,
  windGust: 0,
  windDirection: null,
  humidity: 0,
  cloudCover: 0,
  precipChance: 0,
  isDaytime: null,
  issuedTime: null,
  timezone: null,
  forecastStartTime: null,
  forecastEndTime: null,
  forecastDate: forecastDate || null,
  trend: [],
  temperatureContext24h: null,
  elevationForecast: [],
  elevationForecastNote: 'Weather forecast data unavailable; elevation-based estimate could not be generated.',
  forecastLink: `https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lon}`,
  sourceDetails: {
    primary: 'Unavailable',
    blended: false,
    fieldSources: {},
  },
});

const OPEN_METEO_CODE_LABELS = {
  0: 'Clear',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Heavy freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Rain showers',
  81: 'Rain showers',
  82: 'Violent rain showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Severe thunderstorm with hail',
};

const openMeteoCodeToText = (code) => {
  const numericCode = Number(code);
  if (Number.isFinite(numericCode) && OPEN_METEO_CODE_LABELS[numericCode]) {
    return OPEN_METEO_CODE_LABELS[numericCode];
  }
  return 'Unknown';
};

const hourLabelFromIso = (input, timeZone = null) => {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const baseOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
  try {
    const localized = date.toLocaleTimeString('en-US', timeZone ? { ...baseOptions, timeZone } : baseOptions);
    return localized.replace(':00 ', ' ');
  } catch {
    const fallback = date.toLocaleTimeString('en-US', baseOptions);
    return fallback.replace(':00 ', ' ');
  }
};

const localHourFromIso = (input, timeZone = null) => {
  if (typeof input !== 'string' || !input.trim()) {
    return null;
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      hourCycle: 'h23',
      ...(timeZone ? { timeZone } : {}),
    });
    const parts = formatter.formatToParts(date);
    const hourPart = parts.find((part) => part.type === 'hour');
    const hour = Number(hourPart?.value);
    return Number.isFinite(hour) ? hour : null;
  } catch {
    const hour = date.getHours();
    return Number.isFinite(hour) ? hour : null;
  }
};

const buildTemperatureContext24h = ({ points, timeZone = null, windowHours = 24 }) => {
  const normalizedWindow = Math.max(1, Math.round(Number(windowHours) || 24));
  const sourcePoints = Array.isArray(points) ? points.slice(0, normalizedWindow) : [];
  const validPoints = sourcePoints.filter((point) => Number.isFinite(Number(point?.tempF)));
  if (!validPoints.length) {
    return null;
  }

  const temps = validPoints.map((point) => Number(point.tempF));
  const dayTemps = [];
  const nightTemps = [];

  validPoints.forEach((point) => {
    let isDaytime = typeof point?.isDaytime === 'boolean' ? point.isDaytime : null;
    if (isDaytime === null) {
      const localHour = localHourFromIso(point?.timeIso, timeZone);
      if (Number.isFinite(localHour)) {
        isDaytime = localHour >= 6 && localHour < 18;
      }
    }
    if (isDaytime === true) {
      dayTemps.push(Number(point.tempF));
    } else if (isDaytime === false) {
      nightTemps.push(Number(point.tempF));
    }
  });

  return {
    windowHours: normalizedWindow,
    timezone: timeZone || null,
    minTempF: Math.min(...temps),
    maxTempF: Math.max(...temps),
    overnightLowF: nightTemps.length ? Math.min(...nightTemps) : null,
    daytimeHighF: dayTemps.length ? Math.max(...dayTemps) : null,
  };
};

const withExplicitTimezone = (value, timezoneHint = 'UTC') => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/([zZ]|[+\-]\d{2}:\d{2})$/.test(trimmed)) {
    return trimmed;
  }
  const isIsoWithoutZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(trimmed);
  if (!isIsoWithoutZone) {
    return trimmed;
  }
  const normalizedTz = String(timezoneHint || '').trim().toUpperCase();
  if (normalizedTz === 'UTC' || normalizedTz === 'GMT') {
    return `${trimmed}Z`;
  }
  return trimmed;
};

const parseClockToMinutes = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const twentyFourHourMatch = trimmed.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (twentyFourHourMatch) {
    return Number(twentyFourHourMatch[1]) * 60 + Number(twentyFourHourMatch[2]);
  }

  const twelveHourMatch = trimmed.match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?\s*([AP]M)$/i);
  if (!twelveHourMatch) {
    return null;
  }

  const hourRaw = Number(twelveHourMatch[1]);
  const minute = Number(twelveHourMatch[2]);
  if (!Number.isFinite(hourRaw) || hourRaw < 1 || hourRaw > 12) {
    return null;
  }

  const meridiem = String(twelveHourMatch[4] || '').toUpperCase();
  const hour = (hourRaw % 12) + (meridiem === 'PM' ? 12 : 0);
  return hour * 60 + minute;
};

const parseIsoClockMinutes = (isoValue) => {
  if (typeof isoValue !== 'string') {
    return null;
  }
  const match = isoValue.trim().match(/T(\d{2}):(\d{2})/);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
};

const OPEN_METEO_WEATHER_HOURLY_FIELDS = [
  'temperature_2m',
  'dew_point_2m',
  'relative_humidity_2m',
  'precipitation_probability',
  'cloud_cover',
  'weather_code',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'is_day',
].join(',');

const buildOpenMeteoWeatherApiUrl = (host, lat, lon) => {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: 'auto',
    forecast_days: '16',
    temperature_unit: 'fahrenheit',
    windspeed_unit: 'mph',
    hourly: OPEN_METEO_WEATHER_HOURLY_FIELDS,
  });
  return `https://${host}/v1/forecast?${params.toString()}`;
};

const buildOpenMeteoWeatherSourceLink = (lat, lon) => buildOpenMeteoWeatherApiUrl('api.open-meteo.com', lat, lon);

const fetchOpenMeteoWeatherFallback = async ({ lat, lon, selectedDate, startClock, fetchOptions, objectiveElevationFt, objectiveElevationSource }) => {
  const apiUrls = [
    buildOpenMeteoWeatherApiUrl('api.open-meteo.com', lat, lon),
    buildOpenMeteoWeatherApiUrl('customer-api.open-meteo.com', lat, lon),
  ];

  let payload = null;
  let payloadIssuedTime = null;
  let lastError = null;

  for (const apiUrl of apiUrls) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetchWithTimeout(apiUrl, fetchOptions, Math.max(REQUEST_TIMEOUT_MS, 12000));
        if (!response.ok) {
          throw new Error(`Open-Meteo forecast failed with status ${response.status}`);
        }
        payload = await response.json();
        const responseDateHeader = response.headers.get('date');
        if (responseDateHeader) {
          const parsedDate = Date.parse(responseDateHeader);
          if (Number.isFinite(parsedDate)) {
            payloadIssuedTime = new Date(parsedDate).toISOString();
          }
        }
        if (!payloadIssuedTime) {
          payloadIssuedTime = new Date().toISOString();
        }
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (payload) {
      break;
    }
  }

  if (!payload) {
    throw lastError || new Error('Open-Meteo forecast failed');
  }

  const hourly = payload?.hourly;
  const hourlyTimes = Array.isArray(hourly?.time) ? hourly.time : [];
  if (!hourlyTimes.length) {
    throw new Error('Open-Meteo forecast response did not include hourly time series.');
  }

  const availableDates = [...new Set(hourlyTimes.map((timeValue) => String(timeValue).slice(0, 10)).filter(Boolean))];
  const resolvedDate = selectedDate && availableDates.includes(selectedDate) ? selectedDate : (availableDates[0] || new Date().toISOString().slice(0, 10));
  const dayHourIndexes = hourlyTimes
    .map((timeValue, idx) => ({ timeValue, idx }))
    .filter((entry) => String(entry.timeValue).slice(0, 10) === resolvedDate)
    .map((entry) => entry.idx);
  const firstHourIndex = dayHourIndexes.length > 0 ? dayHourIndexes[0] : hourlyTimes.findIndex((timeValue) => String(timeValue).slice(0, 10) === resolvedDate);
  let selectedHourIndex = firstHourIndex >= 0 ? firstHourIndex : 0;
  const requestedStartMinutes = parseStartClock(startClock);
  if (requestedStartMinutes && dayHourIndexes.length > 0) {
    const [hourPart, minutePart] = requestedStartMinutes.split(':');
    const targetMinutes = Number(hourPart) * 60 + Number(minutePart);
    const byStart = dayHourIndexes.find((idx) => {
      const ts = String(hourlyTimes[idx] || '');
      const m = ts.match(/T(\d{2}):(\d{2})/);
      if (!m) return false;
      const minutes = Number(m[1]) * 60 + Number(m[2]);
      return minutes >= targetMinutes;
    });
    if (Number.isInteger(byStart)) {
      selectedHourIndex = byStart;
    } else {
      selectedHourIndex = dayHourIndexes[dayHourIndexes.length - 1];
    }
  }
  const selectedHourIso = hourlyTimes[selectedHourIndex] || null;

  const readHourlyValue = (key, index, fallback = 0) => {
    const series = hourly && Array.isArray(hourly[key]) ? hourly[key] : [];
    const value = Number(series[index]);
    return Number.isFinite(value) ? value : fallback;
  };

  const currentTemp = Math.round(readHourlyValue('temperature_2m', selectedHourIndex, 0));
  const currentWind = Math.round(readHourlyValue('wind_speed_10m', selectedHourIndex, 0));
  const gustSeries = hourly && Array.isArray(hourly.wind_gusts_10m) ? hourly.wind_gusts_10m : [];
  const rawCurrentGust = Number(gustSeries[selectedHourIndex]);
  const hasOpenMeteoGust = Number.isFinite(rawCurrentGust);
  const currentGust = hasOpenMeteoGust
    ? Math.max(currentWind, Math.round(rawCurrentGust))
    : Math.max(currentWind, estimateWindGustFromWindSpeed(currentWind));
  const windDirectionSeries = Array.isArray(hourly?.wind_direction_10m) ? hourly.wind_direction_10m : [];
  const currentWindDirection = findNearestCardinalFromDegreeSeries(windDirectionSeries, selectedHourIndex);
  const dewPointSeries = hourly && Array.isArray(hourly.dew_point_2m) ? hourly.dew_point_2m : [];
  const rawCurrentDewPoint = Number(dewPointSeries[selectedHourIndex]);
  const currentDewPoint = Number.isFinite(rawCurrentDewPoint) ? Math.round(rawCurrentDewPoint) : null;
  const currentHumidity = Math.round(readHourlyValue('relative_humidity_2m', selectedHourIndex, 0));
  const currentCloud = Math.round(readHourlyValue('cloud_cover', selectedHourIndex, 0));
  const currentPrecipProb = Math.round(readHourlyValue('precipitation_probability', selectedHourIndex, 0));
  const currentWeatherCode = Math.round(readHourlyValue('weather_code', selectedHourIndex, -1));
  const currentIsDay = readHourlyValue('is_day', selectedHourIndex, 1) >= 1;
  const feelsLike = computeFeelsLikeF(currentTemp, currentWind);

  const trend = [];
  const temperatureContextPoints = [];
  for (let offset = 0; offset < 24; offset += 1) {
    const rowIndex = selectedHourIndex + offset;
    const rowIso = hourlyTimes[rowIndex];
    if (!rowIso) {
      break;
    }
    temperatureContextPoints.push({
      timeIso: rowIso,
      tempF: Math.round(readHourlyValue('temperature_2m', rowIndex, currentTemp)),
      isDaytime: readHourlyValue('is_day', rowIndex, 1) >= 1,
    });
  }
  const temperatureContext24h = buildTemperatureContext24h({
    points: temperatureContextPoints,
    timeZone: payload?.timezone || null,
    windowHours: 24,
  });

  for (let offset = 0; offset < 12; offset += 1) {
    const rowIndex = selectedHourIndex + offset;
    const rowIso = hourlyTimes[rowIndex];
    if (!rowIso) {
      break;
    }
    const rawRowGust = Number(gustSeries[rowIndex]);
    const rowWind = Math.round(readHourlyValue('wind_speed_10m', rowIndex, currentWind));
    trend.push({
      time: hourLabelFromIso(rowIso, payload?.timezone || null),
      timeIso: rowIso,
      temp: Math.round(readHourlyValue('temperature_2m', rowIndex, currentTemp)),
      wind: rowWind,
      gust: Number.isFinite(rawRowGust)
        ? Math.max(rowWind, Math.round(rawRowGust))
        : Math.max(rowWind, estimateWindGustFromWindSpeed(rowWind)),
      windDirection: findNearestCardinalFromDegreeSeries(windDirectionSeries, rowIndex),
      precipChance: Math.round(readHourlyValue('precipitation_probability', rowIndex, currentPrecipProb)),
      condition: openMeteoCodeToText(readHourlyValue('weather_code', rowIndex, currentWeatherCode)),
      isDaytime: readHourlyValue('is_day', rowIndex, 1) >= 1,
    });
  }

  const elevationForecastBands = buildElevationForecastBands({
    baseElevationFt: objectiveElevationFt,
    tempF: currentTemp,
    windSpeedMph: currentWind,
    windGustMph: currentGust,
  });

  const weatherData = {
    temp: currentTemp,
    feelsLike,
    dewPoint: currentDewPoint,
    elevation: objectiveElevationFt,
    elevationSource: objectiveElevationSource,
    elevationUnit: 'ft',
    description: openMeteoCodeToText(currentWeatherCode),
    windSpeed: currentWind,
    windGust: currentGust,
    windDirection: currentWindDirection,
    humidity: currentHumidity,
    cloudCover: currentCloud,
    precipChance: currentPrecipProb,
    isDaytime: currentIsDay,
    issuedTime: payloadIssuedTime || null,
    timezone: payload?.timezone || null,
    forecastStartTime: selectedHourIso,
    forecastEndTime: selectedHourIso,
    forecastDate: resolvedDate,
    trend,
    temperatureContext24h,
    sourceDetails: {
      primary: 'Open-Meteo',
      blended: false,
      fieldSources: {
            temp: 'Open-Meteo',
            feelsLike: 'Open-Meteo',
            dewPoint: 'Open-Meteo',
            description: 'Open-Meteo',
            windSpeed: 'Open-Meteo',
            windGust: hasOpenMeteoGust ? 'Open-Meteo' : 'Estimated from Open-Meteo sustained wind',
            windDirection: 'Open-Meteo',
            humidity: 'Open-Meteo',
            cloudCover: 'Open-Meteo',
        precipChance: 'Open-Meteo',
        isDaytime: 'Open-Meteo',
            issuedTime: 'Open-Meteo response timestamp',
        timezone: 'Open-Meteo',
        forecastStartTime: 'Open-Meteo',
        forecastEndTime: 'Open-Meteo',
        trend: 'Open-Meteo',
        temperatureContext24h: 'Open-Meteo',
      },
    },
    elevationForecast: elevationForecastBands,
    elevationForecastNote:
      objectiveElevationFt !== null
        ? `Estimated from objective elevation down through terrain bands using lapse-rate adjustments per 1,000 ft. Baseline elevation source: ${objectiveElevationSource || 'unknown source'}.`
        : 'Objective elevation unavailable from NOAA and fallback elevation services; elevation-based estimate could not be generated.',
    forecastLink: buildOpenMeteoWeatherSourceLink(lat, lon),
  };

  return {
    weatherData,
    selectedForecastDate: resolvedDate,
    trailStatus: deriveTrailStatus(weatherData),
    terrainCondition: deriveTerrainCondition(weatherData),
    forecastDateRange: {
      start: availableDates[0] || null,
      end: availableDates[availableDates.length - 1] || null,
    },
  };
};

const isWeatherFieldMissing = (value) => {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim().length === 0;
  }
  return false;
};

const blendNoaaWeatherWithFallback = (noaaWeatherData, fallbackWeatherData) => {
  if (!noaaWeatherData || !fallbackWeatherData) {
    return {
      weatherData: noaaWeatherData,
      usedSupplement: false,
      supplementedFields: [],
    };
  }

  const merged = { ...noaaWeatherData };
  const noaaFieldSources = noaaWeatherData?.sourceDetails?.fieldSources || {};
  const fieldSources = { ...noaaFieldSources };
  const supplementedFields = [];

  const tryFillField = (key) => {
    if (isWeatherFieldMissing(merged[key]) && !isWeatherFieldMissing(fallbackWeatherData[key])) {
      merged[key] = fallbackWeatherData[key];
      fieldSources[key] = 'Open-Meteo';
      supplementedFields.push(key);
    } else if (!fieldSources[key]) {
      fieldSources[key] = 'NOAA';
    }
  };

  ['windDirection', 'issuedTime', 'timezone', 'forecastEndTime', 'dewPoint', 'temperatureContext24h', 'cloudCover'].forEach(tryFillField);

  const noaaTrend = Array.isArray(merged.trend) ? merged.trend : [];
  const fallbackTrend = Array.isArray(fallbackWeatherData.trend) ? fallbackWeatherData.trend : [];
  if (noaaTrend.length < 6 && fallbackTrend.length > noaaTrend.length) {
    merged.trend = fallbackTrend;
    fieldSources.trend = 'Open-Meteo';
    supplementedFields.push('trend');
  } else if (!fieldSources.trend) {
    fieldSources.trend = 'NOAA';
  }

  merged.sourceDetails = {
    primary: 'NOAA',
    blended: supplementedFields.length > 0,
    supplementalSources: supplementedFields.length > 0 ? ['Open-Meteo'] : [],
    fieldSources,
  };

  return {
    weatherData: merged,
    usedSupplement: supplementedFields.length > 0,
    supplementedFields,
  };
};

const ALERT_SEVERITY_RANK = {
  unknown: 0,
  minor: 1,
  moderate: 2,
  severe: 3,
  extreme: 4,
};

const normalizeAlertSeverity = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized in ALERT_SEVERITY_RANK) {
    return normalized;
  }
  return 'unknown';
};

const formatAlertSeverity = (value) => {
  const normalized = normalizeAlertSeverity(value);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const getHigherSeverity = (a, b) => {
  const normalizedA = normalizeAlertSeverity(a);
  const normalizedB = normalizeAlertSeverity(b);
  return ALERT_SEVERITY_RANK[normalizedA] >= ALERT_SEVERITY_RANK[normalizedB] ? normalizedA : normalizedB;
};

const normalizeNwsAlertText = (value, maxLength = 4000) => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

const normalizeNwsAreaList = (areaDescValue) => {
  if (typeof areaDescValue !== 'string') {
    return [];
  }
  return areaDescValue
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 12);
};

const classifyUsAqi = (aqi) => {
  if (!Number.isFinite(aqi)) return 'Unknown';
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for Sensitive Groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
};

const createUnavailableAirQualityData = (status = 'unavailable') => ({
  source: 'Open-Meteo Air Quality API',
  status,
  usAqi: null,
  category: 'Unknown',
  pm25: null,
  pm10: null,
  ozone: null,
  measuredTime: null,
});

const createUnavailableRainfallData = (status = 'unavailable') => ({
  source: 'Open-Meteo Precipitation History',
  status,
  mode: 'observed_recent',
  issuedTime: null,
  anchorTime: null,
  timezone: null,
  expected: {
    status: 'unavailable',
    travelWindowHours: null,
    startTime: null,
    endTime: null,
    rainWindowMm: null,
    rainWindowIn: null,
    snowWindowCm: null,
    snowWindowIn: null,
    note: null,
  },
  totals: {
    rainPast12hMm: null,
    rainPast24hMm: null,
    rainPast48hMm: null,
    rainPast12hIn: null,
    rainPast24hIn: null,
    rainPast48hIn: null,
    snowPast12hCm: null,
    snowPast24hCm: null,
    snowPast48hCm: null,
    snowPast12hIn: null,
    snowPast24hIn: null,
    snowPast48hIn: null,
    // Legacy aliases retained for compatibility with older clients.
    past12hMm: null,
    past24hMm: null,
    past48hMm: null,
    past12hIn: null,
    past24hIn: null,
    past48hIn: null,
  },
  note: null,
  link: null,
});

const createUnavailableAlertsData = (status = 'unavailable') => ({
  source: 'NOAA/NWS Active Alerts',
  status,
  activeCount: 0,
  totalActiveCount: 0,
  targetTime: null,
  highestSeverity: 'Unknown',
  note: null,
  alerts: [],
});

const normalizeHttpUrl = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^https:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^http:\/\//i.test(trimmed)) {
    return trimmed.replace(/^http:\/\//i, 'https://');
  }
  return null;
};

const buildNwsAlertUrlFromId = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const absolute = normalizeHttpUrl(trimmed);
  if (absolute) {
    return absolute;
  }
  return `https://api.weather.gov/alerts/${encodeURIComponent(trimmed)}`;
};

const isGenericNwsLink = (value) => {
  const normalized = normalizeHttpUrl(value);
  if (!normalized) {
    return false;
  }
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = parsed.pathname.replace(/\/+$/g, '') || '/';
    if (host === 'weather.gov' && (pathname === '/' || pathname === '/index' || pathname === '/index.html')) {
      return true;
    }
    if (host === 'api.weather.gov' && (pathname === '/alerts' || pathname === '/alerts/active')) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
};

const isIndividualNwsAlertLink = (value) => {
  const normalized = normalizeHttpUrl(value);
  if (!normalized) {
    return false;
  }
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = parsed.pathname.replace(/\/+$/g, '');
    if (host !== 'api.weather.gov') {
      return false;
    }
    if (!pathname.startsWith('/alerts/')) {
      return false;
    }
    return pathname !== '/alerts' && pathname !== '/alerts/active';
  } catch {
    return false;
  }
};

const resolveNwsAlertSourceLink = ({ feature, props, lat, lon }) => {
  const individualAlertUrl = [feature?.id, props?.['@id'], props?.id, props?.identifier]
    .map(buildNwsAlertUrlFromId)
    .find(isIndividualNwsAlertLink);
  if (individualAlertUrl) {
    return individualAlertUrl;
  }

  const directUrl = [props?.uri, props?.web, props?.url, props?.link, props?.['@id'], feature?.id]
    .map(normalizeHttpUrl)
    .filter((candidate) => !isGenericNwsLink(candidate))
    .find(Boolean);
  if (directUrl) {
    return directUrl;
  }

  const idBasedUrl = [props?.id, feature?.id, props?.identifier]
    .map(buildNwsAlertUrlFromId)
    .find(Boolean);
  if (idBasedUrl) {
    return idBasedUrl;
  }

  return `https://api.weather.gov/alerts/active?point=${lat},${lon}`;
};

const AVALANCHE_WINTER_MONTHS = new Set([10, 11, 0, 1, 2, 3]); // Nov-Apr
const AVALANCHE_SHOULDER_MONTHS = new Set([4, 9]); // May, Oct

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
    (maxDepthIn !== null && maxDepthIn >= 6) ||
    (maxSweIn !== null && maxSweIn >= 1.5);
  const hasModerateSnowpackPresence =
    (maxDepthIn !== null && maxDepthIn >= 2) ||
    (maxSweIn !== null && maxSweIn >= 0.5);

  const hasLowSnowpackSignal =
    (maxDepthIn !== null && maxDepthIn <= 1) &&
    (maxSweIn === null || maxSweIn <= 0.25);

  if (hasMaterialSnowpackSignal) {
    const parts = [];
    if (maxDepthIn !== null) parts.push(`depth ~${maxDepthIn.toFixed(1)} in`);
    if (maxSweIn !== null) parts.push(`SWE ~${maxSweIn.toFixed(1)} in`);
    return {
      hasSignal: true,
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
      hasSignal: true,
      hasNoSignal: false,
      hasObservedPresence: true,
      reason: `Snowpack Snapshot shows measurable snowpack (${parts.join(', ')}).`,
    };
  }

  if (hasLowSnowpackSignal) {
    const parts = [];
    if (maxDepthIn !== null) parts.push(`depth ~${maxDepthIn.toFixed(1)} in`);
    if (maxSweIn !== null) parts.push(`SWE ~${maxSweIn.toFixed(2)} in`);
    return {
      hasSignal: false,
      hasNoSignal: true,
      hasObservedPresence: false,
      reason: `Snowpack Snapshot shows very low snow signal (${parts.join(', ')}).`,
    };
  }

  return {
    hasSignal: false,
    hasNoSignal: false,
    hasObservedPresence: false,
    reason: 'Snowpack Snapshot is mixed/patchy; use weather and season context.',
  };
};

const evaluateAvalancheRelevance = ({ lat, selectedDate, weatherData, avalancheData, snowpackData }) => {
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

  const objectiveElevationFt = Number(weatherData?.elevation);
  const tempF = Number(weatherData?.temp);
  const feelsLikeF = Number(weatherData?.feelsLike);
  const precipChance = Number(weatherData?.precipChance);
  const description = String(weatherData?.description || '').toLowerCase();
  const month = parseForecastMonth(selectedDate || weatherData?.forecastDate || '');
  const isWinterWindow = month !== null && AVALANCHE_WINTER_MONTHS.has(month);
  const isShoulderWindow = month !== null && AVALANCHE_SHOULDER_MONTHS.has(month);
  const seasonUnknown = month === null;
  const highLatitude = Math.abs(Number(lat)) >= 42;
  const highElevation = Number.isFinite(objectiveElevationFt) && objectiveElevationFt >= 8500;
  const midElevation = Number.isFinite(objectiveElevationFt) && objectiveElevationFt >= 6500;
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

  if (snowpackSignal.hasSignal) {
    return {
      relevant: true,
      reason: snowpackSignal.reason || 'Snowpack Snapshot indicates meaningful snowpack.',
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

const fetchWeatherAlertsData = async (lat, lon, fetchOptions, targetTimeIso = null) => {
  const targetTimeMs = parseIsoTimeToMs(targetTimeIso) ?? Date.now();

  const alertsRes = await fetchWithTimeout(
    `https://api.weather.gov/alerts/active?point=${lat},${lon}`,
    fetchOptions,
  );
  if (!alertsRes.ok) {
    throw new Error(`NWS alerts request failed with status ${alertsRes.status}`);
  }

  const alertsJson = await alertsRes.json();
  const features = Array.isArray(alertsJson?.features) ? alertsJson.features : [];
  if (features.length === 0) {
    return {
      ...createUnavailableAlertsData('none'),
      targetTime: targetTimeIso || null,
    };
  }

  const alertsActiveAtTarget = features.filter((feature) => {
    const props = feature?.properties || {};
    const startMs =
      parseIsoTimeToMs(props.onset) ??
      parseIsoTimeToMs(props.effective) ??
      parseIsoTimeToMs(props.sent);
    const endMs =
      parseIsoTimeToMs(props.ends) ??
      parseIsoTimeToMs(props.expires);
    const startsBeforeTarget = startMs === null || targetTimeMs >= startMs;
    const endsAfterTarget = endMs === null || targetTimeMs <= endMs;
    return startsBeforeTarget && endsAfterTarget;
  });
  if (alertsActiveAtTarget.length === 0) {
    return {
      ...createUnavailableAlertsData('none_for_selected_start'),
      totalActiveCount: features.length,
      targetTime: targetTimeIso || null,
      note: 'No currently issued alert is active at the selected start time.',
    };
  }

  let highestSeverity = 'unknown';
  const parsedAlerts = alertsActiveAtTarget
    .map((feature) => {
      const props = feature?.properties || {};
      const severity = normalizeAlertSeverity(props.severity);
      highestSeverity = getHigherSeverity(highestSeverity, severity);
      return {
        event: props.event || 'Weather Alert',
        severity: formatAlertSeverity(severity),
        urgency: props.urgency || 'Unknown',
        certainty: props.certainty || 'Unknown',
        headline: props.headline || props.description || '',
        description: normalizeNwsAlertText(props.description),
        instruction: normalizeNwsAlertText(props.instruction),
        areaDesc: normalizeNwsAlertText(props.areaDesc, 1200),
        affectedAreas: normalizeNwsAreaList(props.areaDesc),
        senderName: normalizeNwsAlertText(props.senderName || props.sender, 240),
        response: normalizeNwsAlertText(props.response, 120),
        messageType: normalizeNwsAlertText(props.messageType, 120),
        category: normalizeNwsAlertText(props.category, 120),
        onset: props.onset || null,
        ends: props.ends || null,
        sent: props.sent || null,
        effective: props.effective || null,
        expires: props.expires || null,
        link: resolveNwsAlertSourceLink({ feature, props, lat, lon }),
      };
    })
    .sort(
      (a, b) =>
        ALERT_SEVERITY_RANK[normalizeAlertSeverity(b.severity)] - ALERT_SEVERITY_RANK[normalizeAlertSeverity(a.severity)],
    )
    .slice(0, 6);

  return {
    source: 'NOAA/NWS Active Alerts',
    status: 'ok',
    activeCount: alertsActiveAtTarget.length,
    totalActiveCount: features.length,
    targetTime: targetTimeIso || null,
    highestSeverity: formatAlertSeverity(highestSeverity),
    alerts: parsedAlerts,
  };
};

const fetchAirQualityData = async (lat, lon, targetForecastTimeIso, fetchOptions) => {
  const aqiRes = await fetchWithTimeout(
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=us_aqi,pm2_5,pm10,ozone&timezone=UTC`,
    fetchOptions,
  );
  if (!aqiRes.ok) {
    throw new Error(`Open-Meteo air quality request failed with status ${aqiRes.status}`);
  }

  const aqiJson = await aqiRes.json();
  const hourly = aqiJson?.hourly || {};
  const timeArray = Array.isArray(hourly?.time) ? hourly.time : [];
  if (!timeArray.length) {
    return createUnavailableAirQualityData('no_data');
  }

  const targetTimeMs = parseIsoTimeToMs(targetForecastTimeIso) ?? Date.now();
  const timeIdx = findClosestTimeIndex(timeArray, targetTimeMs);
  if (timeIdx < 0) {
    return createUnavailableAirQualityData('no_data');
  }

  const usAqi = Number(hourly?.us_aqi?.[timeIdx]);
  const pm25 = Number(hourly?.pm2_5?.[timeIdx]);
  const pm10 = Number(hourly?.pm10?.[timeIdx]);
  const ozone = Number(hourly?.ozone?.[timeIdx]);
  const measuredTime = withExplicitTimezone(timeArray[timeIdx] || null, aqiJson?.timezone || 'UTC');

  return {
    source: 'Open-Meteo Air Quality API',
    status: 'ok',
    usAqi: Number.isFinite(usAqi) ? Math.round(usAqi) : null,
    category: classifyUsAqi(usAqi),
    pm25: Number.isFinite(pm25) ? Number(pm25.toFixed(1)) : null,
    pm10: Number.isFinite(pm10) ? Number(pm10.toFixed(1)) : null,
    ozone: Number.isFinite(ozone) ? Number(ozone.toFixed(1)) : null,
    measuredTime,
  };
};

const sumRollingAccumulation = (timeArray, valuesArray, anchorMs, lookbackHours) => {
  if (!Array.isArray(timeArray) || !Array.isArray(valuesArray) || !Number.isFinite(anchorMs)) {
    return null;
  }

  const lowerBoundMs = anchorMs - lookbackHours * 60 * 60 * 1000;
  let total = 0;
  let sampleCount = 0;

  for (let idx = 0; idx < timeArray.length; idx += 1) {
    const sampleMs = parseIsoTimeToMs(timeArray[idx]);
    if (sampleMs === null || sampleMs > anchorMs || sampleMs <= lowerBoundMs) {
      continue;
    }
    const value = Number(valuesArray[idx]);
    if (!Number.isFinite(value) || value < 0) {
      continue;
    }
    total += value;
    sampleCount += 1;
  }

  return sampleCount > 0 ? Number(total.toFixed(1)) : null;
};

const seriesHasFiniteValues = (series) => Array.isArray(series) && series.some((value) => Number.isFinite(Number(value)) && Number(value) >= 0);

const sumForwardAccumulation = (timeArray, valuesArray, startMs, windowHours) => {
  if (!Array.isArray(timeArray) || !Array.isArray(valuesArray) || !Number.isFinite(startMs) || !Number.isFinite(windowHours) || windowHours <= 0) {
    return null;
  }

  const upperBoundMs = startMs + windowHours * 60 * 60 * 1000;
  let total = 0;
  let sampleCount = 0;

  for (let idx = 0; idx < timeArray.length; idx += 1) {
    const sampleMs = parseIsoTimeToMs(timeArray[idx]);
    if (sampleMs === null || sampleMs < startMs || sampleMs >= upperBoundMs) {
      continue;
    }
    const value = Number(valuesArray[idx]);
    if (!Number.isFinite(value) || value < 0) {
      continue;
    }
    total += value;
    sampleCount += 1;
  }

  return sampleCount > 0 ? Number(total.toFixed(1)) : null;
};

const findFirstTimeIndexAtOrAfter = (timeArray, targetTimeMs) => {
  if (!Array.isArray(timeArray) || !timeArray.length || !Number.isFinite(targetTimeMs)) {
    return -1;
  }
  let bestIdx = -1;
  let bestMs = Number.POSITIVE_INFINITY;
  for (let idx = 0; idx < timeArray.length; idx += 1) {
    const sampleMs = parseIsoTimeToMs(timeArray[idx]);
    if (sampleMs === null || sampleMs < targetTimeMs) {
      continue;
    }
    if (sampleMs < bestMs) {
      bestMs = sampleMs;
      bestIdx = idx;
    }
  }
  return bestIdx;
};

const clampTravelWindowHours = (rawValue, fallback = 12) => {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(1, Math.min(48, Math.round(numeric)));
};

const mmToInches = (valueMm) => {
  const numeric = Number(valueMm);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Number((numeric * INCHES_PER_MM).toFixed(2));
};

const cmToInches = (valueCm) => {
  const numeric = Number(valueCm);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Number((numeric * INCHES_PER_CM).toFixed(2));
};

const buildPrecipitationSummaryForAi = (rainfallData) => {
  const totals = rainfallData?.totals || {};
  const rain24hIn = Number(totals.rainPast24hIn ?? totals.past24hIn);
  const snow24hIn = Number(totals.snowPast24hIn);
  const summaryParts = [];

  if (Number.isFinite(rain24hIn)) {
    summaryParts.push(`rain (24h) ${rain24hIn.toFixed(2)} in`);
  }
  if (Number.isFinite(snow24hIn)) {
    summaryParts.push(`snowfall (24h) ${snow24hIn.toFixed(2)} in`);
  }
  if (!summaryParts.length) {
    return 'Recent rain/snow accumulation unavailable.';
  }
  return `Recent ${summaryParts.join(', ')}.`;
};

const buildOpenMeteoRainfallApiUrl = (host, lat, lon) => {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: 'UTC',
    past_days: '3',
    // Keep this at/above the planner horizon so selected future start times still get precip totals.
    forecast_days: '8',
    hourly: 'precipitation,rain,snowfall',
  });
  return `https://${host}/v1/forecast?${params.toString()}`;
};

const buildOpenMeteoRainfallSourceLink = (lat, lon) => buildOpenMeteoRainfallApiUrl('api.open-meteo.com', lat, lon);

const fetchRecentRainfallData = async (lat, lon, targetForecastTimeIso, travelWindowHours, fetchOptions) => {
  const apiUrls = [
    buildOpenMeteoRainfallApiUrl('api.open-meteo.com', lat, lon),
    buildOpenMeteoRainfallApiUrl('customer-api.open-meteo.com', lat, lon),
  ];

  let rainfallJson = null;
  let lastError = null;

  for (const apiUrl of apiUrls) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await fetchWithTimeout(apiUrl, fetchOptions, Math.max(REQUEST_TIMEOUT_MS, 10000));
        if (!response.ok) {
          throw new Error(`Open-Meteo rainfall request failed with status ${response.status}`);
        }
        rainfallJson = await response.json();
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (rainfallJson) {
      break;
    }
  }

  if (!rainfallJson) {
    throw lastError || new Error('Open-Meteo rainfall request failed');
  }

  const hourly = rainfallJson?.hourly || {};
  const timeArray = Array.isArray(hourly?.time) ? hourly.time : [];
  const precipArray = Array.isArray(hourly?.precipitation) ? hourly.precipitation : [];
  const rainArray = Array.isArray(hourly?.rain) ? hourly.rain : [];
  const snowfallArray = Array.isArray(hourly?.snowfall) ? hourly.snowfall : [];
  if (!timeArray.length || (!precipArray.length && !rainArray.length && !snowfallArray.length)) {
    return createUnavailableRainfallData('no_data');
  }

  const targetTimeMs = parseIsoTimeToMs(targetForecastTimeIso) ?? Date.now();
  const anchorIdx = findClosestTimeIndex(timeArray, targetTimeMs);
  if (anchorIdx < 0) {
    return createUnavailableRainfallData('no_data');
  }

  const anchorTime = timeArray[anchorIdx] || null;
  const anchorMs = parseIsoTimeToMs(anchorTime) ?? targetTimeMs;
  const rainSeries = seriesHasFiniteValues(rainArray)
    ? rainArray
    : seriesHasFiniteValues(precipArray)
      ? precipArray
      : rainArray.length
        ? rainArray
        : precipArray;
  const rainPast12hMm = sumRollingAccumulation(timeArray, rainSeries, anchorMs, 12);
  const rainPast24hMm = sumRollingAccumulation(timeArray, rainSeries, anchorMs, 24);
  const rainPast48hMm = sumRollingAccumulation(timeArray, rainSeries, anchorMs, 48);
  const snowPast12hCm = sumRollingAccumulation(timeArray, snowfallArray, anchorMs, 12);
  const snowPast24hCm = sumRollingAccumulation(timeArray, snowfallArray, anchorMs, 24);
  const snowPast48hCm = sumRollingAccumulation(timeArray, snowfallArray, anchorMs, 48);
  const expectedWindowHours = clampTravelWindowHours(travelWindowHours, 12);
  const expectedStartIdx = findFirstTimeIndexAtOrAfter(timeArray, targetTimeMs);
  const expectedStartTime = expectedStartIdx >= 0 ? timeArray[expectedStartIdx] : null;
  const expectedStartMs = parseIsoTimeToMs(expectedStartTime);
  const rainWindowMm = expectedStartMs === null ? null : sumForwardAccumulation(timeArray, rainSeries, expectedStartMs, expectedWindowHours);
  const snowWindowCm = expectedStartMs === null ? null : sumForwardAccumulation(timeArray, snowfallArray, expectedStartMs, expectedWindowHours);
  const expectedEndMs = expectedStartMs === null ? null : expectedStartMs + expectedWindowHours * 60 * 60 * 1000;
  const expectedEndTime = expectedEndMs === null ? null : new Date(expectedEndMs).toISOString();
  const expectedHasAnyTotals = [rainWindowMm, snowWindowCm].some((value) => Number.isFinite(value));
  const mode = targetTimeMs > Date.now() + 60 * 60 * 1000 ? 'projected_for_selected_start' : 'observed_recent';
  const hasAnyTotals = [
    rainPast12hMm,
    rainPast24hMm,
    rainPast48hMm,
    snowPast12hCm,
    snowPast24hCm,
    snowPast48hCm,
  ].some((value) => Number.isFinite(value));

  return {
    source: 'Open-Meteo Precipitation History (Rain + Snowfall)',
    status: hasAnyTotals ? 'ok' : 'no_data',
    mode,
    issuedTime: anchorTime,
    anchorTime,
    timezone: rainfallJson?.timezone || 'UTC',
    expected: {
      status: expectedHasAnyTotals ? 'ok' : 'no_data',
      travelWindowHours: expectedWindowHours,
      startTime: expectedStartTime,
      endTime: expectedEndTime,
      rainWindowMm,
      rainWindowIn: mmToInches(rainWindowMm),
      snowWindowCm,
      snowWindowIn: cmToInches(snowWindowCm),
      note: expectedHasAnyTotals
        ? `Expected precipitation totals for the next ${expectedWindowHours}h from selected start time.`
        : `Expected precipitation totals unavailable for the next ${expectedWindowHours}h from selected start time.`,
    },
    totals: {
      rainPast12hMm,
      rainPast24hMm,
      rainPast48hMm,
      rainPast12hIn: mmToInches(rainPast12hMm),
      rainPast24hIn: mmToInches(rainPast24hMm),
      rainPast48hIn: mmToInches(rainPast48hMm),
      snowPast12hCm,
      snowPast24hCm,
      snowPast48hCm,
      snowPast12hIn: cmToInches(snowPast12hCm),
      snowPast24hIn: cmToInches(snowPast24hCm),
      snowPast48hIn: cmToInches(snowPast48hCm),
      // Legacy aliases retained for compatibility with older clients.
      past12hMm: rainPast12hMm,
      past24hMm: rainPast24hMm,
      past48hMm: rainPast48hMm,
      past12hIn: mmToInches(rainPast12hMm),
      past24hIn: mmToInches(rainPast24hMm),
      past48hIn: mmToInches(rainPast48hMm),
    },
    note:
      hasAnyTotals
        ? mode === 'projected_for_selected_start'
          ? 'Rolling rain and snowfall totals are anchored to selected start time and can include forecast hours.'
          : 'Rolling rain and snowfall totals are based on recent hours prior to the selected period.'
        : 'Precipitation timeseries exists but rolling totals were not computable for this anchor window.',
    link: buildOpenMeteoRainfallSourceLink(lat, lon),
  };
};

const calculateSafetyScore = ({ weatherData, avalancheData, alertsData, airQualityData, fireRiskData, selectedDate, solarData, selectedStartClock }) => {
  const explanations = [];
  const factors = [];
  const groupCaps = {
    avalanche: 55,
    weather: 38,
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
  const wind = Number(weatherData?.windSpeed);
  const gust = Number(weatherData?.windGust);
  const precipChance = Number(weatherData?.precipChance);
  const humidity = Number(weatherData?.humidity);
  const tempF = Number(weatherData?.temp);
  const feelsLikeF = Number.isFinite(Number(weatherData?.feelsLike)) ? Number(weatherData?.feelsLike) : tempF;
  const isDaytime = weatherData?.isDaytime;

  const normalizedRisk = String(avalancheData?.risk || '').toLowerCase();
  const avalancheRelevant = avalancheData?.relevant !== false;
  const avalancheUnknown = avalancheRelevant
    && Boolean(avalancheData?.dangerUnknown || normalizedRisk.includes('unknown') || normalizedRisk.includes('no forecast'));
  const avalancheDangerLevel = Number(avalancheData?.dangerLevel);
  const avalancheProblemCount = Array.isArray(avalancheData?.problems) ? avalancheData.problems.length : 0;

  const alertsStatus = String(alertsData?.status || '');
  const alertsRelevantForSelectedTime = true;
  const alertsCount = Number(alertsData?.activeCount);
  const highestAlertSeverity = normalizeAlertSeverity(alertsData?.highestSeverity);
  const alertEvents =
    Array.isArray(alertsData?.alerts) && alertsData.alerts.length
      ? [...new Set(alertsData.alerts.map((alert) => alert.event).filter(Boolean))].slice(0, 3)
      : [];

  const usAqi = Number(airQualityData?.usAqi);
  const aqiCategory = String(airQualityData?.category || 'Unknown');

  const trend = Array.isArray(weatherData?.trend) ? weatherData.trend : [];
  const trendTemps = trend.map((item) => Number(item?.temp)).filter(Number.isFinite);
  const trendGusts = trend.map((item) => Number.isFinite(Number(item?.gust)) ? Number(item.gust) : Number(item?.wind)).filter(Number.isFinite);
  const tempRange = trendTemps.length ? Math.max(...trendTemps) - Math.min(...trendTemps) : 0;
  const trendPeakGust = trendGusts.length ? Math.max(...trendGusts) : Number.isFinite(gust) ? gust : 0;
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

  if (Number.isFinite(gust) && (gust >= 50 || wind >= 35)) {
    applyFactor('Wind', 20, `Severe wind exposure expected (wind ${wind || 0} mph, gust ${gust} mph).`, 'NOAA hourly forecast');
  } else if (Number.isFinite(gust) && (gust >= 40 || wind >= 25)) {
    applyFactor('Wind', 12, `Strong winds expected (wind ${wind || 0} mph, gust ${gust} mph).`, 'NOAA hourly forecast');
  } else if (Number.isFinite(wind) && wind >= 18) {
    applyFactor('Wind', 6, `Moderate sustained winds (${wind} mph) may affect balance on exposed terrain.`, 'NOAA hourly forecast');
  }

  if (Number.isFinite(precipChance) && precipChance >= 70) {
    applyFactor('Storm', 12, `High precipitation probability (${precipChance}%) raises footing and visibility hazards.`, 'NOAA hourly forecast');
  } else if (Number.isFinite(precipChance) && precipChance >= 40) {
    applyFactor('Storm', 6, `Precipitation chance (${precipChance}%) may produce wet/slick travel conditions.`, 'NOAA hourly forecast');
  }

  if (/thunderstorm|lightning|blizzard/.test(weatherDescription)) {
    applyFactor('Storm', 18, `Convective or severe weather signal in forecast: "${weatherData.description}".`, 'NOAA short forecast');
  } else if (/snow|sleet|freezing rain|ice/.test(weatherDescription)) {
    applyFactor('Winter Weather', 10, `Frozen precipitation in forecast ("${weatherData.description}") increases travel hazard.`, 'NOAA short forecast');
  } else if (/fog|smoke|haze/.test(weatherDescription)) {
    applyFactor('Visibility', 6, `Reduced-visibility weather in forecast ("${weatherData.description}").`, 'NOAA short forecast');
  }

  if (Number.isFinite(feelsLikeF) && feelsLikeF <= 0) {
    applyFactor('Cold', 12, `Very cold apparent temperature (${feelsLikeF}F) increases cold-injury and dexterity risk.`, 'NOAA temp + windchill');
  } else if (Number.isFinite(feelsLikeF) && feelsLikeF <= 15) {
    applyFactor('Cold', 7, `Cold apparent temperature (${feelsLikeF}F) requires stronger insulation and exposure control.`, 'NOAA temp + windchill');
  }

  if (Number.isFinite(tempF) && tempF >= 90) {
    applyFactor('Heat', 10, `Hot forecast temperature (${tempF}F) increases dehydration and heat illness risk.`, 'NOAA hourly temperature');
  } else if (Number.isFinite(tempF) && tempF >= 80 && Number.isFinite(humidity) && humidity >= 70) {
    applyFactor('Heat', 6, `Warm and humid conditions (${tempF}F, ${humidity}% RH) can degrade pace and recovery.`, 'NOAA temperature + humidity');
  }

  if (isDaytime === false && !isNightBeforeSunrise) {
    applyFactor('Darkness', 5, 'Selected forecast period is nighttime, reducing navigation margin and terrain visibility.', 'NOAA isDaytime flag');
  }

  if (Number.isFinite(tempRange) && tempRange >= 18) {
    applyFactor('Weather Volatility', 6, `Large 12-hour temperature swing (${Math.round(tempRange)}F) suggests unstable conditions.`, 'NOAA hourly trend');
  }
  if (Number.isFinite(trendPeakGust) && trendPeakGust >= 45 && (!Number.isFinite(gust) || gust < 45)) {
    applyFactor('Wind', 6, `Peak gusts in the next 12 hours reach ${Math.round(trendPeakGust)} mph.`, 'NOAA hourly trend');
  }

  if (forecastLeadHours !== null && forecastLeadHours > 1) {
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
      uncertaintyImpact += 3;
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

  if (Number.isFinite(usAqi)) {
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

  const fireLevel = Number(fireRiskData?.level);
  if (Number.isFinite(fireLevel) && fireLevel >= 4) {
    applyFactor('Fire Danger', 16, 'Extreme fire-weather/alert signal for this objective window.', fireRiskData?.source || 'Fire risk synthesis');
  } else if (Number.isFinite(fireLevel) && fireLevel >= 3) {
    applyFactor('Fire Danger', 10, 'High fire-weather signal: elevated spread potential or fire-weather alerts.', fireRiskData?.source || 'Fire risk synthesis');
  } else if (Number.isFinite(fireLevel) && fireLevel >= 2) {
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

  const nowMs = Date.now();
  const weatherIssuedMs = parseIsoTimeToMs(weatherData?.issuedTime);
  if (weatherIssuedMs === null) {
    applyConfidencePenalty(8, 'Weather issue time unavailable.');
  } else {
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
  if (airQualityData?.status === 'unavailable') {
    applyConfidencePenalty(6, 'Air quality feed unavailable.');
  } else if (airQualityData?.status === 'no_data') {
    applyConfidencePenalty(3, 'Air quality point data unavailable.');
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
    airQualityData?.status === 'ok' || airQualityData?.status === 'no_data' ? 'Open-Meteo air quality' : null,
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

  // "Almost worst-case" overall: if one isolated outlier is much higher, keep overall one step below max.
  if (maxLevel - minLevel >= 2 && maxCount === 1) {
    return Math.max(1, maxLevel - 1);
  }

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
  const { lat, lon, date, start, travel_window_hours: travelWindowHoursRaw, travelWindowHours } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: 'Latitude and longitude are required' });
  }

  const parsedLat = Number(lat);
  const parsedLon = Number(lon);
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon) || parsedLat < -90 || parsedLat > 90 || parsedLon < -180 || parsedLon > 180) {
    return res.status(400).json({ error: 'Latitude/longitude must be valid decimal coordinates.' });
  }

  const requestedDate = typeof date === 'string' ? date.trim() : '';
  if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
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

      // Get 12-hour trend from selected forecast date
      const hourlyTrend = periods.slice(forecastStartIndex, forecastStartIndex + 12).map((p, offset) => {
        const rowIndex = forecastStartIndex + offset;
        const windSpeedValue = parseWindMph(p.windSpeed, 0);
        const { gustMph: windGustValue } = inferWindGustFromPeriods(periods, rowIndex, windSpeedValue);
        const trendTemp = Number.isFinite(p.temperature) ? p.temperature : 0;
        const trendPrecip = Number.isFinite(p?.probabilityOfPrecipitation?.value) ? p.probabilityOfPrecipitation.value : 0;

        return {
          time: hourLabelFromIso(p.startTime, pointsData?.properties?.timeZone || null),
          timeIso: p.startTime || null,
          temp: trendTemp,
          wind: windSpeedValue,
          gust: windGustValue,
          windDirection: findNearestWindDirection(periods, rowIndex),
          precipChance: trendPrecip,
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
          },
        },
        elevationForecast: elevationForecastBands,
        elevationForecastNote:
          objectiveElevationFt !== null
            ? `Estimated from objective elevation down through terrain bands using lapse-rate adjustments per 1,000 ft. Baseline elevation source: ${objectiveElevationSource || 'unknown source'}.`
            : 'Objective elevation unavailable from NOAA and fallback elevation services; elevation-based estimate could not be generated.',
        forecastLink: `https://forecast.weather.gov/MapClick.php?lat=${parsedLat}&lon=${parsedLon}`
      };

      if (!weatherData.windDirection && currentWindSpeed <= 2) {
        weatherData.windDirection = 'CALM';
      }

      terrainConditionData = deriveTerrainCondition(weatherData);
      trailStatus = terrainConditionData.label;

      // NOAA remains primary; supplement missing/noisy fields with Open-Meteo when needed.
      if (
        !weatherData.windDirection ||
        !weatherData.issuedTime ||
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

	    // 3. Get Live Avalanche Data using Map Layer + Point in Polygon
	    try {
	      const avyJson = await getAvalancheMapLayer(fetchOptions);
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
                : {
                    below: { level: parseInt(props.danger_low) || mainLvl, label: levelMap[parseInt(props.danger_low) || mainLvl] },
                    at: { level: parseInt(props.danger_mid) || mainLvl, label: levelMap[parseInt(props.danger_mid) || mainLvl] },
                    above: { level: parseInt(props.danger_high) || mainLvl, label: levelMap[parseInt(props.danger_high) || mainLvl] }
                  }
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

		            for (const attempt of detailAttempts) {
		              try {
		                avyLog(`[Avy] Trying ${attempt.label}: ${attempt.url}`);
		                const candidateRes = await fetchWithTimeout(attempt.url, fetchOptions);
		                if (!candidateRes.ok) {
		                  avyLog(`[Avy] ${attempt.label} failed with status ${candidateRes.status}`);
		                  continue;
		                }

		                const candidateText = await candidateRes.text();
                const candidatePayloads = parseAvalancheDetailPayloads(candidateText);
                if (!candidatePayloads.length) {
                  avyLog(`[Avy] ${attempt.label} returned non-JSON payload.`);
                  continue;
                }

                const bestCandidate = pickBestAvalancheDetailCandidate({
                  payloads: candidatePayloads,
                  centerId: props.center_id,
                  zoneId,
                  zoneSlug,
                  zoneName: props.name,
                  cleanForecastText,
                });

                if (!bestCandidate) {
                  avyLog(`[Avy] ${attempt.label} returned shell data. Trying next endpoint.`);
                  continue;
                }

			                detailDet = bestCandidate.candidate;
                detailProblems = bestCandidate.problems;
			                avyLog(
                  `[Avy] Using ${attempt.label} for ${props.center_id} ` +
                    `(score ${bestCandidate.score}, problems ${detailProblems.length}).`,
                );
			                break;
			              } catch (attemptErr) {
			                avyLog(`[Avy] ${attempt.label} parse/fetch error: ${attemptErr.message}`);
			              }
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
                if (det.danger && det.danger.length > 0) {
                   const currentDay = det.danger.find(d => d.valid_day === 'current') || det.danger[0];
                   avalancheData.elevations = {
                     below: { level: parseInt(currentDay.lower), label: levelMap[parseInt(currentDay.lower)] },
                     at: { level: parseInt(currentDay.middle), label: levelMap[parseInt(currentDay.middle)] },
                     above: { level: parseInt(currentDay.upper), label: levelMap[parseInt(currentDay.upper)] }
                   };
                } else if (det.danger_low) {
                  avalancheData.elevations = {
                    below: { level: parseInt(det.danger_low), label: levelMap[parseInt(det.danger_low)] },
                    at: { level: parseInt(det.danger_mid), label: levelMap[parseInt(det.danger_mid)] },
                    above: { level: parseInt(det.danger_high), label: levelMap[parseInt(det.danger_high)] }
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
                     avalancheData.elevations = {
                       below: { level: l, label: levelMap[l] },
                       at: { level: m, label: levelMap[m] },
                       above: { level: u, label: levelMap[u] }
                     };
                  }
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

    const airQualityTargetTime =
      selectedForecastPeriod?.startTime ||
      (selectedForecastDate ? `${selectedForecastDate}T12:00:00Z` : new Date().toISOString());

    const alertTargetTimeIso = buildPlannedStartIso({
      selectedDate: selectedForecastDate || requestedDate || '',
      startClock: requestedStartClock,
      referenceIso: weatherData?.forecastStartTime || selectedForecastPeriod?.startTime || weatherData?.issuedTime || null,
    });

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
        dangerUnknown: false,
        bottomLine: cleanForecastText(
          `${avalancheData?.bottomLine || ''} NOTE: This bulletin expires before the selected start time. Treat this as stale guidance and verify the latest avalanche center update before departure.`,
        ),
      };
    }

    const [alertsResult, airQualityResult, rainfallResult, snowpackResult] = await Promise.allSettled([
      fetchWeatherAlertsData(parsedLat, parsedLon, fetchOptions, alertTargetTimeIso),
      fetchAirQualityData(parsedLat, parsedLon, airQualityTargetTime, fetchOptions),
      fetchRecentRainfallData(parsedLat, parsedLon, alertTargetTimeIso || airQualityTargetTime, requestedTravelWindowHours, fetchOptions),
      fetchSnowpackData(parsedLat, parsedLon, selectedForecastDate, fetchOptions),
    ]);

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
      selectedDate: selectedForecastDate,
      solarData,
      selectedStartClock: requestedStartClock,
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
      selectedDate: fallbackSelectedDate,
      solarData,
      selectedStartClock: requestedStartClock,
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
