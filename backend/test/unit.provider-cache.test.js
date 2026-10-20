'use strict';

const { createAlertsService } = require('../src/utils/alerts');
const { createAtmosphericService } = require('../src/utils/atmospheric-fetch');
const { createPrecipitationService } = require('../src/utils/precipitation');
const { createWeatherDataService } = require('../src/utils/weather-data');
const { createLocalConditionsService } = require('../src/utils/local-conditions-fetch');

const precipitationPayload = {
  timezone: 'UTC',
  hourly: {
    time: ['2026-07-10T00:00', '2026-07-10T01:00'],
    precipitation: [0.4, 0.2],
    rain: [0.4, 0.2],
    snowfall: [0, 0],
  },
};

const okJsonResponse = (payload) => ({
  ok: true,
  status: 200,
  json: async () => payload,
});

describe('provider raw-payload caches', () => {
  test('local conditions reuses the assembled snapshot for repeated reports', async () => {
    const fetchWithTimeout = jest.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => '',
    }));
    const { fetchLocalConditions } = createLocalConditionsService({
      fetchWithTimeout,
      haversineKm: () => 0,
      requestTimeoutMs: 100,
    });
    const request = {
      lat: 46.8523,
      lon: -121.7603,
      selectedDate: '2026-07-10',
      fetchOptions: {},
    };

    const first = await fetchLocalConditions(request);
    const callsAfterFirstReport = fetchWithTimeout.mock.calls.length;
    const second = await fetchLocalConditions(request);

    expect(callsAfterFirstReport).toBeGreaterThan(0);
    expect(fetchWithTimeout).toHaveBeenCalledTimes(callsAfterFirstReport);
    expect(second).toEqual(first);
  });

  test('Open-Meteo weather reuses raw data while selecting each requested start time', async () => {
    const weatherPayload = {
      timezone: 'UTC',
      hourly: {
        time: ['2026-07-10T00:00', '2026-07-10T01:00'],
        temperature_2m: [40, 50],
        dew_point_2m: [30, 31],
        relative_humidity_2m: [60, 55],
        precipitation_probability: [10, 20],
        cloud_cover: [20, 40],
        surface_pressure: [900, 901],
        weather_code: [0, 1],
        wind_speed_10m: [5, 10],
        wind_gusts_10m: [8, 15],
        wind_direction_10m: [180, 270],
        is_day: [0, 1],
      },
    };
    const fetchWithTimeout = jest.fn(async () => ({
      ...okJsonResponse(weatherPayload),
      headers: { get: () => 'Fri, 10 Jul 2026 00:00:00 GMT' },
    }));
    const { fetchOpenMeteoWeatherFallback } = createWeatherDataService({
      fetchWithTimeout,
      requestTimeoutMs: 100,
    });
    const baseRequest = {
      lat: 46.8523,
      lon: -121.7603,
      selectedDate: '2026-07-10',
      fetchOptions: {},
      objectiveElevationFt: 14000,
      objectiveElevationSource: 'test',
      trendHours: 1,
    };

    const first = await fetchOpenMeteoWeatherFallback({ ...baseRequest, startClock: '00:00' });
    const second = await fetchOpenMeteoWeatherFallback({ ...baseRequest, startClock: '01:00' });

    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(first.weatherData.temp).toBe(40);
    expect(second.weatherData.temp).toBe(50);
    expect(first.weatherData.dailyTempHighF).toBe(50);
    expect(first.weatherData.dailyTempLowF).toBe(40);
    expect(second.weatherData.dailyTempHighF).toBe(50);
    expect(second.weatherData.dailyTempLowF).toBe(40);
  });

  test('Open-Meteo weather prefetch is joined by the later fallback request', async () => {
    let respond;
    const fetchWithTimeout = jest.fn(() => new Promise((resolve) => { respond = resolve; }));
    const { fetchOpenMeteoWeatherFallback, prefetchOpenMeteoWeather } = createWeatherDataService({
      fetchWithTimeout,
      requestTimeoutMs: 100,
    });

    prefetchOpenMeteoWeather({ lat: 45.3736, lon: -121.696, fetchOptions: {} });
    await new Promise((resolve) => setImmediate(resolve));
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);

    const fallback = fetchOpenMeteoWeatherFallback({
      lat: 45.3736,
      lon: -121.696,
      selectedDate: '2026-07-10',
      startClock: '01:00',
      fetchOptions: {},
      trendHours: 1,
    });
    respond({
      ...okJsonResponse({
        timezone: 'UTC',
        hourly: { time: ['2026-07-10T00:00', '2026-07-10T01:00'], temperature_2m: [40, 50] },
      }),
      headers: { get: () => null },
    });

    expect((await fallback).weatherData.temp).toBe(50);
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  test('Open-Meteo weather stops host retries when the request signal is aborted', async () => {
    const fetchWithTimeout = jest.fn(async () => {
      throw new Error('aborted weather request');
    });
    const { fetchOpenMeteoWeatherFallback } = createWeatherDataService({
      fetchWithTimeout,
      requestTimeoutMs: 100,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(fetchOpenMeteoWeatherFallback({
      lat: 43.7417,
      lon: -110.8024,
      selectedDate: '2026-07-10',
      startClock: '06:00',
      fetchOptions: { signal: controller.signal },
      objectiveElevationFt: 12000,
      objectiveElevationSource: 'test',
      trendHours: 1,
    })).rejects.toThrow('aborted weather request');
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  test('atmospheric fetches reuse both raw providers while deriving each target hour', async () => {
    const openMeteoPayload = {
      hourly: {
        time: ['2026-07-10T00:00', '2026-07-10T01:00'],
        uv_index: [1, 5],
        freezing_level_height: [1000, 2000],
      },
      daily: {
        time: ['2026-07-10'],
        uv_index_max: [7],
      },
    };
    const gridpointPayload = {
      properties: {
        probabilityOfThunder: {
          values: [
            { validTime: '2026-07-10T00:00:00Z/PT1H', value: 10 },
            { validTime: '2026-07-10T01:00:00Z/PT1H', value: 30 },
          ],
        },
        snowLevel: {
          values: [
            { validTime: '2026-07-10T00:00:00Z/PT1H', value: 1000 },
            { validTime: '2026-07-10T01:00:00Z/PT1H', value: 2000 },
          ],
        },
      },
    };
    const gridDataUrl = 'https://api.weather.gov/gridpoints/TEST/1,1';
    const fetchWithTimeout = jest.fn(async (url) =>
      okJsonResponse(url === gridDataUrl ? gridpointPayload : openMeteoPayload));
    const { fetchAtmosphericSignals } = createAtmosphericService({
      fetchWithTimeout,
      requestTimeoutMs: 100,
    });
    const baseRequest = {
      lat: 46.8523,
      lon: -121.7603,
      selectedDate: '2026-07-10',
      gridDataUrl,
      fetchOptions: {},
    };

    const first = await fetchAtmosphericSignals({
      ...baseRequest,
      startClock: '00:00',
      targetTimeIso: '2026-07-10T00:00:00Z',
    });
    const second = await fetchAtmosphericSignals({
      ...baseRequest,
      startClock: '01:00',
      targetTimeIso: '2026-07-10T01:00:00Z',
    });

    expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
    expect(first.uvIndex).toBe(1);
    expect(second.uvIndex).toBe(5);
    expect(first.thunderProbability).toBe(10);
    expect(second.thunderProbability).toBe(30);
  });

  test('rainfall reuses a fresh forecast payload while deriving each response separately', async () => {
    const fetchWithTimeout = jest.fn(async () => okJsonResponse(precipitationPayload));
    const { fetchRecentRainfallData } = createPrecipitationService({
      fetchWithTimeout,
      requestTimeoutMs: 100,
    });

    const first = await fetchRecentRainfallData(
      46.8523,
      -121.7603,
      '2026-07-10T00:00:00Z',
      1,
      {},
    );
    const second = await fetchRecentRainfallData(
      46.8523,
      -121.7603,
      '2026-07-10T01:00:00Z',
      1,
      {},
    );

    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(first.expected.startTime).toBe('2026-07-10T00:00:00.000Z');
    expect(second.expected.startTime).toBe('2026-07-10T01:00:00.000Z');
  });

  test('rainfall coalesces simultaneous cache misses', async () => {
    const fetchWithTimeout = jest.fn(async () => {
      await new Promise((resolve) => setImmediate(resolve));
      return okJsonResponse(precipitationPayload);
    });
    const { fetchRecentRainfallData } = createPrecipitationService({
      fetchWithTimeout,
      requestTimeoutMs: 100,
    });

    await Promise.all([
      fetchRecentRainfallData(44.2705, -71.3033, '2026-07-10T00:00:00Z', 1, {}),
      fetchRecentRainfallData(44.2705, -71.3033, '2026-07-10T01:00:00Z', 1, {}),
    ]);

    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  test('rainfall stops retrying when the request signal is aborted', async () => {
    const fetchWithTimeout = jest.fn(async () => {
      throw new Error('aborted upstream');
    });
    const { fetchRecentRainfallData } = createPrecipitationService({
      fetchWithTimeout,
      requestTimeoutMs: 100,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchRecentRainfallData(
        43.7417,
        -110.8024,
        '2026-07-10T00:00:00Z',
        1,
        { signal: controller.signal },
      ),
    ).rejects.toThrow('aborted upstream');
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  test('weather alerts cache raw features but filter independently for each target time', async () => {
    const alertsPayload = {
      features: [
        {
          id: 'https://api.weather.gov/alerts/early',
          properties: {
            event: 'Early Warning',
            severity: 'Moderate',
            onset: '2026-07-10T00:00:00Z',
            ends: '2026-07-10T05:59:59Z',
          },
        },
        {
          id: 'https://api.weather.gov/alerts/late',
          properties: {
            event: 'Late Warning',
            severity: 'Severe',
            onset: '2026-07-10T06:00:00Z',
            ends: '2026-07-10T12:00:00Z',
          },
        },
      ],
    };
    const fetchWithTimeout = jest.fn(async () => okJsonResponse(alertsPayload));
    const { fetchWeatherAlertsData } = createAlertsService({ fetchWithTimeout });

    const early = await fetchWeatherAlertsData(
      36.5785,
      -118.2923,
      {},
      '2026-07-10T03:00:00Z',
    );
    const late = await fetchWeatherAlertsData(
      36.5785,
      -118.2923,
      {},
      '2026-07-10T09:00:00Z',
    );

    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(early.alerts.map((alert) => alert.event)).toEqual(['Early Warning']);
    expect(late.alerts.map((alert) => alert.event)).toEqual(['Late Warning']);
  });

  test('air quality uses future hourly forecasts but rejects targets beyond the provider horizon', async () => {
    const airQualityPayload = {
      timezone: 'UTC',
      hourly: {
        time: ['2026-07-10T00:00', '2026-07-12T09:00', '2026-07-14T23:00'],
        us_aqi: [25, 83, 48],
        pm2_5: [4.2, 22.8, 9.1],
        pm10: [7.3, 31.4, 15.2],
        ozone: [41, 62, 50],
      },
    };
    const fetchWithTimeout = jest.fn(async () => okJsonResponse(airQualityPayload));
    const { fetchAirQualityData } = createAlertsService({ fetchWithTimeout });

    const future = await fetchAirQualityData(
      46.123456,
      -121.654321,
      '2026-07-12T09:00:00Z',
      {},
    );
    const outsideHorizon = await fetchAirQualityData(
      46.123456,
      -121.654321,
      '2026-07-18T09:00:00Z',
      {},
    );

    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(fetchWithTimeout.mock.calls[0][0]).toContain('forecast_days=7');
    expect(future).toMatchObject({
      status: 'ok',
      usAqi: 83,
      category: 'Moderate',
      pm25: 22.8,
      validTime: '2026-07-12T09:00Z',
      dataType: 'modeled_forecast',
    });
    expect(outsideHorizon).toMatchObject({
      status: 'not_applicable_future_date',
      usAqi: null,
    });
    expect(outsideHorizon.note).toMatch(/outside the provider forecast horizon/i);
  });
});

describe('getOrFetch shouldStore', () => {
  const { createCache } = require('../src/utils/cache');

  test('a value that is not stored still reaches everyone waiting on it, and is asked for again next time', async () => {
    const cache = createCache({ name: 'should-store', ttlMs: 60000 });
    const load = jest.fn(async () => ({ good: false }));
    const options = { shouldStore: (value) => value.good };

    const answers = await Promise.all([cache.getOrFetch('k', load, options), cache.getOrFetch('k', load, options)]);
    expect(answers).toEqual([{ good: false }, { good: false }]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.has('k')).toBe(false);

    load.mockResolvedValueOnce({ good: true });
    await expect(cache.getOrFetch('k', load, options)).resolves.toEqual({ good: true });
    await expect(cache.getOrFetch('k', load, options)).resolves.toEqual({ good: true });
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('a stale value is kept when its refresh is not worth storing', async () => {
    jest.useFakeTimers({ now: 1000, doNotFake: ['setImmediate', 'nextTick'] });
    try {
      const cache = createCache({ name: 'should-store-stale', ttlMs: 1000, staleTtlMs: 5000 });
      cache.set('k', { good: true, n: 1 });
      jest.setSystemTime(3000);
      const load = jest.fn(async () => ({ good: false, n: 2 }));

      await expect(cache.getOrFetch('k', load, { shouldStore: (value) => value.good })).resolves.toEqual({ good: true, n: 1 });
      await new Promise((resolve) => setImmediate(resolve));
      expect(load).toHaveBeenCalledTimes(1);
      expect(cache.get('k').value).toEqual({ good: true, n: 1 });
    } finally {
      jest.useRealTimers();
    }
  });

  test('without the option every value is stored, as before', async () => {
    const cache = createCache({ name: 'default-store', ttlMs: 60000 });
    const load = jest.fn(async () => null);
    await cache.getOrFetch('k', load);
    await cache.getOrFetch('k', load);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('air quality, alerts and rainfall prefetch and AirNow cache', () => {
  const HOUR = 60 * 60 * 1000;
  const hourString = (ms) => new Date(ms).toISOString().slice(0, 13) + ':00';
  const openMeteoAirQuality = (nowMs) => ({
    timezone: 'UTC',
    hourly: {
      time: [hourString(nowMs), hourString(nowMs + 24 * HOUR)],
      us_aqi: [30, 40],
      pm2_5: [5, 6],
      pm10: [8, 9],
      ozone: [40, 41],
    },
  });
  const airNowRows = (lat, lon, nowMs) => [{
    AQI: 72, Latitude: lat, Longitude: lon, UTC: new Date(nowMs - 30 * 60 * 1000).toISOString().slice(0, 16),
    Parameter: 'PM2.5', FullAQSCode: '000000001', SiteName: 'Test monitor',
  }];
  const deferred = () => {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const isAirNow = (url) => String(url).includes('airnowapi.org');

  test('AirNow is asked at the same time as Open-Meteo, not after it', async () => {
    const lat = 40.1111;
    const lon = -111.1111;
    const openMeteo = deferred();
    const fetchWithTimeout = jest.fn((url) => (isAirNow(url)
      ? Promise.resolve(okJsonResponse(airNowRows(lat, lon, Date.now())))
      : openMeteo.promise));
    const { fetchAirQualityData } = createAlertsService({ fetchWithTimeout, airNowApiKey: 'test-key' });

    const result = fetchAirQualityData(lat, lon, new Date().toISOString(), {});
    await flush();
    expect(fetchWithTimeout.mock.calls.map(([url]) => isAirNow(url))).toEqual([true, false]);

    openMeteo.resolve(okJsonResponse(openMeteoAirQuality(Date.now())));
    await expect(result).resolves.toMatchObject({ usAqi: 72, dataType: 'observed_nowcast', observation: { available: true } });
  });

  test('AirNow observations are cached per place while each target time still picks its own headline', async () => {
    const lat = 40.2222;
    const lon = -111.2222;
    const fetchWithTimeout = jest.fn(async (url) => okJsonResponse(isAirNow(url)
      ? airNowRows(lat, lon, Date.now())
      : openMeteoAirQuality(Date.now())));
    const { fetchAirQualityData } = createAlertsService({ fetchWithTimeout, airNowApiKey: 'test-key' });

    const now = await fetchAirQualityData(lat, lon, new Date().toISOString(), {});
    const tomorrow = await fetchAirQualityData(lat, lon, new Date(Date.now() + 24 * HOUR).toISOString(), {});

    expect(fetchWithTimeout.mock.calls.filter(([url]) => isAirNow(url))).toHaveLength(1);
    expect(now).toMatchObject({ usAqi: 72, dataType: 'observed_nowcast' });
    expect(tomorrow).toMatchObject({ usAqi: 40, dataType: 'modeled_forecast', observation: { available: true } });
  });

  test('a failed AirNow request keeps the modeled note and is asked again by the next report', async () => {
    const lat = 40.3333;
    const lon = -111.3333;
    let airNowUp = false;
    const fetchWithTimeout = jest.fn(async (url) => {
      if (!isAirNow(url)) return okJsonResponse(openMeteoAirQuality(Date.now()));
      return airNowUp ? okJsonResponse(airNowRows(lat, lon, Date.now())) : { ok: false, status: 503, json: async () => ({}) };
    });
    const { fetchAirQualityData } = createAlertsService({ fetchWithTimeout, airNowApiKey: 'test-key' });

    const failed = await fetchAirQualityData(lat, lon, new Date().toISOString(), {});
    expect(failed.note).toBe('EPA AirNow observation unavailable; using modeled hourly air quality.');
    expect(failed.observation).toBeUndefined();

    airNowUp = true;
    const recovered = await fetchAirQualityData(lat, lon, new Date().toISOString(), {});
    expect(recovered).toMatchObject({ usAqi: 72, observation: { available: true } });
    expect(fetchWithTimeout.mock.calls.filter(([url]) => isAirNow(url))).toHaveLength(2);
  });

  test('past ten minutes the last AirNow answer is served while one refresh runs in the background', async () => {
    jest.useFakeTimers({ now: Date.now(), doNotFake: ['setImmediate', 'nextTick'] });
    try {
      const lat = 40.4444;
      const lon = -111.4444;
      const refresh = deferred();
      let airNowCalls = 0;
      const fetchWithTimeout = jest.fn((url) => {
        if (!isAirNow(url)) return Promise.resolve(okJsonResponse(openMeteoAirQuality(Date.now())));
        airNowCalls += 1;
        return airNowCalls === 1 ? Promise.resolve(okJsonResponse(airNowRows(lat, lon, Date.now()))) : refresh.promise;
      });
      const { fetchAirQualityData } = createAlertsService({ fetchWithTimeout, airNowApiKey: 'test-key' });
      await fetchAirQualityData(lat, lon, new Date().toISOString(), {});

      jest.setSystemTime(Date.now() + 15 * 60 * 1000);
      // The refresh never answers within this report, which still gets the earlier observation.
      await expect(fetchAirQualityData(lat, lon, new Date().toISOString(), {})).resolves.toMatchObject({ observation: { available: true } });
      expect(airNowCalls).toBe(2);
      refresh.resolve(okJsonResponse([]));
      await flush();
    } finally {
      jest.useRealTimers();
    }
  });

  test('an air quality prefetch is joined by the report, which asks each provider once', async () => {
    const lat = 40.5555;
    const lon = -111.5555;
    const fetchWithTimeout = jest.fn(async (url) => okJsonResponse(isAirNow(url)
      ? airNowRows(lat, lon, Date.now())
      : openMeteoAirQuality(Date.now())));
    const { fetchAirQualityData, prefetchAirQuality } = createAlertsService({ fetchWithTimeout, airNowApiKey: 'test-key' });

    prefetchAirQuality({ lat, lon, fetchOptions: {} });
    await flush();
    expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
    await expect(fetchAirQualityData(lat, lon, new Date().toISOString(), {})).resolves.toMatchObject({ usAqi: 72 });
    expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
  });

  test('a failed prefetch is retried by the report rather than left unhandled', async () => {
    const lat = 40.6666;
    const lon = -111.6666;
    let up = false;
    const fetchWithTimeout = jest.fn(async () => (up ? okJsonResponse({ features: [] }) : { ok: false, status: 500, json: async () => ({}) }));
    const { fetchWeatherAlertsData, prefetchWeatherAlerts } = createAlertsService({ fetchWithTimeout });

    prefetchWeatherAlerts({ lat, lon, fetchOptions: {} });
    await flush();
    up = true;
    await expect(fetchWeatherAlertsData(lat, lon, {}, null)).resolves.toMatchObject({ status: 'none' });
    expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
  });

  test('an alerts prefetch in flight is joined by the report', async () => {
    const answer = deferred();
    const fetchWithTimeout = jest.fn(() => answer.promise);
    const { fetchWeatherAlertsData, prefetchWeatherAlerts } = createAlertsService({ fetchWithTimeout });

    prefetchWeatherAlerts({ lat: 40.7777, lon: -111.7777, fetchOptions: {} });
    await flush();
    const report = fetchWeatherAlertsData(40.7777, -111.7777, {}, null);
    answer.resolve(okJsonResponse({ features: [] }));
    await expect(report).resolves.toMatchObject({ status: 'none' });
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  test('a rainfall prefetch is joined by the report, which still reads as a fresh fetch', async () => {
    const fetchWithTimeout = jest.fn(async () => okJsonResponse(precipitationPayload));
    const { fetchRecentRainfallData, prefetchRecentRainfall } = createPrecipitationService({ fetchWithTimeout, requestTimeoutMs: 100 });

    prefetchRecentRainfall({ lat: 46.1111, lon: -121.1111, fetchOptions: {} });
    await flush();
    const first = await fetchRecentRainfallData(46.1111, -121.1111, '2026-07-10T00:00:00Z', 1, {});
    const second = await fetchRecentRainfallData(46.1111, -121.1111, '2026-07-10T01:00:00Z', 1, {});

    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(first.source).toBe('Open-Meteo Precipitation History (Rain + Snowfall)');
    expect(second.source).toBe('Open-Meteo Precipitation History (Rain + Snowfall, cached)');
  });
});
