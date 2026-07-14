const express = require('express');
const request = require('supertest');

const {
  AI_BRIEF_MAX_TOKENS,
  SYSTEM_PROMPT: AI_BRIEF_SYSTEM_PROMPT,
  registerAiBriefRoute: registerAiBriefRouteWithoutAccount,
} = require('../src/routes/ai-brief');
const {
  SNOW_VISION_MAX_TOKENS,
  SYSTEM_PROMPT: SNOW_VISION_SYSTEM_PROMPT,
  registerSnowVisionRoute: registerSnowVisionRouteWithoutAccount,
} = require('../src/routes/snow-vision');
const { getScoreFeatureSnapshot } = require('../src/utils/report-feature-filter');

const allowAccountAccess = async (req) => {
  req.accountUser = { id: '8c696be4-e175-4b6a-965b-82bdf3758e0c' };
  return true;
};
const registerAiBriefRoute = (options) => registerAiBriefRouteWithoutAccount({
  ...options,
  ensureAccountAccess: options.ensureAccountAccess || allowAccountAccess,
});
const registerSnowVisionRoute = (options) => registerSnowVisionRouteWithoutAccount({
  ...options,
  ensureAccountAccess: options.ensureAccountAccess || allowAccountAccess,
});

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

test('AI brief excludes a disabled avalanche domain from the model prompt', async () => {
  const app = express();
  app.use(express.json());
  const flags = { avalancheDetails: false };
  const askAI = jest.fn().mockResolvedValue('BIG PICTURE: Avalanche danger is Considerable. Weather is the enabled concern.');
  registerAiBriefRoute({ app, askAI });

  const response = await request(app)
    .post('/api/ai-brief')
    .send({
      decisionLevel: 'CAUTION',
      report: {
        featureFlags: getScoreFeatureSnapshot(flags),
        weather: { description: 'Cloudy and windy', windGust: 42 },
        avalanche: { risk: 'Considerable', problems: [{ name: 'Deep Persistent Slab' }] },
        gear: [{ id: 'avalanche-kit', title: 'Avalanche rescue kit' }],
        safety: {
          factors: [
            { group: 'avalanche', hazard: 'Avalanche', impact: -25 },
            { group: 'weather', hazard: 'Wind', impact: -5 },
          ],
          explanations: ['Avalanche danger is Considerable.', 'Strong wind is expected.'],
        },
      },
    });

  expect(response.status).toBe(200);
  expect(response.body.narrative).toBe('BIG PICTURE: Weather is the enabled concern.');
  expect(response.body.narrative).not.toMatch(/avalanche/i);
  expect(askAI).toHaveBeenCalledTimes(1);
  const prompt = askAI.mock.calls[0][0];
  expect(prompt).toMatch(/Disabled product domains: avalanche/i);
  expect(prompt).toContain('Cloudy and windy');
  expect(prompt).not.toMatch(/Considerable|Deep Persistent Slab|Avalanche rescue kit/);
});

test('AI brief preserves the feature snapshot of a previously generated report', async () => {
  const app = express();
  app.use(express.json());
  const askAI = jest.fn().mockResolvedValue('BIG PICTURE: Avalanche conditions remain part of this saved report.');
  registerAiBriefRoute({ app, askAI });

  const response = await request(app)
    .post('/api/ai-brief')
    .send({
      report: {
        featureFlags: { avalancheDetails: true },
        avalanche: { risk: 'Moderate' },
        safety: { score: 80 },
      },
      decisionLevel: 'GO',
    });

  expect(response.status).toBe(200);
  expect(response.body.narrative).toMatch(/Avalanche conditions/i);
  expect(askAI).toHaveBeenCalledTimes(1);
  expect(askAI.mock.calls[0][0]).toMatch(/Moderate/);
});
