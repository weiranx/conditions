'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { database } = require('./database');
const { estimateAIUsageCost } = require('../utils/ai-pricing');
const { logger } = require('../utils/logger');

const REPORT_LIMIT = 500;
const REPORT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const AI_USAGE_LIMIT = 2000;
const AI_USAGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ADMIN_AUDIT_LIMIT = 500;
const ADMIN_AUDIT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const defaultLegacyFiles = () => ({
  aiSettings: process.env.AI_SETTINGS_FILE
    ? path.resolve(process.env.AI_SETTINGS_FILE)
    : path.resolve(__dirname, '../../data/ai-settings.json'),
  featureFlags: process.env.FEATURE_FLAGS_FILE
    ? path.resolve(process.env.FEATURE_FLAGS_FILE)
    : path.resolve(__dirname, '../../data/feature-flags.json'),
  reportActivity: path.resolve(__dirname, '../../data/report-logs.ndjson'),
  aiUsage: path.resolve(__dirname, '../../data/ai-usage.ndjson'),
  adminAudit: process.env.ADMIN_AUDIT_FILE
    ? path.resolve(process.env.ADMIN_AUDIT_FILE)
    : path.resolve(__dirname, '../../data/admin-audit.ndjson'),
});

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const parseNdjson = (content) => String(content || '')
  .split('\n')
  .flatMap((raw, index) => {
    const line = raw.trim();
    if (!line) return [];
    try {
      const record = JSON.parse(line);
      return record && typeof record === 'object' && !Array.isArray(record)
        ? [{ record, raw: line, lineNumber: index + 1 }]
        : [];
    } catch {
      return [];
    }
  });

const normalizeTimestamp = (value) => {
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
};

const withinRetention = (timestamp, retentionMs, now) => {
  const time = new Date(timestamp).getTime();
  const age = now - time;
  return Number.isFinite(time) && age >= 0 && age <= retentionMs;
};

const legacyKey = (source, raw) => `${source}:${sha256(raw)}`;

const asJsonObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

const asCount = (result) => Number(result?.rows?.[0]?.count || 0);

const aiUsageParams = (record, { idempotencyKey = crypto.randomUUID(), legacyId = null } = {}) => {
  const timestamp = normalizeTimestamp(record.timestamp) || new Date().toISOString();
  const hasEstimatedCost = record.estimatedCostUsd !== null && record.estimatedCostUsd !== undefined;
  const estimatedCost = Number(record.estimatedCostUsd);
  const metadata = Object.fromEntries(Object.entries(record).filter(([key]) => ![
    'timestamp',
    'provider',
    'model',
    'feature',
    'status',
    'durationMs',
    'inputTokens',
    'outputTokens',
    'totalTokens',
    'requestId',
  ].includes(key)));
  if (legacyId) metadata.legacyId = legacyId;
  return [
    idempotencyKey,
    record.requestId || null,
    String(record.feature || 'generation').slice(0, 80),
    String(record.provider || 'unknown').slice(0, 40),
    String(record.model || 'unknown').slice(0, 120),
    record.status === 'success' ? 'success' : 'error',
    Math.max(0, Math.round(Number(record.inputTokens) || 0)),
    Math.max(0, Math.round(Number(record.outputTokens) || 0)),
    Math.max(0, Math.round(Number(record.totalTokens) || 0)),
    hasEstimatedCost && Number.isFinite(estimatedCost) ? Math.max(0, Math.round(estimatedCost * 1_000_000)) : 0,
    Math.max(0, Math.round(Number(record.durationMs) || 0)),
    JSON.stringify(metadata),
    timestamp,
  ];
};

const mapAIUsageRow = (row) => {
  const metadata = { ...asJsonObject(row.metadata) };
  delete metadata.legacyId;
  const costMicros = Number(row.cost_usd_micros || 0);
  return {
    ...metadata,
    timestamp: normalizeTimestamp(row.created_at),
    provider: row.provider,
    model: row.model,
    feature: row.feature,
    status: row.status,
    durationMs: Number(row.duration_ms || 0),
    inputTokens: Number(row.input_tokens || 0),
    outputTokens: Number(row.output_tokens || 0),
    totalTokens: Number(row.total_tokens || 0),
    estimatedCostUsd: Object.hasOwn(metadata, 'estimatedCostUsd')
      ? metadata.estimatedCostUsd
      : costMicros / 1_000_000,
  };
};

const createAppDataStore = ({
  db = database,
  legacyFiles = defaultLegacyFiles(),
  log = logger,
  now = () => Date.now(),
} = {}) => {
  let cleanupTimer = null;
  const isConfigured = () => Boolean(db.configured);

  const getAdminSetting = async (key) => {
    if (!isConfigured()) return null;
    const result = await db.query('SELECT value FROM admin_settings WHERE key = $1', [key]);
    return result.rows[0]?.value ?? null;
  };

  const setAdminSetting = async (key, value) => {
    if (!isConfigured()) return value;
    await db.query(`
      INSERT INTO admin_settings (key, value, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = NOW()
    `, [key, JSON.stringify(value)]);
    return value;
  };

  const insertReportActivityWith = async (query, record, importedKey = null) => {
    const timestamp = normalizeTimestamp(record.timestamp);
    if (!timestamp) return false;
    const result = await query(`
      INSERT INTO report_activity_events (occurred_at, payload, legacy_key)
      VALUES ($1, $2::jsonb, $3)
      ON CONFLICT (legacy_key) DO NOTHING
    `, [timestamp, JSON.stringify({ ...record, timestamp }), importedKey]);
    return result.rowCount > 0;
  };

  const insertReportActivity = (record) => (
    isConfigured() ? insertReportActivityWith(db.query, record) : Promise.resolve(false)
  );

  const listReportActivity = async () => {
    if (!isConfigured()) return [];
    const result = await db.query(`
      SELECT payload
      FROM report_activity_events
      WHERE occurred_at >= NOW() - ($1 * INTERVAL '1 millisecond')
      ORDER BY occurred_at DESC, id DESC
      LIMIT $2
    `, [REPORT_RETENTION_MS, REPORT_LIMIT]);
    return result.rows.map((row) => asJsonObject(row.payload));
  };

  const clearReportActivity = async () => {
    if (!isConfigured()) return 0;
    return asCount(await db.query(`
      WITH deleted AS (DELETE FROM report_activity_events RETURNING 1)
      SELECT COUNT(*)::integer AS count FROM deleted
    `));
  };

  const insertAIUsageWith = async (query, record, options = {}) => {
    const result = await query(`
      INSERT INTO ai_usage_events (
        idempotency_key, request_id, feature, provider, model, status,
        input_tokens, output_tokens, total_tokens, cost_usd_micros,
        duration_ms, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
      ON CONFLICT (idempotency_key) DO NOTHING
    `, aiUsageParams(record, options));
    return result.rowCount > 0;
  };

  const insertAIUsage = (record) => (
    isConfigured() ? insertAIUsageWith(db.query, record) : Promise.resolve(false)
  );

  const listAIUsage = async () => {
    if (!isConfigured()) return [];
    const result = await db.query(`
      SELECT provider, model, feature, status, input_tokens, output_tokens,
             total_tokens, cost_usd_micros, duration_ms, metadata, created_at
      FROM ai_usage_events
      WHERE created_at >= NOW() - ($1 * INTERVAL '1 millisecond')
      ORDER BY created_at DESC, id DESC
      LIMIT $2
    `, [AI_USAGE_RETENTION_MS, AI_USAGE_LIMIT]);
    return result.rows.map(mapAIUsageRow);
  };

  const clearAIUsage = async () => {
    if (!isConfigured()) return 0;
    return asCount(await db.query(`
      WITH deleted AS (DELETE FROM ai_usage_events RETURNING 1)
      SELECT COUNT(*)::integer AS count FROM deleted
    `));
  };

  const insertAdminAuditWith = async (query, record, importedKey = null) => {
    const timestamp = normalizeTimestamp(record.timestamp);
    if (!timestamp) return false;
    const result = await query(`
      INSERT INTO admin_audit_events (
        occurred_at, action, category, status, summary, actor_network, details, legacy_key
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      ON CONFLICT (legacy_key) DO NOTHING
    `, [
      timestamp,
      String(record.action || 'admin.unknown').slice(0, 100),
      String(record.category || 'system').slice(0, 40),
      record.status === 'success' ? 'success' : 'error',
      String(record.summary || 'Administrative action').slice(0, 240),
      record.actorNetwork || null,
      record.details ? JSON.stringify(record.details) : null,
      importedKey,
    ]);
    return result.rowCount > 0;
  };

  const insertAdminAudit = (record) => (
    isConfigured() ? insertAdminAuditWith(db.query, record) : Promise.resolve(false)
  );

  const listAdminAudit = async () => {
    if (!isConfigured()) return [];
    const result = await db.query(`
      SELECT occurred_at, action, category, status, summary, actor_network, details
      FROM admin_audit_events
      WHERE occurred_at >= NOW() - ($1 * INTERVAL '1 millisecond')
      ORDER BY occurred_at DESC, id DESC
      LIMIT $2
    `, [ADMIN_AUDIT_RETENTION_MS, ADMIN_AUDIT_LIMIT]);
    return result.rows.map((row) => ({
      timestamp: normalizeTimestamp(row.occurred_at),
      action: row.action,
      category: row.category,
      status: row.status,
      summary: row.summary,
      actorNetwork: row.actor_network,
      details: row.details ?? null,
    }));
  };

  const cleanup = async () => {
    if (!isConfigured()) return;
    const policies = [
      ['report_activity_events', 'occurred_at', REPORT_RETENTION_MS, REPORT_LIMIT],
      ['ai_usage_events', 'created_at', AI_USAGE_RETENTION_MS, AI_USAGE_LIMIT],
      ['admin_audit_events', 'occurred_at', ADMIN_AUDIT_RETENTION_MS, ADMIN_AUDIT_LIMIT],
    ];
    for (const [table, timestampColumn, retentionMs, limit] of policies) {
      await db.query(`DELETE FROM ${table} WHERE ${timestampColumn} < NOW() - ($1 * INTERVAL '1 millisecond')`, [retentionMs]);
      await db.query(`
        DELETE FROM ${table}
        WHERE id IN (
          SELECT id FROM ${table}
          ORDER BY ${timestampColumn} DESC, id DESC
          OFFSET $1
        )
      `, [limit]);
    }
  };

  const readLegacyFile = async (filename) => {
    try {
      return await fs.readFile(filename, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  };

  const importLegacySource = async (source, filename, importer) => {
    const content = await readLegacyFile(filename);
    if (content === null || content.trim() === '') return 0;
    const checksum = sha256(content);
    return db.transaction(async (query) => {
      const previous = await query(
        'SELECT 1 FROM legacy_data_imports WHERE source = $1 AND checksum = $2',
        [source, checksum],
      );
      if (previous.rowCount > 0) return 0;
      const rowsImported = await importer({ content, query, source });
      await query(`
        INSERT INTO legacy_data_imports (source, checksum, rows_imported)
        VALUES ($1, $2, $3)
        ON CONFLICT (source, checksum) DO NOTHING
      `, [source, checksum, rowsImported]);
      log.info({ source, file: filename, rowsImported }, 'Imported legacy application data into PostgreSQL');
      return rowsImported;
    });
  };

  const initialize = async () => {
    if (!isConfigured()) return { configured: false, rowsImported: 0 };
    let rowsImported = 0;
    const importSetting = (key) => async ({ content, query }) => {
      let value;
      try {
        value = JSON.parse(content);
      } catch (error) {
        log.warn({ err: error, key }, 'Skipping malformed legacy admin setting');
        return 0;
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
      const result = await query(`
        INSERT INTO admin_settings (key, value)
        VALUES ($1, $2::jsonb)
        ON CONFLICT (key) DO NOTHING
      `, [key, JSON.stringify(value)]);
      return result.rowCount;
    };
    rowsImported += await importLegacySource('ai-settings', legacyFiles.aiSettings, importSetting('ai_settings'));
    rowsImported += await importLegacySource('feature-flags', legacyFiles.featureFlags, importSetting('feature_flags'));
    rowsImported += await importLegacySource('report-activity', legacyFiles.reportActivity, async ({ content, query, source }) => {
      const entries = parseNdjson(content)
        .filter(({ record }) => (
          withinRetention(record.timestamp, REPORT_RETENTION_MS, now())
          && !(typeof record.name === 'string' && record.name.startsWith('Route waypoint:'))
        ))
        .slice(-REPORT_LIMIT);
      let imported = 0;
      for (const entry of entries) {
        if (await insertReportActivityWith(query, entry.record, legacyKey(source, entry.raw))) imported += 1;
      }
      return imported;
    });
    rowsImported += await importLegacySource('ai-usage', legacyFiles.aiUsage, async ({ content, query, source }) => {
      const entries = parseNdjson(content)
        .filter(({ record }) => withinRetention(record.timestamp, AI_USAGE_RETENTION_MS, now()))
        .slice(-AI_USAGE_LIMIT);
      let imported = 0;
      for (const entry of entries) {
        const importedKey = legacyKey(source, entry.raw);
        const pricedRecord = Object.hasOwn(entry.record, 'estimatedCostUsd')
          ? entry.record
          : {
            ...entry.record,
            ...estimateAIUsageCost({
              provider: entry.record.provider,
              model: entry.record.model,
              usage: entry.record,
              timestamp: entry.record.timestamp,
            }),
          };
        if (await insertAIUsageWith(query, pricedRecord, {
          idempotencyKey: `legacy:${importedKey}`,
          legacyId: importedKey,
        })) imported += 1;
      }
      return imported;
    });
    rowsImported += await importLegacySource('admin-audit', legacyFiles.adminAudit, async ({ content, query, source }) => {
      const entries = parseNdjson(content)
        .filter(({ record }) => withinRetention(record.timestamp, ADMIN_AUDIT_RETENTION_MS, now()))
        .slice(-ADMIN_AUDIT_LIMIT);
      let imported = 0;
      for (const entry of entries) {
        if (await insertAdminAuditWith(query, entry.record, legacyKey(source, entry.raw))) imported += 1;
      }
      return imported;
    });
    await cleanup();
    if (!cleanupTimer) {
      cleanupTimer = setInterval(() => {
        cleanup().catch((error) => log.error({ err: error }, 'PostgreSQL analytics retention cleanup failed'));
      }, 24 * 60 * 60 * 1000);
      cleanupTimer.unref();
    }
    return { configured: true, rowsImported };
  };

  return {
    get configured() { return isConfigured(); },
    clearAIUsage,
    clearReportActivity,
    cleanup,
    getAdminSetting,
    initialize,
    insertAdminAudit,
    insertAIUsage,
    insertReportActivity,
    listAdminAudit,
    listAIUsage,
    listReportActivity,
    setAdminSetting,
  };
};

const appDataStore = createAppDataStore();

module.exports = {
  ADMIN_AUDIT_LIMIT,
  AI_USAGE_LIMIT,
  REPORT_LIMIT,
  aiUsageParams,
  appDataStore,
  createAppDataStore,
  mapAIUsageRow,
  parseNdjson,
};
