'use strict';

// ============================================================================
// scenario.safety-score.test.js
//
// Scenario-level regression tests for calculateSafetyScore. Unlike
// unit.helpers.test.js (which exercises individual factors in isolation),
// these tests run realistic composite inputs end-to-end and assert on the
// resulting tier/score BAND, not exact numbers — the goal is to catch gross
// regressions in overall proportionality (e.g. an unrelated threshold change
// accidentally making a clearly dangerous day look benign, or vice versa),
// not to lock in specific point values that will keep shifting as the model
// gets tuned. There's no incident/outcome dataset to calibrate against, so
// these bands reflect hand-built domain judgment about what a realistic day
// like this should read as.
// ============================================================================

const { calculateSafetyScore } = require('../src/utils/safety-score');

const safetyScoreBaseInput = () => ({
  avalancheData: { relevant: false, dangerUnknown: false, coverageStatus: 'no_center_coverage' },
  alertsData: { status: 'none', activeCount: 0, alerts: [] },
  airQualityData: { status: 'ok', usAqi: 30, category: 'Good' },
  fireRiskData: { status: 'ok', level: 1, source: 'Fire risk synthesis' },
  heatRiskData: { status: 'ok', level: 0, label: 'Low', source: 'Heat risk synthesis' },
  rainfallData: { status: 'ok', anchorTime: new Date().toISOString(), totals: {}, expected: {} },
  selectedDate: new Date().toISOString().slice(0, 10),
  selectedStartClock: '08:00',
  solarData: { sunrise: '6:30 AM', sunset: '6:00 PM' },
});

const calmWeather = (overrides = {}) => ({
  description: 'Mostly Sunny',
  windSpeed: 6, windGust: 10, precipChance: 5, humidity: 35, temp: 50, feelsLike: 49,
  isDaytime: true, issuedTime: new Date().toISOString(),
  trend: Array.from({ length: 8 }, () => ({ temp: 50, wind: 6, gust: 10, precipChance: 5, condition: 'Mostly Sunny' })),
  ...overrides,
});

test('scenario: benign clear/calm day with no avalanche coverage scores Low', () => {
  const result = calculateSafetyScore({ ...safetyScoreBaseInput(), weatherData: calmWeather() });
  expect(result.score).toBeGreaterThanOrEqual(85);
  expect(result.tier).toBe('Low');
});

test('scenario: danger-level-4 avalanche alone (calm weather) materially degrades the score', () => {
  const result = calculateSafetyScore({
    ...safetyScoreBaseInput(),
    weatherData: calmWeather(),
    avalancheData: {
      relevant: true, dangerUnknown: false, coverageStatus: 'reported',
      dangerLevel: 4, risk: 'High', problems: [], publishedTime: new Date().toISOString(),
    },
  });
  // Avalanche danger alone must be able to meaningfully move the score even
  // with nothing else wrong — it shouldn't take a compounding hazard to matter.
  expect(result.score).toBeLessThanOrEqual(70);
  expect(['Elevated', 'High', 'Extreme']).toContain(result.tier);
});

test('scenario: severe wind + storm alone (low avalanche danger) reads as Elevated or worse', () => {
  const result = calculateSafetyScore({
    ...safetyScoreBaseInput(),
    avalancheData: {
      relevant: true, dangerUnknown: false, coverageStatus: 'reported',
      dangerLevel: 1, risk: 'Low', problems: [], publishedTime: new Date().toISOString(),
    },
    weatherData: {
      description: 'Blizzard',
      windSpeed: 40, windGust: 55, precipChance: 85, humidity: 90, temp: 15, feelsLike: -5,
      isDaytime: true, issuedTime: new Date().toISOString(),
      trend: Array.from({ length: 8 }, () => ({ temp: 15, wind: 40, gust: 55, precipChance: 85, condition: 'Blizzard' })),
    },
  });
  expect(result.score).toBeLessThanOrEqual(70);
  expect(['Elevated', 'High', 'Extreme']).toContain(result.tier);
});

test('scenario: considerable avalanche + wind loading compounds into High/Extreme', () => {
  const result = calculateSafetyScore({
    ...safetyScoreBaseInput(),
    avalancheData: {
      relevant: true, dangerUnknown: false, coverageStatus: 'reported',
      dangerLevel: 3, risk: 'Considerable', problems: [], publishedTime: new Date().toISOString(),
    },
    weatherData: {
      description: 'Partly Cloudy',
      windSpeed: 25, windGust: 40, precipChance: 15, humidity: 45, temp: 22, feelsLike: 14,
      isDaytime: true, issuedTime: new Date().toISOString(),
      trend: Array.from({ length: 6 }, () => ({ temp: 22, wind: 25, gust: 40, precipChance: 15 })),
    },
  });
  expect(result.score).toBeLessThanOrEqual(55);
  expect(['High', 'Extreme']).toContain(result.tier);
  const windLoadingFactor = result.factors.find((f) => f.hazard === 'Avalanche Wind Loading');
  expect(windLoadingFactor).toBeDefined();
});

test('scenario: mild secondary-only day (moderate AQI + minor alert + low fire) stays Low/Caution', () => {
  // This is the scenario that locks in the groupScales rebalance: alerts/airQuality/fire
  // are capped low specifically so a day where ONLY these secondary hazards are present
  // (avalanche + weather both benign) can't stack into an Elevated-or-worse read.
  const result = calculateSafetyScore({
    ...safetyScoreBaseInput(),
    weatherData: calmWeather(),
    alertsData: { status: 'ok', activeCount: 1, highestSeverity: 'minor', alerts: [{ event: 'Frost Advisory' }] },
    airQualityData: { status: 'ok', usAqi: 110, category: 'Unhealthy for Sensitive Groups' },
    fireRiskData: { status: 'ok', level: 2, source: 'Fire risk synthesis' },
  });
  expect(result.score).toBeGreaterThanOrEqual(75);
  expect(['Low', 'Caution']).toContain(result.tier);
});

test('scenario: stale weather issuance + unknown avalanche coverage degrades confidence', () => {
  const result = calculateSafetyScore({
    ...safetyScoreBaseInput(),
    weatherData: { ...calmWeather(), issuedTime: new Date(Date.now() - 20 * 3600 * 1000).toISOString() },
    avalancheData: { relevant: true, dangerUnknown: true, coverageStatus: 'unknown' },
  });
  expect(result.confidence).toBeLessThan(80);
  expect(result.confidenceReasons.length).toBeGreaterThan(0);
});

test('scenario: complete weather outage cannot report a Low-risk score', () => {
  const result = calculateSafetyScore({
    ...safetyScoreBaseInput(),
    weatherData: {
      description: 'Weather data unavailable',
      windSpeed: null, windGust: null, precipChance: null, humidity: null,
      temp: null, feelsLike: null, isDaytime: null, issuedTime: null, trend: [],
    },
  });

  expect(result.score).toBeLessThan(85);
  expect(result.tier).toBe('Caution');
  expect(result.primaryHazard).toBe('Weather Unavailable');
  expect(result.groupImpacts.weather.raw).toBeGreaterThan(0);
});
