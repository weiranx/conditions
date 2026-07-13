const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { logger } = require('../utils/logger');
const { clearAIUsageEntries, getAIUsageEntries } = require('../utils/ai-usage');
const { getAIStatus, updateAISettings } = require('../utils/ai-client');
const { getFeatureFlagStatus, resetFeatureFlags, updateFeatureFlags } = require('../utils/feature-flags');
const { getAdminAuditEntries, recordAdminAudit } = require('../utils/admin-audit');

const MAX_LOG_ENTRIES = 500;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const LOG_FILE = path.resolve(__dirname, '../../data/report-logs.ndjson');

const reportLogs = [];

const isRouteWaypointEntry = (entry) =>
  typeof entry?.name === 'string' && entry.name.startsWith('Route waypoint:');

// Privacy/retention policy: report-log entries (including the requester IP below) are kept
// for at most 7 days (ONE_WEEK_MS, enforced by isWithinOneWeek/trimOldEntries) and are only
// readable via the bearer-secret-gated /api/report-logs endpoint. Even within that 7-day
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

const isWithinOneWeek = (entry) =>
  Date.now() - new Date(entry.timestamp).getTime() <= ONE_WEEK_MS;

const rewriteFile = () => {
  try {
    const content = reportLogs.length
      ? reportLogs.map((r) => JSON.stringify(r)).join('\n') + '\n'
      : '';
    fs.writeFileSync(LOG_FILE, content, 'utf8');
    return true;
  } catch (err) {
    logger.error({ err }, 'report-logs rewrite failed');
    return false;
  }
};

const trimOldEntries = () => {
  const before = reportLogs.length;
  if (before === 0) return;
  const firstRecent = reportLogs.findIndex(isWithinOneWeek);
  if (firstRecent === -1) {
    reportLogs.splice(0);
  } else if (firstRecent > 0) {
    reportLogs.splice(0, firstRecent);
  }
  if (reportLogs.length !== before) rewriteFile();
};

// Ensure data directory exists
try {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
} catch (err) {
  logger.error({ err }, 'report-logs mkdir failed');
}
logger.info({ file: LOG_FILE }, 'report-logs initialized');

// Load existing logs on startup — filter to last week, rewrite file if any were pruned
try {
  if (fs.existsSync(LOG_FILE)) {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
    const parsed = lines.flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
    const recent = parsed
      .filter((entry) => isWithinOneWeek(entry) && !isRouteWaypointEntry(entry))
      .slice(-MAX_LOG_ENTRIES);
    reportLogs.push(...recent);
    if (recent.length !== parsed.length) rewriteFile();
  }
} catch (err) {
  logger.error({ err }, 'report-logs load failed');
}

// Daily trim to evict entries that aged out during a long-running process
setInterval(trimOldEntries, 24 * 60 * 60 * 1000).unref();

const logReportRequest = (entry) => {
  if (!entry.name || isRouteWaypointEntry(entry)) return;
  const record = { ...entry, ip: maskIp(entry.ip), timestamp: new Date().toISOString() };
  if (reportLogs.length >= MAX_LOG_ENTRIES) reportLogs.shift();
  reportLogs.push(record);
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    logger.error({ err }, 'report-logs append failed');
  }
};

const clearReportLogs = () => {
  const previous = [...reportLogs];
  reportLogs.splice(0);
  if (!rewriteFile()) {
    reportLogs.push(...previous);
    const error = new Error('Report activity could not be cleared');
    error.code = 'REPORT_LOGS_CLEAR_FAILED';
    throw error;
  }
  return previous.length;
};

const LOGS_SECRET = process.env.LOGS_SECRET || '';

// Constant-time secret comparison — avoids leaking timing information that could help an
// attacker brute-force LOGS_SECRET one byte at a time. Buffers must be equal length for
// timingSafeEqual, so unequal lengths fail closed without ever calling it.
const secretsMatch = (provided, expected) => {
  const providedBuf = Buffer.from(String(provided || ''), 'utf8');
  const expectedBuf = Buffer.from(String(expected || ''), 'utf8');
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
};

const registerReportLogsRoute = (app, { caches = [], runDiagnostics = null, loadModelCatalog = null } = {}) => {
  let diagnosticsInFlight = null;
  const audit = (req, event) => recordAdminAudit({
    ...event,
    actorIp: req.headers['x-forwarded-for'] ?? req.ip ?? req.socket?.remoteAddress ?? null,
  });
  const authorize = (req, res) => {
    if (!LOGS_SECRET) {
      res.status(403).json({ error: 'Logs endpoint disabled — LOGS_SECRET not configured' });
      return false;
    }
    const auth = req.headers['authorization'] ?? '';
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!secretsMatch(provided, LOGS_SECRET)) {
      res.status(401).json({ error: 'Unauthorized' });
      return false;
    }
    return true;
  };

  app.get('/api/report-logs', (req, res) => {
    if (!authorize(req, res)) return;
    res.json(reportLogs.filter((entry) => !isRouteWaypointEntry(entry)).reverse());
  });

  app.get('/api/ai-usage', (req, res) => {
    if (!authorize(req, res)) return;
    res.json(getAIUsageEntries());
  });

  app.get('/api/admin/audit-log', (req, res) => {
    if (!authorize(req, res)) return;
    res.json(getAdminAuditEntries());
  });

  app.get('/api/admin/ai-settings', (req, res) => {
    if (!authorize(req, res)) return;
    res.json(getAIStatus());
  });

  app.patch('/api/admin/ai-settings', (req, res) => {
    if (!authorize(req, res)) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.enabled === undefined && body.provider === undefined && body.features === undefined && body.models === undefined) {
      res.status(400).json({ error: 'Provide enabled, provider, features, or models' });
      return;
    }
    try {
      const updated = updateAISettings({
        enabled: body.enabled,
        provider: body.provider,
        features: body.features,
        models: body.models,
      });
      const changed = ['enabled', 'provider', 'features', 'models'].filter((key) => body[key] !== undefined);
      audit(req, {
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
      audit(req, {
        action: 'ai.settings.updated',
        category: 'configuration',
        status: 'error',
        summary: message,
      });
      res.status(status).json({ error: message });
    }
  });

  const sendModelCatalog = async (req, res, force = false) => {
    if (!authorize(req, res)) return;
    if (typeof loadModelCatalog !== 'function') {
      res.status(503).json({ error: 'AI model catalog is unavailable' });
      return;
    }
    try {
      const catalog = await loadModelCatalog({ force });
      if (force) {
        audit(req, {
          action: 'ai.models.refreshed',
          category: 'diagnostics',
          summary: 'Refreshed AI provider model catalogs',
        });
      }
      res.json(catalog);
    } catch (error) {
      if (force) {
        audit(req, {
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

  app.get('/api/admin/feature-flags', (req, res) => {
    if (!authorize(req, res)) return;
    res.json(getFeatureFlagStatus());
  });

  app.patch('/api/admin/feature-flags', (req, res) => {
    if (!authorize(req, res)) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      const updated = updateFeatureFlags(body.flags);
      const changed = body.flags && typeof body.flags === 'object' ? Object.keys(body.flags) : [];
      audit(req, {
        action: 'product.flags.updated',
        category: 'configuration',
        summary: `Updated product feature ${changed.length === 1 ? 'flag' : 'flags'}: ${changed.join(', ') || 'none'}`,
        details: { changed },
      });
      res.json(updated);
    } catch (error) {
      const status = error?.code === 'FEATURE_FLAGS_PERSIST_FAILED' ? 500 : 400;
      const message = error instanceof Error ? error.message : 'Invalid feature flags';
      audit(req, {
        action: 'product.flags.updated',
        category: 'configuration',
        status: 'error',
        summary: message,
      });
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/admin/maintenance/report-logs', (req, res) => {
    if (!authorize(req, res)) return;
    try {
      const cleared = clearReportLogs();
      audit(req, {
        action: 'maintenance.report-logs.cleared',
        category: 'maintenance',
        summary: `Cleared ${cleared} report log ${cleared === 1 ? 'entry' : 'entries'}`,
        details: { cleared },
      });
      res.json({ cleared });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Report activity could not be cleared';
      audit(req, { action: 'maintenance.report-logs.cleared', category: 'maintenance', status: 'error', summary: message });
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/admin/maintenance/ai-usage', (req, res) => {
    if (!authorize(req, res)) return;
    try {
      const cleared = clearAIUsageEntries();
      audit(req, {
        action: 'maintenance.ai-usage.cleared',
        category: 'maintenance',
        summary: `Cleared ${cleared} AI usage ${cleared === 1 ? 'entry' : 'entries'}`,
        details: { cleared },
      });
      res.json({ cleared });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI usage history could not be cleared';
      audit(req, { action: 'maintenance.ai-usage.cleared', category: 'maintenance', status: 'error', summary: message });
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/admin/maintenance/caches', (req, res) => {
    if (!authorize(req, res)) return;
    const cleared = caches.flatMap((cache) => {
      if (!cache || typeof cache.clear !== 'function') return [];
      const stats = typeof cache.stats === 'function' ? cache.stats() : null;
      cache.clear();
      return [stats?.name || 'unnamed-cache'];
    });
    audit(req, {
      action: 'maintenance.caches.cleared',
      category: 'maintenance',
      summary: `Cleared ${cleared.length} backend ${cleared.length === 1 ? 'cache' : 'caches'}`,
      details: { caches: cleared },
    });
    res.json({ cleared, count: cleared.length });
  });

  app.post('/api/admin/maintenance/feature-flags', (req, res) => {
    if (!authorize(req, res)) return;
    try {
      const updated = resetFeatureFlags();
      audit(req, {
        action: 'maintenance.feature-flags.restored',
        category: 'maintenance',
        summary: 'Restored product feature flags to defaults',
      });
      res.json(updated);
    } catch (error) {
      const status = error?.code === 'FEATURE_FLAGS_PERSIST_FAILED' ? 500 : 400;
      const message = error instanceof Error ? error.message : 'Feature flags could not be reset';
      audit(req, { action: 'maintenance.feature-flags.restored', category: 'maintenance', status: 'error', summary: message });
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/admin/diagnostics', async (req, res) => {
    if (!authorize(req, res)) return;
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
      audit(req, {
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
      audit(req, {
        action: 'diagnostics.external.completed',
        category: 'diagnostics',
        status: 'error',
        summary: 'External diagnostics could not be completed',
      });
      res.status(502).json({ error: 'External diagnostics could not be completed' });
    }
  });
};

module.exports = { clearReportLogs, logReportRequest, registerReportLogsRoute, isRouteWaypointEntry };
