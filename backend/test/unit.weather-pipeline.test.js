const { fetchWeatherPipeline } = require('../src/utils/weather-pipeline');

const cache = () => ({ getOrFetch: (_key, fn) => fn() });
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
