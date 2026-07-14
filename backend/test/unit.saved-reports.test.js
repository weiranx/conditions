const express = require('express');
const request = require('supertest');

const {
  MAX_SAVED_REPORT_BYTES,
  SHARE_TOKEN_PATTERN,
  createShareToken,
  normalizeSavedReport,
  registerSavedReportRoutes,
} = require('../src/routes/saved-reports');

const USER_ID = '8c696be4-e175-4b6a-965b-82bdf3758e0c';
const REPORT_ID = '510b78d9-dae0-42aa-bad3-6be54a49625c';
const SHARE_TOKEN = 'aB3dE5fG7hJ9kL2mN4pQ6rSt';
const CREATED_AT = new Date('2026-07-13T08:00:00.000Z');
const REPORT_USAGE = {
  tierKey: 'free',
  unlimited: false,
  usedReports: 1,
  limitReports: 50,
  remainingReports: 49,
  percentUsed: 2,
  periodStart: '2026-07-01T00:00:00.000Z',
  periodEnd: '2026-08-01T00:00:00.000Z',
  resetAt: '2026-08-01T00:00:00.000Z',
  exhausted: false,
};
const SNAPSHOT = {
  version: 3,
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
    gpxRoute: {
      name: 'Disappointment Cleaver',
      fileName: 'dc.gpx',
      pointCount: 2,
      distanceMiles: 1.2,
      elevationGainFt: 800,
      minElevationFt: 5400,
      maxElevationFt: 6200,
      checkpoints: [
        { name: 'Route start', lat: 46.85, lon: -121.76, distance_miles: 0, progress_percent: 0 },
        { name: 'Route finish', lat: 46.86, lon: -121.75, distance_miles: 1.2, progress_percent: 100 },
      ],
      displayTrack: [
        { lat: 46.85, lon: -121.76, progress_percent: 0 },
        { lat: 46.86, lon: -121.75, progress_percent: 100 },
      ],
      routeShape: 'point-to-point',
    },
  },
};

const makeApp = ({
  query = jest.fn(),
  user = { id: USER_ID },
  reportUsageService,
  tierService,
  emailService,
  ensureReportHistoryEnabled,
  ensureReportSharingEnabled,
} = {}) => {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  const resolvedReportUsageService = reportUsageService || {
    available: true,
    consumeReportSlot: jest.fn(async (_userId, _tierKey, createReport) => ({
      result: await createReport(query),
      reportUsage: REPORT_USAGE,
    })),
  };
  const resolvedEmailService = emailService || {
    available: true,
    sendReportEmail: jest.fn().mockResolvedValue({ id: 'email-123' }),
  };
  registerSavedReportRoutes({
    app,
    database: { configured: true, query },
    accountService: {
      available: true,
      getUserForSession: jest.fn().mockResolvedValue(user),
    },
    reportUsageService: resolvedReportUsageService,
    emailService: resolvedEmailService,
    tierService,
    ...(ensureReportHistoryEnabled ? { ensureReportHistoryEnabled } : {}),
    ...(ensureReportSharingEnabled ? { ensureReportSharingEnabled } : {}),
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

test('creates cryptographically random URL-safe share tokens', () => {
  const first = createShareToken();
  const second = createShareToken();
  expect(first).toMatch(SHARE_TOKEN_PATTERN);
  expect(second).toMatch(SHARE_TOKEN_PATTERN);
  expect(second).not.toBe(first);
});

test('emails a validated report only to the verified signed-in account address', async () => {
  const sendReportEmail = jest.fn().mockResolvedValue({ id: 'email-123' });
  const user = {
    id: USER_ID,
    email: 'climber@example.com',
    displayName: 'Avery',
    emailVerified: true,
  };
  const response = await request(makeApp({
    user,
    emailService: { available: true, sendReportEmail },
  }))
    .post('/api/account/reports/email')
    .set('Cookie', 'bc_session=test-session')
    .send({ report: SNAPSHOT });

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ message: 'Report sent to climber@example.com.' });
  expect(sendReportEmail).toHaveBeenCalledWith(expect.objectContaining({
    report: SNAPSHOT,
    to: 'climber@example.com',
    displayName: 'Avery',
    deliveryKey: expect.stringMatching(new RegExp(`^${USER_ID}/[a-f0-9]{24}/\\d+$`, 'u')),
  }));
});

test('requires a verified account email before sending a report', async () => {
  const sendReportEmail = jest.fn();
  const response = await request(makeApp({
    user: {
      id: USER_ID,
      email: 'unverified@example.com',
      displayName: 'Avery',
      emailVerified: false,
    },
    emailService: { available: true, sendReportEmail },
  }))
    .post('/api/account/reports/email')
    .set('Cookie', 'bc_session=test-session')
    .send({ report: SNAPSHOT });

  expect(response.status).toBe(403);
  expect(response.body.code).toBe('EMAIL_NOT_VERIFIED');
  expect(sendReportEmail).not.toHaveBeenCalled();
});

test('disabled report history keeps previously generated reports available', async () => {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  const response = await request(makeApp({
    query,
    ensureReportHistoryEnabled: () => {
      const error = new Error('This feature is unavailable');
      error.code = 'FEATURE_DISABLED';
      error.statusCode = 503;
      throw error;
    },
  })).get('/api/account/reports');

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ reports: [] });
  expect(query).toHaveBeenCalledTimes(1);
});

test('disabled report history blocks saving new report snapshots', async () => {
  const query = jest.fn();
  const response = await request(makeApp({
    query,
    ensureReportHistoryEnabled: () => {
      const error = new Error('This feature is unavailable');
      error.code = 'FEATURE_DISABLED';
      error.statusCode = 503;
      throw error;
    },
  }))
    .post('/api/account/reports')
    .set('Cookie', 'bc_session=test-session')
    .send({ report: SNAPSHOT });

  expect(response.status).toBe(503);
  expect(response.body).toEqual({ error: 'This feature is unavailable', code: 'FEATURE_DISABLED' });
  expect(query).not.toHaveBeenCalled();
});

test('disabled report sharing keeps previously shared snapshots available', async () => {
  const query = jest.fn().mockResolvedValue({
    rows: [{ title: 'Mount Rainier', report: SNAPSHOT, created_at: CREATED_AT, updated_at: CREATED_AT }],
  });
  const response = await request(makeApp({
    query,
    ensureReportSharingEnabled: () => {
      const error = new Error('This feature is unavailable');
      error.code = 'FEATURE_DISABLED';
      error.statusCode = 503;
      throw error;
    },
  })).get(`/api/reports/shared/${SHARE_TOKEN}`);

  expect(response.status).toBe(200);
  expect(response.body.report.snapshot.plan.objectiveName).toBe('Mount Rainier');
  expect(query).toHaveBeenCalledTimes(1);
});

test('saves a new report with every AI section under the signed-in user', async () => {
  const query = jest.fn()
    .mockResolvedValueOnce({
      rows: [{ id: REPORT_ID, share_token: SHARE_TOKEN, title: 'Mount Rainier', created_at: CREATED_AT, updated_at: CREATED_AT }],
    })
    .mockResolvedValueOnce({ rows: [{ report_count: '12' }] });
  const response = await request(makeApp({ query }))
    .post('/api/account/reports')
    .set('Cookie', 'bc_session=test-session')
    .send({ report: SNAPSHOT });

  expect(response.status).toBe(201);
  expect(response.body.report).toEqual({
    id: REPORT_ID,
    shareToken: SHARE_TOKEN,
    title: 'Mount Rainier',
    createdAt: CREATED_AT.toISOString(),
    updatedAt: CREATED_AT.toISOString(),
  });
  expect(response.body.reportCount).toBe(12);
  expect(response.body.reportUsage).toEqual(REPORT_USAGE);
  const [sql, params] = query.mock.calls[0];
  expect(sql).toContain('INSERT INTO saved_reports');
  expect(params[0]).toBe(USER_ID);
  expect(params[1]).toMatch(SHARE_TOKEN_PATTERN);
  expect(params[2]).toBe('Mount Rainier');
  const stored = JSON.parse(params[3]);
  expect(stored.ai).toEqual(SNAPSHOT.ai);
  expect(stored.route).toEqual(SNAPSHOT.route);
  expect(query.mock.calls[1][0]).toContain('COUNT(*)::bigint AS report_count');
  expect(query.mock.calls[1][1]).toEqual([USER_ID]);
});

test('enforces the Free monthly report limit before inserting history', async () => {
  const query = jest.fn();
  const limitError = Object.assign(new Error('Monthly report limit reached.'), {
    code: 'REPORT_USAGE_LIMIT_REACHED',
    usage: { ...REPORT_USAGE, usedReports: 50, remainingReports: 0, percentUsed: 100, exhausted: true },
  });
  const consumeReportSlot = jest.fn().mockRejectedValue(limitError);
  const response = await request(makeApp({
    query,
    reportUsageService: { available: true, consumeReportSlot },
  }))
    .post('/api/account/reports')
    .set('Cookie', 'bc_session=test-session')
    .send({ report: SNAPSHOT });

  expect(response.status).toBe(429);
  expect(response.body).toEqual({
    error: 'Monthly report limit reached.',
    code: 'REPORT_USAGE_LIMIT_REACHED',
    reportUsage: limitError.usage,
  });
  expect(query).not.toHaveBeenCalled();
});

test('keeps Premium report creation unlimited', async () => {
  const query = jest.fn()
    .mockResolvedValueOnce({
      rows: [{ id: REPORT_ID, share_token: SHARE_TOKEN, title: 'Mount Rainier', created_at: CREATED_AT, updated_at: CREATED_AT }],
    })
    .mockResolvedValueOnce({ rows: [{ report_count: '21' }] });
  const consumeReportSlot = jest.fn(async (_userId, _tierKey, createReport) => ({
    result: await createReport(query),
    reportUsage: { ...REPORT_USAGE, tierKey: 'premium', unlimited: true, limitReports: null, remainingReports: null },
  }));
  const response = await request(makeApp({
    query,
    reportUsageService: { available: true, consumeReportSlot },
    tierService: { getAccountTier: jest.fn().mockResolvedValue({ key: 'premium' }) },
  }))
    .post('/api/account/reports')
    .set('Cookie', 'bc_session=test-session')
    .send({ report: SNAPSHOT });

  expect(response.status).toBe(201);
  expect(consumeReportSlot).toHaveBeenCalledWith(USER_ID, 'premium', expect.any(Function));
});

test('lists compact report history without returning full snapshots', async () => {
  const query = jest.fn().mockResolvedValue({
    rows: [{
      id: REPORT_ID,
      share_token: SHARE_TOKEN,
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
    shareToken: SHARE_TOKEN,
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
      share_token: SHARE_TOKEN,
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

test('loads the previous report only for the same objective plan', async () => {
  const query = jest.fn().mockResolvedValue({
    rows: [{ id: REPORT_ID, report: SNAPSHOT, created_at: CREATED_AT, updated_at: CREATED_AT }],
  });
  const response = await request(makeApp({ query }))
    .get(`/api/account/reports/comparison-baseline?lat=46.8523&lon=-121.7603&forecastDate=2026-07-15&alpineStartTime=05%3A30&excludeReportId=${REPORT_ID}`)
    .set('Cookie', 'bc_session=test-session');

  expect(response.status).toBe(200);
  expect(response.body.baseline.reportId).toBe(REPORT_ID);
  expect(response.body.baseline.snapshot.plan.objectiveName).toBe('Mount Rainier');
  const [sql, params] = query.mock.calls[0];
  expect(sql).toContain("report #>> '{plan,forecastDate}' = $4");
  expect(sql).toContain('id <> $6::uuid');
  expect(params).toEqual([USER_ID, 46.8523, -121.7603, '2026-07-15', '05:30', REPORT_ID]);
});

test('retrieves and updates only reports owned by the signed-in user', async () => {
  const query = jest.fn()
    .mockResolvedValueOnce({
      rows: [{ id: REPORT_ID, share_token: SHARE_TOKEN, title: 'Mount Rainier', report: SNAPSHOT, created_at: CREATED_AT, updated_at: CREATED_AT }],
    })
    .mockResolvedValueOnce({
      rows: [{ id: REPORT_ID, share_token: SHARE_TOKEN, title: 'Mount Rainier', created_at: CREATED_AT, updated_at: CREATED_AT }],
    });
  const app = makeApp({ query });

  const detail = await request(app)
    .get(`/api/account/reports/${REPORT_ID}`)
    .set('Cookie', 'bc_session=test-session');
  expect(detail.status).toBe(200);
  expect(detail.body.report.shareToken).toBe(SHARE_TOKEN);
  expect(detail.body.report.snapshot.ai.aiBriefNarrative).toBe('AI-generated field briefing');
  expect(query.mock.calls[0][1]).toEqual([REPORT_ID, USER_ID]);

  const updatedRoute = {
    ...SNAPSHOT.route,
    routeAnalysis: { analysis: 'Updated route analysis', summaries: [], waypoints: [] },
  };
  const update = await request(app)
    .put(`/api/account/reports/${REPORT_ID}`)
    .set('Cookie', 'bc_session=test-session')
    .send({
      report: {
        ...SNAPSHOT,
        ai: { ...SNAPSHOT.ai, aiBriefNarrative: 'Updated AI briefing' },
        route: updatedRoute,
      },
    });
  expect(update.status).toBe(200);
  expect(query.mock.calls[1][1].slice(0, 2)).toEqual([REPORT_ID, USER_ID]);
  expect(JSON.parse(query.mock.calls[1][1][2]).ai.aiBriefNarrative).toBe('Updated AI briefing');
  expect(JSON.parse(query.mock.calls[1][1][2]).route).toEqual(updatedRoute);
  expect(query.mock.calls[1][0]).toContain("jsonb_set(report, '{ai}'");
  expect(query.mock.calls[1][0]).not.toContain('SET title');
});

test('serves a shared snapshot without requiring an account session', async () => {
  const query = jest.fn().mockResolvedValue({
    rows: [{ title: 'Mount Rainier', report: SNAPSHOT, created_at: CREATED_AT, updated_at: CREATED_AT }],
  });
  const response = await request(makeApp({ query, user: null }))
    .get(`/api/reports/shared/${SHARE_TOKEN}`);

  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body.report.snapshot.ai.aiBriefNarrative).toBe('AI-generated field briefing');
  expect(response.body.report.snapshot.ai.reportChatMessages).toHaveLength(1);
  expect(query.mock.calls[0][1]).toEqual([SHARE_TOKEN]);
});

test('rejects malformed shared report tokens without querying the database', async () => {
  const query = jest.fn();
  const response = await request(makeApp({ query, user: null }))
    .get('/api/reports/shared/not-a-valid-token');

  expect(response.status).toBe(404);
  expect(query).not.toHaveBeenCalled();
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
