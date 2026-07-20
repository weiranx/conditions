const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { database } = require('../db/database');

const DEFAULT_APP_DATA_PATH = path.resolve(__dirname, '../../data');

const usageSnapshot = (totalBytes, freeBytes, availableBytes = freeBytes) => {
  const total = Math.max(0, Number(totalBytes) || 0);
  const free = Math.min(total, Math.max(0, Number(freeBytes) || 0));
  const available = Math.min(total, Math.max(0, Number(availableBytes) || 0));
  const used = Math.max(0, total - free);

  return {
    totalBytes: total,
    usedBytes: used,
    freeBytes: free,
    availableBytes: available,
    usagePercent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
  };
};

const getDirectorySize = async (directoryPath, { readdir = fs.readdir } = {}) => {
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return null;
  }

  const sizes = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) return getDirectorySize(entryPath, { readdir });
    if (!entry.isFile()) return 0;
    try {
      const stats = await fs.stat(entryPath);
      return Math.max(0, Number(stats.size) || 0);
    } catch {
      return 0;
    }
  }));

  return sizes.reduce((total, size) => total + (size ?? 0), 0);
};

const getDatabaseSize = async (databaseClient = database) => {
  if (!databaseClient?.configured || typeof databaseClient.query !== 'function') return null;
  try {
    const result = await databaseClient.query('SELECT pg_database_size(current_database()) AS bytes');
    const bytes = Number(result?.rows?.[0]?.bytes);
    return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
  } catch {
    return null;
  }
};

const getSystemResources = async ({
  diskPath = process.env.ADMIN_DISK_PATH || process.cwd(),
  appDataPath = process.env.ADMIN_APP_STORAGE_PATH || DEFAULT_APP_DATA_PATH,
  statfs = fs.statfs,
  totalMemory = os.totalmem,
  freeMemory = os.freemem,
  processMemory = process.memoryUsage,
  directorySize = getDirectorySize,
  databaseClient = database,
  now = () => new Date(),
} = {}) => {
  const memory = usageSnapshot(totalMemory(), freeMemory());
  const processMemoryUsage = processMemory();
  let disk = null;

  try {
    const stats = await statfs(diskPath);
    const blockSize = Number(stats.bsize) || 0;
    disk = usageSnapshot(
      Number(stats.blocks) * blockSize,
      Number(stats.bfree) * blockSize,
      Number(stats.bavail) * blockSize,
    );
  } catch {
    // RAM data is still useful if filesystem statistics are unavailable on a host.
  }

  const [filesBytes, databaseBytes] = await Promise.all([
    directorySize(appDataPath),
    getDatabaseSize(databaseClient),
  ]);
  const knownFilesBytes = filesBytes ?? 0;
  const knownDatabaseBytes = databaseBytes ?? 0;
  const appStorageBytes = filesBytes === null && databaseBytes === null
    ? null
    : knownFilesBytes + knownDatabaseBytes;

  return {
    app: {
      memory: {
        rssBytes: Math.max(0, Number(processMemoryUsage.rss) || 0),
        heapUsedBytes: Math.max(0, Number(processMemoryUsage.heapUsed) || 0),
        heapTotalBytes: Math.max(0, Number(processMemoryUsage.heapTotal) || 0),
        externalBytes: Math.max(0, Number(processMemoryUsage.external) || 0),
      },
      storage: {
        usedBytes: appStorageBytes,
        filesBytes,
        databaseBytes,
      },
    },
    memory,
    disk,
    timestamp: now().toISOString(),
  };
};

module.exports = {
  getDatabaseSize,
  getDirectorySize,
  getSystemResources,
  usageSnapshot,
};
