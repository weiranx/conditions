'use strict';

// ============================================================================
// unit.atmospheric.test.js
//
// Unit tests for backend/src/utils/atmospheric.js — the derived atmospheric
// signals (wind chill, precipitation type, moon phase) and the assembler that
// merges them with fetched signals into the `atmosphere` payload section.
// ============================================================================

const {
  computeWindChillF,
  classifyPrecipType,
  computeMoonPhase,
  uvCategory,
  thunderCategory,
  buildAtmosphericData,
} = require('../src/utils/atmospheric');

describe('computeWindChillF', () => {
  test('returns a colder value when cold and windy', () => {
    const chill = computeWindChillF(20, 15);
    expect(chill).toBeLessThan(20);
    expect(typeof chill).toBe('number');
  });

  test('returns null when too warm (>50F)', () => {
    expect(computeWindChillF(60, 10)).toBeNull();
  });

  test('returns null when wind is below 3 mph', () => {
    expect(computeWindChillF(20, 1)).toBeNull();
  });

  test('returns null for non-finite inputs', () => {
    expect(computeWindChillF(null, 10)).toBeNull();
    expect(computeWindChillF(20, undefined)).toBeNull();
  });
});

describe('classifyPrecipType', () => {
  test('no precip when chance is low', () => {
    expect(classifyPrecipType({ tempF: 45, precipChance: 5 }).code).toBe('none');
  });

  test('snow when objective is above the snow level', () => {
    const result = classifyPrecipType({ tempF: 28, precipChance: 60, elevationFt: 9000, snowLevelFt: 7000 });
    expect(result.code).toBe('snow');
  });

  test('rain when objective is below the snow level', () => {
    const result = classifyPrecipType({ tempF: 45, precipChance: 60, elevationFt: 5000, snowLevelFt: 9000 });
    expect(result.code).toBe('rain');
  });

  test('mix when objective straddles the snow level', () => {
    const result = classifyPrecipType({ tempF: 34, precipChance: 60, elevationFt: 8000, snowLevelFt: 8000 });
    expect(result.code).toBe('mix');
  });

  test('freezing when forecast text indicates it', () => {
    const result = classifyPrecipType({ tempF: 30, precipChance: 60, description: 'Freezing rain likely' });
    expect(result.code).toBe('freezing');
  });

  test('freezing from sub-freezing surface beneath a warm layer aloft', () => {
    const result = classifyPrecipType({ tempF: 30, precipChance: 60, elevationFt: 4000, freezingLevelFt: 6000 });
    expect(result.code).toBe('freezing');
  });

  test('falls back to surface temperature when levels are missing', () => {
    expect(classifyPrecipType({ tempF: 25, precipChance: 70 }).code).toBe('snow');
    expect(classifyPrecipType({ tempF: 50, precipChance: 70 }).code).toBe('rain');
    expect(classifyPrecipType({ tempF: 35, precipChance: 70 }).code).toBe('mix');
  });

  test('unknown when no signals are available', () => {
    expect(classifyPrecipType({ precipChance: 70 }).code).toBe('unknown');
  });
});

describe('computeMoonPhase', () => {
  test('returns illumination near 1 around a known full moon', () => {
    // 2026-01-03 is close to a full moon.
    const moon = computeMoonPhase('2026-01-03T12:00:00Z');
    expect(moon).not.toBeNull();
    expect(moon.illumination).toBeGreaterThan(0.9);
  });

  test('returns illumination near 0 around a known new moon', () => {
    // 2000-01-06 is the reference new moon.
    const moon = computeMoonPhase('2000-01-06T18:14:00Z');
    expect(moon.illumination).toBeLessThan(0.05);
    expect(moon.name).toBe('New moon');
  });

  test('phase fraction stays within [0,1)', () => {
    const moon = computeMoonPhase('2026-06-28');
    expect(moon.phase).toBeGreaterThanOrEqual(0);
    expect(moon.phase).toBeLessThan(1);
  });

  test('returns null for invalid date', () => {
    expect(computeMoonPhase('not-a-date')).toBeNull();
  });
});

describe('uvCategory & thunderCategory', () => {
  test('uvCategory thresholds', () => {
    expect(uvCategory(1)).toBe('Low');
    expect(uvCategory(4)).toBe('Moderate');
    expect(uvCategory(7)).toBe('High');
    expect(uvCategory(9)).toBe('Very High');
    expect(uvCategory(12)).toBe('Extreme');
    expect(uvCategory(null)).toBeNull();
  });

  test('thunderCategory thresholds', () => {
    expect(thunderCategory(5)).toBe('Low');
    expect(thunderCategory(20)).toBe('Moderate');
    expect(thunderCategory(45)).toBe('Elevated');
    expect(thunderCategory(70)).toBe('High');
    expect(thunderCategory(undefined)).toBeNull();
  });
});

describe('buildAtmosphericData', () => {
  test('assembles a complete section and degrades missing fields to null', () => {
    const built = buildAtmosphericData({
      weatherData: { temp: 25, windSpeed: 20, precipChance: 70, elevation: 9000, description: 'Snow' },
      fetched: { uvIndex: 7, freezingLevelFt: 6500, snowLevelFt: 6000, thunderProbability: 40, date: '2026-06-28' },
    });
    expect(built.uvCategory).toBe('High');
    expect(built.thunderCategory).toBe('Elevated');
    expect(built.precipType.code).toBe('snow');
    expect(built.windChill).toBeLessThan(25);
    expect(built.moon).not.toBeNull();
    expect(built.sources.uvIndex).toBe('Open-Meteo');
  });

  test('marks unavailable sources when fetched signals are missing', () => {
    const built = buildAtmosphericData({
      weatherData: { temp: 70, windSpeed: 4, precipChance: 0 },
      fetched: {},
    });
    expect(built.uvIndex).toBeNull();
    expect(built.sources.uvIndex).toBe('Unavailable');
    expect(built.sources.snowLevel).toBe('Unavailable');
    // Wind chill not applicable above 50F.
    expect(built.windChill).toBeNull();
  });
});
