const { version } = require('../../package.json');

const registerHealthRoutes = (app, { caches = [] } = {}) => {
  const respond = (_req, res) => {
    const mem = process.memoryUsage();
    res.json({
      ok: true,
      service: 'summitsafe-backend',
      version,
      env: process.env.NODE_ENV || 'development',
      uptime: Math.floor(process.uptime()),
      nodeVersion: process.version,
      memory: {
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        rssMb: Math.round(mem.rss / 1024 / 1024),
      },
      caches: caches.map((c) => c.stats()),
      timestamp: new Date().toISOString(),
    });
  };

  app.get('/healthz', respond);
  app.get('/health', respond);
  app.get('/api/healthz', respond);
  app.get('/api/health', respond);
};

module.exports = {
  registerHealthRoutes,
};
