const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { logger } = require('./logger');
const { recordAIUsage } = require('./ai-usage');

const SUPPORTED_PROVIDERS = new Set(['openai', 'anthropic']);
const DEFAULT_AI_PROVIDER = String(process.env.AI_PROVIDER || 'openai').trim().toLowerCase();
if (!SUPPORTED_PROVIDERS.has(DEFAULT_AI_PROVIDER)) {
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

let openAIClient;
let anthropicClient;
let activeProvider = DEFAULT_AI_PROVIDER;
let aiEnabled = true;

const fallbackProviderFor = (provider) => provider === 'openai' ? 'anthropic' : 'openai';

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

const assertAIEnabled = () => {
  if (aiEnabled) return;
  const error = new Error('AI features are disabled by an administrator');
  error.code = 'AI_DISABLED';
  throw error;
};

const runWithFailover = async (operation, tier, invoke) => {
  assertAIEnabled();

  // Snapshot provider selection for the full request so an admin change made while a
  // request is in flight cannot alter its fallback path midway through the operation.
  const primaryProvider = activeProvider;
  const fallbackProvider = fallbackProviderFor(primaryProvider);
  try {
    return await invoke(primaryProvider, true);
  } catch (primaryError) {
    if (!MODEL_CONFIG[fallbackProvider].configured) throw primaryError;

    logger.warn(
      { err: primaryError, primaryProvider, fallbackProvider, tier },
      `${operation}: preferred AI provider failed; retrying with fallback`,
    );
    try {
      return await invoke(fallbackProvider, false);
    } catch (fallbackError) {
      logger.error(
        { err: fallbackError, primaryProvider, fallbackProvider, tier },
        `${operation}: fallback AI provider also failed`,
      );
      throw new Error(
        `Both AI providers failed (${primaryProvider}: ${errorMessage(primaryError)}; ${fallbackProvider}: ${errorMessage(fallbackError)})`,
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

const getAIStatus = () => {
  const fallbackProvider = fallbackProviderFor(activeProvider);
  return {
    enabled: aiEnabled,
    available: aiEnabled && (MODEL_CONFIG.openai.configured || MODEL_CONFIG.anthropic.configured),
    provider: activeProvider,
    defaultProvider: DEFAULT_AI_PROVIDER,
    primaryModel: MODEL_CONFIG[activeProvider].primary,
    fastModel: MODEL_CONFIG[activeProvider].fast,
    configured: MODEL_CONFIG[activeProvider].configured,
    fallbackProvider,
    fallbackPrimaryModel: MODEL_CONFIG[fallbackProvider].primary,
    fallbackFastModel: MODEL_CONFIG[fallbackProvider].fast,
    fallbackConfigured: MODEL_CONFIG[fallbackProvider].configured,
    providers: Object.fromEntries([...SUPPORTED_PROVIDERS].map((provider) => [provider, { ...MODEL_CONFIG[provider] }])),
    primaryTimeoutMs: PRIMARY_TIMEOUT_MS,
    fastTimeoutMs: FAST_TIMEOUT_MS,
  };
};

const updateAISettings = ({ enabled, provider } = {}) => {
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    const error = new TypeError('enabled must be a boolean');
    error.code = 'INVALID_AI_SETTINGS';
    throw error;
  }
  if (provider !== undefined && !SUPPORTED_PROVIDERS.has(provider)) {
    const error = new TypeError(`provider must be one of: ${[...SUPPORTED_PROVIDERS].join(', ')}`);
    error.code = 'INVALID_AI_SETTINGS';
    throw error;
  }
  if (provider !== undefined && !MODEL_CONFIG[provider].configured) {
    const error = new Error(`${provider} is not configured`);
    error.code = 'AI_PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  const previous = { enabled: aiEnabled, provider: activeProvider };
  if (enabled !== undefined) aiEnabled = enabled;
  if (provider !== undefined) activeProvider = provider;
  logger.warn(
    { previous, current: { enabled: aiEnabled, provider: activeProvider } },
    'AI runtime settings changed by administrator',
  );
  return getAIStatus();
};

const isAIAvailable = () => aiEnabled && (MODEL_CONFIG.openai.configured || MODEL_CONFIG.anthropic.configured);

module.exports = { askAI, askAIVision, assertAIEnabled, getAIStatus, isAIAvailable, updateAISettings };
