'use strict';

require('../src/server/runtime');

const { ADMIN_ACCOUNT_EMAIL } = require('../src/auth/admin-account');
const { createEmailService } = require('../src/email/email-service');
const {
  DEFAULT_HISTORY_LIMIT,
  createFileHealthHistoryStore,
  normalizeHistoryLimit,
} = require('../src/services/health-monitor-history');
const {
  DEFAULT_INTERVAL_MS,
  DEFAULT_MAX_RESPONSE_AGE_MS,
  DEFAULT_REMINDER_MS,
  DEFAULT_TIMEOUT_MS,
  checkHealth,
  createFileStateStore,
  parsePositiveMilliseconds,
  processHealthResult,
  runHealthMonitor,
} = require('../src/services/health-monitor');
const { logger } = require('../src/utils/logger');

const url = process.env.HEALTH_MONITOR_URL || 'http://backend:3001/healthz';
const recipient = String(process.env.HEALTH_ALERT_EMAIL || ADMIN_ACCOUNT_EMAIL).trim();
const intervalMs = parsePositiveMilliseconds(process.env.HEALTH_MONITOR_INTERVAL_SECONDS, DEFAULT_INTERVAL_MS, { minimum: 30 });
const reminderMs = parsePositiveMilliseconds(process.env.HEALTH_ALERT_REMINDER_SECONDS, DEFAULT_REMINDER_MS, { minimum: 60 });
const timeoutMs = parsePositiveMilliseconds(process.env.HEALTH_MONITOR_TIMEOUT_SECONDS, DEFAULT_TIMEOUT_MS, { minimum: 1 });
const maxResponseAgeMs = parsePositiveMilliseconds(process.env.HEALTH_MONITOR_MAX_RESPONSE_AGE_SECONDS, DEFAULT_MAX_RESPONSE_AGE_MS, { minimum: 10 });
const stateStore = createFileStateStore(process.env.HEALTH_MONITOR_STATE_FILE || '/app/data/health-monitor-state.json');
const historyStore = createFileHealthHistoryStore(
  process.env.HEALTH_MONITOR_HISTORY_FILE || '/app/data/health-monitor-history.json',
  { limit: normalizeHistoryLimit(process.env.HEALTH_MONITOR_HISTORY_LIMIT, DEFAULT_HISTORY_LIMIT) },
);
const emailService = createEmailService();
const abortController = new AbortController();

if (!emailService.available) {
  logger.fatal('Health monitor requires RESEND_API_KEY, EMAIL_FROM, and APP_BASE_URL.');
  process.exitCode = 1;
} else if (!recipient) {
  logger.fatal('Health monitor requires HEALTH_ALERT_EMAIL.');
  process.exitCode = 1;
} else {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => abortController.abort());
  }
  logger.info({ url, recipient, intervalMs, reminderMs }, 'Production health monitor started');
  runHealthMonitor({
    url,
    intervalMs,
    signal: abortController.signal,
    log: logger,
    check: () => checkHealth({ url, timeoutMs, maxResponseAgeMs }),
    processResult: async (result) => {
      let action = 'processing-failed';
      let alertError = null;
      try {
        const processed = await processHealthResult({
          result,
          stateStore,
          emailService,
          recipient,
          reminderMs,
          log: logger,
        });
        action = processed.action;
      } catch (error) {
        alertError = error?.message || 'Health monitor processing failed.';
        throw error;
      } finally {
        try {
          await historyStore.append({ ...result, action, alertError });
        } catch (error) {
          logger.error({ err: error }, 'Production health check history could not be persisted');
        }
      }
    },
  }).catch((error) => {
    logger.fatal({ err: error }, 'Production health monitor stopped unexpectedly');
    process.exitCode = 1;
  });
}
