const { fetchWeatherPipeline } = require('../src/utils/weather-pipeline');
const { createCircuitBreaker } = require('../src/utils/http-client');
const { logger } = require('../src/utils/logger');

const cache =() => ({ getOrFetch: (_key, fn) => fn() });
const SOLAR = { sunrise: '6:58:00 AM', sunset: '7:04:00 PM', day_length: '12:06:00' };

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const openMeteoFallback = (selectedDate) => jest.fn(async () => ({
  weatherData: { temp: 48, description: 'Clear', trend: [] },
  selectedForecastDate: selectedDate,
  terrainCondition: { label: 'Dry' },
  forecastDateRange: { start: selectedDate, end: selectedDate },
}));

describe('fetchWeatherPipeline solar data', () => {
  test('keeps sunrise and sunset when NOAA fails and Open-Meteo serves the forecast', async () => {
    const fetchWithTimeout = jest.fn(async (url) => (String(url).includes('api.sunrisesunset.io')
      ? jsonResponse(200, { status: 'OK', results: SOLAR })
      : jsonResponse(500, {})));

    const result = await fetchWeatherPipeline({
      parsedLat: 49.2,
      parsedLon: -123.1,
      requestedDate: '2026-09-23',
      requestedStartClock: '08:00',
      requestedTravelWindowHours: 8,
      fetchOptions: {},
      noaaPointsCache: cache(),
      noaaForecastCache: cache(),
      solarCache: cache(),
      fetchWithTimeout,
      fetchObjectiveElevationFt: jest.fn(async () => ({ elevationFt: 4500, source: 'test' })),
      fetchOpenMeteoWeatherFallback: openMeteoFallback('2026-09-23'),
      createUnavailableWeatherData: jest.fn(),
    });

    expect(result.weatherData.dataSource).toBe('open-meteo-fallback');
    expect(result.solarData).toEqual({ sunrise: SOLAR.sunrise, sunset: SOLAR.sunset, dayLength: SOLAR.day_length });
    // The prefetched lookup is reused rather than repeated.
    expect(fetchWithTimeout.mock.calls.filter(([url]) => String(url).includes('api.sunrisesunset.io'))).toHaveLength(1);
  });

  test('keeps sunrise and sunset when every weather provider fails', async () => {
    const fetchWithTimeout = jest.fn(async (url) => (String(url).includes('api.sunrisesunset.io')
      ? jsonResponse(200, { status: 'OK', results: SOLAR })
      : jsonResponse(500, {})));

    const result = await fetchWeatherPipeline({
      parsedLat: 49.2,
      parsedLon: -123.1,
      requestedDate: '2026-09-23',
      requestedStartClock: '08:00',
      requestedTravelWindowHours: 8,
      fetchOptions: {},
      noaaPointsCache: cache(),
      noaaForecastCache: cache(),
      solarCache: cache(),
      fetchWithTimeout,
      fetchObjectiveElevationFt: jest.fn(async () => ({ elevationFt: null, source: null })),
      fetchOpenMeteoWeatherFallback: jest.fn(async () => { throw new Error('offline'); }),
      createUnavailableWeatherData: jest.fn(() => ({ description: 'Weather data unavailable', trend: [] })),
    });

    expect(result.weatherData.dataSource).toBe('unavailable');
    expect(result.solarData.sunrise).toBe(SOLAR.sunrise);
    expect(result.solarData.sunset).toBe(SOLAR.sunset);
  });
});

describe('fetchWeatherPipeline NOAA circuit breaker', () => {
  const lookUp = (noaaCircuitBreaker, noaaStatus) => fetchWeatherPipeline({
    parsedLat: 49.2,
    parsedLon: -123.1,
    requestedDate: '2026-09-23',
    requestedStartClock: '08:00',
    requestedTravelWindowHours: 8,
    fetchOptions: {},
    noaaPointsCache: cache(),
    noaaForecastCache: cache(),
    solarCache: cache(),
    fetchWithTimeout: jest.fn(async (url) => (String(url).includes('api.sunrisesunset.io')
      ? jsonResponse(200, { status: 'OK', results: SOLAR })
      : jsonResponse(noaaStatus, {}))),
    fetchObjectiveElevationFt: jest.fn(async () => ({ elevationFt: 4500, source: 'test' })),
    fetchOpenMeteoWeatherFallback: openMeteoFallback('2026-09-23'),
    createUnavailableWeatherData: jest.fn(),
    noaaCircuitBreaker,
  });

  test('places outside NOAA coverage never open the breaker, so everyone else keeps NOAA', async () => {
    const breaker = createCircuitBreaker({ name: 'noaa', failureThreshold: 3, resetTimeMs: 60000 });
    for (let i = 0; i < 6; i += 1) {
      for (const status of [404, 400]) {
        const result = await lookUp(breaker, status);
        expect(result.weatherData.dataSource).toBe('open-meteo-fallback');
      }
    }
    expect(breaker.isOpen).toBe(false);
  });

  test('a NOAA outage still opens it', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const breaker = createCircuitBreaker({ name: 'noaa', failureThreshold: 3, resetTimeMs: 60000 });
    for (let i = 0; i < 3; i += 1) await lookUp(breaker, 503);
    expect(breaker.isOpen).toBe(true);
    warn.mockRestore();
  });
});
