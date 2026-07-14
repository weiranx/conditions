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
  const healthMonitorHistoryPayload = [
    {
      checkedAt: '2026-07-14T12:00:00.000Z',
      healthy: false,
      summary: 'PostgreSQL is unavailable.',
      statusCode: 503,
      durationMs: 25,
      action: 'alert-sent',
      alertError: null,
    },
  ];
  const readHealthMonitorHistory = jest.fn(async () => healthMonitorHistoryPayload);
  const runtimeEnvironmentPayload = {
    persistent: true,
    restartRequired: true,
    entries: [{ key: 'REQUEST_TIMEOUT_MS', value: '9000', secret: false }],
  };
  const runtimeEnvService = {
    getStatus: jest.fn(() => runtimeEnvironmentPayload),
    update: jest.fn(async () => ({
      ...runtimeEnvironmentPayload,
      entries: [{ key: 'REQUEST_TIMEOUT_MS', value: '12000', secret: false }],
    })),
  };
  const backendRestartStatus = {
    available: true,
    scheduled: false,
    scheduledAt: null,
    restartDelayMs: 1500,
    reason: null,
  };
  const backendRestartController = {
    getStatus: jest.fn(() => backendRestartStatus),
    scheduleRestart: jest.fn(() => ({
      ...backendRestartStatus,
      scheduled: true,
      scheduledAt: '2026-07-14T19:00:00.000Z',
    })),
  };
  const objectiveWatchSchedulerStatus = {
    enabled: true,
    configured: true,
    running: false,
    health: 'healthy',
    message: 'The five-minute scheduler heartbeat is current.',
    lastHeartbeatAt: '2026-07-14T19:07:00.000Z',
    lastStartedAt: '2026-07-14T19:07:01.000Z',
    lastCompletedAt: '2026-07-14T19:07:15.000Z',
    lastStatus: 'succeeded',
    lastError: null,
    lastSummary: { checked: 2, failed: 0 },
    checkIntervalMinutes: 180,
    expectedIntervalMinutes: 5,
    staleAfterMinutes: 15,
    updatedAt: '2026-07-14T19:07:15.000Z',
  };
  const objectiveWatchScheduler = {
    getStatus: jest.fn(async () => objectiveWatchSchedulerStatus),
    setEnabled: jest.fn(async (enabled) => ({
      ...objectiveWatchSchedulerStatus,
      enabled,
      health: enabled ? 'waiting' : 'stopped',
    })),
    setCheckInterval: jest.fn(async (checkIntervalMinutes) => ({
      ...objectiveWatchSchedulerStatus,
      checkIntervalMinutes,
    })),
  };
  const objectiveWatchCheckController = {
    runNow: jest.fn(async () => ({
      alreadyRunning: false,
      summary: { checked: 3, changed: 1, failed: 0 },
    })),
  };
  let usageSettings = {
    persistent: true,
    freeMonthlyAITokenLimit: 250_000,
    environmentFreeMonthlyAITokenLimit: 250_000,
    maxMonthlyAITokenLimit: 100_000_000,
  };
  const usageService = {
    getSettings: jest.fn(() => usageSettings),
    updateSettings: jest.fn(async ({ freeMonthlyAITokenLimit }) => {
      usageSettings = { ...usageSettings, freeMonthlyAITokenLimit };
      return usageSettings;
    }),
  };
  let reportUsageSettings = {
    persistent: true,
    freeMonthlyReportUsageLimit: 50,
    environmentFreeMonthlyReportUsageLimit: 50,
    maxFreeMonthlyUsageLimit: 10_000,
  };
  const reportUsageService = {
    getSettings: jest.fn(() => reportUsageSettings),
    updateSettings: jest.fn(async ({ freeMonthlyReportUsageLimit }) => {
      reportUsageSettings = { ...reportUsageSettings, freeMonthlyReportUsageLimit };
      return reportUsageSettings;
    }),
  };
  const adminUser = {
    id: 'f39db25c-3498-41f9-9448-7c8004b8f688',
    email: 'weiranxiong@gmail.com',
    displayName: 'Weiran Xiong',
    emailVerified: true,
  };
  const managedUser = {
    id: '8c696be4-e175-4b6a-965b-82bdf3758e0c',
    email: 'climber@example.com',
    displayName: 'Avery Stone',
    emailVerified: false,
    tier: 'free',
    status: 'active',
  };
  const listUsers = jest.fn(async () => ({
    users: [adminUser, managedUser],
    total: 2,
    summary: { active: 2, suspended: 0, free: 2, premium: 0, verified: 1, unverified: 1, activeSessions: 3 },
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
  const updateUserUsageLimit = jest.fn(async ({ limit }) => ({
    user: { ...managedUser, aiTokenLimitOverride: limit },
    limit,
  }));
  const updateUserReportUsageLimit = jest.fn(async ({ limit }) => ({
    user: { ...managedUser, reportUsageLimitOverride: limit },
    limit,
  }));
  const resetUserUsage = jest.fn(async () => ({
    user: managedUser,
    resetAI: true,
    resetReports: true,
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-08-01T00:00:00.000Z',
    resetAt: '2026-08-01T00:00:00.000Z',
  }));
  const resetAllUserUsage = jest.fn(async () => ({
    resetAIAccounts: 2,
    resetReportAccounts: 2,
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-08-01T00:00:00.000Z',
    resetAt: '2026-08-01T00:00:00.000Z',
  }));
  const resetAllUserUsageLimits = jest.fn(async () => ({
    resetAIAccounts: 2,
    resetReportAccounts: 1,
  }));
  const revokeUserSessions = jest.fn(async () => ({ user: managedUser, revokedSessions: 1 }));
  const createAdminEmailVerification = jest.fn(async () => ({
    user: managedUser,
    alreadyVerified: false,
    verification: {
      tokenId: '4df4041e-5ff1-441d-b62f-81283f372489',
      token: 'verification-token',
      expiresAt: new Date('2026-07-14T08:00:00.000Z'),
    },
  }));
  const emailService = {
    available: true,
    sendVerificationEmail: jest.fn(async () => ({ id: 'email-123' })),
  };
  const accountService = {
    available: true,
    createAdminEmailVerification,
    listUsers,
    resetAllUserUsage,
    resetAllUserUsageLimits,
    resetUserUsage,
    updateUserStatus,
    revokeUserSessions,
    updateUserTier,
    updateUserReportUsageLimit,
    updateUserUsageLimit,
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
    emailService,
    reportUsageService,
    usageService,
    caches: [firstCache, null, secondCache],
    runDiagnostics,
    loadModelCatalog,
    readHealthMonitorHistory,
    readSystemResources,
    runtimeEnvService,
    backendRestartController,
    objectiveWatchScheduler,
    objectiveWatchCheckController,
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

  const runtimeEnvironmentResponse = createResponse();
  await routes.get.get('/api/admin/runtime-environment')({ headers }, runtimeEnvironmentResponse);
  expect(runtimeEnvService.getStatus).toHaveBeenCalledTimes(1);
  expect(runtimeEnvironmentResponse.payload).toEqual(runtimeEnvironmentPayload);

  const updateRuntimeEnvironmentResponse = createResponse();
  await routes.patch.get('/api/admin/runtime-environment')({
    headers,
    body: { values: { REQUEST_TIMEOUT_MS: '12000' } },
  }, updateRuntimeEnvironmentResponse);
  expect(runtimeEnvService.update).toHaveBeenCalledWith({ REQUEST_TIMEOUT_MS: '12000' });
  expect(updateRuntimeEnvironmentResponse.payload.entries[0].value).toBe('12000');
  expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'runtime.environment.updated',
    details: { changed: ['REQUEST_TIMEOUT_MS'], restartRequired: true },
  }));

  const schedulerStatusResponse = createResponse();
  await routes.get.get('/api/admin/objective-watch-scheduler')({ headers }, schedulerStatusResponse);
  expect(objectiveWatchScheduler.getStatus).toHaveBeenCalledTimes(1);
  expect(schedulerStatusResponse.payload).toEqual(objectiveWatchSchedulerStatus);

  const stopSchedulerResponse = createResponse();
  await routes.patch.get('/api/admin/objective-watch-scheduler')({
    headers,
    body: { enabled: false },
  }, stopSchedulerResponse);
  expect(objectiveWatchScheduler.setEnabled).toHaveBeenCalledWith(false);
  expect(stopSchedulerResponse.payload).toMatchObject({ enabled: false, health: 'stopped' });
  expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'objective-watch.scheduler.stopped',
    category: 'maintenance',
  }));

  const schedulerIntervalResponse = createResponse();
  await routes.patch.get('/api/admin/objective-watch-scheduler')({
    headers,
    body: { checkIntervalMinutes: 360 },
  }, schedulerIntervalResponse);
  expect(objectiveWatchScheduler.setCheckInterval).toHaveBeenCalledWith(360);
  expect(schedulerIntervalResponse.payload).toMatchObject({ checkIntervalMinutes: 360 });
  expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'objective-watch.scheduler.interval-updated',
    category: 'configuration',
  }));

  const manualSchedulerResponse = createResponse();
  await routes.post.get('/api/admin/objective-watch-scheduler/run')({ headers }, manualSchedulerResponse);
  expect(objectiveWatchCheckController.runNow).toHaveBeenCalledTimes(1);
  expect(manualSchedulerResponse.payload).toMatchObject({
    manualRun: { alreadyRunning: false, summary: { checked: 3, changed: 1, failed: 0 } },
  });
  expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'objective-watch.scheduler.manual-run',
    category: 'maintenance',
  }));

  const invalidSchedulerResponse = createResponse();
  await routes.patch.get('/api/admin/objective-watch-scheduler')({
    headers,
    body: { enabled: 'yes' },
  }, invalidSchedulerResponse);
  expect(invalidSchedulerResponse.statusCode).toBe(400);

  const invalidIntervalResponse = createResponse();
  await routes.patch.get('/api/admin/objective-watch-scheduler')({
    headers,
    body: { checkIntervalMinutes: 7 },
  }, invalidIntervalResponse);
  expect(invalidIntervalResponse.statusCode).toBe(400);

  const backendRestartStatusResponse = createResponse();
  await routes.get.get('/api/admin/maintenance/backend-restart')({ headers }, backendRestartStatusResponse);
  expect(backendRestartStatusResponse.payload).toEqual(backendRestartStatus);

  const backendRestartResponse = createResponse();
  await routes.post.get('/api/admin/maintenance/backend-restart')({ headers }, backendRestartResponse);
  expect(backendRestartResponse.statusCode).toBe(202);
  expect(backendRestartController.scheduleRestart).toHaveBeenCalledTimes(1);
  expect(backendRestartResponse.payload).toMatchObject({ scheduled: true });
  expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'maintenance.backend.restart-requested',
    category: 'maintenance',
    details: { restartDelayMs: 1500 },
  }));

  const healthHistoryResponse = createResponse();
  await routes.get.get('/api/admin/health-monitor-history')({ headers }, healthHistoryResponse);
  expect(readHealthMonitorHistory).toHaveBeenCalledTimes(1);
  expect(healthHistoryResponse.payload).toEqual({
    entries: healthMonitorHistoryPayload,
    summary: {
      total: 1,
      healthy: 0,
      unhealthy: 1,
      availabilityPercent: 0,
      lastCheckAt: '2026-07-14T12:00:00.000Z',
      lastUnhealthyAt: '2026-07-14T12:00:00.000Z',
    },
  });

  const usersResponse = createResponse();
  await routes.get.get('/api/admin/users')({ headers, query: { limit: '250' } }, usersResponse);
  expect(listUsers).toHaveBeenCalledWith({ limit: '250' });
  expect(usersResponse.payload).toEqual({
    users: [
      { ...adminUser, isOwner: true },
      { ...managedUser, isOwner: false },
    ],
    total: 2,
    summary: { active: 2, suspended: 0, free: 2, premium: 0, verified: 1, unverified: 1, activeSessions: 3 },
    limit: 500,
  });

  const verificationResponse = createResponse();
  await routes.post.get('/api/admin/users/:userId/send-verification')({
    headers,
    params: { userId: managedUser.id },
  }, verificationResponse);
  expect(createAdminEmailVerification).toHaveBeenCalledWith({
    userId: managedUser.id,
    actorUserId: adminUser.id,
  });
  expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(expect.objectContaining({
    tokenId: '4df4041e-5ff1-441d-b62f-81283f372489',
    token: 'verification-token',
    to: managedUser.email,
    displayName: managedUser.displayName,
  }));
  expect(verificationResponse.payload).toMatchObject({ ok: true, verified: false, user: managedUser });
  expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'account.email-verification.sent',
    category: 'accounts',
  }));

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

  const usageSettingsResponse = createResponse();
  await routes.get.get('/api/admin/usage-settings')({ headers }, usageSettingsResponse);
  expect(usageSettingsResponse.payload).toEqual({ ...usageSettings, ...reportUsageSettings });

  const updateUsageSettingsResponse = createResponse();
  await routes.patch.get('/api/admin/usage-settings')({
    headers,
    body: { freeMonthlyAITokenLimit: 500_000, freeMonthlyReportUsageLimit: 60 },
  }, updateUsageSettingsResponse);
  expect(usageService.updateSettings).toHaveBeenCalledWith({ freeMonthlyAITokenLimit: 500_000 });
  expect(reportUsageService.updateSettings).toHaveBeenCalledWith({ freeMonthlyReportUsageLimit: 60 });
  expect(updateUsageSettingsResponse.payload).toMatchObject({
    freeMonthlyAITokenLimit: 500_000,
    freeMonthlyReportUsageLimit: 60,
  });
  expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'usage.limits.updated',
    category: 'configuration',
  }));

  const updateUserUsageLimitResponse = createResponse();
  await routes.patch.get('/api/admin/users/:userId/usage-limit')({
    headers,
    params: { userId: managedUser.id },
    body: { limit: 500_000 },
  }, updateUserUsageLimitResponse);
  expect(updateUserUsageLimit).toHaveBeenCalledWith({
    userId: managedUser.id,
    limit: 500_000,
    actorUserId: adminUser.id,
  });
  expect(updateUserUsageLimitResponse.payload).toMatchObject({ limit: 500_000 });
  expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'account.usage-limit.updated',
    category: 'accounts',
  }));

  const updateUserReportUsageLimitResponse = createResponse();
  await routes.patch.get('/api/admin/users/:userId/report-usage-limit')({
    headers,
    params: { userId: managedUser.id },
    body: { limit: 60 },
  }, updateUserReportUsageLimitResponse);
  expect(updateUserReportUsageLimit).toHaveBeenCalledWith({
    userId: managedUser.id,
    limit: 60,
    actorUserId: adminUser.id,
  });
  expect(updateUserReportUsageLimitResponse.payload).toMatchObject({ limit: 60 });
  expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'account.report-usage-limit.updated',
    category: 'accounts',
  }));

  const resetUserUsageResponse = createResponse();
  await routes.post.get('/api/admin/users/:userId/reset-usage')({
    headers,
    params: { userId: managedUser.id },
  }, resetUserUsageResponse);
  expect(resetUserUsage).toHaveBeenCalledWith({
    userId: managedUser.id,
    actorUserId: adminUser.id,
  });
  expect(resetUserUsageResponse.payload).toMatchObject({ resetAI: true, resetReports: true });
  expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'account.usage.reset',
    category: 'accounts',
  }));

  const resetAllUsageResponse = createResponse();
  await routes.post.get('/api/admin/users/reset-usage')({ headers }, resetAllUsageResponse);
  expect(resetAllUserUsage).toHaveBeenCalledWith({ actorUserId: adminUser.id });
  expect(resetAllUsageResponse.payload).toMatchObject({ resetAIAccounts: 2, resetReportAccounts: 2 });
  expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'account.usage.reset-all',
    category: 'accounts',
  }));

  const resetAllUsageLimitsResponse = createResponse();
  await routes.post.get('/api/admin/users/reset-usage-limits')({ headers }, resetAllUsageLimitsResponse);
  expect(resetAllUserUsageLimits).toHaveBeenCalledWith({ actorUserId: adminUser.id });
  expect(resetAllUsageLimitsResponse.payload).toEqual({ resetAIAccounts: 2, resetReportAccounts: 1 });
  expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'account.usage-limits.reset-all',
    category: 'accounts',
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

  const hiddenRuntimeEnvironmentResponse = createResponse();
  await routes.get.get('/api/admin/runtime-environment')({
    headers: { cookie: 'bc_session=other-session-token' },
  }, hiddenRuntimeEnvironmentResponse);
  expect(hiddenRuntimeEnvironmentResponse.statusCode).toBe(404);
  expect(runtimeEnvService.getStatus).toHaveBeenCalledTimes(1);

  const hiddenSchedulerResponse = createResponse();
  await routes.patch.get('/api/admin/objective-watch-scheduler')({
    headers: { cookie: 'bc_session=other-session-token' },
    body: { enabled: false },
  }, hiddenSchedulerResponse);
  expect(hiddenSchedulerResponse.statusCode).toBe(404);
  expect(objectiveWatchScheduler.setEnabled).toHaveBeenCalledTimes(1);

  const hiddenManualSchedulerResponse = createResponse();
  await routes.post.get('/api/admin/objective-watch-scheduler/run')({
    headers: { cookie: 'bc_session=other-session-token' },
  }, hiddenManualSchedulerResponse);
  expect(hiddenManualSchedulerResponse.statusCode).toBe(404);
  expect(objectiveWatchCheckController.runNow).toHaveBeenCalledTimes(1);

  const hiddenBackendRestartResponse = createResponse();
  await routes.post.get('/api/admin/maintenance/backend-restart')({
    headers: { cookie: 'bc_session=other-session-token' },
  }, hiddenBackendRestartResponse);
  expect(hiddenBackendRestartResponse.statusCode).toBe(404);
  expect(backendRestartController.scheduleRestart).toHaveBeenCalledTimes(1);

  const hiddenHealthHistoryResponse = createResponse();
  await routes.get.get('/api/admin/health-monitor-history')({
    headers: { cookie: 'bc_session=other-session-token' },
  }, hiddenHealthHistoryResponse);
  expect(hiddenHealthHistoryResponse.statusCode).toBe(404);
  expect(hiddenHealthHistoryResponse.payload).toEqual({ error: 'Not found' });
  expect(readHealthMonitorHistory).toHaveBeenCalledTimes(1);

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
