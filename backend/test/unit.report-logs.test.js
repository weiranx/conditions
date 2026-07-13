const { isAdminAccount, isRouteWaypointEntry } = require('../src/routes/report-logs');
const { usageSnapshot } = require('../src/utils/system-resources');

test('identifies internal route waypoint log entries', () => {
  expect(isRouteWaypointEntry({ name: 'Route waypoint: Trailhead' })).toBe(true);
  expect(isRouteWaypointEntry({ name: 'Mount Rainier' })).toBe(false);
  expect(isRouteWaypointEntry({ name: null })).toBe(false);
});

test('recognizes only the configured administrator account', () => {
  expect(isAdminAccount({ email: ' weiranxiong@gmail.com ' })).toBe(true);
  expect(isAdminAccount({ email: 'WEIRANXIONG@GMAIL.COM' })).toBe(true);
  expect(isAdminAccount({ email: 'climber@example.com' })).toBe(false);
  expect(isAdminAccount(null)).toBe(false);
});

test('calculates resource usage without allowing invalid capacity values', () => {
  expect(usageSnapshot(8_000, 3_000, 2_500)).toEqual({
    totalBytes: 8_000,
    usedBytes: 5_000,
    freeBytes: 3_000,
    availableBytes: 2_500,
    usagePercent: 62.5,
  });
  expect(usageSnapshot(0, -1)).toEqual({
    totalBytes: 0,
    usedBytes: 0,
    freeBytes: 0,
    availableBytes: 0,
    usagePercent: 0,
  });
});

test('authorized AI admin routes read and update runtime settings', async () => {
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
  const systemResourcesPayload = {
    memory: { totalBytes: 8_000, usedBytes: 5_000, freeBytes: 3_000, availableBytes: 3_000, usagePercent: 62.5 },
    disk: { totalBytes: 100_000, usedBytes: 40_000, freeBytes: 60_000, availableBytes: 55_000, usagePercent: 40 },
    timestamp: '2026-07-12T12:00:00.000Z',
  };
  const readSystemResources = jest.fn(async () => systemResourcesPayload);
  const adminUser = {
    id: 'f39db25c-3498-41f9-9448-7c8004b8f688',
    email: 'weiranxiong@gmail.com',
    displayName: 'Weiran Xiong',
  };
  const managedUser = {
    id: '8c696be4-e175-4b6a-965b-82bdf3758e0c',
    email: 'climber@example.com',
    displayName: 'Avery Stone',
    tier: 'free',
    status: 'active',
  };
  const listUsers = jest.fn(async () => ({
    users: [adminUser, managedUser],
    total: 2,
    summary: { active: 2, suspended: 0, free: 2, premium: 0, activeSessions: 3 },
    limit: 500,
  }));
  const updateUserStatus = jest.fn(async ({ status }) => ({
    user: { ...managedUser, status },
    revokedSessions: status === 'suspended' ? 2 : 0,
  }));
  const updateUserTier = jest.fn(async ({ tier }) => ({
    user: { ...managedUser, tier },
    tier,
  }));
  const revokeUserSessions = jest.fn(async () => ({ user: managedUser, revokedSessions: 1 }));
  const accountService = {
    available: true,
    listUsers,
    updateUserStatus,
    revokeUserSessions,
    updateUserTier,
    getUserForSession: jest.fn(async (token) => (
      token === 'admin-session-token'
        ? adminUser
        : token === 'other-session-token'
          ? managedUser
          : null
    )),
  };
  const { registerReportLogsRoute } = require('../src/routes/report-logs');
  registerReportLogsRoute(app, {
    accountService,
    caches: [firstCache, null, secondCache],
    runDiagnostics,
    loadModelCatalog,
    readSystemResources,
  });

  const createResponse = () => ({
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  });
  const headers = { cookie: 'bc_session=admin-session-token' };

  const auditResponse = createResponse();
  await routes.get.get('/api/admin/audit-log')({ headers }, auditResponse);
  expect(auditResponse.payload).toEqual(auditEntries);

  const systemResourcesResponse = createResponse();
  await routes.get.get('/api/admin/system-resources')({ headers }, systemResourcesResponse);
  expect(readSystemResources).toHaveBeenCalledTimes(1);
  expect(systemResourcesResponse.payload).toEqual(systemResourcesPayload);

  const usersResponse = createResponse();
  await routes.get.get('/api/admin/users')({ headers, query: { limit: '250' } }, usersResponse);
  expect(listUsers).toHaveBeenCalledWith({ limit: '250' });
  expect(usersResponse.payload).toEqual({
    users: [
      { ...adminUser, isOwner: true },
      { ...managedUser, isOwner: false },
    ],
    total: 2,
    summary: { active: 2, suspended: 0, free: 2, premium: 0, activeSessions: 3 },
    limit: 500,
  });

  const suspendResponse = createResponse();
  await routes.patch.get('/api/admin/users/:userId')({
    headers,
    params: { userId: managedUser.id },
    body: { status: 'suspended' },
  }, suspendResponse);
  expect(updateUserStatus).toHaveBeenCalledWith({
    userId: managedUser.id,
    status: 'suspended',
    actorUserId: adminUser.id,
  });
  expect(suspendResponse.payload).toEqual({
    user: { ...managedUser, status: 'suspended' },
    revokedSessions: 2,
  });
  expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'account.user.suspended',
    category: 'accounts',
  }));

  const tierResponse = createResponse();
  await routes.patch.get('/api/admin/users/:userId/tier')({
    headers,
    params: { userId: managedUser.id },
    body: { tier: 'premium' },
  }, tierResponse);
  expect(updateUserTier).toHaveBeenCalledWith({
    userId: managedUser.id,
    tier: 'premium',
    actorUserId: adminUser.id,
  });
  expect(tierResponse.payload).toEqual({
    user: { ...managedUser, tier: 'premium' },
    tier: 'premium',
  });
  expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'account.user.tier-updated',
    category: 'accounts',
    summary: 'Changed Avery Stone to Premium',
  }));

  const revokeSessionsResponse = createResponse();
  await routes.post.get('/api/admin/users/:userId/revoke-sessions')({
    headers,
    params: { userId: managedUser.id },
  }, revokeSessionsResponse);
  expect(revokeUserSessions).toHaveBeenCalledWith({
    userId: managedUser.id,
    actorUserId: adminUser.id,
  });
  expect(revokeSessionsResponse.payload).toEqual({ user: managedUser, revokedSessions: 1 });
  expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'account.sessions.revoked',
    category: 'accounts',
  }));

  const getResponse = createResponse();
  await routes.get.get('/api/admin/ai-settings')({ headers }, getResponse);
  expect(getResponse.payload).toEqual({ enabled: true, provider: 'openai' });

  const patchResponse = createResponse();
  await routes.patch.get('/api/admin/ai-settings')({
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
  await routes.patch.get('/api/admin/ai-settings')({
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
  await routes.get.get('/api/admin/feature-flags')({ headers }, getFlagsResponse);
  expect(getFlagsResponse.payload).toEqual({ persistent: true, flags: { tripPlanning: true } });

  const patchFlagsResponse = createResponse();
  await routes.patch.get('/api/admin/feature-flags')({
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
  await routes.post.get('/api/admin/maintenance/ai-usage')({ headers }, aiUsageResponse);
  expect(clearAIUsageEntries).toHaveBeenCalledTimes(1);
  expect(aiUsageResponse.payload).toEqual({ cleared: 7 });

  const cachesResponse = createResponse();
  await routes.post.get('/api/admin/maintenance/caches')({ headers }, cachesResponse);
  expect(firstCache.clear).toHaveBeenCalledTimes(1);
  expect(secondCache.clear).toHaveBeenCalledTimes(1);
  expect(cachesResponse.payload).toEqual({ cleared: ['weather', 'imagery'], count: 2 });
  expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'maintenance.caches.cleared',
    details: { caches: ['weather', 'imagery'] },
  }));

  const resetFlagsResponse = createResponse();
  await routes.post.get('/api/admin/maintenance/feature-flags')({ headers }, resetFlagsResponse);
  expect(resetFeatureFlags).toHaveBeenCalledTimes(1);
  expect(resetFlagsResponse.payload).toEqual({ persistent: true, flags: { tripPlanning: true } });

  const hiddenFromOtherAccountResponse = createResponse();
  await routes.get.get('/api/admin/ai-settings')({
    headers: { cookie: 'bc_session=other-session-token' },
  }, hiddenFromOtherAccountResponse);
  expect(hiddenFromOtherAccountResponse.statusCode).toBe(404);
  expect(hiddenFromOtherAccountResponse.payload).toEqual({ error: 'Not found' });

  const hiddenSystemResourcesResponse = createResponse();
  await routes.get.get('/api/admin/system-resources')({
    headers: { cookie: 'bc_session=other-session-token' },
  }, hiddenSystemResourcesResponse);
  expect(hiddenSystemResourcesResponse.statusCode).toBe(404);
  expect(readSystemResources).toHaveBeenCalledTimes(1);

  expect(routes.post.has('/api/admin/maintenance/report-logs')).toBe(true);

  const diagnosticsResponse = createResponse();
  await routes.post.get('/api/admin/diagnostics')({ headers }, diagnosticsResponse);
  expect(runDiagnostics).toHaveBeenCalledTimes(1);
  expect(diagnosticsResponse.payload).toEqual(diagnosticsPayload);
  expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'diagnostics.external.completed',
    status: 'success',
  }));

  jest.dontMock('../src/utils/ai-client');
  jest.dontMock('../src/utils/ai-usage');
  jest.dontMock('../src/utils/feature-flags');
  jest.dontMock('../src/utils/admin-audit');
  jest.resetModules();
});
