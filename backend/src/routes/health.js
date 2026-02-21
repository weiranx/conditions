const healthPayload = () => ({
  ok: true,
  service: 'summitsafe-backend',
  env: process.env.NODE_ENV || 'development',
  timestamp: new Date().toISOString(),
});

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
