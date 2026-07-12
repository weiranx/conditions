const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { logger } = require('./logger');
const { recordAIUsage } = require('./ai-usage');

const SUPPORTED_PROVIDERS = new Set(['openai', 'anthropic']);
const AI_PROVIDER = String(process.env.AI_PROVIDER || 'openai').trim().toLowerCase();
if (!SUPPORTED_PROVIDERS.has(AI_PROVIDER)) {
  throw new Error(`AI_PROVIDER must be one of: ${[...SUPPORTED_PROVIDERS].join(', ')}`);
}

const MODEL_CONFIG = {
  openai: {
    primary: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
    fast: process.env.OPENAI_FAST_MODEL || 'gpt-5.6-luna',
    configured: Boolean(process.env.OPENAI_API_KEY),
  },
  anthropic: {
    primary: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
    fast: process.env.ANTHROPIC_FAST_MODEL || 'claude-haiku-4-5-20251001',
    configured: Boolean(process.env.ANTHROPIC_API_KEY),
  },
};

const parseTimeout = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1000 ? Math.min(parsed, 120000) : fallback;
};

const PRIMARY_TIMEOUT_MS = parseTimeout(process.env.AI_PRIMARY_TIMEOUT_MS, 28000);
const FAST_TIMEOUT_MS = parseTimeout(process.env.AI_FAST_TIMEOUT_MS, 8000);
const FALLBACK_PROVIDER = AI_PROVIDER === 'openai' ? 'anthropic' : 'openai';

let openAIClient;
let anthropicClient;

const getOpenAIClient = () => {
  if (!openAIClient) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
    openAIClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openAIClient;
};

const getAnthropicClient = () => {
  if (!anthropicClient) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
};

const resolveModel = (provider, { model, tier = 'primary' } = {}, allowExplicitModel = true) => {
  if (allowExplicitModel && model) return model;
  return tier === 'fast' ? MODEL_CONFIG[provider].fast : MODEL_CONFIG[provider].primary;
};

const requestOptions = (tier) => ({
  timeout: tier === 'fast' ? FAST_TIMEOUT_MS : PRIMARY_TIMEOUT_MS,
  maxRetries: 0,
});

const readOpenAIText = (response, { maxTokens, model, operation }) => {
  const text = response.output_text?.trim();
  if (!text) {
    logger.error(
      { status: response.status, outputTypes: response.output?.map((item) => item?.type) },
      `${operation}: no text in OpenAI response`,
    );
    throw new Error(`Unexpected response format from OpenAI API (status: ${response.status || 'unknown'})`);
  }
  if (response.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens') {
    logger.warn({ maxTokens, model }, `${operation}: OpenAI response truncated by max_output_tokens limit`);
  }
  return text;
};

const readAnthropicText = (message, { maxTokens, model, operation }) => {
  const text = message.content
    ?.filter((block) => block?.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!text) {
    logger.error(
      { stopReason: message.stop_reason, blockTypes: message.content?.map((block) => block?.type) },
      `${operation}: no text in Anthropic response`,
    );
    throw new Error(`Unexpected response format from Anthropic API (stop_reason: ${message.stop_reason || 'unknown'})`);
  }
  if (message.stop_reason === 'max_tokens') {
    logger.warn({ maxTokens, model }, `${operation}: Anthropic response truncated by max_tokens limit`);
  }
  return text;
};

const callTextProvider = async (provider, prompt, options, allowExplicitModel) => {
  const { maxTokens, model, system, tier, feature } = options;
  const resolvedModel = resolveModel(provider, { model, tier }, allowExplicitModel);
  const startedAt = Date.now();
  let response;
  const finish = (status) => recordAIUsage({
    provider,
    model: resolvedModel,
    feature,
    status,
    durationMs: Date.now() - startedAt,
    usage: response?.usage,
  });
  try {
    if (provider === 'anthropic') {
      const params = {
        model: resolvedModel,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      };
      if (system) params.system = system;
      response = await getAnthropicClient().messages.create(params, requestOptions(tier));
      const text = readAnthropicText(response, { maxTokens, model: resolvedModel, operation: 'askAI' });
      finish('success');
      return text;
    }

    const params = {
      model: resolvedModel,
      max_output_tokens: maxTokens,
      input: prompt,
    };
    if (system) params.instructions = system;
    response = await getOpenAIClient().responses.create(params, requestOptions(tier));
    const text = readOpenAIText(response, { maxTokens, model: resolvedModel, operation: 'askAI' });
    finish('success');
    return text;
  } catch (error) {
    finish('error');
    throw error;
  }
};

const callVisionProvider = async (provider, imageBase64, prompt, options, allowExplicitModel) => {
  const { maxTokens, model, system, mediaType, tier, feature } = options;
  const resolvedModel = resolveModel(provider, { model, tier }, allowExplicitModel);
  const startedAt = Date.now();
  let response;
  const finish = (status) => recordAIUsage({
    provider,
    model: resolvedModel,
    feature,
    status,
    durationMs: Date.now() - startedAt,
    usage: response?.usage,
  });
  try {
    if (provider === 'anthropic') {
      const params = {
        model: resolvedModel,
        max_tokens: maxTokens,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: prompt },
          ],
        }],
      };
      if (system) params.system = system;
      response = await getAnthropicClient().messages.create(params, requestOptions(tier));
      const text = readAnthropicText(response, { maxTokens, model: resolvedModel, operation: 'askAIVision' });
      finish('success');
      return text;
    }

    const params = {
      model: resolvedModel,
      max_output_tokens: maxTokens,
      input: [{
        role: 'user',
        content: [
          { type: 'input_image', image_url: `data:${mediaType};base64,${imageBase64}`, detail: 'high' },
          { type: 'input_text', text: prompt },
        ],
      }],
    };
    if (system) params.instructions = system;
    response = await getOpenAIClient().responses.create(params, requestOptions(tier));
    const text = readOpenAIText(response, { maxTokens, model: resolvedModel, operation: 'askAIVision' });
    finish('success');
    return text;
  } catch (error) {
    finish('error');
    throw error;
  }
};

const errorMessage = (error) => error instanceof Error ? error.message : String(error);

const runWithFailover = async (operation, tier, invoke) => {
  try {
    return await invoke(AI_PROVIDER, true);
  } catch (primaryError) {
    if (!MODEL_CONFIG[FALLBACK_PROVIDER].configured) throw primaryError;

    logger.warn(
      { err: primaryError, primaryProvider: AI_PROVIDER, fallbackProvider: FALLBACK_PROVIDER, tier },
      `${operation}: preferred AI provider failed; retrying with fallback`,
    );
    try {
      return await invoke(FALLBACK_PROVIDER, false);
    } catch (fallbackError) {
      logger.error(
        { err: fallbackError, primaryProvider: AI_PROVIDER, fallbackProvider: FALLBACK_PROVIDER, tier },
        `${operation}: fallback AI provider also failed`,
      );
      throw new Error(
        `Both AI providers failed (${AI_PROVIDER}: ${errorMessage(primaryError)}; ${FALLBACK_PROVIDER}: ${errorMessage(fallbackError)})`,
        { cause: fallbackError },
      );
    }
  }
};

const askAI = async (prompt, { maxTokens = 4096, model, system, tier = 'primary', feature = 'text-generation' } = {}) => {
  const options = { maxTokens, model, system, tier, feature };
  return runWithFailover('askAI', tier, (provider, allowExplicitModel) => (
    callTextProvider(provider, prompt, options, allowExplicitModel)
  ));
};

const askAIVision = async (imageBase64, prompt, { maxTokens = 4096, model, system, mediaType = 'image/png', tier = 'primary', feature = 'vision-analysis' } = {}) => {
  const options = { maxTokens, model, system, mediaType, tier, feature };
  return runWithFailover('askAIVision', tier, (provider, allowExplicitModel) => (
    callVisionProvider(provider, imageBase64, prompt, options, allowExplicitModel)
  ));
};

const getAIStatus = () => ({
  provider: AI_PROVIDER,
  primaryModel: MODEL_CONFIG[AI_PROVIDER].primary,
  fastModel: MODEL_CONFIG[AI_PROVIDER].fast,
  configured: MODEL_CONFIG[AI_PROVIDER].configured,
  fallbackProvider: FALLBACK_PROVIDER,
  fallbackPrimaryModel: MODEL_CONFIG[FALLBACK_PROVIDER].primary,
  fallbackFastModel: MODEL_CONFIG[FALLBACK_PROVIDER].fast,
  fallbackConfigured: MODEL_CONFIG[FALLBACK_PROVIDER].configured,
  primaryTimeoutMs: PRIMARY_TIMEOUT_MS,
  fastTimeoutMs: FAST_TIMEOUT_MS,
});

const isAIAvailable = () => MODEL_CONFIG.openai.configured || MODEL_CONFIG.anthropic.configured;

module.exports = { askAI, askAIVision, getAIStatus, isAIAvailable };
