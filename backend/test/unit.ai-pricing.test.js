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
      estimatedCostUsd: 0.004,
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
    }).estimatedCostUsd).toBe(0.00124);
  });

  test('accounts for Anthropic cache tokens and Sonnet 5 promotional pricing', () => {
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
    })).toMatchObject({ inputPerMillion: 3, outputPerMillion: 15 });
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
