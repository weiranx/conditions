const express = require('express');
const request = require('supertest');

const {
  ROUTE_ANALYSIS_MAX_TOKENS,
  buildCheckpointSchedule,
  registerRouteAnalysisRoutes: registerRouteAnalysisRoutesWithoutAccount,
  withTimeout,
} = require('../src/routes/route-analysis');

const allowAccountAccess = async (req) => {
  req.accountUser = { id: '8c696be4-e175-4b6a-965b-82bdf3758e0c' };
  return true;
};
const registerRouteAnalysisRoutes = (options) => registerRouteAnalysisRoutesWithoutAccount({
  ...options,
  ensureAccountAccess: options.ensureAccountAccess || allowAccountAccess,
});

test('checkpoint schedule uses route progress and rolls into the next date', () => {
  expect(buildCheckpointSchedule([
    { progress_percent: 0 },
    { progress_percent: 50 },
    { progress_percent: 100 },
  ], '2026-07-10', '20:00', 12)).toEqual([
    { date: '2026-07-10', time: '20:00', offsetMinutes: 0, progressPercent: 0 },
    { date: '2026-07-11', time: '02:00', offsetMinutes: 360, progressPercent: 50 },
    { date: '2026-07-11', time: '08:00', offsetMinutes: 720, progressPercent: 100 },
  ]);
});

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

test('disabled product route analysis blocks suggestions before checking AI', async () => {
  const app = express();
  const askAI = jest.fn();
  const ensureAIEnabled = jest.fn();
  registerRouteAnalysisRoutes({
    app,
    askAI,
    invokeSafetyHandler: jest.fn(),
    fetchWithTimeout: jest.fn(),
    fetchHeaders: {},
    ensureRouteAnalysisEnabled: () => {
      const error = new Error('This feature is unavailable');
      error.statusCode = 503;
      throw error;
    },
    ensureAIEnabled,
  });

  const response = await request(app)
    .get('/api/route-suggestions')
    .query({ peak: 'Test Peak', lat: 39.1234, lon: -106.5678 });

  expect(response.status).toBe(503);
  expect(response.body.error).toBe('This feature is unavailable');
  expect(askAI).not.toHaveBeenCalled();
  expect(ensureAIEnabled).not.toHaveBeenCalled();
});

test('disabled AI route assistance blocks suggestions without disabling route analysis', async () => {
  const app = express();
  const askAI = jest.fn();
  registerRouteAnalysisRoutes({
    app,
    askAI,
    invokeSafetyHandler: jest.fn(),
    fetchWithTimeout: jest.fn(),
    fetchHeaders: {},
    ensureRouteAnalysisEnabled: jest.fn(),
    ensureAIEnabled: () => {
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

test('AI named routes use specific landmark names instead of mapped checkpoint labels', async () => {
  const app = express();
  app.use(express.json());
  const aiCalls = [];
  let waypointAttempt = 0;
  registerRouteAnalysisRoutes({
    app,
    askAI: async (prompt, options) => {
      aiCalls.push({ prompt, options });
      if (options.feature === 'route-waypoints') {
        waypointAttempt += 1;
        if (waypointAttempt === 1) {
          return '[{"name":"Mist Trail checkpoint 2","lat":37.73,"lon":-119.55,"elev_ft":4300},{"name":"Half Dome","lat":37.7459,"lon":-119.5332,"elev_ft":8846}]';
        }
        return '[{"name":"Happy Isles Trailhead","lat":37.7329,"lon":-119.5587,"elev_ft":4035},{"name":"Vernal Fall Footbridge","lat":37.7275,"lon":-119.5431,"elev_ft":4400},{"name":"Half Dome","lat":37.7459,"lon":-119.5332,"elev_ft":8846}]';
      }
      return 'Named route briefing';
    },
    invokeSafetyHandler: async () => ({
      statusCode: 200,
      payload: {
        weather: { elevation: 6000, temp: 45, windGust: 18, description: 'Clear' },
        safety: { score: 80 },
        avalanche: { relevant: false },
        alerts: { alerts: [] },
        snowpack: {},
      },
    }),
    fetchWithTimeout: jest.fn(async () => ({ ok: false })),
    fetchHeaders: {},
  });

  const response = await request(app)
    .post('/api/route-analysis')
    .send({
      peak: 'Half Dome Named Waypoint Test',
      route: 'Mist Trail',
      lat: 37.7459,
      lon: -119.5332,
      date: '2026-07-12',
      start: '06:00',
    });

  expect(response.status).toBe(200);
  expect(response.body.routeSource).toBe('generated');
  expect(response.body.waypoints.map((waypoint) => waypoint.name)).toEqual([
    'Happy Isles Trailhead',
    'Vernal Fall Footbridge',
    'Half Dome',
  ]);
  expect(response.body.waypoints.map((waypoint) => waypoint.name).join(' ')).not.toMatch(/checkpoint\s+\d/i);
  const waypointCalls = aiCalls.filter((call) => call.options.feature === 'route-waypoints');
  expect(waypointCalls).toHaveLength(2);
  expect(waypointCalls[0].prompt).toMatch(/Never use generic labels/i);
  expect(aiCalls.at(-1).options.feature).toBe('route-analysis');
});

test('GPX route analysis uses supplied coordinates without generating or geocoding waypoints', async () => {
  const app = express();
  app.use(express.json());
  const aiCalls = [];
  const safetyQueries = [];

  registerRouteAnalysisRoutes({
    app,
    askAI: async (prompt, options) => {
      aiCalls.push({ prompt, options });
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
    etaDate: '2026-07-10',
    etaTime: '18:00',
    offsetMinutes: 720,
  });
  expect(safetyQueries.map(({ lat, lon }) => ({ lat, lon }))).toEqual([
    { lat: '46.8', lon: '-121.7' },
    { lat: '46.85', lon: '-121.76' },
  ]);
  expect(safetyQueries.map(({ date, start, travel_window_hours }) => ({ date, start, travel_window_hours }))).toEqual([
    { date: '2026-07-10', start: '06:00', travel_window_hours: '1' },
    { date: '2026-07-10', start: '18:00', travel_window_hours: '1' },
  ]);
  expect(aiCalls).toHaveLength(1);
  expect(aiCalls[0].prompt).toMatch(/user-supplied GPX track with authoritative checkpoint coordinates/i);
  expect(aiCalls[0].prompt).toMatch(/DECISION POINTS:/);
  expect(aiCalls[0].prompt).toMatch(/300-550 word briefing/i);
  expect(aiCalls[0].options).toMatchObject({
    feature: 'route-analysis',
    maxTokens: ROUTE_ANALYSIS_MAX_TOKENS,
  });
});

test('GPX route analysis remains available without AI and returns a deterministic briefing', async () => {
  const app = express();
  app.use(express.json());
  const askAI = jest.fn();
  registerRouteAnalysisRoutes({
    app,
    askAI,
    invokeSafetyHandler: async () => ({
      statusCode: 200,
      payload: {
        weather: { elevation: 7000, temp: 45, windGust: 18, precipChance: 10, description: 'Clear' },
        safety: { score: 78 },
        avalanche: { relevant: false },
        alerts: { alerts: [] },
        snowpack: {},
      },
    }),
    fetchWithTimeout: jest.fn(),
    fetchHeaders: {},
    ensureAIEnabled: () => { throw new Error('AI features are unavailable'); },
  });

  const response = await request(app)
    .post('/api/route-analysis')
    .send({
      peak: 'Runner Route',
      route: 'runner.gpx',
      lat: 46.8,
      lon: -121.7,
      date: '2026-07-10',
      start: '07:00',
      travel_window_hours: 8,
      waypoints: [
        { name: 'Start', lat: 46.8, lon: -121.7, progress_percent: 0 },
        { name: 'Finish', lat: 46.81, lon: -121.71, progress_percent: 100 },
      ],
    });

  expect(response.status).toBe(200);
  expect(response.body.analysis).toMatch(/HAZARD ZONES:/);
  expect(response.body.analysis).toMatch(/timed checkpoints/i);
  expect(response.body.analysisSource).toBe('deterministic');
  expect(askAI).not.toHaveBeenCalled();
});

test('disabled product route analysis blocks GPX analysis even when AI is available', async () => {
  const app = express();
  app.use(express.json());
  const askAI = jest.fn();
  const invokeSafetyHandler = jest.fn();
  registerRouteAnalysisRoutes({
    app,
    askAI,
    invokeSafetyHandler,
    fetchWithTimeout: jest.fn(),
    fetchHeaders: {},
    ensureRouteAnalysisEnabled: () => {
      const error = new Error('This feature is unavailable');
      error.statusCode = 503;
      throw error;
    },
    ensureAIEnabled: jest.fn(),
  });

  const response = await request(app)
    .post('/api/route-analysis')
    .send({
      peak: 'Runner Route',
      route: 'runner.gpx',
      lat: 46.8,
      lon: -121.7,
      date: '2026-07-10',
      waypoints: [
        { name: 'Start', lat: 46.8, lon: -121.7 },
        { name: 'Finish', lat: 46.81, lon: -121.71 },
      ],
    });

  expect(response.status).toBe(503);
  expect(response.body.error).toBe('This feature is unavailable');
  expect(askAI).not.toHaveBeenCalled();
  expect(invokeSafetyHandler).not.toHaveBeenCalled();
});

test('AI-disabled named routes fail before waypoint generation when no mapped trail is found', async () => {
  const app = express();
  app.use(express.json());
  const askAI = jest.fn();
  const invokeSafetyHandler = jest.fn();
  registerRouteAnalysisRoutes({
    app,
    askAI,
    invokeSafetyHandler,
    fetchWithTimeout: jest.fn(async () => ({ ok: false })),
    fetchHeaders: {},
    ensureAIEnabled: () => { throw new Error('AI features are unavailable'); },
  });

  const response = await request(app)
    .post('/api/route-analysis')
    .send({
      peak: 'Unmapped Peak',
      route: 'Unmapped Route',
      lat: 46.8,
      lon: -121.7,
      date: '2026-07-10',
    });

  expect(response.status).toBe(503);
  expect(response.body.error).toMatch(/AI waypoint generation is unavailable/i);
  expect(askAI).not.toHaveBeenCalled();
  expect(invokeSafetyHandler).not.toHaveBeenCalled();
});
