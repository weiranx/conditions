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
const { normalizeWindDirection } = require('./src/utils/wind');
const {
  parseStartClock,
  buildPlannedStartIso,
  parseClockToMinutes,
  formatMinutesToClock,
  clampTravelWindowHours,
} = require('./src/utils/time');
const { computeFeelsLikeF } = require('./src/utils/weather-normalizers');
const {
  dateKeyInTimeZone,
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
  parseAvalancheDetailPayloads,
  normalizeAvalancheProblemCollection,
  pickBestAvalancheDetailCandidate,
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
const { createCache } = require('./src/utils/cache');
const { logger } = require('./src/utils/logger');
const POPULAR_PEAKS = require('./peaks.json');

// Extracted modules
const { calculateSafetyScore } = require('./src/utils/safety-score');
const {
  createUnknownAvalancheData,
  evaluateAvalancheRelevance,
  resolveAvalancheCenterLink,
  applyDerivedOverallAvalancheDanger,
  deriveOverallDangerLevelFromElevations,
} = require('./src/utils/avalanche-orchestration');
const {
  haversineKm,
  formatIsoDateUtc,
  shiftIsoDateUtc,
  findMatchingAvalancheZone,
  createElevationService,
} = require('./src/utils/geo');
const { ForecastDateOutOfRangeError, fetchWeatherPipeline } = require('./src/utils/weather-pipeline');
const { fetchAvalanchePipeline, applyAvalanchePostProcessing } = require('./src/utils/avalanche-pipeline');

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
  let gearSuggestions = [];
  let weatherData = createUnavailableWeatherData({ lat: parsedLat, lon: parsedLon, forecastDate: requestedDate || null });
  let trailStatus = "Unknown";
  let terrainConditionData = deriveTerrainCondition(weatherData);
  let selectedForecastDate = requestedDate || null;
  let selectedForecastPeriod = null;
  let forecastDateRange = { start: null, end: null };
  let solarData = { sunrise: 'N/A', sunset: 'N/A', dayLength: 'N/A' };
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
      const weatherResult = await fetchWeatherPipeline({
        parsedLat,
        parsedLon,
        requestedDate,
        requestedStartClock,
        requestedTravelWindowHours,
        fetchOptions,
        noaaPointsCache,
        noaaForecastCache,
        solarCache,
        fetchWithTimeout,
        fetchObjectiveElevationFt,
        fetchOpenMeteoWeatherFallback,
        createUnavailableWeatherData,
      });
      weatherData = weatherResult.weatherData;
      solarData = weatherResult.solarData;
      terrainConditionData = weatherResult.terrainConditionData;
      trailStatus = weatherResult.trailStatus;
      selectedForecastDate = weatherResult.selectedForecastDate;
      selectedForecastPeriod = weatherResult.selectedForecastPeriod;
      forecastDateRange = weatherResult.forecastDateRange;
    } catch (dateRangeErr) {
      if (dateRangeErr instanceof ForecastDateOutOfRangeError) {
        logReportRequest({ statusCode: 400, lat: parsedLat, lon: parsedLon, date: requestedDate, durationMs: Date.now() - startedAt, ...baseLogFields });
        return res.status(400).json({
          error: 'Requested forecast date is outside NOAA forecast range',
          details: `Choose a date between ${dateRangeErr.forecastDateRange.start} and ${dateRangeErr.forecastDateRange.end}.`,
          availableRange: dateRangeErr.forecastDateRange,
        });
      }
      throw dateRangeErr;
    }

    if (!selectedForecastDate) selectedForecastDate = requestedDate || new Date().toISOString().slice(0, 10);
    if (!solarData) solarData = { sunrise: 'N/A', sunset: 'N/A', dayLength: 'N/A' };
    if (!forecastDateRange) forecastDateRange = { start: null, end: null };

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

    // 3. Avalanche Pipeline: Map Layer → Detail APIs → Scraper Fallback
    avalancheData = await fetchAvalanchePipeline({
      avyMapLayerPromise,
      parsedLat,
      parsedLon,
      fetchOptions,
      fetchWithTimeout,
      avyLog,
    });

    // Post-processing: derived danger, expiry checks, staleness warnings
    avalancheData = applyAvalanchePostProcessing({ avalancheData, alertTargetTimeIso });

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
const invokeSafetyHandler = createSafetyInvoker({ safetyHandler: safetyHandlerWithTimeout });

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
