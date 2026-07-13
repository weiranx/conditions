const { version } = require('../../package.json');

const resolveDatabaseStatus = async (database) => {
  if (!database) return null;
  try {
    if (typeof database === 'function') return await database();
    if (typeof database.health === 'function') return await database.health();
    return database;
  } catch {
    return { configured: true, connected: false, error: 'unavailable' };
  }
};

const registerHealthRoutes = (app, { caches = [], ai = null, database = null } = {}) => {
  const respond = async (_req, res) => {
    const mem = process.memoryUsage();
    const aiStatus = typeof ai === 'function' ? ai() : ai;
    const databaseStatus = await resolveDatabaseStatus(database);
    const databaseHealthy = !databaseStatus?.configured || databaseStatus.connected === true;
    const payload = {
      ok: databaseHealthy,
      service: 'backcountry-conditions-backend',
      version,
      env: process.env.NODE_ENV || 'development',
      uptime: Math.floor(process.uptime()),
      nodeVersion: process.version,
      memory: {
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        rssMb: Math.round(mem.rss / 1024 / 1024),
      },
      ...(aiStatus ? { ai: aiStatus } : {}),
      ...(databaseStatus ? { database: databaseStatus } : {}),
      caches: caches.map((c) => c.stats()),
      timestamp: new Date().toISOString(),
    };
    if (!databaseHealthy && typeof res.status === 'function') {
      return res.status(503).json(payload);
    }
    return res.json(payload);
  };

  app.get('/healthz', respond);
  app.get('/health', respond);
  app.get('/api/healthz', respond);
  app.get('/api/health', respond);
};

module.exports = {
  registerHealthRoutes,
  resolveDatabaseStatus,
};
