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
  scheduler = null,
  secret = process.env.OBJECTIVE_WATCH_CRON_SECRET,
  ensureFeatureEnabled = () => assertFeatureEnabled('objectiveWatch'),
  log = console,
} = {}) => {
  let activeRun = null;

  const runNow = async () => {
    ensureFeatureEnabled();
    if (!checker || typeof checker.run !== 'function') {
      const error = new Error('Objective Watch checker is unavailable.');
      error.statusCode = 503;
      throw error;
    }
    if (activeRun) return { alreadyRunning: true };

    activeRun = (async () => {
      await scheduler?.recordStarted?.();
      return checker.run();
    })();
    try {
      const summary = await activeRun;
      await scheduler?.recordCompleted?.(summary);
      log.info?.(summary, 'Objective Watch check completed');
      return { alreadyRunning: false, summary };
    } catch (error) {
      try {
        await scheduler?.recordFailed?.(error);
      } catch {
        // Preserve the original checker failure for the caller and logs.
      }
      log.error?.({ err: error }, 'Objective Watch check failed');
      throw error;
    } finally {
      activeRun = null;
    }
  };

  app.post('/api/internal/objective-watch-checks', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const configuredSecret = String(secret || '').trim();
    if (!configuredSecret) {
      return res.status(503).json({ error: 'Objective Watch cron is not configured.' });
    }
    if (!secretsMatch(readBearerToken(req), configuredSecret)) {
      return res.status(401).json({ error: 'Invalid Objective Watch cron credentials.' });
    }
    let heartbeat = { enabled: true };
    try {
      if (typeof scheduler?.recordHeartbeat === 'function') {
        heartbeat = await scheduler.recordHeartbeat();
      }
      if (heartbeat.enabled === false) {
        await scheduler?.recordSkipped?.('skipped_disabled');
        return res.json({ ok: true, skipped: true, reason: 'scheduler_disabled' });
      }
    } catch (error) {
      log.error?.({ err: error }, 'Objective Watch scheduler heartbeat failed');
      return res.status(500).json({ error: 'Objective Watch scheduler heartbeat failed.' });
    }
    try {
      ensureFeatureEnabled();
    } catch (error) {
      try {
        await scheduler?.recordSkipped?.('skipped_feature_disabled');
      } catch {
        // The feature is already intentionally disabled; status tracking is best effort here.
      }
      return res.json({ ok: true, skipped: true, reason: 'feature_disabled' });
    }
    try {
      const result = await runNow();
      if (result.alreadyRunning) return res.status(202).json({ ok: true, alreadyRunning: true });
      return res.json({ ok: true, ...result.summary });
    } catch (error) {
      return res.status(error?.statusCode || 500).json({ error: error?.statusCode ? error.message : 'Objective Watch cron failed.' });
    }
  });

  return { runNow };
};

module.exports = {
  readBearerToken,
  registerObjectiveWatchCheckRoute,
  secretsMatch,
};
