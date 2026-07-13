'use strict';

const { appDataStore } = require('../db/app-data-store');
const { estimateAIUsageCost } = require('./ai-pricing');

const MAX_AI_USAGE_ENTRIES = 2000;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const memoryEntries = [];

const asNonNegativeInteger = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
};

const normalizeTokenUsage = (usage = {}) => {
  const inputTokens = asNonNegativeInteger(usage.inputTokens ?? usage.input_tokens);
  const outputTokens = asNonNegativeInteger(usage.outputTokens ?? usage.output_tokens);
  const reportedTotal = asNonNegativeInteger(usage.totalTokens ?? usage.total_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: Math.max(reportedTotal, inputTokens + outputTokens),
  };
};

const isWithinOneWeek = (entry) => Date.now() - new Date(entry.timestamp).getTime() <= ONE_WEEK_MS;

const trimMemory = () => {
  const recent = memoryEntries.filter(isWithinOneWeek).slice(-MAX_AI_USAGE_ENTRIES);
  memoryEntries.splice(0, memoryEntries.length, ...recent);
};

const recordAIUsage = async ({ provider, model, feature, status = 'success', usage, durationMs }) => {
  const tokens = normalizeTokenUsage(usage);
  const timestamp = new Date().toISOString();
  const normalizedProvider = String(provider || 'unknown').slice(0, 40);
  const normalizedModel = String(model || 'unknown').slice(0, 120);
  const record = {
    timestamp,
    provider: normalizedProvider,
    model: normalizedModel,
    feature: String(feature || 'generation').slice(0, 80),
    status: status === 'success' ? 'success' : 'error',
    durationMs: asNonNegativeInteger(durationMs),
    ...tokens,
    ...estimateAIUsageCost({
      provider: normalizedProvider,
      model: normalizedModel,
      usage,
      timestamp,
    }),
  };
  if (appDataStore.configured) await appDataStore.insertAIUsage(record);
  else {
    if (memoryEntries.length >= MAX_AI_USAGE_ENTRIES) memoryEntries.shift();
    memoryEntries.push(record);
  }
  return record;
};

const getAIUsageEntries = async () => {
  if (appDataStore.configured) return appDataStore.listAIUsage();
  trimMemory();
  return [...memoryEntries].reverse();
};

const clearAIUsageEntries = async () => {
  if (appDataStore.configured) return appDataStore.clearAIUsage();
  const cleared = memoryEntries.length;
  memoryEntries.splice(0);
  return cleared;
};

module.exports = { clearAIUsageEntries, getAIUsageEntries, normalizeTokenUsage, recordAIUsage };
