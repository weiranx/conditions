const { evaluateAvalancheRelevance } = require('../src/utils/avalanche-orchestration');
const input = (overrides = {}) => ({
  lat: 44, selectedDate: '2026-01-16',
  weatherData: { elevation: 10000, temp: 33, feelsLike: 28, description: 'Clear', precipChance: 0 },
  avalancheData: { coverageStatus: 'no_active_forecast', dangerUnknown: true },
  snowpackData: { nohrsc: { snowDepthIn: 0, sweIn: 0 } },
  ...overrides,
});
const relevant = (overrides) => evaluateAvalancheRelevance(input(overrides)).relevant;
test.each(['no_active_forecast', 'no_center_coverage', 'temporarily_unavailable'])(
  'zero observed snow overrides cold alone with %s', (coverageStatus) => {
    expect(relevant({ avalancheData: { coverageStatus, dangerUnknown: true } })).toBe(false);
  },
);
test.each([null, undefined, '', ' ', false])('missing depth %p is not snow-free evidence', (snowDepthIn) => {
  expect(relevant({ snowpackData: { nohrsc: { snowDepthIn, sweIn: null } } })).toBe(true);
});
test('absent snowpack data retains cold-weather uncertainty', () => {
  expect(relevant({ snowpackData: null })).toBe(true);
});
test.each([
  { nohrsc: { snowDepthIn: 0, sweIn: 1 } },
  { nohrsc: { snowDepthIn: 0, sweIn: 0 }, snotel: { snowDepthIn: 12, distanceKm: 20 } },
  { nohrsc: { snowDepthIn: 0.5, sweIn: 0 } },
  { snotel: { snowDepthIn: 0, sweIn: 0, distanceKm: 150 } },
])('snow presence or distant-only zeros do not suppress uncertainty: %p', (snowpackData) => {
  expect(relevant({ snowpackData })).toBe(true);
});
test('numeric string zeros are accepted', () => {
  expect(relevant({ snowpackData: { nohrsc: { snowDepthIn: '0', sweIn: '0' } } })).toBe(false);
});
test.each([{ description: 'Snow showers' }, { temp: 35, precipChance: 70 }])(
  'forecast precipitation preserves relevance despite current zero snow: %p', (weather) => {
    expect(relevant({ weatherData: { ...input().weatherData, ...weather } })).toBe(true);
  },
);
test.each([0.5, 6])('forecast accumulation of %p inches preserves relevance', (snowWindowIn) => {
  expect(relevant({ rainfallData: { expected: { snowWindowIn } } })).toBe(true);
});
test.each([
  { coverageStatus: 'reported', dangerUnknown: false, dangerLevel: 2 },
  { coverageStatus: 'reported', staleWarning: '72h', dangerUnknown: true },
  { coverageStatus: 'expired_for_selected_start', dangerUnknown: true },
])('official and stale bulletins remain relevant: %p', (avalancheData) => {
  expect(relevant({ avalancheData })).toBe(true);
});

test.each([
  { temp: 33, feelsLike: 35 },
  { temp: 40, feelsLike: 28 },
])('either cold trigger alone is suppressed with observed zero snow: %p', (weather) => {
  expect(relevant({ weatherData: { ...input().weatherData, ...weather } })).toBe(false);
});
