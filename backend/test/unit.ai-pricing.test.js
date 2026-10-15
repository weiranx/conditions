const {
  estimateAIUsageCost,
  normalizeBillableTokens,
  resolveAIModelPricing,
} = require('../src/utils/ai-pricing');

describe('AI usage cost estimation', () => {
  test('uses current OpenAI standard token pricing', () => {
    expect(estimateAIUsageCost({
      provider: 'openai',
      model: 'gpt-5.6-terra',
      usage: { input_tokens: 1000, output_tokens: 100 },
      timestamp: '2026-07-12T12:00:00.000Z',
    })).toEqual({
      estimatedCostUsd: 0.0032,
      pricingMatched: true,
      pricingVersion: '2026-10-14',
    });

    expect(estimateAIUsageCost({
      provider: 'openai',
      model: 'gpt-5.6-luna-2026-06-01',
      usage: {
        input_tokens: 1000,
        output_tokens: 100,
        input_tokens_details: { cached_tokens: 400 },
      },
    }).estimatedCostUsd).toBe(0.000248);
  });

  test('bills OpenAI prompts over 272K tokens on the long-context rates', () => {
    expect(estimateAIUsageCost({
      provider: 'openai',
      model: 'gpt-5.6-terra',
      usage: { input_tokens: 272_000, output_tokens: 1000 },
    }).estimatedCostUsd).toBe(0.556);
    expect(estimateAIUsageCost({
      provider: 'openai',
      model: 'gpt-5.6-terra',
      usage: { input_tokens: 300_000, output_tokens: 1000 },
    }).estimatedCostUsd).toBe(1.218);
  });

  test('matches the most specific model ID and its own cached-input rate', () => {
    const price = (provider, model) => resolveAIModelPricing({ provider, model });
    expect(price('anthropic', 'claude-opus-5-5')).toMatchObject({ inputPerMillion: 4, cachedInputPerMillion: 0.2 });
    expect(price('anthropic', 'claude-opus-5')).toMatchObject({ inputPerMillion: 5, outputPerMillion: 25 });
    expect(price('anthropic', 'claude-fable-5-1')).toMatchObject({ inputPerMillion: 10, cachedInputPerMillion: 0.25 });
    expect(price('anthropic', 'claude-fable-5')).toMatchObject({ inputPerMillion: 10, cachedInputPerMillion: 1 });
    expect(price('anthropic', 'claude-sonnet-5-5')).toMatchObject({ inputPerMillion: 2, outputPerMillion: 10 });
    expect(price('openai', 'gpt-6.1-sol')).toMatchObject({ inputPerMillion: 2, cachedInputPerMillion: 0.1 });
    expect(price('openai', 'gpt-6-sol')).toMatchObject({ inputPerMillion: 2, cachedInputPerMillion: 0.2 });
    expect(price('openai', 'gpt-4.1')).toMatchObject({ inputPerMillion: 2, cachedInputPerMillion: 0.5 });
    expect(price('openai', 'gpt-4o-2024-05-13')).toMatchObject({ inputPerMillion: 5, outputPerMillion: 15 });
    expect(price('openai', 'gpt-4o-2024-08-06')).toMatchObject({ inputPerMillion: 2.5, outputPerMillion: 10 });
  });

  test('bills Claude Haiku 5.5 prompts over 100K tokens on its second rate card', () => {
    expect(estimateAIUsageCost({
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      usage: { input_tokens: 100_000, output_tokens: 1000 },
    }).estimatedCostUsd).toBe(0.0105);
    expect(estimateAIUsageCost({
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      usage: { input_tokens: 90_000, cache_read_input_tokens: 20_000, output_tokens: 1000 },
    }).estimatedCostUsd).toBe(0.0485);
  });

  test('accounts for Anthropic cache tokens', () => {
    const usage = {
      input_tokens: 1000,
      output_tokens: 100,
      cache_read_input_tokens: 500,
      cache_creation_input_tokens: 200,
    };
    expect(normalizeBillableTokens(usage)).toEqual({
      uncachedInputTokens: 1000,
      cacheReadTokens: 500,
      cacheWrite5mTokens: 200,
      cacheWrite1hTokens: 0,
      outputTokens: 100,
    });
    expect(estimateAIUsageCost({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      usage,
      timestamp: '2026-07-12T12:00:00.000Z',
    }).estimatedCostUsd).toBe(0.0036);
    expect(resolveAIModelPricing({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      timestamp: '2026-09-01T00:00:00.000Z',
    })).toMatchObject({ inputPerMillion: 2, outputPerMillion: 10 });
  });

  test('prices Gemini models, including cached prompt tokens and the Flash promotion', () => {
    expect(estimateAIUsageCost({
      provider: 'gemini',
      model: 'gemini-3.7-flash',
      usage: { prompt_tokens: 1000, completion_tokens: 100 },
      timestamp: '2026-10-14T12:00:00.000Z',
    }).estimatedCostUsd).toBe(0.001125);
    expect(estimateAIUsageCost({
      provider: 'gemini',
      model: 'gemini-3.7-flash',
      usage: { prompt_tokens: 1000, completion_tokens: 100 },
      timestamp: '2027-01-01T00:00:00.000Z',
    }).estimatedCostUsd).toBe(0.00225);
    expect(estimateAIUsageCost({
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 100,
        prompt_tokens_details: { cached_tokens: 500 },
      },
    }).estimatedCostUsd).toBe(0.000415);
    expect(estimateAIUsageCost({
      provider: 'gemini',
      model: 'gemini-4-argon',
      usage: { prompt_tokens: 1000, completion_tokens: 100 },
      timestamp: '2026-12-01T00:00:00.000Z',
    }).estimatedCostUsd).toBe(0.006);
    expect(estimateAIUsageCost({
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      usage: { prompt_tokens: 250_000, completion_tokens: 1000 },
    }).estimatedCostUsd).toBe(0.64);
  });

  test('marks unknown models as unpriced instead of guessing', () => {
    expect(estimateAIUsageCost({
      provider: 'openai',
      model: 'future-model-without-pricing',
      usage: { inputTokens: 1000, outputTokens: 100 },
    })).toEqual({
      estimatedCostUsd: null,
      pricingMatched: false,
      pricingVersion: '2026-10-14',
    });
  });
});
