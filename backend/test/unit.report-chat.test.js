const express = require('express');
const request = require('supertest');
const {
  MAX_MESSAGE_LENGTH,
  MAX_MESSAGES,
  MAX_REPORT_LENGTH,
  normalizeReport,
  registerReportChatRoute,
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

  test('streams a valid report-aware request after validation', async () => {
    const app = express();
    app.use(express.json());
    const createStream = jest.fn(async ({ messages, reportJson }) => ({
      pipeUIMessageStreamToResponse(res) {
        return res.status(200).json({ ok: true, message: messages[0].parts[0].text, reportJson });
      },
    }));
    registerReportChatRoute({ app, createStream });

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
