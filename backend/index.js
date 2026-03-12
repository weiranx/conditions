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
  inferWindGustFromPeriods,
  normalizeWindDirection,
  findNearestWindDirection,
} = require('./src/utils/wind');
const {
  parseIsoTimeToMs,
  parseIsoTimeToMsWithReference,
  parseStartClock,
  buildPlannedStartIso,
  parseClockToMinutes,
  formatMinutesToClock,
  clampTravelWindowHours,
} = require('./src/utils/time');
const {
  computeFeelsLikeF,
  normalizeNoaaDewPointF,
  normalizeNoaaPressureHpa,
  resolveNoaaCloudCover,
} = require('./src/utils/weather-normalizers');
const { buildVisibilityRisk, buildElevationForecastBands } = require('./src/utils/visibility-risk');
const {
  blendNoaaWeatherWithFallback,
  dateKeyInTimeZone,
  buildTemperatureContext24h,
  hourLabelFromIso,
  createWeatherDataService,
} = require('./src/utils/weather-data');
const {
  createUnavailableAirQualityData,
  createUnavailableAlertsData,
  resolveNwsAlertSourceLink,
  createAlertsService,
} = require('./src/utils/alerts');
const {
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
const { registerRouteAnalysisRoutes } = require('./src/routes/route-analysis');
const { registerAiBriefRoute } = require('./src/routes/ai-brief');
const { askClaude } = require('./src/utils/ai-client');
const { createCache, normalizeCoordKey, normalizeCoordDateKey } = require('./src/utils/cache');
const { logger } = require('./src/utils/logger');
const POPULAR_PEAKS = require('./peaks.json');

// Extracted modules
const { calculateSafetyScore } = require('./src/utils/safety-score');
const {
  AVALANCHE_UNKNOWN_MESSAGE,
  AVALANCHE_OFF_SEASON_MESSAGE,
  AVALANCHE_LEVEL_LABELS,
  createUnknownAvalancheData,
  evaluateSnowpackSignal,
  evaluateAvalancheRelevance,
  cleanForecastText,
  pickBestBottomLine,
  normalizeExternalLink,
  resolveAvalancheCenterLink,
  applyDerivedOverallAvalancheDanger,
  deriveOverallDangerLevelFromElevations,
} = require('./src/utils/avalanche-orchestration');
const {
  FT_PER_METER,
  haversineKm,
  formatIsoDateUtc,
  shiftIsoDateUtc,
  findMatchingAvalancheZone,
  createElevationService,
} = require('./src/utils/geo');

const avyLog = (...args) => {
  if (DEBUG_AVY) {
    logger.debug(args.length === 1 ? { msg: args[0] } : { data: args }, 'avy-debug');
  }
};

const app = createApp({
  isProduction: IS_PRODUCTION,
  corsAllowlist: CORS_ALLOWLIST,
  rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
  rateLimitMaxRequests: RATE_LIMIT_MAX_REQUESTS,
});

const fetchWithTimeout = createFetchWithTimeout(REQUEST_TIMEOUT_MS);

const buildSatOneLiner = createSatOneLinerBuilder({ parseStartClock, computeFeelsLikeF });

let avalancheMapLayerCache = {
  fetchedAt: 0,
  data: null,
};

const noaaPointsCache = createCache({ name: 'noaa-points', ttlMs: 24 * 60 * 60 * 1000, staleTtlMs: 48 * 60 * 60 * 1000, maxEntries: 200 });
const { elevationCache, fetchObjectiveElevationFt } = createElevationService({ fetchWithTimeout, requestTimeoutMs: REQUEST_TIMEOUT_MS });
const solarCache = createCache({ name: 'solar', ttlMs: 7 * 24 * 60 * 60 * 1000, staleTtlMs: 23 * 24 * 60 * 60 * 1000, maxEntries: 300 });
const noaaForecastCache = createCache({ name: 'noaa-forecast', ttlMs: 20 * 60 * 1000, staleTtlMs: 25 * 60 * 1000, maxEntries: 100 });

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

  const fetchOptions = { headers: DEFAULT_FETCH_HEADERS };
  try {
    const avyMapLayerPromise = getAvalancheMapLayer(fetchOptions);

    try {
      // 1. Get NOAA grid data (cached 24h)
      const pointsCacheKey = normalizeCoordKey(parsedLat, parsedLon);
      const pointsData = await noaaPointsCache.getOrFetch(pointsCacheKey, async () => {
        const pointsRes = await fetchWithTimeout(`https://api.weather.gov/points/${parsedLat},${parsedLon}`, fetchOptions);
        if (!pointsRes.ok) throw new Error('Failed to fetch NOAA points (Location might be outside US)');
        return pointsRes.json();
      });
      const pointElevationMeters = Number(pointsData?.properties?.elevation?.value);
      let objectiveElevationFt = Number.isFinite(pointElevationMeters) ? Math.round(pointElevationMeters * FT_PER_METER) : null;
      let objectiveElevationSource = Number.isFinite(pointElevationMeters) ? 'NOAA points metadata' : null;
      if (!Number.isFinite(objectiveElevationFt)) {
        const fallbackElevation = await fetchObjectiveElevationFt(parsedLat, parsedLon, fetchOptions);
        objectiveElevationFt = fallbackElevation.elevationFt;
        objectiveElevationSource = fallbackElevation.source;
      }

      const hourlyForecastUrl = pointsData.properties.forecastHourly;

      // 2. Get Forecasts (cached 20m)
      const hourlyData = await noaaForecastCache.getOrFetch(hourlyForecastUrl, async () => {
        const hourlyRes = await fetchWithTimeout(hourlyForecastUrl, fetchOptions);
        if (!hourlyRes.ok) throw new Error(`NOAA hourly forecast failed: ${hourlyRes.status}`);
        return hourlyRes.json();
      });

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

      weatherData.dataSource = 'noaa';
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
            logger.warn({ fields: blended.supplementedFields }, 'NOAA weather supplemented with Open-Meteo');
          }
        } catch (supplementError) {
          logger.warn({ err: supplementError }, 'NOAA weather supplement from Open-Meteo failed');
        }
      }

      // 2.5 Get Solar Data (cached 7d per coord+date)
      try {
        const solarDate = selectedForecastDate || requestedDate || new Date().toISOString().slice(0, 10);
        const solarCacheKey = normalizeCoordDateKey(parsedLat, parsedLon, solarDate);
        const cachedSolar = await solarCache.getOrFetch(solarCacheKey, async () => {
          const solarRes = await fetchWithTimeout(`https://api.sunrisesunset.io/json?lat=${parsedLat}&lng=${parsedLon}&date=${solarDate}`, fetchOptions);
          if (!solarRes.ok) return null;
          const solarJson = await solarRes.json();
          if (solarJson.status !== 'OK') return null;
          return { sunrise: solarJson.results.sunrise, sunset: solarJson.results.sunset, dayLength: solarJson.results.day_length };
        });
        if (cachedSolar) solarData = cachedSolar;
      } catch (e) {
        logger.error({ err: e }, 'Solar API error');
      }
    } catch (weatherError) {
      logger.error({ err: weatherError }, 'Weather API error');
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
        weatherData.dataSource = 'open-meteo-fallback';
        selectedForecastDate = fallback.selectedForecastDate;
        terrainConditionData = fallback.terrainCondition || deriveTerrainCondition(weatherData);
        trailStatus = terrainConditionData.label;
        forecastDateRange = fallback.forecastDateRange;
        logger.warn('NOAA weather unavailable; served Open-Meteo fallback');
      } catch (fallbackError) {
        logger.error({ err: fallbackError }, 'Weather fallback API error');
        weatherData = createUnavailableWeatherData({ lat: parsedLat, lon: parsedLon, forecastDate: selectedForecastDate });
        weatherData.dataSource = 'unavailable';
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
	          const zoneId = matchingZone.id;
	          const levelMap = AVALANCHE_LEVEL_LABELS;
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
                    : props.travel_advice,
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
	              if (det && Object.keys(det).length > 5) {
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
	            avalancheData.bottomLine === props.travel_advice;
	          const hasDetailedBottomLine =
	            typeof avalancheData.bottomLine === 'string' &&
	            avalancheData.bottomLine.length >= 120 &&
	            !hasGenericBottomLine;
	          const scrapeLink = normalizeExternalLink(props.link);
	          const shouldScrape =
	            !centerNoActiveForecast &&
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

              const blMatch = pageText.match(/"(bottom_line|bottom_line_summary|overall_summary)"\s*:\s*"((?:[^"\\]|\\.)+)"/);

              if (blMatch && blMatch[2]) {
                bottomLineCandidates.push(blMatch[2].replace(/\\"/g, '"'));
              } else {
                 const htmlSummary = pageText.match(/class="[^"]*(field--name-field-avalanche-summary|field-bottom-line)[^"]*"[^>]*>([\s\S]*?)<\/div>/);
                 if (htmlSummary && htmlSummary[2]) {
                    const stripped = htmlSummary[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                    if (stripped.length > 0 && stripped.length < 5000) {
                      bottomLineCandidates.push(stripped);
                    }
                 } else {
                    const possibleLargeText = pageText.match(/"summary"\s*:\s*"((?:[^"\\]|\\.){100,})"/);
                    if (possibleLargeText && possibleLargeText[1]) {
                      bottomLineCandidates.push(possibleLargeText[1].replace(/\\"/g, '"'));
                    }
                 }
              }

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
      logger.error({ err: e }, 'Avalanche API error');
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
      logger.warn({ err: alertsResult.reason }, 'Alerts fetch failed');
      alertsData = createUnavailableAlertsData("unavailable");
    }

    if (airQualityResult.status === 'fulfilled') {
      airQualityData = airQualityResult.value;
    } else {
      logger.warn({ err: airQualityResult.reason }, 'AirQuality fetch failed');
      airQualityData = createUnavailableAirQualityData("unavailable");
    }

    if (rainfallResult.status === 'fulfilled') {
      rainfallData = rainfallResult.value;
    } else {
      logger.warn({ err: rainfallResult.reason }, 'Rainfall fetch failed');
      rainfallData = createUnavailableRainfallData("unavailable");
    }

    if (snowpackResult.status === 'fulfilled') {
      snowpackData = snowpackResult.value;
    } else {
      logger.warn({ err: snowpackResult.reason }, 'Snowpack fetch failed');
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
      heatRiskData,
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
	    };
	    delete responsePayload.activity;
    logReportRequest({ statusCode: 200, lat: parsedLat, lon: parsedLon, date: selectedForecastDate, startTime: requestedStartClock || null, safetyScore: analysis.score, partialData: false, durationMs: Date.now() - startedAt, ...baseLogFields });
	    res.json(responsePayload);
  } catch (error) {
    logger.error({ err: error }, 'API error');
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
	    };
	    delete fallbackResponsePayload.activity;
    logReportRequest({ statusCode: 200, lat: parsedLat, lon: parsedLon, date: fallbackSelectedDate, startTime: requestedStartClock || null, safetyScore: analysis.score, partialData: true, durationMs: Date.now() - startedAt, ...baseLogFields });
	    res.status(200).json(fallbackResponsePayload);
  }
};

const SAFETY_HANDLER_TIMEOUT_MS = 30000;

const safetyHandlerWithTimeout = async (req, res) => {
  const ac = new AbortController();
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      logger.warn({ lat: req.query.lat, lon: req.query.lon, timeoutMs: SAFETY_HANDLER_TIMEOUT_MS }, 'Safety request timed out');
      res.status(504).json({
        error: 'Request timed out. One or more upstream providers did not respond in time.',
        partialData: true,
      });
    }
    ac.abort();
  }, SAFETY_HANDLER_TIMEOUT_MS);
  try {
    await safetyHandler(req, res);
  } finally {
    clearTimeout(timeout);
  }
};

registerSafetyRoute({ app, safetyHandler: safetyHandlerWithTimeout });
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
registerHealthRoutes(app, { caches: [noaaPointsCache, elevationCache, solarCache, noaaForecastCache] });
registerReportLogsRoute(app);
registerRouteAnalysisRoutes({ app, askClaude, invokeSafetyHandler, fetchWithTimeout, fetchHeaders: DEFAULT_FETCH_HEADERS });
registerAiBriefRoute({ app, askClaude });

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
