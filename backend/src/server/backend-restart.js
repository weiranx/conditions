'use strict';

const { logger } = require('../utils/logger');

const DEFAULT_RESTART_DELAY_MS = 1500;

const createRestartDisabledError = () => {
  const error = new Error('Backend restart is unavailable in this deployment.');
  error.code = 'BACKEND_RESTART_DISABLED';
  return error;
};

const createBackendRestartController = ({
  enabled = String(process.env.ADMIN_BACKEND_RESTART_ENABLED || '').trim().toLowerCase() === 'true',
  delayMs = DEFAULT_RESTART_DELAY_MS,
  now = Date.now,
  schedule = setTimeout,
  sendSignal = () => process.kill(process.pid, 'SIGTERM'),
  log = logger,
} = {}) => {
  let scheduledAt = null;

  const getStatus = () => ({
    available: Boolean(enabled),
    scheduled: Boolean(scheduledAt),
    scheduledAt,
    restartDelayMs: delayMs,
    reason: enabled
      ? null
      : 'Enable ADMIN_BACKEND_RESTART_ENABLED only when a process supervisor will restart the backend.',
  });

  const scheduleRestart = () => {
    if (!enabled) throw createRestartDisabledError();
    if (scheduledAt) return getStatus();

    scheduledAt = new Date(now()).toISOString();
    const timer = schedule(() => {
      try {
        sendSignal();
      } catch (error) {
        scheduledAt = null;
        log.error({ err: error }, 'Scheduled backend restart failed');
      }
    }, delayMs);
    timer?.unref?.();
    return getStatus();
  };

  return { getStatus, scheduleRestart };
};

const backendRestartController = createBackendRestartController();

module.exports = {
  DEFAULT_RESTART_DELAY_MS,
  backendRestartController,
  createBackendRestartController,
};
