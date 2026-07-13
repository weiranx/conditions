const express = require('express');
const request = require('supertest');

const {
  MAX_SAVED_REPORT_BYTES,
  normalizeSavedReport,
  registerSavedReportRoutes,
} = require('../src/routes/saved-reports');

const USER_ID = '8c696be4-e175-4b6a-965b-82bdf3758e0c';
const REPORT_ID = '510b78d9-dae0-42aa-bad3-6be54a49625c';
const CREATED_AT = new Date('2026-07-13T08:00:00.000Z');
const SNAPSHOT = {
  version: 2,
  savedAt: '2026-07-13T08:00:00.000Z',
  plan: {
    lat: 46.8523,
    lon: -121.7603,
    objectiveName: 'Mount Rainier',
    forecastDate: '2026-07-15',
    alpineStartTime: '05:30',
  },
  safetyData: {
    location: { lat: 46.8523, lon: -121.7603 },
    weather: { temp: 35 },
    safety: { score: 72 },
  },
  ai: {
    aiBriefNarrative: 'AI-generated field briefing',
    snowVisionAnalysis: 'Satellite analysis',
    snowVisionImage: 'data:image/png;base64,dGVzdA==',
    reportChatMessages: [{ id: 'question-1', role: 'user', parts: [{ type: 'text', text: 'What changed?' }] }],
  },
  route: {
    routeSuggestions: [],
    routeAnalysis: { analysis: 'AI route analysis', summaries: [], waypoints: [] },
    customRouteName: 'Disappointment Cleaver',
  },
};

const makeApp = ({ query = jest.fn(), user = { id: USER_ID } } = {}) => {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  registerSavedReportRoutes({
    app,
    database: { configured: true, query },
    accountService: {
      available: true,
      getUserForSession: jest.fn().mockResolvedValue(user),
    },
  });
  return app;
};

test('validates complete report snapshots and derives a safe title', () => {
  const normalized = normalizeSavedReport(SNAPSHOT);
  expect(normalized.title).toBe('Mount Rainier');
  expect(JSON.parse(normalized.serialized).ai.aiBriefNarrative).toBe('AI-generated field briefing');
  expect(() => normalizeSavedReport({ plan: {}, safetyData: null })).toThrow('missing report data');
  expect(() => normalizeSavedReport({
    ...SNAPSHOT,
    extra: 'x'.repeat(MAX_SAVED_REPORT_BYTES),
  })).toThrow('too large');
});

test('saves a new report with every AI section under the signed-in user', async () => {
  const query = jest.fn().mockResolvedValue({
    rows: [{ id: REPORT_ID, title: 'Mount Rainier', created_at: CREATED_AT, updated_at: CREATED_AT }],
  });
  const response = await request(makeApp({ query }))
    .post('/api/account/reports')
    .set('Cookie', 'bc_session=test-session')
    .send({ report: SNAPSHOT });

  expect(response.status).toBe(201);
  expect(response.body.report).toEqual({
    id: REPORT_ID,
    title: 'Mount Rainier',
    createdAt: CREATED_AT.toISOString(),
    updatedAt: CREATED_AT.toISOString(),
  });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toContain('INSERT INTO saved_reports');
  expect(params[0]).toBe(USER_ID);
  const stored = JSON.parse(params[2]);
  expect(stored.ai).toEqual(SNAPSHOT.ai);
  expect(stored.route.routeAnalysis.analysis).toBe('AI route analysis');
});

test('lists compact report history without returning full snapshots', async () => {
  const query = jest.fn().mockResolvedValue({
    rows: [{
      id: REPORT_ID,
      title: 'Mount Rainier',
      objective_name: 'Mount Rainier',
      forecast_date: '2026-07-15',
      alpine_start_time: '05:30',
      score: '72',
      has_ai: true,
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
    }],
  });
  const response = await request(makeApp({ query }))
    .get('/api/account/reports')
    .set('Cookie', 'bc_session=test-session');

  expect(response.status).toBe(200);
  expect(response.body.reports).toEqual([{
    id: REPORT_ID,
    title: 'Mount Rainier',
    objectiveName: 'Mount Rainier',
    forecastDate: '2026-07-15',
    alpineStartTime: '05:30',
    score: 72,
    hasAi: true,
    createdAt: CREATED_AT.toISOString(),
    updatedAt: CREATED_AT.toISOString(),
  }]);
  expect(query.mock.calls[0][0]).not.toContain('SELECT id, title, report,');
});

test('does not turn a missing score into zero in report history', async () => {
  const query = jest.fn().mockResolvedValue({
    rows: [{
      id: REPORT_ID,
      title: 'Mount Rainier',
      objective_name: 'Mount Rainier',
      forecast_date: '2026-07-15',
      alpine_start_time: '05:30',
      score: null,
      has_ai: false,
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
    }],
  });
  const response = await request(makeApp({ query }))
    .get('/api/account/reports')
    .set('Cookie', 'bc_session=test-session');

  expect(response.status).toBe(200);
  expect(response.body.reports[0].score).toBeNull();
});

test('retrieves and updates only reports owned by the signed-in user', async () => {
  const query = jest.fn()
    .mockResolvedValueOnce({
      rows: [{ id: REPORT_ID, title: 'Mount Rainier', report: SNAPSHOT, created_at: CREATED_AT, updated_at: CREATED_AT }],
    })
    .mockResolvedValueOnce({
      rows: [{ id: REPORT_ID, title: 'Mount Rainier', created_at: CREATED_AT, updated_at: CREATED_AT }],
    });
  const app = makeApp({ query });

  const detail = await request(app)
    .get(`/api/account/reports/${REPORT_ID}`)
    .set('Cookie', 'bc_session=test-session');
  expect(detail.status).toBe(200);
  expect(detail.body.report.snapshot.ai.aiBriefNarrative).toBe('AI-generated field briefing');
  expect(query.mock.calls[0][1]).toEqual([REPORT_ID, USER_ID]);

  const update = await request(app)
    .put(`/api/account/reports/${REPORT_ID}`)
    .set('Cookie', 'bc_session=test-session')
    .send({ report: { ...SNAPSHOT, ai: { ...SNAPSHOT.ai, aiBriefNarrative: 'Updated AI briefing' } } });
  expect(update.status).toBe(200);
  expect(query.mock.calls[1][1].slice(0, 2)).toEqual([REPORT_ID, USER_ID]);
  expect(JSON.parse(query.mock.calls[1][1][3]).ai.aiBriefNarrative).toBe('Updated AI briefing');
});

test('requires authentication and hides reports belonging to another user', async () => {
  const query = jest.fn();
  const anonymous = await request(makeApp({ query, user: null })).get('/api/account/reports');
  expect(anonymous.status).toBe(401);
  expect(query).not.toHaveBeenCalled();

  query.mockResolvedValueOnce({ rows: [] });
  const missing = await request(makeApp({ query }))
    .get(`/api/account/reports/${REPORT_ID}`)
    .set('Cookie', 'bc_session=test-session');
  expect(missing.status).toBe(404);
});
