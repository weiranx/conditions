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
