'use strict';

const { calculatePleasantnessScore, moistureComfortPenalty } = require('../src/utils/pleasantness-score');

const trend = (overrides = {}, length = 8) => Array.from({ length }, () => ({
  temp: 58,
  wind: 5,
  gust: 9,
  precipChance: 5,
  cloudCover: 10,
  isDaytime: true,
  condition: 'Sunny',
  ...overrides,
}));

const idealInput = (overrides = {}) => ({
  weatherData: {
    description: 'Sunny',
    temp: 58,
    feelsLike: 58,
    windSpeed: 5,
    windGust: 9,
    precipChance: 5,
    cloudCover: 10,
    isDaytime: true,
    visibilityRisk: { score: 0 },
    trend: trend(),
    ...overrides,
  },
  airQualityData: { status: 'ok', usAqi: 30, category: 'Good' },
  selectedTravelWindowHours: 8,
});

test('clear, calm, comfortable weather earns an excellent pleasantness score', () => {
  const result = calculatePleasantnessScore(idealInput());

  expect(result.score).toBeGreaterThanOrEqual(90);
  expect(result.label).toBe('Excellent');
  expect(result.confidence).toBe(100);
  expect(result.factors.map((factor) => factor.factor)).toEqual([
    'Wind',
    'Precipitation',
    'Temperature',
    'Views & daylight',
    'Air quality',
  ]);
  expect(result.disclaimer).toMatch(/does not change the safety score/i);
});

test('cold, windy, wet weather is rated harsh with explainable limiters', () => {
  const roughTrend = trend({
    temp: 34,
    wind: 30,
    gust: 48,
    precipChance: 90,
    cloudCover: 100,
    condition: 'Heavy Rain and Windy',
  });
  const result = calculatePleasantnessScore(idealInput({
    description: 'Heavy Rain and Windy',
    temp: 34,
    feelsLike: 20,
    windSpeed: 30,
    windGust: 48,
    precipChance: 90,
    cloudCover: 100,
    visibilityRisk: { score: 70 },
    trend: roughTrend,
  }));

  expect(result.score).toBeLessThan(40);
  expect(result.label).toBe('Harsh');
  expect(result.summary).toMatch(/precipitation|temperature|wind/i);
  expect(result.factors[0].impact).toBeGreaterThan(15);
});

test('one materially uncomfortable component cannot be averaged into Excellent', () => {
  const windy = calculatePleasantnessScore(idealInput({
    windSpeed: 20,
    windGust: 28,
    trend: trend({ wind: 20, gust: 28 }),
  }));

  expect(windy.score).toBeLessThan(90);
  expect(windy.label).not.toBe('Excellent');
  expect(windy.factors.find((factor) => factor.factor === 'Wind').score).toBeLessThan(70);
});

test('warm dew point lowers temperature comfort without becoming a separate factor', () => {
  const dry = calculatePleasantnessScore(idealInput({
    temp: 75,
    feelsLike: 75,
    humidity: 35,
    dewPoint: 45,
    trend: trend({ temp: 75, humidity: 35, dewPoint: 45 }),
  }));
  const muggy = calculatePleasantnessScore(idealInput({
    temp: 75,
    feelsLike: 75,
    humidity: 82,
    dewPoint: 72,
    trend: trend({ temp: 75, humidity: 82, dewPoint: 72 }),
  }));
  const dryTemperature = dry.factors.find((factor) => factor.factor === 'Temperature');
  const muggyTemperature = muggy.factors.find((factor) => factor.factor === 'Temperature');

  expect(muggyTemperature.score).toBe(dryTemperature.score - 6);
  expect(muggyTemperature.message).toMatch(/dew point peaks at 72°F.*up to 6 points/i);
  expect(muggy.score).toBeLessThan(dry.score);
  expect(muggy.factors.some((factor) => factor.factor === 'Humidity')).toBe(false);
});

test('moisture modifier is capped and only applies in warm or damp-cold regimes', () => {
  expect(moistureComfortPenalty({ tempF: 85, humidity: 90, dewPointF: 78, condition: 'Sunny' })).toBe(8);
  expect(moistureComfortPenalty({ tempF: 42, humidity: 97, dewPointF: 41, condition: 'Fog' })).toBe(6);
  expect(moistureComfortPenalty({ tempF: 58, humidity: 98, dewPointF: 57, condition: 'Cloudy' })).toBe(0);
});

test('a slight chance of thunderstorms lowers the outlook without being treated as a certain storm', () => {
  const result = calculatePleasantnessScore(idealInput({
    description: 'Slight Chance Showers And Thunderstorms',
    precipChance: 20,
    cloudCover: 60,
    visibilityRisk: { score: 20 },
    trend: trend({
      precipChance: 20,
      cloudCover: 60,
      condition: 'Slight Chance Showers And Thunderstorms',
    }),
  }));

  expect(result.score).toBeGreaterThanOrEqual(40);
  expect(result.score).toBeLessThan(75);
  expect(result.label).toBe('Mixed');
});

test('poor visibility and unhealthy air quality prevent a Pleasant rating', () => {
  const result = calculatePleasantnessScore({
    ...idealInput({
      description: 'Fog',
      cloudCover: 100,
      visibilityRisk: { score: 85 },
      trend: trend({ condition: 'Fog', cloudCover: 100 }),
    }),
    airQualityData: { status: 'ok', usAqi: 175, category: 'Unhealthy' },
  });

  expect(result.score).toBeLessThan(75);
  expect(result.label).toBe('Mixed');
  expect(result.summary).toMatch(/views.*air quality/i);
});

test('missing optional AQI lowers confidence without fabricating a comfort penalty', () => {
  const result = calculatePleasantnessScore({
    ...idealInput(),
    airQualityData: { status: 'unavailable' },
  });

  expect(result.score).toBeGreaterThanOrEqual(90);
  expect(result.confidence).toBe(95);
  expect(result.factors.some((factor) => factor.factor === 'Air quality')).toBe(false);
});

test('disabled air quality is excluded from comfort without lowering confidence', () => {
  const input = {
    ...idealInput(),
    airQualityData: { status: 'ok', usAqi: 220, category: 'Very Unhealthy' },
  };
  const enabled = calculatePleasantnessScore(input);
  const disabled = calculatePleasantnessScore({
    ...input,
    scoreFeatures: { airQualityDetails: false },
  });

  expect(enabled.factors.some((factor) => factor.factor === 'Air quality')).toBe(true);
  expect(disabled.factors.some((factor) => factor.factor === 'Air quality')).toBe(false);
  expect(disabled.score).toBeGreaterThan(enabled.score);
  expect(disabled.confidence).toBe(100);
});

test('disabled weather context removes visibility-risk weighting from comfort', () => {
  const weatherData = {
    ...idealInput().weatherData,
    visibilityRisk: { score: 90 },
  };
  const enabled = calculatePleasantnessScore({ ...idealInput(), weatherData });
  const disabled = calculatePleasantnessScore({
    ...idealInput(),
    weatherData,
    scoreFeatures: { weatherContextDetails: false },
  });
  const enabledViews = enabled.factors.find((factor) => factor.factor === 'Views & daylight');
  const disabledViews = disabled.factors.find((factor) => factor.factor === 'Views & daylight');

  expect(disabledViews.score).toBeGreaterThan(enabledViews.score);
  expect(disabledViews.message).not.toMatch(/visibility-risk/iu);
  expect(disabled.score).toBeGreaterThan(enabled.score);
});

test('disabled daylight removes nighttime weighting from comfort', () => {
  const weatherData = {
    ...idealInput().weatherData,
    isDaytime: false,
    trend: trend({ isDaytime: false }),
  };
  const enabled = calculatePleasantnessScore({ ...idealInput(), weatherData });
  const disabled = calculatePleasantnessScore({
    ...idealInput(),
    weatherData,
    scoreFeatures: { daylightTimeline: false },
  });
  const enabledViews = enabled.factors.find((factor) => factor.factor === 'Views & daylight');
  const disabledViews = disabled.factors.find((factor) => factor.factor === 'Views & daylight');

  expect(disabledViews.score).toBeGreaterThan(enabledViews.score);
  expect(disabled.score).toBeGreaterThan(enabled.score);
});

test('only hours inside the selected travel window affect pleasantness', () => {
  const fullTrend = [
    ...trend({}, 4),
    ...trend({ temp: 30, wind: 30, gust: 45, precipChance: 95, condition: 'Heavy Rain' }, 4),
  ];
  const weatherData = { ...idealInput().weatherData, trend: fullTrend };
  const shortWindow = calculatePleasantnessScore({ ...idealInput(), weatherData, selectedTravelWindowHours: 4 });
  const fullWindow = calculatePleasantnessScore({ ...idealInput(), weatherData, selectedTravelWindowHours: 8 });

  expect(shortWindow.score).toBeGreaterThan(fullWindow.score);
  expect(shortWindow.label).toBe('Excellent');
});

test('unavailable weather returns an explicit unknown score', () => {
  const result = calculatePleasantnessScore({
    weatherData: {
      description: 'Weather data unavailable',
      temp: null,
      feelsLike: null,
      windSpeed: null,
      windGust: null,
      precipChance: null,
      cloudCover: null,
      trend: [],
      visibilityRisk: { score: null },
    },
    airQualityData: { status: 'unavailable' },
    selectedTravelWindowHours: 8,
  });

  expect(result).toMatchObject({ score: null, confidence: 0, label: 'Unknown', factors: [] });
});

test('supplied hourly feels-like readings drive temperature comfort, including zero', () => {
  const supplied = calculatePleasantnessScore(idealInput({ trend: trend({ feelsLike: 0 }) }));
  const derived = calculatePleasantnessScore(idealInput());
  expect(supplied.factors.find((factor) => factor.factor === 'Temperature')).toMatchObject({ score: 10 });
  expect(supplied.score).toBeLessThan(derived.score);
  expect(supplied.summary).toMatch(/temperature/i);
});

test('omitted and null travel windows retain the twelve-hour default', () => {
  const input = idealInput({ trend: [...trend({}, 8), ...trend({ condition: 'Thunderstorms' }, 4)] });
  delete input.selectedTravelWindowHours;
  for (const selectedTravelWindowHours of [undefined, null, '', '  ']) {
    const result = calculatePleasantnessScore({ ...input, selectedTravelWindowHours });
    expect(result.coverage).toEqual({ requestedHours: 12, completeHours: 12 });
    expect(result.score).toBeLessThanOrEqual(59);
  }
});

test('twelve readings do not count as full coverage for a twenty-four-hour outing', () => {
  const result = calculatePleasantnessScore({ ...idealInput({ trend: trend({}, 12) }), selectedTravelWindowHours: 24 });
  expect(result.coverage).toEqual({ requestedHours: 24, completeHours: 12 });
  expect(result.confidence).toBe(53);
  expect(result.label).toBe('Mixed');
  expect(result.summary).toMatch(/Limited forecast coverage/);
  expect(result.adjustments).toEqual(expect.arrayContaining([expect.objectContaining({ maximumScore: 74 })]));
});

test('empty rows cannot raise confidence or imply comfortable weather for the whole outing', () => {
  const emptyRows = calculatePleasantnessScore(idealInput({ trend: Array(8).fill({}) }));
  const pointOnly = calculatePleasantnessScore(idealInput({ trend: [] }));
  expect(emptyRows.confidence).toBe(pointOnly.confidence);
  expect(emptyRows.confidence).toBeLessThan(25);
  expect(emptyRows.coverage.completeHours).toBe(0);
  expect(emptyRows.confidenceReasons.join(' ')).toMatch(/Only a summary or start-time reading/);
  expect(emptyRows.summary).not.toMatch(/comfortable weather across/);
});

test('one missing core hour lowers confidence and prevents an Excellent rating', () => {
  const result = calculatePleasantnessScore(idealInput({ trend: [...trend({}, 7), ...trend({ wind: null, gust: null }, 1)] }));
  expect(result.coverage.completeHours).toBe(7);
  expect(result.confidence).toBeLessThan(100);
  expect(result.label).toBe('Pleasant');
  expect(result.confidenceReasons).toContain('Wind: hourly readings cover 7 of 8 planned hours.');
});

test.each([null, undefined, '', ' ', false, true, {}, [], NaN, Infinity, '5mph', -5])('invalid wind %p remains missing', (wind) => {
  const result = calculatePleasantnessScore(idealInput({ windSpeed: wind, windGust: wind, trend: trend({ wind, gust: wind }) }));
  expect(result.factors.some((factor) => factor.factor === 'Wind')).toBe(false);
  expect(result.coverage.completeHours).toBe(0);
  expect(result.score).toBeLessThanOrEqual(74);
});

test('genuine zero and numeric string readings remain available', () => {
  const result = calculatePleasantnessScore(idealInput({ trend: trend({ wind: '0', gust: 0, precipChance: 0, feelsLike: '58' }) }));
  expect(result.confidence).toBe(100);
  expect(result.coverage.completeHours).toBe(8);
  expect(result.label).toBe('Excellent');
});

test('fog never earns a higher views score after dark', () => {
  const views = (isDaytime) => calculatePleasantnessScore(idealInput({
    description: 'Fog', visibilityRisk: null, trend: trend({ condition: 'Fog', isDaytime }),
  })).factors.find((factor) => factor.factor === 'Views & daylight').score;
  expect(views(false)).toBeLessThanOrEqual(views(true));
});

test('partly cloudy skies rate above cloudy skies', () => {
  const views = (condition) => calculatePleasantnessScore(idealInput({ trend: trend({ condition }) }))
    .factors.find((factor) => factor.factor === 'Views & daylight').score;
  expect(views('Partly Cloudy')).toBeGreaterThan(views('Cloudy'));
});

test('a low chance of showers is more comfortable than forecast rain', () => {
  const score = (condition, precipChance) => calculatePleasantnessScore(idealInput({ trend: trend({ condition, precipChance }) }));
  const possible = score('Slight Chance Rain Showers', 20);
  const certain = score('Rain Showers', 90);
  expect(possible.score).toBeGreaterThanOrEqual(75);
  expect(possible.score).toBeGreaterThan(certain.score);
});

test('broader summary storms outside a complete hourly window do not override its comfort', () => {
  const result = calculatePleasantnessScore(idealInput({ description: 'Sunny then Thunderstorms' }));
  expect(result.label).toBe('Excellent');
  expect(result.factors.find((factor) => factor.factor === 'Views & daylight').message).not.toMatch(/thunderstorms/i);
});

test('missing gusts are explained without inventing a peak gust measurement', () => {
  const result = calculatePleasantnessScore(idealInput({ windGust: null, trend: trend({ gust: null }) }));
  expect(result.factors.find((factor) => factor.factor === 'Wind').message).toMatch(/gust readings unavailable/);
});

test('normalized factor deductions explain the weighted score when AQI is absent', () => {
  const result = calculatePleasantnessScore({ ...idealInput({ trend: trend({ wind: 20, gust: 28 }) }), airQualityData: null });
  expect(Math.abs(100 - result.factors.reduce((sum, factor) => sum + factor.impact, 0) - result.weightedScore)).toBeLessThan(1);
  expect(result.weightedScore).toBeGreaterThan(result.score);
  expect(result.adjustments).toContainEqual({ maximumScore: 74, reason: 'Wind limits overall comfort to Mixed (74/100).' });
});

const timedRow = (hour, overrides = {}) => ({ ...trend(overrides, 1)[0], timeIso: `2026-09-08T${hour}:00-07:00` });

test('a departure between forecast hours includes the last partial hour and excludes the return boundary', () => {
  const input = {
    ...idealInput({ trend: [timedRow('07:00'), timedRow('08:00'), timedRow('09:00', { condition: 'Thunderstorms' })] }),
    selectedStartTime: '2026-09-08T07:30:00-07:00', selectedTravelWindowHours: 2,
  };
  const result = calculatePleasantnessScore(input);
  expect(result.coverage.completeHours).toBe(2);
  expect(result.score).toBeLessThanOrEqual(59);
  const earlier = calculatePleasantnessScore({ ...input, selectedStartTime: '2026-09-08T07:00:00-07:00' });
  expect(earlier.label).toBe('Excellent');
});

test('partial periods contribute only the hours actually covered', () => {
  const result = calculatePleasantnessScore({
    ...idealInput({ trend: [timedRow('07:00'), timedRow('08:00')] }),
    selectedStartTime: '2026-09-08T07:30:00-07:00', selectedTravelWindowHours: 2,
  });
  expect(result.coverage.completeHours).toBe(1.5);
  expect(result.confidence).toBe(76);
  expect(result.label).toBe('Pleasant');
  expect(result.summary).toMatch(/1.5\/2 complete hours/);
});

test('duplicates and out-of-window readings cannot fill a missing hour', () => {
  const result = calculatePleasantnessScore({
    ...idealInput({ trend: [timedRow('09:00'), timedRow('07:00'), timedRow('07:00'), timedRow('10:00')] }),
    selectedStartTime: '2026-09-08T07:00:00-07:00', selectedTravelWindowHours: 3,
  });
  expect(result.coverage.completeHours).toBe(2);
  expect(result.confidence).toBe(68);
  expect(result.label).toBe('Mixed');
});

test('timed coverage honors UTC offsets across midnight', () => {
  const result = calculatePleasantnessScore({
    ...idealInput({ trend: [
      { ...trend({}, 1)[0], timeIso: '2026-09-09T06:00:00Z' },
      { ...trend({}, 1)[0], timeIso: '2026-09-09T07:00:00Z' },
      { ...trend({ condition: 'Thunderstorms' }, 1)[0], timeIso: '2026-09-09T08:00:00Z' },
    ] }),
    selectedStartTime: '2026-09-08T23:30:00-07:00', selectedTravelWindowHours: 2,
  });
  expect(result.coverage.completeHours).toBe(2);
  expect(result.score).toBeLessThanOrEqual(59);
});
