'use strict';

// ============================================================================
// unit.utils2.test.js
//
// Additional unit tests targeting functions that were under-exercised in the
// existing test suite. Organised into four areas:
//
//  1. wind.js       — parseWindMph, windDegreesToCardinal, findNearestWindDirection
//  2. avalanche-detail.js — firstNonEmptyString, extractBalancedJsonChunk,
//                           normalizeAvalancheLikelihood, normalizeAvalancheLocation,
//                           inferAvalancheExpiresTime, scoreAvalancheDetailCandidate,
//                           extractAvalancheDetailCandidates
//  3. terrain-condition.js — spring_snow / wet_slushy_snow / icy_hardpack /
//                            cold_slick / dry_loose / mixed_variable code paths
//  4. gear-suggestions.js  — alpine hardware, emergency shelter, navigation,
//                            fire-risk, sun protection, electrolytes, very-cold
//                            extremities branches
// ============================================================================

const {
  parseWindMph,
  windDegreesToCardinal,
  findNearestWindDirection,
} = require('../src/utils/wind');

const {
  firstNonEmptyString,
  parseAvalancheDetailPayloads,
  normalizeAvalancheProblemCollection,
  inferAvalancheExpiresTime,
  buildUtahForecastJsonUrl,
  pickBestAvalancheDetailCandidate,
} = require('../src/utils/avalanche-detail');

// extractBalancedJsonChunk is not exported — test it indirectly through
// parseAvalancheDetailPayloads which is the primary consumer.

const {
  deriveTerrainCondition,
  deriveTrailStatus,
} = require('../src/utils/terrain-condition');

const {
  buildLayeringGearSuggestions,
} = require('../src/utils/gear-suggestions');

// ============================================================================
// 1. wind.js — parseWindMph
// ============================================================================

describe('parseWindMph', () => {
  test('returns numeric value rounded and floored at 0', () => {
    expect(parseWindMph(15.7)).toBe(16);
    expect(parseWindMph(0)).toBe(0);
    expect(parseWindMph(-5)).toBe(0);
  });

  test('returns fallback for non-numeric and non-string inputs', () => {
    expect(parseWindMph(null)).toBe(0);
    expect(parseWindMph(undefined)).toBe(0);
    expect(parseWindMph({})).toBe(0);
  });

  test('parses plain numeric string', () => {
    expect(parseWindMph('22')).toBe(22);
    expect(parseWindMph('0')).toBe(0);
  });

  test('extracts leading number from "N mph" style strings', () => {
    expect(parseWindMph('18 mph')).toBe(18);
    expect(parseWindMph('25 mph gusts')).toBe(25);
  });

  test('extracts upper bound from "X to Y mph" range strings', () => {
    expect(parseWindMph('15 to 25 mph')).toBe(25);
    expect(parseWindMph('10 to 20')).toBe(20);
  });

  test('clamps negative-only string to 0', () => {
    // "-5" → parseInt gives -5, clamped to 0
    expect(parseWindMph('-5 mph')).toBe(0);
  });

  test('uses custom fallback when string has no digit', () => {
    expect(parseWindMph('calm', 3)).toBe(3);
    expect(parseWindMph('', 7)).toBe(7);
  });

  test('handles "N to M" range with spaces around "to"', () => {
    expect(parseWindMph('5 to 10 mph')).toBe(10);
  });
});

// ============================================================================
// 1b. wind.js — windDegreesToCardinal
// ============================================================================

describe('windDegreesToCardinal', () => {
  test('returns N for 0 and 360', () => {
    expect(windDegreesToCardinal(0)).toBe('N');
    expect(windDegreesToCardinal(360)).toBe('N');
  });

  test('returns correct cardinal for standard compass points', () => {
    expect(windDegreesToCardinal(90)).toBe('E');
    expect(windDegreesToCardinal(180)).toBe('S');
    expect(windDegreesToCardinal(270)).toBe('W');
  });

  test('returns correct intercardinal for 45, 135, 225, 315', () => {
    expect(windDegreesToCardinal(45)).toBe('NE');
    expect(windDegreesToCardinal(135)).toBe('SE');
    expect(windDegreesToCardinal(225)).toBe('SW');
    expect(windDegreesToCardinal(315)).toBe('NW');
  });

  test('handles values > 360 by wrapping', () => {
    expect(windDegreesToCardinal(450)).toBe('E'); // 450 % 360 = 90
  });

  test('handles negative degrees by wrapping', () => {
    expect(windDegreesToCardinal(-90)).toBe('W'); // (-90 % 360 + 360) % 360 = 270
  });

  test('returns null for null, undefined, and empty string', () => {
    expect(windDegreesToCardinal(null)).toBeNull();
    expect(windDegreesToCardinal(undefined)).toBeNull();
    expect(windDegreesToCardinal('')).toBeNull();
    expect(windDegreesToCardinal('  ')).toBeNull();
  });

  test('returns null for non-numeric strings', () => {
    expect(windDegreesToCardinal('north')).toBeNull();
    expect(windDegreesToCardinal('NaN')).toBeNull();
  });

  test('parses numeric strings', () => {
    expect(windDegreesToCardinal('90')).toBe('E');
    expect(windDegreesToCardinal('180')).toBe('S');
  });

  test('NNE boundary near 22.5 degrees', () => {
    expect(windDegreesToCardinal(22.5)).toBe('NNE');
    expect(windDegreesToCardinal(23)).toBe('NNE');
  });

  test('SSW at 202.5 degrees', () => {
    expect(windDegreesToCardinal(202.5)).toBe('SSW');
  });
});

// ============================================================================
// 1c. wind.js — findNearestWindDirection
// ============================================================================

describe('findNearestWindDirection', () => {
  test('returns direction from the anchor index when available', () => {
    const periods = [
      { windDirection: 'N' },
      { windDirection: 'SW' },
      { windDirection: 'E' },
    ];
    expect(findNearestWindDirection(periods, 1)).toBe('SW');
  });

  test('falls back to forward period when anchor has no direction', () => {
    const periods = [
      { windDirection: null },
      { windDirection: 'SE' },
      { windDirection: 'NW' },
    ];
    expect(findNearestWindDirection(periods, 0)).toBe('SE');
  });

  test('falls back to backward period when anchor and forward are missing', () => {
    const periods = [
      { windDirection: 'NE' },
      { windDirection: null },
      { windDirection: null },
    ];
    expect(findNearestWindDirection(periods, 2)).toBe('NE');
  });

  test('returns null when no period has a valid direction', () => {
    const periods = [
      { windDirection: null },
      { windDirection: '' },
      { windDirection: undefined },
    ];
    expect(findNearestWindDirection(periods, 1)).toBeNull();
  });

  test('returns null for invalid inputs', () => {
    expect(findNearestWindDirection(null, 0)).toBeNull();
    expect(findNearestWindDirection([], 0)).toBeNull();
    expect(findNearestWindDirection([{ windDirection: 'N' }], 'x')).toBeNull();
  });

  test('normalizes direction text through normalizeWindDirection', () => {
    const periods = [{ windDirection: 'Northwest' }, { windDirection: 'East' }];
    expect(findNearestWindDirection(periods, 0)).toBe('NW');
  });
});

// ============================================================================
// 2. avalanche-detail.js — firstNonEmptyString
// ============================================================================

describe('firstNonEmptyString', () => {
  test('returns the first non-empty, non-whitespace string', () => {
    expect(firstNonEmptyString(null, '', '  ', 'found', 'second')).toBe('found');
  });

  test('returns null when all arguments are empty or non-string', () => {
    expect(firstNonEmptyString(null, undefined, '', '  ', 42, [])).toBeNull();
  });

  test('trims the returned value', () => {
    expect(firstNonEmptyString('  trimmed  ')).toBe('trimmed');
  });

  test('accepts a single truthy argument', () => {
    expect(firstNonEmptyString('only')).toBe('only');
  });

  test('returns null with no arguments', () => {
    expect(firstNonEmptyString()).toBeNull();
  });
});

// ============================================================================
// 2b. avalanche-detail.js — parseAvalancheDetailPayloads (tests extractBalancedJsonChunk indirectly)
// ============================================================================

describe('parseAvalancheDetailPayloads', () => {
  test('returns empty array for empty/non-string input', () => {
    expect(parseAvalancheDetailPayloads('')).toEqual([]);
    expect(parseAvalancheDetailPayloads(null)).toEqual([]);
    expect(parseAvalancheDetailPayloads(undefined)).toEqual([]);
    expect(parseAvalancheDetailPayloads(42)).toEqual([]);
  });

  test('parses a single valid JSON object', () => {
    const result = parseAvalancheDetailPayloads('{"danger_level": 3}');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ danger_level: 3 });
  });

  test('parses a single valid JSON array', () => {
    const result = parseAvalancheDetailPayloads('[{"name":"Wind Slab"}]');
    expect(result).toHaveLength(1);
    expect(Array.isArray(result[0])).toBe(true);
  });

  test('deduplicates identical JSON chunks', () => {
    const raw = '{"a":1} {"a":1}';
    const result = parseAvalancheDetailPayloads(raw);
    // The same JSON string is parsed once
    const unique = result.filter((p) => p.a === 1);
    expect(unique).toHaveLength(1);
  });

  test('handles JSON embedded after leading text (e.g. center HTML prefix)', () => {
    const raw = 'Some preamble text {"danger_level": 2, "problems": []}';
    const result = parseAvalancheDetailPayloads(raw);
    const match = result.find((p) => p.danger_level === 2);
    expect(match).toBeDefined();
  });

  test('handles JSON with nested braces and strings containing escape characters', () => {
    const raw = '{"summary": "Wind \\"loaded\\" slopes", "level": 4}';
    const result = parseAvalancheDetailPayloads(raw);
    expect(result.some((p) => p.level === 4)).toBe(true);
  });

  test('gracefully skips malformed JSON and still parses valid chunks', () => {
    const raw = '{invalid JSON} {"valid": true}';
    const result = parseAvalancheDetailPayloads(raw);
    expect(result.some((p) => p.valid === true)).toBe(true);
  });
});

// ============================================================================
// 2c. normalizeAvalancheLikelihood — tested indirectly via normalizeAvalancheProblemCollection
//     (the function is not exported from avalanche-detail.js)
// ============================================================================

describe('likelihood normalization via normalizeAvalancheProblemCollection', () => {
  test('maps numeric likelihood 1 → "unlikely" through the problem normalizer', () => {
    const result = normalizeAvalancheProblemCollection([{ name: 'Wind Slab', likelihood: 1 }]);
    expect(result[0].likelihood).toBe('unlikely');
  });

  test('maps numeric likelihood 2 → "possible"', () => {
    const result = normalizeAvalancheProblemCollection([{ name: 'Storm Slab', likelihood: 2 }]);
    expect(result[0].likelihood).toBe('possible');
  });

  test('maps numeric likelihood 3 → "likely"', () => {
    const result = normalizeAvalancheProblemCollection([{ name: 'Persistent Slab', likelihood: 3 }]);
    expect(result[0].likelihood).toBe('likely');
  });

  test('maps numeric likelihood 4 → "very likely"', () => {
    const result = normalizeAvalancheProblemCollection([{ name: 'Wet Slab', likelihood: 4 }]);
    expect(result[0].likelihood).toBe('very likely');
  });

  test('maps numeric likelihood 5 → "certain"', () => {
    const result = normalizeAvalancheProblemCollection([{ name: 'Cornice', likelihood: 5 }]);
    expect(result[0].likelihood).toBe('certain');
  });

  test('passes through string likelihood as-is', () => {
    const result = normalizeAvalancheProblemCollection([{ name: 'Loose Wet', likelihood: 'Likely' }]);
    expect(result[0].likelihood).toBe('Likely');
  });

  test('handles object likelihood with label field', () => {
    const result = normalizeAvalancheProblemCollection([{ name: 'A', likelihood: { label: 'Possible' } }]);
    expect(result[0].likelihood).toBe('Possible');
  });

  test('handles object likelihood with min/max bounds', () => {
    const result = normalizeAvalancheProblemCollection([{ name: 'B', likelihood: { min: 2, max: 4 } }]);
    expect(result[0].likelihood).toBe('possible to very likely');
  });

  test('handles array likelihood by joining unique values with " to "', () => {
    const result = normalizeAvalancheProblemCollection([{ name: 'C', likelihood: [1, 3] }]);
    expect(result[0].likelihood).toBe('unlikely to likely');
  });
});

// ============================================================================
// 2d. normalizeAvalancheLocation — tested indirectly via normalizeAvalancheProblemCollection
//     (the function is not exported from avalanche-detail.js)
// ============================================================================

describe('location normalization via normalizeAvalancheProblemCollection', () => {
  test('splits comma-separated string into location array', () => {
    const result = normalizeAvalancheProblemCollection([{ name: 'Wind Slab', location: 'North, South, East' }]);
    expect(result[0].location).toContain('North');
    expect(result[0].location).toContain('South');
    expect(result[0].location).toContain('East');
  });

  test('handles plain string location without commas', () => {
    const result = normalizeAvalancheProblemCollection([{ name: 'Storm Slab', location: 'North-facing slopes' }]);
    expect(result[0].location).toEqual(['North-facing slopes']);
  });

  test('flattens array of location strings', () => {
    const result = normalizeAvalancheProblemCollection([{ name: 'A', location: ['N', 'NE', 'E'] }]);
    expect(result[0].location).toEqual(['N', 'NE', 'E']);
  });

  test('deduplicates repeated location entries', () => {
    const result = normalizeAvalancheProblemCollection([{ name: 'B', location: ['N', 'N', 'E'] }]);
    expect(result[0].location).toEqual(['N', 'E']);
  });

  test('resolves aspect_elevation alias', () => {
    const result = normalizeAvalancheProblemCollection([{ name: 'C', aspect_elevation: ['NE', 'E', 'SE'] }]);
    expect(result[0].location).toEqual(['NE', 'E', 'SE']);
  });

  test('omits location key when value is null', () => {
    const result = normalizeAvalancheProblemCollection([{ name: 'D', location: null }]);
    // normalizeAvalancheLocation(null) returns undefined → not set on normalized object
    // The original location: null key is preserved from spread, but not overwritten
    // Check: either location is null (original spread) or undefined
    expect(result[0].location == null || result[0].location === undefined).toBe(true);
  });
});

// ============================================================================
// 2e. avalanche-detail.js — normalizeAvalancheProblemCollection (edge paths)
// ============================================================================

describe('normalizeAvalancheProblemCollection additional cases', () => {
  test('returns empty array for non-array input', () => {
    expect(normalizeAvalancheProblemCollection(null)).toEqual([]);
    expect(normalizeAvalancheProblemCollection('string')).toEqual([]);
    expect(normalizeAvalancheProblemCollection({})).toEqual([]);
  });

  test('filters out null/non-object entries', () => {
    const result = normalizeAvalancheProblemCollection([null, 42, 'bad', { name: 'Wind Slab' }]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Wind Slab');
  });

  test('uses problem_id when id is absent', () => {
    const result = normalizeAvalancheProblemCollection([{ problem_id: 7, name: 'Persistent Slab' }]);
    expect(result[0].id).toBe(7);
  });

  test('uses avalanche_problem_id as fallback id', () => {
    const result = normalizeAvalancheProblemCollection([{ avalanche_problem_id: 5, name: 'Storm Slab' }]);
    expect(result[0].id).toBe(5);
  });

  test('uses 1-based index when no id fields present', () => {
    const result = normalizeAvalancheProblemCollection([{ name: 'Cornices' }, { name: 'Wet Slab' }]);
    expect(result[0].id).toBe(1);
    expect(result[1].id).toBe(2);
  });

  test('normalizes problem_name and problem_type aliases', () => {
    const result = normalizeAvalancheProblemCollection([
      { problem_name: 'Loose Wet', likelihood: 2 },
    ]);
    expect(result[0].name).toBe('Loose Wet');
    expect(result[0].likelihood).toBe('possible');
  });

  test('normalizes likelihood from trigger_likelihood and probability aliases', () => {
    const withTrigger = normalizeAvalancheProblemCollection([{ name: 'A', trigger_likelihood: 3 }]);
    expect(withTrigger[0].likelihood).toBe('likely');

    const withProbability = normalizeAvalancheProblemCollection([{ name: 'B', probability: 5 }]);
    expect(withProbability[0].likelihood).toBe('certain');
  });

  test('normalizes location from aspect_elevation alias', () => {
    const result = normalizeAvalancheProblemCollection([{ name: 'Wind Slab', aspect_elevation: 'N, E' }]);
    expect(result[0].location).toContain('N');
    expect(result[0].location).toContain('E');
  });
});

// ============================================================================
// 2f. avalanche-detail.js — inferAvalancheExpiresTime
// ============================================================================

describe('inferAvalancheExpiresTime', () => {
  test('returns null for null and non-object input', () => {
    expect(inferAvalancheExpiresTime(null)).toBeNull();
    expect(inferAvalancheExpiresTime(undefined)).toBeNull();
    expect(inferAvalancheExpiresTime('string')).toBeNull();
  });

  test('returns end_date from top-level field', () => {
    expect(inferAvalancheExpiresTime({ end_date: '2026-03-15' })).toBe('2026-03-15');
  });

  test('returns expires field when end_date is missing', () => {
    expect(inferAvalancheExpiresTime({ expires: '2026-03-15T18:00:00Z' })).toBe('2026-03-15T18:00:00Z');
  });

  test('returns expire_time when earlier fields are absent', () => {
    expect(inferAvalancheExpiresTime({ expire_time: '2026-03-15T20:00:00Z' })).toBe('2026-03-15T20:00:00Z');
  });

  test('falls through to valid_until and valid_to', () => {
    expect(inferAvalancheExpiresTime({ valid_until: '2026-03-16' })).toBe('2026-03-16');
    expect(inferAvalancheExpiresTime({ valid_to: '2026-03-17' })).toBe('2026-03-17');
  });

  test('returns null when detail has no expiry fields', () => {
    expect(inferAvalancheExpiresTime({ bottom_line: 'Stay safe', danger: [] })).toBeNull();
  });

  test('falls back to danger array current day end_time', () => {
    const detail = {
      danger: [
        { valid_day: 'tomorrow', end_time: '2026-03-15T12:00:00Z' },
        { valid_day: 'current', end_time: '2026-03-14T18:00:00Z' },
      ],
    };
    expect(inferAvalancheExpiresTime(detail)).toBe('2026-03-14T18:00:00Z');
  });

  test('falls back to first danger entry when no current day entry', () => {
    const detail = {
      danger: [{ valid_day: 'tomorrow', end_time: '2026-03-15T06:00:00Z' }],
    };
    expect(inferAvalancheExpiresTime(detail)).toBe('2026-03-15T06:00:00Z');
  });
});

// ============================================================================
// 2g. avalanche-detail.js — buildUtahForecastJsonUrl (additional edge cases)
// ============================================================================

describe('buildUtahForecastJsonUrl additional cases', () => {
  test('returns null for non-string and empty input', () => {
    expect(buildUtahForecastJsonUrl(null)).toBeNull();
    expect(buildUtahForecastJsonUrl('')).toBeNull();
    expect(buildUtahForecastJsonUrl(42)).toBeNull();
  });

  test('returns null for non-UAC domain', () => {
    expect(buildUtahForecastJsonUrl('https://avalanche.org/forecast/uintas')).toBeNull();
    expect(buildUtahForecastJsonUrl('https://nwac.us/avalanche-forecast/')).toBeNull();
  });

  test('returns null for UAC URL with no forecast region path', () => {
    expect(buildUtahForecastJsonUrl('https://utahavalanchecenter.org/')).toBeNull();
    expect(buildUtahForecastJsonUrl('https://utahavalanchecenter.org/education')).toBeNull();
  });

  test('builds correct JSON URL for UAC region path', () => {
    expect(buildUtahForecastJsonUrl('https://utahavalanchecenter.org/forecast/salt-lake')).toBe(
      'https://utahavalanchecenter.org/forecast/salt-lake/json',
    );
  });

  test('strips www subdomain', () => {
    expect(buildUtahForecastJsonUrl('https://www.utahavalanchecenter.org/forecast/provo')).toBe(
      'https://utahavalanchecenter.org/forecast/provo/json',
    );
  });

  test('handles URL with query string or fragment after region', () => {
    expect(
      buildUtahForecastJsonUrl('https://utahavalanchecenter.org/forecast/uintas?date=2026-03-12'),
    ).toBe('https://utahavalanchecenter.org/forecast/uintas/json');
  });
});

// ============================================================================
// 2h. avalanche-detail.js — pickBestAvalancheDetailCandidate (additional paths)
// ============================================================================

describe('pickBestAvalancheDetailCandidate additional cases', () => {
  test('returns null for empty payloads array', () => {
    expect(pickBestAvalancheDetailCandidate({ payloads: [] })).toBeNull();
  });

  test('returns null for payloads that produce no useful detail', () => {
    // Candidate with no bottom_line, no problems, no danger → hasUsefulDetail=false
    const result = pickBestAvalancheDetailCandidate({
      payloads: [{ short_note: 'minimal' }],
    });
    expect(result).toBeNull();
  });

  test('picks the candidate with matching zoneId over generic rich payload', () => {
    const payloads = [
      {
        features: [
          {
            properties: {
              zone_id: 'zone-a',
              zone_name: 'Zone A',
              forecast_avalanche_problems: [{ name: 'Wind Slab' }],
              bottom_line: 'Watch for wind slabs.',
              danger: [{ level: 2 }],
            },
          },
          {
            properties: {
              zone_id: 'zone-b',
              zone_name: 'Zone B',
              forecast_avalanche_problems: [{ name: 'Storm Slab' }, { name: 'Persistent Slab' }, { name: 'Wet Slab' }],
              bottom_line: 'Multiple problems in play, use caution on all terrain.',
              danger: [{ level: 3 }],
            },
          },
        ],
      },
    ];

    const result = pickBestAvalancheDetailCandidate({
      payloads,
      zoneId: 'zone-a',
    });

    expect(result).not.toBeNull();
    expect(result.candidate.zone_id).toBe('zone-a');
  });
});

// ============================================================================
// 3. terrain-condition.js — snow profile code paths
// ============================================================================

// Helper: build a minimal weatherData object
const makeWeatherData = (overrides = {}) => ({
  description: 'Partly Cloudy',
  precipChance: 10,
  humidity: 50,
  temp: 55,
  windSpeed: 8,
  windGust: 12,
  trend: [],
  ...overrides,
});

describe('deriveTerrainCondition — spring_snow (corn-snow cycle)', () => {
  test('identifies corn-snow cycle with freeze-thaw temperature swing', () => {
    const condition = deriveTerrainCondition(
      makeWeatherData({
        description: 'Partly Sunny',
        temp: 33,
        precipChance: 10,
        humidity: 40,
        // Use temperatureContext24h to supply freeze-thaw signal
        temperatureContext24h: {
          windowHours: 24,
          overnightLowF: 25,
          daytimeHighF: 42,
        },
      }),
      {
        snotel: { snowDepthIn: 30, sweIn: 10, distanceKm: 5 },
        nohrsc: { snowDepthIn: 28, sweIn: 9 },
      },
      null,
    );

    expect(condition.code).toBe('spring_snow');
    expect(condition.label).toContain('Corn');
    expect(condition.snowProfile.code).toBe('spring_snow');
  });
});

describe('deriveTerrainCondition — wet_snow (wet/slushy snow)', () => {
  test('identifies wet slushy snow from warm temp + rain accumulation over snowpack', () => {
    const condition = deriveTerrainCondition(
      makeWeatherData({
        description: 'Rain',
        temp: 38,
        precipChance: 70,
        humidity: 90,
      }),
      {
        snotel: { snowDepthIn: 20, sweIn: 6, distanceKm: 10 },
        nohrsc: { snowDepthIn: 18, sweIn: 5 },
      },
      {
        totals: {
          rainPast12hIn: 0.3,
          rainPast24hIn: 0.6,
          rainPast48hIn: 0.8,
        },
      },
    );

    expect(condition.code).toBe('wet_snow');
    expect(condition.label).toContain('Wet');
    expect(condition.snowProfile.code).toBe('wet_slushy_snow');
  });
});

describe('deriveTerrainCondition — snow_ice (icy/firm snow)', () => {
  test('identifies icy hardpack from cold temp + snowpack + no fresh snow', () => {
    const condition = deriveTerrainCondition(
      makeWeatherData({
        description: 'Clear',
        temp: 18,
        precipChance: 5,
        humidity: 30,
        temperatureContext24h: {
          windowHours: 24,
          overnightLowF: 10,
          daytimeHighF: 26,
        },
      }),
      {
        snotel: { snowDepthIn: 35, sweIn: 12, distanceKm: 15 },
        nohrsc: { snowDepthIn: 32, sweIn: 11 },
      },
      {
        totals: {
          snowPast12hIn: 0,
          snowPast24hIn: 0,
          snowPast48hIn: 0,
        },
      },
    );

    expect(condition.code).toBe('snow_ice');
    expect(condition.label).toContain('Icy');
    expect(condition.snowProfile.code).toBe('icy_hardpack');
  });
});

describe('deriveTerrainCondition — cold_slick', () => {
  test('identifies cold/slick trail from freeze-thaw temperature context without snowpack', () => {
    // No snowpack data → no snow coverage, no snow weather signal (temp=33 but precip=10 < 35)
    // hasFreezeThawSignal: overnightLow=28 <= 31, daytimeHigh=42 >= 35 → true
    // cold_slick path is reached after dry_firm fails (temp=33 < 35)
    const condition = deriveTerrainCondition(
      makeWeatherData({
        description: 'Clear',
        temp: 33,
        precipChance: 10,
        humidity: 60,
        temperatureContext24h: {
          windowHours: 24,
          overnightLowF: 28,
          daytimeHighF: 42,
        },
      }),
      null, // no snowpack data
      null,
    );

    expect(condition.code).toBe('cold_slick');
    expect(condition.label).toContain('Slick');
    expect(condition.impact).toBe('moderate');
  });

  test('cold_slick triggered by near-freezing temp (30-36F) with moderate precip chance', () => {
    // hasFreezeThawSignal second clause: tempF >= 30 && tempF <= 36 && precipChance >= 35
    // No snow coverage, no snow weather signal (temp=35, but precip=40 >= 35 only when temp<=34)
    // dry_firm fails: temp=35 >= 35 but precip=40 > 25 OR humidity=65 — actually humidity=65 <= 75, temp=35>=35,
    // but precipChance=40 > 25, so noSnowOrWetSignal check needs to pass and precip<=25 fails.
    // Wait: the dry_firm check is `noSnowOrWetSignal && precipChance <= 25 && humidity <= 75 && tempF >= 35`
    // precipChance=40 > 25 → dry_firm fails. Then snow paths: no snow signals. Then wet_muddy: no wet signals.
    // Then cold_slick: hasFreezeThawSignal (temp=35, precip=40) OR (temp 30-36 AND precip>=35) → temp=35 in range, precip=40>=35 → true.
    const condition = deriveTerrainCondition(
      makeWeatherData({
        description: 'Mostly Cloudy',
        temp: 35,
        precipChance: 40,
        humidity: 65,
      }),
      null,
      null,
    );

    expect(condition.code).toBe('cold_slick');
  });
});

describe('deriveTerrainCondition — dry_loose', () => {
  test('identifies dry loose surface from hasDryWindySignal (low humidity + gusty) when dry_firm fails due to cold temp', () => {
    // dry_firm check fails because temp=28 < 35.
    // No snow weather signal: temp=28 <= 34 but precipChance=10 < 35 → no snow signal.
    // No wet signals, no freeze-thaw (trend empty, no temperatureContext24h, temp=28 not in 30-36 range with precip<35).
    // hasDryWindySignal: humidity=18 <= 30 AND (gustMph=28 >= 25) → true → dry_loose.
    const condition = deriveTerrainCondition(
      makeWeatherData({
        description: 'Windy',
        temp: 28,
        precipChance: 10,
        humidity: 18,
        windSpeed: 20,
        windGust: 28,
      }),
      null,
      null,
    );

    expect(condition.code).toBe('dry_loose');
    expect(condition.label).toContain('Dry');
  });

  test('dry_loose triggered by low humidity fallback when dry_firm fails on temp', () => {
    // dry_firm fails because temp=28 < 35. No snow/wet/freeze signals.
    // hasDryWindySignal: humidity=22 <= 30 AND (gust=8 < 25 AND wind=5 < 16) → false.
    // Fallback: humidity < 30 AND precip < 20 → dry_loose.
    const condition = deriveTerrainCondition(
      makeWeatherData({
        description: 'Clear',
        temp: 28,
        precipChance: 10,
        humidity: 22,
        windSpeed: 5,
        windGust: 8,
      }),
      null,
      null,
    );

    expect(condition.code).toBe('dry_loose');
  });
});

describe('deriveTerrainCondition — weather_unavailable', () => {
  test('returns weather_unavailable when description signals unavailability', () => {
    const condition = deriveTerrainCondition(
      {
        description: 'Weather data unavailable',
        precipChance: null,
        humidity: null,
        temp: null,
        windSpeed: null,
        windGust: null,
        trend: [],
      },
      null,
      null,
    );

    expect(condition.code).toBe('weather_unavailable');
    expect(condition.confidence).toBe('low');
    expect(condition.impact).toBe('moderate');
  });
});

describe('deriveTerrainCondition — mixed_variable fallback', () => {
  test('returns mixed_variable when no dominant signal is present', () => {
    // A mix: moderate precip chance, near-but-not-at-freeze temp, moderate humidity
    // Should not cleanly trigger any specific branch
    const condition = deriveTerrainCondition(
      makeWeatherData({
        description: 'Partly Cloudy',
        temp: 44,
        precipChance: 28,
        humidity: 55,
        windSpeed: 10,
        windGust: 14,
      }),
      null,
      null,
    );

    // With these signals: no snow, no wet, no freeze-thaw, no dry-loose
    // noSnowOrWetSignal might be true but temp < 35 fails the dry_firm check
    // and the condition doesn't reach freeze-thaw (no freeze-thaw flag)
    // Let's verify it isn't dry_firm because temp=44 >= 35 but precipChance=28 > 25
    // dry_firm: precipChance <= 25 fails, so not dry_firm
    // cold_slick: hasFreezeThawSignal needs temp 30-36 AND precip>=35, 44 doesn't satisfy
    // Result should be mixed_variable
    expect(condition.code).toBe('mixed_variable');
    expect(condition.impact).toBe('moderate');
  });
});

describe('deriveTerrainCondition — signals output', () => {
  test('includes all expected signal keys in returned object', () => {
    const condition = deriveTerrainCondition(
      makeWeatherData({ temp: 50, precipChance: 20, humidity: 60, windSpeed: 10, windGust: 15 }),
      null,
      null,
    );

    const { signals } = condition;
    expect(signals).toHaveProperty('tempF');
    expect(signals).toHaveProperty('precipChance');
    expect(signals).toHaveProperty('humidity');
    expect(signals).toHaveProperty('windMph');
    expect(signals).toHaveProperty('gustMph');
    expect(signals).toHaveProperty('wetTrendHours');
    expect(signals).toHaveProperty('snowTrendHours');
    expect(signals).toHaveProperty('maxSnowDepthIn');
    expect(signals).toHaveProperty('maxSweIn');
    expect(signals).toHaveProperty('freezeThawMinTempF');
    expect(signals).toHaveProperty('freezeThawMaxTempF');
  });
});

describe('deriveTerrainCondition — SNOTEL proximity gate', () => {
  test('excludes SNOTEL data when station is more than 80 km away', () => {
    const condition = deriveTerrainCondition(
      makeWeatherData({ description: 'Clear', temp: 55, precipChance: 5, humidity: 40 }),
      {
        // distanceKm > 80 → station excluded from depth/SWE samples
        snotel: { snowDepthIn: 100, sweIn: 40, distanceKm: 120 },
        nohrsc: { snowDepthIn: 0, sweIn: 0 },
      },
      null,
    );

    // With SNOTEL excluded and NOHRSC showing 0 depth/SWE, no snow coverage
    // dry_firm should be selected
    expect(condition.code).toBe('dry_firm');
    // The distant SNOTEL note should appear in reasons
    expect(condition.reasons.join(' ')).toMatch(/km away/i);
  });
});

describe('deriveTrailStatus', () => {
  test('returns a label string for any valid input', () => {
    const label = deriveTrailStatus(makeWeatherData(), null, null);
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
  });

  test('returns a fallback label for null weatherData (weather unavailable signal)', () => {
    // null weatherData → description coerces to '' → weatherUnavailableSignal triggers
    const label = deriveTrailStatus(null, null, null);
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// 4. gear-suggestions.js — uncovered branches
// ============================================================================

// Base input with benign conditions (no suggestions beyond baseline)
const baseSuggestionInput = () => ({
  weatherData: {
    temp: 60,
    feelsLike: 58,
    description: 'Mostly Sunny',
    windSpeed: 8,
    windGust: 12,
    precipChance: 10,
    humidity: 45,
    isDaytime: true,
  },
  trailStatus: 'dry',
  avalancheData: { relevant: false, dangerLevel: 0, dangerUnknown: false },
  airQualityData: { usAqi: 30 },
  alertsData: { activeCount: 0 },
  rainfallData: null,
  snowpackData: null,
  fireRiskData: { level: 0, label: 'Low' },
  heatRiskData: { level: 0 },
});

describe('buildLayeringGearSuggestions — always-present baseline', () => {
  test('always includes layering-core suggestion', () => {
    const suggestions = buildLayeringGearSuggestions(baseSuggestionInput());
    expect(suggestions.some((s) => s.id === 'layering-core')).toBe(true);
  });

  test('output is limited to 10 items maximum', () => {
    // Force many suggestions by triggering multiple branches
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      weatherData: {
        temp: -5,
        feelsLike: -20,
        description: 'Blizzard',
        windSpeed: 35,
        windGust: 55,
        precipChance: 95,
        humidity: 90,
        isDaytime: true,
      },
      trailStatus: 'icy snowy',
      avalancheData: { relevant: true, dangerLevel: 4, dangerUnknown: false },
      airQualityData: { usAqi: 180 },
      alertsData: { activeCount: 3 },
      snowpackData: {
        snotel: { snowDepthIn: 80, sweIn: 25 },
        nohrsc: { snowDepthIn: 70, sweIn: 22 },
      },
      fireRiskData: { level: 4, label: 'Extreme' },
      heatRiskData: { level: 0 },
    });

    expect(suggestions.length).toBeLessThanOrEqual(10);
  });

  test('each suggestion has required fields: id, title, detail, category, tone', () => {
    const suggestions = buildLayeringGearSuggestions(baseSuggestionInput());
    for (const s of suggestions) {
      expect(typeof s.id).toBe('string');
      expect(typeof s.title).toBe('string');
      expect(typeof s.detail).toBe('string');
      expect(typeof s.category).toBe('string');
      expect(typeof s.tone).toBe('string');
      // priority should NOT be in output (it is stripped)
      expect(s.priority).toBeUndefined();
    }
  });
});

describe('buildLayeringGearSuggestions — very cold extremities', () => {
  test('adds cold extremities kit when feels-like is at or below 5F', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      weatherData: {
        ...baseSuggestionInput().weatherData,
        temp: 0,
        feelsLike: 5,
        description: 'Clear',
      },
    });

    expect(suggestions.some((s) => s.id === 'extremities-cold')).toBe(true);
  });

  test('does not add cold extremities kit for mild conditions', () => {
    const suggestions = buildLayeringGearSuggestions(baseSuggestionInput());
    expect(suggestions.some((s) => s.id === 'extremities-cold')).toBe(false);
  });
});

describe('buildLayeringGearSuggestions — alpine hardware', () => {
  test('adds alpine hardware for deep snowpack (>= 12 in)', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      snowpackData: {
        snotel: { snowDepthIn: 15, sweIn: 5 },
        nohrsc: { snowDepthIn: 12, sweIn: 4 },
      },
      weatherData: {
        ...baseSuggestionInput().weatherData,
        description: 'Snow Showers',
        temp: 25,
        feelsLike: 12,
      },
      trailStatus: 'snowy icy',
    });

    expect(suggestions.some((s) => s.id === 'alpine-hardware')).toBe(true);
  });

  test('adds alpine hardware for icy + cold combination', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      weatherData: {
        ...baseSuggestionInput().weatherData,
        temp: 10,
        feelsLike: -2,
        description: 'Clear',
      },
      trailStatus: 'icy conditions',
    });

    // icy && feelsLikeF <= 20 → alpine-hardware
    expect(suggestions.some((s) => s.id === 'alpine-hardware')).toBe(true);
  });
});

describe('buildLayeringGearSuggestions — emergency shelter', () => {
  test('adds emergency shelter when active alerts AND cold', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      weatherData: {
        ...baseSuggestionInput().weatherData,
        temp: 8,
        feelsLike: -5,
        description: 'Clear',
      },
      alertsData: { activeCount: 1 },
    });

    expect(suggestions.some((s) => s.id === 'emergency-shelter')).toBe(true);
  });

  test('adds emergency shelter for high avalanche danger (>= 3) regardless of cold', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      avalancheData: { relevant: true, dangerLevel: 3, dangerUnknown: false },
    });

    expect(suggestions.some((s) => s.id === 'emergency-shelter')).toBe(true);
  });

  test('does not add emergency shelter for benign conditions', () => {
    const suggestions = buildLayeringGearSuggestions(baseSuggestionInput());
    expect(suggestions.some((s) => s.id === 'emergency-shelter')).toBe(false);
  });
});

describe('buildLayeringGearSuggestions — low-visibility navigation', () => {
  test('adds navigation suggestion for fog description', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      weatherData: {
        ...baseSuggestionInput().weatherData,
        description: 'Dense Fog',
      },
    });

    expect(suggestions.some((s) => s.id === 'navigation-low-vis')).toBe(true);
  });

  test('adds navigation suggestion for smoke', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      weatherData: {
        ...baseSuggestionInput().weatherData,
        description: 'Heavy Smoke',
      },
    });

    expect(suggestions.some((s) => s.id === 'navigation-low-vis')).toBe(true);
  });

  test('adds navigation for blizzard conditions', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      weatherData: {
        ...baseSuggestionInput().weatherData,
        description: 'Blizzard',
        temp: 5,
        feelsLike: -10,
        windSpeed: 40,
        windGust: 60,
      },
    });

    expect(suggestions.some((s) => s.id === 'navigation-low-vis')).toBe(true);
  });

  test('does not add navigation for clear sunny conditions', () => {
    const suggestions = buildLayeringGearSuggestions(baseSuggestionInput());
    expect(suggestions.some((s) => s.id === 'navigation-low-vis')).toBe(false);
  });
});

describe('buildLayeringGearSuggestions — fire risk gear', () => {
  test('adds fire/heat prep for fire risk level >= 3', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      fireRiskData: { level: 3, label: 'High' },
    });

    expect(suggestions.some((s) => s.id === 'fire-risk')).toBe(true);
  });

  test('adds fire/heat prep for fire risk level = 4', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      fireRiskData: { level: 4, label: 'Extreme' },
    });

    expect(suggestions.some((s) => s.id === 'fire-risk')).toBe(true);
  });

  test('does not add fire gear for fire risk level < 3', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      fireRiskData: { level: 2, label: 'Elevated' },
    });

    expect(suggestions.some((s) => s.id === 'fire-risk')).toBe(false);
  });
});

describe('buildLayeringGearSuggestions — sun protection', () => {
  test('adds sun protection for warm daytime conditions', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      weatherData: {
        ...baseSuggestionInput().weatherData,
        temp: 70,
        feelsLike: 72,
        isDaytime: true,
      },
    });

    expect(suggestions.some((s) => s.id === 'sun-protection')).toBe(true);
  });

  test('does not add sun protection when isDaytime is false', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      weatherData: {
        ...baseSuggestionInput().weatherData,
        temp: 70,
        feelsLike: 72,
        isDaytime: false,
      },
    });

    expect(suggestions.some((s) => s.id === 'sun-protection')).toBe(false);
  });

  test('does not add sun protection when feels-like is below 68F', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      weatherData: {
        ...baseSuggestionInput().weatherData,
        temp: 62,
        feelsLike: 60,
        isDaytime: true,
      },
    });

    expect(suggestions.some((s) => s.id === 'sun-protection')).toBe(false);
  });
});

describe('buildLayeringGearSuggestions — heat hydration and electrolytes', () => {
  test('adds heat hydration for heat level >= 1', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      heatRiskData: { level: 1 },
    });

    expect(suggestions.some((s) => s.id === 'hydration-heat')).toBe(true);
  });

  test('adds electrolytes for heat level >= 2', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      heatRiskData: { level: 2 },
    });

    expect(suggestions.some((s) => s.id === 'electrolytes-heat')).toBe(true);
    expect(suggestions.some((s) => s.id === 'hydration-heat')).toBe(true);
  });

  test('does not add electrolytes for heat level 1', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      heatRiskData: { level: 1 },
    });

    expect(suggestions.some((s) => s.id === 'electrolytes-heat')).toBe(false);
  });

  test('does not add heat hydration for heat level 0', () => {
    const suggestions = buildLayeringGearSuggestions(baseSuggestionInput());
    expect(suggestions.some((s) => s.id === 'hydration-heat')).toBe(false);
  });
});

describe('buildLayeringGearSuggestions — avalanche rescue kit', () => {
  test('adds avalanche kit for relevant avy danger >= 2 with caution tone', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      avalancheData: { relevant: true, dangerLevel: 2, dangerUnknown: false },
    });

    const kit = suggestions.find((s) => s.id === 'avalanche-kit');
    expect(kit).toBeDefined();
    expect(kit.tone).toBe('caution');
  });

  test('uses nogo tone for danger level >= 4', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      avalancheData: { relevant: true, dangerLevel: 4, dangerUnknown: false },
    });

    const kit = suggestions.find((s) => s.id === 'avalanche-kit');
    expect(kit).toBeDefined();
    expect(kit.tone).toBe('nogo');
  });

  test('adds avalanche unknown coverage suggestion when dangerUnknown is true', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      avalancheData: { relevant: true, dangerLevel: null, dangerUnknown: true },
    });

    expect(suggestions.some((s) => s.id === 'avalanche-unknown')).toBe(true);
  });

  test('does not add avalanche kit when relevant is explicitly false', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      avalancheData: { relevant: false, dangerLevel: 4, dangerUnknown: false },
    });

    expect(suggestions.some((s) => s.id === 'avalanche-kit')).toBe(false);
  });

  test('does not add avalanche kit for danger level 1 (below threshold)', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      avalancheData: { relevant: true, dangerLevel: 1, dangerUnknown: false },
    });

    expect(suggestions.some((s) => s.id === 'avalanche-kit')).toBe(false);
  });
});

describe('buildLayeringGearSuggestions — snow/ice traction', () => {
  test('adds traction-snow for fresh snow accumulation signal', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      rainfallData: {
        totals: { snowPast24hIn: 4 },
      },
    });

    expect(suggestions.some((s) => s.id === 'traction-snow')).toBe(true);
  });

  test('adds traction-snow when maxObservedSnowDepthIn >= 4 in', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      snowpackData: {
        snotel: { snowDepthIn: 6, sweIn: 2 },
        nohrsc: null,
      },
      weatherData: {
        ...baseSuggestionInput().weatherData,
        description: 'Clear',
        temp: 25,
        feelsLike: 15,
      },
    });

    expect(suggestions.some((s) => s.id === 'traction-snow')).toBe(true);
  });

  test('adds traction-snow for icy trail status', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      trailStatus: 'icy conditions',
    });

    expect(suggestions.some((s) => s.id === 'traction-snow')).toBe(true);
  });
});

describe('buildLayeringGearSuggestions — shell selection logic', () => {
  test('uses light shell when no wet or snow/wind signal', () => {
    const suggestions = buildLayeringGearSuggestions(baseSuggestionInput());
    expect(suggestions.some((s) => s.id === 'shell-light')).toBe(true);
    expect(suggestions.some((s) => s.id === 'shell-wet')).toBe(false);
    expect(suggestions.some((s) => s.id === 'shell-wind-snow')).toBe(false);
  });

  test('uses wind/snow shell for snowy conditions (no "shower"/"rain" in description)', () => {
    // Description must not match /rain|shower|drizzle|wet|thunder|storm/ to avoid shell-wet.
    // 'Snow Showers' contains 'shower' → triggers hasWetSignal → shell-wet.
    // Use 'Heavy Snow' instead which has no wet keyword.
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      weatherData: {
        ...baseSuggestionInput().weatherData,
        description: 'Heavy Snow',
        temp: 22,
        feelsLike: 10,
        precipChance: 70,
        windSpeed: 15,
        windGust: 22,
      },
    });

    // precipChance=70 and temp=22 (<= 30) → hasWetSignal's second clause (temp > 30) does not fire.
    // 'Heavy Snow' matches no wet keywords → hasWetSignal=false.
    // hasSnowSignal: 'snow' in description → true → shell-wind-snow selected.
    expect(suggestions.some((s) => s.id === 'shell-wind-snow')).toBe(true);
    expect(suggestions.some((s) => s.id === 'shell-wet')).toBe(false);
  });

  test('uses storm shell (wet) for rain description', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      weatherData: {
        ...baseSuggestionInput().weatherData,
        description: 'Rain Showers',
        temp: 50,
        feelsLike: 48,
        precipChance: 75,
      },
    });

    expect(suggestions.some((s) => s.id === 'shell-wet')).toBe(true);
    expect(suggestions.some((s) => s.id === 'shell-wind-snow')).toBe(false);
  });
});

describe('buildLayeringGearSuggestions — humidity moisture backup', () => {
  test('adds humidity-management for humidity > 80%', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      weatherData: {
        ...baseSuggestionInput().weatherData,
        humidity: 85,
      },
    });

    expect(suggestions.some((s) => s.id === 'humidity-management')).toBe(true);
  });

  test('does not add humidity-management at or below 80%', () => {
    const suggestions = buildLayeringGearSuggestions({
      ...baseSuggestionInput(),
      weatherData: {
        ...baseSuggestionInput().weatherData,
        humidity: 80,
      },
    });

    expect(suggestions.some((s) => s.id === 'humidity-management')).toBe(false);
  });
});
