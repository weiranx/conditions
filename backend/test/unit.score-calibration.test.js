'use strict';

const { calculateSafetyScore } = require('../src/utils/safety-score');
const { calculatePleasantnessScore } = require('../src/utils/pleasantness-score');

const now = () => new Date().toISOString();

const calmWeather = (overrides = {}) => ({
  description: 'Sunny',
  windSpeed: 5,
  windGust: 9,
  precipChance: 5,
  humidity: 35,
  temp: 58,
  feelsLike: 58,
  isDaytime: true,
  issuedTime: now(),
  visibilityRisk: { score: 0 },
  trend: Array.from({ length: 8 }, () => ({
    temp: 58,
    wind: 5,
    gust: 9,
    precipChance: 5,
    cloudCover: 10,
    isDaytime: true,
    condition: 'Sunny',
  })),
  ...overrides,
});

const baseSafetyInput = () => ({
  weatherData: calmWeather(),
  avalancheData: { relevant: false, dangerUnknown: false, coverageStatus: 'no_center_coverage' },
  alertsData: { status: 'none', activeCount: 0, alerts: [] },
  airQualityData: { status: 'ok', usAqi: 30, category: 'Good' },
  fireRiskData: { status: 'ok', level: 1, source: 'Fire risk synthesis' },
  heatRiskData: { status: 'ok', level: 0, label: 'Low' },
  rainfallData: { status: 'ok', anchorTime: now(), totals: {}, expected: {} },
  selectedDate: now().slice(0, 10),
  selectedStartClock: '08:00',
  selectedTravelWindowHours: 8,
  solarData: { sunrise: '6:00 AM', sunset: '8:00 PM' },
});

test.each([
  [2, 'Moderate', 84, 'Caution'],
  [3, 'Considerable', 69, 'Elevated'],
  [4, 'High', 54, 'High'],
  [5, 'Extreme', 39, 'Extreme'],
])('official avalanche danger %i cannot score better than %s risk', (dangerLevel, risk, maxScore, tier) => {
  const result = calculateSafetyScore({
    ...baseSafetyInput(),
    avalancheData: {
      relevant: true,
      dangerUnknown: false,
      dangerLevel,
      risk,
      problems: [],
      publishedTime: now(),
    },
  });

  expect(result.score).toBeLessThanOrEqual(maxScore);
  expect(result.tier).toBe(tier);
  expect(result.groupImpacts.avalanche.floor).toBeGreaterThan(0);
});

test('a blizzard cannot remain below the High-risk tier', () => {
  const result = calculateSafetyScore({
    ...baseSafetyInput(),
    weatherData: calmWeather({
      description: 'Blizzard',
      windSpeed: 40,
      windGust: 55,
      precipChance: 85,
      temp: 15,
      feelsLike: -5,
      visibilityRisk: { score: 90, level: 'Extreme' },
      trend: Array.from({ length: 8 }, () => ({
        temp: 15, wind: 40, gust: 55, precipChance: 85, cloudCover: 100, isDaytime: true, condition: 'Blizzard',
      })),
    }),
  });

  expect(result.score).toBeLessThanOrEqual(54);
  expect(['High', 'Extreme']).toContain(result.tier);
});

test('compounding wind and precipitation cannot remain Low risk', () => {
  const result = calculateSafetyScore({
    ...baseSafetyInput(),
    weatherData: calmWeather({
      description: 'Cloudy',
      windSpeed: 18,
      windGust: 25,
      precipChance: 40,
      trend: Array.from({ length: 8 }, () => ({
        temp: 50, wind: 18, gust: 25, precipChance: 40, cloudCover: 90, isDaytime: true, condition: 'Cloudy',
      })),
    }),
  });

  expect(result.score).toBeLessThanOrEqual(84);
  expect(result.tier).toBe('Caution');
});

test('severe official alerts and very unhealthy air quality enforce decisive floors', () => {
  const severeAlert = calculateSafetyScore({
    ...baseSafetyInput(),
    alertsData: { status: 'ok', activeCount: 1, highestSeverity: 'severe', alerts: [{ event: 'Severe Weather Warning' }] },
  });
  const unhealthyAir = calculateSafetyScore({
    ...baseSafetyInput(),
    airQualityData: { status: 'ok', usAqi: 220, category: 'Very Unhealthy' },
  });

  expect(severeAlert.score).toBeLessThanOrEqual(54);
  expect(severeAlert.tier).toBe('High');
  expect(unhealthyAir.score).toBeLessThanOrEqual(54);
  expect(unhealthyAir.tier).toBe('High');
});

test('comfort remains Excellent for a complete ideal forecast', () => {
  const result = calculatePleasantnessScore({
    weatherData: calmWeather(),
    airQualityData: { status: 'ok', usAqi: 30, category: 'Good' },
    selectedTravelWindowHours: 8,
  });

  expect(result.score).toBeGreaterThanOrEqual(90);
  expect(result.label).toBe('Excellent');
});

test('one explicit thunderstorm hour prevents a Pleasant comfort label', () => {
  const idealTrend = calmWeather().trend;
  const result = calculatePleasantnessScore({
    weatherData: calmWeather({
      description: 'Mostly Sunny, then Thunderstorms',
      trend: [
        ...idealTrend.slice(0, 7),
        { temp: 58, wind: 30, gust: 50, precipChance: 90, cloudCover: 100, isDaytime: true, condition: 'Thunderstorms' },
      ],
    }),
    airQualityData: { status: 'ok', usAqi: 30, category: 'Good' },
    selectedTravelWindowHours: 8,
  });

  expect(result.score).toBeLessThanOrEqual(59);
  expect(result.label).toBe('Uncomfortable');
});

test('comfort is Unknown when two core forecast dimensions are missing', () => {
  const result = calculatePleasantnessScore({
    weatherData: calmWeather({
      windSpeed: null,
      windGust: null,
      precipChance: null,
      trend: Array.from({ length: 8 }, () => ({
        temp: 58, wind: null, gust: null, precipChance: null, cloudCover: 10, isDaytime: true, condition: 'Sunny',
      })),
    }),
    airQualityData: { status: 'ok', usAqi: 30, category: 'Good' },
    selectedTravelWindowHours: 8,
  });

  expect(result).toMatchObject({ score: null, confidence: 0, label: 'Unknown' });
});
