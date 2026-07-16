const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { appDataStore } = require('../db/app-data-store');
const { logger } = require('./logger');
const { recordAIUsage } = require('./ai-usage');

const PROVIDER_IDS = ['openai', 'anthropic', 'kimi'];
const SUPPORTED_PROVIDERS = new Set(PROVIDER_IDS);
const AI_FEATURE_KEYS = ['aiBrief', 'reportChat', 'routeAnalysis', 'snowVision'];
const AI_FEATURE_KEY_SET = new Set(AI_FEATURE_KEYS);
const MODEL_TIER_KEYS = ['primary', 'fast'];
const MODEL_TIER_KEY_SET = new Set(MODEL_TIER_KEYS);
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const DEFAULT_AI_PROVIDER = String(process.env.AI_PROVIDER || 'openai').trim().toLowerCase();
if (!SUPPORTED_PROVIDERS.has(DEFAULT_AI_PROVIDER)) {
  throw new Error(`AI_PROVIDER must be one of: ${[...SUPPORTED_PROVIDERS].join(', ')}`);
}
const DEFAULT_AI_ENABLED = String(process.env.AI_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
const DEFAULT_AI_FAILOVER_ENABLED = String(process.env.AI_FAILOVER_ENABLED ?? 'true').trim().toLowerCase() !== 'false';

const parseModelOptions = (value, defaults) => [...new Set([
  ...defaults,
  ...String(value || '').split(',').map((model) => model.trim()).filter((model) => MODEL_ID_PATTERN.test(model)),
])];

const openAIPrimaryModel = process.env.OPENAI_MODEL || 'gpt-5.6-terra';
const openAIFastModel = process.env.OPENAI_FAST_MODEL || 'gpt-5.6-luna';
const anthropicPrimaryModel = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const anthropicFastModel = process.env.ANTHROPIC_FAST_MODEL || 'claude-haiku-4-5-20251001';
const kimiPrimaryModel = process.env.KIMI_MODEL || 'kimi-k3';
const kimiFastModel = process.env.KIMI_FAST_MODEL || 'kimi-k2.6';
const kimiApiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || '';
const kimiBaseURL = String(process.env.KIMI_BASE_URL || 'https://api.moonshot.ai/v1').replace(/\/+$/, '');

const MODEL_CONFIG = {
  openai: {
    primary: openAIPrimaryModel,
    fast: openAIFastModel,
    options: parseModelOptions(process.env.OPENAI_MODEL_OPTIONS, [openAIPrimaryModel, openAIFastModel]),
    configured: Boolean(process.env.OPENAI_API_KEY),
  },
  anthropic: {
    primary: anthropicPrimaryModel,
    fast: anthropicFastModel,
    options: parseModelOptions(process.env.ANTHROPIC_MODEL_OPTIONS, [anthropicPrimaryModel, anthropicFastModel]),
    configured: Boolean(process.env.ANTHROPIC_API_KEY),
  },
  kimi: {
    primary: kimiPrimaryModel,
    fast: kimiFastModel,
    options: parseModelOptions(process.env.KIMI_MODEL_OPTIONS, [kimiPrimaryModel, kimiFastModel]),
    configured: Boolean(kimiApiKey),
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
let kimiClient;
let activeProvider = DEFAULT_AI_PROVIDER;
let aiEnabled = DEFAULT_AI_ENABLED;
let aiFailoverEnabled = DEFAULT_AI_FAILOVER_ENABLED;
let aiFeatures = Object.fromEntries(AI_FEATURE_KEYS.map((feature) => [feature, DEFAULT_AI_ENABLED]));

const providerOrderFor = (provider) => [provider, ...PROVIDER_IDS.filter((candidate) => candidate !== provider)];

const fallbackProviderFor = (provider) => {
  const alternatives = providerOrderFor(provider).slice(1);
  return alternatives.find((candidate) => MODEL_CONFIG[candidate].configured) || alternatives[0];
};

const snapshotAISettings = () => ({
  enabled: aiEnabled,
  failoverEnabled: aiFailoverEnabled,
  provider: activeProvider,
  features: { ...aiFeatures },
  models: Object.fromEntries([...SUPPORTED_PROVIDERS].map((provider) => [provider, {
    primary: MODEL_CONFIG[provider].primary,
    fast: MODEL_CONFIG[provider].fast,
  }])),
});

const applyPersistedAISettings = (persisted) => {
  try {
    if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) {
      throw new TypeError('Persisted AI settings must be an object');
    }
    if (typeof persisted.enabled === 'boolean') {
      aiEnabled = persisted.enabled;
    } else if (persisted.enabled !== undefined) {
      logger.warn('Ignoring invalid PostgreSQL AI enabled value');
    }
    if (typeof persisted.failoverEnabled === 'boolean') {
      aiFailoverEnabled = persisted.failoverEnabled;
    } else if (persisted.failoverEnabled !== undefined) {
      logger.warn('Ignoring invalid PostgreSQL AI failover value');
    }
    if (SUPPORTED_PROVIDERS.has(persisted.provider) && MODEL_CONFIG[persisted.provider].configured) {
      activeProvider = persisted.provider;
    } else if (persisted.provider !== undefined) {
      logger.warn(
        { provider: persisted.provider },
        'Ignoring unavailable persisted AI provider',
      );
    }
    if (persisted.features && typeof persisted.features === 'object' && !Array.isArray(persisted.features)) {
      AI_FEATURE_KEYS.forEach((feature) => {
        if (typeof persisted.features[feature] === 'boolean') {
          aiFeatures[feature] = persisted.features[feature];
        } else if (persisted.features[feature] !== undefined) {
          logger.warn({ feature }, 'Ignoring invalid PostgreSQL AI feature value');
        }
      });
    } else if (persisted.features !== undefined) {
      logger.warn('Ignoring invalid PostgreSQL AI feature settings');
    }
    if (persisted.models && typeof persisted.models === 'object' && !Array.isArray(persisted.models)) {
      Object.entries(persisted.models).forEach(([provider, tiers]) => {
        if (!SUPPORTED_PROVIDERS.has(provider) || !tiers || typeof tiers !== 'object' || Array.isArray(tiers)) {
          logger.warn({ provider }, 'Ignoring invalid PostgreSQL AI model settings');
          return;
        }
        MODEL_TIER_KEYS.forEach((tier) => {
          const model = typeof tiers[tier] === 'string' ? tiers[tier].trim() : '';
          if (MODEL_ID_PATTERN.test(model)) MODEL_CONFIG[provider][tier] = model;
          else if (tiers[tier] !== undefined) {
            logger.warn({ provider, tier }, 'Ignoring invalid PostgreSQL AI model ID');
          }
        });
      });
    } else if (persisted.models !== undefined) {
      logger.warn('Ignoring invalid PostgreSQL AI models');
    }
    if (!aiEnabled) {
      aiFeatures = Object.fromEntries(AI_FEATURE_KEYS.map((feature) => [feature, false]));
    }
    logger.info(
      { enabled: aiEnabled, failoverEnabled: aiFailoverEnabled, provider: activeProvider, features: aiFeatures },
      'Loaded AI runtime settings from PostgreSQL',
    );
  } catch (error) {
    logger.error({ err: error }, 'Failed to load PostgreSQL AI settings; using environment defaults');
  }
};

const initializeAISettings = async () => {
  const persisted = await appDataStore.getAdminSetting('ai_settings');
  if (persisted) applyPersistedAISettings(persisted);
};

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

const getKimiClient = () => {
  if (!kimiClient) {
    if (!kimiApiKey) throw new Error('KIMI_API_KEY or MOONSHOT_API_KEY is not set');
    kimiClient = new OpenAI({ apiKey: kimiApiKey, baseURL: kimiBaseURL });
  }
  return kimiClient;
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

const readKimiText = (completion, { maxTokens, model, operation }) => {
  const text = completion.choices?.[0]?.message?.content?.trim();
  if (!text) {
    logger.error(
      { finishReason: completion.choices?.[0]?.finish_reason },
      `${operation}: no text in Kimi response`,
    );
    throw new Error(`Unexpected response format from Kimi API (finish_reason: ${completion.choices?.[0]?.finish_reason || 'unknown'})`);
  }
  if (completion.choices?.[0]?.finish_reason === 'length') {
    logger.warn({ maxTokens, model }, `${operation}: Kimi response truncated by max_tokens limit`);
  }
  return text;
};

const callTextProvider = async (provider, prompt, options, allowExplicitModel) => {
  const { maxTokens, model, system, tier, feature, userId } = options;
  const resolvedModel = resolveModel(provider, { model, tier }, allowExplicitModel);
  const startedAt = Date.now();
  let response;
  const finish = async (status) => {
    try {
      await recordAIUsage({
        userId,
        provider,
        model: resolvedModel,
        feature,
        status,
        durationMs: Date.now() - startedAt,
        usage: response?.usage,
      });
    } catch (error) {
      logger.error({ err: error, provider, model: resolvedModel, feature }, 'AI usage could not be persisted');
    }
  };
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
      await finish('success');
      return text;
    }

    if (provider === 'kimi') {
      const messages = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: prompt });
      response = await getKimiClient().chat.completions.create({
        model: resolvedModel,
        max_tokens: maxTokens,
        messages,
      }, requestOptions(tier));
      const text = readKimiText(response, { maxTokens, model: resolvedModel, operation: 'askAI' });
      await finish('success');
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
    await finish('success');
    return text;
  } catch (error) {
    await finish('error');
    throw error;
  }
};

const callVisionProvider = async (provider, imageBase64, prompt, options, allowExplicitModel) => {
  const { maxTokens, model, system, mediaType, tier, feature, userId } = options;
  const resolvedModel = resolveModel(provider, { model, tier }, allowExplicitModel);
  const startedAt = Date.now();
  let response;
  const finish = async (status) => {
    try {
      await recordAIUsage({
        userId,
        provider,
        model: resolvedModel,
        feature,
        status,
        durationMs: Date.now() - startedAt,
        usage: response?.usage,
      });
    } catch (error) {
      logger.error({ err: error, provider, model: resolvedModel, feature }, 'AI usage could not be persisted');
    }
  };
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
      await finish('success');
      return text;
    }

    if (provider === 'kimi') {
      const messages = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
          { type: 'text', text: prompt },
        ],
      });
      response = await getKimiClient().chat.completions.create({
        model: resolvedModel,
        max_tokens: maxTokens,
        messages,
      }, requestOptions(tier));
      const text = readKimiText(response, { maxTokens, model: resolvedModel, operation: 'askAIVision' });
      await finish('success');
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
    await finish('success');
    return text;
  } catch (error) {
    await finish('error');
    throw error;
  }
};

const errorMessage = (error) => error instanceof Error ? error.message : String(error);

const assertAIEnabled = () => {
  if (aiEnabled) return;
  const error = new Error('AI features are unavailable');
  error.code = 'AI_DISABLED';
  throw error;
};

const assertAIFeatureEnabled = (feature) => {
  if (!AI_FEATURE_KEY_SET.has(feature)) {
    throw new TypeError(`Unknown AI feature: ${feature}`);
  }
  assertAIEnabled();
  if (aiFeatures[feature]) return;
  const error = new Error('AI features are unavailable');
  error.code = 'AI_FEATURE_DISABLED';
  throw error;
};

const runWithFailover = async (operation, tier, invoke) => {
  assertAIEnabled();

  // Snapshot provider selection for the full request so an admin change made while a
  // request is in flight cannot alter its fallback path midway through the operation.
  const primaryProvider = activeProvider;
  const failoverEnabled = aiFailoverEnabled;
  const providerOrder = failoverEnabled ? providerOrderFor(primaryProvider) : [primaryProvider];
  const providers = providerOrder.filter((provider) => MODEL_CONFIG[provider].configured);
  if (providers.length === 0) {
    const error = new Error('AI provider is not configured');
    error.code = 'AI_PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  const failures = [];
  for (const [index, provider] of providers.entries()) {
    try {
      return await invoke(provider, provider === primaryProvider);
    } catch (error) {
      failures.push({ provider, error });
      const nextProvider = providers[index + 1];
      if (nextProvider) {
        logger.warn(
          { err: error, primaryProvider, failedProvider: provider, fallbackProvider: nextProvider, tier },
          `${operation}: AI provider failed; retrying with fallback`,
        );
      }
    }
  }

  if (failures.length === 1) throw failures[0].error;
  const lastFailure = failures[failures.length - 1];
  logger.error(
    { err: lastFailure.error, primaryProvider, failedProviders: failures.map(({ provider }) => provider), tier },
    `${operation}: all configured AI providers failed`,
  );
  const prefix = failures.length === 2 ? 'Both AI providers failed' : 'All configured AI providers failed';
  throw new Error(
    `${prefix} (${failures.map(({ provider, error }) => `${provider}: ${errorMessage(error)}`).join('; ')})`,
    { cause: lastFailure.error },
  );
};

const askAI = async (prompt, { maxTokens = 4096, model, system, tier = 'primary', feature = 'text-generation', userId } = {}) => {
  const options = { maxTokens, model, system, tier, feature, userId };
  return runWithFailover('askAI', tier, (provider, allowExplicitModel) => (
    callTextProvider(provider, prompt, options, allowExplicitModel)
  ));
};

const askAIVision = async (imageBase64, prompt, { maxTokens = 4096, model, system, mediaType = 'image/png', tier = 'primary', feature = 'vision-analysis', userId } = {}) => {
  const options = { maxTokens, model, system, mediaType, tier, feature, userId };
  return runWithFailover('askAIVision', tier, (provider, allowExplicitModel) => (
    callVisionProvider(provider, imageBase64, prompt, options, allowExplicitModel)
  ));
};

const getAIStatus = () => {
  const fallbackProvider = fallbackProviderFor(activeProvider);
  const available = aiEnabled && (aiFailoverEnabled
    ? PROVIDER_IDS.some((provider) => MODEL_CONFIG[provider].configured)
    : MODEL_CONFIG[activeProvider].configured);
  return {
    enabled: aiEnabled,
    failoverEnabled: aiFailoverEnabled,
    available,
    persistent: appDataStore.configured,
    provider: activeProvider,
    defaultProvider: DEFAULT_AI_PROVIDER,
    primaryModel: MODEL_CONFIG[activeProvider].primary,
    fastModel: MODEL_CONFIG[activeProvider].fast,
    configured: MODEL_CONFIG[activeProvider].configured,
    fallbackProvider,
    fallbackPrimaryModel: MODEL_CONFIG[fallbackProvider].primary,
    fallbackFastModel: MODEL_CONFIG[fallbackProvider].fast,
    fallbackConfigured: aiFailoverEnabled && MODEL_CONFIG[fallbackProvider].configured,
    providers: Object.fromEntries([...SUPPORTED_PROVIDERS].map((provider) => [provider, {
      ...MODEL_CONFIG[provider],
      options: [...new Set([
        ...MODEL_CONFIG[provider].options,
        MODEL_CONFIG[provider].primary,
        MODEL_CONFIG[provider].fast,
      ])],
    }])),
    features: Object.fromEntries(AI_FEATURE_KEYS.map((feature) => [feature, {
      enabled: aiFeatures[feature],
      available: available && aiFeatures[feature],
    }])),
    primaryTimeoutMs: PRIMARY_TIMEOUT_MS,
    fastTimeoutMs: FAST_TIMEOUT_MS,
  };
};

const updateAISettings = ({ enabled, failoverEnabled, provider, features, models } = {}) => {
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    const error = new TypeError('enabled must be a boolean');
    error.code = 'INVALID_AI_SETTINGS';
    throw error;
  }
  if (failoverEnabled !== undefined && typeof failoverEnabled !== 'boolean') {
    const error = new TypeError('failoverEnabled must be a boolean');
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
  if (features !== undefined && (!features || typeof features !== 'object' || Array.isArray(features))) {
    const error = new TypeError('features must be an object');
    error.code = 'INVALID_AI_SETTINGS';
    throw error;
  }
  if (features !== undefined) {
    Object.entries(features).forEach(([feature, value]) => {
      if (!AI_FEATURE_KEY_SET.has(feature)) {
        const error = new TypeError(`Unknown AI feature: ${feature}`);
        error.code = 'INVALID_AI_SETTINGS';
        throw error;
      }
      if (typeof value !== 'boolean') {
        const error = new TypeError(`${feature} must be a boolean`);
        error.code = 'INVALID_AI_SETTINGS';
        throw error;
      }
    });
  }

  const normalizedModels = {};
  if (models !== undefined && (!models || typeof models !== 'object' || Array.isArray(models))) {
    const error = new TypeError('models must be an object');
    error.code = 'INVALID_AI_SETTINGS';
    throw error;
  }
  if (models !== undefined) {
    const providerEntries = Object.entries(models);
    if (providerEntries.length === 0) {
      const error = new TypeError('Provide at least one model setting');
      error.code = 'INVALID_AI_SETTINGS';
      throw error;
    }
    providerEntries.forEach(([modelProvider, tiers]) => {
      if (!SUPPORTED_PROVIDERS.has(modelProvider)) {
        const error = new TypeError(`Unknown AI model provider: ${modelProvider}`);
        error.code = 'INVALID_AI_SETTINGS';
        throw error;
      }
      if (!tiers || typeof tiers !== 'object' || Array.isArray(tiers)) {
        const error = new TypeError(`${modelProvider} models must be an object`);
        error.code = 'INVALID_AI_SETTINGS';
        throw error;
      }
      const tierEntries = Object.entries(tiers);
      if (tierEntries.length === 0) {
        const error = new TypeError(`Provide at least one ${modelProvider} model`);
        error.code = 'INVALID_AI_SETTINGS';
        throw error;
      }
      normalizedModels[modelProvider] = {};
      tierEntries.forEach(([tier, value]) => {
        if (!MODEL_TIER_KEY_SET.has(tier)) {
          const error = new TypeError(`Unknown AI model tier: ${tier}`);
          error.code = 'INVALID_AI_SETTINGS';
          throw error;
        }
        const model = typeof value === 'string' ? value.trim() : '';
        if (!MODEL_ID_PATTERN.test(model)) {
          const error = new TypeError(`${modelProvider} ${tier} model must be a valid model ID`);
          error.code = 'INVALID_AI_SETTINGS';
          throw error;
        }
        normalizedModels[modelProvider][tier] = model;
      });
    });
  }

  const previous = snapshotAISettings();
  const next = {
    enabled: enabled ?? previous.enabled,
    failoverEnabled: failoverEnabled ?? previous.failoverEnabled,
    provider: provider ?? previous.provider,
    features: enabled === undefined
      ? { ...previous.features }
      : Object.fromEntries(AI_FEATURE_KEYS.map((feature) => [feature, enabled])),
    models: Object.fromEntries(Object.entries(previous.models).map(([modelProvider, tiers]) => [
      modelProvider,
      { ...tiers },
    ])),
  };
  if (features !== undefined) next.features = { ...next.features, ...features };
  Object.entries(normalizedModels).forEach(([modelProvider, tiers]) => {
    next.models[modelProvider] = { ...next.models[modelProvider], ...tiers };
  });

  return appDataStore.setAdminSetting('ai_settings', next).then(() => {
    aiEnabled = next.enabled;
    aiFailoverEnabled = next.failoverEnabled;
    activeProvider = next.provider;
    aiFeatures = next.features;
    Object.entries(next.models).forEach(([modelProvider, tiers]) => {
      MODEL_CONFIG[modelProvider] = { ...MODEL_CONFIG[modelProvider], ...tiers };
    });
    logger.warn({ previous, current: next }, 'AI runtime settings changed by administrator');
    return getAIStatus();
  }).catch((error) => {
    logger.error({ err: error }, 'Failed to persist AI runtime settings to PostgreSQL');
    const persistenceError = new Error('AI settings could not be saved');
    persistenceError.code = 'AI_SETTINGS_PERSIST_FAILED';
    persistenceError.cause = error;
    throw persistenceError;
  });
};

const isAIAvailable = () => aiEnabled && (aiFailoverEnabled
  ? PROVIDER_IDS.some((provider) => MODEL_CONFIG[provider].configured)
  : MODEL_CONFIG[activeProvider].configured);
const isAIFeatureAvailable = (feature) => AI_FEATURE_KEY_SET.has(feature) && isAIAvailable() && aiFeatures[feature];
const getAIFeatureAvailability = () => Object.fromEntries(
  AI_FEATURE_KEYS.map((feature) => [feature, isAIFeatureAvailable(feature)]),
);

module.exports = {
  askAI,
  askAIVision,
  assertAIEnabled,
  assertAIFeatureEnabled,
  getAIFeatureAvailability,
  getAIStatus,
  initializeAISettings,
  isAIAvailable,
  isAIFeatureAvailable,
  updateAISettings,
};
