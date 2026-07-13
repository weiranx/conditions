const { buildSslConfig, createDatabase } = require('../src/db/database');

const createLog = () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
});

describe('database client', () => {
  test('stays disabled without DATABASE_URL', async () => {
    const database = createDatabase({ connectionString: '', log: createLog() });

    await expect(database.connect()).resolves.toEqual({ configured: false, connected: false });
    await expect(database.health()).resolves.toEqual({ configured: false, connected: false });
    expect(database.configured).toBe(false);
  });

  test('connects, reports health, and closes its pool', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const end = jest.fn().mockResolvedValue(undefined);
    const on = jest.fn();
    const PoolClass = jest.fn(() => ({ query, end, on }));
    const database = createDatabase({
      connectionString: 'postgresql://user:password@postgres:5432/summitsafe',
      PoolClass,
      log: createLog(),
    });

    await expect(database.connect()).resolves.toEqual(expect.objectContaining({
      configured: true,
      connected: true,
    }));
    await expect(database.health()).resolves.toEqual(expect.objectContaining({
      configured: true,
      connected: true,
    }));
    expect(query).toHaveBeenCalledWith('SELECT 1', undefined);

    await database.close();
    expect(end).toHaveBeenCalledTimes(1);
  });

  test('returns a sanitized unavailable status when a health query fails', async () => {
    const PoolClass = jest.fn(() => ({
      query: jest.fn().mockRejectedValue(new Error('password secret leaked here')),
      end: jest.fn(),
      on: jest.fn(),
    }));
    const database = createDatabase({
      connectionString: 'postgresql://user:password@postgres:5432/summitsafe',
      PoolClass,
      log: createLog(),
    });

    await expect(database.health()).resolves.toEqual(expect.objectContaining({
      configured: true,
      connected: false,
      error: 'unavailable',
    }));
  });

  test('enables strict TLS by default when requested', () => {
    expect(buildSslConfig('require')).toEqual({ rejectUnauthorized: true });
    expect(buildSslConfig('true', 'false')).toEqual({ rejectUnauthorized: false });
    expect(buildSslConfig('')).toBeUndefined();
  });
});
