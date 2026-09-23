const { applyAvalanchePostProcessing } = require('../src/utils/avalanche-pipeline');
const { evaluateAvalancheRelevance } = require('../src/utils/avalanche-orchestration');

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDaysAgo = (days) => new Date(Date.now() - days * DAY_MS).toISOString();
const reported = (overrides = {}) => ({
  center: 'Sierra Avalanche Center',
  center_id: 'SAC',
  zone: 'Central Sierra Nevada',
  link: 'https://www.sierraavalanchecenter.org/forecasts',
  risk: 'Low',
  dangerLevel: 1,
  dangerUnknown: false,
  coverageStatus: 'reported',
  bottomLine: 'Final bulletin of the season.',
  problems: [],
  publishedTime: isoDaysAgo(21),
  expiresTime: isoDaysAgo(20),
  elevations: null,
  relevant: true,
  relevanceReason: null,
  ...overrides,
});
const process = (avalancheData) =>
  applyAvalanchePostProcessing({ avalancheData, alertTargetTimeIso: new Date(Date.now() + DAY_MS).toISOString() });

test('a bulletin last issued weeks ago is treated as a closed season', () => {
  const result = process(reported());
  expect(result.coverageStatus).toBe('no_active_forecast');
  expect(result.dangerUnknown).toBe(true);
  expect(result.publishedTime).toBeNull();
  expect(result.staleWarning).toBeUndefined();
  expect(result.center).toBe('Sierra Avalanche Center');
  expect(result.zone).toBe('Central Sierra Nevada');
  expect(result.link).toBe('https://www.sierraavalanchecenter.org/forecasts');
});

test('a closed-season bulletin no longer forces avalanche relevance on a snow-free summer objective', () => {
  const avalancheData = process(reported());
  const { relevant } = evaluateAvalancheRelevance({
    lat: 38.9,
    selectedDate: '2026-09-24',
    weatherData: { elevation: 9000, temp: 55, feelsLike: 55, description: 'Sunny', precipChance: 0 },
    avalancheData,
    snowpackData: { nohrsc: { snowDepthIn: 0, sweIn: 0 } },
  });
  expect(relevant).toBe(false);
});

test.each([
  ['published 4 days ago', { publishedTime: isoDaysAgo(4), expiresTime: isoDaysAgo(3) }],
  ['published long ago but still unexpired', { publishedTime: isoDaysAgo(10), expiresTime: isoDaysAgo(-1) }],
])('an in-season bulletin %s keeps its stale-bulletin handling', (_label, times) => {
  expect(process(reported(times)).coverageStatus).not.toBe('no_active_forecast');
});

test('a bulletin with no usable times is left alone', () => {
  expect(process(reported({ publishedTime: null, expiresTime: null })).coverageStatus).toBe('reported');
});
