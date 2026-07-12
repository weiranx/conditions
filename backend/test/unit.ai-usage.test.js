const { normalizeTokenUsage } = require('../src/utils/ai-usage');

describe('AI usage token normalization', () => {
  test('normalizes OpenAI snake-case token usage', () => {
    expect(normalizeTokenUsage({
      input_tokens: 120,
      output_tokens: 30,
      total_tokens: 150,
    })).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
    });
  });

  test('normalizes Anthropic and AI SDK token usage', () => {
    expect(normalizeTokenUsage({ input_tokens: 80, output_tokens: 20 })).toEqual({
      inputTokens: 80,
      outputTokens: 20,
      totalTokens: 100,
    });
    expect(normalizeTokenUsage({ inputTokens: 45, outputTokens: 15, totalTokens: 60 })).toEqual({
      inputTokens: 45,
      outputTokens: 15,
      totalTokens: 60,
    });
  });

  test('clamps invalid values and never undercounts the token total', () => {
    expect(normalizeTokenUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 2 })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
    expect(normalizeTokenUsage({ inputTokens: -1, outputTokens: 'invalid' })).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
  });
});
