const express = require('express');
const request = require('supertest');

const { registerRouteAnalysisRoutes, withTimeout } = require('../src/routes/route-analysis');

test('withTimeout clears its timer when work finishes before the deadline', async () => {
  jest.useFakeTimers();
  try {
    await expect(withTimeout(Promise.resolve('done'), 60000, 'Fast work')).resolves.toBe('done');
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

test('route suggestions use the fast model tier', async () => {
  const app = express();
  const calls = [];
  registerRouteAnalysisRoutes({
    app,
    askAI: async (prompt, options) => {
      calls.push({ prompt, options });
      return '[{"name":"Test Route","distance_rt_miles":4,"elev_gain_ft":1200,"class":"Class 1","description":"Test."}]';
    },
    invokeSafetyHandler: jest.fn(),
    fetchWithTimeout: jest.fn(),
    fetchHeaders: {},
  });

  const response = await request(app)
    .get('/api/route-suggestions')
    .query({ peak: 'Cost Test Peak', lat: 39.1234, lon: -106.5678 });

  expect(response.status).toBe(200);
  expect(calls).toHaveLength(1);
  expect(calls[0].options).toMatchObject({ tier: 'fast', maxTokens: 2048 });
});

test('disabled route analysis blocks suggestions before an AI request', async () => {
  const app = express();
  const askAI = jest.fn();
  registerRouteAnalysisRoutes({
    app,
    askAI,
    invokeSafetyHandler: jest.fn(),
    fetchWithTimeout: jest.fn(),
    fetchHeaders: {},
    ensureFeatureEnabled: () => {
      throw new Error('AI features are unavailable');
    },
  });

  const response = await request(app)
    .get('/api/route-suggestions')
    .query({ peak: 'Test Peak', lat: 39.1234, lon: -106.5678 });

  expect(response.status).toBe(503);
  expect(response.body.error).toBe('AI features are unavailable');
  expect(askAI).not.toHaveBeenCalled();
});

test('GPX route analysis uses supplied coordinates without generating or geocoding waypoints', async () => {
  const app = express();
  app.use(express.json());
  const aiPrompts = [];
  const safetyQueries = [];

  registerRouteAnalysisRoutes({
    app,
    askAI: async (prompt) => {
      aiPrompts.push(prompt);
      return 'GPX route briefing';
    },
    invokeSafetyHandler: async (query) => {
      safetyQueries.push(query);
      return {
        statusCode: 200,
        payload: {
          weather: { elevation: 6000, temp: 28, windGust: 20, description: 'Clear' },
          safety: { score: 82 },
          avalanche: { relevant: false },
          alerts: { alerts: [] },
          snowpack: {},
        },
      };
    },
    fetchWithTimeout: async () => {
      throw new Error('GPX checkpoints must not be geocoded');
    },
    fetchHeaders: {},
  });

  const waypoints = [
    { name: 'Route start', lat: 46.8, lon: -121.7, elev_ft: 5400, distance_miles: 0, progress_percent: 0 },
    { name: 'Route finish', lat: 46.85, lon: -121.76, elev_ft: 14000, distance_miles: 5.2, progress_percent: 100 },
  ];
  const response = await request(app)
    .post('/api/route-analysis')
    .send({
      peak: 'Mount Rainier',
      route: 'Imported Rainier Track',
      lat: 46.85,
      lon: -121.76,
      date: '2026-07-10',
      start: '06:00',
      travel_window_hours: 12,
      waypoints,
      route_metadata: { fileName: 'rainier.gpx', pointCount: 250, distanceMiles: 5.2, elevationGainFt: 8600 },
    });

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    routeSource: 'gpx',
    analysis: 'GPX route briefing',
    partialData: false,
    routeMetadata: { fileName: 'rainier.gpx', pointCount: 250, distanceMiles: 5.2, elevationGainFt: 8600 },
  });
  expect(response.body.waypoints).toHaveLength(2);
  expect(response.body.summaries[1]).toMatchObject({
    name: 'Route finish',
    elev_ft: 14000,
    distance_miles: 5.2,
    progress_percent: 100,
    score: 82,
  });
  expect(safetyQueries.map(({ lat, lon }) => ({ lat, lon }))).toEqual([
    { lat: '46.8', lon: '-121.7' },
    { lat: '46.85', lon: '-121.76' },
  ]);
  expect(aiPrompts).toHaveLength(1);
  expect(aiPrompts[0]).toMatch(/user-supplied GPX track with authoritative checkpoint coordinates/i);
});
