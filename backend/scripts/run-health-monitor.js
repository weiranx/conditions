'use strict';

require('../src/server/runtime');

const { ADMIN_ACCOUNT_EMAIL } = require('../src/auth/admin-account');
const { createEmailService } = require('../src/email/email-service');
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
    processResult: (result) => processHealthResult({
      result,
      stateStore,
      emailService,
      recipient,
      reminderMs,
      log: logger,
    }),
  }).catch((error) => {
    logger.fatal({ err: error }, 'Production health monitor stopped unexpectedly');
    process.exitCode = 1;
  });
}
