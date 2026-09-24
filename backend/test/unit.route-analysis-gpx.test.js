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

test('disabled GPX import rejects supplied checkpoints before account or provider access', async () => {
  const app = express();
  app.use(express.json());
  const ensureAccountAccess = jest.fn();
  const invokeSafetyHandler = jest.fn();
  const askAI = jest.fn();
  registerRouteAnalysisRoutes({
    app,
    askAI,
    invokeSafetyHandler,
    fetchWithTimeout: jest.fn(),
    fetchHeaders: {},
    ensureAccountAccess,
    ensureGpxImportEnabled: () => {
      const error = new Error('This feature is unavailable');
      error.statusCode = 503;
      throw error;
    },
  });

  const response = await request(app)
    .post('/api/route-analysis')
    .send({
      peak: 'Mount Rainier',
      route: 'Imported track',
      lat: 46.85,
      lon: -121.76,
      date: '2026-07-14',
      waypoints: [
        { name: 'Start', lat: 46.8, lon: -121.7 },
        { name: 'Finish', lat: 46.85, lon: -121.76 },
      ],
    });

  expect(response.status).toBe(503);
  expect(response.body.error).toBe('This feature is unavailable');
  expect(ensureAccountAccess).not.toHaveBeenCalled();
  expect(invokeSafetyHandler).not.toHaveBeenCalled();
  expect(askAI).not.toHaveBeenCalled();
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
    'Return to Vernal Fall Footbridge',
    'Return to Happy Isles Trailhead',
  ]);
  expect(response.body.waypoints.at(-1)).toMatchObject({ leg: 'return', lat: 37.7329, lon: -119.5587, elev_ft: 4035 });
  expect(response.body.timing).toMatchObject({ basis: 'distance-and-vert', roundTrip: true, travelWindowHours: 12, paceSource: 'default' });
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

test('route analysis removes avalanche data and narrative when the product domain is disabled', async () => {
  const app = express();
  app.use(express.json());
  const askAI = jest.fn().mockResolvedValue(
    'OTHER CONCERNS: Avalanche danger is Considerable. Wind gusts reach 40 mph.',
  );
  registerRouteAnalysisRoutes({
    app,
    askAI,
    invokeSafetyHandler: async () => ({
      statusCode: 200,
      payload: {
        featureFlags: { avalancheDetails: false },
        weather: { elevation: 6000, windGust: 40, description: 'Windy' },
        safety: {
          score: 70,
          factors: [{ group: 'avalanche', hazard: 'Avalanche', impact: 20 }],
        },
        avalanche: { relevant: true, risk: 'Considerable', dangerLevel: 3 },
        alerts: { alerts: [] },
        snowpack: { snotel: { snowDepthIn: 20 } },
      },
    }),
    fetchWithTimeout: jest.fn(),
    fetchHeaders: {},
    ensureAIEnabled: () => {},
    getProductFeatureFlags: () => ({ avalancheDetails: false }),
  });

  const response = await request(app)
    .post('/api/route-analysis')
    .send({
      peak: 'Test Peak',
      route: 'Imported route',
      lat: 46.85,
      lon: -121.76,
      date: '2026-07-14',
      waypoints: [
        { name: 'Start', lat: 46.8, lon: -121.7 },
        { name: 'Finish', lat: 46.85, lon: -121.76 },
      ],
    });

  expect(response.status).toBe(200);
  expect(response.body.summaries.every((summary) => summary.avalanche === undefined)).toBe(true);
  expect(response.body.analysis).toBe('OTHER CONCERNS: Wind gusts reach 40 mph.');
  expect(JSON.stringify(response.body)).not.toMatch(/Considerable/);
  const routePrompt = askAI.mock.calls[0][0];
  expect(routePrompt).toMatch(/Do not mention them/i);
  expect(routePrompt).not.toMatch(/such as avalanche conditions/i);
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

test('AI-generated elevations are replaced by terrain lookups before ETAs are weighted', async () => {
  const app = express();
  app.use(express.json());
  const terrain = { '37.7329': 4000, '37.7459': 8800 };
  registerRouteAnalysisRoutes({
    app,
    askAI: async (prompt, options) => (options.feature === 'route-waypoints'
      ? '[{"name":"Happy Isles Trailhead","lat":37.7329,"lon":-119.5587,"elev_ft":9000},{"name":"Vernal Fall Footbridge","lat":37.7275,"lon":-119.5431,"elev_ft":4400},{"name":"Half Dome","lat":37.7459,"lon":-119.5332,"elev_ft":1000}]'
      : 'Named route briefing'),
    invokeSafetyHandler: async () => ({ statusCode: 200, payload: { weather: { temp: 45, windGust: 18 }, safety: { score: 80 } } }),
    fetchWithTimeout: jest.fn(async () => ({ ok: false })),
    fetchHeaders: {},
    // The footbridge lookup fails, so its generated elevation is kept.
    fetchElevationFt: async (lat) => ({ elevationFt: terrain[lat.toFixed(4)] ?? null }),
  });

  const response = await request(app)
    .post('/api/route-analysis')
    .send({ peak: 'Half Dome Terrain Lookup Test', route: 'Mist Trail', lat: 37.7459, lon: -119.5332, date: '2026-07-12', start: '06:00' });

  expect(response.status).toBe(200);
  expect(response.body.waypoints.map((waypoint) => waypoint.elev_ft)).toEqual([4000, 4400, 8800, 4400, 4000]);
  expect(response.body.timing.basis).toBe('distance-and-vert');
});

test('an unfound landmark placed at the objective keeps its generated elevation', async () => {
  const app = express();
  app.use(express.json());
  const fetchElevationFt = jest.fn(async (lat) => ({ elevationFt: lat === 34.0993 ? 11496 : 9293 }));
  registerRouteAnalysisRoutes({
    app,
    // The trailhead echoes the objective's coordinates from the prompt.
    askAI: async (prompt, options) => (options.feature === 'route-waypoints'
      ? '[{"name":"Vivian Creek Trailhead","lat":34.0993,"lon":-116.8249,"elev_ft":6080},{"name":"Vivian Creek Camp","lat":34.0786,"lon":-116.8710,"elev_ft":7100},{"name":"San Gorgonio Mountain","lat":34.0993,"lon":-116.8249,"elev_ft":11503}]'
      : 'Named route briefing'),
    invokeSafetyHandler: async () => ({ statusCode: 200, payload: { weather: { temp: 45, elevation: 11400 }, safety: { score: 80 } } }),
    fetchWithTimeout: jest.fn(async () => ({ ok: false })),
    fetchHeaders: {},
    fetchElevationFt,
  });

  const response = await request(app)
    .post('/api/route-analysis')
    .send({ peak: 'San Gorgonio Copied Coordinates Test', route: 'Vivian Creek Trail', lat: 34.0993, lon: -116.8249, date: '2026-09-26', start: '07:00' });

  expect(response.status).toBe(200);
  expect(response.body.waypoints.map((waypoint) => waypoint.elev_ft)).toEqual([6080, 9293, 11496, 9293, 6080]);
  expect(fetchElevationFt).toHaveBeenCalledTimes(2);
});

test('landmarks the map search could not find are marked as estimated locations, return legs included', async () => {
  const app = express();
  app.use(express.json());
  registerRouteAnalysisRoutes({
    app,
    askAI: async (prompt, options) => (options.feature === 'route-waypoints'
      ? '[{"name":"Found Trailhead","lat":40.0,"lon":-105.1,"elev_ft":8000},{"name":"Lost Lake","lat":40.02,"lon":-105.08,"elev_ft":9500},{"name":"Estimate Peak","lat":40.03,"lon":-105.05,"elev_ft":11000}]'
      : 'Named route briefing'),
    invokeSafetyHandler: async () => ({ statusCode: 200, payload: { weather: { temp: 45 }, safety: { score: 80 } } }),
    // Nominatim finds only the trailhead.
    fetchWithTimeout: jest.fn(async (url) => ({
      ok: String(url).includes('nominatim') && String(url).includes('Found%20Trailhead'),
      json: async () => [{ lat: '40.0001', lon: '-105.1001' }],
    })),
    fetchHeaders: {},
    fetchElevationFt: async () => ({ elevationFt: null }),
  });
  const response = await request(app)
    .post('/api/route-analysis')
    .send({ peak: 'Estimate Peak Location Test', route: 'Lost Lake Trail', lat: 40.03, lon: -105.05, date: '2026-07-12', start: '06:00' });

  expect(response.status).toBe(200);
  expect(response.body.summaries.map((summary) => [summary.name, Boolean(summary.locationEstimated)])).toEqual([
    ['Found Trailhead', false],
    ['Lost Lake', true],
    ['Estimate Peak', false],
    ['Return to Lost Lake', true],
    ['Return to Found Trailhead', false],
  ]);
});

test('an implausible generated elevation at a mislocated landmark is dropped, not kept', async () => {
  const app = express();
  app.use(express.json());
  const fetchElevationFt = jest.fn(async () => ({ elevationFt: 11496 }));
  registerRouteAnalysisRoutes({
    app,
    askAI: async (prompt, options) => (options.feature === 'route-waypoints'
      ? '[{"name":"Echoed Trailhead","lat":34.0993,"lon":-116.8249,"elev_ft":0},{"name":"Odd Camp","lat":34.0993,"lon":-116.8249,"elev_ft":-50000},{"name":"San Gorgonio Mountain","lat":34.0993,"lon":-116.8249,"elev_ft":11503}]'
      : 'Named route briefing'),
    invokeSafetyHandler: async () => ({ statusCode: 200, payload: { weather: { temp: 45, elevation: 11400 }, safety: { score: 80 } } }),
    fetchWithTimeout: jest.fn(async () => ({ ok: false })),
    fetchHeaders: {},
    fetchElevationFt,
  });

  const response = await request(app)
    .post('/api/route-analysis')
    .send({ peak: 'San Gorgonio Implausible Elevation Test', route: 'Vivian Creek Trail', lat: 34.0993, lon: -116.8249, date: '2026-09-26', start: '07:00' });

  expect(response.status).toBe(200);
  expect(response.body.waypoints.map((waypoint) => waypoint.elev_ft)).toEqual([null, null, 11496, null, null]);
});

const generatedRouteApp = (waypointsJson) => {
  const app = express();
  app.use(express.json());
  registerRouteAnalysisRoutes({
    app,
    askAI: async (prompt, options) => (options.feature === 'route-waypoints' ? waypointsJson : 'Named route briefing'),
    invokeSafetyHandler: async () => ({ statusCode: 200, payload: { weather: { temp: 45 }, safety: { score: 80 } } }),
    fetchWithTimeout: jest.fn(async () => ({ ok: false })),
    fetchHeaders: {},
    fetchElevationFt: async () => ({ elevationFt: null }),
  });
  return app;
};

test('a generated loop continues past the objective back to the trailhead instead of retracing', async () => {
  const app = generatedRouteApp(JSON.stringify([
    { name: 'Loop Trailhead', lat: 40.0, lon: -105.1, elev_ft: 8000 },
    { name: 'North Ridge', lat: 40.02, lon: -105.08, elev_ft: 10000 },
    { name: 'Loop Peak', lat: 40.03, lon: -105.05, elev_ft: 11000, objective: true },
    { name: 'South Lake', lat: 40.01, lon: -105.04, elev_ft: 9500 },
    { name: 'Loop Trailhead', lat: 40.0005, lon: -105.1005, elev_ft: 8000 },
  ]));
  const response = await request(app)
    .post('/api/route-analysis')
    .send({ peak: 'Loop Peak Shape Test', route: 'Loop Trail', lat: 40.03, lon: -105.05, date: '2026-07-12', start: '06:00' });

  expect(response.status).toBe(200);
  expect(response.body.timing).toMatchObject({ roundTrip: false, routeShape: 'loop' });
  expect(response.body.waypoints.map((waypoint) => waypoint.name)).toEqual([
    'Loop Trailhead', 'North Ridge', 'Loop Peak', 'South Lake', 'Return to Loop Trailhead',
  ]);
  const [start, , summit, , end] = response.body.waypoints;
  expect(summit).toMatchObject({ lat: 40.03, lon: -105.05 });
  expect(end).toMatchObject({ lat: start.lat, lon: start.lon, elev_ft: 8000 });
  expect(response.body.waypoints.every((waypoint) => waypoint.leg === undefined)).toBe(true);
  expect(response.body.waypoints.at(-1).offset_minutes).toBe(12 * 60);
  expect(response.body.waypoints.map((waypoint) => waypoint.distance_miles)).toEqual(
    [...response.body.waypoints.map((waypoint) => waypoint.distance_miles)].sort((a, b) => a - b),
  );
});

test('a generated traverse finishes past the objective without a return', async () => {
  const app = generatedRouteApp(JSON.stringify([
    { name: 'East Trailhead', lat: 40.0, lon: -105.0, elev_ft: 8000 },
    { name: 'Traverse Peak', lat: 40.03, lon: -105.05, elev_ft: 11000, objective: true },
    { name: 'West Trailhead', lat: 40.0, lon: -105.12, elev_ft: 7800 },
  ]));
  const response = await request(app)
    .post('/api/route-analysis')
    .send({ peak: 'Traverse Peak Shape Test', route: 'Grand Traverse', lat: 40.03, lon: -105.05, date: '2026-07-12', start: '06:00' });

  expect(response.status).toBe(200);
  expect(response.body.timing).toMatchObject({ roundTrip: false, routeShape: 'point-to-point' });
  expect(response.body.waypoints.map((waypoint) => waypoint.name)).toEqual(['East Trailhead', 'Traverse Peak', 'West Trailhead']);
});

test('GPX elevations are kept rather than replaced by terrain lookups', async () => {
  const app = express();
  app.use(express.json());
  const fetchElevationFt = jest.fn(async () => ({ elevationFt: 1 }));
  registerRouteAnalysisRoutes({
    app,
    askAI: async () => 'GPX route briefing',
    invokeSafetyHandler: async () => ({ statusCode: 200, payload: { weather: { temp: 45 }, safety: { score: 80 } } }),
    fetchWithTimeout: jest.fn(),
    fetchHeaders: {},
    fetchElevationFt,
  });

  const response = await request(app)
    .post('/api/route-analysis')
    .send({
      peak: 'Mount Rainier', route: 'Imported track', lat: 46.85, lon: -121.76, date: '2026-07-10', start: '06:00',
      waypoints: [
        { name: 'Route start', lat: 46.8, lon: -121.7, elev_ft: 5400, distance_miles: 0, progress_percent: 0 },
        { name: 'Route finish', lat: 46.85, lon: -121.76, distance_miles: 5.2, progress_percent: 100 },
      ],
    });

  expect(response.status).toBe(200);
  expect(response.body.waypoints.map((waypoint) => waypoint.elev_ft)).toEqual([5400, 1]);
  expect(fetchElevationFt).toHaveBeenCalledTimes(1);
});

// Mapped-trail stubs: an NPS trail, and Nominatim finding only the named trailhead.
const mappedRouteApp = ({ npsPath, askAI }) => {
  const app = express();
  app.use(express.json());
  registerRouteAnalysisRoutes({
    app,
    askAI,
    invokeSafetyHandler: async () => ({ statusCode: 200, payload: { weather: { temp: 45, windGust: 10, precipChance: 5 }, safety: { score: 80 } } }),
    fetchWithTimeout: jest.fn(async (url) => {
      const text = String(url);
      if (text.includes('mapservices.nps.gov')) {
        return { ok: true, json: async () => ({ features: [{ attributes: { TRLNAME: 'Mist Trail' }, geometry: { paths: [npsPath] } }] }) };
      }
      if (text.includes('nominatim') && text.includes('Happy%20Isles%20Nature%20Center')) {
        return { ok: true, json: async () => [{ lat: '37.7330', lon: '-119.5586' }] };
      }
      return { ok: false, json: async () => ({}) };
    }),
    fetchHeaders: {},
    fetchElevationFt: async () => ({ elevationFt: null }),
  });
  return app;
};
const mistTrailLandmarks = async (prompt, options) => (options.feature === 'route-waypoints'
  ? '[{"name":"Happy Isles Nature Center","lat":37.7329,"lon":-119.5587},{"name":"Vernal Fall Footbridge","lat":37.7275,"lon":-119.5431},{"name":"Half Dome","lat":37.7459,"lon":-119.5332,"objective":true}]'
  : 'Named route briefing');

test('a mapped trail reaching the objective is used before AI landmarks, which name points along it', async () => {
  const app = mappedRouteApp({
    npsPath: [[-119.5587, 37.7329], [-119.5500, 37.7300], [-119.5431, 37.7275], [-119.5380, 37.7380], [-119.5332, 37.7459]],
    askAI: mistTrailLandmarks,
  });
  const response = await request(app)
    .post('/api/route-analysis')
    .send({ peak: 'Half Dome Mapped First Test', route: 'Mist Trail', lat: 37.7459, lon: -119.5332, date: '2026-07-12', start: '06:00' });

  expect(response.status).toBe(200);
  expect(response.body.routeSource).toBe('nps');
  expect(response.body.timing).toMatchObject({ distanceBasis: 'along-trail', roundTrip: true });
  const names = response.body.waypoints.map((waypoint) => waypoint.name);
  expect(names[0]).toBe('Happy Isles Nature Center');
  expect(names.filter((name) => !name.startsWith('Return')).at(-1)).toBe('Half Dome');
  expect(names.at(-1)).toBe('Return to Happy Isles Nature Center');
  // The trailhead stays on the mapped trail rather than moving to the geocoded point.
  expect(response.body.waypoints[0]).toMatchObject({ lat: 37.7329, lon: -119.5587 });
  // The return retraces the trail, so the outing is twice the trail's length.
  const outbound = response.body.waypoints.filter((waypoint) => waypoint.leg !== 'return');
  const trail = outbound.at(-1).distance_miles;
  expect(response.body.waypoints.at(-1).distance_miles).toBeCloseTo(trail * 2, 1);
  expect(response.body.routeGeometry.length).toBeGreaterThanOrEqual(5);
});

test('a mapped trail that stops far from the objective loses to AI landmarks, but stands in when they fail', async () => {
  const shortTrail = [[-119.5587, 37.7329], [-119.5550, 37.7310]];
  const generated = await request(mappedRouteApp({ npsPath: shortTrail, askAI: mistTrailLandmarks }))
    .post('/api/route-analysis')
    .send({ peak: 'Half Dome Far Trail Test', route: 'Mist Trail', lat: 37.7459, lon: -119.5332, date: '2026-07-12', start: '06:00' });
  expect(generated.status).toBe(200);
  expect(generated.body.routeSource).toBe('generated');

  const failingAI = async (prompt, options) => {
    if (options.feature === 'route-waypoints') throw new Error('provider down');
    return 'Named route briefing';
  };
  const fallback = await request(mappedRouteApp({ npsPath: shortTrail, askAI: failingAI }))
    .post('/api/route-analysis')
    .send({ peak: 'Half Dome Fallback Trail Test', route: 'Mist Trail', lat: 37.7459, lon: -119.5332, date: '2026-07-12', start: '06:00' });
  expect(fallback.status).toBe(200);
  expect(fallback.body.routeSource).toBe('nps');
});

test('GPX checkpoints with only a positional label take the name of a map feature at or near them', async () => {
  const app = express();
  app.use(express.json());
  const places = {
    // A lake right at the 50% checkpoint, and a peak 300 m from the high point.
    '46.8100': { name: 'Crystal Lake', category: 'natural', lat: '46.8100', lon: '-121.7000' },
    '46.8200': { name: 'Pinnacle Peak', category: 'natural', lat: '46.8227', lon: '-121.7000' },
    // A road is not a useful checkpoint name.
    '46.8000': { name: 'Forest Road 52', category: 'highway', lat: '46.8000', lon: '-121.7000' },
  };
  const reverseCalls = [];
  registerRouteAnalysisRoutes({
    app,
    askAI: async () => 'GPX briefing',
    invokeSafetyHandler: async () => ({ statusCode: 200, payload: { weather: { temp: 40 }, safety: { score: 80 } } }),
    fetchWithTimeout: jest.fn(async (url) => {
      const match = /reverse\?.*lat=([\d.-]+)/.exec(String(url));
      if (!match) return { ok: false };
      reverseCalls.push(match[1]);
      const place = places[Number(match[1]).toFixed(4)];
      return { ok: Boolean(place), json: async () => place };
    }),
    fetchHeaders: {},
  });
  const response = await request(app)
    .post('/api/route-analysis')
    .send({
      peak: 'Reverse Name Test Peak', route: 'My track', lat: 46.82, lon: -121.7, date: '2026-07-12', start: '06:00',
      waypoints: [
        { name: 'Route start', lat: 46.8, lon: -121.7, elev_ft: 5000, distance_miles: 0 },
        { name: '50% checkpoint', lat: 46.81, lon: -121.7, elev_ft: 6000, distance_miles: 1 },
        { name: 'High point', lat: 46.82, lon: -121.7, elev_ft: 7000, distance_miles: 2 },
        { name: 'Camp Muir', lat: 46.83, lon: -121.7, elev_ft: 6500, distance_miles: 3 },
      ],
    });

  expect(response.status).toBe(200);
  expect(response.body.waypoints.map((waypoint) => waypoint.name)).toEqual(['Route start', 'Crystal Lake', 'High point near Pinnacle Peak', 'Camp Muir']);
  // A checkpoint that already has a real name is not looked up. (Lookups are
  // cached across tests, so only the absence is checked.)
  expect(reverseCalls).not.toContain('46.83');
});

const gpxPaceApp = () => {
  const app = express();
  app.use(express.json());
  registerRouteAnalysisRoutes({
    app,
    askAI: async () => { throw new Error('no AI in this test'); },
    invokeSafetyHandler: async () => ({ statusCode: 200, payload: { weather: { temp: 40 }, safety: { score: 80 }, solar: { sunrise: '6:30:00 AM', sunset: '7:30:00 PM' } } }),
    fetchWithTimeout: jest.fn(async () => ({ ok: false })),
    fetchHeaders: {},
  });
  return app;
};
const gpxPaceBody = (overrides = {}) => ({
  peak: 'Pace Test Peak', route: 'Pace track', lat: 46.84, lon: -121.7, date: '2026-07-12', start: '06:00', travel_window_hours: 4,
  waypoints: [
    { name: 'Camp Lot', lat: 46.8, lon: -121.7, elev_ft: 5000, distance_miles: 0 },
    { name: 'Meadow', lat: 46.82, lon: -121.7, elev_ft: 6000, distance_miles: 2 },
    { name: 'Pace Test Peak', lat: 46.84, lon: -121.7, elev_ft: 7000, distance_miles: 4 },
  ],
  track: [[0, 5000], [1, 5500], [2, 6000], [3, 6500], [4, 7000]],
  route_metadata: { fileName: 'pace.gpx', routeShape: 'point-to-point' },
  pace: { minutesPerMile: 30, ascentMinutesPer1000Ft: 60, stopBufferMinutes: 30 },
  ...overrides,
});

test('a GPX track retraced as an out-and-back gets arrivals from the traveler\'s pace, a fit check and a turnaround', async () => {
  const response = await request(gpxPaceApp()).post('/api/route-analysis').send(gpxPaceBody({ route_shape: 'out-and-back' }));

  expect(response.status).toBe(200);
  expect(response.body.waypoints.map((waypoint) => waypoint.name)).toEqual([
    'Camp Lot', 'Meadow', 'Pace Test Peak', 'Return to Meadow', 'Return to Camp Lot',
  ]);
  expect(response.body.waypoints.map((waypoint) => waypoint.distance_miles)).toEqual([0, 2, 4, 6, 8]);
  // Up: 4 mi × 30 + 2,000 ft × 60/1,000 = 240 min; down: 120 + 2,000 × 20/1,000 = 160 min;
  // 30 min of stops spread over 400 moving minutes.
  expect(response.body.waypoints.map((waypoint) => waypoint.offset_minutes)).toEqual([0, 129, 258, 344, 430]);
  expect(response.body.summaries.map((summary) => summary.etaTime)).toEqual(['06:00', '08:09', '10:18', '11:44', '13:10']);
  expect(response.body.timing).toMatchObject({
    mode: 'pace', roundTrip: true, routeShape: 'out-and-back', shapeSource: 'traveler', trackTimed: true,
    stopMinutes: 30, estimatedMinutes: 430, windowFit: 'longer',
    turnaround: { objectiveName: 'Pace Test Peak', objectiveEta: '10:18', returnMinutes: 172, byPlanEnd: '07:08', byDark: '16:38', sunset: '19:30' },
  });
  expect(response.body.timing.turnaround.marginToPlanEndMinutes).toBeLessThan(0);
  expect(response.body.analysis).toContain('turn around at Pace Test Peak by 07:08');
});

test('a one-way GPX track is timed by pace as it is, and without a pace the plan\'s window spreads it', async () => {
  const oneWay = await request(gpxPaceApp()).post('/api/route-analysis').send(gpxPaceBody());
  expect(oneWay.status).toBe(200);
  expect(oneWay.body.waypoints).toHaveLength(3);
  expect(oneWay.body.timing).toMatchObject({ mode: 'pace', roundTrip: false, estimatedMinutes: 270, windowFit: 'fits' });
  expect(oneWay.body.timing.routeShape).toBeUndefined();
  expect(oneWay.body.timing.turnaround).toBeUndefined();

  const noPace = await request(gpxPaceApp()).post('/api/route-analysis').send(gpxPaceBody({ pace: undefined }));
  expect(noPace.body.timing.mode).toBe('window');
  expect(noPace.body.waypoints.at(-1).offset_minutes).toBe(240);
  expect(noPace.body.timing.estimatedMinutes).toBeUndefined();
});

test('the traveler can close a named route as a loop or finish it one way; a loop with an unknown way back is not timed by pace', async () => {
  const landmarks = JSON.stringify([
    { name: 'Shape Trailhead', lat: 40.0, lon: -105.1, elev_ft: 8000 },
    { name: 'Shape Ridge', lat: 40.02, lon: -105.08, elev_ft: 10000 },
    { name: 'Shape Peak', lat: 40.03, lon: -105.05, elev_ft: 11000, objective: true },
  ]);
  const body = { peak: 'Shape Override Peak', route: 'Shape Trail', lat: 40.03, lon: -105.05, date: '2026-07-12', start: '06:00',
    route_distance_rt_miles: 12, pace: { minutesPerMile: 25, ascentMinutesPer1000Ft: 45, stopBufferMinutes: 20 } };

  const loop = await request(generatedRouteApp(landmarks)).post('/api/route-analysis').send({ ...body, route_shape: 'loop' });
  expect(loop.status).toBe(200);
  expect(loop.body.waypoints.map((waypoint) => waypoint.name)).toEqual(['Shape Trailhead', 'Shape Ridge', 'Shape Peak', 'Return to Shape Trailhead']);
  expect(loop.body.waypoints.every((waypoint) => waypoint.leg === undefined)).toBe(true);
  expect(loop.body.timing).toMatchObject({ routeShape: 'loop', roundTrip: false, mode: 'window' });

  const oneWay = await request(generatedRouteApp(landmarks)).post('/api/route-analysis').send({ ...body, route_shape: 'point-to-point' });
  expect(oneWay.body.waypoints.map((waypoint) => waypoint.name)).toEqual(['Shape Trailhead', 'Shape Ridge', 'Shape Peak']);
  expect(oneWay.body.timing).toMatchObject({ routeShape: 'point-to-point', roundTrip: false });

  // Left to the route, it is retraced, scaled to its listed length and timed by pace.
  const auto = await request(generatedRouteApp(landmarks)).post('/api/route-analysis').send(body);
  expect(auto.body.waypoints).toHaveLength(5);
  expect(auto.body.timing).toMatchObject({ routeShape: 'out-and-back', roundTrip: true, distanceBasis: 'route-length', mode: 'pace' });
  expect(auto.body.timing.turnaround.objectiveName).toBe('Shape Peak');
});

test('an NDJSON client gets stages and each checkpoint as it lands, then the result; others get plain JSON', async () => {
  const compression = require('compression');
  const app = gpxPaceApp();
  // The real server compresses responses; the stream must not be buffered by it.
  const compressed = express();
  compressed.use(compression());
  compressed.use(app);
  const response = await request(compressed)
    .post('/api/route-analysis')
    .set('Accept', 'application/x-ndjson')
    .set('Accept-Encoding', 'gzip')
    .send(gpxPaceBody({ route_shape: 'out-and-back' }));

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/application\/x-ndjson/);
  expect(response.headers['content-encoding']).toBeUndefined();
  const events = response.text.trim().split('\n').map((line) => JSON.parse(line));
  expect(events[0]).toMatchObject({ type: 'stage', stage: 'locating', routeSource: 'gpx', checkpointCount: 3 });
  const plan = events.find((event) => event.stage === 'forecasts');
  expect(plan.checkpoints.map((checkpoint) => checkpoint.name)).toEqual(['Camp Lot', 'Meadow', 'Pace Test Peak', 'Return to Meadow', 'Return to Camp Lot']);
  const checkpoints = events.filter((event) => event.type === 'checkpoint');
  expect(checkpoints.map((event) => event.index).sort()).toEqual([0, 1, 2, 3, 4]);
  expect(checkpoints[0]).toMatchObject({ dataAvailable: true, weather: { temp: 40 } });
  expect(events.at(-1).type).toBe('result');
  expect(events.at(-1).payload.summaries).toHaveLength(5);

  const plain = await request(app).post('/api/route-analysis').send(gpxPaceBody());
  expect(plain.headers['content-type']).toMatch(/application\/json/);
  expect(plain.body.summaries).toHaveLength(3);

  // A request that fails before the route is found keeps its status code.
  const invalid = await request(app).post('/api/route-analysis').set('Accept', 'application/x-ndjson').send(gpxPaceBody({ date: 'soon' }));
  expect(invalid.status).toBe(400);
});
