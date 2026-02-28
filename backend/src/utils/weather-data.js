const { computeFeelsLikeF, normalizePressureHpa } = require('./weather-normalizers');
const { buildVisibilityRisk, buildElevationForecastBands } = require('./visibility-risk');
const { estimateWindGustFromWindSpeed, findNearestCardinalFromDegreeSeries } = require('./wind');
const { parseStartClock, clampTravelWindowHours } = require('./time');
const { deriveTrailStatus, deriveTerrainCondition } = require('./terrain-condition');

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

const dateKeyInTimeZone = (value = new Date(), timeZone = null) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const formatWithZone = (zone) => {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        ...(zone ? { timeZone: zone } : {}),
      });
      const parts = formatter.formatToParts(date);
      const year = parts.find((part) => part.type === 'year')?.value;
      const month = parts.find((part) => part.type === 'month')?.value;
      const day = parts.find((part) => part.type === 'day')?.value;
      if (!year || !month || !day) {
        return null;
      }
      return `${year}-${month}-${day}`;
    } catch {
      return null;
    }
  };

  const normalizedTimeZone = typeof timeZone === 'string' ? timeZone.trim() : '';
  return formatWithZone(normalizedTimeZone || null) || formatWithZone('UTC') || date.toISOString().slice(0, 10);
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

  ['windDirection', 'issuedTime', 'timezone', 'forecastEndTime', 'dewPoint', 'temperatureContext24h', 'cloudCover', 'pressure'].forEach(tryFillField);

  const noaaTrend = Array.isArray(merged.trend) ? merged.trend : [];
  const fallbackTrend = Array.isArray(fallbackWeatherData.trend) ? fallbackWeatherData.trend : [];
  if (noaaTrend.length < 6 && fallbackTrend.length > noaaTrend.length) {
    merged.trend = fallbackTrend;
    fieldSources.trend = 'Open-Meteo';
    supplementedFields.push('trend');
  } else if (!fieldSources.trend) {
    fieldSources.trend = 'NOAA';
  }

  if (noaaTrend.length > 0 && fallbackTrend.length > 0) {
    let pressureSupplemented = false;
    const mergedTrend = noaaTrend.map((row, index) => {
      const noaaPressure = row?.pressure;
      const fallbackPressure = fallbackTrend[index]?.pressure;
      if (isWeatherFieldMissing(noaaPressure) && !isWeatherFieldMissing(fallbackPressure)) {
        pressureSupplemented = true;
        return { ...row, pressure: fallbackPressure };
      }
      return row;
    });
    if (pressureSupplemented) {
      merged.trend = mergedTrend;
      if (!supplementedFields.includes('trendPressure')) {
        supplementedFields.push('trendPressure');
      }
      fieldSources.pressure = 'Derived from NOAA + Open-Meteo trend pressure';
    } else if (!fieldSources.pressure) {
      fieldSources.pressure = 'NOAA';
    }
  }

  if (!fieldSources.pressure) {
    fieldSources.pressure = isWeatherFieldMissing(merged.pressure) ? 'Unavailable' : 'NOAA';
  }

  merged.sourceDetails = {
    primary: 'NOAA',
    blended: supplementedFields.length > 0,
    supplementalSources: supplementedFields.length > 0 ? ['Open-Meteo'] : [],
    fieldSources,
  };
  merged.visibilityRisk = buildVisibilityRisk(merged);
  merged.sourceDetails.fieldSources.visibilityRisk =
    supplementedFields.length > 0
      ? 'Derived from merged NOAA/Open-Meteo weather fields'
      : 'Derived from NOAA weather fields';

  return {
    weatherData: merged,
    usedSupplement: supplementedFields.length > 0,
    supplementedFields,
  };
};

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

const createWeatherDataService = ({ fetchWithTimeout, requestTimeoutMs }) => {
  const createUnavailableWeatherData = ({ lat, lon, forecastDate }) => ({
    temp: null,
    feelsLike: null,
    dewPoint: null,
    elevation: null,
    elevationSource: null,
    elevationUnit: 'ft',
    description: 'Weather data unavailable',
    windSpeed: null,
    windGust: null,
    windDirection: null,
    pressure: null,
    humidity: null,
    cloudCover: null,
    precipChance: null,
    isDaytime: null,
    issuedTime: null,
    timezone: null,
    forecastStartTime: null,
    forecastEndTime: null,
    forecastDate: forecastDate || null,
    trend: [],
    temperatureContext24h: null,
    visibilityRisk: buildVisibilityRisk({
      description: 'Weather data unavailable',
      trend: [],
    }),
    elevationForecast: [],
    elevationForecastNote: 'Weather forecast data unavailable; elevation-based estimate could not be generated.',
    forecastLink: `https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lon}`,
    sourceDetails: {
      primary: 'Unavailable',
      blended: false,
      fieldSources: {},
    },
  });

  const fetchOpenMeteoWeatherFallback = async ({
    lat,
    lon,
    selectedDate,
    startClock,
    fetchOptions,
    objectiveElevationFt,
    objectiveElevationSource,
    trendHours,
  }) => {
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
          const response = await fetchWithTimeout(apiUrl, fetchOptions, Math.max(requestTimeoutMs, 12000));
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

  return { createUnavailableWeatherData, fetchOpenMeteoWeatherFallback };
};

module.exports = {
  OPEN_METEO_CODE_LABELS,
  openMeteoCodeToText,
  hourLabelFromIso,
  localHourFromIso,
  dateKeyInTimeZone,
  buildTemperatureContext24h,
  isWeatherFieldMissing,
  blendNoaaWeatherWithFallback,
  OPEN_METEO_WEATHER_HOURLY_FIELDS,
  buildOpenMeteoWeatherApiUrl,
  buildOpenMeteoWeatherSourceLink,
  createWeatherDataService,
};
