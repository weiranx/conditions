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
  hourLabelFromIso,
  localHourFromIso,
  dateKeyInTimeZone,
  withExplicitTimezone,
  parseClockToMinutes,
  formatMinutesToClock,
  parseIsoClockMinutes,
  findFirstTimeIndexAtOrAfter,
  normalizeUtcIsoTimestamp,
  buildTemperatureContext24h
} = require('./src/utils/time');
const { 
  computeFeelsLikeF,
  clampTravelWindowHours,
  normalizeNoaaDewPointF,
  normalizePressureHpa,
  normalizeNoaaPressureHpa,
  clampPercent,
  inferNoaaCloudCoverFromIcon,
  inferNoaaCloudCoverFromForecastText,
  resolveNoaaCloudCover,
  buildVisibilityRisk,
  buildElevationForecastBands,
  createUnavailableWeatherData,
  FT_PER_METER,
  TEMP_LAPSE_F_PER_1000FT,
  WIND_INCREASE_MPH_PER_1000FT,
  GUST_INCREASE_MPH_PER_1000FT
} = require('./src/utils/weather');
const { 
  AVALANCHE_UNKNOWN_MESSAGE,
  AVALANCHE_OFF_SEASON_MESSAGE,
  AVALANCHE_LEVEL_LABELS,
  createUnknownAvalancheData
} = require('./src/utils/avalanche');
const {
  cleanForecastText,
  pickBestBottomLine,
  normalizeExternalLink,
  resolveAvalancheCenterLink,
  deriveOverallDangerLevelFromElevations
} = require('./src/utils/avalanche-scraper');
const {
  fetchOpenMeteoWeatherFallback,
  fetchWeatherAlertsData,
  fetchAirQualityData,
  fetchRecentRainfallData
} = require('./src/utils/weather-service');
const {
  haversineKm,
  getAvalancheMapLayer,
  findMatchingAvalancheZone
} = require('./src/utils/avalanche-service');
const {
  calculateSafetyScore,
  evaluateAvalancheRelevance
} = require('./src/utils/scoring');

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

const MAX_REASONABLE_ELEVATION_FT = 20000;

const buildSatOneLiner = createSatOneLinerBuilder({ parseStartClock, computeFeelsLikeF });

const applyDerivedOverallAvalancheDanger = (avalancheData) => {
  if (!avalancheData || typeof avalancheData !== 'object') {
    return avalancheData;
  }
  if (avalancheData.dangerUnknown || avalancheData.coverageStatus !== 'reported') {
    return avalancheData;
  }

  const levels = [avalancheData.elevations?.above, avalancheData.elevations?.at, avalancheData.elevations?.below]
    .map((band) => {
      const numeric = Number(band?.level);
      return (Number.isFinite(numeric)) ? Math.min(5, Math.max(0, Math.round(numeric))) : 0;
    })
    .filter((level) => level > 0);

  const derivedLevel = levels.length === 0 ? (Number(avalancheData.dangerLevel) || 0) : Math.max(...levels);
  
  return {
    ...avalancheData,
    dangerLevel: derivedLevel,
    risk: AVALANCHE_LEVEL_LABELS[derivedLevel] || avalancheData.risk || 'Unknown',
  };
};

const fetchWithTimeout = createFetchWithTimeout(REQUEST_TIMEOUT_MS);

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

const { createUnavailableSnowpackData, fetchSnowpackData } = createSnowpackService({
  fetchWithTimeout,
  formatIsoDateUtc,
  shiftIsoDateUtc,
  haversineKm,
  stationCacheTtlMs: SNOTEL_STATION_CACHE_TTL_MS,
});

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
    12
  );

  let selectedForecastDate = requestedDate || null;
  let forecastDateRange = null;
  let selectedForecastPeriod = null;
  let weatherData = null;
  let avalancheData = createUnknownAvalancheData();
  let solarData = { sunrise: "N/A", sunset: "N/A", dayLength: "N/A" };
  let alertsData = createUnavailableAlertsData();
  let airQualityData = createUnavailableAirQualityData();
  let rainfallData = createUnavailableRainfallData();
  let snowpackData = createUnavailableSnowpackData();
  let terrainConditionData = null;
  let trailStatus = "Unknown";
  let fireRiskData = createUnavailableFireRiskData("unavailable");
  let heatRiskData = createUnavailableHeatRiskData("unavailable");

  try {
    const fetchOptions = { headers: DEFAULT_FETCH_HEADERS };

    const [weatherAndSolarResult, avalancheMapResult] = await Promise.allSettled([
      (async () => {
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
            const err = new Error('Requested forecast date is outside NOAA forecast range');
            err.statusCode = 400;
            err.details = `Choose a date between ${forecastDateRange.start} and ${forecastDateRange.end}.`;
            err.availableRange = forecastDateRange;
            throw err;
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

          let currentWeatherData = {
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

          currentWeatherData.visibilityRisk = buildVisibilityRisk(currentWeatherData);

          if (!currentWeatherData.windDirection && currentWindSpeed <= 2) {
            currentWeatherData.windDirection = 'CALM';
          }

          let currentTerrainConditionData = deriveTerrainCondition(currentWeatherData);
          let currentTrailStatus = currentTerrainConditionData.label;

          if (
            !currentWeatherData.windDirection ||
            !currentWeatherData.issuedTime ||
            currentWeatherData.pressure === null ||
            currentWeatherData.pressure === undefined ||
            currentWeatherData.cloudCover === null ||
            currentWeatherData.cloudCover === undefined ||
            (Array.isArray(currentWeatherData.trend) && currentWeatherData.trend.length < 6)
          ) {
            try {
              const supplement = await fetchOpenMeteoWeatherFallback({
                lat: parsedLat,
                lon: parsedLon,
                selectedDate: selectedForecastDate,
                startClock: requestedStartClock,
                fetchWithTimeout,
                fetchOptions,
                objectiveElevationFt,
                objectiveElevationSource,
                trendHours: requestedTravelWindowHours,
                parseStartClock
              });
              
              const merged = { ...currentWeatherData };
              const fieldSources = { ...merged.sourceDetails.fieldSources };
              const supplementedFields = [];
              const isMissing = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim().length === 0);

              ['windDirection', 'issuedTime', 'timezone', 'forecastEndTime', 'dewPoint', 'temperatureContext24h', 'cloudCover', 'pressure'].forEach(key => {
                if (isMissing(merged[key]) && !isMissing(supplement.weatherData[key])) {
                  merged[key] = supplement.weatherData[key];
                  fieldSources[key] = 'Open-Meteo';
                  supplementedFields.push(key);
                }
              });

              if (supplementedFields.length > 0) {
                merged.sourceDetails.blended = true;
                merged.sourceDetails.supplementalSources = ['Open-Meteo'];
                merged.sourceDetails.fieldSources = fieldSources;
                merged.visibilityRisk = buildVisibilityRisk(merged);
                currentWeatherData = merged;
                currentTerrainConditionData = deriveTerrainCondition(currentWeatherData);
                currentTrailStatus = currentTerrainConditionData.label;
              }
            } catch (supplementError) {
              console.warn('NOAA weather supplement from Open-Meteo failed; continuing with NOAA-only weather.', supplementError);
            }
          }

          const solarDate = selectedForecastDate || requestedDate || new Date().toISOString().slice(0, 10);
          const solarPromise = fetchWithTimeout(`https://api.sunrisesunset.io/json?lat=${parsedLat}&lng=${parsedLon}&date=${solarDate}`, fetchOptions)
            .then(async res => {
              if (res.ok) {
                const solarJson = await res.json();
                if (solarJson.status === "OK") {
                  return {
                    sunrise: solarJson.results.sunrise,
                    sunset: solarJson.results.sunset,
                    dayLength: solarJson.results.day_length
                  };
                }
              }
              return { sunrise: "N/A", sunset: "N/A", dayLength: "N/A" };
            })
            .catch(e => {
              console.error("Solar API error:", e);
              return { sunrise: "N/A", sunset: "N/A", dayLength: "N/A" };
            });

          const currentSolarData = await solarPromise;

          return {
            weatherData: currentWeatherData,
            terrainConditionData: currentTerrainConditionData,
            trailStatus: currentTrailStatus,
            solarData: currentSolarData,
            selectedForecastDate,
            forecastDateRange,
            selectedForecastPeriod
          };
        } catch (weatherError) {
          console.error("Weather API error:", weatherError);
          if (weatherError.statusCode === 400) throw weatherError;

          if (!selectedForecastDate) {
            selectedForecastDate = requestedDate || new Date().toISOString().slice(0, 10);
          }

          try {
            const fallbackElevation = await fetchObjectiveElevationFt(parsedLat, parsedLon, fetchOptions);
            const fallback = await fetchOpenMeteoWeatherFallback({
              lat: parsedLat,
              lon: parsedLon,
              selectedDate: selectedForecastDate,
              startClock: requestedStartClock,
              fetchWithTimeout,
              fetchOptions,
              objectiveElevationFt: fallbackElevation.elevationFt,
              objectiveElevationSource: fallbackElevation.source,
              trendHours: requestedTravelWindowHours,
              parseStartClock
            });

            return {
              weatherData: fallback.weatherData,
              terrainConditionData: fallback.terrainCondition || deriveTerrainCondition(fallback.weatherData),
              trailStatus: (fallback.terrainCondition || deriveTerrainCondition(fallback.weatherData)).label,
              solarData: { sunrise: "N/A", sunset: "N/A", dayLength: "N/A" },
              selectedForecastDate: fallback.selectedForecastDate,
              forecastDateRange: fallback.forecastDateRange,
              selectedForecastPeriod: null
            };
          } catch (fallbackError) {
            console.error("Weather fallback API error:", fallbackError);
            const unavailableWeather = createUnavailableWeatherData({ lat: parsedLat, lon: parsedLon, forecastDate: selectedForecastDate });
            return {
              weatherData: unavailableWeather,
              terrainConditionData: deriveTerrainCondition(unavailableWeather),
              trailStatus: deriveTerrainCondition(unavailableWeather).label,
              solarData: { sunrise: "N/A", sunset: "N/A", dayLength: "N/A" },
              selectedForecastDate,
              forecastDateRange,
              selectedForecastPeriod: null
            };
          }
        }
      })(),
      getAvalancheMapLayer(fetchWithTimeout, fetchOptions, avyLog)
    ]);

    if (weatherAndSolarResult.status === 'fulfilled') {
      const w = weatherAndSolarResult.value;
      weatherData = w.weatherData;
      terrainConditionData = w.terrainConditionData;
      trailStatus = w.trailStatus;
      solarData = w.solarData;
      selectedForecastDate = w.selectedForecastDate;
      forecastDateRange = w.forecastDateRange;
      selectedForecastPeriod = w.selectedForecastPeriod;
    } else {
      const error = weatherAndSolarResult.reason;
      if (error && error.statusCode === 400) {
        logReportRequest({ statusCode: 400, lat: parsedLat, lon: parsedLon, date: requestedDate, durationMs: Date.now() - startedAt, ...baseLogFields });
        return res.status(400).json({
          error: error.message,
          details: error.details,
          availableRange: error.availableRange
        });
      }
      weatherData = createUnavailableWeatherData({ lat: parsedLat, lon: parsedLon, forecastDate: selectedForecastDate });
      terrainConditionData = deriveTerrainCondition(weatherData);
      trailStatus = terrainConditionData.label;
    }

    if (avalancheMapResult.status === 'fulfilled' && avalancheMapResult.value?.features) {
      try {
        const avyFeatures = avalancheMapResult.value.features;
        const zoneMatch = findMatchingAvalancheZone(avyFeatures, parsedLat, parsedLon);
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

          try {
            avyLog(`[Avy] Zone: ${props.name}, ID: ${zoneId}, Center: ${props.center_id}`);
            const normalizedLinkValue = normalizeExternalLink(props.link);
            const zoneSlugRaw = normalizedLinkValue?.split('#/')[1] || normalizedLinkValue?.split('/').filter(Boolean).pop();
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

            const scrapeLink = normalizeExternalLink(props.link);

            const [detailResults, scraperResult] = await Promise.allSettled([
              Promise.all(detailAttempts.map(async (attempt) => {
                try {
                  const candidateRes = await fetchWithTimeout(attempt.url, fetchOptions);
                  if (!candidateRes.ok) return null;
                  const candidateText = await candidateRes.text();
                  const candidatePayloads = parseAvalancheDetailPayloads(candidateText);
                  return pickBestAvalancheDetailCandidate({
                    payloads: candidatePayloads,
                    centerId: props.center_id,
                    zoneId,
                    zoneSlug,
                    zoneName: props.name,
                    cleanForecastText,
                  });
                } catch (e) { return null; }
              })),
              (async () => {
                if (!scrapeLink) return null;
                try {
                  if (props.center_id === 'UAC') {
                    const uacJsonUrl = buildUtahForecastJsonUrl(scrapeLink);
                    if (uacJsonUrl) {
                      const uacRes = await fetchWithTimeout(uacJsonUrl, { headers: DEFAULT_FETCH_HEADERS });
                      if (uacRes.ok) {
                        const uacPayloads = parseAvalancheDetailPayloads(await uacRes.text());
                        const uacAdvisory = extractUtahAvalancheAdvisory(uacPayloads[0]);
                        if (uacAdvisory?.bottomLine || (uacAdvisory?.problems && uacAdvisory.problems.length > 0)) {
                          return { source: 'UAC_JSON', data: uacAdvisory };
                        }
                      }
                    }
                  }
                  const pageRes = await fetchWithTimeout(scrapeLink, { headers: DEFAULT_FETCH_HEADERS });
                  if (!pageRes.ok) return null;
                  const pageText = await pageRes.text();
                  const bottomLineCandidates = [];
                  const blMatch = pageText.match(/"(bottom_line|bottom_line_summary|overall_summary)"\s*:\s*"([^"]+)"/);
                  if (blMatch && blMatch[2]) bottomLineCandidates.push(blMatch[2].replace(/\\"/g, '"'));
                  const htmlSummary = pageText.match(/class="[^"]*(field--name-field-avalanche-summary|field-bottom-line)[^"]*"[^>]*>([\s\S]*?)<\/div>/);
                  if (htmlSummary && htmlSummary[2]) bottomLineCandidates.push(htmlSummary[2]);
                  const possibleLargeText = pageText.match(/"summary"\s*:\s*"([^"]{100,})"/);
                  if (possibleLargeText && possibleLargeText[1]) bottomLineCandidates.push(possibleLargeText[1].replace(/\\"/g, '"'));
                  if (props.center_id === 'CAIC') {
                    const nextDataMatch = pageText.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
                    if (nextDataMatch && nextDataMatch[1]) {
                      try {
                        const nextJson = JSON.parse(nextDataMatch[1]);
                        const serialized = JSON.stringify(nextJson);
                        for (const m of serialized.matchAll(/"(?:bottom_line|bottomLine|summary|forecastSummary|discussion)"\s*:\s*"([^"]{80,})"/g)) {
                          if (m[1]) bottomLineCandidates.push(m[1].replace(/\\"/g, '"'));
                        }
                      } catch (nextErr) {}
                    }
                  }
                  const bestBottomLine = pickBestBottomLine(bottomLineCandidates);
                  const problemMatches = [...pageText.matchAll(/"avalanche_problem_id":\s*\d+,\s*"name"\s*:\s*"([^"]+)"/g)];
                  const distinctProblems = [...new Set(problemMatches.map(m => m[1]))];
                  const lowerMatch = pageText.match(/"danger_lower"\s*:\s*(\d)/);
                  const middleMatch = pageText.match(/"danger_middle"\s*:\s*(\d)/);
                  const upperMatch = pageText.match(/"danger_upper"\s*:\s*(\d)/);
                  let elevations = null;
                  if (lowerMatch && middleMatch && upperMatch) {
                    elevations = { lower: parseInt(lowerMatch[1]), middle: parseInt(middleMatch[1]), upper: parseInt(upperMatch[1]) };
                  }
                  return { source: 'HTML_SCRAPE', bottomLine: bestBottomLine, problems: distinctProblems, elevations };
                } catch (e) { return null; }
              })()
            ]);

            let detailDet = null;
            let detailProblems = [];
            if (detailResults.status === 'fulfilled') {
              const best = detailResults.value.filter(Boolean).sort((a, b) => b.score - a.score)[0];
              if (best) {
                detailDet = best.candidate;
                detailProblems = best.problems;
              }
            }

            if (props.center_id === 'MWAC') {
              if (!avalancheData.link || avalancheData.link.includes('api.avalanche.org') || avalancheData.link.length < 30) {
                avalancheData.link = "https://www.mountwashingtonavalanchecenter.org/forecasts/#/presidential-range";
              }
            }

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
            }

            const hasGenericBottomLine =
              !avalancheData.bottomLine ||
              avalancheData.bottomLine === props.travel_advice ||
              avalancheData.bottomLine.startsWith("OFFICIAL SUMMARY:");
            const hasDetailedBottomLine =
              typeof avalancheData.bottomLine === 'string' &&
              avalancheData.bottomLine.length >= 120 &&
              !hasGenericBottomLine;

            if ((hasGenericBottomLine || (!avalancheData.problems.length && !hasDetailedBottomLine) || (props.center_id === 'CAIC' && (avalancheData.bottomLine || '').length < 180)) && scraperResult.status === 'fulfilled' && scraperResult.value) {
              const s = scraperResult.value;
              if (s.source === 'UAC_JSON') {
                if (s.data.bottomLine && s.data.bottomLine.length > 20) avalancheData.bottomLine = cleanForecastText(s.data.bottomLine);
                if (Array.isArray(s.data.problems) && s.data.problems.length > 0) avalancheData.problems = normalizeAvalancheProblemCollection(s.data.problems);
                if (s.data.publishedTime) avalancheData.publishedTime = s.data.publishedTime;
              } else if (s.source === 'HTML_SCRAPE') {
                if (s.bottomLine) avalancheData.bottomLine = s.bottomLine;
                if (s.problems.length > 0) avalancheData.problems = normalizeAvalancheProblemCollection(s.problems.map(name => ({ name })));
                if (s.elevations) {
                  const safeLabel = (lvl) => (Array.isArray(levelMap) && levelMap[lvl]) ? levelMap[lvl] : 'Unknown';
                  avalancheData.elevations = {
                    below: { level: s.elevations.lower, label: safeLabel(s.elevations.lower) },
                    at: { level: s.elevations.middle, label: safeLabel(s.elevations.middle) },
                    above: { level: s.elevations.upper, label: safeLabel(s.elevations.upper) }
                  };
                }
              }
            }

            if (avalancheData.bottomLine === props.travel_advice) {
              avalancheData.bottomLine = `OFFICIAL SUMMARY: ${props.travel_advice}`;
            }
          } catch (e) { avyLog("[Avy] Error in detail/scraper parallel fetch:", e.message); }
        }
      } catch (e) {
        console.error("Avalanche processing error:", e);
        if (avalancheData.dangerUnknown) {
          avalancheData = createUnknownAvalancheData("temporarily_unavailable");
        }
      }
    }

    avalancheData = applyDerivedOverallAvalancheDanger(avalancheData);

    const alertTargetTimeIso =
      selectedForecastPeriod?.startTime ||
      (selectedForecastDate ? `${selectedForecastDate}T12:00:00Z` : null);

    const [alertsResult, airQualityResult, rainfallResult, snowpackResult] = await Promise.allSettled([
      fetchWeatherAlertsData(parsedLat, parsedLon, fetchWithTimeout, fetchOptions, alertTargetTimeIso),
      fetchAirQualityData(parsedLat, parsedLon, alertTargetTimeIso, fetchWithTimeout, fetchOptions),
      fetchRecentRainfallData(parsedLat, parsedLon, alertTargetTimeIso, requestedTravelWindowHours, fetchWithTimeout, fetchOptions),
      fetchSnowpackData(parsedLat, parsedLon, fetchOptions),
    ]);

    if (alertsResult.status === 'fulfilled') {
      alertsData = alertsResult.value;
    } else {
      console.warn('[Alerts] fetch failed:', alertsResult.reason?.message || alertsResult.reason);
    }

    if (airQualityResult.status === 'fulfilled') {
      airQualityData = airQualityResult.value;
    } else {
      console.warn('[AirQuality] fetch failed:', airQualityResult.reason?.message || airQualityResult.reason);
    }

    if (rainfallResult.status === 'fulfilled') {
      rainfallData = rainfallResult.value;
    } else {
      console.warn('[Rainfall] fetch failed:', rainfallResult.reason?.message || rainfallResult.reason);
    }

    if (snowpackResult.status === 'fulfilled') {
      snowpackData = snowpackResult.value;
    } else {
      console.warn('[Snowpack] fetch failed:', snowpackResult.reason?.message || snowpackResult.reason);
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
    avalancheData.relevant = avalancheRelevance.relevant;
    avalancheData.relevanceReason = avalancheRelevance.reason;

    if (weatherData && selectedForecastPeriod) {
      terrainConditionData = deriveTerrainCondition(weatherData, snowpackData, rainfallData);
      trailStatus = terrainConditionData.label;
    }

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

    const stampGeneratedTime = (obj) => {
      if (obj && typeof obj === 'object') {
        obj.generatedTime = new Date().toISOString();
      }
      return obj;
    };

    const gearSuggestions = buildLayeringGearSuggestions({
      weatherData,
      snowpackData,
      rainfallData,
      trailStatus,
    });

    const responsePayload = {
      lat: parsedLat,
      lon: parsedLon,
      requestedDate: requestedDate || null,
      selectedForecastDate,
      forecastDateRange,
      weather: stampGeneratedTime(weatherData),
      avalanche: stampGeneratedTime(avalancheData),
      solar: stampGeneratedTime(solarData),
      alerts: stampGeneratedTime(alertsData),
      airQuality: stampGeneratedTime(airQualityData),
      rainfall: stampGeneratedTime(rainfallData),
      snowpack: stampGeneratedTime(snowpackData),
      fireRisk: fireRiskData,
      heatRisk: stampGeneratedTime(heatRiskData),
      terrainCondition: terrainConditionData,
      safety: analysis,
      gear: gearSuggestions,
      trail: trailStatus,
      aiAnalysis: `Terrain Report (${selectedForecastDate}): ${trailStatus} conditions. ${weatherData?.description || ''}. Primary hazard: ${analysis.primaryHazard}. Safety Score: ${analysis.score}/100.`,
    };

    delete responsePayload.activity;
    logReportRequest({ statusCode: 200, lat: parsedLat, lon: parsedLon, date: selectedForecastDate, startTime: requestedStartClock || null, safetyScore: analysis.score, partialData: false, durationMs: Date.now() - startedAt, ...baseLogFields });
    res.json(responsePayload);
  } catch (error) {
    console.error('API Error:', error);
    if (res.headersSent) {
      return;
    }
    const fallbackSelectedDate = selectedForecastDate || requestedDate || new Date().toISOString().slice(0, 10);
    const safeWeatherData =
      weatherData && typeof weatherData === 'object'
        ? weatherData
        : createUnavailableWeatherData({ lat: parsedLat, lon: parsedLon, forecastDate: fallbackSelectedDate });
    const safeAvalancheData =
      avalancheData && typeof avalancheData === 'object'
        ? avalancheData
        : createUnknownAvalancheData("temporarily_unavailable");
    const safeFireRiskData =
      fireRiskData && typeof fireRiskData === 'object'
        ? fireRiskData
        : createUnavailableFireRiskData("unavailable");
    const safeHeatRiskData =
      heatRiskData && typeof heatRiskData === 'object'
        ? heatRiskData
        : createUnavailableHeatRiskData("unavailable");

    const partialAnalysis = calculateSafetyScore({
      weatherData: safeWeatherData,
      avalancheData: safeAvalancheData,
      alertsData: alertsData || createUnavailableAlertsData(),
      airQualityData: airQualityData || createUnavailableAirQualityData(),
      fireRiskData: safeFireRiskData,
      heatRisk: safeHeatRiskData,
      rainfallData: rainfallData || createUnavailableRainfallData(),
      selectedDate: fallbackSelectedDate,
      solarData: solarData || { sunrise: "N/A", sunset: "N/A", dayLength: "N/A" },
      selectedStartClock: requestedStartClock,
    });

    logReportRequest({ statusCode: 500, lat: parsedLat, lon: parsedLon, date: requestedDate, durationMs: Date.now() - startedAt, ...baseLogFields });
    res.json({
      error: 'Report partially failed to generate due to upstream API errors.',
      details: error.message,
      lat: parsedLat,
      lon: parsedLon,
      selectedForecastDate: fallbackSelectedDate,
      weather: safeWeatherData,
      avalanche: safeAvalancheData,
      safety: partialAnalysis,
      partialData: true,
    });
  }
};

registerSafetyRoute({ app, safetyHandler });
registerSearchRoutes({ 
  app, 
  fetchWithTimeout, 
  defaultFetchHeaders: DEFAULT_FETCH_HEADERS, 
  peaks: POPULAR_PEAKS 
});
registerHealthRoutes(app);
registerSatOneLinerRoute({
  app,
  invokeSafetyHandler: createSafetyInvoker({ safetyHandler }),
  buildSatOneLiner,
  parseStartClock,
});
registerReportLogsRoute(app);

if (require.main === module) {
  startBackendServer(app, PORT);
}

module.exports = {
  app,
  safetyHandler,
  createUnknownAvalancheData,
  computeFeelsLikeF,
  normalizeNoaaDewPointF,
  normalizeNoaaPressureHpa,
  resolveNoaaCloudCover,
  buildVisibilityRisk,
  buildElevationForecastBands,
  deriveOverallDangerLevelFromElevations,
  applyDerivedOverallAvalancheDanger,
  parseAvalancheDetailPayloads,
  pickBestAvalancheDetailCandidate,
  normalizeAvalancheProblemCollection,
  buildUtahForecastJsonUrl,
  extractUtahAvalancheAdvisory,
  buildSatOneLiner,
};
