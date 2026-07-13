const { isRouteWaypointEntry } = require('../src/routes/report-logs');

test('identifies internal route waypoint log entries', () => {
  expect(isRouteWaypointEntry({ name: 'Route waypoint: Trailhead' })).toBe(true);
  expect(isRouteWaypointEntry({ name: 'Mount Rainier' })).toBe(false);
  expect(isRouteWaypointEntry({ name: null })).toBe(false);
});

test('authorized AI admin routes read and update runtime settings', async () => {
  const originalSecret = process.env.LOGS_SECRET;
  process.env.LOGS_SECRET = 'admin-test-secret';
  jest.resetModules();

  const getAIStatus = jest.fn(() => ({ enabled: true, provider: 'openai' }));
  const updateAISettings = jest.fn((settings) => ({ enabled: settings.enabled, provider: 'openai' }));
  const getAIUsageEntries = jest.fn(() => []);
  const clearAIUsageEntries = jest.fn(() => 7);
  const getFeatureFlagStatus = jest.fn(() => ({ persistent: true, flags: { tripPlanning: true } }));
  const updateFeatureFlags = jest.fn((flags) => ({ persistent: true, flags }));
  const resetFeatureFlags = jest.fn(() => ({ persistent: true, flags: { tripPlanning: true } }));
  const auditEntries = [{ timestamp: '2026-07-12T12:00:00.000Z', action: 'ai.settings.updated' }];
  const getAdminAuditEntries = jest.fn(() => auditEntries);
  const recordAdminAudit = jest.fn();
  jest.doMock('../src/utils/ai-client', () => ({ getAIStatus, updateAISettings }));
  jest.doMock('../src/utils/ai-usage', () => ({ clearAIUsageEntries, getAIUsageEntries }));
  jest.doMock('../src/utils/feature-flags', () => ({ getFeatureFlagStatus, resetFeatureFlags, updateFeatureFlags }));
  jest.doMock('../src/utils/admin-audit', () => ({ getAdminAuditEntries, recordAdminAudit }));

  const routes = { get: new Map(), patch: new Map(), post: new Map() };
  const app = {
    get: jest.fn((path, handler) => routes.get.set(path, handler)),
    patch: jest.fn((path, handler) => routes.patch.set(path, handler)),
    post: jest.fn((path, handler) => routes.post.set(path, handler)),
  };
  const firstCache = { clear: jest.fn(), stats: jest.fn(() => ({ name: 'weather', size: 3 })) };
  const secondCache = { clear: jest.fn(), stats: jest.fn(() => ({ name: 'imagery', size: 2 })) };
  const diagnosticsPayload = { summary: { total: 2, operational: 2, failed: 0, notConfigured: 0 }, services: [] };
  const runDiagnostics = jest.fn(async () => diagnosticsPayload);
  const modelCatalogPayload = { fetchedAt: '2026-07-12T12:00:00.000Z', providers: {} };
  const loadModelCatalog = jest.fn(async () => modelCatalogPayload);
  const { registerReportLogsRoute } = require('../src/routes/report-logs');
  registerReportLogsRoute(app, { caches: [firstCache, null, secondCache], runDiagnostics, loadModelCatalog });

  const createResponse = () => ({
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  });
  const headers = { authorization: 'Bearer admin-test-secret' };

  const auditResponse = createResponse();
  routes.get.get('/api/admin/audit-log')({ headers }, auditResponse);
  expect(auditResponse.payload).toEqual(auditEntries);

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
    models: undefined,
  });
  expect(patchResponse.payload).toEqual({ enabled: false, provider: 'openai' });
  expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'ai.settings.updated',
    category: 'configuration',
    actorIp: null,
  }));

  const patchModelsResponse = createResponse();
  routes.patch.get('/api/admin/ai-settings')({
    headers,
    body: { models: { anthropic: { primary: 'claude-model', fast: 'claude-fast' } } },
  }, patchModelsResponse);
  expect(updateAISettings).toHaveBeenLastCalledWith({
    enabled: undefined,
    provider: undefined,
    features: undefined,
    models: { anthropic: { primary: 'claude-model', fast: 'claude-fast' } },
  });

  const getModelsResponse = createResponse();
  await routes.get.get('/api/admin/ai-models')({ headers }, getModelsResponse);
  expect(loadModelCatalog).toHaveBeenCalledWith({ force: false });
  expect(getModelsResponse.payload).toEqual(modelCatalogPayload);

  const refreshModelsResponse = createResponse();
  await routes.post.get('/api/admin/ai-models/refresh')({ headers }, refreshModelsResponse);
  expect(loadModelCatalog).toHaveBeenLastCalledWith({ force: true });
  expect(refreshModelsResponse.payload).toEqual(modelCatalogPayload);

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
  expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'product.flags.updated',
    details: { changed: ['tripPlanning'] },
  }));

  const aiUsageResponse = createResponse();
  routes.post.get('/api/admin/maintenance/ai-usage')({ headers }, aiUsageResponse);
  expect(clearAIUsageEntries).toHaveBeenCalledTimes(1);
  expect(aiUsageResponse.payload).toEqual({ cleared: 7 });

  const cachesResponse = createResponse();
  routes.post.get('/api/admin/maintenance/caches')({ headers }, cachesResponse);
  expect(firstCache.clear).toHaveBeenCalledTimes(1);
  expect(secondCache.clear).toHaveBeenCalledTimes(1);
  expect(cachesResponse.payload).toEqual({ cleared: ['weather', 'imagery'], count: 2 });
  expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'maintenance.caches.cleared',
    details: { caches: ['weather', 'imagery'] },
  }));

  const resetFlagsResponse = createResponse();
  routes.post.get('/api/admin/maintenance/feature-flags')({ headers }, resetFlagsResponse);
  expect(resetFeatureFlags).toHaveBeenCalledTimes(1);
  expect(resetFlagsResponse.payload).toEqual({ persistent: true, flags: { tripPlanning: true } });

  const unauthorizedResponse = createResponse();
  routes.post.get('/api/admin/maintenance/ai-usage')({ headers: {} }, unauthorizedResponse);
  expect(unauthorizedResponse.statusCode).toBe(401);
  expect(clearAIUsageEntries).toHaveBeenCalledTimes(1);

  const unauthorizedModelsResponse = createResponse();
  await routes.get.get('/api/admin/ai-models')({ headers: {} }, unauthorizedModelsResponse);
  expect(unauthorizedModelsResponse.statusCode).toBe(401);
  expect(loadModelCatalog).toHaveBeenCalledTimes(2);

  expect(routes.post.has('/api/admin/maintenance/report-logs')).toBe(true);

  const diagnosticsResponse = createResponse();
  await routes.post.get('/api/admin/diagnostics')({ headers }, diagnosticsResponse);
  expect(runDiagnostics).toHaveBeenCalledTimes(1);
  expect(diagnosticsResponse.payload).toEqual(diagnosticsPayload);
  expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'diagnostics.external.completed',
    status: 'success',
  }));

  const unauthorizedDiagnosticsResponse = createResponse();
  await routes.post.get('/api/admin/diagnostics')({ headers: {} }, unauthorizedDiagnosticsResponse);
  expect(unauthorizedDiagnosticsResponse.statusCode).toBe(401);
  expect(runDiagnostics).toHaveBeenCalledTimes(1);

  jest.dontMock('../src/utils/ai-client');
  jest.dontMock('../src/utils/ai-usage');
  jest.dontMock('../src/utils/feature-flags');
  jest.dontMock('../src/utils/admin-audit');
  if (originalSecret === undefined) delete process.env.LOGS_SECRET;
  else process.env.LOGS_SECRET = originalSecret;
  jest.resetModules();
});
