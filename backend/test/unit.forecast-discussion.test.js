const express = require('express');
const request = require('supertest');

const { registerForecastDiscussionRoute } = require('../src/routes/forecast-discussion');
const {
  MAX_SECTION_CHARS,
  SYSTEM_PROMPT,
  buildDiscussionContext,
  validateDiscussionSummary,
} = require('../src/utils/discussion-summary');

const USER_ID = '8c696be4-e175-4b6a-965b-82bdf3758e0c';
const allowAccountAccess = async (req) => {
  req.accountUser = { id: USER_ID };
  return true;
};

const buildApp = (options = {}) => {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  registerForecastDiscussionRoute({
    app,
    askAI: options.askAI || jest.fn(),
    ensureAccountAccess: options.ensureAccountAccess || allowAccountAccess,
    ensureFeatureEnabled: options.ensureFeatureEnabled || (() => {}),
  });
  return app;
};

const discussion = (overrides = {}) => ({
  source: 'NWS Area Forecast Discussion',
  kind: 'regional_context',
  available: true,
  status: 'ok',
  office: 'REV',
  issuedTime: '2026-10-14T21:01:00Z',
  tripDayOffset: 2,
  text: 'FULL PRODUCT TEXT',
  sections: [
    { title: 'KEY MESSAGES', kind: 'key_messages', matchesTrip: null, text: '* Gusty winds Thursday with ridge gusts 60-70 mph.\n* Snow levels fall to 7000 feet Friday.' },
    { title: 'SHORT TERM', period: 'Tonight through Thursday', kind: 'period', matchesTrip: false, text: 'A trough approaches the Sierra Thursday.' },
    { title: 'LONG TERM', period: 'Friday through Tuesday', kind: 'period', matchesTrip: true, text: 'Cooler Friday with snow showers above 7000 feet along the Sierra crest. Confidence is moderate.' },
    { title: 'AVIATION', kind: 'not_relevant', matchesTrip: null, text: 'VFR conditions.' },
  ],
  ...overrides,
});

const report = (overrides = {}) => ({
  location: { lat: 37.7462, lon: -119.5332 },
  forecast: { selectedDate: '2026-10-16', selectedStartTime: '2026-10-16T06:00:00-07:00', activity: 'hiking' },
  weather: {
    description: 'Snow showers', temp: 28, windSpeed: 25, windGust: 45, precipChance: 60, elevation: 8839,
    trend: [{ time: '6 AM', temp: 28, wind: 25, gust: 45, precipChance: 60, condition: 'Snow showers', pressure: 1010 }],
  },
  alerts: { alerts: [{ event: 'Winter Weather Advisory', severity: 'Moderate', headline: 'Advisory above 7000 feet', description: 'long text' }] },
  supplementalEvidence: { discussion: discussion() },
  ...overrides,
});

const answer = (overrides = {}) => JSON.stringify({
  summary: 'A trough brings gusty wind Thursday, then cooler air with snow showers Friday.',
  forObjective: 'Your Friday trip falls in the cooler period: the discussion expects snow showers above 7000 ft along the Sierra crest, which matches the snow showers in your point forecast near 8839 ft.',
  watch: ['Ridge gusts of 60-70 mph Thursday if the trough slows down.', 'Snow levels near 7000 ft.'],
  forecasterConfidence: 'Moderate',
  ...overrides,
});

describe('buildDiscussionContext', () => {
  test('keeps the relevant sections, the plan and the point forecast', () => {
    const context = buildDiscussionContext(report(), { objectiveName: 'Half Dome' });

    expect(context.objective).toEqual({ name: 'Half Dome', lat: 37.746, lon: -119.533, elevationFt: 8839 });
    expect(context.trip).toMatchObject({ date: '2026-10-16', activity: 'hiking', daysAfterDiscussionIssued: 2 });
    expect(context.discussion.coversTripDate).toBe(true);
    expect(context.discussion.sections.map((section) => section.title)).toEqual(['KEY MESSAGES', 'SHORT TERM', 'LONG TERM']);
    // The parsed sections replace the raw product text.
    expect(context.discussion.text).toBeUndefined();
    expect(context.pointForecast.hourly[0]).not.toHaveProperty('pressure');
    expect(context.activeAlerts[0]).toEqual({ event: 'Winter Weather Advisory', severity: 'Moderate', headline: 'Advisory above 7000 feet' });
  });

  test('is null without an available discussion', () => {
    expect(buildDiscussionContext(report({ supplementalEvidence: null }))).toBeNull();
    expect(buildDiscussionContext(report({ supplementalEvidence: { discussion: { available: false, status: 'no_data' } } }))).toBeNull();
  });

  test('falls back to the raw text when no section could be read', () => {
    const context = buildDiscussionContext(report({ supplementalEvidence: { discussion: discussion({ sections: [] }) } }));
    expect(context.discussion).toMatchObject({ text: 'FULL PRODUCT TEXT', coversTripDate: null });
  });

  test('reads the raw text when the sections hold far less than the product', () => {
    const text = `.DISCUSSION, Issued 1017 PM MDT Wed Oct 14 2026...\n${'The low moves east. '.repeat(40)}`;
    const sections = [{ title: 'WATCHES/WARNINGS/ADVISORIES', kind: 'warnings', matchesTrip: null, text: 'None.' }];
    const context = buildDiscussionContext(report({ supplementalEvidence: { discussion: discussion({ text, sections }) } }));
    expect(context.discussion.sections).toBeUndefined();
    expect(context.discussion.text).toContain('The low moves east.');
  });

  test('says the trip is not covered when every dated period misses it', () => {
    const sections = discussion().sections.map((section) => (section.matchesTrip === true ? { ...section, matchesTrip: false } : section));
    const context = buildDiscussionContext(report({ supplementalEvidence: { discussion: discussion({ sections }) } }));
    expect(context.discussion.coversTripDate).toBe(false);
  });

  test('cuts other periods before key messages and the trip period when it is too long', () => {
    const long = 'x'.repeat(MAX_SECTION_CHARS - 1000);
    const sections = [
      { title: 'KEY MESSAGES', kind: 'key_messages', matchesTrip: null, text: 'short' },
      { title: 'SHORT TERM', kind: 'period', matchesTrip: false, text: long },
      { title: 'LONG TERM', kind: 'period', matchesTrip: true, text: long },
    ];
    const context = buildDiscussionContext(report({ supplementalEvidence: { discussion: discussion({ sections }) } }));
    expect(context.discussion.sections.map((section) => section.title)).toEqual(['KEY MESSAGES', 'LONG TERM']);
  });
});

describe('validateDiscussionSummary', () => {
  const context = buildDiscussionContext(report(), { objectiveName: 'Half Dome' });

  test('accepts numbers from the discussion and the point forecast', () => {
    const problems = [];
    const result = validateDiscussionSummary(JSON.parse(answer()), context, {}, problems);
    expect(problems).toEqual([]);
    expect(result).toMatchObject({ forecasterConfidence: 'moderate', watch: expect.arrayContaining(['Snow levels near 7000 ft.']) });
  });

  test('accepts converted numbers for a metric reader, including bare range ends', () => {
    const units = { temperature: 'c', wind: 'kph', elevation: 'm' };
    const parsed = JSON.parse(answer({
      forObjective: 'Snow showers above about 2134 m along the crest reach your objective at 2694 m.',
      watch: ['Ridge gusts of 97-113 km/h Thursday.'],
    }));
    const problems = [];
    expect(validateDiscussionSummary(parsed, context, units, problems)).not.toBeNull();
    expect(problems).toEqual([]);
  });

  test('refuses invented numbers and go/no-go calls, dropping a bad watch item alone', () => {
    const problems = [];
    const bad = validateDiscussionSummary(JSON.parse(answer({ summary: 'Expect 14 inches of new snow.' })), context, {}, problems);
    expect(bad).toBeNull();
    expect(problems[0]).toMatch(/summary: states 14/);

    const kept = [];
    const result = validateDiscussionSummary(JSON.parse(answer({ watch: ['It is a GO if wind drops.', 'Snow levels near 7000 ft.'] })), context, {}, kept);
    expect(result.watch).toEqual(['Snow levels near 7000 ft.']);
    expect(kept).toEqual([expect.stringMatching(/watch item: makes a go\/no-go call/)]);

    expect(validateDiscussionSummary(JSON.parse(answer({ forObjective: 'The crest is safe to travel.' })), context, {}, [])).toBeNull();
  });
});

describe('POST /api/forecast-discussion/summary', () => {
  test('summarizes the discussion for the plan', async () => {
    const askAI = jest.fn().mockResolvedValue(answer());
    const response = await request(buildApp({ askAI }))
      .post('/api/forecast-discussion/summary')
      .send({ report: report(), objectiveName: 'Half Dome A', units: { temperature: 'f', wind: 'mph', elevation: 'ft' } });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      summary: expect.stringContaining('trough'),
      forecasterConfidence: 'moderate',
      coversTripDate: true,
      office: 'REV',
      issuedTime: '2026-10-14T21:01:00Z',
    });
    expect(askAI).toHaveBeenCalledTimes(1);
    const [prompt, options] = askAI.mock.calls[0];
    expect(prompt).toContain('Half Dome A');
    expect(prompt).toContain('snow showers above 7000 feet');
    expect(prompt).not.toContain('VFR conditions');
    expect(options).toMatchObject({ system: SYSTEM_PROMPT, feature: 'forecast-discussion', tier: 'fast', userId: USER_ID });
  });

  test('retries once with the failed checks, then answers 503 without caching the failure', async () => {
    const askAI = jest.fn()
      .mockResolvedValueOnce(answer({ summary: 'Expect 14 inches.' }))
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce(answer());
    const app = buildApp({ askAI });
    const body = { report: report(), objectiveName: 'Half Dome B' };

    const failed = await request(app).post('/api/forecast-discussion/summary').send(body);
    expect(failed.status).toBe(503);
    expect(askAI).toHaveBeenCalledTimes(2);
    expect(askAI.mock.calls[1][0]).toContain('summary: states 14');

    const next = await request(app).post('/api/forecast-discussion/summary').send(body);
    expect(next.status).toBe(200);
    expect(askAI).toHaveBeenCalledTimes(3);
  });

  test('serves a repeated request from the cache', async () => {
    const askAI = jest.fn().mockResolvedValue(answer());
    const app = buildApp({ askAI });
    const body = { report: report(), objectiveName: 'Half Dome C' };
    await request(app).post('/api/forecast-discussion/summary').send(body);
    const again = await request(app).post('/api/forecast-discussion/summary').send(body);
    expect(again.status).toBe(200);
    expect(askAI).toHaveBeenCalledTimes(1);
  });

  test('refuses a request without a report or discussion, and when AI is off', async () => {
    const askAI = jest.fn();
    const app = buildApp({ askAI });
    expect((await request(app).post('/api/forecast-discussion/summary').send({})).status).toBe(400);
    expect((await request(app).post('/api/forecast-discussion/summary').send({ report: report({ supplementalEvidence: null }) })).status).toBe(422);

    const off = buildApp({ askAI, ensureFeatureEnabled: () => { throw new Error('AI features are unavailable'); } });
    const response = await request(off).post('/api/forecast-discussion/summary').send({ report: report(), objectiveName: 'Half Dome D' });
    expect(response.status).toBe(503);
    expect(askAI).not.toHaveBeenCalled();
  });

  test('asks for an account before calling the AI', async () => {
    const askAI = jest.fn();
    const deny = async (req, res) => { res.status(401).json({ error: 'Sign in' }); return false; };
    const response = await request(buildApp({ askAI, ensureAccountAccess: deny }))
      .post('/api/forecast-discussion/summary')
      .send({ report: report(), objectiveName: 'Half Dome E' });
    expect(response.status).toBe(401);
    expect(askAI).not.toHaveBeenCalled();
  });
});
