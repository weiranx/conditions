const express = require('express');
const request = require('supertest');
const {
  MAX_MESSAGE_LENGTH,
  MAX_MESSAGES,
  MAX_REPORT_LENGTH,
  createContextualFollowUps,
  normalizeReport,
  registerReportChatRoute,
  sanitizeFollowUpSuggestions,
  sanitizeMessages,
} = require('../src/routes/report-chat');

describe('report chat request handling', () => {
  test('normalizes object and JSON-string reports', () => {
    expect(normalizeReport({ safety: { score: 72 } })).toBe('{"safety":{"score":72}}');
    expect(normalizeReport('{"decision":{"level":"CAUTION"}}')).toBe('{"decision":{"level":"CAUTION"}}');
    expect(() => normalizeReport('not-json')).toThrow(/valid JSON/i);
    expect(() => normalizeReport([])).toThrow(/object/i);
  });

  test('bounds oversized report context', () => {
    const normalized = normalizeReport({ detail: 'x'.repeat(MAX_REPORT_LENGTH + 100) });
    expect(normalized.length).toBeGreaterThan(MAX_REPORT_LENGTH);
    expect(normalized).toContain('[Report truncated');
  });

  test('keeps recent text messages and removes unsupported parts', () => {
    const messages = Array.from({ length: MAX_MESSAGES + 2 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      parts: [
        { type: 'text', text: `message ${index}${'x'.repeat(MAX_MESSAGE_LENGTH)}` },
        { type: 'file', url: 'https://example.com/file' },
      ],
    }));
    const sanitized = sanitizeMessages(messages);
    expect(sanitized).toHaveLength(MAX_MESSAGES);
    expect(sanitized[0].id).toBe('message-2');
    expect(sanitized[0].parts).toEqual([{ type: 'text', text: expect.any(String) }]);
    expect(sanitized[0].parts[0].text).toHaveLength(MAX_MESSAGE_LENGTH);
  });

  test('normalizes, deduplicates, and bounds contextual follow-up suggestions', () => {
    const suggestions = sanitizeFollowUpSuggestions({
      suggestions: [
        ' 1. How does the 35 mph gust affect the ridge? ',
        'How does the 35 mph gust affect the ridge?',
        'Which north-facing slope was called out',
        '',
        'What changes after the 2 PM return time?',
        'A'.repeat(121),
      ],
    }, ['What is driving the risk score?']);

    expect(suggestions).toEqual([
      'How does the 35 mph gust affect the ridge?',
      'Which north-facing slope was called out?',
      'What changes after the 2 PM return time?',
    ]);
  });

  test('does not suggest a question the user already asked', () => {
    expect(sanitizeFollowUpSuggestions({
      suggestions: [
        'What should I verify before leaving?',
        'Which source is stale?',
      ],
    }, ['What should I verify before leaving?'])).toEqual(['Which source is stale?']);
  });

  test('generates follow-ups from the full conversation and latest answer', async () => {
    const generateText = jest.fn(async () => ({
      output: {
        suggestions: [
          'How does the 2 PM wind increase affect the ridge?',
          'Which source should I refresh before leaving?',
          'Would an earlier turnaround avoid the strongest gusts?',
        ],
      },
    }));
    const modelMessages = [
      { role: 'user', content: 'Why is the afternoon risk higher?' },
    ];
    const messages = [{
      role: 'user',
      parts: [{ type: 'text', text: 'Why is the afternoon risk higher?' }],
    }];

    const suggestions = await createContextualFollowUps({
      model: { modelId: 'test-model' },
      modelMessages,
      answer: 'Wind gusts rise after 2 PM and affect the exposed ridge.',
      messages,
      abortSignal: new AbortController().signal,
      generateText,
      jsonSchema: (schema) => schema,
      Output: { object: (options) => options },
    });

    expect(suggestions).toHaveLength(3);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText.mock.calls[0][0].messages).toEqual([
      ...modelMessages,
      { role: 'assistant', content: 'Wind gusts rise after 2 PM and affect the exposed ridge.' },
      { role: 'user', content: 'Generate the three best next questions for this conversation.' },
    ]);
  });

  test('falls back to line-delimited questions when structured output is unavailable', async () => {
    const generateText = jest
      .fn()
      .mockRejectedValueOnce(new Error('Structured output unsupported'))
      .mockResolvedValueOnce({
        text: [
          'How does the stale weather source affect confidence?',
          'Which ridge section sees the strongest gusts?',
          'Would leaving before noon avoid the wind increase?',
        ].join('\n'),
      });

    const suggestions = await createContextualFollowUps({
      model: { modelId: 'test-model' },
      modelMessages: [{ role: 'user', content: 'Why is this caution?' }],
      answer: 'The weather source is stale and ridge gusts increase after noon.',
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Why is this caution?' }] }],
      abortSignal: new AbortController().signal,
      generateText,
      jsonSchema: (schema) => schema,
      Output: { object: (options) => options },
    });

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(suggestions).toEqual([
      'How does the stale weather source affect confidence?',
      'Which ridge section sees the strongest gusts?',
      'Would leaving before noon avoid the wind increase?',
    ]);
  });

  test('streams a valid report-aware request after validation', async () => {
    const app = express();
    app.use(express.json());
    const createStream = jest.fn(async ({ messages, reportJson }) => ({ messages, reportJson }));
    const pipeStream = jest.fn(({ response, stream }) => response.status(200).json({
      ok: true,
      message: stream.messages[0].parts[0].text,
      reportJson: stream.reportJson,
    }));
    registerReportChatRoute({ app, createStream, pipeStream });

    const response = await request(app)
      .post('/api/report-chat')
      .send({
        report: { decision: { level: 'CAUTION' } },
        messages: [{ id: 'question', role: 'user', parts: [{ type: 'text', text: 'What is driving the risk?' }] }],
      });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('What is driving the risk?');
    expect(response.body.reportJson).toContain('CAUTION');
    expect(createStream).toHaveBeenCalledTimes(1);
    expect(pipeStream).toHaveBeenCalledTimes(1);
  });

  test('rejects requests without report context or a final user message', async () => {
    const app = express();
    app.use(express.json());
    const createStream = jest.fn();
    registerReportChatRoute({ app, createStream });

    const noReport = await request(app).post('/api/report-chat').send({ messages: [] });
    expect(noReport.status).toBe(400);

    const noUser = await request(app)
      .post('/api/report-chat')
      .send({ report: {}, messages: [{ id: 'answer', role: 'assistant', parts: [{ type: 'text', text: 'Answer' }] }] });
    expect(noUser.status).toBe(400);
    expect(createStream).not.toHaveBeenCalled();
  });
});
