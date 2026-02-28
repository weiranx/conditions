import { 
  REQUEST_TIMEOUT_MS 
} from '../server/runtime';
import { 
  parseIsoTimeToMs, 
  findClosestTimeIndex, 
  withExplicitTimezone, 
  hourLabelFromIso,
  findFirstTimeIndexAtOrAfter,
  normalizeUtcIsoTimestamp,
  buildTemperatureContext24h
} from './time';
import { 
  computeFeelsLikeF, 
  clampTravelWindowHours,
  normalizePressureHpa,
  openMeteoCodeToText,
  estimateWindGustFromWindSpeed,
  findNearestCardinalFromDegreeSeries,
  buildElevationForecastBands,
  buildVisibilityRisk,
  normalizeAlertSeverity,
  getHigherSeverity,
  formatAlertSeverity,
  classifyUsAqi,
  createUnavailableAirQualityData,
  createUnavailableRainfallData,
  createUnavailableAlertsData,
  mmToInches,
  cmToInches,
  seriesHasFiniteValues,
  sumRollingAccumulation,
  sumForwardAccumulation,
  buildOpenMeteoRainfallSourceLink,
  normalizeNwsAlertText,
  normalizeNwsAreaList
} from './weather';
import { deriveTrailStatus, deriveTerrainCondition } from './terrain-condition';
import { normalizeExternalLink } from './avalanche-scraper';

const RAINFALL_CACHE_TTL_MS = 30 * 60 * 1000;
const rainfallPayloadCache = new Map<string, { fetchedAt: number; payload: any }>();

const OPEN_METEO_WEATHER_HOURLY_FIELDS = [
  'temperature_2m',
  'dew_point_2m',
  'relative_humidity_2m',
  'precipitation_probability',
  'cloud_cover',
  'surface_pressure',
  'weather_code',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'is_day',
].join(',');

const buildOpenMeteoWeatherApiUrl = (host: string, lat: number, lon: number): string => {
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

const buildOpenMeteoWeatherSourceLink = (lat: number, lon: number): string => buildOpenMeteoWeatherApiUrl('api.open-meteo.com', lat, lon);

interface FetchOpenMeteoWeatherFallbackOptions {
  lat: number;
  lon: number;
  selectedDate: string | null | undefined;
  startClock: string | null | undefined;
  fetchWithTimeout: Function;
  fetchOptions: any;
  objectiveElevationFt: number | null;
  objectiveElevationSource: string | null;
  trendHours: number | string | null | undefined;
  parseStartClock: Function;
}

export const fetchOpenMeteoWeatherFallback = async ({
  lat,
  lon,
  selectedDate,
  startClock,
  fetchWithTimeout,
  fetchOptions,
  objectiveElevationFt,
  objectiveElevationSource,
  trendHours,
  parseStartClock
}: FetchOpenMeteoWeatherFallbackOptions): Promise<any> => {
  const apiUrls = [
    buildOpenMeteoWeatherApiUrl('api.open-meteo.com', lat, lon),
    buildOpenMeteoWeatherApiUrl('customer-api.open-meteo.com', lat, lon),
  ];

  let payload: any = null;
  let payloadIssuedTime: string | null = null;
  let lastError: any = null;

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

  const availableDates = [...new Set(hourlyTimes.map((timeValue: any) => String(timeValue).slice(0, 10)).filter(Boolean))];
  const resolvedDate = selectedDate && availableDates.includes(selectedDate) ? selectedDate : (availableDates[0] || new Date().toISOString().slice(0, 10));
  const dayHourIndexes = hourlyTimes
    .map((timeValue: any, idx: number) => ({ timeValue, idx }))
    .filter((entry: any) => String(entry.timeValue).slice(0, 10) === resolvedDate)
    .map((entry: any) => entry.idx);
  const firstHourIndex = dayHourIndexes.length > 0 ? dayHourIndexes[0] : hourlyTimes.findIndex((timeValue: any) => String(timeValue).slice(0, 10) === resolvedDate);
  let selectedHourIndex = firstHourIndex >= 0 ? firstHourIndex : 0;
  
  const requestedStartMinutesValue = parseStartClock(startClock);
  if (requestedStartMinutesValue && dayHourIndexes.length > 0) {
    const [hourPart, minutePart] = requestedStartMinutesValue.split(':');
    const targetMinutes = Number(hourPart) * 60 + Number(minutePart);
    const byStart = dayHourIndexes.find((idx: number) => {
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

  const readHourlyValue = (key: string, index: number, fallback: number = 0) => {
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
  const pressureSeries = hourly && Array.isArray(hourly.surface_pressure) ? hourly.surface_pressure : [];
  const rawCurrentPressure = Number(pressureSeries[selectedHourIndex]);
  const currentPressure = normalizePressureHpa(rawCurrentPressure);
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

  const forecastTrendHours = clampTravelWindowHours(trendHours, 12);
  for (let offset = 0; offset < forecastTrendHours; offset += 1) {
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
      humidity: Math.round(readHourlyValue('relative_humidity_2m', rowIndex, currentHumidity)),
      dewPoint: (() => {
        const rawDewPoint = Number(dewPointSeries[rowIndex]);
        return Number.isFinite(rawDewPoint) ? Math.round(rawDewPoint) : null;
      })(),
      cloudCover: Math.round(readHourlyValue('cloud_cover', rowIndex, currentCloud)),
      pressure: normalizePressureHpa(Number(pressureSeries[rowIndex])),
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
    pressure: currentPressure,
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
    visibilityRisk: null,
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
            pressure: currentPressure !== null ? 'Open-Meteo' : 'Unavailable',
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
        visibilityRisk: 'Derived from Open-Meteo weather fields',
      },
    },
    elevationForecast: elevationForecastBands,
    elevationForecastNote:
      objectiveElevationFt !== null
        ? `Estimated from objective elevation down through terrain bands using lapse-rate adjustments per 1,000 ft. Baseline elevation source: ${objectiveElevationSource || 'unknown source'}.`
        : 'Objective elevation unavailable from NOAA and fallback elevation services; elevation-based estimate could not be generated.',
    forecastLink: buildOpenMeteoWeatherSourceLink(lat, lon),
  };
  weatherData.visibilityRisk = buildVisibilityRisk(weatherData);

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

const buildNwsAlertUrlFromId = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const absolute = normalizeExternalLink(trimmed);
  if (absolute) {
    return absolute;
  }
  return `https://api.weather.gov/alerts/${encodeURIComponent(trimmed)}`;
};

const isGenericNwsLink = (value: string | null | undefined): boolean => {
  const normalized = normalizeExternalLink(value);
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

const isIndividualNwsAlertLink = (value: string | null | undefined): boolean => {
  const normalized = normalizeExternalLink(value);
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

export const resolveNwsAlertSourceLink = ({ feature, props, lat, lon }: { feature: any; props: any; lat: number | string; lon: number | string }): string | null => {
  const individualAlertUrl = [feature?.id, props?.['@id'], props?.id, props?.identifier]
    .map(buildNwsAlertUrlFromId)
    .find(isIndividualNwsAlertLink);
  if (individualAlertUrl) {
    return individualAlertUrl;
  }

  const directUrl = [props?.uri, props?.web, props?.url, props?.link, props?.['@id'], feature?.id]
    .map(normalizeExternalLink)
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

export const fetchWeatherAlertsData = async (lat: number | string, lon: number | string, fetchWithTimeout: Function, fetchOptions: any, targetTimeIso: string | null = null): Promise<any> => {
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

  const alertsActiveAtTarget = features.filter((feature: any) => {
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
    .map((feature: any) => {
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
      (a: any, b: any) => {
        const { ALERT_SEVERITY_RANK } = require('./weather');
        return ALERT_SEVERITY_RANK[normalizeAlertSeverity(b.severity)] - ALERT_SEVERITY_RANK[normalizeAlertSeverity(a.severity)];
      }
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

export const fetchAirQualityData = async (lat: number | string, lon: number | string, targetForecastTimeIso: string | null | undefined, fetchWithTimeout: Function, fetchOptions: any): Promise<any> => {
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

const buildOpenMeteoRainfallApiUrl = (host: string, lat: number | string, lon: number | string): string => {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: 'UTC',
    past_days: '3',
    forecast_days: '8',
    hourly: 'precipitation,rain,snowfall',
  });
  return `https://${host}/v1/forecast?${params.toString()}`;
};

const buildOpenMeteoRainfallArchiveApiUrl = (host: string, lat: number | string, lon: number | string, startDate: string, endDate: string): string => {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: 'UTC',
    start_date: startDate,
    end_date: endDate,
    hourly: 'precipitation,rain,snowfall',
  });
  return `https://${host}/v1/archive?${params.toString()}`;
};

const buildRainfallZeroFallback = ({ lat, lon, targetForecastTimeIso, travelWindowHours, reason }: { lat: number | string; lon: number | string; targetForecastTimeIso: string | null | undefined; travelWindowHours: number | string | null | undefined; reason: string }): any => {
  const expectedWindowHours = clampTravelWindowHours(travelWindowHours, 12);
  const normalizedTargetTime = normalizeUtcIsoTimestamp(targetForecastTimeIso);
  const fallbackAnchorTime = normalizedTargetTime || new Date().toISOString();
  const fallbackAnchorMs = parseIsoTimeToMs(fallbackAnchorTime) ?? Date.now();
  const fallbackEndTime = new Date(fallbackAnchorMs + expectedWindowHours * 60 * 60 * 1000).toISOString();
  const fallbackReason = typeof reason === 'string' && reason.trim() ? reason.trim() : 'upstream precipitation feed unavailable';
  const fallbackMode = !normalizedTargetTime
    ? 'unknown'
    : fallbackAnchorMs > Date.now() + 60 * 60 * 1000
    ? 'projected_for_selected_start'
    : 'observed_recent';

  return {
    source: 'Open-Meteo Precipitation Fallback (zeroed totals)',
    status: 'partial',
    mode: fallbackMode,
    issuedTime: fallbackAnchorTime,
    anchorTime: fallbackAnchorTime,
    timezone: 'UTC',
    fallbackMode: 'zeroed_totals',
    expected: {
      status: 'no_data',
      travelWindowHours: expectedWindowHours,
      startTime: fallbackAnchorTime,
      endTime: fallbackEndTime,
      rainWindowMm: null,
      rainWindowIn: null,
      snowWindowCm: null,
      snowWindowIn: null,
      note: `Expected precipitation unavailable for the next ${expectedWindowHours}h because upstream feed data was unavailable.`,
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
      past12hMm: null,
      past24hMm: null,
      past48hMm: null,
      past12hIn: null,
      past24hIn: null,
      past48hIn: null,
    },
    note: `Precipitation totals are on conservative zero fallback because upstream data could not be fetched (${fallbackReason}). Verify upstream before relying on this window.`,
    link: buildOpenMeteoRainfallSourceLink(Number(lat), Number(lon)),
  };
};

export const fetchRecentRainfallData = async (lat: number | string, lon: number | string, targetForecastTimeIso: string | null | undefined, travelWindowHours: number | string | null | undefined, fetchWithTimeout: Function, fetchOptions: any): Promise<any> => {
  const rainfallCacheKey = `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
  const apiUrls = [
    buildOpenMeteoRainfallApiUrl('api.open-meteo.com', lat, lon),
    buildOpenMeteoRainfallApiUrl('customer-api.open-meteo.com', lat, lon),
  ];

  let rainfallJson: any = null;
  let usingCachedPayload = false;
  let usingStaleCachedPayload = false;
  let usingArchivePayload = false;
  let lastError: any = null;

  for (const apiUrl of apiUrls) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetchWithTimeout(apiUrl, fetchOptions, Math.max(REQUEST_TIMEOUT_MS, 12000));
        if (!response.ok) {
          throw new Error(`Open-Meteo rainfall request failed with status ${response.status}`);
        }
        rainfallJson = await response.json();
        rainfallPayloadCache.set(rainfallCacheKey, {
          fetchedAt: Date.now(),
          payload: rainfallJson,
        });
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
    const cachedEntry = rainfallPayloadCache.get(rainfallCacheKey);
    const hasCachedPayload = Boolean(cachedEntry && cachedEntry.payload);
    const cachedFresh = hasCachedPayload && Date.now() - Number(cachedEntry!.fetchedAt || 0) <= RAINFALL_CACHE_TTL_MS;
    if (cachedFresh) {
      rainfallJson = cachedEntry!.payload;
      usingCachedPayload = true;
    } else {
      const staleCachedPayload = hasCachedPayload ? cachedEntry!.payload : null;
      const archiveEndDate = new Date().toISOString().slice(0, 10);
      const archiveStartDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const archiveApiUrl = buildOpenMeteoRainfallArchiveApiUrl('archive-api.open-meteo.com', lat, lon, archiveStartDate, archiveEndDate);
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const archiveResponse = await fetchWithTimeout(archiveApiUrl, fetchOptions, Math.max(REQUEST_TIMEOUT_MS, 12000));
          if (!archiveResponse.ok) {
            throw new Error(`Open-Meteo rainfall archive request failed with status ${archiveResponse.status}`);
          }
          rainfallJson = await archiveResponse.json();
          rainfallPayloadCache.set(rainfallCacheKey, { fetchedAt: Date.now(), payload: rainfallJson });
          usingArchivePayload = true;
          lastError = null;
          break;
        } catch (archiveError) {
          lastError = archiveError;
        }
      }

      if (!rainfallJson) {
        if (staleCachedPayload) {
          rainfallJson = staleCachedPayload;
          usingCachedPayload = true;
          usingStaleCachedPayload = true;
        } else {
          return buildRainfallZeroFallback({
            lat,
            lon,
            targetForecastTimeIso,
            travelWindowHours,
            reason: lastError?.message || 'Open-Meteo rainfall request failed',
          });
        }
      }
    }
  }

  const hourly = rainfallJson?.hourly || {};
  const timeArray = Array.isArray(hourly?.time) ? hourly.time : [];
  const precipArray = Array.isArray(hourly?.precipitation) ? hourly.precipitation : [];
  const rainArray = Array.isArray(hourly?.rain) ? hourly.rain : [];
  const snowfallArray = Array.isArray(hourly?.snowfall) ? hourly.snowfall : [];
  if (!timeArray.length || (!precipArray.length && !rainArray.length && !snowfallArray.length)) {
    return buildRainfallZeroFallback({
      lat,
      lon,
      targetForecastTimeIso,
      travelWindowHours,
      reason: 'timeseries missing from upstream payload',
    });
  }

  const targetTimeMs = parseIsoTimeToMs(targetForecastTimeIso) ?? Date.now();
  const anchorIdx = findClosestTimeIndex(timeArray, targetTimeMs);
  if (anchorIdx < 0) {
    return buildRainfallZeroFallback({
      lat,
      lon,
      targetForecastTimeIso,
      travelWindowHours,
      reason: 'timeseries did not include parsable timestamps',
    });
  }

  const anchorTime = normalizeUtcIsoTimestamp(timeArray[anchorIdx] || null);
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
  const archiveFutureTarget = usingArchivePayload && targetTimeMs > Date.now() + 60 * 60 * 1000;
  const expectedStartIdx = archiveFutureTarget ? -1 : findFirstTimeIndexAtOrAfter(timeArray, targetTimeMs);
  const expectedStartTime = expectedStartIdx >= 0 ? normalizeUtcIsoTimestamp(timeArray[expectedStartIdx]) : null;
  const expectedStartMs = parseIsoTimeToMs(expectedStartTime);
  const rainWindowMm = expectedStartMs === null ? null : sumForwardAccumulation(timeArray, rainSeries, expectedStartMs, expectedWindowHours);
  const snowWindowCm = expectedStartMs === null ? null : sumForwardAccumulation(timeArray, snowfallArray, expectedStartMs, expectedWindowHours);
  const expectedEndMs = expectedStartMs === null ? null : expectedStartMs + expectedWindowHours * 60 * 60 * 1000;
  const expectedEndTime = expectedEndMs === null ? null : new Date(expectedEndMs).toISOString();
  const expectedHasAnyTotals = [rainWindowMm, snowWindowCm].some((value) => Number.isFinite(value as number));
  const mode = targetTimeMs > Date.now() + 60 * 60 * 1000 ? 'projected_for_selected_start' : 'observed_recent';
  const hasAnyTotals = [
    rainPast12hMm,
    rainPast24hMm,
    rainPast48hMm,
    snowPast12hCm,
    snowPast24hCm,
    snowPast48hCm,
  ].some((value) => Number.isFinite(value as number));
  const hasAnyPrecipSignal = hasAnyTotals || expectedHasAnyTotals;

  return {
    source: usingArchivePayload
      ? 'Open-Meteo Archive Precipitation (Rain + Snowfall)'
      : usingStaleCachedPayload
      ? 'Open-Meteo Precipitation History (Rain + Snowfall, stale cached fallback)'
      : usingCachedPayload
      ? 'Open-Meteo Precipitation History (Rain + Snowfall, cached fallback)'
      : 'Open-Meteo Precipitation History (Rain + Snowfall)',
    status: hasAnyPrecipSignal ? 'ok' : 'no_data',
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
        : archiveFutureTarget
        ? `Archive data is historical only and cannot forecast precipitation for a future start time.`
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
      past12hMm: rainPast12hMm,
      past24hMm: rainPast24hMm,
      past48hMm: rainPast48hMm,
      past12hIn: mmToInches(rainPast12hMm),
      past24hIn: mmToInches(rainPast24hMm),
      past48hIn: mmToInches(rainPast48hMm),
    },
    note:
      hasAnyPrecipSignal
        ? mode === 'projected_for_selected_start'
          ? 'Rolling rain and snowfall totals are anchored to selected start time and can include forecast hours.'
          : 'Rolling rain and snowfall totals are based on recent hours prior to the selected period.'
        : 'Precipitation timeseries exists but rolling totals were not computable for this anchor window.',
    link: buildOpenMeteoRainfallSourceLink(lat, lon),
  };
};
