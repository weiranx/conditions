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

test.each([null, undefined, '', '   ', false])('missing hourly temperatures (%p) do not become zero', (missing) => {
  const result = calculateSafetyScore({ ...baseSafetyInput(), weatherData: calmWeather({
    trend: calmWeather().trend.map((row) => ({ ...row, temp: missing })),
  }) });
  expect(result.factors.some((factor) => factor.hazard === 'Cold')).toBe(false);
  expect(result.confidence).toBeLessThan(calculateSafetyScore(baseSafetyInput()).confidence);
  expect(result.confidenceReasons.join(' ')).toMatch(/hourly weather coverage/);
});

test.each([null, {}, { description: 'Sunny', trend: Array(8).fill({ temp: null, wind: null, precipChance: null }) }])(
  'weather outages are detected without a special description: %p', (weatherData) => {
    const result = calculateSafetyScore({ ...baseSafetyInput(), weatherData });
    expect(result.factors.some((factor) => factor.hazard === 'Weather Unavailable')).toBe(true);
    expect(result.score).toBeLessThan(85);
    expect(result.confidence).toBeLessThanOrEqual(70);
    expect(result.sourcesUsed).not.toContain('NOAA/NWS hourly forecast');
    expect(result.factors.some((factor) => factor.hazard === 'Cold')).toBe(false);
  },
);

test('missing precipitation throughout the forecast affects score and confidence', () => {
  const result = calculateSafetyScore({ ...baseSafetyInput(), weatherData: calmWeather({
    precipChance: null, trend: calmWeather().trend.map((row) => ({ ...row, precipChance: null })),
  }) });
  expect(result.factors).toEqual(expect.arrayContaining([expect.objectContaining({
    hazard: 'Weather Coverage', message: expect.stringContaining('precipitation'),
  })]));
  expect(result.score).toBeLessThan(calculateSafetyScore(baseSafetyInput()).score);
  expect(result.confidence).toBeLessThan(calculateSafetyScore(baseSafetyInput()).confidence);
});

test('complete short outings have full coverage while truncated long outings lose confidence', () => {
  const weatherData = calmWeather({ trend: calmWeather().trend.slice(0, 4) });
  const short = calculateSafetyScore({ ...baseSafetyInput(), weatherData, selectedTravelWindowHours: 4 });
  const long = calculateSafetyScore({ ...baseSafetyInput(), weatherData, selectedTravelWindowHours: 12 });
  expect(short.confidence).toBe(100);
  expect(long.confidence).toBeLessThan(short.confidence);
  expect(long.confidenceReasons.join(' ')).toMatch(/4\/12/);
});

test.each([null, 0, 9])('late sustained wind remains decisive with gust reading %p', (gust) => {
  const result = calculateSafetyScore({ ...baseSafetyInput(), weatherData: calmWeather({
    trend: calmWeather().trend.map((row, i) => i === 7 ? { ...row, wind: 40, gust } : row),
  }) });
  expect(result.score).toBeLessThanOrEqual(69);
  expect(result.factors).toEqual(expect.arrayContaining([expect.objectContaining({ hazard: 'Wind', impact: 20 })]));
});

test.each(['Thunderstorms', 'Chance Thunderstorms', 'T-Storms', 'Lightning'])('one late %s hour is not hidden by a sunny summary', (condition) => {
  const result = calculateSafetyScore({ ...baseSafetyInput(), weatherData: calmWeather({
    trend: calmWeather().trend.map((row, i) => i === 7 ? { ...row, condition } : row),
  }) });
  expect(result.score).toBeLessThanOrEqual(69);
  expect(result.factors.some((factor) => factor.hazard === 'Storm')).toBe(true);
});

test('an hourly blizzard enforces the High floor', () => {
  const result = calculateSafetyScore({ ...baseSafetyInput(), weatherData: calmWeather({
    trend: calmWeather().trend.map((row, i) => i === 7 ? { ...row, condition: 'Blizzard' } : row),
  }) });
  expect(result.score).toBeLessThanOrEqual(54);
  expect(result.groupImpacts.weather.floorReason).toMatch(/Blizzard/);
  expect(result.factors.some((factor) => factor.hazard === 'Winter Weather')).toBe(true);
});

test('hazards after the selected travel window do not affect the score', () => {
  const weatherData = calmWeather({ trend: [
    ...calmWeather().trend,
    { temp: -20, wind: 60, gust: 80, precipChance: 100, condition: 'Blizzard and Thunderstorms' },
  ] });
  const result = calculateSafetyScore({ ...baseSafetyInput(), weatherData });
  const baseline = calculateSafetyScore(baseSafetyInput());
  expect(result.score).toBe(baseline.score);
  expect(result.confidence).toBe(baseline.confidence);
  expect(result.factors).toEqual(baseline.factors);
});

test('numeric wind precision and range upper bounds are preserved', () => {
  const scoreWithWind = (windSpeed) => calculateSafetyScore({ ...baseSafetyInput(), weatherData: calmWeather({ windSpeed }) });
  expect(scoreWithWind(21.1).score).toBeGreaterThan(scoreWithWind(21.9).score);
  expect(scoreWithWind('20 to 40 mph').score).toBe(scoreWithWind(40).score);
});

test.each([null, undefined])('omitted travel window (%p) retains the twelve-hour default', (selectedTravelWindowHours) => {
  const weatherData = calmWeather({ trend: Array.from({ length: 12 }, (_, i) => ({
    ...calmWeather().trend[0], wind: i === 11 ? 40 : 5,
  })) });
  const result = calculateSafetyScore({ ...baseSafetyInput(), weatherData, selectedTravelWindowHours });
  expect(result.score).toBeLessThanOrEqual(69);
  expect(result.confidence).toBe(100);
});

test.each([{ precipChance: 90 }, { temp: 0, feelsLike: -15 }])('calm trend does not erase hazardous start conditions: %p', (overrides) => {
  const result = calculateSafetyScore({ ...baseSafetyInput(), weatherData: calmWeather(overrides) });
  expect(result.score).toBeLessThan(calculateSafetyScore(baseSafetyInput()).score);
  expect(result.factors.some((factor) => ['Storm', 'Cold'].includes(factor.hazard))).toBe(true);
});

test.each([{ temp: 0 }, { feelsLike: -15 }])('real hourly cold readings remain hazards: %p', (overrides) => {
  const result = calculateSafetyScore({ ...baseSafetyInput(), weatherData: calmWeather({
    trend: calmWeather().trend.map((row) => ({ ...row, ...overrides })),
  }) });
  expect(result.factors.some((factor) => factor.hazard === 'Cold')).toBe(true);
});

test('null snow measurements cannot reduce avalanche uncertainty as minimal snowpack', () => {
  const input = { ...baseSafetyInput(), avalancheData: { relevant: true, dangerUnknown: true } };
  const absent = calculateSafetyScore(input);
  const nulls = calculateSafetyScore({ ...input, snowpackData: { snotel: { snowDepthIn: null, sweIn: null } } });
  expect(nulls.score).toBe(absent.score);
  expect(nulls.explanations.join(' ')).not.toMatch(/snowpack is minimal/);
});

test('null station readings do not create forecast discrepancies', () => {
  const result = calculateSafetyScore({ ...baseSafetyInput(),
    localConditionsData: { weatherObservation: { available: true, tempF: null, windMph: null } },
  });
  expect(result.confidenceReasons.join(' ')).not.toMatch(/Nearby station/);
});

test('missing AQI reduces confidence while measured zero remains valid', () => {
  const missing = calculateSafetyScore({ ...baseSafetyInput(), airQualityData: { status: 'ok', usAqi: null } });
  const zero = calculateSafetyScore({ ...baseSafetyInput(), airQualityData: { status: 'ok', usAqi: 0 } });
  expect(missing.confidence).toBeLessThan(zero.confidence);
  expect(missing.confidenceReasons.join(' ')).toMatch(/Air quality point data unavailable/);
});

test('missing first-half readings do not invent a deteriorating trajectory', () => {
  const result = calculateSafetyScore({ ...baseSafetyInput(), weatherData: calmWeather({
    trend: calmWeather().trend.map((row, i) => ({ ...row,
      wind: i < 4 ? null : 22, gust: i < 4 ? null : 30, precipChance: i < 4 ? null : 60,
    })),
  }) });
  expect(result.factors.some((factor) => factor.hazard === 'Condition Trajectory')).toBe(false);
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
