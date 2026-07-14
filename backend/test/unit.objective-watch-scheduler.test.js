const {
  createObjectiveWatchScheduler,
  deriveSchedulerStatus,
} = require('../src/services/objective-watch-scheduler');

const NOW = new Date('2026-07-14T20:00:00.000Z').getTime();

const baseRow = {
  enabled: true,
  check_interval_minutes: 180,
  last_heartbeat_at: '2026-07-14T19:57:00.000Z',
  last_started_at: '2026-07-14T19:57:01.000Z',
  last_completed_at: '2026-07-14T19:57:15.000Z',
  last_status: 'succeeded',
  last_error: null,
  last_summary: { checked: 2, failed: 0 },
  updated_at: '2026-07-14T19:57:15.000Z',
};

test('derives healthy, stale, stopped, and unconfigured scheduler states', () => {
  expect(deriveSchedulerStatus({ row: baseRow, secretConfigured: true, now: NOW })).toMatchObject({
    health: 'healthy',
    enabled: true,
    configured: true,
    checkIntervalMinutes: 180,
    lastSummary: { checked: 2, failed: 0 },
  });
  expect(deriveSchedulerStatus({
    row: { ...baseRow, last_heartbeat_at: '2026-07-14T17:00:00.000Z' },
    secretConfigured: true,
    now: NOW,
  }).health).toBe('unhealthy');
  expect(deriveSchedulerStatus({ row: { ...baseRow, enabled: false }, secretConfigured: true, now: NOW }).health).toBe('stopped');
  expect(deriveSchedulerStatus({ row: baseRow, secretConfigured: false, now: NOW }).health).toBe('not_configured');
  expect(deriveSchedulerStatus({ row: { ...baseRow, last_status: 'failed', last_error: 'Provider failed' }, secretConfigured: true, now: NOW })).toMatchObject({
    health: 'failed',
    message: 'Provider failed',
  });
});

test('persists scheduler controls and run lifecycle state', async () => {
  const query = jest.fn(async (sql, params) => {
    if (sql.includes('SET enabled = $1')) {
      return { rows: [{ ...baseRow, enabled: params[0], last_status: params[0] ? 'waiting' : 'stopped' }] };
    }
    if (sql.includes('SET check_interval_minutes = $1')) {
      return { rows: [{ ...baseRow, check_interval_minutes: params[0] }] };
    }
    if (sql.includes('RETURNING enabled')) return { rows: [{ enabled: true, check_interval_minutes: 180 }] };
    if (sql.includes('SELECT enabled')) return { rows: [baseRow] };
    return { rows: [] };
  });
  const scheduler = createObjectiveWatchScheduler({
    database: { configured: true, query, transaction: (callback) => callback(query) },
    secretConfigured: () => true,
    now: () => NOW,
  });

  await expect(scheduler.recordHeartbeat()).resolves.toEqual({ enabled: true });
  await expect(scheduler.getCheckIntervalMinutes()).resolves.toBe(180);
  await scheduler.recordStarted();
  await scheduler.recordCompleted({ checked: 3 });
  await scheduler.recordFailed(new Error('Network failed'));
  await scheduler.recordSkipped('skipped_disabled');
  await expect(scheduler.setEnabled(false)).resolves.toMatchObject({ enabled: false, health: 'stopped' });
  await expect(scheduler.setCheckInterval(360)).resolves.toMatchObject({ checkIntervalMinutes: 360 });
  await expect(scheduler.setCheckInterval(30)).resolves.toMatchObject({ checkIntervalMinutes: 30 });
  await expect(scheduler.setCheckInterval(7)).rejects.toThrow('5-minute increments');

  expect(query.mock.calls.some(([sql]) => sql.includes("last_status = 'running'"))).toBe(true);
  expect(query.mock.calls.some(([sql, params]) => sql.includes("last_status = 'succeeded'") && params[0] === '{"checked":3}')).toBe(true);
  expect(query.mock.calls.some(([sql, params]) => sql.includes("last_status = 'failed'") && params[0] === 'Network failed')).toBe(true);
  expect(query.mock.calls.some(([sql, params]) => sql.includes('last_status = $1') && params[0] === 'skipped_disabled')).toBe(true);
  expect(query.mock.calls.some(([sql, params]) => sql.includes('UPDATE objective_watches') && params[0] === 30)).toBe(true);
});

test('requires PostgreSQL for scheduler state', async () => {
  const scheduler = createObjectiveWatchScheduler({ database: { configured: false } });
  await expect(scheduler.getStatus()).rejects.toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
  await expect(scheduler.setEnabled(false)).rejects.toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
  await expect(scheduler.setCheckInterval(180)).rejects.toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
});
