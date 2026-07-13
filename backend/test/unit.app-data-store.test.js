const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  aiUsageParams,
  createAppDataStore,
  mapAIUsageRow,
  parseNdjson,
} = require('../src/db/app-data-store');

test('parses valid NDJSON records and skips malformed lines', () => {
  expect(parseNdjson('{"ok":true}\nnot-json\n[1,2]\n{"value":2}\n')).toEqual([
    { record: { ok: true }, raw: '{"ok":true}', lineNumber: 1 },
    { record: { value: 2 }, raw: '{"value":2}', lineNumber: 4 },
  ]);
});

test('maps AI usage between application and PostgreSQL fields', () => {
  const params = aiUsageParams({
    timestamp: '2026-07-12T12:00:00.000Z',
    userId: '8c696be4-e175-4b6a-965b-82bdf3758e0c',
    provider: 'openai',
    model: 'gpt-test',
    feature: 'brief',
    status: 'success',
    inputTokens: 12,
    outputTokens: 3,
    totalTokens: 15,
    durationMs: 25,
    estimatedCostUsd: 0.001234,
    pricingMatched: true,
    pricingVersion: 'test',
  }, { idempotencyKey: 'usage-1', legacyId: 'legacy-secret' });

  expect(params).toEqual(expect.arrayContaining(['usage-1', 12, 3, 15, 1234, 25]));
  expect(params[1]).toBe('8c696be4-e175-4b6a-965b-82bdf3758e0c');
  expect(mapAIUsageRow({
    user_id: '8c696be4-e175-4b6a-965b-82bdf3758e0c',
    created_at: '2026-07-12T12:00:00.000Z',
    provider: 'openai',
    model: 'gpt-test',
    feature: 'brief',
    status: 'success',
    input_tokens: 12,
    output_tokens: 3,
    total_tokens: 15,
    duration_ms: 25,
    cost_usd_micros: '1234',
    metadata: { pricingMatched: true, pricingVersion: 'test', legacyId: 'legacy-secret' },
  })).toEqual({
    userId: '8c696be4-e175-4b6a-965b-82bdf3758e0c',
    timestamp: '2026-07-12T12:00:00.000Z',
    provider: 'openai',
    model: 'gpt-test',
    feature: 'brief',
    status: 'success',
    durationMs: 25,
    inputTokens: 12,
    outputTokens: 3,
    totalTokens: 15,
    estimatedCostUsd: 0.001234,
    pricingMatched: true,
    pricingVersion: 'test',
  });
});

test('imports each legacy admin and analytics store once through transactions', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'conditions-legacy-data-'));
  const now = Date.parse('2026-07-12T12:00:00.000Z');
  const legacyFiles = {
    aiSettings: path.join(directory, 'ai-settings.json'),
    featureFlags: path.join(directory, 'feature-flags.json'),
    reportActivity: path.join(directory, 'report-logs.ndjson'),
    aiUsage: path.join(directory, 'ai-usage.ndjson'),
    adminAudit: path.join(directory, 'admin-audit.ndjson'),
  };
  fs.writeFileSync(legacyFiles.aiSettings, JSON.stringify({ enabled: true, provider: 'openai' }));
  fs.writeFileSync(legacyFiles.featureFlags, JSON.stringify({ tripPlanning: false }));
  fs.writeFileSync(legacyFiles.reportActivity, `${JSON.stringify({ timestamp: '2026-07-12T11:00:00.000Z', name: 'Rainier' })}\n`);
  fs.writeFileSync(legacyFiles.aiUsage, `${JSON.stringify({
    timestamp: '2026-07-12T11:00:00.000Z',
    provider: 'openai',
    model: 'gpt-5',
    feature: 'brief',
    status: 'success',
  })}\n`);
  fs.writeFileSync(legacyFiles.adminAudit, `${JSON.stringify({
    timestamp: '2026-07-12T11:00:00.000Z',
    action: 'settings.updated',
    category: 'configuration',
    status: 'success',
    summary: 'Updated settings',
  })}\n`);

  const query = jest.fn(async (sql) => {
    if (sql.includes('SELECT 1 FROM legacy_data_imports')) return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [] };
  });
  const db = {
    configured: true,
    query,
    transaction: jest.fn(async (callback) => callback(query)),
  };
  const log = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
  const store = createAppDataStore({ db, legacyFiles, log, now: () => now });

  try {
    await expect(store.initialize()).resolves.toEqual({ configured: true, rowsImported: 5 });
    expect(db.transaction).toHaveBeenCalledTimes(5);
    expect(log.info).toHaveBeenCalledTimes(5);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO admin_settings'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO report_activity_events'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO ai_usage_events'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO admin_audit_events'))).toBe(true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
