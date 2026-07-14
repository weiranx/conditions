'use strict';

const {
  checkHealth,
  parsePositiveMilliseconds,
  processHealthResult,
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
});
