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

describe('fetchWeatherPipeline NOAA requests', () => {
  const hourlyPeriods = () => Array.from({ length: 36 }, (_, index) => {
    const hour = String(index % 24).padStart(2, '0');
    const day = String(23 + Math.floor(index / 24)).padStart(2, '0');
    return {
      number: index + 1,
      startTime: `2026-09-${day}T${hour}:00:00-07:00`,
      endTime: `2026-09-${day}T${hour}:59:59-07:00`,
      isDaytime: index % 24 >= 6 && index % 24 <= 19,
      temperature: 50,
      temperatureUnit: 'F',
      windSpeed: '8 mph',
      windDirection: 'W',
      shortForecast: 'Mostly Sunny',
      probabilityOfPrecipitation: { value: 0 },
      relativeHumidity: { value: 40 },
      dewpoint: { value: 4, unitCode: 'wmoUnit:degC' },
      barometricPressure: { value: 101300, unitCode: 'wmoUnit:Pa' },
    };
  });
  const HOURLY_URL = 'https://api.weather.gov/gridpoints/MOCK/1,1/forecast/hourly';

  // NOAA answers; the points response can be held back to see what starts while it is outstanding.
  const setup = ({ pointsElevation = null, gate = null } = {}) => {
    const fetchWithTimeout = jest.fn(async (url) => {
      const target = String(url);
      if (target.includes('api.weather.gov/points/')) {
        if (gate) await gate;
        return jsonResponse(200, { properties: {
          forecastHourly: HOURLY_URL,
          forecastGridData: 'https://api.weather.gov/gridpoints/MOCK/1,1',
          timeZone: 'America/Los_Angeles',
          ...(pointsElevation === null ? {} : { elevation: { value: pointsElevation, unitCode: 'wmoUnit:m' } }),
        } });
      }
      if (target === HOURLY_URL) return jsonResponse(200, { properties: { updateTime: '2026-09-23T12:00:00Z', periods: hourlyPeriods() } });
      if (target.includes('api.sunrisesunset.io')) return jsonResponse(200, { status: 'OK', results: SOLAR });
      return jsonResponse(404, {});
    });
    const fetchObjectiveElevationFt = jest.fn(async () => ({ elevationFt: 14393, source: 'USGS 3DEP elevation service' }));
    const run = (overrides = {}) => fetchWeatherPipeline({
      parsedLat: 46.8523,
      parsedLon: -121.7603,
      requestedDate: '2026-09-23',
      requestedStartClock: '08:00',
      requestedTravelWindowHours: 8,
      fetchOptions: {},
      noaaPointsCache: cache(),
      noaaForecastCache: cache(),
      solarCache: cache(),
      fetchWithTimeout,
      fetchObjectiveElevationFt,
      fetchOpenMeteoWeatherFallback: jest.fn(async () => { throw new Error('offline'); }),
      createUnavailableWeatherData: jest.fn(),
      ...overrides,
    });
    return { fetchWithTimeout, fetchObjectiveElevationFt, run };
  };
  const pointsRequests = (fetchWithTimeout) => fetchWithTimeout.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/points/'));

  test('asks for the point at the four decimals NOAA rounds to, not for a redirect', async () => {
    const { fetchWithTimeout, run } = setup();
    await run({ parsedLat: 46.85234, parsedLon: -121.76038 });

    expect(pointsRequests(fetchWithTimeout)).toEqual(['https://api.weather.gov/points/46.8523,-121.7604']);
  });

  test('looks up the objective elevation while NOAA is still answering, not after', async () => {
    let releasePoints;
    const gate = new Promise((resolve) => { releasePoints = resolve; });
    const { fetchObjectiveElevationFt, fetchWithTimeout, run } = setup({ gate });
    const pending = run();
    for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve));

    expect(pointsRequests(fetchWithTimeout)).toHaveLength(1);
    expect(fetchObjectiveElevationFt).toHaveBeenCalledTimes(1);
    expect(fetchObjectiveElevationFt).toHaveBeenCalledWith(46.8523, -121.7603, {});
    // The hourly forecast cannot be asked for until NOAA has named its URL.
    expect(fetchWithTimeout.mock.calls.some(([url]) => String(url) === HOURLY_URL)).toBe(false);

    releasePoints();
    const result = await pending;
    expect(result.weatherData).toMatchObject({ dataSource: 'noaa', elevation: 14393, elevationSource: 'USGS 3DEP elevation service' });
    expect(fetchObjectiveElevationFt).toHaveBeenCalledTimes(1);
  });

  test('still prefers the elevation NOAA gives with the point', async () => {
    const { fetchObjectiveElevationFt, run } = setup({ pointsElevation: 1200 });
    const result = await run();

    expect(result.weatherData).toMatchObject({ elevation: Math.round(1200 * 3.28084), elevationSource: 'NOAA points metadata' });
    // The lookup is cheap to leave running, and its answer is cached for the next report.
    expect(fetchObjectiveElevationFt).toHaveBeenCalledTimes(1);
  });

  test('a failed elevation lookup leaves the forecast without an elevation, as before', async () => {
    const { run } = setup();
    const result = await run({ fetchObjectiveElevationFt: jest.fn(async () => ({ elevationFt: null, source: null })) });

    expect(result.weatherData.dataSource).toBe('noaa');
    expect(result.weatherData.elevation).toBeNull();
  });
});
