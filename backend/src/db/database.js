'use strict';

const { Pool } = require('pg');
const { logger } = require('../utils/logger');

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
};

const buildSslConfig = (mode, rejectUnauthorized) => {
  if (!['1', 'true', 'require'].includes(String(mode || '').toLowerCase())) {
    return undefined;
  }
  return {
    rejectUnauthorized: String(rejectUnauthorized || 'true').toLowerCase() !== 'false',
  };
};

const createDatabase = ({
  connectionString = process.env.DATABASE_URL,
  PoolClass = Pool,
  log = logger,
  poolOptions = {},
} = {}) => {
  const normalizedConnectionString = String(connectionString || '').trim();
  const configured = normalizedConnectionString.length > 0;
  let pool = null;

  const getPool = () => {
    if (!configured) {
      throw new Error('DATABASE_URL is not configured');
    }
    if (!pool) {
      pool = new PoolClass({
        connectionString: normalizedConnectionString,
        application_name: 'summitsafe-backend',
        max: parsePositiveInteger(process.env.DATABASE_POOL_MAX, 10),
        connectionTimeoutMillis: parsePositiveInteger(process.env.DATABASE_CONNECT_TIMEOUT_MS, 3000),
        idleTimeoutMillis: parsePositiveInteger(process.env.DATABASE_IDLE_TIMEOUT_MS, 30000),
        statement_timeout: parsePositiveInteger(process.env.DATABASE_STATEMENT_TIMEOUT_MS, 10000),
        ssl: buildSslConfig(process.env.DATABASE_SSL, process.env.DATABASE_SSL_REJECT_UNAUTHORIZED),
        ...poolOptions,
      });
      pool.on?.('error', (error) => {
        log.error({ err: error }, 'Unexpected idle PostgreSQL client error');
      });
    }
    return pool;
  };

  const query = (text, params) => getPool().query(text, params);

  const connect = async () => {
    if (!configured) {
      log.warn('DATABASE_URL is not configured; persistent database features are disabled');
      return { configured: false, connected: false };
    }
    const startedAt = Date.now();
    await query('SELECT 1');
    const status = {
      configured: true,
      connected: true,
      latencyMs: Date.now() - startedAt,
    };
    log.info({ latencyMs: status.latencyMs }, 'PostgreSQL connection established');
    return status;
  };

  const health = async () => {
    if (!configured) {
      return { configured: false, connected: false };
    }
    const startedAt = Date.now();
    try {
      await query('SELECT 1');
      return {
        configured: true,
        connected: true,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      log.warn({ err: error }, 'PostgreSQL health check failed');
      return {
        configured: true,
        connected: false,
        latencyMs: Date.now() - startedAt,
        error: 'unavailable',
      };
    }
  };

  const close = async () => {
    if (!pool) return;
    const activePool = pool;
    pool = null;
    await activePool.end();
    log.info('PostgreSQL connection pool closed');
  };

  return {
    configured,
    query,
    connect,
    health,
    close,
  };
};

const database = createDatabase();

module.exports = {
  buildSslConfig,
  createDatabase,
  database,
};
