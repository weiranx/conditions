const express = require('express');
const request = require('supertest');

const { registerAiBriefRoute } = require('../src/routes/ai-brief');
const { registerSnowVisionRoute } = require('../src/routes/snow-vision');

const rejectDisabledFeature = () => {
  const error = new Error('AI features are unavailable');
  error.code = 'AI_FEATURE_DISABLED';
  throw error;
};

test('disabled AI brief is rejected before reading or generating cached output', async () => {
  const app = express();
  app.use(express.json());
  const askAI = jest.fn();
  registerAiBriefRoute({ app, askAI, ensureFeatureEnabled: rejectDisabledFeature });

  const response = await request(app)
    .post('/api/ai-brief')
    .send({ report: { safety: { score: 80 } }, decisionLevel: 'GO' });

  expect(response.status).toBe(503);
  expect(response.body.error).toBe('AI features are unavailable');
  expect(askAI).not.toHaveBeenCalled();
});

test('disabled snow vision is rejected before fetching imagery', async () => {
  const app = express();
  app.use(express.json());
  const fetchWithTimeout = jest.fn();
  const askAIVision = jest.fn();
  registerSnowVisionRoute({
    app,
    fetchWithTimeout,
    askAIVision,
    ensureFeatureEnabled: rejectDisabledFeature,
  });

  const response = await request(app)
    .post('/api/snow-vision')
    .send({ lat: 46.85, lon: -121.76 });

  expect(response.status).toBe(503);
  expect(response.body.error).toBe('AI features are unavailable');
  expect(fetchWithTimeout).not.toHaveBeenCalled();
  expect(askAIVision).not.toHaveBeenCalled();
});
