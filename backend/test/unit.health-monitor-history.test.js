'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  buildHealthHistorySummary,
  createFileHealthHistoryStore,
  normalizeHistoryLimit,
} = require('../src/services/health-monitor-history');

test('persists bounded health history and returns newest checks first', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'health-monitor-history-'));
  const store = createFileHealthHistoryStore(path.join(directory, 'history.json'), { limit: 2 });
  try {
    await store.append({ checkedAt: '2026-07-14T00:00:00.000Z', healthy: true, summary: 'Healthy', statusCode: 200, durationMs: 20, action: 'unchanged-healthy' });
    await store.append({ checkedAt: '2026-07-14T00:05:00.000Z', healthy: false, summary: 'Database unavailable', statusCode: 503, durationMs: 25, action: 'alert-sent' });
    await store.append({ checkedAt: '2026-07-14T00:10:00.000Z', healthy: true, summary: 'Recovered', statusCode: 200, durationMs: 18, action: 'recovery-sent' });

    const entries = await store.list();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.checkedAt)).toEqual([
      '2026-07-14T00:10:00.000Z',
      '2026-07-14T00:05:00.000Z',
    ]);
    expect(buildHealthHistorySummary(entries)).toEqual({
      total: 2,
      healthy: 1,
      unhealthy: 1,
      availabilityPercent: 50,
      lastCheckAt: '2026-07-14T00:10:00.000Z',
      lastUnhealthyAt: '2026-07-14T00:05:00.000Z',
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('normalizes invalid history limits', () => {
  expect(normalizeHistoryLimit('100')).toBe(100);
  expect(normalizeHistoryLimit('0', 50)).toBe(50);
  expect(normalizeHistoryLimit('20000')).toBe(10_000);
});
