const Anthropic = require('@anthropic-ai/sdk');

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
  return msg.content[0].text;
};

module.exports = { askClaude };
