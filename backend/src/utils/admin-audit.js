const fs = require('node:fs');
const path = require('node:path');
const { logger } = require('./logger');

const MAX_ADMIN_AUDIT_ENTRIES = 500;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const AUDIT_FILE = process.env.ADMIN_AUDIT_FILE
  ? path.resolve(process.env.ADMIN_AUDIT_FILE)
  : process.env.NODE_ENV === 'test'
    ? null
    : path.resolve(__dirname, '../../data/admin-audit.ndjson');

const adminAuditEntries = [];

const maskNetwork = (ip) => {
  if (typeof ip !== 'string' || !ip) return null;
  const normalized = ip.split(',')[0].trim();
  const unwrapped = normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
  if (unwrapped.includes('.') && !unwrapped.includes(':')) {
    const octets = unwrapped.split('.');
    if (octets.length === 4) {
      octets[3] = '0';
      return octets.join('.');
    }
  }
  if (unwrapped.includes(':')) {
    const [head, tail = ''] = unwrapped.split('::');
    const headParts = head ? head.split(':').filter(Boolean) : [];
    const tailParts = unwrapped.includes('::') && tail ? tail.split(':').filter(Boolean) : [];
    const missing = Math.max(0, 8 - headParts.length - tailParts.length);
    const groups = unwrapped.includes('::')
      ? [...headParts, ...Array(missing).fill('0'), ...tailParts]
      : unwrapped.split(':');
    return `${groups.slice(0, 4).join(':')}::`;
  }
  return unwrapped.slice(0, 80);
};

const isWithinRetention = (entry) => {
  const timestamp = new Date(entry?.timestamp).getTime();
  const age = Date.now() - timestamp;
  return Number.isFinite(timestamp) && age >= 0 && age <= RETENTION_MS;
};

const rewriteFile = () => {
  if (!AUDIT_FILE) return true;
  try {
    const content = adminAuditEntries.length
      ? `${adminAuditEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
      : '';
    fs.writeFileSync(AUDIT_FILE, content, { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch (error) {
    logger.error({ err: error }, 'admin-audit rewrite failed');
    return false;
  }
};

const trimOldEntries = () => {
  const before = adminAuditEntries.length;
  if (before === 0) return;
  const recent = adminAuditEntries.filter(isWithinRetention).slice(-MAX_ADMIN_AUDIT_ENTRIES);
  if (recent.length === before) return;
  adminAuditEntries.splice(0, adminAuditEntries.length, ...recent);
  rewriteFile();
};

try {
  if (AUDIT_FILE) {
    fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
    if (fs.existsSync(AUDIT_FILE)) {
      const parsed = fs.readFileSync(AUDIT_FILE, 'utf8')
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        });
      adminAuditEntries.push(...parsed.filter(isWithinRetention).slice(-MAX_ADMIN_AUDIT_ENTRIES));
      if (adminAuditEntries.length !== parsed.length) rewriteFile();
    }
  }
} catch (error) {
  logger.error({ err: error }, 'admin-audit initialization failed');
}

setInterval(trimOldEntries, 24 * 60 * 60 * 1000).unref();

const recordAdminAudit = ({ action, category, status = 'success', summary, actorIp, details = null }) => {
  const record = {
    timestamp: new Date().toISOString(),
    action: String(action || 'admin.unknown').slice(0, 100),
    category: String(category || 'system').slice(0, 40),
    status: status === 'success' ? 'success' : 'error',
    summary: String(summary || 'Administrative action').slice(0, 240),
    actorNetwork: maskNetwork(actorIp),
    details: details && typeof details === 'object' && !Array.isArray(details) ? details : null,
  };
  if (adminAuditEntries.length >= MAX_ADMIN_AUDIT_ENTRIES) adminAuditEntries.shift();
  adminAuditEntries.push(record);
  if (AUDIT_FILE) {
    try {
      fs.appendFileSync(AUDIT_FILE, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch (error) {
      logger.error({ err: error }, 'admin-audit append failed');
    }
  }
  return record;
};

const getAdminAuditEntries = () => {
  trimOldEntries();
  return [...adminAuditEntries].reverse();
};

module.exports = { getAdminAuditEntries, maskNetwork, recordAdminAudit };
