const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { logger } = require('./logger');

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

const resolveModel = ({ model, tier = 'primary' } = {}) => {
  if (model) return model;
  return tier === 'fast' ? MODEL_CONFIG[AI_PROVIDER].fast : MODEL_CONFIG[AI_PROVIDER].primary;
};

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

const askAI = async (prompt, { maxTokens = 4096, model, system, tier = 'primary' } = {}) => {
  const resolvedModel = resolveModel({ model, tier });
  if (AI_PROVIDER === 'anthropic') {
    const params = {
      model: resolvedModel,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    };
    if (system) params.system = system;
    const message = await getAnthropicClient().messages.create(params);
    return readAnthropicText(message, { maxTokens, model: resolvedModel, operation: 'askAI' });
  }

  const params = {
    model: resolvedModel,
    max_output_tokens: maxTokens,
    input: prompt,
  };
  if (system) params.instructions = system;
  const response = await getOpenAIClient().responses.create(params);
  return readOpenAIText(response, { maxTokens, model: resolvedModel, operation: 'askAI' });
};

const askAIVision = async (imageBase64, prompt, { maxTokens = 4096, model, system, mediaType = 'image/png', tier = 'primary' } = {}) => {
  const resolvedModel = resolveModel({ model, tier });
  if (AI_PROVIDER === 'anthropic') {
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
    const message = await getAnthropicClient().messages.create(params);
    return readAnthropicText(message, { maxTokens, model: resolvedModel, operation: 'askAIVision' });
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
  const response = await getOpenAIClient().responses.create(params);
  return readOpenAIText(response, { maxTokens, model: resolvedModel, operation: 'askAIVision' });
};

const getAIStatus = () => ({
  provider: AI_PROVIDER,
  primaryModel: MODEL_CONFIG[AI_PROVIDER].primary,
  fastModel: MODEL_CONFIG[AI_PROVIDER].fast,
  configured: MODEL_CONFIG[AI_PROVIDER].configured,
});

module.exports = { askAI, askAIVision, getAIStatus };
