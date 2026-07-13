const express = require('express');
const request = require('supertest');

const { registerAiBriefRoute } = require('../src/routes/ai-brief');
const { registerReportChatRoute } = require('../src/routes/report-chat');
const { registerRouteAnalysisRoutes } = require('../src/routes/route-analysis');
const { registerSnowVisionRoute } = require('../src/routes/snow-vision');

const rejectAnonymousAccess = async (_req, res) => {
  res.status(401).json({
    error: 'Sign in or create an account to use AI features.',
    code: 'ACCOUNT_REQUIRED',
  });
  return false;
};

test('all user-facing AI endpoints reject anonymous requests before doing AI work', async () => {
  const app = express();
  app.use(express.json());

  const askAI = jest.fn();
  const askAIVision = jest.fn();
  const createStream = jest.fn();
  const fetchWithTimeout = jest.fn();
  const invokeSafetyHandler = jest.fn();
  const ensureAiBriefEnabled = jest.fn();
  const ensureReportChatEnabled = jest.fn();
  const ensureSnowVisionEnabled = jest.fn();

  registerAiBriefRoute({
    app,
    askAI,
    ensureAccountAccess: rejectAnonymousAccess,
    ensureFeatureEnabled: ensureAiBriefEnabled,
  });
  registerReportChatRoute({
    app,
    createStream,
    ensureAccountAccess: rejectAnonymousAccess,
    ensureAIEnabled: ensureReportChatEnabled,
  });
  registerRouteAnalysisRoutes({
    app,
    askAI,
    invokeSafetyHandler,
    fetchWithTimeout,
    fetchHeaders: {},
    ensureAccountAccess: rejectAnonymousAccess,
    ensureRouteAnalysisEnabled: jest.fn(),
    ensureAIEnabled: jest.fn(),
  });
  registerSnowVisionRoute({
    app,
    fetchWithTimeout,
    askAIVision,
    ensureAccountAccess: rejectAnonymousAccess,
    ensureFeatureEnabled: ensureSnowVisionEnabled,
  });

  const responses = await Promise.all([
    request(app).post('/api/ai-brief').send({ report: {}, decisionLevel: 'CAUTION' }),
    request(app).post('/api/report-chat').send({
      report: {},
      messages: [{ id: 'question', role: 'user', parts: [{ type: 'text', text: 'What changed?' }] }],
    }),
    request(app).get('/api/route-suggestions').query({ peak: 'Test Peak', lat: 46.85, lon: -121.76 }),
    request(app).post('/api/route-analysis').send({
      peak: 'Test Peak',
      route: 'Test Route',
      lat: 46.85,
      lon: -121.76,
      date: '2026-07-13',
    }),
    request(app).post('/api/snow-vision').send({ lat: 46.85, lon: -121.76 }),
  ]);

  responses.forEach((response) => {
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('ACCOUNT_REQUIRED');
  });
  expect(askAI).not.toHaveBeenCalled();
  expect(askAIVision).not.toHaveBeenCalled();
  expect(createStream).not.toHaveBeenCalled();
  expect(fetchWithTimeout).not.toHaveBeenCalled();
  expect(invokeSafetyHandler).not.toHaveBeenCalled();
  expect(ensureAiBriefEnabled).not.toHaveBeenCalled();
  expect(ensureReportChatEnabled).not.toHaveBeenCalled();
  expect(ensureSnowVisionEnabled).not.toHaveBeenCalled();
});
