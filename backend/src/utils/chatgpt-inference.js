'use strict';

const OpenAI = require('openai');
const { ChatGPTError } = require('../auth/chatgpt');

const assertLive = (subscription) => {
  if (!subscription.alive) throw new ChatGPTError('This request has ended. Start a new request.', 'CHATGPT_REQUEST_ENDED', 409);
};

const DEFAULT_INSTRUCTIONS = 'You are the Conditions backcountry planning assistant.';

// Plan usage accepts a narrower Responses request than API keys: an input array, instructions
// instead of system-role messages, and no max_output_tokens (rejected with a 400).
const planRequestInput = (input, system) => {
  const messages = typeof input === 'string'
    ? [{ role: 'user', content: [{ type: 'input_text', text: input }] }]
    : input;
  const isInstruction = (message) => message.role === 'system' || message.role === 'developer';
  const instructions = [system, ...messages.filter(isInstruction).map((message) => (
    typeof message.content === 'string' ? message.content
      : message.content.map((part) => part.text || '').join('\n')
  ))].filter(Boolean).join('\n\n');
  return { input: messages.filter((message) => !isInstruction(message)), instructions: instructions || DEFAULT_INSTRUCTIONS };
};

// Plan models default to more thinking than a report can wait for; the API path lowers effort the same way.
const EFFORT_PREFERENCE = { fast: ['none', 'minimal', 'low'], primary: ['low', 'minimal', 'none'] };
const reasoningFor = (efforts, tier) => {
  const effort = (EFFORT_PREFERENCE[tier] || EFFORT_PREFERENCE.primary).find((level) => efforts.includes(level));
  return effort ? { reasoning: { effort } } : {};
};

// The default stays under the proxy's 30s read timeout, so a slow answer fails as JSON, not a dropped connection.
const chatGPTInference = async (subscription, input, { system, tier = 'primary', timeoutMs = 28000, onDelta, signal } = {}) => {
  assertLive(subscription);
  const { service } = subscription;
  const model = await service.modelForRequest();
  const efforts = await service.reasoningEffortsFor(model);
  const token = await service.accessToken();
  assertLive(subscription);
  const client = new OpenAI({ apiKey: token, baseURL: 'https://api.openai.com/v1', maxRetries: 0 });
  // The client timeout ends at the response headers; this one also bounds the streamed body.
  const deadline = AbortSignal.timeout(timeoutMs);
  let completed;
  let streamedText = '';
  try {
    const stream = await client.responses.create({
      model, ...planRequestInput(input, system), ...reasoningFor(efforts, tier), store: false, stream: true,
    }, { timeout: timeoutMs, maxRetries: 0, signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
    try {
      for await (const event of stream) {
        assertLive(subscription);
        if (event.type === 'response.output_text.delta') {
          streamedText += event.delta;
          if (onDelta) onDelta(event.delta);
        }
        if (event.type === 'response.failed' || event.type === 'error' || event.type === 'response.incomplete') {
          throw new ChatGPTError('ChatGPT did not complete this response. Try again.');
        }
        if (event.type === 'response.completed') completed = event.response;
      }
    } finally { stream.controller?.abort(); }
  } catch (error) {
    if (error instanceof ChatGPTError) throw error;
    if (deadline.aborted) throw new ChatGPTError('ChatGPT took too long to answer. Try again, or choose a faster model in Account.', 'CHATGPT_TIMEOUT', 504);
    if (error.status) throw service.apiError({ status: error.status });
    throw new ChatGPTError('ChatGPT could not complete the request. Try again.');
  }
  if (!completed) throw new ChatGPTError('ChatGPT stream ended before completion. Try again.');
  // Plan streams can omit output from the terminal event even after delivering
  // every text delta. Keep those deltas, but accept them only after completion.
  const text = (completed.output?.filter((item) => item.type === 'message')
    .flatMap((item) => item.content || []).filter((part) => part.type === 'output_text').map((part) => part.text).join('') || streamedText).trim();
  if (!text) throw new ChatGPTError('ChatGPT returned no text. Try another model.');
  return { text, model, usage: completed.usage };
};

module.exports = { chatGPTInference };
