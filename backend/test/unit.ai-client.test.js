const mockOpenAICreate = jest.fn();
const mockAnthropicCreate = jest.fn();
const mockGeminiCreate = jest.fn();

jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  responses: { create: mockOpenAICreate },
  chat: { completions: { create: mockGeminiCreate } },
})));
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({
  messages: { create: mockAnthropicCreate },
})));

const ENV_KEYS = [
  'AI_PROVIDER',
  'AI_ENABLED',
  'AI_FAILOVER_ENABLED',
  'AI_SETTINGS_FILE',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'OPENAI_FAST_MODEL',
  'OPENAI_MODEL_OPTIONS',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_FAST_MODEL',
  'ANTHROPIC_MODEL_OPTIONS',
  'GEMINI_API_KEY',
  'GEMINI_BASE_URL',
  'GEMINI_MODEL',
  'GEMINI_FAST_MODEL',
  'GEMINI_MODEL_OPTIONS',
  'AI_PRIMARY_TIMEOUT_MS',
  'AI_FAST_TIMEOUT_MS',
  'AI_REASONING_EFFORT',
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
    mockGeminiCreate.mockReset();
    process.env.OPENAI_API_KEY = 'openai-test-key';
    process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_FAST_MODEL;
    delete process.env.OPENAI_MODEL_OPTIONS;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_FAST_MODEL;
    delete process.env.ANTHROPIC_MODEL_OPTIONS;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_BASE_URL;
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_FAST_MODEL;
    delete process.env.GEMINI_MODEL_OPTIONS;
    delete process.env.AI_PRIMARY_TIMEOUT_MS;
    delete process.env.AI_FAST_TIMEOUT_MS;
    delete process.env.AI_REASONING_EFFORT;
    delete process.env.AI_ENABLED;
    delete process.env.AI_FAILOVER_ENABLED;
    delete process.env.AI_SETTINGS_FILE;
  });

  afterAll(() => {
    ENV_KEYS.forEach((key) => {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    });
  });

  test('rejects the removed Kimi provider in environment and runtime settings', () => {
    expect(() => loadClient('kimi')).toThrow('AI_PROVIDER must be one of: openai, anthropic, gemini');
    const client = loadClient('openai');
    expect(() => client.updateAISettings({ provider: 'kimi' })).toThrow('provider must be one of');
    expect(() => client.updateAISettings({ models: { kimi: { primary: 'old-model' } } }))
      .toThrow('Unknown AI model provider');
    expect(Object.keys(client.getAIStatus().providers)).toEqual(['openai', 'anthropic', 'gemini']);
  });

  test('ignores persisted Kimi settings while preserving supported provider settings', async () => {
    jest.doMock('../src/db/app-data-store', () => ({
      appDataStore: {
        configured: true,
        getAdminSetting: jest.fn().mockResolvedValue({
          provider: 'kimi',
          models: {
            kimi: { primary: 'old-model' },
            openai: { primary: 'gpt-custom' },
          },
        }),
      },
    }));
    try {
      const client = loadClient('openai');
      await client.initializeAISettings();
      const status = client.getAIStatus();
      expect(status.provider).toBe('openai');
      expect(status.providers.openai.primary).toBe('gpt-custom');
      expect(status.providers).not.toHaveProperty('kimi');
    } finally {
      jest.dontMock('../src/db/app-data-store');
      jest.resetModules();
    }
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
      reasoning: { effort: 'low' },
    }, { timeout: 28000, maxRetries: 0 });
  });

  test('caps reasoning effort only for models that accept one', async () => {
    mockOpenAICreate.mockResolvedValue({ status: 'completed', output_text: 'ok' });
    const { askAI, reasoningEffortFor } = loadClient('openai');

    expect(reasoningEffortFor('openai', 'gpt-5.6-luna')).toBe('low');
    expect(reasoningEffortFor('openai', 'o4-mini')).toBe('low');
    expect(reasoningEffortFor('openai', 'gpt-5.5-pro')).toBeNull();
    expect(reasoningEffortFor('openai', 'gpt-5-chat-latest')).toBeNull();
    expect(reasoningEffortFor('openai', 'gpt-4.1')).toBeNull();
    expect(reasoningEffortFor('gemini', 'gemini-3.5-flash-lite')).toBe('low');
    expect(reasoningEffortFor('gemini', 'gemini-2.0-flash')).toBeNull();
    expect(reasoningEffortFor('anthropic', 'claude-sonnet-5')).toBeNull();

    await askAI('conditions', { model: 'gpt-4.1' });
    expect(mockOpenAICreate.mock.calls[0][0]).not.toHaveProperty('reasoning');
  });

  test('AI_REASONING_EFFORT overrides or disables the effort cap', () => {
    process.env.AI_REASONING_EFFORT = 'medium';
    expect(loadClient('openai').reasoningEffortFor('openai', 'gpt-5.6-terra')).toBe('medium');
    process.env.AI_REASONING_EFFORT = 'minimal';
    const minimal = loadClient('openai');
    expect(minimal.reasoningEffortFor('openai', 'gpt-5-mini')).toBe('minimal');
    expect(minimal.reasoningEffortFor('openai', 'gpt-5.6-terra')).toBe('low');
    expect(minimal.reasoningEffortFor('gemini', 'gemini-3.7-flash')).toBe('low');
    process.env.AI_REASONING_EFFORT = 'none';
    const none = loadClient('openai');
    expect(none.reasoningEffortFor('openai', 'gpt-5.6-luna')).toBe('none');
    expect(none.reasoningEffortFor('openai', 'gpt-5-nano')).toBe('low');
    expect(none.reasoningEffortFor('openai', 'o3')).toBe('low');
    process.env.AI_REASONING_EFFORT = 'default';
    const client = loadClient('openai');
    expect(client.reasoningEffortFor('openai', 'gpt-5.6-terra')).toBeNull();
    expect(client.getAIStatus().reasoningEffort).toBe('default');
    process.env.AI_REASONING_EFFORT = 'extreme';
    expect(() => loadClient('openai')).toThrow('AI_REASONING_EFFORT must be one of');
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

  test('sends text and system prompts through the Gemini chat completions API', async () => {
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    process.env.GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
    mockGeminiCreate.mockResolvedValue({
      choices: [{ message: { content: '  Gemini field brief  ' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 18, completion_tokens: 7, total_tokens: 25 },
    });
    const { askAI } = loadClient('gemini');

    await expect(askAI('conditions', { maxTokens: 700, system: 'Be concise.' })).resolves.toBe('Gemini field brief');
    expect(mockGeminiCreate).toHaveBeenCalledWith({
      model: 'gemini-3.7-flash',
      max_tokens: 700,
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'conditions' },
      ],
      reasoning_effort: 'low',
    }, { timeout: 28000, maxRetries: 0 });
  });

  test('sends base64 images through Gemini multimodal chat input', async () => {
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    mockGeminiCreate.mockResolvedValue({
      choices: [{ message: { content: 'snow coverage' }, finish_reason: 'stop' }],
    });
    const { askAIVision } = loadClient('gemini');

    await expect(askAIVision('YWJj', 'analyze', { mediaType: 'image/jpeg' })).resolves.toBe('snow coverage');
    expect(mockGeminiCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.7-flash',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,YWJj' } },
          { type: 'text', text: 'analyze' },
        ],
      }],
    }), { timeout: 28000, maxRetries: 0 });
  });

  test('reports the selected provider and models without exposing keys', () => {
    const { getAIStatus, isAIAvailable } = loadClient('anthropic');

    expect(getAIStatus()).toEqual({
      enabled: true,
      failoverEnabled: true,
      available: true,
      persistent: false,
      provider: 'anthropic',
      defaultProvider: 'anthropic',
      primaryModel: 'claude-sonnet-5',
      fastModel: 'claude-haiku-4-5-20251001',
      reasoningEffort: 'low',
      configured: true,
      fallbackProvider: 'openai',
      fallbackPrimaryModel: 'gpt-5.6-terra',
      fallbackFastModel: 'gpt-5.6-luna',
      fallbackConfigured: true,
      providers: {
        openai: {
          primary: 'gpt-5.6-terra',
          fast: 'gpt-5.6-luna',
          options: ['gpt-5.6-terra', 'gpt-5.6-luna'],
          configured: true,
        },
        anthropic: {
          primary: 'claude-sonnet-5',
          fast: 'claude-haiku-4-5-20251001',
          options: ['claude-sonnet-5', 'claude-haiku-4-5-20251001'],
          configured: true,
        },
        gemini: {
          primary: 'gemini-3.7-flash',
          fast: 'gemini-3.5-flash-lite',
          options: ['gemini-3.7-flash', 'gemini-3.5-flash-lite'],
          configured: false,
        },
      },
      features: {
        aiBrief: { enabled: true, available: true },
        reportChat: { enabled: true, available: true },
        routeAnalysis: { enabled: true, available: true },
        snowVision: { enabled: true, available: true },
      },
      primaryTimeoutMs: 28000,
      fastTimeoutMs: 8000,
    });
    expect(JSON.stringify(getAIStatus())).not.toContain('test-key');
    expect(isAIAvailable()).toBe(true);
  });

  test('reports AI unavailable when no provider key is configured', () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const { isAIAvailable } = loadClient('openai');

    expect(isAIAvailable()).toBe(false);
  });

  test('uses AI_ENABLED as the startup fallback when no settings file exists', () => {
    process.env.AI_ENABLED = 'false';
    const { getAIStatus, isAIAvailable } = loadClient('openai');

    expect(getAIStatus()).toEqual(expect.objectContaining({
      enabled: false,
      persistent: false,
      features: {
        aiBrief: { enabled: false, available: false },
        reportChat: { enabled: false, available: false },
        routeAnalysis: { enabled: false, available: false },
        snowVision: { enabled: false, available: false },
      },
    }));
    expect(isAIAvailable()).toBe(false);
  });

  test('loads runtime settings from PostgreSQL', async () => {
    const getAdminSetting = jest.fn().mockResolvedValue({
      enabled: false,
      failoverEnabled: false,
      provider: 'anthropic',
      features: {
        aiBrief: false,
        reportChat: false,
        routeAnalysis: false,
        snowVision: false,
      },
      models: {
        openai: { primary: 'gpt-5.6-terra', fast: 'gpt-5.6-luna' },
        anthropic: { primary: 'claude-sonnet-5', fast: 'claude-haiku-4-5-20251001' },
      },
    });
    jest.doMock('../src/db/app-data-store', () => ({
      appDataStore: { configured: true, getAdminSetting, setAdminSetting: jest.fn() },
    }));
    try {
      const client = loadClient('openai');
      await client.initializeAISettings();
      expect(getAdminSetting).toHaveBeenCalledWith('ai_settings');
      expect(client.getAIStatus()).toEqual(expect.objectContaining({
        enabled: false,
        failoverEnabled: false,
        provider: 'anthropic',
        defaultProvider: 'openai',
        persistent: true,
        features: expect.objectContaining({
          aiBrief: { enabled: false, available: false },
          reportChat: { enabled: false, available: false },
          routeAnalysis: { enabled: false, available: false },
          snowVision: { enabled: false, available: false },
        }),
      }));
    } finally {
      jest.dontMock('../src/db/app-data-store');
      jest.resetModules();
    }
  });

  test('switches the preferred provider at runtime', async () => {
    mockAnthropicCreate.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'runtime switch' }] });
    const { askAI, getAIStatus, updateAISettings } = loadClient('openai');

    expect(await updateAISettings({ provider: 'anthropic' })).toEqual(expect.objectContaining({
      enabled: true,
      provider: 'anthropic',
      defaultProvider: 'openai',
    }));
    await expect(askAI('conditions')).resolves.toBe('runtime switch');
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
    expect(mockOpenAICreate).not.toHaveBeenCalled();
    expect(getAIStatus().fallbackProvider).toBe('openai');
  });

  test('switches provider model tiers at runtime and uses them for requests', async () => {
    process.env.OPENAI_MODEL_OPTIONS = 'gpt-custom-primary,gpt-custom-fast';
    process.env.ANTHROPIC_MODEL_OPTIONS = 'claude-custom-primary,claude-custom-fast';
    mockOpenAICreate.mockResolvedValue({ status: 'completed', output_text: 'custom openai' });
    mockAnthropicCreate.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'custom claude' }] });
    const { askAI, getAIStatus, updateAISettings } = loadClient('openai');

    const status = await updateAISettings({
      models: {
        openai: { primary: 'gpt-custom-primary', fast: 'gpt-custom-fast' },
        anthropic: { primary: 'claude-custom-primary', fast: 'claude-custom-fast' },
      },
    });

    expect(status.providers).toMatchObject({
      openai: {
        primary: 'gpt-custom-primary',
        fast: 'gpt-custom-fast',
        options: expect.arrayContaining(['gpt-custom-primary', 'gpt-custom-fast']),
      },
      anthropic: {
        primary: 'claude-custom-primary',
        fast: 'claude-custom-fast',
        options: expect.arrayContaining(['claude-custom-primary', 'claude-custom-fast']),
      },
    });

    await askAI('primary request');
    await askAI('fast request', { tier: 'fast' });
    expect(mockOpenAICreate).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ model: 'gpt-custom-primary' }),
      expect.any(Object));
    expect(mockOpenAICreate).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ model: 'gpt-custom-fast' }),
      expect.any(Object));
    expect(getAIStatus().primaryModel).toBe('gpt-custom-primary');
  });

  test('rejects invalid model settings', () => {
    const { updateAISettings } = loadClient('openai');

    expect(() => updateAISettings({ models: { unknown: { primary: 'model-id' } } }))
      .toThrow('Unknown AI model provider');
    expect(() => updateAISettings({ models: { openai: { slow: 'model-id' } } }))
      .toThrow('Unknown AI model tier');
    expect(() => updateAISettings({ models: { openai: { primary: 'model id with spaces' } } }))
      .toThrow('must be a valid model ID');
  });

  test('kill switch synchronizes every feature flag and blocks provider calls', async () => {
    const { askAI, askAIVision, getAIStatus, isAIAvailable, updateAISettings } = loadClient('openai');

    await updateAISettings({ enabled: false });

    await expect(askAI('conditions')).rejects.toMatchObject({ code: 'AI_DISABLED', message: 'AI features are unavailable' });
    await expect(askAIVision('YWJj', 'analyze')).rejects.toMatchObject({ code: 'AI_DISABLED', message: 'AI features are unavailable' });
    expect(mockOpenAICreate).not.toHaveBeenCalled();
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    expect(getAIStatus()).toEqual(expect.objectContaining({
      enabled: false,
      available: false,
      features: {
        aiBrief: { enabled: false, available: false },
        reportChat: { enabled: false, available: false },
        routeAnalysis: { enabled: false, available: false },
        snowVision: { enabled: false, available: false },
      },
    }));
    expect(isAIAvailable()).toBe(false);

    await updateAISettings({ enabled: true });
    expect(getAIStatus().features).toEqual({
      aiBrief: { enabled: true, available: true },
      reportChat: { enabled: true, available: true },
      routeAnalysis: { enabled: true, available: true },
      snowVision: { enabled: true, available: true },
    });
  });

  test('individual feature switches only block the selected feature', async () => {
    const {
      assertAIFeatureEnabled,
      getAIStatus,
      isAIFeatureAvailable,
      updateAISettings,
    } = loadClient('openai');

    await updateAISettings({ features: { aiBrief: false } });

    expect(() => assertAIFeatureEnabled('aiBrief')).toThrow(expect.objectContaining({
      code: 'AI_FEATURE_DISABLED',
      message: 'AI features are unavailable',
    }));
    expect(() => assertAIFeatureEnabled('reportChat')).not.toThrow();
    expect(isAIFeatureAvailable('aiBrief')).toBe(false);
    expect(isAIFeatureAvailable('reportChat')).toBe(true);
    expect(getAIStatus().features).toMatchObject({
      aiBrief: { enabled: false, available: false },
      reportChat: { enabled: true, available: true },
    });
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

  test('does not retry another provider when failover is disabled', async () => {
    mockOpenAICreate.mockRejectedValue(new Error('OpenAI unavailable'));
    mockAnthropicCreate.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'fallback routes' }] });
    const { askAI, getAIStatus, updateAISettings } = loadClient('openai');

    await updateAISettings({ failoverEnabled: false });

    expect(getAIStatus()).toEqual(expect.objectContaining({
      failoverEnabled: false,
      fallbackConfigured: false,
    }));
    await expect(askAI('routes')).rejects.toThrow('OpenAI unavailable');
    expect(mockOpenAICreate).toHaveBeenCalledTimes(1);
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  test('does not substitute a configured provider when failover is disabled', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { askAI, getAIStatus, updateAISettings } = loadClient('anthropic');

    await updateAISettings({ failoverEnabled: false });

    expect(getAIStatus()).toEqual(expect.objectContaining({
      available: false,
      failoverEnabled: false,
    }));
    await expect(askAI('conditions')).rejects.toMatchObject({ code: 'AI_PROVIDER_NOT_CONFIGURED' });
    expect(mockOpenAICreate).not.toHaveBeenCalled();
  });

  test('rejects a non-boolean failover setting', () => {
    const { updateAISettings } = loadClient('openai');

    expect(() => updateAISettings({ failoverEnabled: 'yes' }))
      .toThrow('failoverEnabled must be a boolean');
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

  test('fails over through configured providers to Gemini', async () => {
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    mockOpenAICreate.mockRejectedValue(new Error('OpenAI unavailable'));
    mockAnthropicCreate.mockRejectedValue(new Error('Anthropic unavailable'));
    mockGeminiCreate.mockResolvedValue({
      choices: [{ message: { content: 'Gemini fallback brief' }, finish_reason: 'stop' }],
    });
    const { askAI } = loadClient('openai');

    await expect(askAI('conditions')).resolves.toBe('Gemini fallback brief');
    expect(mockOpenAICreate).toHaveBeenCalledTimes(1);
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
    expect(mockGeminiCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-3.7-flash', max_tokens: 4096 }),
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
