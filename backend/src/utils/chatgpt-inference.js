'use strict';

const OpenAI = require('openai');
const { ChatGPTError } = require('../auth/chatgpt');

const assertLive = (subscription) => {
  if (!subscription.alive) throw new ChatGPTError('This request has ended. Start a new request.', 'CHATGPT_REQUEST_ENDED', 409);
};

const chatGPTInference = async (subscription, input, { system, maxTokens = 4096, timeoutMs = 45000, onDelta, signal } = {}) => {
  assertLive(subscription);
  const { service } = subscription;
  const model = await service.modelForRequest();
  const token = await service.accessToken();
  assertLive(subscription);
  const client = new OpenAI({ apiKey: token, baseURL: 'https://api.openai.com/v1', maxRetries: 0 });
  let completed;
  try {
    const stream = await client.responses.create({
      model, input, ...(system ? { instructions: system } : {}), max_output_tokens: maxTokens,
      store: false, stream: true,
    }, { timeout: timeoutMs, maxRetries: 0, ...(signal ? { signal } : {}) });
    try {
      for await (const event of stream) {
        assertLive(subscription);
        if (event.type === 'response.output_text.delta' && onDelta) onDelta(event.delta);
        if (event.type === 'response.failed' || event.type === 'error' || event.type === 'response.incomplete') {
          throw new ChatGPTError('ChatGPT did not complete this response. Try again.');
        }
        if (event.type === 'response.completed') completed = event.response;
      }
    } finally { stream.controller?.abort(); }
  } catch (error) {
    if (error instanceof ChatGPTError) throw error;
    if (error.status) throw service.apiError({ status: error.status });
    throw new ChatGPTError('ChatGPT could not complete the request. Try again.');
  }
  if (!completed) throw new ChatGPTError('ChatGPT stream ended before completion. Try again.');
  const text = completed.output?.filter((item) => item.type === 'message')
    .flatMap((item) => item.content || []).filter((part) => part.type === 'output_text').map((part) => part.text).join('').trim();
  if (!text) throw new ChatGPTError('ChatGPT returned no text. Try another model.');
  return { text, model, usage: completed.usage };
};

module.exports = { chatGPTInference };
