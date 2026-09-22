'use strict';

const { createWeatherDataService } = require('../src/utils/weather-data');

const makePayload = (times, timezone = 'America/Los_Angeles') => ({
  timezone,
  hourly: {
    time: times,
    temperature_2m: times.map((_, index) => 40 + index),
    dew_point_2m: times.map(() => 30),
    relative_humidity_2m: times.map(() => 60),
    precipitation_probability: times.map(() => 0),
    cloud_cover: times.map(() => 20),
    surface_pressure: times.map(() => 900),
    weather_code: times.map(() => 0),
    wind_speed_10m: times.map(() => 5),
    wind_gusts_10m: times.map(() => 8),
    wind_direction_10m: times.map(() => 180),
    is_day: times.map(() => 1),
  },
});

const response = (payload) => ({
  ok: true,
  json: async () => payload,
  headers: { get: () => 'Mon, 21 Sep 2026 00:00:00 GMT' },
});

const baseRequest = {
  lat: 46.8523,
  lon: -121.7603,
  selectedDate: '2026-09-21',
  startClock: '06:00',
  fetchOptions: {},
  objectiveElevationFt: 5000,
  objectiveElevationSource: 'test',
  trendHours: 1,
};

const observeNormalization = () => {
  const DateTimeFormat = Intl.DateTimeFormat;
  const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation((...args) => new DateTimeFormat(...args));
  return () => spy.mock.calls.filter(([locale]) => locale === 'en-CA').length;
};

afterEach(() => jest.restoreAllMocks());

test('shared provider data normalizes once while concurrent and later reports select their own date and start', async () => {
  const times = ['2026-09-21T06:00', '2026-09-21T07:00', '2026-09-22T06:00', '2026-09-22T07:00'];
  const payload = makePayload(times);
  const originalPayload = JSON.stringify(payload);
  const normalizationCount = observeNormalization();
  const fetchWithTimeout = jest.fn(async () => response(payload));
  const { fetchOpenMeteoWeatherFallback: fetchWeather } = createWeatherDataService({ fetchWithTimeout, requestTimeoutMs: 100 });

  const [first, laterDate] = await Promise.all([
    fetchWeather(baseRequest),
    fetchWeather({ ...baseRequest, selectedDate: '2026-09-22', startClock: '07:00' }),
  ]);
  const laterStart = await fetchWeather({ ...baseRequest, startClock: '07:00' });

  expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  expect(normalizationCount()).toBe(times.length);
  expect(first.weatherData).toMatchObject({ temp: 40, forecastStartTime: '2026-09-21T06:00:00-07:00', dailyTempHighF: 41 });
  expect(laterDate.weatherData).toMatchObject({ temp: 43, forecastStartTime: '2026-09-22T07:00:00-07:00', dailyTempLowF: 42 });
  expect(laterStart.weatherData).toMatchObject({ temp: 41, forecastStartTime: '2026-09-21T07:00:00-07:00' });
  expect(JSON.stringify(payload)).toBe(originalPayload);
});

test('expired provider data refreshes normalized timestamps using the new payload timezone', async () => {
  let now = Date.parse('2026-09-21T00:00:00Z');
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  const normalizationCount = observeNormalization();
  const times = ['2026-09-21T06:00', '2026-09-21T07:00'];
  const fetchWithTimeout = jest.fn()
    .mockResolvedValueOnce(response(makePayload(times)))
    .mockResolvedValueOnce(response(makePayload(times, 'America/New_York')));
  const { fetchOpenMeteoWeatherFallback: fetchWeather } = createWeatherDataService({ fetchWithTimeout, requestTimeoutMs: 100 });

  const first = await fetchWeather(baseRequest);
  now += 31 * 60 * 1000;
  const refreshed = await fetchWeather(baseRequest);
  const cached = await fetchWeather({ ...baseRequest, startClock: '07:00' });

  expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
  expect(normalizationCount()).toBe(times.length * 2);
  expect(first.weatherData.forecastStartTime).toBe('2026-09-21T06:00:00-07:00');
  expect(refreshed.weatherData.forecastStartTime).toBe('2026-09-21T06:00:00-04:00');
  expect(cached.weatherData.forecastStartTime).toBe('2026-09-21T07:00:00-04:00');
});

test('cached timestamps preserve a nonexistent spring DST hour as a gap and explicit fall offsets', async () => {
  const springPayload = makePayload(['2026-03-08T01:00', '2026-03-08T02:00', '2026-03-08T03:00', '2026-03-08T04:00']);
  const fallPayload = makePayload(['2026-11-01T01:00:00-07:00', '2026-11-01T01:00:00-08:00', '2026-11-01T02:00:00-08:00']);
  const fetchWithTimeout = jest.fn()
    .mockResolvedValueOnce(response(springPayload))
    .mockResolvedValueOnce(response(fallPayload));
  const { fetchOpenMeteoWeatherFallback: fetchWeather } = createWeatherDataService({ fetchWithTimeout, requestTimeoutMs: 100 });

  const beforeGap = await fetchWeather({ ...baseRequest, selectedDate: '2026-03-08', startClock: '01:00', trendHours: 3 });
  const afterGap = await fetchWeather({ ...baseRequest, selectedDate: '2026-03-08', startClock: '03:00', trendHours: 2 });
  const repeatedHour = await fetchWeather({ ...baseRequest, lat: 47, selectedDate: '2026-11-01', startClock: '01:00', trendHours: 3 });
  const cachedRepeatedHour = await fetchWeather({ ...baseRequest, lat: 47, selectedDate: '2026-11-01', startClock: '01:00', trendHours: 3 });

  expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
  expect(beforeGap.weatherData.trend.map((row) => row.timeIso)).toEqual(['2026-03-08T01:00:00-08:00']);
  expect(afterGap.weatherData.trend.map((row) => row.timeIso)).toEqual(['2026-03-08T03:00:00-07:00', '2026-03-08T04:00:00-07:00']);
  expect(repeatedHour.weatherData.trend.map((row) => row.timeIso)).toEqual(fallPayload.hourly.time);
  expect(cachedRepeatedHour.weatherData.trend).toEqual(repeatedHour.weatherData.trend);
});
