'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_REMINDER_MS = 6 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10 * 1000;
const DEFAULT_MAX_RESPONSE_AGE_MS = 2 * 60 * 1000;
const MONITOR_ABORTED = Symbol('monitor-aborted');

const parsePositiveMilliseconds = (seconds, fallback, { minimum = 1 } = {}) => {
  const parsed = Number(seconds);
  if (!Number.isFinite(parsed) || parsed < minimum) return fallback;
  return Math.round(parsed * 1000);
};

const summarizeUnhealthyPayload = (payload, responseStatus) => {
  const issues = [];
  if (responseStatus && responseStatus !== 200) issues.push(`Health endpoint returned HTTP ${responseStatus}.`);
  if (payload?.database?.configured && payload.database.connected !== true) {
    issues.push(`PostgreSQL is unavailable${payload.database.error ? ` (${payload.database.error})` : ''}.`);
  }
  if (payload?.ai?.enabled === true && payload.ai.available !== true) {
    issues.push('AI is enabled but no configured provider is available.');
  }
  if (payload?.ok !== true && issues.length === 0) issues.push('The service reported ok=false.');
  return issues.join(' ');
};

const checkHealth = async ({
  url,
  fetchImpl = global.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseAgeMs = DEFAULT_MAX_RESPONSE_AGE_MS,
  now = () => new Date(),
} = {}) => {
  const checkedAt = now();
  const startedAt = Date.now();
  const durationMs = () => Math.max(0, Date.now() - startedAt);
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.text();
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return {
        healthy: false,
        checkedAt: checkedAt.toISOString(),
        statusCode: response.status,
        durationMs: durationMs(),
        summary: `Health endpoint returned invalid JSON (HTTP ${response.status}).`,
      };
    }

    const responseTimestamp = Date.parse(payload?.timestamp);
    const responseAgeMs = checkedAt.getTime() - responseTimestamp;
    const timestampFresh = Number.isFinite(responseTimestamp)
      && responseAgeMs >= -60_000
      && responseAgeMs <= maxResponseAgeMs;
    const coreHealthy = response.ok && payload?.ok === true;
    const aiHealthy = payload?.ai?.enabled !== true || payload.ai.available === true;
    const healthy = coreHealthy && aiHealthy && timestampFresh;
    if (healthy) {
      return {
        healthy: true,
        checkedAt: checkedAt.toISOString(),
        statusCode: response.status,
        durationMs: durationMs(),
        summary: 'Backend, PostgreSQL, and enabled services are healthy.',
      };
    }

    const issues = summarizeUnhealthyPayload(payload, response.status);
    const timestampIssue = timestampFresh
      ? ''
      : 'Health response timestamp is missing, stale, or in the future.';
    return {
      healthy: false,
      checkedAt: checkedAt.toISOString(),
      statusCode: response.status,
      durationMs: durationMs(),
      summary: [issues, timestampIssue].filter(Boolean).join(' '),
    };
  } catch (error) {
    const reason = error?.name === 'TimeoutError'
      ? `did not respond within ${timeoutMs}ms`
      : `could not be reached (${error?.message || 'unknown error'})`;
    return {
      healthy: false,
      checkedAt: checkedAt.toISOString(),
      statusCode: null,
      durationMs: durationMs(),
      summary: `Health endpoint ${reason}.`,
    };
  }
};

const createFileStateStore = (statePath) => ({
  async load() {
    try {
      return JSON.parse(await fs.readFile(statePath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return {};
      throw error;
    }
  },
  async save(state) {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    const temporaryPath = `${statePath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, statePath);
  },
});

const processHealthResult = async ({
  result,
  stateStore,
  emailService,
  recipient,
  reminderMs = DEFAULT_REMINDER_MS,
  log = console,
}) => {
  const previous = await stateStore.load();
  const checkedAtMs = Date.parse(result.checkedAt);

  if (!result.healthy) {
    const continuingIncident = previous.status === 'unhealthy';
    const incidentStartedAt = continuingIncident && previous.incidentStartedAt
      ? previous.incidentStartedAt
      : result.checkedAt;
    const incidentId = continuingIncident && previous.incidentId
      ? previous.incidentId
      : String(checkedAtMs);
    const lastAlertAtMs = Date.parse(previous.lastAlertAt);
    const reminderDue = !Number.isFinite(lastAlertAtMs) || checkedAtMs - lastAlertAtMs >= reminderMs;
    const shouldAlert = !continuingIncident || reminderDue;
    const next = {
      status: 'unhealthy',
      incidentId,
      incidentStartedAt,
      lastAlertAt: continuingIncident ? previous.lastAlertAt || null : null,
      lastSummary: result.summary,
      lastCheckedAt: result.checkedAt,
      recoveryPending: false,
    };
    await stateStore.save(next);

    if (shouldAlert) {
      await emailService.sendHealthStatusEmail({
        incidentId: `${incidentId}-${continuingIncident ? checkedAtMs : 'opened'}`,
        status: 'unhealthy',
        summary: result.summary,
        checkedAt: result.checkedAt,
        incidentStartedAt,
        to: recipient,
      });
      next.lastAlertAt = result.checkedAt;
      await stateStore.save(next);
      log.error?.({ health: result, incidentStartedAt }, 'Production health alert sent');
      return { action: continuingIncident ? 'reminder-sent' : 'alert-sent', state: next };
    }

    log.warn?.({ health: result, incidentStartedAt }, 'Production remains unhealthy');
    return { action: 'unchanged-unhealthy', state: next };
  }

  const needsRecovery = previous.status === 'unhealthy' || previous.recoveryPending === true;
  if (needsRecovery) {
    const next = {
      ...previous,
      status: 'healthy',
      lastSummary: result.summary,
      lastCheckedAt: result.checkedAt,
      recoveryPending: true,
    };
    await stateStore.save(next);
    await emailService.sendHealthStatusEmail({
      incidentId: previous.incidentId || String(checkedAtMs),
      status: 'recovered',
      summary: result.summary,
      checkedAt: result.checkedAt,
      incidentStartedAt: previous.incidentStartedAt || null,
      to: recipient,
    });
    const recovered = {
      status: 'healthy',
      lastSummary: result.summary,
      lastCheckedAt: result.checkedAt,
      recoveryPending: false,
    };
    await stateStore.save(recovered);
    log.info?.({ health: result }, 'Production health recovery sent');
    return { action: 'recovery-sent', state: recovered };
  }

  const healthy = {
    status: 'healthy',
    lastSummary: result.summary,
    lastCheckedAt: result.checkedAt,
    recoveryPending: false,
  };
  await stateStore.save(healthy);
  log.info?.({ health: result }, 'Production health check passed');
  return { action: 'unchanged-healthy', state: healthy };
};

const wait = (milliseconds, signal) => new Promise((resolve) => {
  let settled = false;
  let timer;
  const finish = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', finish);
    resolve();
  };

  timer = setTimeout(finish, milliseconds);
  signal?.addEventListener('abort', finish, { once: true });
  if (signal?.aborted) finish();
});

const runUntilAbort = async (operation, signal) => {
  if (!signal) return operation();
  if (signal.aborted) return MONITOR_ABORTED;

  let handleAbort;
  const aborted = new Promise((resolve) => {
    handleAbort = () => resolve(MONITOR_ABORTED);
    signal.addEventListener('abort', handleAbort, { once: true });
    if (signal.aborted) handleAbort();
  });

  try {
    return await Promise.race([Promise.resolve().then(operation), aborted]);
  } finally {
    signal.removeEventListener('abort', handleAbort);
  }
};

const runHealthMonitor = async ({
  url,
  intervalMs = DEFAULT_INTERVAL_MS,
  check = () => checkHealth({ url }),
  processResult,
  signal,
  log = console,
}) => {
  while (!signal?.aborted) {
    try {
      const result = await runUntilAbort(check, signal);
      if (result === MONITOR_ABORTED) break;
      const processed = await runUntilAbort(() => processResult(result), signal);
      if (processed === MONITOR_ABORTED) break;
    } catch (error) {
      log.error?.({ err: error }, 'Production health monitor cycle failed');
    }
    if (!signal?.aborted) await wait(intervalMs, signal);
  }
};

module.exports = {
  DEFAULT_INTERVAL_MS,
  DEFAULT_MAX_RESPONSE_AGE_MS,
  DEFAULT_REMINDER_MS,
  DEFAULT_TIMEOUT_MS,
  checkHealth,
  createFileStateStore,
  parsePositiveMilliseconds,
  processHealthResult,
  runHealthMonitor,
  summarizeUnhealthyPayload,
};
