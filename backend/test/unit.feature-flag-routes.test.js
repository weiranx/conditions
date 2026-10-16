const express = require('express');
const request = require('supertest');

const { registerFeatureFlagRoutes } = require('../src/routes/feature-flags');
const { registerSatelliteTileRoute } = require('../src/routes/satellite-tile');

test('public feature flag endpoint returns current safe values without caching', async () => {
  const app = express();
  registerFeatureFlagRoutes(app);

  const response = await request(app).get('/api/feature-flags');

  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body).toEqual({
    tripPlanning: true,
    routeAnalysis: true,
    satelliteImagery: true,
    startTimeComparisons: true,
    terrainWindow: true,
    objectiveWatch: true,
    gpxImport: true,
    reportHistory: true,
    reportSharing: true,
    hourlyWeatherCharts: true,
    elevationForecast: true,
    heatRiskDetails: true,
    fireRiskDetails: true,
    snowpackDetails: true,
    fieldObservations: true,
    airQualityDetails: true,
    gearRecommendations: true,
    windLoadingDetails: true,
    daylightTimeline: true,
    contingencyPlanning: true,
    scoreBreakdown: true,
    weatherContextDetails: true,
    avalancheDetails: true,
  });
});

test('disabled satellite imagery is rejected before cache or provider access', async () => {
  const app = express();
  const tileCache = { getOrFetch: jest.fn() };
  const fetchWithTimeout = jest.fn();
  registerSatelliteTileRoute({
    app,
    fetchWithTimeout,
    tileCache,
    ensureFeatureEnabled: () => {
      const error = new Error('This feature is unavailable');
      error.statusCode = 503;
      throw error;
    },
  });

  const response = await request(app).get('/api/satellite-tile/13/1326/2889.png');

  expect(response.status).toBe(503);
  expect(response.body.details).toBe('This feature is unavailable');
  expect(tileCache.getOrFetch).not.toHaveBeenCalled();
  expect(fetchWithTimeout).not.toHaveBeenCalled();
});

test.each([
  [{ acquiredAt: '2026-10-10T18:00:00Z' }, '2026-10-10T18:00:00Z'],
  [{ acquiredAt: null, selection: 'least_cloudy_mosaic_fallback' }, null],
  [undefined, null],
])('satellite date metadata uses the cached image acquisition without returning image bytes', async (metadata, acquiredAt) => {
  const app = express();
  const tileCache = { getOrFetch: jest.fn().mockResolvedValue({ buffer: Buffer.from('png'), metadata }) };
  registerSatelliteTileRoute({ app, tileCache, ensureFeatureEnabled: () => {} });

  const response = await request(app).get('/api/satellite-tile/13/1326/2889.png?metadata=1');

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ acquiredAt });
  expect(response.headers['content-type']).toMatch(/application\/json/);
  expect(tileCache.getOrFetch.mock.calls[0][0]).toBe('13/1326/2889');
});
