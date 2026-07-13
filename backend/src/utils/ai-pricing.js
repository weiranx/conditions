'use strict';

const ONE_MILLION = 1_000_000;
const PRICING_VERSION = '2026-07-12';
const CLAUDE_SONNET_5_PROMO_END = Date.parse('2026-09-01T00:00:00.000Z');

const asTokenCount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
};

const rates = (inputPerMillion, outputPerMillion, cachedInputPerMillion = inputPerMillion * 0.1) => ({
  inputPerMillion,
  outputPerMillion,
  cachedInputPerMillion,
  cacheWrite5mPerMillion: inputPerMillion * 1.25,
  cacheWrite1hPerMillion: inputPerMillion * 2,
});

const OPENAI_PRICING = [
  [/^gpt-5\.6-sol(?:-|$)/, rates(5, 30)],
  [/^gpt-5\.6-terra(?:-|$)/, rates(2.5, 15)],
  [/^gpt-5\.6-luna(?:-|$)/, rates(1, 6)],
  [/^gpt-5\.5-pro(?:-|$)/, rates(30, 180, 30)],
  [/^gpt-5\.5(?:-|$)/, rates(5, 30)],
  [/^gpt-5\.4-pro(?:-|$)/, rates(30, 180, 30)],
  [/^gpt-5\.4-mini(?:-|$)/, rates(0.75, 4.5)],
  [/^gpt-5\.4-nano(?:-|$)/, rates(0.2, 1.25)],
  [/^gpt-5\.4(?:-|$)/, rates(2.5, 15)],
  [/^gpt-5\.3-codex(?:-|$)/, rates(1.75, 14)],
  [/^gpt-5\.2-pro(?:-|$)/, rates(21, 168, 21)],
  [/^gpt-5\.2(?:-|$)/, rates(1.75, 14)],
  [/^gpt-5-mini(?:-|$)/, rates(0.25, 2)],
  [/^gpt-5-nano(?:-|$)/, rates(0.05, 0.4)],
  [/^gpt-5(?:-|$)/, rates(1.25, 10)],
  [/^gpt-4\.1-mini(?:-|$)/, rates(0.4, 1.6)],
  [/^gpt-4\.1-nano(?:-|$)/, rates(0.1, 0.4)],
  [/^gpt-4\.1(?:-|$)/, rates(2, 8)],
  [/^gpt-4o-mini(?:-|$)/, rates(0.15, 0.6)],
  [/^gpt-4o(?:-|$)/, rates(2.5, 10)],
  [/^o3-pro(?:-|$)/, rates(20, 80, 20)],
  [/^o3(?:-|$)/, rates(2, 8)],
  [/^o4-mini(?:-|$)/, rates(1.1, 4.4)],
];

const resolveAnthropicPricing = (model, timestamp) => {
  if (/^claude-(?:fable|mythos)-5(?:-|$)/.test(model)) return rates(10, 50);
  if (/^claude-opus-4-(?:5|6|7|8)(?:-|$)/.test(model)) return rates(5, 25);
  if (/^claude-opus-(?:4(?:-|$)|4-1(?:-|$)|3(?:-|$))/.test(model)) return rates(15, 75);
  if (/^claude-sonnet-5(?:-|$)/.test(model)) {
    const occurredAt = new Date(timestamp).getTime();
    return Number.isFinite(occurredAt) && occurredAt < CLAUDE_SONNET_5_PROMO_END
      ? rates(2, 10)
      : rates(3, 15);
  }
  if (/^claude-sonnet-4(?:-|$)/.test(model)) return rates(3, 15);
  if (/^claude-(?:3-7-sonnet|3-5-sonnet)(?:-|$)/.test(model)) return rates(3, 15);
  if (/^claude-haiku-4-5(?:-|$)/.test(model)) return rates(1, 5);
  if (/^claude-3-5-haiku(?:-|$)/.test(model)) return rates(0.8, 4);
  if (/^claude-3-haiku(?:-|$)/.test(model)) return rates(0.25, 1.25);
  return null;
};

const resolveAIModelPricing = ({ provider, model, timestamp = new Date().toISOString() } = {}) => {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const normalizedModel = String(model || '').trim().toLowerCase();
  if (!normalizedModel) return null;
  if (normalizedProvider === 'openai') {
    return OPENAI_PRICING.find(([pattern]) => pattern.test(normalizedModel))?.[1] ?? null;
  }
  if (normalizedProvider === 'anthropic') return resolveAnthropicPricing(normalizedModel, timestamp);
  return null;
};

const normalizeBillableTokens = (usage = {}) => {
  const rawInputTokens = asTokenCount(usage.inputTokens ?? usage.input_tokens);
  const outputTokens = asTokenCount(usage.outputTokens ?? usage.output_tokens);
  const inputDetails = usage.inputTokenDetails ?? usage.input_tokens_details ?? usage.inputTokensDetails ?? {};
  const topLevelCacheRead = asTokenCount(usage.cache_read_input_tokens ?? usage.cacheReadInputTokens);
  const nestedCacheRead = asTokenCount(
    inputDetails.cached_tokens ?? inputDetails.cacheReadTokens ?? inputDetails.cachedTokens,
  );
  const cacheReadTokens = Math.max(topLevelCacheRead, nestedCacheRead);

  const cacheCreation = usage.cache_creation ?? usage.cacheCreation ?? {};
  const topLevelCacheWrite = asTokenCount(usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens);
  const nestedCacheWrite = asTokenCount(inputDetails.cacheWriteTokens ?? inputDetails.cache_write_tokens);
  const cacheWrite5mTokens = asTokenCount(
    cacheCreation.ephemeral_5m_input_tokens ?? cacheCreation.ephemeral5mInputTokens,
  );
  const cacheWrite1hTokens = asTokenCount(
    cacheCreation.ephemeral_1h_input_tokens ?? cacheCreation.ephemeral1hInputTokens,
  );
  const classifiedCacheWrites = cacheWrite5mTokens + cacheWrite1hTokens;
  const unclassifiedCacheWrites = Math.max(0, Math.max(topLevelCacheWrite, nestedCacheWrite) - classifiedCacheWrites);

  const topLevelAnthropicCacheTokens = topLevelCacheRead + topLevelCacheWrite;
  const totalInputTokens = rawInputTokens + topLevelAnthropicCacheTokens;
  const uncachedInputTokens = Math.max(
    0,
    totalInputTokens - cacheReadTokens - cacheWrite5mTokens - cacheWrite1hTokens - unclassifiedCacheWrites,
  );

  return {
    uncachedInputTokens,
    cacheReadTokens,
    cacheWrite5mTokens: cacheWrite5mTokens + unclassifiedCacheWrites,
    cacheWrite1hTokens,
    outputTokens,
  };
};

const estimateAIUsageCost = ({ provider, model, usage, timestamp } = {}) => {
  const pricing = resolveAIModelPricing({ provider, model, timestamp });
  if (!pricing) {
    return { estimatedCostUsd: null, pricingMatched: false, pricingVersion: PRICING_VERSION };
  }
  const tokens = normalizeBillableTokens(usage);
  const estimatedCostUsd = (
    tokens.uncachedInputTokens * pricing.inputPerMillion
    + tokens.cacheReadTokens * pricing.cachedInputPerMillion
    + tokens.cacheWrite5mTokens * pricing.cacheWrite5mPerMillion
    + tokens.cacheWrite1hTokens * pricing.cacheWrite1hPerMillion
    + tokens.outputTokens * pricing.outputPerMillion
  ) / ONE_MILLION;

  return {
    estimatedCostUsd: Math.round(estimatedCostUsd * 100_000_000) / 100_000_000,
    pricingMatched: true,
    pricingVersion: PRICING_VERSION,
  };
};

module.exports = {
  PRICING_VERSION,
  estimateAIUsageCost,
  normalizeBillableTokens,
  resolveAIModelPricing,
};
