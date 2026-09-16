const { calculateSafetyScore } = require('../src/utils/safety-score');
const { selectForecastIntervals } = require('../src/utils/report-evidence');
const { validateBrief, deterministicBrief } = require('../src/utils/brief-validation');
const start = '2026-09-16T08:30:00-07:00';
const row = (timeIso, extra = {}) => ({ timeIso, temp: 55, feelsLike: 55, wind: 5, gust: 8, precipChance: 0, ...extra });
const base = () => ({
  selectedStartTime: start, selectedTravelWindowHours: 2,
  selectedDate: '2026-09-16', selectedStartClock: '08:30',
  avalancheData: { relevant: false }, alertsData: { status: 'none', alerts: [] },
  weatherData: { temp: 55, feelsLike: 55, windSpeed: 5, windGust: 8, precipChance: 0,
    issuedTime: new Date().toISOString(), forecastStartTime: start,
    sourceDetails: { primary: 'NOAA' },
    trend: [row('2026-09-16T08:00:00-07:00'), row('2026-09-16T09:00:00-07:00'), row('2026-09-16T10:00:00-07:00')] },
});

test('partial boundary hours are clipped and a final partial hour is required', () => {
  const input = base();
  expect(calculateSafetyScore(input).coverage.completeHours).toBe(2);
  expect(calculateSafetyScore(input).assessmentStatus).toBe('supported');
  input.weatherData.trend.pop();
  expect(calculateSafetyScore(input)).toMatchObject({ assessmentStatus: 'insufficient_evidence', coverage: { completeHours: 1.5 } });
});
test('duplicate rows, gaps and missing dimensions never establish complete coverage', () => {
  const input = base();
  const full = calculateSafetyScore(input);
  input.weatherData.trend = [input.weatherData.trend[0], input.weatherData.trend[0], input.weatherData.trend[2]];
  const sparse = calculateSafetyScore(input);
  expect(sparse.coverage.completeHours).toBe(1);
  expect(sparse.assessmentStatus).toBe('insufficient_evidence');
  expect(sparse.confidence).toBeLessThanOrEqual(full.confidence);
  input.weatherData.trend = base().weatherData.trend.map(r => ({ ...r, precipChance: null }));
  expect(calculateSafetyScore(input).coverage.completeHours).toBe(0);
});
test('timestamps are required; outside-window readings and invalid intervals cannot establish coverage', () => {
  const input = base();
  input.weatherData.trend = [row('invalid'), row('2026-09-17T08:00:00-07:00'), row('2026-09-16T08:00:00-07:00', { endTimeIso: '2026-09-16T07:00:00-07:00' })];
  expect(calculateSafetyScore(input).coverage.completeHours).toBe(0);
});
test('elapsed-hour coverage crosses midnight and both DST transitions', () => {
  for (const times of [
    ['2026-09-16T23:00:00-07:00', '2026-09-17T00:00:00-07:00'],
    ['2026-11-01T01:00:00-07:00', '2026-11-01T01:00:00-08:00'],
    ['2026-03-08T01:00:00-08:00', '2026-03-08T03:00:00-07:00'],
  ]) expect(selectForecastIntervals(times.map(t => row(t)), times[0], 2).reduce((n, r) => n + r.hours, 0)).toBe(2);
});
test('stale issuance, alert outage, and avalanche expiry before return gate the assessment', () => {
  for (const change of [
    input => { input.weatherData.issuedTime = '2026-01-01T00:00:00Z'; },
    input => { input.alertsData = { status: 'unavailable' }; },
    input => { input.avalancheData = { relevant: true, dangerLevel: 1, expiresTime: '2026-09-16T09:00:00-07:00' }; },
  ]) { const input = base(); change(input); expect(calculateSafetyScore(input).assessmentStatus).toBe('insufficient_evidence'); }
});
test('fallback and unspecified sources retain their actual attribution', () => {
  const input = base(); input.weatherData.sourceDetails = { primary: 'Open-Meteo' };
  const result = calculateSafetyScore(input);
  expect(result.sourcesUsed).toContain('Open-Meteo hourly forecast');
  expect(result.sourcesUsed).not.toContain('NOAA/NWS hourly forecast');
  delete input.weatherData.sourceDetails;
  expect(calculateSafetyScore(input).weatherProvenance.provider).toBe('Weather provider unspecified');
});
const headings = ['BIG PICTURE', 'WHY IT MATTERS', 'WATCH CLOSELY', 'DATA CONFIDENCE', 'COMFORT CHECK', 'BEST MOVE'];
const brief = text => JSON.stringify({ sections: headings.map(heading => ({ heading, text, evidence: [{ path: 'weather.windGust', value: 8 }] })) });
test('brief validation rejects unsupported quantities, forged references, and permissive recommendations', () => {
  const report = { weather: { windGust: 8 } };
  expect(validateBrief(brief('Forecast gusts are 8 mph.'), report, 'CAUTION')).not.toBeNull();
  expect(validateBrief(brief('Forecast gusts are 80 mph.'), report, 'CAUTION')).toBeNull();
  expect(validateBrief(brief('Proceed with caution.'), report, 'NO-GO')).toBeNull();
  expect(validateBrief(brief('Safe to go.'), report, 'GO')).toBeNull();
  expect(validateBrief(brief('Forecast gusts are 8 mph.'), { weather: { windGust: null } }, 'GO')).toBeNull();
  expect(validateBrief('unstructured answer', report, 'GO')).toBeNull();
  expect(deterministicBrief({ safety: { assessmentStatus: 'insufficient_evidence' } }, 'CAUTION')).toMatch(/Insufficient evidence/);
});

test('saved synthetic sparse-provider fixture remains insufficient on replay', () => {
  const fixture = require('./fixtures/reliability/partial-window.json');
  expect(calculateSafetyScore(fixture)).toMatchObject({ assessmentStatus: 'insufficient_evidence', coverage: { completeHours: 1.5 } });
});
test('provider local time normalization preserves objective timezone and rejects nonexistent DST time', () => {
  const { zonedForecastIso } = require('../src/utils/report-evidence');
  expect(zonedForecastIso('2026-09-16T08:00', 'America/Los_Angeles')).toBe('2026-09-16T08:00:00-07:00');
  expect(zonedForecastIso('2026-03-08T02:00', 'America/Los_Angeles')).toBeNull();
});
test('verification computes forecast errors without combining units, leads or unmatched observations', () => {
  const { verifyForecastPairs } = require('../src/utils/forecast-verification');
  const pair = { provider: 'example', forecastLocationId: 'station-a', observationLocationId: 'station-a', variable: 'temperature', unit: 'F', issuedAt: '2026-09-16T00:00:00Z', validAt: '2026-09-16T12:00:00Z', observedAt: '2026-09-16T12:00:00Z', forecast: 60, observed: 56 };
  const result = verifyForecastPairs([pair, pair, { ...pair, forecastLocationId: 'summit' }, { ...pair, forecast: null }, { ...pair, validAt: '2026-09-16T13:00:00Z', observedAt: '2026-09-16T13:00:00Z', forecast: 54 }]);
  expect(result.rejected).toBe(3);
  expect(result.groups[0]).toMatchObject({ count: 2, bias: 1, mae: 3 });
  expect(result.groups[0].rmse).toBeCloseTo(Math.sqrt(10));
});

test('Open-Meteo outage gaps remain null, genuine zero survives, and retrieval is not issuance', async () => {
  const { createWeatherDataService } = require('../src/utils/weather-data');
  const payload = { timezone: 'America/Los_Angeles', hourly: {
    time: ['2026-09-16T08:00', '2026-09-16T09:00', '2026-09-16T10:00'],
    temperature_2m: [null, 0, 50], wind_speed_10m: [null, 0, 5], wind_gusts_10m: [null, 0, 8],
    precipitation_probability: [null, 0, 0], weather_code: [null, 0, 0],
  } };
  const service = createWeatherDataService({ fetchWithTimeout: jest.fn(async () => ({ ok: true, json: async () => payload, headers: { get: () => 'Wed, 16 Sep 2026 14:00:00 GMT' } })), requestTimeoutMs: 100 });
  const result = await service.fetchOpenMeteoWeatherFallback({ lat: 33.912345, lon: -116.912345, selectedDate: '2026-09-16', startClock: '08:30', trendHours: 2, fetchOptions: {} });
  const weather = JSON.parse(JSON.stringify(result.weatherData));
  expect(weather).toMatchObject({ temp: null, windSpeed: null, windGust: null, precipChance: null, issuedTime: null, fetchedAt: '2026-09-16T14:00:00.000Z', forecastStartTime: '2026-09-16T08:00:00-07:00' });
  expect(weather.trend).toHaveLength(3);
  expect(weather.trend[0]).toMatchObject({ temp: null, wind: null, gust: null, precipChance: null });
  expect(weather.trend[1]).toMatchObject({ temp: 0, wind: 0, gust: 0, precipChance: 0 });
});

test('elevation estimates cannot invent calm wind when the baseline is missing', () => {
  const { buildElevationForecastBands } = require('../src/utils/visibility-risk');
  const bands = buildElevationForecastBands({ baseElevationFt: 10000, tempF: 55, windSpeedMph: null, windGustMph: null });
  expect(bands.length).toBeGreaterThan(0);
  expect(bands.every(band => band.windSpeed === null && band.windGust === null)).toBe(true);
});
