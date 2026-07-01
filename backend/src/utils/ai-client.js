const Anthropic = require('@anthropic-ai/sdk');
const { logger } = require('./logger');

let client;
const getClient = () => {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
};

const askClaude = async (prompt, { maxTokens = 1024, model = 'claude-sonnet-4-6', system } = {}) => {
  const params = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  if (system) params.system = system;
  const msg = await getClient().messages.create(params);
  const textBlock = msg.content?.find((block) => block?.type === 'text');
  if (!textBlock) {
    logger.error({ stopReason: msg.stop_reason, blockTypes: msg.content?.map((b) => b?.type) }, 'askClaude: no text block in AI response');
    throw new Error(`Unexpected response format from AI API (stop_reason: ${msg.stop_reason || 'unknown'})`);
  }
  return textBlock.text;
};

const askClaudeVision = async (imageBase64, prompt, { maxTokens = 1024, model = 'claude-sonnet-5', system, mediaType = 'image/png' } = {}) => {
  const params = {
    model,
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
  const msg = await getClient().messages.create(params);
  const textBlock = msg.content?.find((block) => block?.type === 'text');
  if (!textBlock) {
    logger.error({ stopReason: msg.stop_reason, blockTypes: msg.content?.map((b) => b?.type) }, 'askClaudeVision: no text block in AI response');
    throw new Error(`Unexpected response format from AI API (stop_reason: ${msg.stop_reason || 'unknown'})`);
  }
  return textBlock.text;
};

module.exports = { askClaude, askClaudeVision };
