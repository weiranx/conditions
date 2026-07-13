'use strict';

const MODEL_CATALOG_TTL_MS = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 10000;
const MAX_ANTHROPIC_PAGES = 20;

const normalizeModelIds = (...collections) => Array.from(new Set(
  collections
    .flat()
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean),
)).sort((left, right) => left.localeCompare(right));

const configuredModels = (providerStatus = {}) => normalizeModelIds(
  providerStatus.options || [],
  [providerStatus.primary, providerStatus.fast],
);

const readJsonResponse = async (response, provider) => {
  if (!response?.ok) {
    const error = new Error(`${provider} model catalog request failed`);
    error.code = 'AI_MODEL_CATALOG_REQUEST_FAILED';
    throw error;
  }
  try {
    return await response.json();
  } catch {
    const error = new Error(`${provider} model catalog response was invalid`);
    error.code = 'AI_MODEL_CATALOG_RESPONSE_INVALID';
    throw error;
  }
};

const fetchOpenAIModels = async ({ fetchWithTimeout, apiKey }) => {
  const response = await fetchWithTimeout('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  }, PROVIDER_TIMEOUT_MS);
  const payload = await readJsonResponse(response, 'OpenAI');
  return normalizeModelIds(Array.isArray(payload?.data) ? payload.data.map((model) => model?.id) : []);
};

const fetchAnthropicModels = async ({ fetchWithTimeout, apiKey }) => {
  const models = [];
  const seenCursors = new Set();
  let afterId = '';

  for (let page = 0; page < MAX_ANTHROPIC_PAGES; page += 1) {
    const search = new URLSearchParams({ limit: '1000' });
    if (afterId) search.set('after_id', afterId);
    const response = await fetchWithTimeout(`https://api.anthropic.com/v1/models?${search}`, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    }, PROVIDER_TIMEOUT_MS);
    const payload = await readJsonResponse(response, 'Anthropic');
    if (Array.isArray(payload?.data)) {
      models.push(...payload.data.map((model) => model?.id));
    }
    if (!payload?.has_more) return normalizeModelIds(models);

    const nextCursor = typeof payload?.last_id === 'string' ? payload.last_id.trim() : '';
    if (!nextCursor || seenCursors.has(nextCursor)) {
      const error = new Error('Anthropic model catalog pagination was invalid');
      error.code = 'AI_MODEL_CATALOG_PAGINATION_INVALID';
      throw error;
    }
    seenCursors.add(nextCursor);
    afterId = nextCursor;
  }

  const error = new Error('Anthropic model catalog exceeded the pagination limit');
  error.code = 'AI_MODEL_CATALOG_PAGINATION_LIMIT';
  throw error;
};

const createAIModelCatalog = ({ fetchWithTimeout, getAIStatus, env = process.env, now = Date.now } = {}) => {
  if (typeof fetchWithTimeout !== 'function' || typeof getAIStatus !== 'function') {
    throw new TypeError('fetchWithTimeout and getAIStatus are required');
  }

  let cached = null;
  let inFlight = null;

  const loadProvider = async ({ provider, apiKey, fetchModels, fallback }) => {
    if (!apiKey) {
      return { models: fallback, source: 'configured', error: 'API key not configured' };
    }
    try {
      const fetched = await fetchModels({ fetchWithTimeout, apiKey });
      return {
        models: normalizeModelIds(fetched, fallback),
        source: 'provider',
        error: null,
      };
    } catch {
      return {
        models: fallback,
        source: 'configured',
        error: `${provider} model catalog is temporarily unavailable`,
      };
    }
  };

  const refresh = async () => {
    const status = getAIStatus();
    const openAIFallback = configuredModels(status?.providers?.openai);
    const anthropicFallback = configuredModels(status?.providers?.anthropic);
    const [openai, anthropic] = await Promise.all([
      loadProvider({
        provider: 'OpenAI',
        apiKey: env.OPENAI_API_KEY || '',
        fetchModels: fetchOpenAIModels,
        fallback: openAIFallback,
      }),
      loadProvider({
        provider: 'Anthropic',
        apiKey: env.ANTHROPIC_API_KEY || '',
        fetchModels: fetchAnthropicModels,
        fallback: anthropicFallback,
      }),
    ]);
    const result = {
      fetchedAt: new Date(now()).toISOString(),
      providers: { openai, anthropic },
    };
    cached = { value: result, expiresAt: now() + MODEL_CATALOG_TTL_MS };
    return result;
  };

  const load = ({ force = false } = {}) => {
    if (!force && cached && cached.expiresAt > now()) return Promise.resolve(cached.value);
    if (inFlight) return inFlight;
    inFlight = refresh().finally(() => { inFlight = null; });
    return inFlight;
  };

  return { load };
};

module.exports = {
  MODEL_CATALOG_TTL_MS,
  createAIModelCatalog,
  normalizeModelIds,
};
