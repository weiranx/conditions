'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_HISTORY_LIMIT = 7 * 24 * 12;
const MAX_HISTORY_LIMIT = 10_000;

const normalizeHistoryLimit = (value, fallback = DEFAULT_HISTORY_LIMIT) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_HISTORY_LIMIT);
};

const normalizeHistoryEntry = (entry) => {
  const checkedAtMs = Date.parse(entry?.checkedAt);
  if (!Number.isFinite(checkedAtMs) || typeof entry?.healthy !== 'boolean') return null;
  return {
    checkedAt: new Date(checkedAtMs).toISOString(),
    healthy: entry.healthy,
    summary: String(entry.summary || '').replace(/[\r\n]+/gu, ' ').trim().slice(0, 500),
    statusCode: Number.isInteger(entry.statusCode) ? entry.statusCode : null,
    durationMs: Number.isFinite(entry.durationMs) && entry.durationMs >= 0
      ? Math.round(entry.durationMs)
      : null,
    action: String(entry.action || 'unknown').trim().slice(0, 80) || 'unknown',
    alertError: entry.alertError
      ? String(entry.alertError).replace(/[\r\n]+/gu, ' ').trim().slice(0, 300)
      : null,
  };
};

const buildHealthHistorySummary = (entries) => {
  const healthy = entries.filter((entry) => entry.healthy).length;
  const unhealthy = entries.length - healthy;
  return {
    total: entries.length,
    healthy,
    unhealthy,
    availabilityPercent: entries.length ? Math.round((healthy / entries.length) * 1000) / 10 : null,
    lastCheckAt: entries[0]?.checkedAt || null,
    lastUnhealthyAt: entries.find((entry) => !entry.healthy)?.checkedAt || null,
  };
};

const createFileHealthHistoryStore = (historyPath, { limit = DEFAULT_HISTORY_LIMIT } = {}) => {
  const historyLimit = normalizeHistoryLimit(limit);
  const readEntries = async () => {
    try {
      const parsed = JSON.parse(await fs.readFile(historyPath, 'utf8'));
      if (!Array.isArray(parsed)) throw new TypeError('Health monitor history must be an array.');
      return parsed.map(normalizeHistoryEntry).filter(Boolean);
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  };

  return {
    async append(entry) {
      const normalized = normalizeHistoryEntry(entry);
      if (!normalized) throw new TypeError('Health monitor history entry is invalid.');
      const entries = [...await readEntries(), normalized].slice(-historyLimit);
      await fs.mkdir(path.dirname(historyPath), { recursive: true });
      const temporaryPath = `${historyPath}.tmp`;
      await fs.writeFile(temporaryPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
      await fs.rename(temporaryPath, historyPath);
      return normalized;
    },
    async list() {
      return (await readEntries()).reverse();
    },
  };
};

module.exports = {
  DEFAULT_HISTORY_LIMIT,
  buildHealthHistorySummary,
  createFileHealthHistoryStore,
  normalizeHistoryEntry,
  normalizeHistoryLimit,
};
