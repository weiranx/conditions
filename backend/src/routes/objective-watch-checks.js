'use strict';

const { createHash, timingSafeEqual } = require('crypto');
const { assertFeatureEnabled } = require('../utils/feature-flags');

const secretsMatch = (provided, expected) => {
  const providedHash = createHash('sha256').update(String(provided || '')).digest();
  const expectedHash = createHash('sha256').update(String(expected || '')).digest();
  return timingSafeEqual(providedHash, expectedHash);
};

const readBearerToken = (req) => {
  const match = /^Bearer\s+(.+)$/iu.exec(String(req.headers?.authorization || '').trim());
  return match?.[1]?.trim() || '';
};

const registerObjectiveWatchCheckRoute = ({
  app,
  checker,
  secret = process.env.OBJECTIVE_WATCH_CRON_SECRET,
  ensureFeatureEnabled = () => assertFeatureEnabled('objectiveWatch'),
  log = console,
} = {}) => {
  let activeRun = null;

  app.post('/api/internal/objective-watch-checks', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const configuredSecret = String(secret || '').trim();
    if (!configuredSecret) {
      return res.status(503).json({ error: 'Objective Watch cron is not configured.' });
    }
    if (!secretsMatch(readBearerToken(req), configuredSecret)) {
      return res.status(401).json({ error: 'Invalid Objective Watch cron credentials.' });
    }
    try {
      ensureFeatureEnabled();
    } catch (error) {
      return res.status(error?.statusCode || 503).json({
        error: error?.message || 'Objective Watch is unavailable.',
        ...(error?.code ? { code: error.code } : {}),
      });
    }
    if (!checker || typeof checker.run !== 'function') {
      return res.status(503).json({ error: 'Objective Watch checker is unavailable.' });
    }
    if (activeRun) {
      return res.status(202).json({ ok: true, alreadyRunning: true });
    }
    activeRun = checker.run();
    try {
      const summary = await activeRun;
      log.info?.(summary, 'Objective Watch cron completed');
      return res.json({ ok: true, ...summary });
    } catch (error) {
      log.error?.({ err: error }, 'Objective Watch cron failed');
      return res.status(500).json({ error: 'Objective Watch cron failed.' });
    } finally {
      activeRun = null;
    }
  });
};

module.exports = {
  readBearerToken,
  registerObjectiveWatchCheckRoute,
  secretsMatch,
};
