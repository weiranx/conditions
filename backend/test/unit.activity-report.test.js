const {
  ACTIVITY_KEYS,
  ACTIVITY_PROFILES,
  activityHazardWeight,
  describeActivityInstruction,
  normalizeActivity,
} = require('../src/utils/activity-profiles');
const { calculateSafetyScore } = require('../src/utils/safety-score');
const { evaluateAvalancheRelevance } = require('../src/utils/avalanche-orchestration');
const { buildReportInsights } = require('../src/utils/report-insights');
const { createObjectiveWatchChecker } = require('../src/services/objective-watch-checker');

describe('activity profiles', () => {
  test('unknown or missing activities plan as general backcountry', () => {
    expect(normalizeActivity(' Ski-Touring ')).toBe('ski-touring');
    expect(normalizeActivity('paragliding')).toBe('backcountry');
    expect(normalizeActivity(null)).toBe('backcountry');
  });

  test('activity weights only ever raise a hazard', () => {
    for (const key of ACTIVITY_KEYS) {
      for (const weight of Object.values(ACTIVITY_PROFILES[key].hazardWeights)) {
        expect(weight).toBeGreaterThan(1);
      }
    }
    expect(activityHazardWeight('trail-running', 'Heat')).toBeGreaterThan(1);
    expect(activityHazardWeight('trail-running', 'Avalanche')).toBe(1);
    expect(activityHazardWeight('backcountry', 'Wind')).toBe(1);
  });

  test('the AI instruction names the activity and keeps every hazard in play', () => {
    expect(describeActivityInstruction('backcountry')).toBe('');
    expect(describeActivityInstruction(undefined)).toBe('');
    const instruction = describeActivityInstruction('ski-touring');
    expect(instruction).toContain('Ski touring');
    expect(instruction).toMatch(/never drop or downplay/);
  });
});

describe('activity-weighted safety score', () => {
  const hotDay = () => ({
    avalancheData: { relevant: false, dangerUnknown: false, coverageStatus: 'no_center_coverage' },
    alertsData: { status: 'none', activeCount: 0, alerts: [] },
    airQualityData: { status: 'ok', usAqi: 30, category: 'Good' },
    fireRiskData: { status: 'ok', level: 1, source: 'Fire risk synthesis' },
    // Level 2 sets no group floor, so the weighted factors show in the score.
    heatRiskData: { status: 'ok', level: 2, label: 'Elevated', source: 'Heat risk synthesis' },
    rainfallData: { status: 'ok', anchorTime: new Date().toISOString(), totals: {}, expected: {} },
    selectedDate: new Date().toISOString().slice(0, 10),
    selectedStartClock: '08:00',
    solarData: { sunrise: '6:30 AM', sunset: '8:00 PM' },
    weatherData: {
      description: 'Sunny', windSpeed: 5, windGust: 8, precipChance: 0, humidity: 20, temp: 96, feelsLike: 98,
      isDaytime: true, issuedTime: new Date().toISOString(),
      trend: Array.from({ length: 8 }, () => ({ temp: 96, wind: 5, gust: 8, precipChance: 0, condition: 'Sunny' })),
    },
  });

  test('scoring without an activity, or as general backcountry, is unchanged', () => {
    const plain = calculateSafetyScore(hotDay());
    const neutral = calculateSafetyScore({ ...hotDay(), activity: 'backcountry' });
    expect(neutral.score).toBe(plain.score);
    expect(plain.activity).toBeNull();
    expect(neutral.activity).toBe('backcountry');
    expect(plain.factors.some((factor) => factor.activityWeight)).toBe(false);
  });

  test('heat weighs more for a trail run and says so on the factor', () => {
    const plain = calculateSafetyScore(hotDay());
    const run = calculateSafetyScore({ ...hotDay(), activity: 'trail-running' });
    expect(run.activity).toBe('trail-running');
    expect(run.score).toBeLessThan(plain.score);
    const heat = run.factors.filter((factor) => factor.hazard === 'Heat');
    expect(heat.length).toBeGreaterThan(0);
    expect(heat.every((factor) => factor.activityWeight === 1.3)).toBe(true);
  });

  test('an activity never scores a day better than general backcountry', () => {
    const plain = calculateSafetyScore(hotDay());
    for (const activity of ACTIVITY_KEYS) {
      expect(calculateSafetyScore({ ...hotDay(), activity }).score).toBeLessThanOrEqual(plain.score);
    }
  });
});

describe('activity-aware avalanche relevance', () => {
  const summerSnowFree = {
    lat: 37.7,
    selectedDate: '2026-07-20',
    weatherData: { elevation: 9000, temp: 62, feelsLike: 62, precipChance: 5, description: 'Sunny' },
    avalancheData: { coverageStatus: 'no_active_forecast' },
    snowpackData: { snotel: { snowDepthIn: 0, sweIn: 0 } },
    rainfallData: { expected: {} },
  };

  test('summer hiking stays out of avalanche scope', () => {
    expect(evaluateAvalancheRelevance({ ...summerSnowFree, activity: 'hiking' }).relevant).toBe(false);
    expect(evaluateAvalancheRelevance(summerSnowFree).relevant).toBe(false);
  });

  test('snow-travel activities keep avalanche conditions in scope and explain why', () => {
    for (const activity of ['ski-touring', 'snow-climbing', 'mountaineering']) {
      const result = evaluateAvalancheRelevance({ ...summerSnowFree, activity });
      expect(result.relevant).toBe(true);
      expect(result.reason).toMatch(/travels on snow/);
    }
  });

  test('an activity never turns an official forecast off', () => {
    const covered = { ...summerSnowFree, avalancheData: { coverageStatus: 'reported', dangerLevel: 2 } };
    expect(evaluateAvalancheRelevance({ ...covered, activity: 'trail-running' }).relevant).toBe(true);
  });
});

describe('activity insights', () => {
  const report = (activity, extra = {}) => ({
    generatedAt: '2026-07-16T12:00:00Z',
    forecast: { activity, selectedDate: '2026-07-17', requestedStartTime: '06:00' },
    weather: { elevation: 11000, description: 'Mostly Sunny', temperatureContext24h: { overnightLowF: 38 } },
    rainfall: { source: 'Open-Meteo', mode: 'projected_for_selected_start', totals: { rainPast24hIn: 0.4 }, expected: {} },
    heatRisk: { level: 3, label: 'High', source: 'Heat risk synthesis' },
    airQuality: { usAqi: 120, category: 'Unhealthy for Sensitive Groups', source: 'AirNow' },
    atmosphere: { thunderProbability: 40 },
    featureFlags: {},
    ...extra,
  });
  const ids = (data) => (buildReportInsights(data)?.items || []).map((item) => item.id);

  test('general backcountry adds no activity checks and keeps an empty report empty', () => {
    expect(buildReportInsights(report('backcountry'))).toBeUndefined();
    expect(buildReportInsights(report(undefined))).toBeUndefined();
  });

  test('a scramble checks wet rock and the lightning window', () => {
    expect(ids(report('scrambling'))).toEqual(expect.arrayContaining(['wet-rock', 'exposed-lightning']));
    expect(ids(report('hiking'))).not.toContain('wet-rock');
  });

  test('observed rain is flagged but not treated as the start-time forecast', () => {
    const data = report('scrambling', { rainfall: { mode: 'observed_recent', totals: { rainPast24hIn: 0.4 }, expected: {} } });
    const wet = buildReportInsights(data).items.find((item) => item.id === 'wet-rock');
    expect(wet.decisionRelevant).toBe(false);
    expect(wet.meaning).toContain('not a forecast for your start');
  });

  test('snow objectives check the overnight refreeze', () => {
    const refreeze = buildReportInsights(report('snow-climbing')).items.find((item) => item.id === 'refreeze');
    expect(refreeze).toMatchObject({ tone: 'caution', decisionRelevant: true });
    const cold = report('snow-climbing', { weather: { elevation: 11000, temperatureContext24h: { overnightLowF: 20 } } });
    expect(ids(cold)).not.toContain('refreeze');
  });

  test('a run checks heat and air quality, and drops them when those domains are off', () => {
    expect(ids(report('trail-running'))).toEqual(expect.arrayContaining(['runner-heat', 'runner-air']));
    const off = report('trail-running', { featureFlags: { heatRiskDetails: false, airQualityDetails: false } });
    expect(ids(off)).not.toEqual(expect.arrayContaining(['runner-heat']));
    expect(ids(off)).not.toEqual(expect.arrayContaining(['runner-air']));
  });

  test('a ski tour flags fresh loading only while avalanche details are on', () => {
    const loaded = report('ski-touring', { rainfall: { totals: { snowPast24hIn: 10 }, expected: {} } });
    expect(ids(loaded)).toContain('fresh-load');
    expect(ids({ ...loaded, featureFlags: { avalancheDetails: false } })).not.toContain('fresh-load');
  });
});

describe('objective watch checks keep the scored activity', () => {
  const PLAN = { lat: 46.85, lon: -121.76, forecastDate: '2026-07-17', alpineStartTime: '06:00', travelWindowHours: 12 };
  const payload = (activity) => ({
    generatedAt: '2026-07-14T00:00:00.000Z',
    weather: { windGust: 10, precipChance: 10, trend: [] },
    avalanche: { dangerLevel: 1 },
    alerts: { alerts: [] },
    terrainCondition: { impact: 'low' },
    safety: { score: 80, tier: 'Low', ...(activity ? { activity } : {}) },
  });
  const row = (id, activity) => ({
    id,
    title: id,
    plan: PLAN,
    baseline_report: { safetyData: payload(activity) },
    last_snapshot: null,
    consecutive_failures: 0,
    notifications_enabled: false,
    tier_key: 'premium',
  });

  test('re-checks with the reference activity, and older snapshots stay general', async () => {
    const rows = [row('ski', 'ski-touring'), row('legacy', null)];
    const query = jest.fn(async (sql) => (sql.includes('FROM objective_watches watches') ? { rows } : { rows: [] }));
    const invokeSafetyHandler = jest.fn().mockResolvedValue({ statusCode: 200, payload: payload('ski-touring') });
    const checker = createObjectiveWatchChecker({
      database: { configured: true, query },
      invokeSafetyHandler,
      emailService: { available: false },
      log: { warn: jest.fn() },
      now: () => new Date('2026-07-14T00:00:00.000Z'),
    });
    const summary = await checker.run();
    expect(summary.uniquePlans).toBe(2);
    const activities = invokeSafetyHandler.mock.calls.map(([params]) => params.activity);
    expect(activities).toEqual(expect.arrayContaining(['ski-touring', undefined]));
  });
});
