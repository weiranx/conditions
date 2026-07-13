#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');
const MIGRATION_FILE_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/;
const MIGRATION_LOCK_ID = 734829105;

const checksum = (content) => crypto.createHash('sha256').update(content).digest('hex');

const loadMigrations = async () => {
  const filenames = (await fs.readdir(MIGRATIONS_DIR))
    .filter((filename) => MIGRATION_FILE_PATTERN.test(filename))
    .sort();
  return Promise.all(filenames.map(async (filename) => {
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, filename), 'utf8');
    return {
      version: filename.replace(/\.sql$/, ''),
      checksum: checksum(sql),
      sql,
    };
  }));
};

const runMigrations = async ({ connectionString = process.env.DATABASE_URL, PoolClass = Pool } = {}) => {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const pool = new PoolClass({
    connectionString,
    application_name: 'summitsafe-migrations',
    max: 1,
    connectionTimeoutMillis: 10000,
    ssl: ['1', 'true', 'require'].includes(String(process.env.DATABASE_SSL || '').toLowerCase())
      ? { rejectUnauthorized: String(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false' }
      : undefined,
  });
  let client = null;

  try {
    client = await pool.connect();
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const appliedResult = await client.query('SELECT version, checksum FROM schema_migrations');
    const applied = new Map(appliedResult.rows.map((row) => [row.version, row.checksum]));
    const migrations = await loadMigrations();

    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        if (applied.get(migration.version) !== migration.checksum) {
          throw new Error(`Applied migration ${migration.version} has been modified`);
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
          [migration.version, migration.checksum],
        );
        await client.query('COMMIT');
        console.log(`Applied migration ${migration.version}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    console.log(`Database migrations are current (${migrations.length} total).`);
  } finally {
    if (client) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
      } finally {
        client.release();
      }
    }
    await pool.end();
  }
};

if (require.main === module) {
  runMigrations().catch((error) => {
    console.error(`Migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  MIGRATION_FILE_PATTERN,
  checksum,
  loadMigrations,
  runMigrations,
};
