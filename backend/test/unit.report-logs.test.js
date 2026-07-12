const { isRouteWaypointEntry } = require('../src/routes/report-logs');

test('identifies internal route waypoint log entries', () => {
  expect(isRouteWaypointEntry({ name: 'Route waypoint: Trailhead' })).toBe(true);
  expect(isRouteWaypointEntry({ name: 'Mount Rainier' })).toBe(false);
  expect(isRouteWaypointEntry({ name: null })).toBe(false);
});

test('authorized AI admin routes read and update runtime settings', () => {
  const originalSecret = process.env.LOGS_SECRET;
  process.env.LOGS_SECRET = 'admin-test-secret';
  jest.resetModules();

  const getAIStatus = jest.fn(() => ({ enabled: true, provider: 'openai' }));
  const updateAISettings = jest.fn((settings) => ({ enabled: settings.enabled, provider: 'openai' }));
  const getFeatureFlagStatus = jest.fn(() => ({ persistent: true, flags: { tripPlanning: true } }));
  const updateFeatureFlags = jest.fn((flags) => ({ persistent: true, flags }));
  jest.doMock('../src/utils/ai-client', () => ({ getAIStatus, updateAISettings }));
  jest.doMock('../src/utils/feature-flags', () => ({ getFeatureFlagStatus, updateFeatureFlags }));

  const routes = { get: new Map(), patch: new Map() };
  const app = {
    get: jest.fn((path, handler) => routes.get.set(path, handler)),
    patch: jest.fn((path, handler) => routes.patch.set(path, handler)),
  };
  const { registerReportLogsRoute } = require('../src/routes/report-logs');
  registerReportLogsRoute(app);

  const createResponse = () => ({
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  });
  const headers = { authorization: 'Bearer admin-test-secret' };

  const getResponse = createResponse();
  routes.get.get('/api/admin/ai-settings')({ headers }, getResponse);
  expect(getResponse.payload).toEqual({ enabled: true, provider: 'openai' });

  const patchResponse = createResponse();
  routes.patch.get('/api/admin/ai-settings')({
    headers,
    body: { enabled: false, features: { aiBrief: false } },
  }, patchResponse);
  expect(updateAISettings).toHaveBeenCalledWith({
    enabled: false,
    provider: undefined,
    features: { aiBrief: false },
  });
  expect(patchResponse.payload).toEqual({ enabled: false, provider: 'openai' });

  const getFlagsResponse = createResponse();
  routes.get.get('/api/admin/feature-flags')({ headers }, getFlagsResponse);
  expect(getFlagsResponse.payload).toEqual({ persistent: true, flags: { tripPlanning: true } });

  const patchFlagsResponse = createResponse();
  routes.patch.get('/api/admin/feature-flags')({
    headers,
    body: { flags: { tripPlanning: false } },
  }, patchFlagsResponse);
  expect(updateFeatureFlags).toHaveBeenCalledWith({ tripPlanning: false });
  expect(patchFlagsResponse.payload).toEqual({ persistent: true, flags: { tripPlanning: false } });

  jest.dontMock('../src/utils/ai-client');
  jest.dontMock('../src/utils/feature-flags');
  if (originalSecret === undefined) delete process.env.LOGS_SECRET;
  else process.env.LOGS_SECRET = originalSecret;
  jest.resetModules();
});
