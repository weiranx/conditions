const { deriveTerrainCondition } = require('../src/utils/terrain-condition');
const { buildPrecedingNight, buildTemperatureContext24h } = require('../src/utils/weather-data');
const { snowEvidence, surfaceIntervals, meltFreezeAnalysis, groundMoisture } = require('../src/utils/surface-evidence');
const { mmToInches, cmToInches } = require('../src/utils/precipitation');
const start = '2026-04-15T08:00:00-07:00';
const weather = { description: 'Sunny', temp: 40, humidity: 45, precipChance: 5, elevation: 9000, forecastStartTime: start,
  trend: [30, 34, 38, 42].map((temp, i) => ({ timeIso: `2026-04-15T${String(8 + i).padStart(2, '0')}:00:00-07:00`, temp, cloudCover: 10, isDaytime: true, precipChance: 5 })) };
const snow = { snotel: { observedDate: '2026-04-15', snowDepthIn: 20, sweIn: 5, distanceKm: 5, elevationFt: 9000 } };
const rain = { totals: { rainPast24hIn: 0, rainPast48hIn: 0, rainPast72hIn: 0 }, expected: { rainWindowIn: 0, snowWindowIn: 0 } };
const options = { selectedStartClock: '08:00', selectedTravelWindowHours: 4 };

test('missing weather or history cannot establish dry firm footing', () => {
  for (const input of [{ description: 'Sunny' }, weather]) {
    const result = deriveTerrainCondition(input);
    expect(result.code).not.toBe('dry_firm');
    expect(result.confidence).toBe('low');
  }
  const result = deriveTerrainCondition(weather, { snotel: { ...snow.snotel, snowDepthIn: 0, sweIn: 0 } }, rain, options);
  expect(result.code).toBe('dry_firm');
});

test('a following-night low never establishes preceding-night refreeze', () => {
  const result = deriveTerrainCondition({ ...weather, temperatureContext24h: { overnightLowF: 20, daytimeHighF: 45 } }, snow, rain, options);
  expect(result.snowProfile.meltFreeze.refreezeQuality).toBe('unknown');
  expect(result.snowProfile.meltFreeze.cycleDetected).toBe(false);
  expect(result.snowProfile.meltFreeze.signals.softeningStart).toBeNull();
});

test('preceding night requires contiguous valid temperatures and a known night boundary', () => {
  const points = Array.from({ length: 9 }, (_, i) => ({ timeIso: `2026-04-14T${String(14 + i).padStart(2, '0')}:00:00-07:00`, isDaytime: i < 4, tempF: 27 }));
  expect(buildPrecedingNight(points)).toMatchObject({ complete: true, freezingHours: 5, freezingDegreeHours: 25 });
  expect(buildPrecedingNight(points.slice(4)).complete).toBe(false);
  expect(buildPrecedingNight(points.filter((_, i) => i !== 6)).complete).toBe(false);
  expect(buildPrecedingNight(points.map((p, i) => i === 6 ? { ...p, tempF: null } : p)).complete).toBe(false);
  expect(buildTemperatureContext24h({ points: [{ tempF: null }] })).toBeNull();
});

test('refreeze depends on cold duration rather than a single low', () => {
  const strong = meltFreezeAnalysis({ ...weather, precedingNight: { complete: true, minTempF: 24, freezingHours: 6, freezingDegreeHours: 30 } }, options, true);
  const weak = meltFreezeAnalysis({ ...weather, precedingNight: { complete: true, minTempF: 24, freezingHours: 1, freezingDegreeHours: 8 } }, options, true);
  expect(strong.refreezeQuality).toBe('strong');
  expect(weak.refreezeQuality).toBe('weak');
  expect(strong.signals.softeningStart).toBeNull();
});

test('snow estimate uses location and age instead of taking the maximum', () => {
  const data = { snotelStations: [snow.snotel, { ...snow.snotel, stationName: 'Distant high station', distanceKm: 70, elevationFt: 12500, snowDepthIn: 100, sweIn: 30 }] };
  expect(snowEvidence(data, weather).depthIn).toBe(20);
  expect(snowEvidence({ snotel: { ...snow.snotel, observedDate: '2026-03-01' } }, weather).quality).toBe('unavailable');
  expect(snowEvidence({ snotel: { snowDepthIn: 20, sweIn: 5 } }, weather).quality).toBe('limited');
});

test('snow disagreement remains visible and limits confidence', () => {
  const result = deriveTerrainCondition(weather, { ...snow, nohrsc: { sampledTime: '2026-04-15T06:00:00Z', snowDepthIn: 0, sweIn: 0 } }, rain, options);
  expect(result.evidence.disagreement).toBe(true);
  expect(result.confidence).toBe('low');
  expect(result.code).not.toBe('dry_firm');
  expect(result.confidenceReasons.join(' ')).toMatch(/disagree/);
});

test('partial hours are weighted and duplicate or missing periods cannot increase coverage', () => {
  const input = { ...weather, trend: [...weather.trend, weather.trend[0]] };
  const result = surfaceIntervals(input, { selectedStartClock: '08:30', selectedTravelWindowHours: 3 });
  expect(result.coverageHours).toBe(3);
  expect(result.rows[0].durationHours).toBe(0.5);
  expect(result.rows.at(-1).durationHours).toBe(0.5);
  const incomplete = meltFreezeAnalysis({ ...weather, trend: weather.trend.filter((_, i) => i !== 1) }, options, true);
  expect(incomplete.meltPotential).toBe('unknown');
});

test('multi-day rain persists after the most recent day becomes dry', () => {
  const history = { ...rain, totals: { rainPast24hIn: 0, rainPast48hIn: 0, rainPast72hIn: 1 } };
  expect(groundMoisture(history, weather).retainedRainIn).toBeCloseTo(0.3);
  const result = deriveTerrainCondition(weather, { snotel: { ...snow.snotel, snowDepthIn: 0, sweIn: 0 } }, history, options);
  expect(result.code).toBe('wet_muddy');
  expect(result.outlook.travelEffects.join(' ')).toMatch(/Wet rock.*mud/);
  expect(groundMoisture(null, weather).state).toBe('unknown');
});

test('missing snow/rain values do not convert to zero', () => {
  expect(mmToInches(null)).toBeNull();
  expect(cmToInches('')).toBeNull();
  expect(mmToInches(0)).toBe(0);
});

test('hourly outlook changes from cold snow to warming and exposes route limitations', () => {
  const result = deriveTerrainCondition(weather, snow, rain, options);
  expect(result.outlook.timeline.map(p => p.state)).toEqual(['firm_or_frozen_possible', 'softening_possible', 'softening_possible', 'wet_snow_possible']);
  expect(result.outlook.terrainLimitations).toMatch(/aspect.*slope.*canopy.*soil/);
});

test('precipitation history preserves missing and incomplete windows, while retaining real zeroes', async () => {
  const { createPrecipitationService } = require('../src/utils/precipitation');
  const anchor = Date.parse(start);
  const time = Array.from({ length: 78 }, (_, i) => new Date(anchor + (i - 72) * 3600000).toISOString());
  const fetchPayload = async (values, times = time) => {
    const service = createPrecipitationService({ requestTimeoutMs: 100,
      fetchWithTimeout: async () => ({ ok: true, json: async () => ({ hourly: { time: times, rain: values, snowfall: values, precipitation: values } }) }),
    });
    return service.fetchRecentRainfallData(40, -110, start, 4);
  };
  const zeros = Array(78).fill(0);
  expect((await fetchPayload(zeros)).totals.rainPast72hIn).toBe(0);
  const missing = [...zeros]; missing[60] = null;
  expect((await fetchPayload(missing)).totals.rainPast24hIn).toBeNull();
  expect((await fetchPayload([0, 0], time.slice(71, 73))).totals.rainPast48hIn).toBeNull();
  const missingFuture = [...zeros]; missingFuture[73] = null;
  expect((await fetchPayload(missingFuture)).expected.rainWindowIn).toBeNull();
});

test('NOAA can inherit a complete preceding night without replacing its forecast', () => {
  const { blendNoaaWeatherWithFallback } = require('../src/utils/weather-data');
  const night = { complete: true, minTempF: 25, freezingHours: 6, freezingDegreeHours: 30 };
  const result = blendNoaaWeatherWithFallback({ ...weather, precedingNight: { complete: false } }, { ...weather, temp: 99, precedingNight: night });
  expect(result.weatherData.temp).toBe(weather.temp);
  expect(result.weatherData.precedingNight).toEqual(night);
  expect(result.supplementedFields).toContain('precedingNight');
});

test('forecast snowfall is not paired with a no-snow melt/freeze summary', () => {
  const result = deriveTerrainCondition({ ...weather, temp: 25 }, null, { ...rain, expected: { rainWindowIn: 0, snowWindowIn: 2 } }, options);
  expect(result.outlook.coverage).toBe('snow_signal');
  expect(result.snowProfile.meltFreeze.phase).not.toBe('no_snow');
});

test('partial-hour travel intervals report rounded wet hours', () => {
  const rainy = { ...weather, description: 'Rain', precipChance: 80,
    trend: weather.trend.map((p) => ({ ...p, temp: 50, precipChance: 80, condition: 'Rain' })) };
  const result = deriveTerrainCondition(rainy, null, rain, { selectedStartClock: '08:17', selectedTravelWindowHours: 4 });
  const wet = result.signals.wetTrendHours;
  expect(wet).toBe(3.7);
  expect(result.reasons.join(' ')).not.toMatch(/\d\.\d{2,} wet/);
});
