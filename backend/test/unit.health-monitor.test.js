'use strict';

const { spawnSync } = require('node:child_process');
const { getEventListeners } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  checkHealth,
  parsePositiveMilliseconds,
  processHealthResult,
  runHealthMonitor,
} = require('../src/services/health-monitor');

const response = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  text: jest.fn().mockResolvedValue(JSON.stringify(payload)),
});

const createMemoryStateStore = (initial = {}) => {
  let state = structuredClone(initial);
  return {
    load: jest.fn(async () => structuredClone(state)),
    save: jest.fn(async (next) => { state = structuredClone(next); }),
    read: () => structuredClone(state),
  };
};

const settlesWithin = async (promise, milliseconds = 250) => {
  let timer;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

describe('production health monitor', () => {
  test('accepts a fresh healthy response and rejects unhealthy components', async () => {
    const now = () => new Date('2026-07-14T12:00:00.000Z');
    const healthy = await checkHealth({
      url: 'http://backend:3001/healthz',
      now,
      fetchImpl: jest.fn().mockResolvedValue(response(200, {
        ok: true,
        timestamp: '2026-07-14T11:59:55.000Z',
        database: { configured: true, connected: true },
        ai: { enabled: true, available: true },
      })),
    });
    expect(healthy).toEqual(expect.objectContaining({
      healthy: true,
      statusCode: 200,
      durationMs: expect.any(Number),
    }));

    const unhealthy = await checkHealth({
      url: 'http://backend:3001/healthz',
      now,
      fetchImpl: jest.fn().mockResolvedValue(response(503, {
        ok: false,
        timestamp: '2026-07-14T11:59:55.000Z',
        database: { configured: true, connected: false, error: 'unavailable' },
      })),
    });
    expect(unhealthy.healthy).toBe(false);
    expect(unhealthy.statusCode).toBe(503);
    expect(unhealthy.summary).toContain('HTTP 503');
    expect(unhealthy.summary).toContain('PostgreSQL is unavailable');
  });

  test('rejects stale responses and reports unreachable endpoints', async () => {
    const now = () => new Date('2026-07-14T12:00:00.000Z');
    const stale = await checkHealth({
      url: 'http://backend:3001/healthz',
      now,
      maxResponseAgeMs: 60_000,
      fetchImpl: jest.fn().mockResolvedValue(response(200, {
        ok: true,
        timestamp: '2026-07-14T11:55:00.000Z',
      })),
    });
    expect(stale).toEqual(expect.objectContaining({
      healthy: false,
      summary: expect.stringContaining('timestamp'),
    }));

    const unreachable = await checkHealth({
      url: 'http://backend:3001/healthz',
      now,
      fetchImpl: jest.fn().mockRejectedValue(new Error('connection refused')),
    });
    expect(unreachable.summary).toContain('connection refused');
    expect(unreachable.statusCode).toBeNull();
  });

  test('alerts once, waits until the reminder interval, then sends recovery', async () => {
    const stateStore = createMemoryStateStore();
    const emailService = { sendHealthStatusEmail: jest.fn().mockResolvedValue({ id: 'email-id' }) };
    const log = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
    const base = {
      stateStore,
      emailService,
      recipient: 'owner@example.com',
      reminderMs: 6 * 60 * 60 * 1000,
      log,
    };

    await expect(processHealthResult({
      ...base,
      result: { healthy: false, checkedAt: '2026-07-14T00:00:00.000Z', summary: 'Backend unreachable.' },
    })).resolves.toEqual(expect.objectContaining({ action: 'alert-sent' }));
    await expect(processHealthResult({
      ...base,
      result: { healthy: false, checkedAt: '2026-07-14T00:05:00.000Z', summary: 'Backend unreachable.' },
    })).resolves.toEqual(expect.objectContaining({ action: 'unchanged-unhealthy' }));
    await expect(processHealthResult({
      ...base,
      result: { healthy: false, checkedAt: '2026-07-14T06:00:00.000Z', summary: 'Backend unreachable.' },
    })).resolves.toEqual(expect.objectContaining({ action: 'reminder-sent' }));
    await expect(processHealthResult({
      ...base,
      result: { healthy: true, checkedAt: '2026-07-14T06:05:00.000Z', summary: 'All healthy.' },
    })).resolves.toEqual(expect.objectContaining({ action: 'recovery-sent' }));

    expect(emailService.sendHealthStatusEmail).toHaveBeenCalledTimes(3);
    expect(emailService.sendHealthStatusEmail.mock.calls.map(([message]) => message.status))
      .toEqual(['unhealthy', 'unhealthy', 'recovered']);
    expect(stateStore.read()).toEqual(expect.objectContaining({ status: 'healthy', recoveryPending: false }));
  });

  test('uses safe configured intervals', () => {
    expect(parsePositiveMilliseconds('300', 1, { minimum: 30 })).toBe(300_000);
    expect(parsePositiveMilliseconds('5', 123, { minimum: 30 })).toBe(123);
    expect(parsePositiveMilliseconds('invalid', 456)).toBe(456);
  });

  test('does not accumulate abort listeners across completed intervals', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const check = jest.fn().mockResolvedValue({ healthy: true });
    const processResult = jest.fn().mockResolvedValue({ action: 'unchanged-healthy' });

    try {
      const monitor = runHealthMonitor({
        url: 'http://backend:3001/healthz',
        intervalMs: 1_000,
        check,
        processResult,
        signal: controller.signal,
        log: { error: jest.fn() },
      });

      await jest.advanceTimersByTimeAsync(0);
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1);

      for (let cycle = 0; cycle < 25; cycle += 1) {
        await jest.advanceTimersByTimeAsync(1_000);
        expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1);
      }

      controller.abort();
      await monitor;
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
      expect(check).toHaveBeenCalledTimes(26);
      expect(processResult).toHaveBeenCalledTimes(26);
    } finally {
      jest.useRealTimers();
    }
  });

  test('stops promptly when aborted during a hung health check', async () => {
    const controller = new AbortController();
    let markCheckStarted;
    const checkStarted = new Promise((resolve) => { markCheckStarted = resolve; });
    const check = jest.fn(() => {
      markCheckStarted();
      return new Promise(() => {});
    });
    const processResult = jest.fn();
    const monitor = runHealthMonitor({
      url: 'http://backend:3001/healthz',
      check,
      processResult,
      signal: controller.signal,
      log: { error: jest.fn() },
    });

    await checkStarted;
    controller.abort();

    await expect(settlesWithin(monitor)).resolves.toBe(true);
    expect(processResult).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  test('stops promptly when aborted during hung result processing', async () => {
    const controller = new AbortController();
    let markProcessingStarted;
    const processingStarted = new Promise((resolve) => { markProcessingStarted = resolve; });
    const check = jest.fn().mockResolvedValue({ healthy: true });
    const processResult = jest.fn(() => {
      markProcessingStarted();
      return new Promise(() => {});
    });
    const monitor = runHealthMonitor({
      url: 'http://backend:3001/healthz',
      check,
      processResult,
      signal: controller.signal,
      log: { error: jest.fn() },
    });

    await processingStarted;
    controller.abort();

    await expect(settlesWithin(monitor)).resolves.toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  test('validates effective health monitor environment values', () => {
    const script = path.resolve(__dirname, '../../scripts/backend-reload-env.sh');
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'health-env-test-'));
    const envFile = path.join(temporaryDirectory, '.env');
    const validate = (contents) => {
      fs.writeFileSync(envFile, contents, 'utf8');
      return spawnSync('bash', [script, '--validate-health-monitor-env', envFile], {
        encoding: 'utf8',
      }).status;
    };

    try {
      expect(validate([
        'RESEND_API_KEY="re_valid"',
        'EMAIL_FROM="SummitSafe <alerts@example.com>"',
        'APP_BASE_URL="https://summitsafe.example/"',
      ].join('\n'))).toBe(0);

      for (const invalidEnvironment of [
        'RESEND_API_KEY=""\nEMAIL_FROM=alerts@example.com\nAPP_BASE_URL=https://summitsafe.example',
        'RESEND_API_KEY="   "\nEMAIL_FROM=alerts@example.com\nAPP_BASE_URL=https://summitsafe.example',
        'RESEND_API_KEY=re_valid\nEMAIL_FROM=   \nAPP_BASE_URL=https://summitsafe.example',
        'RESEND_API_KEY=re_valid\nEMAIL_FROM=alerts@example.com\nAPP_BASE_URL=""',
        'RESEND_API_KEY=re_valid\nEMAIL_FROM=alerts@example.com\nAPP_BASE_URL=javascript:alert(1)',
        'RESEND_API_KEY=re_valid\nEMAIL_FROM=alerts@example.com\nAPP_BASE_URL=https://',
      ]) {
        expect(validate(invalidEnvironment)).not.toBe(0);
      }
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
