const {
  buildContingencyAssessment,
  classifyOvernightSeverity,
  isWinterTerrain,
  resolveDelayBufferHours,
} = require('../src/utils/contingency');
const { calculateSafetyScore } = require('../src/utils/safety-score');
const { buildLayeringGearSuggestions } = require('../src/utils/gear-suggestions');
const { sanitizeReportForFeatureFlags } = require('../src/utils/report-feature-filter');
const { createWeatherDataService } = require('../src/utils/weather-data');
const { fetchWeatherPipeline } = require('../src/utils/weather-pipeline');

const HOUR = 3600000;
const OFFSET = '-07:00';

// Local wall clock (hours from midnight 2026-09-23) -> ISO with a fixed offset.
const isoAt = (hour) => {
  const base = Date.parse(`2026-09-23T00:00:00${OFFSET}`) + hour * HOUR;
  const local = new Date(base - 7 * HOUR).toISOString().slice(0, 19);
  return `${local}${OFFSET}`;
};

// Sunrise 07:00, sunset 19:00 on every day of the fixture.
const isDaytimeAt = (hour) => {
  const h = ((hour % 24) + 24) % 24;
  return h >= 7 && h < 19;
};

const buildRows = (fromHour, count, overrides = () => ({})) => Array.from({ length: count }, (_, i) => {
  const hour = fromHour + i;
  return {
    time: `${hour}:00`,
    timeIso: isoAt(hour),
    endTimeIso: isoAt(hour + 1),
    temp: 55,
    wind: 5,
    gust: 10,
    precipChance: 5,
    condition: 'Sunny',
    isDaytime: isDaytimeAt(hour),
    ...overrides(hour),
  };
});

const weatherFor = ({ startHour = 8, windowHours = 8, overrides } = {}) => ({
  description: 'Sunny',
  temp: 55,
  feelsLike: 55,
  windSpeed: 5,
  windGust: 10,
  precipChance: 5,
  humidity: 30,
  isDaytime: true,
  forecastStartTime: isoAt(startHour),
  trend: buildRows(startHour, windowHours, overrides),
  afterWindowTrend: buildRows(startHour + windowHours, 30, overrides),
});

describe('delay buffer', () => {
  test('buffer is a quarter of the trip, clamped to 2-6 h', () => {
    expect(resolveDelayBufferHours(4)).toBe(2);
    expect(resolveDelayBufferHours(12)).toBe(3);
    expect(resolveDelayBufferHours(24)).toBe(6);
  });

  test('flags a thunderstorm that starts after the planned return', () => {
    const weatherData = weatherFor({
      overrides: (hour) => (hour === 17 ? { condition: 'Chance Thunderstorms', precipChance: 40 } : {}),
    });
    const result = buildContingencyAssessment({ weatherData, selectedStartTime: isoAt(8), selectedTravelWindowHours: 8 });
    expect(result.status).toBe('ok');
    expect(result.plannedReturnIso).toBe(new Date(Date.parse(isoAt(16))).toISOString());
    expect(result.delayBuffer).toMatchObject({ hours: 2, coveredHours: 2, complete: true });
    expect(result.delayBuffer.onsetHazards).toEqual([
      expect.objectContaining({ key: 'storm', hoursAfterReturn: 1 }),
    ]);
    expect(result.delayBuffer.summary).toMatch(/thunderstorms from about 1 h after/i);
  });

  test('a hazard already inside the trip window is not a new onset', () => {
    const weatherData = weatherFor({
      overrides: (hour) => (hour === 12 || hour === 17 ? { condition: 'Thunderstorms' } : {}),
    });
    const result = buildContingencyAssessment({ weatherData, selectedStartTime: isoAt(8), selectedTravelWindowHours: 8 });
    expect(result.delayBuffer.onsetHazards).toEqual([]);
  });

  test('reports nightfall inside the buffer when the trip ends in daylight', () => {
    const weatherData = weatherFor({ startHour: 9, windowHours: 9 });
    const result = buildContingencyAssessment({ weatherData, selectedStartTime: isoAt(9), selectedTravelWindowHours: 9 });
    // Return 18:00, buffer 3 h, dark from 19:00.
    expect(result.delayBuffer.nightfall).toEqual(expect.objectContaining({ hoursAfterReturn: 1 }));
  });

  test('unavailable without a start time or trend', () => {
    expect(buildContingencyAssessment({ weatherData: { trend: [] }, selectedStartTime: null }).status).toBe('unavailable');
  });
});

describe('overnight scenario', () => {
  test('describes the first night after return and why it matters', () => {
    const weatherData = weatherFor({
      startHour: 8,
      windowHours: 10,
      overrides: (hour) => (isDaytimeAt(hour) ? {} : { temp: 30, wind: 15, gust: 25, precipChance: 60, condition: 'Rain And Snow' }),
    });
    const { overnight } = buildContingencyAssessment({
      weatherData,
      selectedStartTime: isoAt(8),
      selectedTravelWindowHours: 10,
      winterTerrain: true,
    });
    expect(overnight).toMatchObject({
      status: 'ok',
      relevant: true,
      complete: true,
      hoursToDark: 1,
      lowTempF: 30,
      peakPrecipChance: 60,
      snow: true,
      severity: 'high',
    });
    expect(overnight.coveredHours).toBe(12);
    expect(overnight.reasonCodes).toEqual(['longDay', 'nearDark', 'coldNight', 'winterTerrain']);
    expect(overnight.summary).toMatch(/unplanned night would be serious/i);
  });

  test('a short warm day is computed but not flagged as relevant', () => {
    const weatherData = weatherFor({ startHour: 8, windowHours: 4 });
    const { overnight } = buildContingencyAssessment({ weatherData, selectedStartTime: isoAt(8), selectedTravelWindowHours: 4 });
    expect(overnight).toMatchObject({ status: 'ok', relevant: false, severity: 'low', hoursToDark: 7 });
  });

  test('starts at the return when the party is already out after dark', () => {
    const weatherData = weatherFor({ startHour: 14, windowHours: 8 });
    const { overnight } = buildContingencyAssessment({ weatherData, selectedStartTime: isoAt(14), selectedTravelWindowHours: 8 });
    expect(overnight).toMatchObject({ hoursToDark: 0, relevant: true });
    expect(overnight.reasonCodes).toContain('nearDark');
  });

  test('marks the night incomplete when the forecast ends before sunrise', () => {
    const weatherData = { ...weatherFor({ startHour: 8, windowHours: 10 }), afterWindowTrend: buildRows(18, 6) };
    const { overnight } = buildContingencyAssessment({ weatherData, selectedStartTime: isoAt(8), selectedTravelWindowHours: 10 });
    expect(overnight).toMatchObject({ status: 'ok', complete: false });
  });

  test('severity ladder', () => {
    expect(classifyOvernightSeverity({ minFeelsLikeF: 50, peakGustMph: 10, peakPrecipChance: 10 })).toBe('low');
    expect(classifyOvernightSeverity({ minFeelsLikeF: 30, peakGustMph: 10, peakPrecipChance: 10 })).toBe('moderate');
    expect(classifyOvernightSeverity({ minFeelsLikeF: 38, peakGustMph: 10, peakPrecipChance: 70 })).toBe('high');
    expect(classifyOvernightSeverity({ minFeelsLikeF: 8, peakGustMph: 0, peakPrecipChance: 0 })).toBe('high');
    expect(classifyOvernightSeverity({ minFeelsLikeF: 55, freezingRain: true })).toBe('high');
  });

  test('winter terrain from avalanche relevance or snow depth', () => {
    expect(isWinterTerrain({ avalancheData: { relevant: true } })).toBe(true);
    expect(isWinterTerrain({ snowpackData: { snotel: { snowDepthIn: 12 } } })).toBe(true);
    expect(isWinterTerrain({ avalancheData: { relevant: false }, snowpackData: { snotel: { snowDepthIn: 2 } } })).toBe(false);
  });
});

describe('sunset, not the forecast period flag, sets darkness', () => {
  // NOAA flags hours from 6 PM as night whatever the season.
  const noaaFlags = (hour) => ({ isDaytime: (((hour % 24) + 24) % 24) >= 6 && (((hour % 24) + 24) % 24) < 18 });
  const noaaWeather = (options) => ({ ...weatherFor({ ...options, overrides: noaaFlags }), timezone: 'America/Los_Angeles' });
  const september = { sunrise: '6:43:42 AM', sunset: '7:13:19 PM' };
  const december = { sunrise: '7:14:00 AM', sunset: '4:41:00 PM' };

  test('a September evening stays light past 6 PM', () => {
    const weatherData = noaaWeather({ startHour: 8, windowHours: 9 });
    const assess = (solarData) => buildContingencyAssessment({ weatherData, selectedStartTime: isoAt(8), selectedTravelWindowHours: 9, solarData });
    // Without sun times the 6 PM flag reads as dark an hour after the 5 PM return.
    expect(assess(null).delayBuffer.nightfall).toMatchObject({ hoursAfterReturn: 1 });
    const { delayBuffer, overnight } = assess(september);
    expect(delayBuffer.nightfall).toEqual({ onsetIso: new Date(Date.parse(isoAt(19)) + 13 * 60000).toISOString(), hoursAfterReturn: 2.2 });
    expect(overnight).toMatchObject({
      hoursToDark: 2.2,
      startIso: new Date(Date.parse(isoAt(19)) + 13 * 60000).toISOString(),
      endIso: new Date(Date.parse(isoAt(30)) + 43 * 60000).toISOString(),
      complete: true,
    });
    expect(overnight.coveredHours).toBe(11.5);
  });

  test('a December afternoon is dark before the 6 PM flag', () => {
    const weatherData = noaaWeather({ startHour: 8, windowHours: 8 });
    const assess = (solarData) => buildContingencyAssessment({ weatherData, selectedStartTime: isoAt(8), selectedTravelWindowHours: 8, solarData });
    // The flag misses dusk inside the 2 h buffer after a 4 PM return.
    expect(assess(null).delayBuffer.nightfall).toBeNull();
    const { delayBuffer, overnight } = assess(december);
    expect(delayBuffer.nightfall).toMatchObject({ hoursAfterReturn: 0.7 });
    expect(delayBuffer.summary).toMatch(/darkness from about 0.7 h after your planned return/);
    expect(overnight).toMatchObject({ hoursToDark: 0.7 });
    expect(overnight.reasonCodes).toContain('nearDark');
  });

  test('a return after sunset starts the night at the return', () => {
    const weatherData = noaaWeather({ startHour: 12, windowHours: 8 });
    const { delayBuffer, overnight } = buildContingencyAssessment({ weatherData, selectedStartTime: isoAt(12), selectedTravelWindowHours: 8, solarData: september });
    expect(delayBuffer.nightfall).toBeNull();
    expect(overnight).toMatchObject({ hoursToDark: 0, startIso: new Date(Date.parse(isoAt(20))).toISOString() });
  });

  test('falls back to the forecast flags without a time zone', () => {
    const weatherData = { ...noaaWeather({ startHour: 8, windowHours: 9 }), timezone: null };
    const { delayBuffer } = buildContingencyAssessment({ weatherData, selectedStartTime: isoAt(8), selectedTravelWindowHours: 9, solarData: september });
    expect(delayBuffer.nightfall).toMatchObject({ hoursAfterReturn: 1 });
  });
});

describe('score, gear, and feature flag integration', () => {
  const stormAfterReturn = () => {
    const weatherData = weatherFor({
      overrides: (hour) => (hour === 16 ? { condition: 'Thunderstorms', precipChance: 70 } : {}),
    });
    return {
      weatherData,
      contingencyData: buildContingencyAssessment({ weatherData, selectedStartTime: isoAt(8), selectedTravelWindowHours: 8 }),
    };
  };
  const scoreArgs = (weatherData) => ({
    weatherData,
    avalancheData: { relevant: false, risk: 'Not applicable' },
    alertsData: { status: 'none', activeCount: 0, alerts: [] },
    airQualityData: { usAqi: 20, category: 'Good', status: 'ok' },
    selectedDate: '2026-09-23',
    selectedStartTime: isoAt(8),
    selectedTravelWindowHours: 8,
  });

  test('a storm right after the return costs a small Delay Margin factor', () => {
    const { weatherData, contingencyData } = stormAfterReturn();
    const withMargin = calculateSafetyScore({ ...scoreArgs(weatherData), contingencyData });
    const without = calculateSafetyScore(scoreArgs(weatherData));
    const factor = withMargin.factors.find((item) => item.hazard === 'Delay Margin');
    // Thunderstorm (5) + likely precipitation (+1), onset at the return.
    expect(factor).toMatchObject({ impact: 6, group: 'weather' });
    expect(factor.message).toMatch(/thunderstorms right at your planned return/i);
    expect(without.factors.some((item) => item.hazard === 'Delay Margin')).toBe(false);
    expect(withMargin.score).toBeLessThan(without.score);
  });

  test('a late onset in the buffer is discounted', () => {
    const weatherData = weatherFor({
      windowHours: 12,
      overrides: (hour) => (hour === 22 ? { condition: 'Thunderstorms' } : {}),
    });
    const contingencyData = buildContingencyAssessment({ weatherData, selectedStartTime: isoAt(8), selectedTravelWindowHours: 12 });
    const analysis = calculateSafetyScore({ ...scoreArgs(weatherData), selectedTravelWindowHours: 12, contingencyData });
    // Buffer 3 h, storm at +2 h: 5 * 0.6 = 3.
    expect(analysis.factors.find((item) => item.hazard === 'Delay Margin')).toMatchObject({ impact: 3 });
  });

  test('the contingencyPlanning flag turns the factor off', () => {
    const { weatherData, contingencyData } = stormAfterReturn();
    const analysis = calculateSafetyScore({
      ...scoreArgs(weatherData),
      contingencyData,
      scoreFeatures: { contingencyPlanning: false },
    });
    expect(analysis.factors.some((item) => item.hazard === 'Delay Margin')).toBe(false);
  });

  test('a cold, wet unplanned night adds insulation and shelter gear', () => {
    const weatherData = weatherFor({
      windowHours: 10,
      overrides: (hour) => (isDaytimeAt(hour) ? {} : { temp: 34, wind: 10, precipChance: 70, condition: 'Rain' }),
    });
    const contingencyData = buildContingencyAssessment({ weatherData, selectedStartTime: isoAt(8), selectedTravelWindowHours: 10 });
    const gear = buildLayeringGearSuggestions({ weatherData, trailStatus: 'Dry', selectedTravelWindowHours: 10, contingencyData });
    const ids = gear.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining(['overnight-insulation', 'emergency-shelter']));
    expect(gear.find((item) => item.id === 'overnight-insulation')).toMatchObject({ tone: 'caution' });

    const disabled = buildLayeringGearSuggestions({
      weatherData,
      trailStatus: 'Dry',
      selectedTravelWindowHours: 10,
      contingencyData,
      scoreFeatures: { contingencyPlanning: false },
    });
    expect(disabled.map((item) => item.id)).not.toEqual(expect.arrayContaining(['overnight-insulation']));
  });

  test('a mild night adds no overnight gear', () => {
    const weatherData = weatherFor({ windowHours: 10 });
    const contingencyData = buildContingencyAssessment({ weatherData, selectedStartTime: isoAt(8), selectedTravelWindowHours: 10 });
    const gear = buildLayeringGearSuggestions({ weatherData, trailStatus: 'Dry', selectedTravelWindowHours: 10, contingencyData });
    expect(gear.map((item) => item.id)).not.toContain('overnight-insulation');
  });

  test('disabling the flag strips the contingency block, factor, and gear from a report', () => {
    const report = {
      featureFlags: {},
      contingency: { status: 'ok', summary: 'x' },
      gear: [{ id: 'overnight-insulation', title: 'Unplanned-night insulation', detail: 'x', category: 'Safety', tone: 'watch' }],
      safety: {
        score: 80,
        factors: [{ hazard: 'Delay Margin', impact: 5, message: 'A late return would run into new hazards', group: 'weather' }],
        explanations: ['A late return would run into new hazards'],
      },
    };
    const filtered = sanitizeReportForFeatureFlags(report, { contingencyPlanning: false });
    expect(filtered.contingency).toBeUndefined();
    expect(filtered.gear).toEqual([]);
    expect(filtered.safety.factors).toEqual([]);
    expect(filtered.safety.explanations).toEqual([]);

    const kept = sanitizeReportForFeatureFlags(report, { contingencyPlanning: true });
    expect(kept.contingency).toEqual(report.contingency);
    expect(kept.safety.factors).toHaveLength(1);
  });
});

describe('weather providers keep rows past the window', () => {
  const cache = () => ({ getOrFetch: (_key, fn) => fn() });

  test('NOAA pipeline returns afterWindowTrend starting at the planned return', async () => {
    const periods = Array.from({ length: 60 }, (_, i) => ({
      startTime: isoAt(i),
      endTime: isoAt(i + 1),
      temperature: 50,
      windSpeed: '5 mph',
      shortForecast: 'Clear',
      isDaytime: isDaytimeAt(i),
      probabilityOfPrecipitation: { value: 0 },
      relativeHumidity: { value: 40 },
    }));
    const fetchWithTimeout = jest.fn(async (url) => ({
      ok: true,
      json: async () => (String(url).includes('/points/')
        ? { properties: { forecastHourly: 'https://api.weather.gov/hourly', elevation: { value: 1000 }, timeZone: 'America/Los_Angeles' } }
        : String(url).includes('sunrisesunset')
          ? { status: 'OK', results: { sunrise: '7:00:00 AM', sunset: '7:00:00 PM', day_length: '12:00:00' } }
          : { properties: { periods, updateTime: isoAt(0) } }),
    }));
    const { weatherData } = await fetchWeatherPipeline({
      parsedLat: 40,
      parsedLon: -111,
      requestedDate: '2026-09-23',
      requestedStartClock: '08:00',
      requestedTravelWindowHours: 6,
      fetchOptions: {},
      noaaPointsCache: cache(),
      noaaForecastCache: cache(),
      solarCache: cache(),
      fetchWithTimeout,
      fetchObjectiveElevationFt: jest.fn(),
      fetchOpenMeteoWeatherFallback: jest.fn(async () => { throw new Error('offline'); }),
      createUnavailableWeatherData: jest.fn(),
    });
    expect(weatherData.trend).toHaveLength(6);
    expect(weatherData.afterWindowTrend).toHaveLength(30);
    expect(weatherData.afterWindowTrend[0].timeIso).toBe(isoAt(14));
  });

  test('Open-Meteo fallback splits window and post-window rows', async () => {
    const times = Array.from({ length: 48 }, (_, i) => `2026-09-23T${String(i % 24).padStart(2, '0')}:00`)
      .map((time, i) => (i < 24 ? time : time.replace('2026-09-23', '2026-09-24')));
    const payload = {
      timezone: 'America/Los_Angeles',
      hourly: {
        time: times,
        temperature_2m: times.map(() => 50),
        wind_speed_10m: times.map(() => 5),
        precipitation_probability: times.map(() => 0),
        weather_code: times.map(() => 0),
        is_day: times.map((_, i) => (isDaytimeAt(i) ? 1 : 0)),
      },
    };
    const service = createWeatherDataService({
      fetchWithTimeout: jest.fn(async () => ({ ok: true, json: async () => payload, headers: { get: () => null } })),
      requestTimeoutMs: 100,
    });
    const { weatherData } = await service.fetchOpenMeteoWeatherFallback({
      lat: 40.1,
      lon: -111.1,
      selectedDate: '2026-09-23',
      startClock: '08:00',
      trendHours: 6,
      fetchOptions: {},
    });
    expect(weatherData.trend).toHaveLength(6);
    expect(weatherData.afterWindowTrend).toHaveLength(30);
    expect(weatherData.afterWindowTrend[0].timeIso).toBe('2026-09-23T14:00:00-07:00');
  });
});
