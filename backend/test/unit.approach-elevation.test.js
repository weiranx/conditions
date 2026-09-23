'use strict';

const {
  parseApproachQuery,
  buildApproachProfile,
  highestElevationBetween,
  isInversionLikely,
  adjustPointToElevation,
  parseSolarClockMinutes,
  resolveApproach,
} = require('../src/utils/approach-elevation');
const { calculatePleasantnessScore } = require('../src/utils/pleasantness-score');

// Same cases as frontend/tests/approach-elevation.test.jsx so both sides agree.
const bands = [
  { label: 'Approach Terrain', elevationFt: 8200, deltaFromObjectiveFt: -2800 },
  { label: 'Objective Elevation', elevationFt: 11000, deltaFromObjectiveFt: 0 },
];
const hour = { temp: 20, wind: 12, gust: 28, precipChance: 10, cloudCover: 90, condition: 'Mostly Cloudy' };

describe('approach query', () => {
  test('reads a typed trailhead, ascent rate and GPX route, ignoring invalid values', () => {
    expect(parseApproachQuery({})).toEqual({ enabled: true, trailheadElevationFt: null, ascentMinutesPer1000Ft: null, timeline: null });
    expect(parseApproachQuery({ approach: 'off', trailhead_ft: '7000' })).toEqual({ enabled: false });
    expect(parseApproachQuery({ trailhead_ft: '7200', ascent_min_per_kft: '50' })).toMatchObject({ trailheadElevationFt: 7200, ascentMinutesPer1000Ft: 50 });
    expect(parseApproachQuery({ trailhead_ft: 'high', ascent_min_per_kft: '999' })).toMatchObject({ trailheadElevationFt: null, ascentMinutesPer1000Ft: null });
    expect(parseApproachQuery({ approach_route: '0:7500,278:11000,398:7500' }).timeline).toEqual([
      { minute: 0, elevationFt: 7500 }, { minute: 278, elevationFt: 11000 }, { minute: 398, elevationFt: 7500 },
    ]);
    expect(parseApproachQuery({ approach_route: '0:7500,10:x' }).timeline).toBeNull();
    expect(parseApproachQuery({ approach_route: '60:7500,0:11000' }).timeline).toBeNull();
    expect(parseApproachQuery({ approach_route: Array.from({ length: 65 }, (_, i) => `${i}:8000`).join(',') }).timeline).toBeNull();
  });
});

describe('approach profile', () => {
  test('prefers a route, then a typed trailhead, then the lowest band', () => {
    const estimated = buildApproachProfile({ objectiveElevationFt: 11000, elevationBands: bands });
    expect(estimated.source).toBe('estimated');
    expect(estimated.trailheadElevationFt).toBe(8200);
    expect(Math.round(estimated.timeline[1].minute)).toBe(126);
    expect(buildApproachProfile({ objectiveElevationFt: 11000, trailheadElevationFt: 7000, elevationBands: bands }).source).toBe('manual');
    const route = [{ minute: 0, elevationFt: 7500 }, { minute: 278, elevationFt: 11000 }];
    expect(buildApproachProfile({ objectiveElevationFt: 11000, trailheadElevationFt: 7000, timeline: route }).source).toBe('gpx');
    expect(buildApproachProfile({ objectiveElevationFt: 11000, trailheadElevationFt: 10900 })).toBeNull();
    expect(buildApproachProfile({ objectiveElevationFt: null, trailheadElevationFt: 7000 })).toBeNull();
  });

  test('scores each hour at its high point, never above the objective', () => {
    const profile = buildApproachProfile({ objectiveElevationFt: 11000, trailheadElevationFt: 8000, ascentMinutesPer1000Ft: 45 });
    expect(highestElevationBetween(profile, 0, 60)).toBeCloseTo(8000 + 3000 * (60 / 135));
    expect(highestElevationBetween(profile, 120, 180)).toBe(11000);
  });
});

describe('elevation adjustment and inversions', () => {
  test('warms and calms the approach, capped', () => {
    expect(adjustPointToElevation(hour, 11000, 8000, { minuteOfDay: 720 })).toMatchObject({ temp: 30, wind: 6, gust: 21, precipChance: 10, inversionRisk: false });
    expect(adjustPointToElevation(hour, 11000, 5000, { minuteOfDay: 720 }).temp).toBe(30);
  });

  test('cools the approach instead on clear, calm nights and mornings', () => {
    const clearCalm = { ...hour, wind: 4, gust: 8, cloudCover: 10, condition: 'Clear' };
    const context = (minuteOfDay) => ({ minuteOfDay, sunriseMinutes: 390, sunsetMinutes: 1170 });
    expect(isInversionLikely(clearCalm, context(300))).toBe(true);
    expect(isInversionLikely(clearCalm, context(450))).toBe(true);
    expect(isInversionLikely(clearCalm, context(780))).toBe(false);
    expect(isInversionLikely({ ...clearCalm, wind: 20 }, context(300))).toBe(false);
    expect(isInversionLikely({ ...clearCalm, cloudCover: 100, condition: 'Patchy Fog' }, context(300))).toBe(true);
    expect(isInversionLikely({ ...clearCalm, isDaytime: false }, {})).toBe(true);
    expect(adjustPointToElevation(clearCalm, 11000, 8000, context(300)).temp).toBe(14);
    expect(adjustPointToElevation(clearCalm, 11000, 4000, context(300)).temp).toBe(12);
  });

  test('reads sunrise and sunset clock strings', () => {
    expect(parseSolarClockMinutes('6:30 AM')).toBe(390);
    expect(parseSolarClockMinutes('7:30:12 PM')).toBe(1170);
    expect(parseSolarClockMinutes('12:05 AM')).toBe(5);
    expect(parseSolarClockMinutes('N/A')).toBeNull();
  });

  test('resolves nothing when disabled or without a known approach', () => {
    const weatherData = { elevation: 11000, elevationForecast: bands };
    expect(resolveApproach({ approachRequest: { enabled: false }, weatherData })).toBeNull();
    expect(resolveApproach({ approachRequest: parseApproachQuery({}), weatherData: { elevation: 11000 } })).toBeNull();
    expect(resolveApproach({ approachRequest: parseApproachQuery({}), weatherData, solarData: { sunrise: '6:30 AM', sunset: '7:30 PM' } }))
      .toMatchObject({ profile: { source: 'estimated' }, sunriseMinutes: 390, sunsetMinutes: 1170 });
  });
});

describe('comfort score on the approach', () => {
  // A cold, windy summit in the first hours of a pre-dawn start, calm and mild later.
  const trendAt = (rows) => rows.map((row, index) => ({
    timeIso: `2026-09-23T${String(5 + index).padStart(2, '0')}:00:00-06:00`,
    precipChance: 5,
    cloudCover: 80,
    isDaytime: index >= 2,
    condition: 'Mostly Cloudy',
    ...row,
  }));
  const weatherData = (trend) => ({
    description: 'Mostly Cloudy', temp: trend[0].temp, windSpeed: trend[0].wind, windGust: trend[0].gust,
    precipChance: 5, cloudCover: 80, isDaytime: false, elevation: 11000, elevationForecast: bands, trend,
  });
  const input = (trend, approach) => ({
    weatherData: weatherData(trend),
    airQualityData: { status: 'ok', usAqi: 20 },
    selectedStartTime: '2026-09-23T05:00:00-06:00',
    selectedTravelWindowHours: trend.length,
    approach,
  });
  const approachFor = (trailheadElevationFt, solar = { sunriseMinutes: 390, sunsetMinutes: 1170 }) => ({
    profile: buildApproachProfile({ objectiveElevationFt: 11000, trailheadElevationFt, ascentMinutesPer1000Ft: 45 }),
    ...solar,
  });
  const factor = (result, name) => result.factors.find((entry) => entry.factor === name);

  test('early hours scored at the trailhead raise wind and temperature comfort', () => {
    const trend = trendAt([
      { temp: 22, wind: 25, gust: 40 },
      { temp: 24, wind: 25, gust: 40 },
      { temp: 45, wind: 5, gust: 8 },
      { temp: 50, wind: 5, gust: 8 },
    ]);
    const bothEnds = calculatePleasantnessScore(input(trend, null));
    const approach = calculatePleasantnessScore(input(trend, approachFor(6000)));
    expect(factor(approach, 'Wind').score).toBeGreaterThan(factor(bothEnds, 'Wind').score);
    expect(approach.score).toBeGreaterThanOrEqual(bothEnds.score);
    expect(approach.approach).toEqual({ source: 'manual', trailheadElevationFt: 6000, adjustedHours: 3, inversionHours: 0 });
    expect(factor(approach, 'Temperature').message).toMatch(/along your route, from about 7,300 ft on the approach/);
    expect(bothEnds).not.toHaveProperty('approach');
  });

  test('a clear, calm alpine start is scored colder at the trailhead', () => {
    const trend = trendAt([
      { temp: 30, wind: 2, gust: 4, cloudCover: 0, condition: 'Clear' },
      { temp: 30, wind: 2, gust: 4, cloudCover: 0, condition: 'Clear' },
    ]);
    const summitOnly = calculatePleasantnessScore(input(trend, approachFor(10800)));
    const inversion = calculatePleasantnessScore(input(trend, approachFor(6000)));
    expect(inversion.approach.inversionHours).toBe(2);
    expect(factor(inversion, 'Temperature').score).toBeLessThan(factor(summitOnly, 'Temperature').score);
  });
});
