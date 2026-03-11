'use strict';

/**
 * Unit tests for utility modules in backend/src/utils/
 *
 * Covers modules with zero or minimal existing test coverage:
 *   - url-utils.js
 *   - time.js (extended coverage beyond unit.helpers.test.js)
 *   - weather-normalizers.js
 *   - alerts.js (pure helper functions only, no HTTP calls)
 *   - precipitation.js (pure helper functions only, no HTTP calls)
 *   - visibility-risk.js
 *   - heat-risk.js
 *   - fire-risk.js
 */

// ─── url-utils ────────────────────────────────────────────────────────────────

const { normalizeHttpUrl } = require('../src/utils/url-utils');

describe('normalizeHttpUrl', () => {
  test('returns https URL unchanged', () => {
    expect(normalizeHttpUrl('https://example.com/path')).toBe('https://example.com/path');
  });

  test('upgrades http to https', () => {
    expect(normalizeHttpUrl('http://example.com')).toBe('https://example.com');
  });

  test('preserves mixed-case http prefix while upgrading to https', () => {
    expect(normalizeHttpUrl('HTTP://example.com')).toBe('https://example.com');
  });

  test('returns null for non-http strings', () => {
    expect(normalizeHttpUrl('ftp://example.com')).toBeNull();
    expect(normalizeHttpUrl('example.com')).toBeNull();
    expect(normalizeHttpUrl('/api/safety')).toBeNull();
  });

  test('returns null for empty string and whitespace', () => {
    expect(normalizeHttpUrl('')).toBeNull();
    expect(normalizeHttpUrl('   ')).toBeNull();
  });

  test('returns null for non-string values', () => {
    expect(normalizeHttpUrl(null)).toBeNull();
    expect(normalizeHttpUrl(undefined)).toBeNull();
    expect(normalizeHttpUrl(42)).toBeNull();
    expect(normalizeHttpUrl({})).toBeNull();
  });
});

// ─── time.js ─────────────────────────────────────────────────────────────────

const {
  parseIsoTimeToMs,
  parseClockToMinutes,
  formatMinutesToClock,
  parseIsoClockMinutes,
  clampTravelWindowHours,
  normalizeUtcIsoTimestamp,
  findClosestTimeIndex,
  withExplicitTimezone,
} = require('../src/utils/time');

describe('parseIsoTimeToMs', () => {
  test('parses UTC ISO timestamp', () => {
    const ms = parseIsoTimeToMs('2026-02-20T12:00:00Z');
    expect(ms).toBe(Date.parse('2026-02-20T12:00:00Z'));
  });

  test('parses ISO timestamp with offset', () => {
    const ms = parseIsoTimeToMs('2026-02-20T06:00:00-08:00');
    expect(ms).toBe(Date.parse('2026-02-20T14:00:00Z'));
  });

  test('treats naive ISO as UTC when no timezone present', () => {
    const ms = parseIsoTimeToMs('2026-02-20T12:00:00');
    expect(ms).toBe(Date.parse('2026-02-20T12:00:00Z'));
  });

  test('returns null for invalid strings', () => {
    expect(parseIsoTimeToMs('not-a-date')).toBeNull();
    expect(parseIsoTimeToMs('')).toBeNull();
    expect(parseIsoTimeToMs('   ')).toBeNull();
  });

  test('returns null for non-string inputs', () => {
    expect(parseIsoTimeToMs(null)).toBeNull();
    expect(parseIsoTimeToMs(undefined)).toBeNull();
    expect(parseIsoTimeToMs(12345)).toBeNull();
  });
});

describe('parseClockToMinutes', () => {
  test('parses 24-hour clock strings', () => {
    expect(parseClockToMinutes('00:00')).toBe(0);
    expect(parseClockToMinutes('06:30')).toBe(390);
    expect(parseClockToMinutes('23:59')).toBe(23 * 60 + 59);
  });

  test('parses 12-hour AM times', () => {
    expect(parseClockToMinutes('12:00 AM')).toBe(0);
    expect(parseClockToMinutes('6:30 AM')).toBe(390);
    expect(parseClockToMinutes('11:45 am')).toBe(11 * 60 + 45);
  });

  test('parses 12-hour PM times', () => {
    expect(parseClockToMinutes('12:00 PM')).toBe(720);
    expect(parseClockToMinutes('1:00 PM')).toBe(780);
    expect(parseClockToMinutes('11:59 PM')).toBe(23 * 60 + 59);
  });

  test('returns null for invalid formats', () => {
    expect(parseClockToMinutes('25:00')).toBeNull();
    expect(parseClockToMinutes('6:30')).toBeNull(); // single digit hour, no AM/PM
    expect(parseClockToMinutes('bad')).toBeNull();
    expect(parseClockToMinutes('')).toBeNull();
    expect(parseClockToMinutes(null)).toBeNull();
    expect(parseClockToMinutes(630)).toBeNull();
  });
});

describe('formatMinutesToClock', () => {
  test('formats total minutes to HH:mm string', () => {
    expect(formatMinutesToClock(0)).toBe('00:00');
    expect(formatMinutesToClock(390)).toBe('06:30');
    expect(formatMinutesToClock(23 * 60 + 59)).toBe('23:59');
  });

  test('wraps at 24 hours due to modulo', () => {
    expect(formatMinutesToClock(24 * 60)).toBe('00:00');
    expect(formatMinutesToClock(25 * 60)).toBe('01:00');
  });
});

describe('parseIsoClockMinutes', () => {
  test('extracts minutes-of-day from ISO string', () => {
    expect(parseIsoClockMinutes('2026-02-20T06:30:00Z')).toBe(390);
    expect(parseIsoClockMinutes('2026-02-20T00:00:00Z')).toBe(0);
    expect(parseIsoClockMinutes('2026-02-20T23:59:00-07:00')).toBe(23 * 60 + 59);
  });

  test('returns null for non-ISO strings and non-strings', () => {
    expect(parseIsoClockMinutes('not-a-time')).toBeNull();
    expect(parseIsoClockMinutes(null)).toBeNull();
    expect(parseIsoClockMinutes(undefined)).toBeNull();
  });
});

describe('clampTravelWindowHours', () => {
  test('clamps value into [1, 24] range', () => {
    expect(clampTravelWindowHours(12)).toBe(12);
    expect(clampTravelWindowHours(0)).toBe(1);
    expect(clampTravelWindowHours(100)).toBe(24);
    expect(clampTravelWindowHours(1)).toBe(1);
    expect(clampTravelWindowHours(24)).toBe(24);
  });

  test('uses fallback only for non-finite input (NaN-producing values like undefined or bad strings)', () => {
    // null coerces to 0 in JS (Number(null) === 0), so it clamps to 1, not fallback
    expect(clampTravelWindowHours(null)).toBe(1);
    // undefined produces NaN -> fallback applies
    expect(clampTravelWindowHours(undefined)).toBe(12);
    expect(clampTravelWindowHours('bad')).toBe(12);
  });

  test('clamps null to 1 (null coerces to 0, clamped to minimum of 1)', () => {
    // custom fallback only applies for NaN-producing inputs, not null
    expect(clampTravelWindowHours(null, 8)).toBe(1);
    expect(clampTravelWindowHours(undefined, 8)).toBe(8);
  });

  test('rounds fractional hours', () => {
    expect(clampTravelWindowHours(6.7)).toBe(7);
    expect(clampTravelWindowHours(6.2)).toBe(6);
  });
});

describe('normalizeUtcIsoTimestamp', () => {
  test('converts naive ISO to UTC ISO', () => {
    const result = normalizeUtcIsoTimestamp('2026-02-20T12:00:00');
    expect(result).toBe('2026-02-20T12:00:00.000Z');
  });

  test('normalizes offset-based ISO to UTC ISO', () => {
    const result = normalizeUtcIsoTimestamp('2026-02-20T06:00:00-06:00');
    expect(result).toBe('2026-02-20T12:00:00.000Z');
  });

  test('returns null for null and empty strings', () => {
    expect(normalizeUtcIsoTimestamp(null)).toBeNull();
    expect(normalizeUtcIsoTimestamp('')).toBeNull();
    expect(normalizeUtcIsoTimestamp('   ')).toBeNull();
  });

  test('returns original value unchanged when not parseable', () => {
    expect(normalizeUtcIsoTimestamp('unparseable-value')).toBe('unparseable-value');
  });
});

describe('findClosestTimeIndex', () => {
  const times = [
    '2026-02-20T10:00:00Z',
    '2026-02-20T11:00:00Z',
    '2026-02-20T12:00:00Z',
  ];

  test('returns index of exact match', () => {
    const target = Date.parse('2026-02-20T11:00:00Z');
    expect(findClosestTimeIndex(times, target)).toBe(1);
  });

  test('returns nearest index for approximate target', () => {
    const target = Date.parse('2026-02-20T11:45:00Z');
    expect(findClosestTimeIndex(times, target)).toBe(2);
  });

  test('returns -1 for empty array', () => {
    expect(findClosestTimeIndex([], Date.parse('2026-02-20T12:00:00Z'))).toBe(-1);
  });

  test('returns -1 for all invalid timestamps', () => {
    expect(findClosestTimeIndex(['bad', null, undefined], Date.now())).toBe(-1);
  });

  test('skips invalid entries and returns best valid one', () => {
    const mixedTimes = [null, 'bad', '2026-02-20T12:00:00Z'];
    const target = Date.parse('2026-02-20T12:00:00Z');
    expect(findClosestTimeIndex(mixedTimes, target)).toBe(2);
  });
});

describe('withExplicitTimezone', () => {
  test('appends Z for UTC naive ISO string', () => {
    expect(withExplicitTimezone('2026-02-20T12:00:00', 'UTC')).toBe('2026-02-20T12:00:00Z');
  });

  test('returns already-zoned strings unchanged', () => {
    expect(withExplicitTimezone('2026-02-20T12:00:00Z', 'UTC')).toBe('2026-02-20T12:00:00Z');
    expect(withExplicitTimezone('2026-02-20T06:00:00-08:00', 'UTC')).toBe('2026-02-20T06:00:00-08:00');
  });

  test('returns non-ISO strings unchanged', () => {
    expect(withExplicitTimezone('just some text', 'UTC')).toBe('just some text');
  });

  test('returns null for null and empty', () => {
    expect(withExplicitTimezone(null)).toBeNull();
    expect(withExplicitTimezone('')).toBeNull();
  });

  test('does not append zone for non-UTC timezone hint', () => {
    const result = withExplicitTimezone('2026-02-20T12:00:00', 'America/Denver');
    expect(result).toBe('2026-02-20T12:00:00');
  });
});

// ─── weather-normalizers.js ───────────────────────────────────────────────────

const {
  computeFeelsLikeF,
  celsiusToF,
  normalizeNoaaDewPointF,
  normalizePressureHpa,
  normalizeNoaaPressureHpa,
  clampPercent,
  inferNoaaCloudCoverFromIcon,
  inferNoaaCloudCoverFromForecastText,
  resolveNoaaCloudCover,
  toFiniteNumberOrNull,
} = require('../src/utils/weather-normalizers');

describe('computeFeelsLikeF', () => {
  test('applies wind chill for cold + windy conditions', () => {
    const result = computeFeelsLikeF(20, 20);
    expect(result).toBeLessThan(20);
  });

  test('returns rounded temp when conditions do not meet wind chill threshold', () => {
    // > 50F or wind < 3mph: no chill formula
    expect(computeFeelsLikeF(60, 20)).toBe(60);
    expect(computeFeelsLikeF(30, 0)).toBe(30);
    expect(computeFeelsLikeF(30, 2)).toBe(30);
  });

  test('returns input unchanged when tempF is non-finite', () => {
    expect(computeFeelsLikeF(null, 20)).toBe(null);
    expect(computeFeelsLikeF(undefined, 20)).toBe(undefined);
    expect(computeFeelsLikeF(NaN, 20)).toBeNaN();
  });
});

describe('celsiusToF', () => {
  test('converts 0°C to 32°F', () => {
    expect(celsiusToF(0)).toBe(32);
  });

  test('converts 100°C to 212°F', () => {
    expect(celsiusToF(100)).toBe(212);
  });

  test('converts -40°C to -40°F (the crossover point)', () => {
    expect(celsiusToF(-40)).toBe(-40);
  });

  test('returns null for NaN-producing inputs; note null coerces to 0 (32F)', () => {
    // null -> Number(null) = 0 -> finite -> returns 32 (0°C = 32°F)
    expect(celsiusToF(null)).toBe(32);
    // non-numeric strings produce NaN -> null
    expect(celsiusToF('warm')).toBeNull();
    // undefined -> NaN -> null
    expect(celsiusToF(undefined)).toBeNull();
  });
});

describe('normalizeNoaaDewPointF', () => {
  test('converts Celsius dew point to Fahrenheit', () => {
    const result = normalizeNoaaDewPointF({ value: 0, unitCode: 'wmoUnit:degC' });
    expect(result).toBe(32);
  });

  test('returns Fahrenheit value directly when unit is not Celsius', () => {
    const result = normalizeNoaaDewPointF({ value: 45, unitCode: '' });
    expect(result).toBe(45);
  });

  test('returns null for non-finite value; null coerces to 0 (treated as 0°F dew point)', () => {
    expect(normalizeNoaaDewPointF(null)).toBeNull();
    // { value: null } -> Number(null) = 0 -> IS finite, unitCode '' -> Math.round(0) = 0
    // (no unit conversion: treated as 0°F, not 0°C)
    expect(normalizeNoaaDewPointF({ value: null })).toBe(0);
    // With Celsius unit, 0°C -> 32°F
    expect(normalizeNoaaDewPointF({ value: null, unitCode: 'wmoUnit:degC' })).toBe(32);
    // { value: 'abc' } -> Number('abc') = NaN -> NOT finite -> returns null
    expect(normalizeNoaaDewPointF({ value: 'abc' })).toBeNull();
  });
});

describe('normalizePressureHpa', () => {
  test('rounds to one decimal place', () => {
    expect(normalizePressureHpa(1013.14)).toBe(1013.1);
    expect(normalizePressureHpa(1013.15)).toBe(1013.2);
  });

  test('returns 0 for null (null coerces to 0) and null for non-numeric strings', () => {
    // Number(null) = 0 -> finite -> returns 0
    expect(normalizePressureHpa(null)).toBe(0);
    // Number('high') = NaN -> not finite -> returns null
    expect(normalizePressureHpa('high')).toBeNull();
    expect(normalizePressureHpa(undefined)).toBeNull();
  });
});

describe('normalizeNoaaPressureHpa', () => {
  test('converts Pa to hPa when value > 2000', () => {
    // 101325 Pa → 1013.2 hPa
    const result = normalizeNoaaPressureHpa({ value: 101325, unitCode: 'unit:Pa' });
    expect(result).toBeCloseTo(1013.2, 0);
  });

  test('passes through hPa value directly', () => {
    const result = normalizeNoaaPressureHpa({ value: 1013.1, unitCode: 'unit:hPa' });
    expect(result).toBe(1013.1);
  });

  test('handles raw number input and divides if > 2000', () => {
    expect(normalizeNoaaPressureHpa(101300)).toBeCloseTo(1013, 0);
    expect(normalizeNoaaPressureHpa(1013.1)).toBe(1013.1);
  });

  test('returns null for explicit null input; value:null field coerces to 0', () => {
    expect(normalizeNoaaPressureHpa(null)).toBeNull();
    // { value: null } -> Number(null) = 0 -> finite -> normalized to 0
    expect(normalizeNoaaPressureHpa({ value: null })).toBe(0);
    // { value: 'bad' } -> NaN -> null
    expect(normalizeNoaaPressureHpa({ value: 'bad' })).toBeNull();
  });
});

describe('clampPercent', () => {
  test('clamps value to [0, 100]', () => {
    expect(clampPercent(50)).toBe(50);
    expect(clampPercent(-10)).toBe(0);
    expect(clampPercent(150)).toBe(100);
  });

  test('rounds to nearest integer', () => {
    expect(clampPercent(50.6)).toBe(51);
    expect(clampPercent(50.4)).toBe(50);
  });

  test('clamps null to 0 (null coerces to 0); returns null for non-numeric strings', () => {
    // Number(null) = 0 -> finite -> Math.max(0, Math.min(100, 0)) = 0
    expect(clampPercent(null)).toBe(0);
    // Number('abc') = NaN -> not finite -> null
    expect(clampPercent('abc')).toBeNull();
    expect(clampPercent(undefined)).toBeNull();
  });
});

describe('inferNoaaCloudCoverFromIcon', () => {
  test('maps OVC icon to ~95%', () => {
    expect(inferNoaaCloudCoverFromIcon('https://api.weather.gov/icons/land/day/ovc')).toBe(95);
  });

  test('maps BKN icon to 75%', () => {
    expect(inferNoaaCloudCoverFromIcon('https://api.weather.gov/icons/land/night/bkn')).toBe(75);
  });

  test('maps SCT icon to 50%', () => {
    expect(inferNoaaCloudCoverFromIcon('https://api.weather.gov/icons/land/day/sct')).toBe(50);
  });

  test('maps FEW icon to 20%', () => {
    expect(inferNoaaCloudCoverFromIcon('https://api.weather.gov/icons/land/day/few')).toBe(20);
  });

  test('maps SKC/CLR icon to 5%', () => {
    expect(inferNoaaCloudCoverFromIcon('https://api.weather.gov/icons/land/day/skc')).toBe(5);
    expect(inferNoaaCloudCoverFromIcon('https://api.weather.gov/icons/land/day/clr')).toBe(5);
  });

  test('returns null for unrecognized icon', () => {
    expect(inferNoaaCloudCoverFromIcon('https://api.weather.gov/icons/land/day/rain')).toBeNull();
    expect(inferNoaaCloudCoverFromIcon('')).toBeNull();
    expect(inferNoaaCloudCoverFromIcon(null)).toBeNull();
  });
});

describe('inferNoaaCloudCoverFromForecastText', () => {
  test('returns 95 for overcast', () => {
    expect(inferNoaaCloudCoverFromForecastText('Overcast')).toBe(95);
  });

  test('returns 80 for mostly cloudy', () => {
    expect(inferNoaaCloudCoverFromForecastText('Mostly Cloudy')).toBe(80);
  });

  test('returns 50 for partly cloudy / partly sunny', () => {
    expect(inferNoaaCloudCoverFromForecastText('Partly Cloudy')).toBe(50);
    expect(inferNoaaCloudCoverFromForecastText('Partly Sunny')).toBe(50);
  });

  test('returns 25 for mostly sunny', () => {
    expect(inferNoaaCloudCoverFromForecastText('Mostly Sunny')).toBe(25);
  });

  test('returns 10 for sunny and clear', () => {
    expect(inferNoaaCloudCoverFromForecastText('Sunny')).toBe(10);
    expect(inferNoaaCloudCoverFromForecastText('Clear')).toBe(10);
  });

  test('returns 70 for generic cloudy', () => {
    expect(inferNoaaCloudCoverFromForecastText('Cloudy')).toBe(70);
  });

  test('returns null for unrecognized text', () => {
    expect(inferNoaaCloudCoverFromForecastText('Windy')).toBeNull();
    expect(inferNoaaCloudCoverFromForecastText('')).toBeNull();
    expect(inferNoaaCloudCoverFromForecastText(null)).toBeNull();
  });
});

describe('resolveNoaaCloudCover', () => {
  test('prefers direct skyCover value over icon and text', () => {
    const period = {
      skyCover: { value: 80 },
      icon: 'https://api.weather.gov/icons/land/day/skc',
      shortForecast: 'Sunny',
    };
    expect(resolveNoaaCloudCover(period).value).toBe(80);
    expect(resolveNoaaCloudCover(period).source).toBe('NOAA skyCover');
  });

  test('falls back to icon when skyCover field is entirely absent', () => {
    // Note: { value: null } -> clampPercent(null) = 0 (not null), so skyCover 0 wins.
    // To trigger icon fallback, skyCover must be absent or the whole field undefined.
    const period = {
      skyCover: undefined,
      icon: 'https://api.weather.gov/icons/land/day/ovc',
    };
    expect(resolveNoaaCloudCover(period).value).toBe(95);
    expect(resolveNoaaCloudCover(period).source).toContain('icon');
  });

  test('skyCover { value: null } coerces to 0 and takes priority over icon', () => {
    // This documents the JS null-coercion behavior: Number(null) = 0, which is finite.
    const period = {
      skyCover: { value: null },
      icon: 'https://api.weather.gov/icons/land/day/ovc',
    };
    expect(resolveNoaaCloudCover(period).value).toBe(0);
    expect(resolveNoaaCloudCover(period).source).toBe('NOAA skyCover');
  });

  test('falls back to text inference when icon is unrecognized', () => {
    const period = {
      skyCover: null,
      icon: 'https://api.weather.gov/icons/land/day/rain',
      shortForecast: 'Mostly Cloudy',
    };
    expect(resolveNoaaCloudCover(period).value).toBe(80);
    expect(resolveNoaaCloudCover(period).source).toContain('shortForecast');
  });

  test('returns null value with Unavailable source when nothing resolves', () => {
    const period = { skyCover: null, icon: null, shortForecast: 'Windy' };
    const result = resolveNoaaCloudCover(period);
    expect(result.value).toBeNull();
    expect(result.source).toBe('Unavailable');
  });
});

describe('toFiniteNumberOrNull', () => {
  test('returns numeric value for numeric-coercible inputs', () => {
    expect(toFiniteNumberOrNull(42)).toBe(42);
    expect(toFiniteNumberOrNull('3.14')).toBe(3.14);
    expect(toFiniteNumberOrNull(0)).toBe(0);
  });

  test('returns 0 for null (coerces to finite 0); returns null for truly non-finite inputs', () => {
    // Number(null) = 0 -> finite -> returns 0
    expect(toFiniteNumberOrNull(null)).toBe(0);
    // These produce NaN or Infinity -> not finite -> null
    expect(toFiniteNumberOrNull(undefined)).toBeNull();
    expect(toFiniteNumberOrNull('abc')).toBeNull();
    expect(toFiniteNumberOrNull(Infinity)).toBeNull();
    expect(toFiniteNumberOrNull(NaN)).toBeNull();
  });
});

// ─── alerts.js — pure helper functions ───────────────────────────────────────

const {
  ALERT_SEVERITY_RANK,
  normalizeAlertSeverity,
  formatAlertSeverity,
  getHigherSeverity,
  normalizeNwsAlertText,
  normalizeNwsAreaList,
  classifyUsAqi,
  buildNwsAlertUrlFromId,
  isGenericNwsLink,
  isIndividualNwsAlertLink,
} = require('../src/utils/alerts');

describe('normalizeAlertSeverity', () => {
  test('maps known values to lowercase', () => {
    expect(normalizeAlertSeverity('Extreme')).toBe('extreme');
    expect(normalizeAlertSeverity('SEVERE')).toBe('severe');
    expect(normalizeAlertSeverity('moderate')).toBe('moderate');
    expect(normalizeAlertSeverity('Minor')).toBe('minor');
  });

  test('returns "unknown" for unrecognized or missing values', () => {
    expect(normalizeAlertSeverity('')).toBe('unknown');
    expect(normalizeAlertSeverity(null)).toBe('unknown');
    expect(normalizeAlertSeverity('catastrophic')).toBe('unknown');
  });
});

describe('formatAlertSeverity', () => {
  test('title-cases recognized severities', () => {
    expect(formatAlertSeverity('extreme')).toBe('Extreme');
    expect(formatAlertSeverity('MINOR')).toBe('Minor');
  });

  test('returns "Unknown" for unrecognized values', () => {
    expect(formatAlertSeverity('bad')).toBe('Unknown');
  });
});

describe('getHigherSeverity', () => {
  test('returns the higher of two severities', () => {
    expect(getHigherSeverity('moderate', 'extreme')).toBe('extreme');
    expect(getHigherSeverity('extreme', 'minor')).toBe('extreme');
    expect(getHigherSeverity('severe', 'severe')).toBe('severe');
  });

  test('handles unknown severity as lowest rank', () => {
    expect(getHigherSeverity('unknown', 'minor')).toBe('minor');
  });
});

describe('ALERT_SEVERITY_RANK', () => {
  test('has increasing ranks from unknown to extreme', () => {
    expect(ALERT_SEVERITY_RANK.unknown).toBeLessThan(ALERT_SEVERITY_RANK.minor);
    expect(ALERT_SEVERITY_RANK.minor).toBeLessThan(ALERT_SEVERITY_RANK.moderate);
    expect(ALERT_SEVERITY_RANK.moderate).toBeLessThan(ALERT_SEVERITY_RANK.severe);
    expect(ALERT_SEVERITY_RANK.severe).toBeLessThan(ALERT_SEVERITY_RANK.extreme);
  });
});

describe('normalizeNwsAlertText', () => {
  test('collapses whitespace and normalizes line endings', () => {
    const raw = 'Line one\r\nLine   two\n\n\nLine three';
    const result = normalizeNwsAlertText(raw);
    expect(result).toContain('Line one');
    expect(result).toContain('Line two');
    expect(result).not.toMatch(/\r/);
    // Triple+ newlines collapse to double
    expect(result).not.toMatch(/\n{3,}/);
  });

  test('truncates text that exceeds maxLength with ellipsis', () => {
    const longText = 'A'.repeat(5000);
    const result = normalizeNwsAlertText(longText, 4000);
    expect(result).toHaveLength(4000);
    expect(result.endsWith('…')).toBe(true);
  });

  test('returns null for non-string input', () => {
    expect(normalizeNwsAlertText(null)).toBeNull();
    expect(normalizeNwsAlertText(42)).toBeNull();
  });

  test('returns null for whitespace-only string', () => {
    expect(normalizeNwsAlertText('   \n  ')).toBeNull();
  });
});

describe('normalizeNwsAreaList', () => {
  test('splits on semicolons and commas and trims parts', () => {
    const result = normalizeNwsAreaList('Wasatch Mountains; Salt Lake County, Utah County');
    expect(result).toContain('Wasatch Mountains');
    expect(result).toContain('Salt Lake County');
    expect(result).toContain('Utah County');
  });

  test('limits to 12 entries', () => {
    const long = Array.from({ length: 20 }, (_, i) => `Area ${i}`).join('; ');
    expect(normalizeNwsAreaList(long)).toHaveLength(12);
  });

  test('returns empty array for non-string input', () => {
    expect(normalizeNwsAreaList(null)).toEqual([]);
    expect(normalizeNwsAreaList(42)).toEqual([]);
  });
});

describe('classifyUsAqi', () => {
  test('classifies standard AQI ranges', () => {
    expect(classifyUsAqi(0)).toBe('Good');
    expect(classifyUsAqi(50)).toBe('Good');
    expect(classifyUsAqi(51)).toBe('Moderate');
    expect(classifyUsAqi(100)).toBe('Moderate');
    expect(classifyUsAqi(101)).toBe('Unhealthy for Sensitive Groups');
    expect(classifyUsAqi(150)).toBe('Unhealthy for Sensitive Groups');
    expect(classifyUsAqi(151)).toBe('Unhealthy');
    expect(classifyUsAqi(200)).toBe('Unhealthy');
    expect(classifyUsAqi(201)).toBe('Very Unhealthy');
    expect(classifyUsAqi(300)).toBe('Very Unhealthy');
    expect(classifyUsAqi(301)).toBe('Hazardous');
  });

  test('returns Unknown for non-finite input', () => {
    expect(classifyUsAqi(null)).toBe('Unknown');
    expect(classifyUsAqi(undefined)).toBe('Unknown');
    expect(classifyUsAqi(NaN)).toBe('Unknown');
    expect(classifyUsAqi(Infinity)).toBe('Unknown');
  });
});

describe('buildNwsAlertUrlFromId', () => {
  test('returns absolute https URL unchanged', () => {
    expect(buildNwsAlertUrlFromId('https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.abc')).toBe(
      'https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.abc',
    );
  });

  test('constructs API URL from bare identifier', () => {
    const result = buildNwsAlertUrlFromId('urn:oid:2.49.0.1.840.0.abc123');
    expect(result).toContain('https://api.weather.gov/alerts/');
    expect(result).toContain('abc123');
  });

  test('returns null for non-string and empty inputs', () => {
    expect(buildNwsAlertUrlFromId(null)).toBeNull();
    expect(buildNwsAlertUrlFromId('')).toBeNull();
    expect(buildNwsAlertUrlFromId('   ')).toBeNull();
  });
});

describe('isGenericNwsLink', () => {
  test('identifies weather.gov root as generic', () => {
    expect(isGenericNwsLink('https://weather.gov')).toBe(true);
    expect(isGenericNwsLink('https://www.weather.gov/')).toBe(true);
  });

  test('identifies api.weather.gov/alerts and /alerts/active as generic', () => {
    expect(isGenericNwsLink('https://api.weather.gov/alerts')).toBe(true);
    expect(isGenericNwsLink('https://api.weather.gov/alerts/active')).toBe(true);
  });

  test('does not flag individual alert URLs as generic', () => {
    expect(isGenericNwsLink('https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.abc')).toBe(false);
  });

  test('returns false for non-string and null inputs', () => {
    expect(isGenericNwsLink(null)).toBe(false);
    expect(isGenericNwsLink('')).toBe(false);
  });
});

describe('isIndividualNwsAlertLink', () => {
  test('returns true for individual alert path', () => {
    expect(isIndividualNwsAlertLink('https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.abc')).toBe(true);
  });

  test('returns false for /alerts and /alerts/active root paths', () => {
    expect(isIndividualNwsAlertLink('https://api.weather.gov/alerts')).toBe(false);
    expect(isIndividualNwsAlertLink('https://api.weather.gov/alerts/active')).toBe(false);
  });

  test('returns false for non-NWS domains', () => {
    expect(isIndividualNwsAlertLink('https://example.com/alerts/some-id')).toBe(false);
  });

  test('returns false for null and empty', () => {
    expect(isIndividualNwsAlertLink(null)).toBe(false);
    expect(isIndividualNwsAlertLink('')).toBe(false);
  });
});

// ─── precipitation.js — pure helper functions ────────────────────────────────

const {
  mmToInches,
  cmToInches,
  buildPrecipitationSummaryForAi,
  createUnavailableRainfallData,
} = require('../src/utils/precipitation');

describe('mmToInches', () => {
  test('converts millimeters to inches with 2 decimal precision', () => {
    expect(mmToInches(25.4)).toBeCloseTo(1.0, 1);
    expect(mmToInches(0)).toBe(0);
    expect(mmToInches(10)).toBeCloseTo(0.39, 2);
  });

  test('returns 0 for null (coerces to 0); returns null for non-numeric strings', () => {
    // Number(null) = 0 -> finite -> 0 inches
    expect(mmToInches(null)).toBe(0);
    // NaN-producing inputs -> null
    expect(mmToInches('abc')).toBeNull();
    expect(mmToInches(undefined)).toBeNull();
  });
});

describe('cmToInches', () => {
  test('converts centimeters to inches with 2 decimal precision', () => {
    expect(cmToInches(2.54)).toBeCloseTo(1.0, 1);
    expect(cmToInches(0)).toBe(0);
  });

  test('returns 0 for null (coerces to 0); returns null for non-numeric strings', () => {
    // Number(null) = 0 -> finite -> 0 inches
    expect(cmToInches(null)).toBe(0);
    expect(cmToInches('abc')).toBeNull();
    expect(cmToInches(undefined)).toBeNull();
  });
});

describe('buildPrecipitationSummaryForAi', () => {
  test('builds summary from rain and snow totals', () => {
    const data = {
      totals: { rainPast24hIn: 0.25, snowPast24hIn: 2.0 },
    };
    const result = buildPrecipitationSummaryForAi(data);
    expect(result).toContain('0.25 in');
    expect(result).toContain('2.00 in');
  });

  test('builds summary from legacy past24hIn alias', () => {
    const data = {
      totals: { past24hIn: 0.5 },
    };
    const result = buildPrecipitationSummaryForAi(data);
    expect(result).toContain('0.50 in');
  });

  test('returns unavailable message when no totals present', () => {
    expect(buildPrecipitationSummaryForAi(null)).toContain('unavailable');
    expect(buildPrecipitationSummaryForAi({ totals: {} })).toContain('unavailable');
  });

  test('excludes non-finite values from summary', () => {
    const data = { totals: { rainPast24hIn: null, snowPast24hIn: 1.0 } };
    const result = buildPrecipitationSummaryForAi(data);
    expect(result).not.toContain('rain');
    expect(result).toContain('snowfall');
  });
});

describe('createUnavailableRainfallData', () => {
  test('returns structure with default unavailable status', () => {
    const result = createUnavailableRainfallData();
    expect(result.status).toBe('unavailable');
    expect(result.totals.rainPast24hIn).toBeNull();
    expect(result.totals.snowPast24hIn).toBeNull();
  });

  test('accepts a custom status value', () => {
    const result = createUnavailableRainfallData('fetch_error');
    expect(result.status).toBe('fetch_error');
  });

  test('includes legacy alias fields for backward compatibility', () => {
    const result = createUnavailableRainfallData();
    expect('past24hMm' in result.totals).toBe(true);
    expect('past24hIn' in result.totals).toBe(true);
  });
});

// ─── visibility-risk.js ──────────────────────────────────────────────────────

const { buildVisibilityRisk, buildElevationForecastBands } = require('../src/utils/visibility-risk');

describe('buildVisibilityRisk', () => {
  test('returns Unknown level when all signals are missing', () => {
    const result = buildVisibilityRisk({});
    expect(result.level).toBe('Unknown');
    expect(result.score).toBeNull();
  });

  test('returns Minimal level for clear conditions with no precipitation', () => {
    const result = buildVisibilityRisk({
      description: 'Clear',
      precipChance: 5,
      humidity: 30,
      cloudCover: 10,
      windSpeed: 5,
      windGust: 8,
    });
    expect(result.level).toBe('Minimal');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThan(20);
  });

  test('elevates level for whiteout description', () => {
    const result = buildVisibilityRisk({
      description: 'Whiteout conditions expected',
      precipChance: 90,
      humidity: 95,
      cloudCover: 99,
      windSpeed: 50,
    });
    expect(['High', 'Extreme']).toContain(result.level);
    expect(result.factors.some((f) => f.includes('whiteout'))).toBe(true);
  });

  test('assigns blowing snow signal from description', () => {
    const result = buildVisibilityRisk({
      description: 'Blowing Snow',
      precipChance: 30,
      windSpeed: 30,
    });
    expect(result.score).toBeGreaterThanOrEqual(38);
    expect(result.factors.some((f) => f.includes('blowing-snow') || f.includes('snowfall'))).toBe(true);
  });

  test('adds nighttime risk factor when isDaytime is false', () => {
    const result = buildVisibilityRisk({
      description: 'Partly cloudy',
      precipChance: 10,
      isDaytime: false,
    });
    expect(result.factors.some((f) => f.includes('nighttime'))).toBe(true);
  });

  test('counts trend hours contributing to visibility risk', () => {
    const trend = Array.from({ length: 8 }, () => ({
      condition: 'blizzard',
      precipChance: 90,
      humidity: 95,
      cloudCover: 99,
      wind: 45,
      gust: 55,
    }));
    const result = buildVisibilityRisk({
      description: 'Blizzard',
      trend,
    });
    expect(result.activeHours).toBeGreaterThanOrEqual(6);
    expect(result.windowHours).toBe(8);
  });

  test('limits factors array to 4 entries', () => {
    const result = buildVisibilityRisk({
      description: 'Whiteout conditions',
      precipChance: 95,
      humidity: 98,
      cloudCover: 99,
      windSpeed: 60,
      windGust: 70,
      isDaytime: false,
    });
    expect(result.factors.length).toBeLessThanOrEqual(4);
  });

  test('caps score at 100', () => {
    const result = buildVisibilityRisk({
      description: 'Whiteout blizzard',
      precipChance: 100,
      humidity: 99,
      cloudCover: 99,
      windSpeed: 80,
      windGust: 100,
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe('buildElevationForecastBands', () => {
  test('returns empty array when required params are non-finite', () => {
    expect(buildElevationForecastBands({ baseElevationFt: null, tempF: 32 })).toEqual([]);
    expect(buildElevationForecastBands({ baseElevationFt: 10000, tempF: null })).toEqual([]);
  });

  test('generates 4 bands for high alpine objective (>= 13000 ft)', () => {
    const bands = buildElevationForecastBands({
      baseElevationFt: 14000,
      tempF: 20,
      windSpeedMph: 10,
      windGustMph: 15,
    });
    expect(bands).toHaveLength(4);
  });

  test('generates bands for mid-range elevation (9000-13000 ft)', () => {
    const bands = buildElevationForecastBands({
      baseElevationFt: 11000,
      tempF: 30,
      windSpeedMph: 15,
      windGustMph: 25,
    });
    expect(bands.length).toBeGreaterThanOrEqual(3);
  });

  test('bands are sorted by elevation ascending', () => {
    const bands = buildElevationForecastBands({
      baseElevationFt: 10000,
      tempF: 32,
      windSpeedMph: 10,
      windGustMph: 20,
    });
    for (let i = 1; i < bands.length; i += 1) {
      expect(bands[i].elevationFt).toBeGreaterThanOrEqual(bands[i - 1].elevationFt);
    }
  });

  test('highest band matches objective elevation', () => {
    const bands = buildElevationForecastBands({
      baseElevationFt: 12000,
      tempF: 25,
      windSpeedMph: 20,
      windGustMph: 35,
    });
    const highest = bands[bands.length - 1];
    expect(highest.elevationFt).toBe(12000);
  });

  test('temperature decreases with elevation (lapse rate)', () => {
    const bands = buildElevationForecastBands({
      baseElevationFt: 10000,
      tempF: 32,
      windSpeedMph: 0,
      windGustMph: 0,
    });
    // Lower bands should be warmer than higher bands
    expect(bands[0].temp).toBeGreaterThan(bands[bands.length - 1].temp);
  });

  test('wind speed increases with elevation', () => {
    const bands = buildElevationForecastBands({
      baseElevationFt: 10000,
      tempF: 32,
      windSpeedMph: 10,
      windGustMph: 15,
    });
    expect(bands[0].windSpeed).toBeLessThanOrEqual(bands[bands.length - 1].windSpeed);
  });

  test('deduplicates bands with identical elevations when objective is near sea level', () => {
    const bands = buildElevationForecastBands({
      baseElevationFt: 500,
      tempF: 45,
      windSpeedMph: 5,
      windGustMph: 10,
    });
    const elevations = bands.map((b) => b.elevationFt);
    const uniqueElevations = new Set(elevations);
    expect(uniqueElevations.size).toBe(elevations.length);
  });
});

// ─── heat-risk.js ─────────────────────────────────────────────────────────────

const { buildHeatRiskData, createUnavailableHeatRiskData } = require('../src/utils/heat-risk');

describe('createUnavailableHeatRiskData', () => {
  test('returns default unavailable structure', () => {
    const result = createUnavailableHeatRiskData();
    expect(result.status).toBe('unavailable');
    expect(result.level).toBe(0);
    expect(result.label).toBe('Low');
    expect(result.metrics.tempF).toBeNull();
  });

  test('accepts a custom status', () => {
    expect(createUnavailableHeatRiskData('error').status).toBe('error');
  });
});

describe('buildHeatRiskData', () => {
  test('returns Low level for cool conditions', () => {
    const result = buildHeatRiskData({
      weatherData: { temp: 55, feelsLike: 52, humidity: 40, isDaytime: true },
    });
    expect(result.level).toBe(0);
    expect(result.label).toBe('Low');
  });

  test('assigns Guarded (1) level for warm daytime temps', () => {
    const result = buildHeatRiskData({
      weatherData: { temp: 78, feelsLike: 79, humidity: 30, isDaytime: true },
    });
    expect(result.level).toBeGreaterThanOrEqual(1);
  });

  test('assigns Elevated (2) level for moderately hot apparent temperature', () => {
    const result = buildHeatRiskData({
      weatherData: { temp: 86, feelsLike: 87, humidity: 30, isDaytime: true },
    });
    expect(result.level).toBeGreaterThanOrEqual(2);
  });

  test('assigns High (3) level for hot apparent temperature', () => {
    const result = buildHeatRiskData({
      weatherData: { temp: 94, feelsLike: 95, humidity: 40, isDaytime: true },
    });
    expect(result.level).toBeGreaterThanOrEqual(3);
  });

  test('assigns Extreme (4) level when feels-like exceeds 100F', () => {
    const result = buildHeatRiskData({
      weatherData: { temp: 100, feelsLike: 105, humidity: 50, isDaytime: true },
    });
    expect(result.level).toBe(4);
    expect(result.label).toBe('Extreme');
  });

  test('also triggers Extreme for hot + humid pattern (90F, RH >= 55)', () => {
    const result = buildHeatRiskData({
      weatherData: { temp: 92, feelsLike: 93, humidity: 60, isDaytime: true },
    });
    expect(result.level).toBe(4);
  });

  test('accounts for lower terrain bands being warmer', () => {
    const result = buildHeatRiskData({
      weatherData: {
        temp: 70,
        feelsLike: 70,
        humidity: 30,
        isDaytime: true,
        elevationForecast: [
          { label: 'Approach Terrain', deltaFromObjectiveFt: -2000, elevationFt: 8000, temp: 90, feelsLike: 92 },
          { label: 'Objective Elevation', deltaFromObjectiveFt: 0, elevationFt: 10000, temp: 70, feelsLike: 70 },
        ],
      },
    });
    // Lower terrain at 90F should push level up
    expect(result.level).toBeGreaterThanOrEqual(2);
    expect(result.metrics.lowerTerrainTempF).toBe(90);
    expect(result.metrics.lowerTerrainLabel).toBe('Approach Terrain');
  });

  test('uses trend temps to compute peak temperature', () => {
    const result = buildHeatRiskData({
      weatherData: {
        temp: 60,
        feelsLike: 60,
        humidity: 20,
        isDaytime: true,
        trend: [{ temp: 95 }, { temp: 98 }],
      },
    });
    expect(result.metrics.peakTemp12hF).toBe(98);
  });

  test('night start does not suppress Guarded level when temp is warm', () => {
    // isDaytime false prevents level 1 from the warmth threshold rule only if feelsLike < 76
    const result = buildHeatRiskData({
      weatherData: { temp: 102, feelsLike: 103, humidity: 20, isDaytime: false },
    });
    // Extreme apparent temp still triggers level 4 regardless of daytime flag
    expect(result.level).toBe(4);
  });

  test('returns ok status', () => {
    const result = buildHeatRiskData({ weatherData: { temp: 70, feelsLike: 70 } });
    expect(result.status).toBe('ok');
  });

  test('always includes at least one reason', () => {
    const result = buildHeatRiskData({ weatherData: { temp: 55, feelsLike: 52 } });
    expect(result.reasons.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── fire-risk.js ─────────────────────────────────────────────────────────────

const { buildFireRiskData, createUnavailableFireRiskData } = require('../src/utils/fire-risk');

describe('createUnavailableFireRiskData', () => {
  test('returns default unavailable structure', () => {
    const result = createUnavailableFireRiskData();
    expect(result.status).toBe('unavailable');
    expect(result.level).toBeNull();
    expect(result.label).toBe('Unknown');
    expect(result.alertsConsidered).toEqual([]);
  });

  test('accepts a custom status', () => {
    expect(createUnavailableFireRiskData('fetch_error').status).toBe('fetch_error');
  });
});

describe('buildFireRiskData', () => {
  const baseInput = {
    weatherData: { description: 'Sunny', temp: 60, humidity: 50, windSpeed: 5, windGust: 10 },
    alertsData: { alerts: [], status: 'ok' },
    airQualityData: { usAqi: 20 },
  };

  test('returns Low (0) for benign conditions', () => {
    const result = buildFireRiskData(baseInput);
    expect(result.level).toBe(0);
    expect(result.label).toBe('Low');
  });

  test('returns ok status', () => {
    const result = buildFireRiskData(baseInput);
    expect(result.status).toBe('ok');
  });

  test('assigns Extreme (4) for Red Flag Warning', () => {
    const result = buildFireRiskData({
      ...baseInput,
      alertsData: {
        status: 'ok',
        alerts: [{ event: 'Red Flag Warning', severity: 'Extreme' }],
      },
    });
    expect(result.level).toBe(4);
    expect(result.reasons.some((r) => r.includes('Red Flag'))).toBe(true);
    expect(result.alertsUsed).toBe(1);
  });

  test('assigns High (3) for Fire Weather Watch', () => {
    const result = buildFireRiskData({
      ...baseInput,
      alertsData: {
        status: 'ok',
        alerts: [{ event: 'Fire Weather Watch', severity: 'Severe' }],
      },
    });
    expect(result.level).toBe(3);
  });

  test('assigns Extreme (4) for hot/dry/windy weather pattern', () => {
    const result = buildFireRiskData({
      ...baseInput,
      weatherData: { description: 'Hot and sunny', temp: 92, humidity: 18, windSpeed: 22 },
    });
    expect(result.level).toBe(4);
  });

  test('assigns Elevated (2) for dry + gusty conditions', () => {
    const result = buildFireRiskData({
      ...baseInput,
      weatherData: { description: 'Sunny', temp: 72, humidity: 28, windSpeed: 14, windGust: 22 },
    });
    expect(result.level).toBeGreaterThanOrEqual(2);
  });

  test('assigns at least Elevated (2) for unhealthy AQI', () => {
    const result = buildFireRiskData({
      ...baseInput,
      airQualityData: { usAqi: 150 },
    });
    expect(result.level).toBeGreaterThanOrEqual(2);
    expect(result.reasons.some((r) => r.includes('moke') || r.includes('air'))).toBe(true);
  });

  test('assigns Guarded (1) for moderate AQI (51-100)', () => {
    const result = buildFireRiskData({
      ...baseInput,
      airQualityData: { usAqi: 75 },
    });
    expect(result.level).toBeGreaterThanOrEqual(1);
  });

  test('smoke/haze description triggers at least Elevated (2)', () => {
    const result = buildFireRiskData({
      ...baseInput,
      weatherData: { ...baseInput.weatherData, description: 'Haze and smoke in the air' },
    });
    expect(result.level).toBeGreaterThanOrEqual(2);
  });

  test('ignores alerts when alertsData status is future_time_not_supported', () => {
    const result = buildFireRiskData({
      ...baseInput,
      alertsData: {
        status: 'future_time_not_supported',
        alerts: [{ event: 'Red Flag Warning', severity: 'Extreme' }],
      },
    });
    // Alert should be ignored; level stays at 0 given benign weather
    expect(result.level).toBe(0);
    expect(result.alertsUsed).toBe(0);
  });

  test('always includes at least one reason', () => {
    const result = buildFireRiskData(baseInput);
    expect(result.reasons.length).toBeGreaterThanOrEqual(1);
  });

  test('caps alertsConsidered at 5 entries', () => {
    const manyAlerts = Array.from({ length: 10 }, (_, i) => ({
      event: `Red Flag Warning ${i}`,
      severity: 'Extreme',
    }));
    const result = buildFireRiskData({
      ...baseInput,
      alertsData: { status: 'ok', alerts: manyAlerts },
    });
    expect(result.alertsConsidered.length).toBeLessThanOrEqual(5);
  });
});
