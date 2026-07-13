const fs = require('node:fs');
const path = require('node:path');
const { logger } = require('./logger');
const { estimateAIUsageCost } = require('./ai-pricing');

const MAX_AI_USAGE_ENTRIES = 2000;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const USAGE_FILE = path.resolve(__dirname, '../../data/ai-usage.ndjson');

const aiUsageEntries = [];

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

const isWithinOneWeek = (entry) =>
  Date.now() - new Date(entry.timestamp).getTime() <= ONE_WEEK_MS;

const rewriteFile = () => {
  try {
    const content = aiUsageEntries.length
      ? `${aiUsageEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
      : '';
    fs.writeFileSync(USAGE_FILE, content, 'utf8');
    return true;
  } catch (error) {
    logger.error({ err: error }, 'ai-usage rewrite failed');
    return false;
  }
};

const trimOldEntries = () => {
  const before = aiUsageEntries.length;
  if (before === 0) return;
  const firstRecent = aiUsageEntries.findIndex(isWithinOneWeek);
  if (firstRecent === -1) aiUsageEntries.splice(0);
  else if (firstRecent > 0) aiUsageEntries.splice(0, firstRecent);
  if (aiUsageEntries.length !== before) rewriteFile();
};

try {
  fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
  if (fs.existsSync(USAGE_FILE)) {
    const parsed = fs.readFileSync(USAGE_FILE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
    aiUsageEntries.push(...parsed.filter(isWithinOneWeek).slice(-MAX_AI_USAGE_ENTRIES));
    if (aiUsageEntries.length !== parsed.length) rewriteFile();
  }
} catch (error) {
  logger.error({ err: error }, 'ai-usage initialization failed');
}

setInterval(trimOldEntries, 24 * 60 * 60 * 1000).unref();

const recordAIUsage = ({ provider, model, feature, status = 'success', usage, durationMs }) => {
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
  if (aiUsageEntries.length >= MAX_AI_USAGE_ENTRIES) aiUsageEntries.shift();
  aiUsageEntries.push(record);
  try {
    fs.appendFileSync(USAGE_FILE, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (error) {
    logger.error({ err: error }, 'ai-usage append failed');
  }
};

const getAIUsageEntries = () => {
  trimOldEntries();
  return [...aiUsageEntries].reverse().map((entry) => {
    if (Object.hasOwn(entry, 'estimatedCostUsd')) return entry;
    return {
      ...entry,
      ...estimateAIUsageCost({
        provider: entry.provider,
        model: entry.model,
        usage: entry,
        timestamp: entry.timestamp,
      }),
    };
  });
};

const clearAIUsageEntries = () => {
  const previous = [...aiUsageEntries];
  aiUsageEntries.splice(0);
  if (!rewriteFile()) {
    aiUsageEntries.push(...previous);
    const error = new Error('AI usage history could not be cleared');
    error.code = 'AI_USAGE_CLEAR_FAILED';
    throw error;
  }
  return previous.length;
};

module.exports = { clearAIUsageEntries, getAIUsageEntries, normalizeTokenUsage, recordAIUsage };
