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
  modelForRequest: jest.fn(async () => 'account-model'), accessToken: jest.fn(async () => 'test-oauth-access'),
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

test('late tasks after the browser request ends cannot use credentials', async () => {
  await expect(runWithChatGPT({ service, userId: 'owner', alive: false }, () => askAI('late task'))).rejects.toMatchObject({ code: 'CHATGPT_REQUEST_ENDED' });
  expect(service.accessToken).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});
