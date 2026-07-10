const express = require('express');
const request = require('supertest');

const { registerRouteAnalysisRoutes } = require('../src/routes/route-analysis');

test('GPX route analysis uses supplied coordinates without generating or geocoding waypoints', async () => {
  const app = express();
  app.use(express.json());
  const aiPrompts = [];
  const safetyQueries = [];

  registerRouteAnalysisRoutes({
    app,
    askClaude: async (prompt) => {
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
