const { appDataStore } = require('../db/app-data-store');

const MAX_ADMIN_AUDIT_ENTRIES = 500;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const memoryEntries = [];

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

const trimMemory = () => {
  const recent = memoryEntries.filter(isWithinRetention).slice(-MAX_ADMIN_AUDIT_ENTRIES);
  memoryEntries.splice(0, memoryEntries.length, ...recent);
};

const recordAdminAudit = async ({ action, category, status = 'success', summary, actorIp, details = null }) => {
  const record = {
    timestamp: new Date().toISOString(),
    action: String(action || 'admin.unknown').slice(0, 100),
    category: String(category || 'system').slice(0, 40),
    status: status === 'success' ? 'success' : 'error',
    summary: String(summary || 'Administrative action').slice(0, 240),
    actorNetwork: maskNetwork(actorIp),
    details: details && typeof details === 'object' && !Array.isArray(details) ? details : null,
  };
  if (appDataStore.configured) await appDataStore.insertAdminAudit(record);
  else {
    if (memoryEntries.length >= MAX_ADMIN_AUDIT_ENTRIES) memoryEntries.shift();
    memoryEntries.push(record);
  }
  return record;
};

const getAdminAuditEntries = async () => {
  if (appDataStore.configured) return appDataStore.listAdminAudit();
  trimMemory();
  return [...memoryEntries].reverse();
};

module.exports = { getAdminAuditEntries, maskNetwork, recordAdminAudit };
