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

test('disabled avalanche scoring excludes avalanche factors, floors, and confidence penalties', () => {
  const avalancheData = {
    relevant: true,
    dangerUnknown: false,
    dangerLevel: 5,
    risk: 'Extreme',
    problems: [{ name: 'Deep Persistent Slab' }],
    publishedTime: new Date(Date.now() - 96 * 60 * 60 * 1000).toISOString(),
  };
  const enabled = calculateSafetyScore({ ...baseSafetyInput(), avalancheData });
  const disabled = calculateSafetyScore({
    ...baseSafetyInput(),
    avalancheData,
    scoreFeatures: { avalancheDetails: false },
  });
  const legacyDisabled = calculateSafetyScore({ ...baseSafetyInput(), avalancheData, includeAvalanche: false });

  expect(enabled.groupImpacts.avalanche).toBeDefined();
  expect(disabled.groupImpacts.avalanche).toBeUndefined();
  expect(disabled.factors.some((factor) => factor.group === 'avalanche')).toBe(false);
  expect(disabled.sourcesUsed).not.toContain('Avalanche center forecast');
  expect(disabled.confidenceReasons.some((reason) => /avalanche/iu.test(reason))).toBe(false);
  expect(disabled.score).toBeGreaterThan(enabled.score);
  expect(legacyDisabled.score).toBe(disabled.score);
});

test.each([
  {
    flag: 'airQualityDetails',
    hazard: 'Air Quality',
    overrides: { airQualityData: { status: 'ok', usAqi: 220, category: 'Very Unhealthy' } },
  },
  {
    flag: 'fireRiskDetails',
    hazard: 'Fire Danger',
    overrides: { fireRiskData: { status: 'ok', level: 4, source: 'Fire risk synthesis' } },
  },
  {
    flag: 'heatRiskDetails',
    hazard: 'Heat',
    overrides: { heatRiskData: { status: 'ok', level: 4, label: 'Extreme', source: 'Heat risk synthesis' } },
  },
  {
    flag: 'snowpackDetails',
    hazard: 'Snowpack',
    overrides: {
      snowpackData: {
        source: 'Snowpack synthesis',
        snotel: { snowDepthIn: 80, sweIn: 24 },
        historical: { overall: { status: 'above_average', percentOfAverage: 160 } },
      },
    },
  },
  {
    flag: 'daylightTimeline',
    hazard: 'Darkness',
    overrides: {
      weatherData: calmWeather({ isDaytime: false }),
      selectedStartClock: '22:00',
    },
  },
  {
    flag: 'weatherContextDetails',
    hazard: 'Visibility',
    overrides: {
      weatherData: calmWeather({ visibilityRisk: { score: 90, level: 'Extreme', activeHours: 8 } }),
    },
  },
])('$flag removes its $hazard factor from the safety score when disabled', ({ flag, hazard, overrides }) => {
  const input = { ...baseSafetyInput(), ...overrides };
  const enabled = calculateSafetyScore(input);
  const disabled = calculateSafetyScore({ ...input, scoreFeatures: { [flag]: false } });

  expect(enabled.factors.some((factor) => factor.hazard === hazard)).toBe(true);
  expect(disabled.factors.some((factor) => factor.hazard === hazard)).toBe(false);
  expect(disabled.score).toBeGreaterThan(enabled.score);
});

test('field-observation flag removes observation factors and confidence penalties', () => {
  const input = {
    ...baseSafetyInput(),
    localConditionsData: {
      radar: { rain24hIn: 1.2, source: 'NWS RFC QPE' },
      streamflow: {
        dischargeCfs: 100,
        forecast: { peakFlowCfs: 200, source: 'NOAA NWPS' },
      },
      weatherObservation: { available: true, tempF: 90, windMph: 45 },
    },
  };
  const enabled = calculateSafetyScore(input);
  const disabled = calculateSafetyScore({ ...input, scoreFeatures: { fieldObservations: false } });

  expect(enabled.factors.some((factor) => factor.hazard === 'Stream Crossing')).toBe(true);
  expect(enabled.factors.some((factor) => factor.source === 'NWS RFC QPE')).toBe(true);
  expect(disabled.factors.some((factor) => factor.hazard === 'Stream Crossing')).toBe(false);
  expect(disabled.factors.some((factor) => factor.source === 'NWS RFC QPE')).toBe(false);
  expect(enabled.confidenceReasons.some((reason) => /nearby station/iu.test(reason))).toBe(true);
  expect(disabled.confidenceReasons.some((reason) => /nearby station/iu.test(reason))).toBe(false);
  expect(disabled.score).toBeGreaterThan(enabled.score);
  expect(disabled.confidence).toBeGreaterThan(enabled.confidence);
});

test('wind-loading flag removes only the avalanche wind-loading compound factor', () => {
  const input = {
    ...baseSafetyInput(),
    avalancheData: {
      relevant: true,
      dangerUnknown: false,
      dangerLevel: 3,
      risk: 'Considerable',
      problems: [],
      publishedTime: now(),
    },
    weatherData: calmWeather({
      windSpeed: 25,
      windGust: 40,
      trend: Array.from({ length: 8 }, () => ({
        temp: 45, wind: 25, gust: 40, precipChance: 5, cloudCover: 20, isDaytime: true, condition: 'Partly Cloudy',
      })),
    }),
  };
  const enabled = calculateSafetyScore(input);
  const disabled = calculateSafetyScore({ ...input, scoreFeatures: { windLoadingDetails: false } });

  expect(enabled.factors.some((factor) => factor.hazard === 'Avalanche Wind Loading')).toBe(true);
  expect(disabled.factors.some((factor) => factor.hazard === 'Avalanche Wind Loading')).toBe(false);
  expect(disabled.factors.some((factor) => factor.hazard === 'Avalanche')).toBe(true);
  expect(disabled.factors.some((factor) => factor.hazard === 'Wind')).toBe(true);
  expect(disabled.groupImpacts.avalanche.raw).toBeLessThan(enabled.groupImpacts.avalanche.raw);
  expect(disabled.score).toBeGreaterThanOrEqual(enabled.score);
});

test('disabled external risk features remove their confidence and source attribution', () => {
  const input = {
    ...baseSafetyInput(),
    airQualityData: { status: 'unavailable' },
    fireRiskData: { status: 'unavailable' },
    heatRiskData: { status: 'ok', level: 2, source: 'Heat risk synthesis' },
  };
  const enabled = calculateSafetyScore(input);
  const disabled = calculateSafetyScore({
    ...input,
    scoreFeatures: {
      airQualityDetails: false,
      fireRiskDetails: false,
      heatRiskDetails: false,
    },
  });

  expect(enabled.confidenceReasons.some((reason) => /air quality/iu.test(reason))).toBe(true);
  expect(enabled.confidenceReasons.some((reason) => /fire risk/iu.test(reason))).toBe(true);
  expect(disabled.confidenceReasons.some((reason) => /air quality|fire risk/iu.test(reason))).toBe(false);
  expect(enabled.sourcesUsed).toContain('Heat risk synthesis (forecast + lower-terrain adjustment)');
  expect(disabled.sourcesUsed.some((source) => /air quality|fire risk|heat risk/iu.test(source))).toBe(false);
  expect(disabled.confidence).toBeGreaterThan(enabled.confidence);
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

test.each([
  {
    label: 'sustained wind',
    safer: { weatherData: calmWeather({ windSpeed: 20 }) },
    riskier: { weatherData: calmWeather({ windSpeed: 22 }) },
  },
  {
    label: 'precipitation chance',
    safer: {
      weatherData: calmWeather({
        trend: [
          { temp: 58, wind: 5, gust: 9, precipChance: 45, condition: 'Chance Rain' },
          ...calmWeather().trend.slice(1),
        ],
      }),
    },
    riskier: {
      weatherData: calmWeather({
        trend: [
          { temp: 58, wind: 5, gust: 9, precipChance: 55, condition: 'Chance Rain' },
          ...calmWeather().trend.slice(1),
        ],
      }),
    },
  },
  {
    label: 'visibility risk',
    safer: { weatherData: calmWeather({ visibilityRisk: { score: 45, level: 'Elevated' } }) },
    riskier: { weatherData: calmWeather({ visibilityRisk: { score: 55, level: 'High' } }) },
  },
  {
    label: 'apparent temperature',
    safer: { weatherData: calmWeather({ temp: 20, feelsLike: 20, trend: calmWeather().trend.map((row) => ({ ...row, temp: 20 })) }) },
    riskier: { weatherData: calmWeather({ temp: 18, feelsLike: 18, trend: calmWeather().trend.map((row) => ({ ...row, temp: 18 })) }) },
  },
  {
    label: 'air quality',
    safer: { airQualityData: { status: 'ok', usAqi: 70, category: 'Moderate' } },
    riskier: { airQualityData: { status: 'ok', usAqi: 90, category: 'Moderate' } },
  },
])('nearby $label inputs produce distinct, monotonic scores', ({ safer, riskier }) => {
  const saferResult = calculateSafetyScore({ ...baseSafetyInput(), ...safer });
  const riskierResult = calculateSafetyScore({ ...baseSafetyInput(), ...riskier });

  expect(saferResult.score).toBeGreaterThan(riskierResult.score);
  expect(saferResult.score - riskierResult.score).toBeLessThan(10);
});

test('the model retains fractional precision between display-level integer boundaries', () => {
  const result = calculateSafetyScore({
    ...baseSafetyInput(),
    weatherData: calmWeather({ windSpeed: 21 }),
  });

  expect(Number.isInteger(result.score)).toBe(false);
  expect(result.score).toBe(Number(result.score.toFixed(1)));
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
