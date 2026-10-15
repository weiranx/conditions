'use strict';

const ONE_MILLION = 1_000_000;
// List prices from the providers' pricing pages on this date (standard tier, USD per million tokens).
const PRICING_VERSION = '2026-10-14';
const GEMINI_4_ARGON_PROMO_END = Date.parse('2026-12-01T00:00:00.000Z');
const GEMINI_FLASH_PROMO_END = Date.parse('2027-01-01T00:00:00.000Z');
// Spend limits charge a model with no known price at this rate (USD per
// million tokens) so an unpriced model cannot run free of the monthly limit.
const UNPRICED_MODEL_USD_PER_MILLION_TOKENS = 10;

const asTokenCount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
};

/**
 * One rate card. Cached input defaults to a tenth of input and cache writes to
 * Anthropic's 1.25x (5-minute) and 2x (1-hour) multiples. `longContext`
 * replaces the card when a request's prompt exceeds `aboveInputTokens`.
 */
const rates = (inputPerMillion, outputPerMillion, {
  cachedInput = inputPerMillion * 0.1,
  cacheWrite5m = inputPerMillion * 1.25,
  cacheWrite1h = inputPerMillion * 2,
  longContext = null,
} = {}) => ({
  inputPerMillion,
  outputPerMillion,
  cachedInputPerMillion: cachedInput,
  cacheWrite5mPerMillion: cacheWrite5m,
  cacheWrite1hPerMillion: cacheWrite1h,
  longContext,
});

// OpenAI and Gemini charge nothing extra to write a cache unless a price is listed.
const openAIRates = (input, output, { cachedInput = input * 0.1, cacheWrite = input, longContext = null } = {}) => rates(
  input,
  output,
  { cachedInput, cacheWrite5m: cacheWrite, cacheWrite1h: cacheWrite, longContext },
);
// OpenAI's long-context rates apply above 272K input tokens.
const openAILong = (...args) => ({ aboveInputTokens: 272_000, rates: openAIRates(...args) });

const OPENAI_PRICING = [
  [/^gpt-6\.1-sol(?:-|$)/, openAIRates(2, 10, {
    cachedInput: 0.1, cacheWrite: 2.5, longContext: openAILong(4, 15, { cachedInput: 0.2, cacheWrite: 5 }),
  })],
  [/^gpt-6-astra(?:-|$)/, openAIRates(10, 50, {
    cacheWrite: 12.5, longContext: openAILong(20, 75, { cacheWrite: 25 }),
  })],
  [/^gpt-6-sol(?:-|$)/, openAIRates(2, 10, {
    cacheWrite: 2.5, longContext: openAILong(4, 15, { cacheWrite: 5 }),
  })],
  [/^gpt-6-luna(?:-|$)/, openAIRates(0.1, 0.5, {
    cacheWrite: 0.125, longContext: openAILong(0.2, 0.75, { cacheWrite: 0.25 }),
  })],
  [/^gpt-5\.6-sol(?:-|$)/, openAIRates(4, 20, {
    cacheWrite: 5, longContext: openAILong(8, 30, { cacheWrite: 10 }),
  })],
  [/^gpt-5\.6-terra(?:-|$)/, openAIRates(2, 12, {
    cacheWrite: 2.5, longContext: openAILong(4, 18, { cacheWrite: 5 }),
  })],
  [/^gpt-5\.6-luna(?:-|$)/, openAIRates(0.2, 1.2, {
    cacheWrite: 0.25, longContext: openAILong(0.4, 1.8, { cacheWrite: 0.5 }),
  })],
  [/^gpt-5\.5-pro(?:-|$)/, openAIRates(30, 180, { cachedInput: 30, longContext: openAILong(60, 270, { cachedInput: 60 }) })],
  [/^gpt-5\.5(?:-|$)/, openAIRates(5, 30, { longContext: openAILong(10, 45) })],
  [/^gpt-5\.4-pro(?:-|$)/, openAIRates(30, 180, { cachedInput: 30, longContext: openAILong(60, 270, { cachedInput: 60 }) })],
  [/^gpt-5\.4-mini(?:-|$)/, openAIRates(0.75, 4.5)],
  [/^gpt-5\.4-nano(?:-|$)/, openAIRates(0.2, 1.25)],
  [/^gpt-5\.4(?:-|$)/, openAIRates(2.5, 15, { longContext: openAILong(5, 22.5) })],
  [/^gpt-5\.3-codex(?:-|$)/, openAIRates(1.75, 14)],
  [/^gpt-5\.2-pro(?:-|$)/, openAIRates(21, 168, { cachedInput: 21 })],
  [/^gpt-5\.2(?:-|$)/, openAIRates(1.75, 14)],
  [/^gpt-5-mini(?:-|$)/, openAIRates(0.25, 2)],
  [/^gpt-5-nano(?:-|$)/, openAIRates(0.05, 0.4)],
  [/^gpt-5(?:-|$)/, openAIRates(1.25, 10)],
  [/^gpt-4\.1-mini(?:-|$)/, openAIRates(0.4, 1.6, { cachedInput: 0.1 })],
  [/^gpt-4\.1-nano(?:-|$)/, openAIRates(0.1, 0.4, { cachedInput: 0.025 })],
  [/^gpt-4\.1(?:-|$)/, openAIRates(2, 8, { cachedInput: 0.5 })],
  [/^gpt-4o-mini(?:-|$)/, openAIRates(0.15, 0.6, { cachedInput: 0.075 })],
  [/^gpt-4o-2024-05-13$/, openAIRates(5, 15, { cachedInput: 5 })],
  [/^gpt-4o(?:-|$)/, openAIRates(2.5, 10, { cachedInput: 1.25 })],
  [/^o3-pro(?:-|$)/, openAIRates(20, 80, { cachedInput: 20 })],
  [/^o3(?:-|$)/, openAIRates(2, 8, { cachedInput: 0.5 })],
  [/^o4-mini(?:-|$)/, openAIRates(1.1, 4.4, { cachedInput: 0.275 })],
];

// More specific IDs first: `claude-opus-5` would also match `claude-opus-5-5`.
const ANTHROPIC_PRICING = [
  [/^claude-(?:fable|mythos)-5-1(?:-|$)/, rates(10, 50, { cachedInput: 0.25 })],
  [/^claude-(?:fable|mythos)-5(?:-|$)/, rates(10, 50)],
  [/^claude-opus-5-5(?:-|$)/, rates(4, 20, { cachedInput: 0.2 })],
  [/^claude-opus-5(?:-|$)/, rates(5, 25)],
  [/^claude-opus-4-(?:5|6|7|8)(?:-|$)/, rates(5, 25)],
  [/^claude-opus-(?:4|4-1|3)(?:-|$)/, rates(15, 75)],
  [/^claude-sonnet-5-5(?:-|$)/, rates(2, 10)],
  [/^claude-sonnet-5(?:-|$)/, rates(2, 10)],
  [/^claude-sonnet-4(?:-|$)/, rates(3, 15)],
  [/^claude-(?:3-7-sonnet|3-5-sonnet)(?:-|$)/, rates(3, 15)],
  // Claude Haiku 5.5 bills a prompt over 100K tokens on a second rate card.
  [/^claude-haiku-5-5(?:-|$)/, rates(0.1, 0.5, {
    longContext: { aboveInputTokens: 100_000, rates: rates(0.5, 2.5) },
  })],
  [/^claude-haiku-4-5(?:-|$)/, rates(1, 5)],
  [/^claude-3-5-haiku(?:-|$)/, rates(0.8, 4)],
  [/^claude-3-haiku(?:-|$)/, rates(0.25, 1.25)],
];

const before = (timestamp, cutoff) => {
  const occurredAt = new Date(timestamp).getTime();
  return Number.isFinite(occurredAt) && occurredAt < cutoff;
};
// Gemini Pro models bill a prompt over 200K tokens on a second rate card.
const geminiLong = (...args) => ({ aboveInputTokens: 200_000, rates: openAIRates(...args) });

const resolveGeminiPricing = (model, timestamp) => {
  if (/^gemini-4-argon(?:-|$)/.test(model)) {
    return before(timestamp, GEMINI_4_ARGON_PROMO_END) ? openAIRates(2, 10) : openAIRates(4, 20);
  }
  // gemini-3.7-flash is deprecated and served by 3.8 Flash at the same price.
  if (/^gemini-3\.[678]-flash(?:-|$)/.test(model)) {
    return before(timestamp, GEMINI_FLASH_PROMO_END) ? openAIRates(0.75, 3.75) : openAIRates(1.5, 7.5);
  }
  if (/^gemini-3\.5-flash-lite(?:-|$)/.test(model)) return openAIRates(0.3, 2.5);
  if (/^gemini-3(?:\.1)?-pro(?:-|$)/.test(model)) return openAIRates(2, 12, { longContext: geminiLong(4, 18) });
  if (/^gemini-3-flash(?:-|$)/.test(model)) return openAIRates(0.5, 3);
  if (/^gemini-2\.5-pro(?:-|$)/.test(model)) return openAIRates(1.25, 10, { longContext: geminiLong(2.5, 15) });
  if (/^gemini-2\.5-flash-lite(?:-|$)/.test(model)) return openAIRates(0.1, 0.4);
  if (/^gemini-2\.5-flash(?:-|$)/.test(model)) return openAIRates(0.3, 2.5);
  return null;
};

const resolveAIModelPricing = ({ provider, model, timestamp = new Date().toISOString() } = {}) => {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const normalizedModel = String(model || '').trim().toLowerCase();
  if (!normalizedModel) return null;
  const match = (table) => table.find(([pattern]) => pattern.test(normalizedModel))?.[1] ?? null;
  if (normalizedProvider === 'openai') return match(OPENAI_PRICING);
  if (normalizedProvider === 'anthropic') return match(ANTHROPIC_PRICING);
  if (normalizedProvider === 'gemini') return resolveGeminiPricing(normalizedModel, timestamp);
  return null;
};

const normalizeBillableTokens = (usage = {}) => {
  const rawInputTokens = asTokenCount(usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = asTokenCount(usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens);
  const inputDetails = usage.inputTokenDetails
    ?? usage.input_tokens_details
    ?? usage.inputTokensDetails
    ?? usage.prompt_tokens_details
    ?? {};
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
  const promptTokens = tokens.uncachedInputTokens + tokens.cacheReadTokens
    + tokens.cacheWrite5mTokens + tokens.cacheWrite1hTokens;
  const card = pricing.longContext && promptTokens > pricing.longContext.aboveInputTokens
    ? pricing.longContext.rates
    : pricing;
  const estimatedCostUsd = (
    tokens.uncachedInputTokens * card.inputPerMillion
    + tokens.cacheReadTokens * card.cachedInputPerMillion
    + tokens.cacheWrite5mTokens * card.cacheWrite5mPerMillion
    + tokens.cacheWrite1hTokens * card.cacheWrite1hPerMillion
    + tokens.outputTokens * card.outputPerMillion
  ) / ONE_MILLION;

  return {
    estimatedCostUsd: Math.round(estimatedCostUsd * 100_000_000) / 100_000_000,
    pricingMatched: true,
    pricingVersion: PRICING_VERSION,
  };
};

module.exports = {
  PRICING_VERSION,
  UNPRICED_MODEL_USD_PER_MILLION_TOKENS,
  estimateAIUsageCost,
  normalizeBillableTokens,
  resolveAIModelPricing,
};
