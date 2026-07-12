// Integration coverage for the /api/safety response-building logic in index.js
// (success-path payload + the catch-block partialData/apiWarning fallback).
//
// Upstream HTTP calls are mocked via global.fetch — http-client.js binds
// `globalThis.fetch` once at module-load time, so the mock must be installed
// *before* requiring index.js.
//
// jest.mock here is hoisted above the requires below (standard Jest behavior),
// so index.js's `const { buildFireRiskData } = require('./src/utils/fire-risk')`
// destructures this same jest.fn reference. That lets the partialData test
// reconfigure its behavior for exactly one call via mockImplementationOnce,
// without needing to touch index.js's internals directly.
jest.mock('../src/utils/fire-risk', () => {
  const actual = jest.requireActual('../src/utils/fire-risk');
  return { ...actual, buildFireRiskData: jest.fn(actual.buildFireRiskData) };
});

const FORECAST_DATE = '2026-07-15';

const buildHourlyPeriods = (count = 36) =>
  Array.from({ length: count }, (_, i) => {
    const hour = String(i % 24).padStart(2, '0');
    const dayOffset = Math.floor(i / 24);
    const day = String(15 + dayOffset).padStart(2, '0');
    const startTime = `2026-07-${day}T${hour}:00:00-07:00`;
    const endTime = `2026-07-${day}T${hour}:59:59-07:00`;
    return {
      number: i + 1,
      startTime,
      endTime,
      isDaytime: i % 24 >= 6 && i % 24 <= 19,
      temperature: 50 + (i % 10),
      temperatureUnit: 'F',
      windSpeed: `${5 + (i % 5)} mph`,
      windDirection: ['NW', 'W', 'SW', 'S'][i % 4],
      shortForecast: 'Mostly Sunny',
      probabilityOfPrecipitation: { value: i % 3 === 0 ? 10 : 0 },
      relativeHumidity: { value: 40 + (i % 10) },
      dewpoint: { value: 5 + (i % 3), unitCode: 'wmoUnit:degC' },
      barometricPressure: { value: 101300, unitCode: 'wmoUnit:Pa' },
    };
  });

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const notFoundResponse = () => jsonResponse(404, { error: 'not found' });

const buildFetchMock = () =>
  jest.fn(async (url) => {
    const u = String(url);

    if (u.includes('api.weather.gov/points/')) {
      return jsonResponse(200, {
        properties: {
          forecastHourly: 'https://api.weather.gov/gridpoints/MOCK/1,1/forecast/hourly',
          forecastGridData: 'https://api.weather.gov/gridpoints/MOCK/1,1',
          timeZone: 'America/Los_Angeles',
          elevation: { value: 1200, unitCode: 'wmoUnit:m' },
        },
      });
    }

    if (u.includes('/gridpoints/MOCK/1,1/forecast/hourly')) {
      return jsonResponse(200, {
        properties: {
          updateTime: new Date().toISOString(),
          periods: buildHourlyPeriods(),
        },
      });
    }

    if (u.includes('api.sunrisesunset.io')) {
      return jsonResponse(200, {
        status: 'OK',
        results: { sunrise: '6:00:00 AM', sunset: '8:30:00 PM', day_length: '14:30:00' },
      });
    }

    if (u.includes('api.avalanche.org/v2/public/products/map-layer')) {
      // Empty FeatureCollection — no zone match, avalancheData stays "no_center_coverage".
      // This is a legitimate, non-error outcome and must not trigger partialData.
      return jsonResponse(200, { type: 'FeatureCollection', features: [] });
    }

    // Every other upstream (alerts, air quality, rainfall, snowpack, atmospheric grid
    // data, local conditions, elevation fallback APIs, etc.) is intentionally left
    // unmocked here. Each of those is fetched through Promise.allSettled or its own
    // try/catch with an "unavailable" fallback, so a 404 degrades that one field
    // without throwing — exercising the per-service graceful-degradation paths.
    return notFoundResponse();
  });

describe('/api/safety response payload (mocked upstreams)', () => {
  let app;
  let request;
  let originalFetch;
  let fetchMock;

  beforeAll(() => {
    originalFetch = global.fetch;
    fetchMock = buildFetchMock();
    global.fetch = fetchMock;

    request = require('supertest');
    ({ app } = require('../index'));
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  test('GET /api/safety returns 200 with the expected top-level shape when upstreams succeed', async () => {
    const res = await request(app)
      .get(`/api/safety?lat=46.8800&lon=-121.7269&date=${FORECAST_DATE}&start=08:00`);

    expect(res.status).toBe(200);
    expect(res.body.partialData).toBeUndefined();
    expect(res.body.apiWarning).toBeUndefined();

    expect(typeof res.body.generatedAt).toBe('string');
    expect(typeof res.body.capabilities.ai).toBe('boolean');
    expect(res.body.location).toEqual({ lat: 46.88, lon: -121.7269 });
    expect(res.body.forecast).toMatchObject({ selectedDate: FORECAST_DATE });
    expect(res.body.weather).toMatchObject({ dataSource: 'noaa' });
    expect(typeof res.body.weather.generatedTime).toBe('string');
    expect(res.body.avalanche).toBeTruthy();
    expect(res.body.alerts).toBeTruthy();
    expect(res.body.airQuality).toBeTruthy();
    expect(res.body.rainfall).toBeTruthy();
    expect(res.body.snowpack).toBeTruthy();
    expect(res.body.fireRisk).toBeTruthy();
    expect(res.body.heatRisk).toBeTruthy();
    expect(res.body.atmosphere).toBeTruthy();
    expect(Array.isArray(res.body.gear)).toBe(true);
    expect(typeof res.body.trail).toBe('string');
    expect(res.body.terrainCondition).toBeTruthy();
    expect(res.body.safety).toBeTruthy();
    expect(typeof res.body.safety.score).toBe('number');
    expect(res.body.pleasantness).toMatchObject({
      scoreVersion: '1.1.0',
      label: expect.any(String),
      summary: expect.any(String),
      disclaimer: expect.stringMatching(/does not change the safety score/i),
    });
    expect(typeof res.body.pleasantness.score).toBe('number');
    expect(res.body.pleasantness.score).toBeGreaterThanOrEqual(0);
    expect(res.body.pleasantness.score).toBeLessThanOrEqual(100);
    expect(Array.isArray(res.body.pleasantness.factors)).toBe(true);
  }, 20000);

  test('GET /api/safety returns 200 with partialData:true and an apiWarning when a pipeline step throws', async () => {
    // Force a synchronous throw inside the success-path-only computation of fire risk data
    // (only reachable before `gearSuggestions`/`fireRiskData` are reassigned in the try
    // block), simulating an unexpected upstream/application failure that the outer
    // catch-block fallback in index.js must absorb.
    const { buildFireRiskData } = require('../src/utils/fire-risk');
    buildFireRiskData.mockImplementationOnce(() => {
      throw new Error('Simulated fire-risk computation failure');
    });

    const res = await request(app)
      .get(`/api/safety?lat=46.8800&lon=-121.7269&date=${FORECAST_DATE}&start=08:00`);

    expect(res.status).toBe(200);
    expect(res.body.partialData).toBe(true);
    expect(typeof res.body.apiWarning).toBe('string');
    expect(res.body.apiWarning.length).toBeGreaterThan(0);
    expect(typeof res.body.capabilities.ai).toBe('boolean');
    expect(res.body.safety).toBeTruthy();
    expect(typeof res.body.safety.score).toBe('number');
    expect(res.body.pleasantness).toBeTruthy();
    expect(typeof res.body.pleasantness.score).toBe('number');
  }, 20000);
});
