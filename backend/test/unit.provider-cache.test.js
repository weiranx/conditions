'use strict';

const { createAlertsService } = require('../src/utils/alerts');
const { createAtmosphericService } = require('../src/utils/atmospheric-fetch');
const { createPrecipitationService } = require('../src/utils/precipitation');
const { createWeatherDataService } = require('../src/utils/weather-data');

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
});
