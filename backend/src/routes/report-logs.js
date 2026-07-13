const { appDataStore } = require('../db/app-data-store');
const { logger } = require('../utils/logger');
const { clearAIUsageEntries, getAIUsageEntries } = require('../utils/ai-usage');
const { getAIStatus, updateAISettings } = require('../utils/ai-client');
const { getFeatureFlagStatus, resetFeatureFlags, updateFeatureFlags } = require('../utils/feature-flags');
const { getAdminAuditEntries, recordAdminAudit } = require('../utils/admin-audit');
const { getSystemResources } = require('../utils/system-resources');
const { readSessionToken } = require('./account');
const { validateFreeMonthlyUsageLimit } = require('../auth/monthly-usage-limit');
const { validateMonthlyTokenLimit } = require('../auth/ai-usage-limit');

const ADMIN_ACCOUNT_EMAIL = 'weiranxiong@gmail.com';

const isRouteWaypointEntry = (entry) =>
  typeof entry?.name === 'string' && entry.name.startsWith('Route waypoint:');

// Privacy/retention policy: report-log entries (including the requester IP below) are kept
// for at most 7 days (enforced by the PostgreSQL application data store) and are only
// readable by the signed-in administrator account. Even within that 7-day
// window we don't need precise per-host IPs — coarse network-level buckets are enough for
// abuse detection — so we mask the host portion before it's ever written to memory or disk.
const maskIp = (ip) => {
  if (typeof ip !== 'string' || !ip) return ip;
  // Unwrap IPv4-mapped IPv6 addresses (e.g. "::ffff:203.0.113.42") before classifying.
  const unwrapped = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

  if (unwrapped.includes('.') && !unwrapped.includes(':')) {
    // IPv4: zero the last octet (203.0.113.42 -> 203.0.113.0).
    const octets = unwrapped.split('.');
    if (octets.length === 4) {
      octets[3] = '0';
      return octets.join('.');
    }
    return unwrapped;
  }

  if (unwrapped.includes(':')) {
    // IPv6: truncate to the /64 network prefix (first 4 hextets), zeroing the host portion.
    const [head, tail = ''] = unwrapped.split('::');
    const headParts = head ? head.split(':').filter(Boolean) : [];
    const tailParts = unwrapped.includes('::') && tail ? tail.split(':').filter(Boolean) : [];
    const missing = Math.max(0, 8 - headParts.length - tailParts.length);
    const fullGroups = unwrapped.includes('::')
      ? [...headParts, ...Array(missing).fill('0'), ...tailParts]
      : unwrapped.split(':');
    const prefixGroups = fullGroups.slice(0, 4);
    return `${prefixGroups.join(':')}::`;
  }

  return ip;
};

const memoryReportLogs = [];

const logReportRequest = async (entry) => {
  if (!entry.name || isRouteWaypointEntry(entry)) return;
  const record = { ...entry, ip: maskIp(entry.ip), timestamp: new Date().toISOString() };
  if (appDataStore.configured) await appDataStore.insertReportActivity(record);
  else {
    if (memoryReportLogs.length >= 500) memoryReportLogs.shift();
    memoryReportLogs.push(record);
  }
  return record;
};

const getReportLogs = async () => {
  if (appDataStore.configured) return appDataStore.listReportActivity();
  return [...memoryReportLogs].reverse();
};

const clearReportLogs = async () => {
  if (appDataStore.configured) return appDataStore.clearReportActivity();
  const cleared = memoryReportLogs.length;
  memoryReportLogs.splice(0);
  return cleared;
};

const isAdminAccount = (user) => (
  typeof user?.email === 'string'
  && user.email.trim().toLowerCase() === ADMIN_ACCOUNT_EMAIL
);

const getUserManagementError = (error, fallback) => {
  if (error?.code === 'ACCOUNT_NOT_FOUND') return { status: 404, message: error.message };
  if (error?.code === 'ADMIN_SELF_MODIFICATION') return { status: 409, message: error.message };
  if (
    error?.code === 'INVALID_ACCOUNT_ID'
    || error?.code === 'INVALID_ACCOUNT_STATUS'
    || error?.code === 'INVALID_ACCOUNT_TIER'
    || error?.code === 'INVALID_USAGE_LIMIT'
    || error?.code === 'INVALID_AI_USAGE_LIMIT'
  ) {
    return { status: 400, message: error.message };
  }
  if (error?.code === 'ACCOUNT_DATABASE_UNAVAILABLE') {
    return { status: 503, message: 'Account management is temporarily unavailable.' };
  }
  return { status: 500, message: fallback };
};

const registerReportLogsRoute = (
  app,
  {
    accountService = null,
    usageService = null,
    reportUsageService = null,
    caches = [],
    runDiagnostics = null,
    loadModelCatalog = null,
    readSystemResources = getSystemResources,
  } = {},
) => {
  let diagnosticsInFlight = null;
  const audit = async (req, event) => {
    try {
      await recordAdminAudit({
        ...event,
        actorIp: req.headers['x-forwarded-for'] ?? req.ip ?? req.socket?.remoteAddress ?? null,
      });
    } catch (error) {
      logger.error({ err: error, action: event.action }, 'Admin audit event could not be persisted');
    }
  };
  const authorize = async (req, res) => {
    let accountUser = null;
    try {
      if (accountService?.available && typeof accountService.getUserForSession === 'function') {
        accountUser = await accountService.getUserForSession(readSessionToken(req));
      }
    } catch (error) {
      req.log?.warn({ err: error }, 'Admin account authorization failed');
    }
    if (!isAdminAccount(accountUser)) {
      res.status(404).json({ error: 'Not found' });
      return null;
    }
    return accountUser;
  };

  app.get('/api/report-logs', async (req, res) => {
    if (!await authorize(req, res)) return;
    const entries = await getReportLogs();
    res.json(entries.filter((entry) => !isRouteWaypointEntry(entry)));
  });

  app.get('/api/ai-usage', async (req, res) => {
    if (!await authorize(req, res)) return;
    res.json(await getAIUsageEntries());
  });

  app.get('/api/admin/audit-log', async (req, res) => {
    if (!await authorize(req, res)) return;
    res.json(await getAdminAuditEntries());
  });

  app.get('/api/admin/system-resources', async (req, res) => {
    if (!await authorize(req, res)) return;
    try {
      res.json(await readSystemResources());
    } catch {
      res.status(500).json({ error: 'System resource usage is unavailable' });
    }
  });

  app.get('/api/admin/users', async (req, res) => {
    if (!await authorize(req, res)) return;
    if (typeof accountService?.listUsers !== 'function') {
      res.status(503).json({ error: 'Account management is temporarily unavailable.' });
      return;
    }
    try {
      const directory = await accountService.listUsers({ limit: req.query?.limit });
      res.json({
        ...directory,
        users: directory.users.map((user) => ({ ...user, isOwner: isAdminAccount(user) })),
      });
    } catch (error) {
      req.log?.error({ err: error }, 'Admin user directory could not be loaded');
      const failure = getUserManagementError(error, 'Account directory could not be loaded.');
      res.status(failure.status).json({ error: failure.message });
    }
  });

  const sendUsageSettings = async (req, res) => {
    if (!await authorize(req, res)) return;
    if (
      typeof usageService?.getSettings !== 'function'
      || typeof reportUsageService?.getSettings !== 'function'
    ) {
      res.status(503).json({ error: 'Usage limits are temporarily unavailable.' });
      return;
    }
    const aiSettings = usageService.getSettings();
    const reportSettings = reportUsageService.getSettings();
    res.json({
      ...aiSettings,
      ...reportSettings,
      persistent: Boolean(aiSettings.persistent && reportSettings.persistent),
    });
  };

  const updateUsageSettings = async (req, res) => {
    if (!await authorize(req, res)) return;
    const updateAI = req.body?.freeMonthlyAITokenLimit !== undefined;
    const updateReports = req.body?.freeMonthlyReportUsageLimit !== undefined;
    if (!updateAI && !updateReports) {
      res.status(400).json({ error: 'Provide an AI usage limit or generated report limit.' });
      return;
    }
    if (
      (updateAI && typeof usageService?.updateSettings !== 'function')
      || (updateReports && typeof reportUsageService?.updateSettings !== 'function')
    ) {
      res.status(503).json({ error: 'Usage limits are temporarily unavailable.' });
      return;
    }
    try {
      const validatedAILimit = updateAI
        ? validateMonthlyTokenLimit(req.body.freeMonthlyAITokenLimit)
        : null;
      const validatedReportLimit = updateReports
        ? validateFreeMonthlyUsageLimit(req.body.freeMonthlyReportUsageLimit)
        : null;
      if (updateAI) {
        await usageService.updateSettings({ freeMonthlyAITokenLimit: validatedAILimit });
      }
      if (updateReports) {
        await reportUsageService.updateSettings({ freeMonthlyReportUsageLimit: validatedReportLimit });
      }
      const aiSettings = usageService.getSettings();
      const reportSettings = reportUsageService.getSettings();
      const updated = {
        ...aiSettings,
        ...reportSettings,
        persistent: Boolean(aiSettings.persistent && reportSettings.persistent),
      };
      await audit(req, {
        action: 'usage.limits.updated',
        category: 'configuration',
        summary: `Changed the default Free monthly ${[updateAI ? 'AI usage' : null, updateReports ? 'generated report' : null].filter(Boolean).join(' and ')} limit${updateAI && updateReports ? 's' : ''}`,
        details: {
          freeMonthlyAITokenLimit: updated.freeMonthlyAITokenLimit,
          freeMonthlyReportUsageLimit: updated.freeMonthlyReportUsageLimit,
        },
      });
      res.json(updated);
    } catch (error) {
      const status = error?.code === 'INVALID_USAGE_LIMIT' || error?.code === 'INVALID_AI_USAGE_LIMIT'
        ? 400
        : 500;
      const message = error instanceof Error ? error.message : 'Usage limits could not be updated.';
      await audit(req, {
        action: 'usage.limits.update-failed',
        category: 'configuration',
        status: 'error',
        summary: message,
      });
      res.status(status).json({ error: message });
    }
  };

  app.get('/api/admin/usage-settings', sendUsageSettings);
  app.patch('/api/admin/usage-settings', updateUsageSettings);
  app.get('/api/admin/ai-usage-settings', sendUsageSettings);
  app.patch('/api/admin/ai-usage-settings', updateUsageSettings);

  app.patch('/api/admin/users/:userId', async (req, res) => {
    const adminUser = await authorize(req, res);
    if (!adminUser) return;
    if (typeof accountService?.updateUserStatus !== 'function') {
      res.status(503).json({ error: 'Account management is temporarily unavailable.' });
      return;
    }
    try {
      const result = await accountService.updateUserStatus({
        userId: req.params?.userId,
        status: req.body?.status,
        actorUserId: adminUser.id,
      });
      const targetName = result.user.displayName || result.user.email || 'account';
      await audit(req, {
        action: result.user.status === 'suspended' ? 'account.user.suspended' : 'account.user.reactivated',
        category: 'accounts',
        summary: `${result.user.status === 'suspended' ? 'Suspended' : 'Reactivated'} ${targetName}`,
        details: {
          targetUserId: result.user.id,
          targetEmail: result.user.email,
          status: result.user.status,
          revokedSessions: result.revokedSessions,
        },
      });
      res.json(result);
    } catch (error) {
      const failure = getUserManagementError(error, 'Account status could not be updated.');
      if (failure.status === 500) req.log?.error({ err: error }, 'Admin account status update failed');
      await audit(req, {
        action: 'account.user.status-update-failed',
        category: 'accounts',
        status: 'error',
        summary: failure.message,
        details: { targetUserId: req.params?.userId ?? null },
      });
      res.status(failure.status).json({ error: failure.message });
    }
  });

  app.patch('/api/admin/users/:userId/tier', async (req, res) => {
    const adminUser = await authorize(req, res);
    if (!adminUser) return;
    if (typeof accountService?.updateUserTier !== 'function') {
      res.status(503).json({ error: 'Account management is temporarily unavailable.' });
      return;
    }
    try {
      const result = await accountService.updateUserTier({
        userId: req.params?.userId,
        tier: req.body?.tier,
        actorUserId: adminUser.id,
      });
      const targetName = result.user.displayName || result.user.email || 'account';
      await audit(req, {
        action: 'account.user.tier-updated',
        category: 'accounts',
        summary: `Changed ${targetName} to ${result.tier === 'premium' ? 'Premium' : 'Free'}`,
        details: {
          targetUserId: result.user.id,
          targetEmail: result.user.email,
          tier: result.tier,
        },
      });
      res.json(result);
    } catch (error) {
      const failure = getUserManagementError(error, 'Account tier could not be updated.');
      if (failure.status === 500) req.log?.error({ err: error }, 'Admin account tier update failed');
      await audit(req, {
        action: 'account.user.tier-update-failed',
        category: 'accounts',
        status: 'error',
        summary: failure.message,
        details: { targetUserId: req.params?.userId ?? null },
      });
      res.status(failure.status).json({ error: failure.message });
    }
  });

  app.patch('/api/admin/users/:userId/usage-limit', async (req, res) => {
    const adminUser = await authorize(req, res);
    if (!adminUser) return;
    if (typeof accountService?.updateUserUsageLimit !== 'function') {
      res.status(503).json({ error: 'Account usage limits are temporarily unavailable.' });
      return;
    }
    try {
      const result = await accountService.updateUserUsageLimit({
        userId: req.params?.userId,
        limit: req.body?.limit,
        actorUserId: adminUser.id,
      });
      const targetName = result.user.displayName || result.user.email || 'account';
      await audit(req, {
        action: 'account.usage-limit.updated',
        category: 'accounts',
        summary: result.limit === null
          ? `Restored the default AI usage limit for ${targetName}`
          : `Changed ${targetName}'s monthly AI usage limit to ${result.limit.toLocaleString()} tokens`,
        details: {
          targetUserId: result.user.id,
          targetEmail: result.user.email,
          limit: result.limit,
        },
      });
      res.json(result);
    } catch (error) {
      const failure = getUserManagementError(error, 'Account usage limit could not be updated.');
      if (failure.status === 500) req.log?.error({ err: error }, 'Admin account usage limit update failed');
      await audit(req, {
        action: 'account.usage-limit.update-failed',
        category: 'accounts',
        status: 'error',
        summary: failure.message,
        details: { targetUserId: req.params?.userId ?? null },
      });
      res.status(failure.status).json({ error: failure.message });
    }
  });

  app.patch('/api/admin/users/:userId/report-usage-limit', async (req, res) => {
    const adminUser = await authorize(req, res);
    if (!adminUser) return;
    if (typeof accountService?.updateUserReportUsageLimit !== 'function') {
      res.status(503).json({ error: 'Account generated report limits are temporarily unavailable.' });
      return;
    }
    try {
      const result = await accountService.updateUserReportUsageLimit({
        userId: req.params?.userId,
        limit: req.body?.limit,
        actorUserId: adminUser.id,
      });
      const targetName = result.user.displayName || result.user.email || 'account';
      await audit(req, {
        action: 'account.report-usage-limit.updated',
        category: 'accounts',
        summary: result.limit === null
          ? `Restored the default generated report limit for ${targetName}`
          : `Changed ${targetName}'s monthly generated report limit to ${result.limit.toLocaleString()}`,
        details: {
          targetUserId: result.user.id,
          targetEmail: result.user.email,
          limit: result.limit,
        },
      });
      res.json(result);
    } catch (error) {
      const failure = getUserManagementError(error, 'Account generated report limit could not be updated.');
      if (failure.status === 500) req.log?.error({ err: error }, 'Admin account generated report limit update failed');
      await audit(req, {
        action: 'account.report-usage-limit.update-failed',
        category: 'accounts',
        status: 'error',
        summary: failure.message,
        details: { targetUserId: req.params?.userId ?? null },
      });
      res.status(failure.status).json({ error: failure.message });
    }
  });

  app.post('/api/admin/users/:userId/reset-usage', async (req, res) => {
    const adminUser = await authorize(req, res);
    if (!adminUser) return;
    if (typeof accountService?.resetUserUsage !== 'function') {
      res.status(503).json({ error: 'Account usage is temporarily unavailable.' });
      return;
    }
    try {
      const result = await accountService.resetUserUsage({
        userId: req.params?.userId,
        actorUserId: adminUser.id,
      });
      const targetName = result.user.displayName || result.user.email || 'account';
      await audit(req, {
        action: 'account.usage.reset',
        category: 'accounts',
        summary: `Reset ${targetName}'s monthly usage`,
        details: {
          targetUserId: result.user.id,
          targetEmail: result.user.email,
          resetAI: result.resetAI,
          resetReports: result.resetReports,
          periodStart: result.periodStart,
          periodEnd: result.periodEnd,
        },
      });
      res.json(result);
    } catch (error) {
      const failure = getUserManagementError(error, 'Account usage could not be reset.');
      if (failure.status === 500) req.log?.error({ err: error }, 'Admin account usage reset failed');
      await audit(req, {
        action: 'account.usage.reset-failed',
        category: 'accounts',
        status: 'error',
        summary: failure.message,
        details: { targetUserId: req.params?.userId ?? null },
      });
      res.status(failure.status).json({ error: failure.message });
    }
  });

  app.post('/api/admin/users/reset-usage', async (req, res) => {
    const adminUser = await authorize(req, res);
    if (!adminUser) return;
    if (typeof accountService?.resetAllUserUsage !== 'function') {
      res.status(503).json({ error: 'Account usage is temporarily unavailable.' });
      return;
    }
    try {
      const result = await accountService.resetAllUserUsage({ actorUserId: adminUser.id });
      await audit(req, {
        action: 'account.usage.reset-all',
        category: 'accounts',
        summary: 'Reset monthly usage for every account',
        details: {
          resetAIAccounts: result.resetAIAccounts,
          resetReportAccounts: result.resetReportAccounts,
          periodStart: result.periodStart,
          periodEnd: result.periodEnd,
        },
      });
      res.json(result);
    } catch (error) {
      const failure = getUserManagementError(error, 'Account usage could not be reset.');
      if (failure.status === 500) req.log?.error({ err: error }, 'Admin all-account usage reset failed');
      await audit(req, {
        action: 'account.usage.reset-all-failed',
        category: 'accounts',
        status: 'error',
        summary: failure.message,
      });
      res.status(failure.status).json({ error: failure.message });
    }
  });

  app.post('/api/admin/users/reset-usage-limits', async (req, res) => {
    const adminUser = await authorize(req, res);
    if (!adminUser) return;
    if (typeof accountService?.resetAllUserUsageLimits !== 'function') {
      res.status(503).json({ error: 'Account usage limits are temporarily unavailable.' });
      return;
    }
    try {
      const result = await accountService.resetAllUserUsageLimits({ actorUserId: adminUser.id });
      await audit(req, {
        action: 'account.usage-limits.reset-all',
        category: 'accounts',
        summary: 'Restored default AI and generated report limits for every account',
        details: result,
      });
      res.json(result);
    } catch (error) {
      const failure = getUserManagementError(error, 'Account usage limits could not be reset.');
      if (failure.status === 500) req.log?.error({ err: error }, 'Admin all-account usage limit reset failed');
      await audit(req, {
        action: 'account.usage-limits.reset-all-failed',
        category: 'accounts',
        status: 'error',
        summary: failure.message,
      });
      res.status(failure.status).json({ error: failure.message });
    }
  });

  app.post('/api/admin/users/:userId/revoke-sessions', async (req, res) => {
    const adminUser = await authorize(req, res);
    if (!adminUser) return;
    if (typeof accountService?.revokeUserSessions !== 'function') {
      res.status(503).json({ error: 'Account management is temporarily unavailable.' });
      return;
    }
    try {
      const result = await accountService.revokeUserSessions({
        userId: req.params?.userId,
        actorUserId: adminUser.id,
      });
      const targetName = result.user.displayName || result.user.email || 'account';
      await audit(req, {
        action: 'account.sessions.revoked',
        category: 'accounts',
        summary: `Signed out ${targetName} from ${result.revokedSessions} ${result.revokedSessions === 1 ? 'session' : 'sessions'}`,
        details: {
          targetUserId: result.user.id,
          targetEmail: result.user.email,
          revokedSessions: result.revokedSessions,
        },
      });
      res.json(result);
    } catch (error) {
      const failure = getUserManagementError(error, 'Account sessions could not be revoked.');
      if (failure.status === 500) req.log?.error({ err: error }, 'Admin account session revocation failed');
      await audit(req, {
        action: 'account.sessions.revoke-failed',
        category: 'accounts',
        status: 'error',
        summary: failure.message,
        details: { targetUserId: req.params?.userId ?? null },
      });
      res.status(failure.status).json({ error: failure.message });
    }
  });

  app.get('/api/admin/ai-settings', async (req, res) => {
    if (!await authorize(req, res)) return;
    res.json(getAIStatus());
  });

  app.patch('/api/admin/ai-settings', async (req, res) => {
    if (!await authorize(req, res)) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.enabled === undefined && body.provider === undefined && body.features === undefined && body.models === undefined) {
      res.status(400).json({ error: 'Provide enabled, provider, features, or models' });
      return;
    }
    try {
      const updated = await updateAISettings({
        enabled: body.enabled,
        provider: body.provider,
        features: body.features,
        models: body.models,
      });
      const changed = ['enabled', 'provider', 'features', 'models'].filter((key) => body[key] !== undefined);
      await audit(req, {
        action: 'ai.settings.updated',
        category: 'configuration',
        summary: `Updated AI ${changed.join(', ')}`,
        details: { changed, enabled: updated.enabled, provider: updated.provider },
      });
      res.json(updated);
    } catch (error) {
      const status = error?.code === 'AI_PROVIDER_NOT_CONFIGURED'
        ? 409
        : error?.code === 'AI_SETTINGS_PERSIST_FAILED'
          ? 500
          : 400;
      const message = error instanceof Error ? error.message : 'Invalid AI settings';
      await audit(req, {
        action: 'ai.settings.updated',
        category: 'configuration',
        status: 'error',
        summary: message,
      });
      res.status(status).json({ error: message });
    }
  });

  const sendModelCatalog = async (req, res, force = false) => {
    if (!await authorize(req, res)) return;
    if (typeof loadModelCatalog !== 'function') {
      res.status(503).json({ error: 'AI model catalog is unavailable' });
      return;
    }
    try {
      const catalog = await loadModelCatalog({ force });
      if (force) {
        await audit(req, {
          action: 'ai.models.refreshed',
          category: 'diagnostics',
          summary: 'Refreshed AI provider model catalogs',
        });
      }
      res.json(catalog);
    } catch (error) {
      if (force) {
        await audit(req, {
          action: 'ai.models.refreshed',
          category: 'diagnostics',
          status: 'error',
          summary: 'AI provider model catalogs could not be refreshed',
        });
      }
      res.status(502).json({ error: 'AI model catalog could not be loaded' });
    }
  };

  app.get('/api/admin/ai-models', (req, res) => sendModelCatalog(req, res));
  app.post('/api/admin/ai-models/refresh', (req, res) => sendModelCatalog(req, res, true));

  app.get('/api/admin/feature-flags', async (req, res) => {
    if (!await authorize(req, res)) return;
    res.json(getFeatureFlagStatus());
  });

  app.patch('/api/admin/feature-flags', async (req, res) => {
    if (!await authorize(req, res)) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      const updated = await updateFeatureFlags(body.flags);
      const changed = body.flags && typeof body.flags === 'object' ? Object.keys(body.flags) : [];
      await audit(req, {
        action: 'product.flags.updated',
        category: 'configuration',
        summary: `Updated product feature ${changed.length === 1 ? 'flag' : 'flags'}: ${changed.join(', ') || 'none'}`,
        details: { changed },
      });
      res.json(updated);
    } catch (error) {
      const status = error?.code === 'FEATURE_FLAGS_PERSIST_FAILED' ? 500 : 400;
      const message = error instanceof Error ? error.message : 'Invalid feature flags';
      await audit(req, {
        action: 'product.flags.updated',
        category: 'configuration',
        status: 'error',
        summary: message,
      });
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/admin/maintenance/report-logs', async (req, res) => {
    if (!await authorize(req, res)) return;
    try {
      const cleared = await clearReportLogs();
      await audit(req, {
        action: 'maintenance.report-logs.cleared',
        category: 'maintenance',
        summary: `Cleared ${cleared} report log ${cleared === 1 ? 'entry' : 'entries'}`,
        details: { cleared },
      });
      res.json({ cleared });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Report activity could not be cleared';
      await audit(req, { action: 'maintenance.report-logs.cleared', category: 'maintenance', status: 'error', summary: message });
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/admin/maintenance/ai-usage', async (req, res) => {
    if (!await authorize(req, res)) return;
    try {
      const cleared = await clearAIUsageEntries();
      await audit(req, {
        action: 'maintenance.ai-usage.cleared',
        category: 'maintenance',
        summary: `Cleared ${cleared} AI usage ${cleared === 1 ? 'entry' : 'entries'}`,
        details: { cleared },
      });
      res.json({ cleared });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI usage history could not be cleared';
      await audit(req, { action: 'maintenance.ai-usage.cleared', category: 'maintenance', status: 'error', summary: message });
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/admin/maintenance/caches', async (req, res) => {
    if (!await authorize(req, res)) return;
    const cleared = caches.flatMap((cache) => {
      if (!cache || typeof cache.clear !== 'function') return [];
      const stats = typeof cache.stats === 'function' ? cache.stats() : null;
      cache.clear();
      return [stats?.name || 'unnamed-cache'];
    });
    await audit(req, {
      action: 'maintenance.caches.cleared',
      category: 'maintenance',
      summary: `Cleared ${cleared.length} backend ${cleared.length === 1 ? 'cache' : 'caches'}`,
      details: { caches: cleared },
    });
    res.json({ cleared, count: cleared.length });
  });

  app.post('/api/admin/maintenance/feature-flags', async (req, res) => {
    if (!await authorize(req, res)) return;
    try {
      const updated = await resetFeatureFlags();
      await audit(req, {
        action: 'maintenance.feature-flags.restored',
        category: 'maintenance',
        summary: 'Restored product feature flags to defaults',
      });
      res.json(updated);
    } catch (error) {
      const status = error?.code === 'FEATURE_FLAGS_PERSIST_FAILED' ? 500 : 400;
      const message = error instanceof Error ? error.message : 'Feature flags could not be reset';
      await audit(req, { action: 'maintenance.feature-flags.restored', category: 'maintenance', status: 'error', summary: message });
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/admin/diagnostics', async (req, res) => {
    if (!await authorize(req, res)) return;
    if (typeof runDiagnostics !== 'function') {
      res.status(503).json({ error: 'External diagnostics are unavailable' });
      return;
    }
    try {
      if (!diagnosticsInFlight) {
        diagnosticsInFlight = Promise.resolve()
          .then(() => runDiagnostics())
          .finally(() => { diagnosticsInFlight = null; });
      }
      const result = await diagnosticsInFlight;
      await audit(req, {
        action: 'diagnostics.external.completed',
        category: 'diagnostics',
        status: result?.summary?.failed > 0 ? 'error' : 'success',
        summary: result?.summary?.failed > 0
          ? `External diagnostics completed with ${result.summary.failed} failed service checks`
          : 'External diagnostics completed successfully',
        details: result?.summary ?? null,
      });
      res.json(result);
    } catch {
      await audit(req, {
        action: 'diagnostics.external.completed',
        category: 'diagnostics',
        status: 'error',
        summary: 'External diagnostics could not be completed',
      });
      res.status(502).json({ error: 'External diagnostics could not be completed' });
    }
  });
};

module.exports = {
  clearReportLogs,
  isAdminAccount,
  isRouteWaypointEntry,
  logReportRequest,
  registerReportLogsRoute,
};
