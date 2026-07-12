const { getFeatureFlags } = require('../utils/feature-flags');

const registerFeatureFlagRoutes = (app) => {
  app.get('/api/feature-flags', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(getFeatureFlags());
  });
};

module.exports = { registerFeatureFlagRoutes };
