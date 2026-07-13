const fs = require('node:fs/promises');
const os = require('node:os');

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

const getSystemResources = async ({
  diskPath = process.env.ADMIN_DISK_PATH || process.cwd(),
  statfs = fs.statfs,
  totalMemory = os.totalmem,
  freeMemory = os.freemem,
  now = () => new Date(),
} = {}) => {
  const memory = usageSnapshot(totalMemory(), freeMemory());
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

  return {
    memory,
    disk,
    timestamp: now().toISOString(),
  };
};

module.exports = { getSystemResources, usageSnapshot };
