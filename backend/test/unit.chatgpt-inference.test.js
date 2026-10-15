jest.mock('openai', () => jest.fn());
jest.mock('../src/utils/ai-usage', () => ({ recordAIUsage: jest.fn() }));
jest.mock('../src/db/app-data-store', () => ({ appDataStore: { configured: false } }));
const OpenAI = require('openai');
const { runWithChatGPT, ChatGPTError } = require('../src/auth/chatgpt');
const { askAI, askAIVision, getAIStatus } = require('../src/utils/ai-client');
const { recordAIUsage } = require('../src/utils/ai-usage');
const { estimateAIUsageCost } = require('../src/utils/ai-pricing');

const create = jest.fn();
const service = {
  modelForRequest: jest.fn(async () => 'account-model'), reasoningEffortsFor: jest.fn(async () => []), accessToken: jest.fn(async () => 'test-oauth-access'),
  status: () => ({ connected: true, model: 'account-model' }),
  apiError: () => new ChatGPTError('ChatGPT usage limit reached.', 'CHATGPT_LIMIT_REACHED', 429),
};
beforeEach(() => { jest.clearAllMocks(); OpenAI.mockImplementation(() => ({ responses: { create } })); });

async function* completed() {
  yield { type: 'response.output_text.delta', delta: 'Hello' };
  yield { type: 'response.completed', response: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello' }] }], usage: { input_tokens: 4, output_tokens: 1 } } };
}

test('text and vision use OAuth, the account model, streaming and store:false; usage has no API cost', async () => {
  create.mockImplementation(() => completed());
  const subscription = { service, userId: 'owner', alive: true };
  await runWithChatGPT(subscription, async () => {
    expect(getAIStatus()).toMatchObject({ billingSource: 'chatgpt', failoverEnabled: false, available: true });
    expect(await askAI('Hi', { model: 'ignored-platform-model', feature: 'brief' })).toBe('Hello');
    expect(await askAIVision('aGVsbG8=', 'Describe')).toBe('Hello');
  });
  expect(OpenAI.mock.calls[0][0]).toMatchObject({ apiKey: 'test-oauth-access', baseURL: 'https://api.openai.com/v1', maxRetries: 0 });
  expect(create.mock.calls[0][0]).toMatchObject({ model: 'account-model', store: false, stream: true });
  expect(create.mock.calls[1][0].input[0].content[0].type).toBe('input_image');
});

test('requests use the plan-usage shape: input array, instructions, no max_output_tokens', async () => {
  create.mockImplementation(() => completed());
  const subscription = { service, userId: 'owner', alive: true };
  await runWithChatGPT(subscription, () => askAI('Hi', { system: 'Be brief.', maxTokens: 500 }));
  const text = create.mock.calls[0][0];
  expect(text).not.toHaveProperty('max_output_tokens');
  expect(text.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }]);
  expect(text.instructions).toBe('Be brief.');

  await runWithChatGPT(subscription, () => askAI('Hi'));
  expect(create.mock.calls[1][0].instructions).toEqual(expect.any(String));
  expect(create.mock.calls[1][0].instructions.length).toBeGreaterThan(0);

  const { chatGPTInference } = require('../src/utils/chatgpt-inference');
  await chatGPTInference(subscription, [
    { role: 'system', content: 'Rules.' }, { role: 'user', content: 'Q' }, { role: 'assistant', content: 'A' },
  ], { system: 'Report.', maxTokens: 900 });
  const chat = create.mock.calls[2][0];
  expect(chat).not.toHaveProperty('max_output_tokens');
  expect(chat.instructions).toBe('Report.\n\nRules.');
  expect(chat.input.map((message) => message.role)).toEqual(['user', 'assistant']);
  expect(recordAIUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: 'chatgpt', userId: 'owner' }));
  expect(estimateAIUsageCost({ provider: 'chatgpt', model: 'account-model', usage: { input_tokens: 4000000 } })).toMatchObject({ estimatedCostUsd: 0, pricingMatched: true });
  expect(getAIStatus().billingSource).not.toBe('chatgpt');
});

test('incomplete streams and account limits fail without retrying a paid API provider', async () => {
  create.mockImplementation(async function* () { yield { type: 'response.output_text.delta', delta: 'Partial' }; });
  await expect(runWithChatGPT({ service, userId: 'owner', alive: true }, () => askAI('Hi'))).rejects.toThrow('before completion');
  expect(create).toHaveBeenCalledTimes(1);
  create.mockRejectedValueOnce(Object.assign(new Error('sensitive provider payload'), { status: 429 }));
  await expect(runWithChatGPT({ service, userId: 'owner', alive: true }, () => askAI('Hi'))).rejects.toMatchObject({ code: 'CHATGPT_LIMIT_REACHED' });
  expect(create).toHaveBeenCalledTimes(2);
});

test('plan streams retain text deltas when the completed event omits output', async () => {
  create.mockImplementation(async function* () {
    yield { type: 'response.output_text.delta', delta: 'Hello, ' };
    yield { type: 'response.output_text.delta', delta: 'world!' };
    yield { type: 'response.completed', response: { output: [], usage: { input_tokens: 4, output_tokens: 3 } } };
  });
  const subscription = { service, userId: 'owner', alive: true };
  expect(await runWithChatGPT(subscription, () => askAI('Hi'))).toBe('Hello, world!');
  const { chatGPTInference } = require('../src/utils/chatgpt-inference');
  const onDelta = jest.fn();
  expect(await chatGPTInference(subscription, 'Hi', { onDelta })).toMatchObject({ text: 'Hello, world!', usage: { output_tokens: 3 } });
  expect(onDelta.mock.calls).toEqual([['Hello, '], ['world!']]);
});

test.each(['response.failed', 'response.incomplete', 'error'])('partial text is rejected after %s', async (type) => {
  create.mockImplementation(async function* () {
    yield { type: 'response.output_text.delta', delta: 'Partial answer' };
    yield { type };
  });
  await expect(runWithChatGPT({ service, userId: 'owner', alive: true }, () => askAI('Hi')))
    .rejects.toThrow('did not complete');
});

test('plan requests lower reasoning effort by tier and keep the API time budget', async () => {
  create.mockImplementation(() => completed());
  service.reasoningEffortsFor.mockResolvedValue(['minimal', 'low', 'medium', 'high']);
  const subscription = { service, userId: 'owner', alive: true };
  await runWithChatGPT(subscription, async () => {
    await askAI('Hi', { tier: 'fast' });
    await askAI('Hi');
    await askAI('Hi', { tier: 'fast', timeoutMs: 15000 });
  });
  expect(create.mock.calls[0][0].reasoning).toEqual({ effort: 'minimal' });
  expect(create.mock.calls[1][0].reasoning).toEqual({ effort: 'low' });
  expect(create.mock.calls[0][1].timeout).toBe(8000);
  expect(create.mock.calls[1][1].timeout).toBe(28000);
  expect(create.mock.calls[2][1].timeout).toBe(15000);
  service.reasoningEffortsFor.mockResolvedValue([]);
  await runWithChatGPT(subscription, () => askAI('Hi'));
  expect(create.mock.calls[3][0]).not.toHaveProperty('reasoning');
});

test('a request past its deadline fails as a ChatGPT timeout', async () => {
  create.mockImplementation((_params, { signal }) => (async function* () {
    await new Promise((resolve) => { signal.addEventListener('abort', resolve, { once: true }); });
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  })());
  const { chatGPTInference } = require('../src/utils/chatgpt-inference');
  await expect(chatGPTInference({ service, userId: 'owner', alive: true }, 'Hi', { timeoutMs: 20 }))
    .rejects.toMatchObject({ code: 'CHATGPT_TIMEOUT' });
});

test('late tasks after the browser request ends cannot use credentials', async () => {
  await expect(runWithChatGPT({ service, userId: 'owner', alive: false }, () => askAI('late task'))).rejects.toMatchObject({ code: 'CHATGPT_REQUEST_ENDED' });
  expect(service.accessToken).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});
