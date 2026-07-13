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
