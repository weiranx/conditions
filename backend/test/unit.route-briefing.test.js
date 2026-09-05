jest.mock('../src/utils/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
const { buildDeterministicRouteBriefing, registerRouteAnalysisRoutes } = require('../src/routes/route-analysis');
const { MAX_WAYPOINT_REPORTS_LENGTH, serializeWaypointReports } = require('../src/utils/route-briefing');
const checkpoint = (overrides = {}) => ({ name: 'Ridge', etaTime: '12:00', dataAvailable: true, score: 75, weather: { windGust: 20, precipChance: 0 }, ...overrides });

test('fallback distinguishes missing scores and weather from measured zero', () => {
  const text = buildDeterministicRouteBriefing([checkpoint({ score: null, weather: {} })]);
  expect(text).toContain('No checkpoint score is available');
  expect(text).toContain('Gust forecasts are unavailable');
  expect(text).toContain('Precipitation probabilities are unavailable');
  expect(text).toContain('insufficient evidence for a route decision');
  expect(text).not.toMatch(/score of 0|0 mph|0%/);
  const zero = buildDeterministicRouteBriefing([checkpoint({ score: 0, weather: { windGust: 0, precipChance: 0 } })]);
  for (const phrase of ['score of 0', '0 mph', '0%', 'should not be treated as a go']) expect(zero).toContain(phrase);
});

test('fallback excludes unavailable checkpoints and uses requested wind units', () => {
  const text = buildDeterministicRouteBriefing([
    checkpoint({ name: 'Missing', dataAvailable: false, score: 0, weather: { windGust: 100 } }),
    checkpoint(), checkpoint({ name: 'Summit', score: null, weather: {} }),
  ], ['Missing'], { wind: 'kph' });
  for (const phrase of ['Ridge has the least modeled margin', '32 km/h', 'Data is missing at Missing', 'Weather coverage is incomplete']) expect(text).toContain(phrase);
  expect(text).not.toContain('mph');
});

test('fallback retains extreme tier, alerts, primary hazards and avalanche evidence', () => {
  const text = buildDeterministicRouteBriefing([checkpoint({ score: 45, tier: 'Extreme', primaryHazard: 'Wind', activeAlerts: 2, avalanche: { risk: 'Considerable' }, partialData: true })]);
  for (const phrase of ['45 (Extreme)', 'Ridge: Wind', 'Considerable avalanche danger', 'Active alerts at Ridge', 'source data is incomplete at Ridge', 'should not be treated as a go']) expect(text).toContain(phrase);
});

test('small reports are preserved verbatim', () => {
  const reports = [{ name: 'Start', report: { safety: { score: 80 }, extra: ['evidence'] } }];
  expect(serializeWaypointReports(reports)).toBe(JSON.stringify(reports));
  expect(serializeWaypointReports([])).toBe('[]');
});

test('oversized reports retain every checkpoint, core evidence and valid bounded JSON', () => {
  const reports = Array.from({ length: 8 }, (_, index) => ({
    name: `Checkpoint ${index}`, elev_ft: 10000, etaTime: '12:00', dataAvailable: true,
    report: {
      weather: { temp: 30, windGust: 60, description: 'Snow', trend: 'x'.repeat(30000) },
      safety: { score: index === 7 ? 10 : 75, tier: index === 7 ? 'Extreme' : 'Caution', primaryHazard: 'Wind', factors: ['x'.repeat(30000)] },
      avalanche: { relevant: true, dangerLevel: 3, risk: 'Considerable', discussion: 'x'.repeat(30000) },
      alerts: { status: 'ok', alerts: [{ event: 'Winter Storm Warning', description: 'x'.repeat(30000) }] },
    },
  }));
  const original = JSON.stringify(reports);
  const json = serializeWaypointReports(reports);
  expect(json.length).toBeLessThanOrEqual(MAX_WAYPOINT_REPORTS_LENGTH);
  const parsed = JSON.parse(json);
  expect(parsed.map((entry) => entry.name)).toEqual(reports.map((entry) => entry.name));
  expect(parsed[7].report.safety).toMatchObject({ score: 10, tier: 'Extreme', primaryHazard: 'Wind' });
  for (const entry of parsed) {
    expect(entry.report.weather.windGust).toBe(60);
    expect(entry.report.avalanche.risk).toBe('Considerable');
    expect(entry.report.alerts.events).toContain('Winter Storm Warning');
    expect(entry.reportCondensed).toBe(true);
    expect(entry.omittedReportFields).toEqual(expect.arrayContaining(['weather', 'safety', 'avalanche', 'alerts']));
  }
  expect(JSON.stringify(reports)).toBe(original);
});

test('oversized first report cannot remove a later failed checkpoint', () => {
  const parsed = JSON.parse(serializeWaypointReports([
    { name: 'Start', dataAvailable: true, report: { weather: { description: 'x'.repeat(40000) } } },
    { name: 'Summit', dataAvailable: false, report: null },
  ]));
  expect(parsed[1]).toEqual({ name: 'Summit', dataAvailable: false, report: null });
});

const successfulReport = () => ({ statusCode: 200, payload: { weather: { temp: 40, windGust: 20, precipChance: 10 }, safety: { score: 80 } } });
const routeHarness = (options = {}) => {
  let handler;
  const askAI = jest.fn().mockResolvedValue('AI route briefing');
  registerRouteAnalysisRoutes({
    app: { get: jest.fn(), post: (path, fn) => { handler = fn; } }, askAI,
    invokeSafetyHandler: async () => successfulReport(), fetchWithTimeout: jest.fn(), fetchHeaders: {},
    ensureAccountAccess: async (req) => { req.accountUser = { id: 'test-user' }; return true; },
    ensureRouteAnalysisEnabled: () => {}, ensureGpxImportEnabled: () => {}, ensureAIEnabled: () => {},
    getProductFeatureFlags: () => ({}), ...options,
  });
  const req = { body: {
    peak: 'Test Peak', route: 'test.gpx', lat: 46.85, lon: -121.76, date: '2026-07-10', start: '06:00', travel_window_hours: 12,
    waypoints: [{ name: 'Start', lat: 46.8, lon: -121.7, progress_percent: 0 }, { name: 'Summit', lat: 46.85, lon: -121.76, progress_percent: 100 }],
  } };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  return { run: () => handler(req, res), res, askAI };
};

test.each(['rejection', 'blank', 'null'])('successful checkpoint forecasts survive %s synthesis', async (failure) => {
  const askAI = failure === 'rejection' ? jest.fn().mockRejectedValue(new Error('Provider unavailable')) : jest.fn().mockResolvedValue(failure === 'blank' ? '  ' : null);
  const harness = routeHarness({ askAI });
  await harness.run();
  const result = harness.res.json.mock.calls[0][0];
  expect(result.analysisSource).toBe('deterministic');
  expect(result.summaries).toHaveLength(2);
  expect(result.summaries.every((entry) => entry.score === 80)).toBe(true);
  expect(result.analysis).toContain('HAZARD ZONES:');
  expect(result.partialData).toBe(false);
});

test('timed-out checkpoint does not discard completed forecasts', async () => {
  jest.useFakeTimers();
  try {
    const invokeSafetyHandler = jest.fn().mockResolvedValueOnce(successfulReport()).mockImplementationOnce(() => new Promise(() => {}));
    const harness = routeHarness({ invokeSafetyHandler });
    const pending = harness.run();
    await jest.advanceTimersByTimeAsync(60000);
    await pending;
    const result = harness.res.json.mock.calls[0][0];
    expect(result.partialData).toBe(true);
    expect(result.summaries[0]).toMatchObject({ dataAvailable: true, score: 80 });
    expect(result.summaries[1]).toMatchObject({ dataAvailable: false, score: null });
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});

test('synthesis timeout returns the checkpoint briefing', async () => {
  jest.useFakeTimers();
  try {
    const harness = routeHarness({ askAI: () => new Promise(() => {}) });
    const pending = harness.run();
    await jest.advanceTimersByTimeAsync(60000);
    await pending;
    expect(harness.res.json.mock.calls[0][0]).toMatchObject({ analysisSource: 'deterministic', partialData: false });
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});

test('all failed checkpoints return explicit unknowns without calling synthesis', async () => {
  const harness = routeHarness({ invokeSafetyHandler: () => { throw new Error('Forecast unavailable'); } });
  await harness.run();
  const result = harness.res.json.mock.calls[0][0];
  expect(result).toMatchObject({ partialData: true, analysisSource: 'deterministic' });
  expect(result.analysis).toContain('Data is missing at Start, Summit');
  expect(result.analysis).toContain('insufficient evidence');
  expect(result.analysis).not.toContain('0 mph');
  expect(harness.askAI).not.toHaveBeenCalled();
});

test('partial reports and relevant avalanche danger survive missing snow depth', async () => {
  const harness = routeHarness({
    ensureAIEnabled: () => { throw new Error('AI disabled'); },
    invokeSafetyHandler: async () => ({ statusCode: 200, payload: { ...successfulReport().payload, partialData: true, avalanche: { relevant: true, risk: 'Considerable', dangerLevel: 3 }, snowpack: {} } }),
  });
  await harness.run();
  const result = harness.res.json.mock.calls[0][0];
  expect(result.partialData).toBe(true);
  expect(result.summaries[0]).toMatchObject({ dataAvailable: true, partialData: true, avalanche: { risk: 'Considerable' } });
  expect(result.analysis).toContain('Considerable avalanche danger');
  expect(result.analysis).toContain('source data is incomplete');
});


test.each(['x', '\u0000'])('report budget accounts for long and escaped text (%p)', (character) => {
  const text = character.repeat(30000);
  const report = {
    safety: { score: 20, confidence: 30, tier: text, primaryHazard: text, confidenceReasons: [text, text, text] },
    weather: { temp: 2, windGust: 80, precipChance: 50, status: text, description: text },
    avalanche: { relevant: true, risk: text },
    alerts: { status: text, alerts: Array.from({ length: 5 }, (_, i) => ({ event: String(i) + text })) },
    partialData: true, apiWarning: text,
  };
  const json = serializeWaypointReports(Array.from({ length: 8 }, () => ({ name: 'x'.repeat(100), etaTime: '18:00', dataAvailable: true, report })));
  expect(json.length).toBeLessThanOrEqual(MAX_WAYPOINT_REPORTS_LENGTH);
  expect(JSON.parse(json).every((entry) => entry.report.safety.score === 20)).toBe(true);
});
