const { createAIModelCatalog, normalizeModelIds } = require('../src/utils/ai-model-catalog');

const jsonResponse = (payload, ok = true) => ({
  ok,
  json: jest.fn(async () => payload),
});

const aiStatus = () => ({
  providers: {
    openai: {
      primary: 'gpt-current',
      fast: 'gpt-fast',
      options: ['gpt-configured'],
    },
    anthropic: {
      primary: 'claude-current',
      fast: 'claude-fast',
      options: ['claude-configured'],
    },
  },
});

test('normalizes, deduplicates, and sorts provider model IDs', () => {
  expect(normalizeModelIds([' z ', 'a'], ['a', null, ''])).toEqual(['a', 'z']);
});

test('loads complete provider catalogs, follows Claude pagination, and caches results', async () => {
  let currentTime = Date.parse('2026-07-12T12:00:00.000Z');
  const fetchWithTimeout = jest.fn(async (url, options) => {
    if (url === 'https://api.openai.com/v1/models') {
      expect(options.headers.Authorization).toBe('Bearer openai-secret');
      return jsonResponse({ data: [{ id: 'gpt-z' }, { id: 'gpt-a' }] });
    }
    expect(options.headers['x-api-key']).toBe('anthropic-secret');
    expect(options.headers['anthropic-version']).toBe('2023-06-01');
    if (!url.includes('after_id=')) {
      expect(url).toContain('limit=1000');
      return jsonResponse({ data: [{ id: 'claude-z' }], has_more: true, last_id: 'cursor-1' });
    }
    expect(url).toContain('after_id=cursor-1');
    return jsonResponse({ data: [{ id: 'claude-a' }, { id: 'claude-z' }], has_more: false });
  });
  const catalog = createAIModelCatalog({
    fetchWithTimeout,
    getAIStatus: aiStatus,
    env: { OPENAI_API_KEY: 'openai-secret', ANTHROPIC_API_KEY: 'anthropic-secret' },
    now: () => currentTime,
  });

  const first = await catalog.load();
  expect(first).toEqual({
    fetchedAt: '2026-07-12T12:00:00.000Z',
    providers: {
      openai: {
        models: ['gpt-a', 'gpt-configured', 'gpt-current', 'gpt-fast', 'gpt-z'],
        source: 'provider',
        error: null,
      },
      anthropic: {
        models: ['claude-a', 'claude-configured', 'claude-current', 'claude-fast', 'claude-z'],
        source: 'provider',
        error: null,
      },
    },
  });
  expect(fetchWithTimeout).toHaveBeenCalledTimes(3);

  currentTime += 1000;
  expect(await catalog.load()).toBe(first);
  expect(fetchWithTimeout).toHaveBeenCalledTimes(3);

  await catalog.load({ force: true });
  expect(fetchWithTimeout).toHaveBeenCalledTimes(6);
});

test('falls back to configured models without exposing provider failures or missing keys', async () => {
  const fetchWithTimeout = jest.fn(async (url) => {
    if (url.includes('openai.com')) throw new Error('secret upstream failure details');
    return jsonResponse({ data: [] });
  });
  const catalog = createAIModelCatalog({
    fetchWithTimeout,
    getAIStatus: aiStatus,
    env: { OPENAI_API_KEY: 'openai-secret' },
    now: () => 0,
  });

  const result = await catalog.load();
  expect(result.providers.openai).toEqual({
    models: ['gpt-configured', 'gpt-current', 'gpt-fast'],
    source: 'configured',
    error: 'OpenAI model catalog is temporarily unavailable',
  });
  expect(result.providers.anthropic).toEqual({
    models: ['claude-configured', 'claude-current', 'claude-fast'],
    source: 'configured',
    error: 'API key not configured',
  });
  expect(JSON.stringify(result)).not.toContain('secret upstream failure details');
  expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
});
