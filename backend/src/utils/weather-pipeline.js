const { normalizeCoordKey, normalizeCoordDateKey } = require('./cache');
const { withCircuitBreaker } = require('./http-client');
const { FT_PER_METER } = require('./geo');
const { parseIsoTimeToMs, buildPlannedStartIso, clampTravelWindowHours } = require('./time');
const { parseWindMph, inferWindGustFromPeriods, findNearestWindDirection } = require('./wind');
const {
  computeFeelsLikeF,
  normalizeNoaaDewPointF,
  normalizeNoaaPressureHpa,
  resolveNoaaCloudCover,
} = require('./weather-normalizers');
const { buildVisibilityRisk, buildElevationForecastBands } = require('./visibility-risk');
const {
  blendNoaaWeatherWithFallback,
  buildDailyTemperatureRange,
  buildTemperatureContext24h,
  hourLabelFromIso,
} = require('./weather-data');
const { deriveTerrainCondition } = require('./terrain-condition');
const { logger } = require('./logger');

class ForecastDateOutOfRangeError extends Error {
  constructor(requestedDate, forecastDateRange) {
    super('Requested forecast date is outside NOAA forecast range');
    this.name = 'ForecastDateOutOfRangeError';
    this.requestedDate = requestedDate;
    this.forecastDateRange = forecastDateRange;
  }
}

const parsePointElevationMeters = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Fetches weather data from NOAA (primary) with Open-Meteo fallback, plus solar data.
 * Returns the complete weather context needed by the safety pipeline.
 */
async function fetchWeatherPipeline({
  parsedLat,
  parsedLon,
  requestedDate,
  requestedStartClock,
  requestedTravelWindowHours,
  fetchOptions,
  // Injected services & caches
  noaaPointsCache,
  noaaForecastCache,
  solarCache,
  fetchWithTimeout,
  fetchObjectiveElevationFt,
  fetchOpenMeteoWeatherFallback,
  createUnavailableWeatherData,
  noaaCircuitBreaker = null,
}) {
  let solarData = { sunrise: 'N/A', sunset: 'N/A', dayLength: 'N/A' };
  let selectedForecastDate = requestedDate || null;
  let selectedForecastPeriod = null;
  let forecastDateRange = { start: null, end: null };
  let weatherData;
  let terrainConditionData;
  let trailStatus;
  let gridDataUrl = null;

  const fetchSolarData = async (solarDate) => {
    try {
      const solarCacheKey = normalizeCoordDateKey(parsedLat, parsedLon, solarDate);
      return await solarCache.getOrFetch(solarCacheKey, async () => {
        const solarRes = await fetchWithTimeout(
          `https://api.sunrisesunset.io/json?lat=${parsedLat}&lng=${parsedLon}&date=${solarDate}`,
          fetchOptions,
        );
        if (!solarRes.ok) throw new Error(`Solar API returned ${solarRes.status}`);
        const solarJson = await solarRes.json();
        if (solarJson.status !== 'OK') throw new Error('Solar API status not OK');
        return {
          sunrise: solarJson.results.sunrise,
          sunset: solarJson.results.sunset,
          dayLength: solarJson.results.day_length,
        };
      });
    } catch (error) {
      logger.error({ err: error }, 'Solar API error');
      return null;
    }
  };

  // The UI always supplies a report date. Start the date-scoped solar lookup
  // before NOAA weather so a cold solar-cache miss does not add another serial
  // network round trip after the forecast has finished.
  const prefetchedSolarDate = requestedDate || null;
  const prefetchedSolarPromise = prefetchedSolarDate
    ? fetchSolarData(prefetchedSolarDate)
    : null;

  // NOAA is a single critical-path upstream hit on every request; when a breaker is
  // injected, fast-fail once it's been chronically failing instead of piling on more
  // doomed requests. Tests/callers that don't inject one simply skip the breaker check.
  const runNoaaFetch = (fn) => (noaaCircuitBreaker ? withCircuitBreaker(noaaCircuitBreaker, fn) : fn());

  try {
    // 1. Get NOAA grid data (cached 24h)
    const pointsCacheKey = normalizeCoordKey(parsedLat, parsedLon);
    const pointsData = await noaaPointsCache.getOrFetch(pointsCacheKey, () => runNoaaFetch(async () => {
      const pointsRes = await fetchWithTimeout(
        `https://api.weather.gov/points/${parsedLat},${parsedLon}`,
        fetchOptions,
      );
      if (!pointsRes.ok) throw new Error('Failed to fetch NOAA points (Location might be outside US)');
      return pointsRes.json();
    }));
    const pointElevationMeters = parsePointElevationMeters(pointsData?.properties?.elevation?.value);
    let objectiveElevationFt = Number.isFinite(pointElevationMeters)
      ? Math.round(pointElevationMeters * FT_PER_METER)
      : null;
    let objectiveElevationSource = Number.isFinite(pointElevationMeters)
      ? 'NOAA points metadata'
      : null;

    const hourlyForecastUrl = pointsData.properties.forecastHourly;
    gridDataUrl = pointsData?.properties?.forecastGridData || null;

    // The elevation fallback lookup (only needed when NOAA points metadata omits elevation)
    // and the hourly forecast fetch are independent — both only need `pointsData`, which is
    // already resolved at this point. Run them concurrently instead of sequentially to save
    // a network round trip.
    const needsFallbackElevation = !Number.isFinite(objectiveElevationFt);
    const elevationFallbackPromise = needsFallbackElevation
      ? fetchObjectiveElevationFt(parsedLat, parsedLon, fetchOptions)
      : null;

    // 2. Get Forecasts (cached 20m)
    const hourlyDataPromise = noaaForecastCache.getOrFetch(hourlyForecastUrl, () => runNoaaFetch(async () => {
      const hourlyRes = await fetchWithTimeout(hourlyForecastUrl, fetchOptions);
      if (!hourlyRes.ok) throw new Error(`NOAA hourly forecast failed: ${hourlyRes.status}`);
      return hourlyRes.json();
    }));

    const [hourlyData, fallbackElevation] = await Promise.all([
      hourlyDataPromise,
      elevationFallbackPromise,
    ]);

    if (fallbackElevation) {
      objectiveElevationFt = fallbackElevation.elevationFt;
      objectiveElevationSource = fallbackElevation.source;
    }

    const periods = hourlyData?.properties?.periods || [];
    if (!periods.length) throw new Error('No hourly forecast data available for this location');

    const availableDates = [
      ...new Set(periods.map((p) => (p.startTime || '').slice(0, 10)).filter(Boolean)),
    ];
    forecastDateRange = {
      start: availableDates[0] || null,
      end: availableDates[availableDates.length - 1] || null,
    };

    if (!selectedForecastDate) {
      selectedForecastDate = (periods[0].startTime || '').slice(0, 10);
    }

    let forecastStartIndex = periods.findIndex(
      (p) => (p.startTime || '').slice(0, 10) === selectedForecastDate,
    );
    if (forecastStartIndex === -1 && requestedDate) {
      throw new ForecastDateOutOfRangeError(requestedDate, forecastDateRange);
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

    const dailyTemperatureRange = buildDailyTemperatureRange(dayPeriods.map(({ period }) => ({
      tempF: period?.temperature,
    })));

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
    const hourlyTrend = periods
      .slice(forecastStartIndex, forecastStartIndex + forecastTrendHours)
      .map((p, offset) => {
        const rowIndex = forecastStartIndex + offset;
        const windSpeedValue = parseWindMph(p.windSpeed, 0);
        const { gustMph: windGustValue } = inferWindGustFromPeriods(periods, rowIndex, windSpeedValue);
        const trendTemp = Number.isFinite(p.temperature) ? p.temperature : 0;
        const trendPrecip = Number.isFinite(p?.probabilityOfPrecipitation?.value)
          ? p.probabilityOfPrecipitation.value
          : 0;
        const trendHumidity = Number.isFinite(p?.relativeHumidity?.value)
          ? p.relativeHumidity.value
          : null;
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
    const inferredCurrentGust = inferWindGustFromPeriods(
      periods,
      forecastStartIndex,
      currentWindSpeed,
    );
    const currentWindGust = inferredCurrentGust.gustMph;
    const currentCloudCover = resolveNoaaCloudCover(selectedForecastPeriod);
    const windGustSource =
      inferredCurrentGust.source === 'reported'
        ? 'NOAA'
        : inferredCurrentGust.source === 'inferred_nearby'
          ? 'NOAA (inferred from nearby gust hours)'
          : 'Estimated from NOAA sustained wind';
    const currentTemp = Number.isFinite(selectedForecastPeriod?.temperature)
      ? selectedForecastPeriod.temperature
      : 0;
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
      humidity: Number.isFinite(selectedForecastPeriod?.relativeHumidity?.value)
        ? selectedForecastPeriod.relativeHumidity.value
        : null,
      cloudCover: currentCloudCover.value,
      precipChance: Number.isFinite(selectedForecastPeriod?.probabilityOfPrecipitation?.value)
        ? selectedForecastPeriod.probabilityOfPrecipitation.value
        : null,
      isDaytime: selectedForecastPeriod?.isDaytime ?? null,
      issuedTime:
        hourlyData?.properties?.updateTime || hourlyData?.properties?.generatedAt || null,
      timezone: pointsData?.properties?.timeZone || null,
      forecastStartTime: selectedForecastPeriod?.startTime || null,
      forecastEndTime: selectedForecastPeriod?.endTime || null,
      forecastDate: selectedForecastDate,
      trend: hourlyTrend,
      dailyTempHighF: dailyTemperatureRange?.highF ?? null,
      dailyTempLowF: dailyTemperatureRange?.lowF ?? null,
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
          dailyTempHighF: 'NOAA',
          dailyTempLowF: 'NOAA',
          temperatureContext24h: 'NOAA',
          visibilityRisk: 'Derived from NOAA weather fields',
        },
      },
      elevationForecast: elevationForecastBands,
      elevationForecastNote:
        objectiveElevationFt !== null
          ? `Estimated from objective elevation down through terrain bands using lapse-rate adjustments per 1,000 ft. Baseline elevation source: ${objectiveElevationSource || 'unknown source'}.`
          : 'Objective elevation unavailable from NOAA and fallback elevation services; elevation-based estimate could not be generated.',
      forecastLink: `https://forecast.weather.gov/MapClick.php?lat=${parsedLat}&lon=${parsedLon}`,
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
          logger.warn(
            { fields: blended.supplementedFields },
            'NOAA weather supplemented with Open-Meteo',
          );
        }
      } catch (supplementError) {
        logger.warn({ err: supplementError }, 'NOAA weather supplement from Open-Meteo failed');
      }
    }

    // 2.5 Resolve Solar Data (cached 7d per coord+date). Reuse the request
    // started above when NOAA selected the same date; date-less API callers
    // retain the previous behavior and fetch after the forecast picks a date.
    const solarDate =
      selectedForecastDate || requestedDate || new Date().toISOString().slice(0, 10);
    const cachedSolar = prefetchedSolarPromise && prefetchedSolarDate === solarDate
      ? await prefetchedSolarPromise
      : await fetchSolarData(solarDate);
    if (cachedSolar) solarData = cachedSolar;
  } catch (weatherError) {
    // Re-throw date range errors so the caller can return 400
    if (weatherError instanceof ForecastDateOutOfRangeError) {
      throw weatherError;
    }

    logger.error({ err: weatherError }, 'Weather API error');
    if (!selectedForecastDate) {
      selectedForecastDate = requestedDate || new Date().toISOString().slice(0, 10);
    }

    try {
      let fallbackElevationFt =
        typeof weatherData?.elevation === 'number' ? weatherData.elevation : null;
      let fallbackElevationSource = weatherData?.elevationSource || null;
      if (!Number.isFinite(fallbackElevationFt)) {
        const fallbackElevation = await fetchObjectiveElevationFt(
          parsedLat,
          parsedLon,
          fetchOptions,
        );
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
      weatherData = createUnavailableWeatherData({
        lat: parsedLat,
        lon: parsedLon,
        forecastDate: selectedForecastDate,
      });
      weatherData.dataSource = 'unavailable';
      terrainConditionData = deriveTerrainCondition(weatherData);
      trailStatus = terrainConditionData.label;
    }
  }

  return {
    weatherData,
    solarData,
    terrainConditionData,
    trailStatus,
    selectedForecastDate,
    selectedForecastPeriod,
    forecastDateRange,
    gridDataUrl,
  };
}

module.exports = {
  ForecastDateOutOfRangeError,
  parsePointElevationMeters,
  fetchWeatherPipeline,
};
