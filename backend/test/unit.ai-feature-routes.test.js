const express = require('express');
const request = require('supertest');

const {
  AI_BRIEF_MAX_TOKENS,
  SYSTEM_PROMPT: AI_BRIEF_SYSTEM_PROMPT,
  registerAiBriefRoute,
} = require('../src/routes/ai-brief');
const {
  SNOW_VISION_MAX_TOKENS,
  SYSTEM_PROMPT: SNOW_VISION_SYSTEM_PROMPT,
  registerSnowVisionRoute,
} = require('../src/routes/snow-vision');

const rejectDisabledFeature = () => {
  const error = new Error('AI features are unavailable');
  error.code = 'AI_FEATURE_DISABLED';
  throw error;
};

test('AI brief requests a detailed decision-ready analysis', () => {
  expect(AI_BRIEF_MAX_TOKENS).toBeGreaterThanOrEqual(8192);
  expect(AI_BRIEF_SYSTEM_PROMPT).toMatch(/WHY IT MATTERS:/);
  expect(AI_BRIEF_SYSTEM_PROMPT).toMatch(/DATA CONFIDENCE:/);
  expect(AI_BRIEF_SYSTEM_PROMPT).toMatch(/actual values, times, elevations, aspects/i);
  expect(AI_BRIEF_SYSTEM_PROMPT).toMatch(/10-15 substantive sentences/i);
});

test('snow vision requests evidence, uncertainty, and practical route implications', () => {
  expect(SNOW_VISION_MAX_TOKENS).toBeGreaterThanOrEqual(8192);
  expect(SNOW_VISION_SYSTEM_PROMPT).toMatch(/TERRAIN PATTERN:/);
  expect(SNOW_VISION_SYSTEM_PROMPT).toMatch(/UNCERTAINTY:/);
  expect(SNOW_VISION_SYSTEM_PROMPT).toMatch(/specific planning implications/i);
  expect(SNOW_VISION_SYSTEM_PROMPT).toMatch(/9-13 substantive sentences/i);
});

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
