const mockOpenAICreate = jest.fn();
const mockAnthropicCreate = jest.fn();

jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  responses: { create: mockOpenAICreate },
})));
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({
  messages: { create: mockAnthropicCreate },
})));

const ENV_KEYS = [
  'AI_PROVIDER',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'OPENAI_FAST_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_FAST_MODEL',
  'AI_PRIMARY_TIMEOUT_MS',
  'AI_FAST_TIMEOUT_MS',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const loadClient = (provider = 'openai') => {
  process.env.AI_PROVIDER = provider;
  jest.resetModules();
  return require('../src/utils/ai-client');
};

describe('AI provider client wrapper', () => {
  beforeEach(() => {
    mockOpenAICreate.mockReset();
    mockAnthropicCreate.mockReset();
    process.env.OPENAI_API_KEY = 'openai-test-key';
    process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_FAST_MODEL;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_FAST_MODEL;
    delete process.env.AI_PRIMARY_TIMEOUT_MS;
    delete process.env.AI_FAST_TIMEOUT_MS;
  });

  afterAll(() => {
    ENV_KEYS.forEach((key) => {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    });
  });

  test('sends text prompts through OpenAI Responses API', async () => {
    mockOpenAICreate.mockResolvedValue({ status: 'completed', output_text: '  field brief  ' });
    const { askAI } = loadClient('openai');

    await expect(askAI('conditions', { maxTokens: 900, system: 'Be concise.' })).resolves.toBe('field brief');
    expect(mockOpenAICreate).toHaveBeenCalledWith({
      model: 'gpt-5.6-terra',
      max_output_tokens: 900,
      input: 'conditions',
      instructions: 'Be concise.',
    }, { timeout: 28000, maxRetries: 0 });
  });

  test('uses the OpenAI fast model for fast-tier requests', async () => {
    mockOpenAICreate.mockResolvedValue({ status: 'completed', output_text: '[]' });
    const { askAI } = loadClient('openai');

    await askAI('routes', { tier: 'fast' });
    expect(mockOpenAICreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.6-luna' }),
      { timeout: 8000, maxRetries: 0 },
    );
  });

  test('sends base64 images as OpenAI vision input', async () => {
    mockOpenAICreate.mockResolvedValue({ status: 'completed', output_text: 'snow coverage' });
    const { askAIVision } = loadClient('openai');

    await expect(askAIVision('YWJj', 'analyze', { mediaType: 'image/jpeg' })).resolves.toBe('snow coverage');
    expect(mockOpenAICreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.6-terra',
      input: [{
        role: 'user',
        content: [
          { type: 'input_image', image_url: 'data:image/jpeg;base64,YWJj', detail: 'high' },
          { type: 'input_text', text: 'analyze' },
        ],
      }],
    }), { timeout: 28000, maxRetries: 0 });
  });

  test('sends text prompts through Anthropic Messages API', async () => {
    mockAnthropicCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '  route brief  ' }],
    });
    const { askAI } = loadClient('anthropic');

    await expect(askAI('conditions', { maxTokens: 800, system: 'Be precise.' })).resolves.toBe('route brief');
    expect(mockAnthropicCreate).toHaveBeenCalledWith({
      model: 'claude-sonnet-5',
      max_tokens: 800,
      messages: [{ role: 'user', content: 'conditions' }],
      system: 'Be precise.',
    }, { timeout: 28000, maxRetries: 0 });
  });

  test('uses the Anthropic fast model for fast-tier requests', async () => {
    mockAnthropicCreate.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: '[]' }] });
    const { askAI } = loadClient('anthropic');

    await askAI('routes', { tier: 'fast' });
    expect(mockAnthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001' }),
      { timeout: 8000, maxRetries: 0 },
    );
  });

  test('sends base64 images through Anthropic vision input', async () => {
    mockAnthropicCreate.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'snow coverage' }] });
    const { askAIVision } = loadClient('anthropic');

    await askAIVision('YWJj', 'analyze', { mediaType: 'image/jpeg' });
    expect(mockAnthropicCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-sonnet-5',
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'YWJj' } },
          { type: 'text', text: 'analyze' },
        ],
      }],
    }), { timeout: 28000, maxRetries: 0 });
  });

  test('reports the selected provider and models without exposing keys', () => {
    const { getAIStatus, isAIAvailable } = loadClient('anthropic');

    expect(getAIStatus()).toEqual({
      enabled: true,
      available: true,
      provider: 'anthropic',
      defaultProvider: 'anthropic',
      primaryModel: 'claude-sonnet-5',
      fastModel: 'claude-haiku-4-5-20251001',
      configured: true,
      fallbackProvider: 'openai',
      fallbackPrimaryModel: 'gpt-5.6-terra',
      fallbackFastModel: 'gpt-5.6-luna',
      fallbackConfigured: true,
      providers: {
        openai: {
          primary: 'gpt-5.6-terra',
          fast: 'gpt-5.6-luna',
          configured: true,
        },
        anthropic: {
          primary: 'claude-sonnet-5',
          fast: 'claude-haiku-4-5-20251001',
          configured: true,
        },
      },
      primaryTimeoutMs: 28000,
      fastTimeoutMs: 8000,
    });
    expect(JSON.stringify(getAIStatus())).not.toContain('test-key');
    expect(isAIAvailable()).toBe(true);
  });

  test('reports AI unavailable when neither provider key is configured', () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const { isAIAvailable } = loadClient('openai');

    expect(isAIAvailable()).toBe(false);
  });

  test('switches the preferred provider at runtime', async () => {
    mockAnthropicCreate.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'runtime switch' }] });
    const { askAI, getAIStatus, updateAISettings } = loadClient('openai');

    expect(updateAISettings({ provider: 'anthropic' })).toEqual(expect.objectContaining({
      enabled: true,
      provider: 'anthropic',
      defaultProvider: 'openai',
    }));
    await expect(askAI('conditions')).resolves.toBe('runtime switch');
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
    expect(mockOpenAICreate).not.toHaveBeenCalled();
    expect(getAIStatus().fallbackProvider).toBe('openai');
  });

  test('kill switch blocks text and vision calls before reaching a provider', async () => {
    const { askAI, askAIVision, getAIStatus, isAIAvailable, updateAISettings } = loadClient('openai');

    updateAISettings({ enabled: false });

    await expect(askAI('conditions')).rejects.toMatchObject({ code: 'AI_DISABLED' });
    await expect(askAIVision('YWJj', 'analyze')).rejects.toMatchObject({ code: 'AI_DISABLED' });
    expect(mockOpenAICreate).not.toHaveBeenCalled();
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    expect(getAIStatus()).toEqual(expect.objectContaining({ enabled: false, available: false }));
    expect(isAIAvailable()).toBe(false);
  });

  test('rejects switching to a provider without a configured key', () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { getAIStatus, updateAISettings } = loadClient('openai');

    expect(() => updateAISettings({ provider: 'anthropic' })).toThrow('anthropic is not configured');
    expect(getAIStatus().provider).toBe('openai');
  });

  test('falls back when the selected provider API key is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    mockOpenAICreate.mockResolvedValue({ status: 'completed', output_text: 'fallback brief' });
    const { askAI } = loadClient('anthropic');

    await expect(askAI('conditions')).resolves.toBe('fallback brief');
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    expect(mockOpenAICreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.6-terra' }),
      { timeout: 28000, maxRetries: 0 },
    );
  });

  test('fails over from OpenAI to Anthropic using the matching tier', async () => {
    mockOpenAICreate.mockRejectedValue(new Error('OpenAI unavailable'));
    mockAnthropicCreate.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'fallback routes' }] });
    const { askAI } = loadClient('openai');

    await expect(askAI('routes', { tier: 'fast' })).resolves.toBe('fallback routes');
    expect(mockAnthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001' }),
      { timeout: 8000, maxRetries: 0 },
    );
  });

  test('fails over from Anthropic to OpenAI', async () => {
    mockAnthropicCreate.mockRejectedValue(new Error('Anthropic unavailable'));
    mockOpenAICreate.mockResolvedValue({ status: 'completed', output_text: 'fallback brief' });
    const { askAI } = loadClient('anthropic');

    await expect(askAI('conditions')).resolves.toBe('fallback brief');
    expect(mockOpenAICreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.6-terra' }),
      { timeout: 28000, maxRetries: 0 },
    );
  });

  test('preserves the original error when no fallback key is configured', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    mockOpenAICreate.mockRejectedValue(new Error('OpenAI unavailable'));
    const { askAI } = loadClient('openai');

    await expect(askAI('conditions')).rejects.toThrow('OpenAI unavailable');
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  test('reports both provider failures', async () => {
    mockOpenAICreate.mockRejectedValue(new Error('OpenAI unavailable'));
    mockAnthropicCreate.mockRejectedValue(new Error('Anthropic unavailable'));
    const { askAI } = loadClient('openai');

    await expect(askAI('conditions')).rejects.toThrow('Both AI providers failed');
    expect(mockOpenAICreate).toHaveBeenCalledTimes(1);
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
  });

  test('rejects unsupported providers at startup', () => {
    expect(() => loadClient('unsupported')).toThrow('AI_PROVIDER must be one of');
  });
});
