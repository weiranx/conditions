const { version } = require('../../package.json');

const healthPayload = () => {
  const mem = process.memoryUsage();
  return {
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
    timestamp: new Date().toISOString(),
  };
};

const registerHealthRoutes = (app) => {
  const respond = (_req, res) => {
    res.json(healthPayload());
  };

  app.get('/healthz', respond);
  app.get('/health', respond);
  app.get('/api/healthz', respond);
  app.get('/api/health', respond);
};

module.exports = {
  registerHealthRoutes,
};
