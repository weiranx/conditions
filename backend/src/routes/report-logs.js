const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { logger } = require('../utils/logger');
const { getAIUsageEntries } = require('../utils/ai-usage');
const { getAIStatus, updateAISettings } = require('../utils/ai-client');

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
  } catch (err) {
    logger.error({ err }, 'report-logs rewrite failed');
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

const registerReportLogsRoute = (app) => {
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

  app.get('/api/admin/ai-settings', (req, res) => {
    if (!authorize(req, res)) return;
    res.json(getAIStatus());
  });

  app.patch('/api/admin/ai-settings', (req, res) => {
    if (!authorize(req, res)) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.enabled === undefined && body.provider === undefined) {
      res.status(400).json({ error: 'Provide enabled or provider' });
      return;
    }
    try {
      res.json(updateAISettings({ enabled: body.enabled, provider: body.provider }));
    } catch (error) {
      const status = error?.code === 'AI_PROVIDER_NOT_CONFIGURED'
        ? 409
        : error?.code === 'AI_SETTINGS_PERSIST_FAILED'
          ? 500
          : 400;
      res.status(status).json({ error: error instanceof Error ? error.message : 'Invalid AI settings' });
    }
  });
};

module.exports = { logReportRequest, registerReportLogsRoute, isRouteWaypointEntry };
