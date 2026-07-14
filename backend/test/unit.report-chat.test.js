const express = require('express');
const request = require('supertest');
const {
  MAX_MESSAGE_LENGTH,
  MAX_MESSAGES,
  MAX_REPORT_LENGTH,
  REPORT_CHAT_MAX_OUTPUT_TOKENS,
  REPORT_CHAT_SYSTEM_PROMPT,
  TRIP_CHAT_SYSTEM_PROMPT,
  createContextualFollowUps,
  normalizeReport,
  registerReportChatRoute: registerReportChatRouteWithoutAccount,
  sanitizeFollowUpSuggestions,
  sanitizeMessages,
} = require('../src/routes/report-chat');

const allowAccountAccess = async (req) => {
  req.accountUser = { id: '8c696be4-e175-4b6a-965b-82bdf3758e0c' };
  return true;
};
const registerReportChatRoute = (options) => registerReportChatRouteWithoutAccount({
  ...options,
  ensureAccountAccess: options.ensureAccountAccess || allowAccountAccess,
});

describe('report chat request handling', () => {
  test('allows useful outside-report route guidance without weakening live-condition guardrails', () => {
    expect(REPORT_CHAT_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(4096);
    expect(REPORT_CHAT_SYSTEM_PROMPT).toMatch(/supplement the report with well-established general backcountry knowledge/i);
    expect(REPORT_CHAT_SYSTEM_PROMPT).toMatch(/Do not refuse or stop merely because the report lacks a route line/i);
    expect(REPORT_CHAT_SYSTEM_PROMPT).toMatch(/Lead with the answer, not a disclaimer/i);
    expect(REPORT_CHAT_SYSTEM_PROMPT).toMatch(/specific report evidence and values/i);
    expect(REPORT_CHAT_SYSTEM_PROMPT).toMatch(/concrete timing, terrain, verification, gear, or turnaround actions/i);
    expect(REPORT_CHAT_SYSTEM_PROMPT).toMatch(/Keep a simple factual answer short/i);
    expect(REPORT_CHAT_SYSTEM_PROMPT).toMatch(/scope is limited to interpreting the attached report/i);
    expect(REPORT_CHAT_SYSTEM_PROMPT).toMatch(/programming, coding exercises/i);
    expect(REPORT_CHAT_SYSTEM_PROMPT).toMatch(/do not answer any part of it/i);
    expect(REPORT_CHAT_SYSTEM_PROMPT).toMatch(/one brief redirect/i);
    expect(REPORT_CHAT_SYSTEM_PROMPT).toMatch(/Never invent current conditions/i);
    expect(REPORT_CHAT_SYSTEM_PROMPT).toMatch(/never fabricate a name/i);
  });

  test('keeps multi-day chat focused on weather-window tradeoffs and current-source checks', () => {
    expect(TRIP_CHAT_SYSTEM_PROMPT).toMatch(/compare the forecast days/i);
    expect(TRIP_CHAT_SYSTEM_PROMPT).toMatch(/WEATHER CLEAR label is not a trip GO/i);
    expect(TRIP_CHAT_SYSTEM_PROMPT).toMatch(/does not account for projected avalanche danger/i);
    expect(TRIP_CHAT_SYSTEM_PROMPT).toMatch(/Compare the whole window/i);
    expect(TRIP_CHAT_SYSTEM_PROMPT).toMatch(/specific dates and supplied values/i);
    expect(TRIP_CHAT_SYSTEM_PROMPT).toMatch(/clearly unrelated/i);
  });

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

  test('passes multi-day context through to the trip-specific stream', async () => {
    const app = express();
    app.use(express.json());
    const createStream = jest.fn(async ({ messages, reportJson, contextType }) => ({
      messages,
      reportJson,
      contextType,
    }));
    const pipeStream = jest.fn(({ response, stream }) => response.status(200).json(stream));
    registerReportChatRoute({ app, createStream, pipeStream });

    const response = await request(app)
      .post('/api/report-chat')
      .send({
        contextType: 'trip',
        report: { days: [{ date: '2026-07-15', weatherWindowScore: 82 }] },
        messages: [{ id: 'question', role: 'user', parts: [{ type: 'text', text: 'Which day is best?' }] }],
      });

    expect(response.status).toBe(200);
    expect(response.body.contextType).toBe('trip');
    expect(response.body.reportJson).toContain('weatherWindowScore');
    expect(createStream).toHaveBeenCalledTimes(1);
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

  test('rejects new report chats when the AI kill switch is active', async () => {
    const app = express();
    app.use(express.json());
    const createStream = jest.fn();
    const disabledError = Object.assign(new Error('AI features are unavailable'), { code: 'AI_DISABLED' });
    registerReportChatRoute({
      app,
      createStream,
      ensureAIEnabled: () => { throw disabledError; },
    });

    const response = await request(app)
      .post('/api/report-chat')
      .send({
        report: { decision: { level: 'CAUTION' } },
        messages: [{ id: 'question', role: 'user', parts: [{ type: 'text', text: 'What changed?' }] }],
      });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/AI features are unavailable/i);
    expect(createStream).not.toHaveBeenCalled();
  });
});
