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
// Runtime configuration loads dotenv. Keep it ahead of modules that initialize
// environment-sensitive singletons (notably the logger transport).
const { createApp } = require('./src/server/create-app');
const { startServer: startBackendServer } = require('./src/server/start-server');
const { DEFAULT_FETCH_HEADERS, createFetchWithTimeout, createCircuitBreaker, withCircuitBreaker } = require('./src/utils/http-client');
const { normalizeWindDirection } = require('./src/utils/wind');
const {
  parseStartClock,
  buildPlannedStartIso,
  clampTravelWindowHours,
} = require('./src/utils/time');
const { createWeatherDataService } = require('./src/utils/weather-data');
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
const { registerSearchRoutes } = require('./src/routes/search');
const { registerHealthRoutes } = require('./src/routes/health');
const { registerFeatureFlagRoutes } = require('./src/routes/feature-flags');
const { registerAccountRoutes } = require('./src/routes/account');
const { registerSavedReportRoutes } = require('./src/routes/saved-reports');
const { registerObjectiveWatchRoutes } = require('./src/routes/objective-watches');
const { registerObjectiveWatchCheckRoute } = require('./src/routes/objective-watch-checks');
const { createObjectiveWatchChecker } = require('./src/services/objective-watch-checker');
const { createObjectiveWatchScheduler } = require('./src/services/objective-watch-scheduler');
const { createAccountAccessGuard } = require('./src/auth/account-access');
const { createAIUsageLimitService } = require('./src/auth/ai-usage-limit');
const { createReportUsageLimitService } = require('./src/auth/report-usage-limit');
const { createMultiDayUsageLimitService } = require('./src/auth/multi-day-usage-limit');
const { createAccountTierService } = require('./src/auth/account-tier');
const { createEmailService } = require('./src/email/email-service');
const { registerSafetyRoute, createSafetyInvoker } = require('./src/routes/safety');
const { registerTripForecastRoutes } = require('./src/routes/trip-forecasts');
const { logReportRequest, registerReportLogsRoute } = require('./src/routes/report-logs');
const { registerRouteAnalysisRoutes } = require('./src/routes/route-analysis');
const { registerAiBriefRoute } = require('./src/routes/ai-brief');
const { registerReportChatRoute } = require('./src/routes/report-chat');
const { registerSatelliteTileRoute } = require('./src/routes/satellite-tile');
const { registerSnowVisionRoute } = require('./src/routes/snow-vision');
const { askAI, askAIVision, getAIFeatureAvailability, getAIStatus, initializeAISettings, isAIAvailable } = require('./src/utils/ai-client');
const { getFeatureFlags, initializeFeatureFlags } = require('./src/utils/feature-flags');
const { sanitizeReportForFeatureFlags } = require('./src/utils/report-feature-filter');
const { createCache, normalizeCoordKey } = require('./src/utils/cache');
const { runExternalDiagnostics } = require('./src/utils/external-diagnostics');
const { createAIModelCatalog } = require('./src/utils/ai-model-catalog');
const { database } = require('./src/db/database');
const { appDataStore } = require('./src/db/app-data-store');
const { logger } = require('./src/utils/logger');
const POPULAR_PEAKS = require('./peaks.json');

// Extracted modules
const { calculateSafetyScore } = require('./src/utils/safety-score');
const { calculatePleasantnessScore } = require('./src/utils/pleasantness-score');
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
const { buildAtmosphericData } = require('./src/utils/atmospheric');
const { createAtmosphericService } = require('./src/utils/atmospheric-fetch');
const { createLocalConditionsService } = require('./src/utils/local-conditions-fetch');
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
const aiModelCatalog = createAIModelCatalog({ fetchWithTimeout, getAIStatus });

// Circuit breakers for the two chronically-flaky, single-endpoint upstreams that sit on
// the critical path of every /api/safety request. Once either upstream fails repeatedly
// in a short window, fail fast instead of waiting out a doomed timeout on every request.
const noaaCircuitBreaker = createCircuitBreaker({ name: 'noaa', failureThreshold: 5, resetTimeMs: 60000 });
const avalancheOrgCircuitBreaker = createCircuitBreaker({ name: 'avalanche.org', failureThreshold: 5, resetTimeMs: 60000 });

let avalancheMapLayerCache = {
  fetchedAt: 0,
  data: null,
};
let avalancheMapLayerRefreshPromise = null;

const noaaPointsCache = createCache({ name: 'noaa-points', ttlMs: 24 * 60 * 60 * 1000, staleTtlMs: 48 * 60 * 60 * 1000, maxEntries: 200 });
const { elevationCache, fetchObjectiveElevationFt } = createElevationService({ fetchWithTimeout, requestTimeoutMs: REQUEST_TIMEOUT_MS });
const solarCache = createCache({ name: 'solar', ttlMs: 7 * 24 * 60 * 60 * 1000, staleTtlMs: 23 * 24 * 60 * 60 * 1000, maxEntries: 300 });
const noaaForecastCache = createCache({ name: 'noaa-forecast', ttlMs: 20 * 60 * 1000, staleTtlMs: 25 * 60 * 1000, maxEntries: 100 });
const avalancheForecastCache = createCache({ name: 'avalanche-forecast', ttlMs: 10 * 60 * 1000, staleTtlMs: 20 * 60 * 1000, maxEntries: 300 });

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

const { fetchWeatherAlertsData, fetchAirQualityData } = createAlertsService({
  fetchWithTimeout,
  airNowApiKey: process.env.AIRNOW_API_KEY || null,
});

const { fetchRecentRainfallData } = createPrecipitationService({
  fetchWithTimeout,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
});

const { fetchAtmosphericSignals } = createAtmosphericService({
  fetchWithTimeout,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
});

const tideStationCache = createCache({ name: 'co-ops-stations', ttlMs: 7 * 24 * 60 * 60 * 1000, staleTtlMs: 30 * 24 * 60 * 60 * 1000, maxEntries: 4 });
const npsParkCache = createCache({ name: 'nps-parks', ttlMs: 7 * 24 * 60 * 60 * 1000, staleTtlMs: 30 * 24 * 60 * 60 * 1000, maxEntries: 4 });
const satelliteTileCache = createCache({ name: 'satellite-tiles', ttlMs: 12 * 60 * 60 * 1000, staleTtlMs: 24 * 60 * 60 * 1000, maxEntries: 3000 });
const { fetchLocalConditions } = createLocalConditionsService({
  fetchWithTimeout,
  haversineKm,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
  npsApiKey: process.env.NPS_API_KEY || null,
  firmsMapKey: process.env.NASA_FIRMS_MAP_KEY || null,
  tideStationCache,
  npsParkCache,
});

const getAvalancheMapLayer = async (fetchOptions) => {
  const now = Date.now();
  if (avalancheMapLayerCache.data && now - avalancheMapLayerCache.fetchedAt < AVALANCHE_MAP_LAYER_TTL_MS) {
    return avalancheMapLayerCache.data;
  }

  // Deduplicate both cold starts and TTL-boundary refreshes. The previous
  // implementation allowed every concurrent safety request to refresh the same
  // global map layer independently.
  if (!avalancheMapLayerRefreshPromise) {
    avalancheMapLayerRefreshPromise = (async () => {
      try {
        const avyJson = await withCircuitBreaker(avalancheOrgCircuitBreaker, async () => {
          const avyRes = await fetchWithTimeout(`https://api.avalanche.org/v2/public/products/map-layer`, fetchOptions);
          if (!avyRes.ok) {
            throw new Error(`Map layer fetch failed with status ${avyRes.status}`);
          }
          const json = await avyRes.json();
          if (!json || !Array.isArray(json.features)) {
            throw new Error('Map layer response missing features array');
          }
          return json;
        });

        avalancheMapLayerCache = {
          fetchedAt: Date.now(),
          data: avyJson,
        };
        return avyJson;
      } catch (error) {
        if (avalancheMapLayerCache.data) {
          avyLog(`[Avy] map-layer refresh failed, serving cached copy: ${error.message}`);
          return avalancheMapLayerCache.data;
        }
        throw error;
      } finally {
        avalancheMapLayerRefreshPromise = null;
      }
    })();
  }

  return avalancheMapLayerRefreshPromise;
};

/**
 * Builds the unified `/api/safety` response payload. Shared by the success path and the
 * catch-block partial-data fallback so the shape only needs to be defined (and extended) once.
 * Pass `partial: { apiWarning }` to mark the payload as a degraded/fallback response.
 */
const buildSafetyResponsePayload = ({
  generatedAt,
  parsedLat,
  parsedLon,
  selectedDate,
  selectedForecastPeriod,
  weatherData,
  forecastDateRange,
  todayDate,
  solarData,
  avalancheData,
  alertsData,
  airQualityData,
  rainfallData,
  snowpackData,
  fireRiskData,
  heatRiskData,
  atmosphereData,
  localConditionsData,
  gearSuggestions,
  trailStatus,
  terrainConditionData,
  analysis,
  pleasantness,
  featureFlags,
  partial = null,
}) => {
  const stampGeneratedTime = (value) => {
    if (!value || typeof value !== 'object') {
      return value;
    }
    if (typeof value.generatedTime === 'string' && value.generatedTime.trim()) {
      return value;
    }
    return { ...value, generatedTime: generatedAt };
  };

  const payload = {
    generatedAt,
    capabilities: {
      ai: isAIAvailable(),
      ...getAIFeatureAvailability(),
    },
    featureFlags,
    location: { lat: parsedLat, lon: parsedLon },
    forecast: {
      selectedDate,
      selectedStartTime: selectedForecastPeriod?.startTime || weatherData?.forecastStartTime || null,
      selectedEndTime: selectedForecastPeriod?.endTime || weatherData?.forecastEndTime || null,
      isFuture: selectedDate > todayDate,
      availableRange: forecastDateRange,
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
    atmosphere: stampGeneratedTime(atmosphereData),
    localConditions: localConditionsData ? stampGeneratedTime(localConditionsData) : null,
    gear: gearSuggestions,
    trail: trailStatus,
    terrainCondition: terrainConditionData,
    safety: analysis,
    pleasantness,
  };
  delete payload.activity;

  if (partial) {
    payload.partialData = true;
    payload.apiWarning = partial.apiWarning;
  }

  return sanitizeReportForFeatureFlags(payload, featureFlags || {});
};

const safetyHandler = async (req, res) => {
  const startedAt = Date.now();
  const { lat, lon, date, start, travel_window_hours: travelWindowHoursRaw, travelWindowHours, name } = req.query;
  const logName = typeof name === 'string' ? name.trim() || null : null;
  const logIp = req.ip || null;
  const logUserAgent = req.headers['user-agent'] || null;
  const baseLogFields = { ip: logIp, userAgent: logUserAgent, name: logName };
  const writeReportLog = async (entry) => {
    if (req.internal?.suppressReportLog !== true) {
      try {
        await logReportRequest(entry);
      } catch (error) {
        logger.error({ err: error }, 'Report activity could not be persisted');
      }
    }
  };

  if (!lat || !lon) {
    await writeReportLog({ statusCode: 400, lat: lat || null, lon: lon || null, date: date || null, durationMs: Date.now() - startedAt, ...baseLogFields });
    return res.status(400).json({ error: 'Latitude and longitude are required' });
  }

  const parsedLat = Number(lat);
  const parsedLon = Number(lon);
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon) || parsedLat < -90 || parsedLat > 90 || parsedLon < -180 || parsedLon > 180) {
    await writeReportLog({ statusCode: 400, lat: parsedLat, lon: parsedLon, date: date || null, durationMs: Date.now() - startedAt, ...baseLogFields });
    return res.status(400).json({ error: 'Latitude/longitude must be valid decimal coordinates.' });
  }

  const requestedDate = typeof date === 'string' ? date.trim() : '';
  if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    await writeReportLog({ statusCode: 400, lat: parsedLat, lon: parsedLon, date: requestedDate, durationMs: Date.now() - startedAt, ...baseLogFields });
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
  let gridDataUrl = null;
  let solarData = { sunrise: 'N/A', sunset: 'N/A', dayLength: 'N/A' };
  let alertsData = createUnavailableAlertsData("unavailable");
  let airQualityData = createUnavailableAirQualityData("unavailable");
  let rainfallData = createUnavailableRainfallData("unavailable");
  let snowpackData = createUnavailableSnowpackData("unavailable");
  let fireRiskData = createUnavailableFireRiskData("unavailable");
  let heatRiskData = createUnavailableHeatRiskData("unavailable");

  const fetchOptions = { headers: DEFAULT_FETCH_HEADERS, signal: req.safetySignal };
  try {
    const avyMapLayerPromise = getAvalancheMapLayer(fetchOptions);
    // Avalanche detail does not depend on weather. Start it immediately so its
    // API/scraper work overlaps the weather pipeline, and cache the pre-date-
    // processed result so route/scenario fan-out reuses one forecast lookup.
    const avalanchePipelinePromise = avalancheForecastCache
      .getOrFetch(normalizeCoordKey(parsedLat, parsedLon), () => fetchAvalanchePipeline({
        avyMapLayerPromise,
        parsedLat,
        parsedLon,
        fetchOptions,
        fetchWithTimeout,
        avyLog,
      }))
      .then(
        (value) => ({ status: 'fulfilled', value }),
        (reason) => ({ status: 'rejected', reason }),
      );

    // A normal report request always includes a date. Snowpack and local
    // conditions only need coordinates plus that date, so start them beside
    // weather and avalanche instead of waiting for the weather pipeline to
    // finish. Settling immediately also prevents a fast rejection from
    // becoming unhandled while the critical weather path is still running.
    const prefetchedSnowpackPromise = requestedDate
      ? fetchSnowpackData(parsedLat, parsedLon, requestedDate, fetchOptions).then(
          (value) => ({ status: 'fulfilled', value }),
          (reason) => ({ status: 'rejected', reason }),
        )
      : null;
    const prefetchedLocalConditionsPromise = requestedDate
      ? fetchLocalConditions({
          lat: parsedLat,
          lon: parsedLon,
          selectedDate: requestedDate,
          fetchOptions,
        }).then(
          (value) => ({ status: 'fulfilled', value }),
          (reason) => ({ status: 'rejected', reason }),
        )
      : null;
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
        noaaCircuitBreaker,
      });
      weatherData = weatherResult.weatherData;
      solarData = weatherResult.solarData;
      terrainConditionData = weatherResult.terrainConditionData;
      trailStatus = weatherResult.trailStatus;
      selectedForecastDate = weatherResult.selectedForecastDate;
      selectedForecastPeriod = weatherResult.selectedForecastPeriod;
      forecastDateRange = weatherResult.forecastDateRange;
      gridDataUrl = weatherResult.gridDataUrl || null;
    } catch (dateRangeErr) {
      if (dateRangeErr instanceof ForecastDateOutOfRangeError) {
        await writeReportLog({ statusCode: 400, lat: parsedLat, lon: parsedLon, date: requestedDate, durationMs: Date.now() - startedAt, ...baseLogFields });
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
    const alertTargetTimeIso = buildPlannedStartIso({
      selectedDate: selectedForecastDate || requestedDate || '',
      startClock: requestedStartClock,
      referenceIso: weatherData?.forecastStartTime || selectedForecastPeriod?.startTime || weatherData?.issuedTime || null,
    });

    const settle = (promise) => Promise.resolve(promise).then(
      (value) => ({ status: 'fulfilled', value }),
      (reason) => ({ status: 'rejected', reason }),
    );
    const parallelBatchPromise = Promise.all([
      settle(fetchWeatherAlertsData(parsedLat, parsedLon, fetchOptions, alertTargetTimeIso)),
      settle(fetchAirQualityData(parsedLat, parsedLon, airQualityTargetTime, fetchOptions)),
      settle(fetchRecentRainfallData(parsedLat, parsedLon, alertTargetTimeIso || airQualityTargetTime, requestedTravelWindowHours, fetchOptions)),
      prefetchedSnowpackPromise
        || settle(fetchSnowpackData(parsedLat, parsedLon, selectedForecastDate, fetchOptions)),
      settle(fetchAtmosphericSignals({
        lat: parsedLat,
        lon: parsedLon,
        selectedDate: selectedForecastDate,
        startClock: requestedStartClock,
        gridDataUrl,
        targetTimeIso: alertTargetTimeIso || airQualityTargetTime,
        fetchOptions,
      })),
      prefetchedLocalConditionsPromise
        || settle(fetchLocalConditions({
          lat: parsedLat,
          lon: parsedLon,
          selectedDate: selectedForecastDate,
          fetchOptions,
        })),
    ]);

    // 3. Avalanche Pipeline: Map Layer → Detail APIs → Scraper Fallback
    const avalancheResult = await avalanchePipelinePromise;
    if (avalancheResult.status === 'rejected') {
      throw avalancheResult.reason;
    }
    avalancheData = avalancheResult.value;

    // Post-processing: derived danger, expiry checks, staleness warnings
    avalancheData = applyAvalanchePostProcessing({ avalancheData, alertTargetTimeIso });

    const [alertsResult, airQualityResult, rainfallResult, snowpackResult, atmosphericResult, localConditionsResult] = await parallelBatchPromise;

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

    let atmosphericSignals = {};
    if (atmosphericResult.status === 'fulfilled') {
      atmosphericSignals = atmosphericResult.value || {};
    } else {
      logger.warn({ err: atmosphericResult.reason }, 'Atmospheric fetch failed');
    }
    const atmosphereData = buildAtmosphericData({
      weatherData,
      fetched: atmosphericSignals,
    });

    let localConditionsData = null;
    if (localConditionsResult.status === 'fulfilled') {
      localConditionsData = localConditionsResult.value || null;
    } else {
      logger.warn({ err: localConditionsResult.reason }, 'Local conditions fetch failed');
    }

    terrainConditionData = deriveTerrainCondition(weatherData, snowpackData, rainfallData, {
      solarData,
      selectedStartClock: requestedStartClock,
      selectedTravelWindowHours: requestedTravelWindowHours,
    });
    trailStatus = terrainConditionData.label;

    fireRiskData = buildFireRiskData({
      weatherData,
      alertsData,
      airQualityData,
      localConditionsData,
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

    const scoreFeatures = getFeatureFlags();
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
      selectedTravelWindowHours: requestedTravelWindowHours,
      scoreFeatures,
    });

    const analysis = calculateSafetyScore({
      weatherData,
      avalancheData,
      alertsData,
      airQualityData,
      fireRiskData,
      heatRiskData,
      rainfallData,
      snowpackData,
      terrainConditionData,
      localConditionsData,
      selectedDate: selectedForecastDate,
      solarData,
      selectedStartClock: requestedStartClock,
      selectedTravelWindowHours: requestedTravelWindowHours,
      scoreFeatures,
    });
    const pleasantness = calculatePleasantnessScore({
      weatherData,
      airQualityData,
      selectedTravelWindowHours: requestedTravelWindowHours,
      scoreFeatures,
    });
    const todayDate = new Date().toISOString().slice(0, 10);
    const responseGeneratedAt = new Date().toISOString();

    const responsePayload = buildSafetyResponsePayload({
      generatedAt: responseGeneratedAt,
      parsedLat,
      parsedLon,
      selectedDate: selectedForecastDate,
      selectedForecastPeriod,
      weatherData,
      forecastDateRange,
      todayDate,
      solarData,
      avalancheData,
      alertsData,
      airQualityData,
      rainfallData,
      snowpackData,
      fireRiskData,
      heatRiskData,
      atmosphereData,
      localConditionsData,
      gearSuggestions,
      trailStatus,
      terrainConditionData,
      analysis,
      pleasantness,
      featureFlags: scoreFeatures,
    });
    if (req.safetySignal?.aborted || res.headersSent) {
      return;
    }
    await writeReportLog({ statusCode: 200, lat: parsedLat, lon: parsedLon, date: selectedForecastDate, startTime: requestedStartClock || null, safetyScore: analysis.score, partialData: false, durationMs: Date.now() - startedAt, ...baseLogFields });
    res.json(responsePayload);
  } catch (error) {
    if (req.safetySignal?.aborted || res.headersSent) {
      return;
    }
    logger.error({ err: error }, 'API error');

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
    const safeTerrainCondition = deriveTerrainCondition(safeWeatherData, safeSnowpackData, safeRainfallData, {
      solarData,
      selectedStartClock: requestedStartClock,
      selectedTravelWindowHours: requestedTravelWindowHours,
    });
    const safeTrailStatus = safeTerrainCondition?.label || trailStatus || "⚠️ Data Partially Unavailable";

    const scoreFeatures = getFeatureFlags();
    const analysis = calculateSafetyScore({
      weatherData: safeWeatherData,
      avalancheData: safeAvalancheData,
      alertsData: safeAlertsData,
      airQualityData: safeAirQualityData,
      fireRiskData: safeFireRiskData,
      heatRiskData: safeHeatRiskData,
      rainfallData: safeRainfallData,
      snowpackData: safeSnowpackData,
      terrainConditionData: safeTerrainCondition,
      selectedDate: fallbackSelectedDate,
      solarData,
      selectedStartClock: requestedStartClock,
      selectedTravelWindowHours: requestedTravelWindowHours,
      scoreFeatures,
    });
    const pleasantness = calculatePleasantnessScore({
      weatherData: safeWeatherData,
      airQualityData: safeAirQualityData,
      selectedTravelWindowHours: requestedTravelWindowHours,
      scoreFeatures,
    });
    const safeGearSuggestions = buildLayeringGearSuggestions({
      weatherData: safeWeatherData,
      trailStatus: safeTrailStatus,
      avalancheData: safeAvalancheData,
      airQualityData: safeAirQualityData,
      alertsData: safeAlertsData,
      rainfallData: safeRainfallData,
      snowpackData: safeSnowpackData,
      fireRiskData: safeFireRiskData,
      heatRiskData: safeHeatRiskData,
      selectedTravelWindowHours: requestedTravelWindowHours,
      scoreFeatures,
    });

    const fallbackGeneratedAt = new Date().toISOString();

    const fallbackResponsePayload = buildSafetyResponsePayload({
      generatedAt: fallbackGeneratedAt,
      parsedLat,
      parsedLon,
      selectedDate: fallbackSelectedDate,
      selectedForecastPeriod,
      weatherData: safeWeatherData,
      forecastDateRange,
      todayDate,
      solarData,
      avalancheData: safeAvalancheData,
      alertsData: safeAlertsData,
      airQualityData: safeAirQualityData,
      rainfallData: safeRainfallData,
      snowpackData: safeSnowpackData,
      fireRiskData: safeFireRiskData,
      heatRiskData: safeHeatRiskData,
      atmosphereData: buildAtmosphericData({ weatherData: safeWeatherData, fetched: {} }),
      localConditionsData: null,
      gearSuggestions: safeGearSuggestions,
      trailStatus: safeTrailStatus,
      terrainConditionData: safeTerrainCondition,
      analysis,
      pleasantness,
      featureFlags: scoreFeatures,
      partial: { apiWarning: error?.message || 'One or more upstream data providers failed during this request.' },
    });
    await writeReportLog({ statusCode: 200, lat: parsedLat, lon: parsedLon, date: fallbackSelectedDate, startTime: requestedStartClock || null, safetyScore: analysis.score, partialData: true, durationMs: Date.now() - startedAt, ...baseLogFields });
    res.status(200).json(fallbackResponsePayload);
  }
};

const SAFETY_HANDLER_TIMEOUT_MS = 30000;

const safetyHandlerWithTimeout = async (req, res) => {
  const ac = new AbortController();
  req.safetySignal = ac.signal;
  const abortForDisconnectedClient = () => {
    if (!ac.signal.aborted) {
      ac.abort(new Error('Client disconnected'));
    }
  };
  if (typeof req.once === 'function') {
    req.once('aborted', abortForDisconnectedClient);
  }
  const abortForClosedResponse = () => {
    if (res.writableEnded !== true) {
      abortForDisconnectedClient();
    }
  };
  if (typeof res.once === 'function') {
    res.once('close', abortForClosedResponse);
  }
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      logger.warn({ lat: req.query.lat, lon: req.query.lon, timeoutMs: SAFETY_HANDLER_TIMEOUT_MS }, 'Safety request timed out');
      res.status(504).json({
        error: 'Request timed out. One or more upstream providers did not respond in time.',
        partialData: true,
      });
    }
    if (!ac.signal.aborted) {
      ac.abort(new Error(`Safety request timed out after ${SAFETY_HANDLER_TIMEOUT_MS}ms`));
    }
  }, SAFETY_HANDLER_TIMEOUT_MS);
  try {
    await safetyHandler(req, res);
  } finally {
    clearTimeout(timeout);
    if (typeof req.removeListener === 'function') {
      req.removeListener('aborted', abortForDisconnectedClient);
    }
    if (typeof res.removeListener === 'function') {
      res.removeListener('close', abortForClosedResponse);
    }
  }
};

registerSafetyRoute({ app, safetyHandler: safetyHandlerWithTimeout });
const invokeSafetyHandler = createSafetyInvoker({ safetyHandler: safetyHandlerWithTimeout });

registerSearchRoutes({
  app,
  fetchWithTimeout,
  defaultFetchHeaders: DEFAULT_FETCH_HEADERS,
  peaks: POPULAR_PEAKS,
});
registerFeatureFlagRoutes(app);
const accountTierService = createAccountTierService({ database });
const aiUsageLimitService = createAIUsageLimitService({ database, settingsStore: appDataStore });
const reportUsageLimitService = createReportUsageLimitService({ database, settingsStore: appDataStore });
const multiDayUsageLimitService = createMultiDayUsageLimitService({ database });
const emailService = createEmailService();
const accountService = registerAccountRoutes({
  app,
  database,
  isProduction: IS_PRODUCTION,
  tierService: accountTierService,
  usageService: aiUsageLimitService,
  reportUsageService: reportUsageLimitService,
  multiDayUsageService: multiDayUsageLimitService,
  emailService,
});
registerTripForecastRoutes({
  app,
  accountService,
  tierService: accountTierService,
  usageService: multiDayUsageLimitService,
  invokeSafetyHandler,
  isProduction: IS_PRODUCTION,
});
registerSavedReportRoutes({
  app,
  database,
  accountService,
  tierService: accountTierService,
  reportUsageService: reportUsageLimitService,
  emailService,
});
const objectiveWatchScheduler = createObjectiveWatchScheduler({ database });
const objectiveWatchChecker = createObjectiveWatchChecker({
  database,
  invokeSafetyHandler,
  emailService,
  log: logger,
  getCheckIntervalMinutes: objectiveWatchScheduler.getCheckIntervalMinutes,
});
registerObjectiveWatchRoutes({
  app,
  database,
  accountService,
  tierService: accountTierService,
  checker: objectiveWatchChecker,
  scheduler: objectiveWatchScheduler,
});
const objectiveWatchCheckController = registerObjectiveWatchCheckRoute({
  app,
  checker: objectiveWatchChecker,
  scheduler: objectiveWatchScheduler,
  log: logger,
});
const ensureAccountAccess = createAccountAccessGuard({
  service: accountService,
  tierService: accountTierService,
  usageService: aiUsageLimitService,
});
const observableCaches = [
  noaaPointsCache,
  elevationCache,
  solarCache,
  noaaForecastCache,
  avalancheForecastCache,
  satelliteTileCache,
];
registerHealthRoutes(app, {
  caches: observableCaches,
  ai: getAIStatus,
  database,
});
registerReportLogsRoute(app, {
  accountService,
  emailService,
  usageService: aiUsageLimitService,
  reportUsageService: reportUsageLimitService,
  caches: observableCaches,
  runDiagnostics: () => runExternalDiagnostics({ fetchWithTimeout }),
  loadModelCatalog: (options) => aiModelCatalog.load(options),
  objectiveWatchScheduler,
  objectiveWatchCheckController,
});
registerRouteAnalysisRoutes({
  app,
  askAI,
  invokeSafetyHandler,
  fetchWithTimeout,
  fetchHeaders: DEFAULT_FETCH_HEADERS,
  ensureAccountAccess,
});
registerAiBriefRoute({ app, askAI, ensureAccountAccess });
registerReportChatRoute({ app, ensureAccountAccess });
registerSatelliteTileRoute({ app, fetchWithTimeout, tileCache: satelliteTileCache });
registerSnowVisionRoute({ app, fetchWithTimeout, askAIVision, ensureAccountAccess });

const startServer = async () => {
  await database.connect();
  await appDataStore.initialize();
  await aiUsageLimitService.initializeSettings();
  await reportUsageLimitService.initializeSettings();
  await initializeFeatureFlags();
  await initializeAISettings();
  return startBackendServer({ app, port: PORT, onShutdown: () => database.close() });
};

if (require.main === module) {
  startServer().catch(async (error) => {
    logger.fatal({ err: error }, 'Backend startup failed');
    await database.close().catch(() => {});
    process.exit(1);
  });
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
  calculatePleasantnessScore,
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
};
