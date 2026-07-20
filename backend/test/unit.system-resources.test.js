'use strict';

const {
  getDatabaseSize,
  getDirectorySize,
  getSystemResources,
} = require('../src/utils/system-resources');

test('reports backend RAM and app-owned persistent storage', async () => {
  const query = jest.fn(async () => ({ rows: [{ bytes: '12000' }] }));
  const result = await getSystemResources({
    appDataPath: '/app/data',
    diskPath: '/app',
    directorySize: jest.fn(async () => 3_000),
    databaseClient: { configured: true, query },
    processMemory: () => ({ rss: 2_000, heapUsed: 900, heapTotal: 1_200, external: 100 }),
    totalMemory: () => 10_000,
    freeMemory: () => 4_000,
    statfs: async () => ({ bsize: 100, blocks: 100, bfree: 30, bavail: 25 }),
    now: () => new Date('2026-07-20T12:00:00.000Z'),
  });

  expect(query).toHaveBeenCalledWith('SELECT pg_database_size(current_database()) AS bytes');
  expect(result.app).toEqual({
    memory: { rssBytes: 2_000, heapUsedBytes: 900, heapTotalBytes: 1_200, externalBytes: 100 },
    storage: { usedBytes: 15_000, filesBytes: 3_000, databaseBytes: 12_000 },
  });
  expect(result.memory.usagePercent).toBe(60);
  expect(result.disk.usagePercent).toBe(70);
  expect(result.timestamp).toBe('2026-07-20T12:00:00.000Z');
});

test('keeps partial app storage available without PostgreSQL', async () => {
  const result = await getSystemResources({
    directorySize: jest.fn(async () => 4_000),
    databaseClient: { configured: false },
    processMemory: () => ({ rss: 500, heapUsed: 300, heapTotal: 400, external: 25 }),
    statfs: async () => { throw new Error('unavailable'); },
  });

  expect(result.app.storage).toEqual({ usedBytes: 4_000, filesBytes: 4_000, databaseBytes: null });
  expect(result.disk).toBeNull();
});

test('does not report zero storage when no app storage source is measurable', async () => {
  const result = await getSystemResources({
    directorySize: jest.fn(async () => null),
    databaseClient: { configured: false },
    processMemory: () => ({ rss: 500, heapUsed: 300, heapTotal: 400, external: 25 }),
  });

  expect(result.app.storage).toEqual({ usedBytes: null, filesBytes: null, databaseBytes: null });
});

test('measures files recursively and ignores unsupported entries', async () => {
  const entries = new Map([
    ['/data', [
      { name: 'nested', isDirectory: () => true, isFile: () => false },
      { name: 'usage.ndjson', isDirectory: () => false, isFile: () => true },
      { name: 'current', isDirectory: () => false, isFile: () => false },
    ]],
    ['/data/nested', [
      { name: 'settings.json', isDirectory: () => false, isFile: () => true },
    ]],
  ]);
  const readdir = jest.fn(async (directoryPath) => entries.get(directoryPath));
  const statSpy = jest.spyOn(require('node:fs/promises'), 'stat')
    .mockImplementation(async (filePath) => ({ size: filePath.endsWith('usage.ndjson') ? 30 : 12 }));

  await expect(getDirectorySize('/data', { readdir })).resolves.toBe(42);
  statSpy.mockRestore();
});

test('returns null when the database size cannot be read', async () => {
  await expect(getDatabaseSize({ configured: false })).resolves.toBeNull();
  await expect(getDatabaseSize({ configured: true, query: async () => { throw new Error('offline'); } })).resolves.toBeNull();
});
