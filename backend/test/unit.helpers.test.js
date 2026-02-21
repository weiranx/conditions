const {
  normalizeWindDirection,
  parseStartClock,
  buildPlannedStartIso,
  buildLayeringGearSuggestions,
  buildFireRiskData,
  calculateSafetyScore,
  findMatchingAvalancheZone,
  resolveAvalancheCenterLink,
  resolveNwsAlertSourceLink,
  evaluateAvalancheRelevance,
  deriveTerrainCondition,
  deriveTrailStatus,
  deriveOverallDangerLevelFromElevations,
  applyDerivedOverallAvalancheDanger,
  parseAvalancheDetailPayloads,
  pickBestAvalancheDetailCandidate,
  normalizeAvalancheProblemCollection,
  buildUtahForecastJsonUrl,
  extractUtahAvalancheAdvisory,
} = require('../index');
const { findNearestCardinalFromDegreeSeries, estimateWindGustFromWindSpeed, inferWindGustFromPeriods } = require('../src/utils/wind');
const { parseIsoTimeToMsWithReference } = require('../src/utils/time');

test('normalizeWindDirection handles cardinal abbreviations and words', () => {
  expect(normalizeWindDirection('NW')).toBe('NW');
  expect(normalizeWindDirection('Northwest')).toBe('NW');
  expect(normalizeWindDirection('South East')).toBe('SE');
  expect(normalizeWindDirection('West-northwest')).toBe('WNW');
});

test('normalizeWindDirection handles calm and variable cases', () => {
  expect(normalizeWindDirection('Calm')).toBe('CALM');
  expect(normalizeWindDirection('variable winds')).toBe('VRB');
});

test('normalizeWindDirection returns null for unsupported input', () => {
  expect(normalizeWindDirection('')).toBeNull();
  expect(normalizeWindDirection('upwind-ish')).toBeNull();
  expect(normalizeWindDirection(null)).toBeNull();
});

test('findNearestCardinalFromDegreeSeries infers from nearest hours when anchor is missing', () => {
  const degreeSeries = [null, undefined, 'bad', 225, null];
  expect(findNearestCardinalFromDegreeSeries(degreeSeries, 2)).toBe('SW');
  expect(findNearestCardinalFromDegreeSeries([null, null], 0)).toBeNull();
});

test('estimateWindGustFromWindSpeed produces gust higher than sustained wind for non-calm conditions', () => {
  expect(estimateWindGustFromWindSpeed(0)).toBe(0);
  expect(estimateWindGustFromWindSpeed(5)).toBe(7);
  expect(estimateWindGustFromWindSpeed(12)).toBe(15);
  expect(estimateWindGustFromWindSpeed(25)).toBe(34);
});

test('inferWindGustFromPeriods uses nearby gust when direct hour has no gust', () => {
  const periods = [
    { windSpeed: '10 mph', windGust: null },
    { windSpeed: '12 mph', windGust: '18 mph' },
    { windSpeed: '11 mph', windGust: null },
  ];

  const inferred = inferWindGustFromPeriods(periods, 2, 11);
  expect(inferred.source).toBe('inferred_nearby');
  expect(inferred.gustMph).toBeGreaterThan(11);
});

test('inferWindGustFromPeriods estimates gust when feed has no gust values', () => {
  const periods = [
    { windSpeed: '18 mph', windGust: null },
    { windSpeed: '19 mph', windGust: undefined },
  ];

  const inferred = inferWindGustFromPeriods(periods, 0, 18);
  expect(inferred.source).toBe('estimated_from_wind');
  expect(inferred.gustMph).toBeGreaterThan(18);
});

test('parseStartClock validates HH:mm values', () => {
  expect(parseStartClock('04:30')).toBe('04:30');
  expect(parseStartClock('23:59')).toBe('23:59');
  expect(parseStartClock(' 06:05 ')).toBe('06:05');
  expect(parseStartClock('24:00')).toBeNull();
  expect(parseStartClock('4:30')).toBeNull();
  expect(parseStartClock('bad')).toBeNull();
});

test('buildPlannedStartIso combines date, start clock, and timezone suffix', () => {
  const iso = buildPlannedStartIso({
    selectedDate: '2026-02-20',
    startClock: '06:15',
    referenceIso: '2026-02-20T05:00:00-08:00',
  });
  expect(iso).toBe('2026-02-20T06:15:00-08:00');

  const utcIso = buildPlannedStartIso({
    selectedDate: '2026-02-20',
    startClock: '06:15',
    referenceIso: null,
  });
  expect(utcIso).toBe('2026-02-20T06:15:00Z');
});

test('buildPlannedStartIso falls back to reference ISO for invalid inputs', () => {
  expect(
    buildPlannedStartIso({
      selectedDate: '02-20-2026',
      startClock: '06:15',
      referenceIso: '2026-02-20T05:00:00-08:00',
    }),
  ).toBe('2026-02-20T05:00:00-08:00');

  expect(
    buildPlannedStartIso({
      selectedDate: '2026-02-20',
      startClock: null,
      referenceIso: '2026-02-20T05:00:00-08:00',
    }),
  ).toBe('2026-02-20T05:00:00-08:00');
});

test('parseIsoTimeToMsWithReference applies reference timezone when timestamp omits offset', () => {
  const parsedMs = parseIsoTimeToMsWithReference('2026-02-21T14:58:00', '2026-02-21T11:00:00-08:00');
  expect(parsedMs).not.toBeNull();
  expect(new Date(parsedMs).toISOString()).toBe('2026-02-21T22:58:00.000Z');
});

test('parseIsoTimeToMsWithReference respects explicit timezone in value', () => {
  const parsedMs = parseIsoTimeToMsWithReference('2026-02-21T14:58:00Z', '2026-02-21T11:00:00-08:00');
  expect(parsedMs).not.toBeNull();
  expect(new Date(parsedMs).toISOString()).toBe('2026-02-21T14:58:00.000Z');
});

test('resolveAvalancheCenterLink uses CAIC forecast page with coordinates when only homepage is available', () => {
  expect(
    resolveAvalancheCenterLink({
      centerId: 'CAIC',
      link: 'https://avalanche.state.co.us/',
      centerLink: 'https://avalanche.state.co.us/',
      lat: 39.1178,
      lon: -106.4454,
    }),
  ).toBe('https://avalanche.state.co.us/?lat=39.11780&lng=-106.44540');
});

test('resolveAvalancheCenterLink canonicalizes CAIC map links to root query format', () => {
  expect(
    resolveAvalancheCenterLink({
      centerId: 'CAIC',
      link: 'https://avalanche.state.co.us/home?lat=39.5&lng=-106.2',
      centerLink: 'https://avalanche.state.co.us/',
      lat: 39.1178,
      lon: -106.4454,
    }),
  ).toBe('https://avalanche.state.co.us/?lat=39.5&lng=-106.2');
});

test('resolveAvalancheCenterLink avoids api links when a public center link exists', () => {
  expect(
    resolveAvalancheCenterLink({
      centerId: 'NWAC',
      link: 'https://api.avalanche.org/v2/public/product/1234',
      centerLink: 'https://nwac.us/avalanche-forecast/',
      lat: 47.2,
      lon: -121.4,
    }),
  ).toBe('https://nwac.us/avalanche-forecast/');
});

test('resolveAvalancheCenterLink normalizes http center links to https', () => {
  expect(
    resolveAvalancheCenterLink({
      centerId: 'NWAC',
      link: 'http://www.nwac.us/avalanche-forecast/#/west-slopes-south',
      centerLink: null,
      lat: 47.2,
      lon: -121.4,
    }),
  ).toBe('https://nwac.us/avalanche-forecast/#/west-slopes-south');
});

test('resolveNwsAlertSourceLink prefers individual alert id URL over generic weather.gov web link', () => {
  expect(
    resolveNwsAlertSourceLink({
      feature: { id: 'https://api.weather.gov/alerts/ABC123' },
      props: { web: 'http://www.weather.gov' },
      lat: 46.8523,
      lon: -121.7603,
    }),
  ).toBe('https://api.weather.gov/alerts/ABC123');
});

test('resolveNwsAlertSourceLink uses direct web/url fields when no alert id is available', () => {
  expect(
    resolveNwsAlertSourceLink({
      feature: {},
      props: { web: 'http://forecast.weather.gov/wwamap/wwatxtget.php?cwa=sew&wwa=Winter%20Storm%20Warning' },
      lat: 46.8523,
      lon: -121.7603,
    }),
  ).toBe('https://forecast.weather.gov/wwamap/wwatxtget.php?cwa=sew&wwa=Winter%20Storm%20Warning');
});

test('resolveNwsAlertSourceLink accepts props.url when present', () => {
  expect(
    resolveNwsAlertSourceLink({
      feature: {},
      props: { url: 'http://forecast.weather.gov/wwamap/wwatxtget.php?cwa=slc&wwa=Winter%20Weather%20Advisory' },
      lat: 40.7763,
      lon: -110.3729,
    }),
  ).toBe('https://forecast.weather.gov/wwamap/wwatxtget.php?cwa=slc&wwa=Winter%20Weather%20Advisory');
});

test('resolveNwsAlertSourceLink builds alert endpoint from URN id when no direct url exists', () => {
  expect(
    resolveNwsAlertSourceLink({
      feature: { id: 'urn:oid:2.49.0.1.840.0.a1b2c3d4' },
      props: { id: 'urn:oid:2.49.0.1.840.0.a1b2c3d4' },
      lat: 46.8523,
      lon: -121.7603,
    }),
  ).toBe('https://api.weather.gov/alerts/urn%3Aoid%3A2.49.0.1.840.0.a1b2c3d4');
});

test('resolveNwsAlertSourceLink falls back to alerts point feed link', () => {
  expect(
    resolveNwsAlertSourceLink({
      feature: {},
      props: {},
      lat: 39.1178,
      lon: -106.4454,
    }),
  ).toBe('https://api.weather.gov/alerts/active?point=39.1178,-106.4454');
});

test('parseAvalancheDetailPayloads parses JSON followed by warning HTML', () => {
  const payloads = parseAvalancheDetailPayloads(
    '{"forecast_avalanche_problems":[{"name":"Wind Slab"}]}<br /><b>Warning</b>: test',
  );
  expect(payloads).toHaveLength(1);
  expect(payloads[0].forecast_avalanche_problems).toHaveLength(1);
});

test('parseAvalancheDetailPayloads parses concatenated JSON documents', () => {
  const payloads = parseAvalancheDetailPayloads(
    '{"forecast_avalanche_problems":[],"danger":[]}{"forecast_avalanche_problems":[{"name":"Persistent Slab","likelihood":"likely"}],"zone_id":"1740"}',
  );
  expect(payloads.length).toBeGreaterThanOrEqual(2);
  expect(
    payloads.some(
      (entry) =>
        Array.isArray(entry.forecast_avalanche_problems)
        && entry.forecast_avalanche_problems.length === 1
        && entry.zone_id === '1740',
    ),
  ).toBe(true);
});

test('pickBestAvalancheDetailCandidate prefers zone-matched rich payload', () => {
  const payloads = [
    {
      forecast_avalanche_problems: [],
      danger: [],
      zone_id: '9999',
    },
    {
      forecast_avalanche_problems: [
        {
          name: 'Wind Slab',
          likelihood: 3,
          location: { aspects: ['N', 'NE'], elevations: ['upper'] },
        },
      ],
      zone_id: '1740',
      center_id: 'UAC',
    },
  ];

  const picked = pickBestAvalancheDetailCandidate({
    payloads,
    centerId: 'UAC',
    zoneId: 1740,
    zoneSlug: 'uintas',
    zoneName: 'Uintas',
  });

  expect(picked).not.toBeNull();
  expect(picked.candidate.zone_id).toBe('1740');
  expect(picked.problems).toHaveLength(1);
  expect(picked.problems[0].likelihood).toBe('likely');
  expect(Array.isArray(picked.problems[0].location)).toBe(true);
});

test('normalizeAvalancheProblemCollection normalizes likelihood and location variants', () => {
  const normalized = normalizeAvalancheProblemCollection([
    {
      name: 'Persistent Slab',
      likelihood: { min: 2, max: 3 },
      location: { aspects: ['N', 'NE'], elevations: ['upper', 'middle'] },
    },
  ]);

  expect(normalized).toHaveLength(1);
  expect(normalized[0].likelihood).toBe('possible to likely');
  expect(Array.isArray(normalized[0].location)).toBe(true);
  expect(normalized[0].location).toEqual(
    expect.arrayContaining(['aspects', 'N', 'NE', 'elevations', 'upper', 'middle']),
  );
});

test('buildUtahForecastJsonUrl builds advisory json endpoint from UAC forecast page link', () => {
  expect(buildUtahForecastJsonUrl('https://utahavalanchecenter.org/forecast/uintas')).toBe(
    'https://utahavalanchecenter.org/forecast/uintas/json',
  );
  expect(buildUtahForecastJsonUrl('https://www.utahavalanchecenter.org/forecast/salt-lake')).toBe(
    'https://utahavalanchecenter.org/forecast/salt-lake/json',
  );
  expect(buildUtahForecastJsonUrl('https://nwac.us/avalanche-forecast/#/west-slopes-south')).toBeNull();
});

test('extractUtahAvalancheAdvisory extracts bottom line and problem set from UAC advisory payload', () => {
  const parsed = extractUtahAvalancheAdvisory({
    advisories: [
      {
        advisory: {
          date_issued_timestamp: '1771583940',
          bottom_line: 'Very dangerous avalanche conditions.',
          avalanche_problem_1: 'Wind Drifted Snow',
          avalanche_problem_1_description: 'Wind loaded slopes are touchy.',
          avalanche_problem_2: 'Persistent Weak Layer',
          avalanche_problem_2_description: 'Deep slabs remain possible.',
        },
      },
    ],
  });

  expect(parsed).not.toBeNull();
  expect(parsed.bottomLine).toContain('Very dangerous');
  expect(parsed.problems).toHaveLength(2);
  expect(parsed.problems[0].name).toBe('Wind Drifted Snow');
  expect(parsed.publishedTime).toBe('2026-02-20T10:39:00.000Z');
});

test('buildLayeringGearSuggestions includes core layering framework and weather shell choice', () => {
  const suggestions = buildLayeringGearSuggestions({
    weatherData: {
      temp: 36,
      feelsLike: 29,
      description: 'Chance Rain Showers',
      windSpeed: 14,
      windGust: 22,
      precipChance: 70,
      humidity: 88,
    },
    trailStatus: '🌧️ Muddy / Slick',
    avalancheData: { relevant: false, dangerLevel: 0, dangerUnknown: false },
    airQualityData: { usAqi: 40 },
    alertsData: { activeCount: 0 },
  });

  expect(suggestions.some((item) => item.includes('Layering core'))).toBe(true);
  expect(suggestions.some((item) => item.includes('Weather shell'))).toBe(true);
  expect(suggestions.some((item) => item.includes('Traction strategy'))).toBe(true);
});

test('buildLayeringGearSuggestions adds hazard-specific items when risk signals are present', () => {
  const suggestions = buildLayeringGearSuggestions({
    weatherData: {
      temp: 10,
      feelsLike: -2,
      description: 'Heavy Snow',
      windSpeed: 20,
      windGust: 35,
      precipChance: 90,
      humidity: 75,
    },
    trailStatus: '❄️ Snowy / Icy',
    avalancheData: { relevant: true, dangerLevel: 3, dangerUnknown: false },
    airQualityData: { usAqi: 120 },
    alertsData: { activeCount: 2 },
  });

  expect(suggestions.some((item) => item.includes('Static insulation'))).toBe(true);
  expect(suggestions.some((item) => item.includes('Avalanche rescue kit'))).toBe(true);
  expect(suggestions.some((item) => item.includes('Air quality protection'))).toBe(true);
  expect(suggestions.some((item) => item.includes('Comms and contingency'))).toBe(true);
});

test('buildFireRiskData marks high risk for red flag warning', () => {
  const fireRisk = buildFireRiskData({
    weatherData: {
      temp: 86,
      humidity: 18,
      windSpeed: 22,
      windGust: 35,
      description: 'Sunny',
    },
    alertsData: {
      status: 'ok',
      alerts: [{ event: 'Red Flag Warning', severity: 'Severe', expires: '2026-02-20T22:00:00Z' }],
    },
    airQualityData: { usAqi: 42 },
  });

  expect(fireRisk.status).toBe('ok');
  expect(fireRisk.level).toBeGreaterThanOrEqual(4);
  expect(fireRisk.label).toBe('Extreme');
});

test('buildFireRiskData marks elevated risk for dry/breezy weather without alerts', () => {
  const fireRisk = buildFireRiskData({
    weatherData: {
      temp: 78,
      humidity: 26,
      windSpeed: 14,
      windGust: 21,
      description: 'Mostly Clear',
    },
    alertsData: {
      status: 'none',
      alerts: [],
    },
    airQualityData: { usAqi: 55 },
  });

  expect(fireRisk.status).toBe('ok');
  expect(fireRisk.level).toBeGreaterThanOrEqual(2);
  expect(Array.isArray(fireRisk.reasons)).toBe(true);
});

test('deriveTrailStatus uses snowpack coverage and avoids Hero Dirt label', () => {
  const status = deriveTrailStatus(
    {
      description: 'Mostly Sunny',
      precipChance: 10,
      humidity: 45,
      temp: 39,
      trend: [],
    },
    {
      snotel: { snowDepthIn: 6, sweIn: 2, distanceKm: 8 },
      nohrsc: { snowDepthIn: 5, sweIn: 1.7 },
    },
  );

  expect(status).toBe('❄️ Snow-Covered / Icy');
  expect(status).not.toMatch(/Hero Dirt/i);
});

test('deriveTrailStatus marks wet surface from near-term precipitation signal', () => {
  const status = deriveTrailStatus(
    {
      description: 'Mostly Cloudy',
      precipChance: 25,
      humidity: 55,
      temp: 46,
      trend: [
        { precipChance: 30, condition: 'Cloudy' },
        { precipChance: 65, condition: 'Rain showers' },
      ],
    },
    {
      snotel: { snowDepthIn: 0, sweIn: 0, distanceKm: 6 },
      nohrsc: { snowDepthIn: 0, sweIn: 0 },
    },
  );

  expect(status).toBe('🌧️ Wet / Muddy');
});

test('deriveTrailStatus marks wet surface from rolling rainfall totals', () => {
  const status = deriveTrailStatus(
    {
      description: 'Partly Cloudy',
      precipChance: 10,
      humidity: 48,
      temp: 49,
      trend: [{ precipChance: 10, condition: 'Partly Cloudy' }],
    },
    {
      snotel: { snowDepthIn: 0, sweIn: 0, distanceKm: 8 },
      nohrsc: { snowDepthIn: 0, sweIn: 0 },
    },
    {
      totals: { rainPast12hIn: 0.14, rainPast24hIn: 0.28, rainPast48hIn: 0.32 },
    },
  );

  expect(status).toBe('🌧️ Wet / Muddy');
});

test('deriveTerrainCondition returns structured reasons and confidence for snow/ice classification', () => {
  const condition = deriveTerrainCondition(
    {
      description: 'Heavy Snow',
      precipChance: 85,
      humidity: 78,
      temp: 24,
      windSpeed: 15,
      windGust: 28,
      trend: [
        { precipChance: 80, condition: 'Snow showers', temp: 25 },
        { precipChance: 75, condition: 'Snow', temp: 23 },
      ],
    },
    {
      snotel: { snowDepthIn: 12, sweIn: 3.4, distanceKm: 10 },
      nohrsc: { snowDepthIn: 9, sweIn: 2.8 },
    },
    {
      totals: { snowPast12hIn: 1.2, snowPast24hIn: 3.4, snowPast48hIn: 4.1 },
    },
  );

  expect(condition.code).toBe('snow_ice');
  expect(condition.label).toBe('❄️ Snow-Covered / Icy');
  expect(['high', 'medium', 'low']).toContain(condition.confidence);
  expect(Array.isArray(condition.reasons)).toBe(true);
  expect(condition.reasons.length).toBeGreaterThan(0);
  expect(condition.summary.length).toBeGreaterThan(0);
});

test('deriveTerrainCondition marks weather unavailable when no usable signals exist', () => {
  const condition = deriveTerrainCondition(
    {
      description: 'Weather data unavailable',
      precipChance: null,
      humidity: null,
      temp: null,
      trend: [],
    },
    {
      snotel: null,
      nohrsc: null,
    },
    {
      totals: {},
    },
  );

  expect(condition.code).toBe('weather_unavailable');
  expect(condition.label).toBe('⚠️ Weather Unavailable');
  expect(condition.confidence).toBe('low');
});

test('findMatchingAvalancheZone uses direct polygon match when available', () => {
  const features = [
    {
      type: 'Feature',
      id: 'zone-a',
      properties: { center_id: 'A', name: 'Zone A' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-111.0, 40.0], [-110.8, 40.0], [-110.8, 40.2], [-111.0, 40.2], [-111.0, 40.0]]],
      },
    },
  ];

  const match = findMatchingAvalancheZone(features, 40.1, -110.9);
  expect(match.mode).toBe('polygon');
  expect(match.feature?.id).toBe('zone-a');
});

test('findMatchingAvalancheZone falls back to nearest zone when point is near boundary', () => {
  const features = [
    {
      type: 'Feature',
      id: 'zone-a',
      properties: { center_id: 'A', name: 'Zone A' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-111.0, 40.0], [-110.8, 40.0], [-110.8, 40.2], [-111.0, 40.2], [-111.0, 40.0]]],
      },
    },
  ];

  const match = findMatchingAvalancheZone(features, 40.1, -110.79, 15);
  expect(match.mode).toBe('nearest');
  expect(match.feature?.id).toBe('zone-a');
  expect(Number(match.fallbackDistanceKm)).toBeGreaterThan(0);
});

test('findMatchingAvalancheZone does not assign distant zones beyond fallback cap', () => {
  const features = [
    {
      type: 'Feature',
      id: 'zone-a',
      properties: { center_id: 'A', name: 'Zone A' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-111.0, 40.0], [-110.8, 40.0], [-110.8, 40.2], [-111.0, 40.2], [-111.0, 40.0]]],
      },
    },
  ];

  const match = findMatchingAvalancheZone(features, 40.1, -109.0, 20);
  expect(match.mode).toBe('none');
  expect(match.feature).toBeNull();
});

test('findMatchingAvalancheZone applies Utah UAC fallback when generic fallback misses', () => {
  const features = [
    {
      type: 'Feature',
      id: 'uac-zone',
      properties: { center_id: 'UAC', name: 'Uintas' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-110.9, 40.4], [-110.6, 40.4], [-110.6, 40.6], [-110.9, 40.6], [-110.9, 40.4]]],
      },
    },
    {
      type: 'Feature',
      id: 'other-zone',
      properties: { center_id: 'OTHER', name: 'Other Zone' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-112.5, 39.8], [-112.3, 39.8], [-112.3, 40.0], [-112.5, 40.0], [-112.5, 39.8]]],
      },
    },
  ];

  // Kings Peak vicinity: outside the synthetic polygon, and beyond a strict 20km generic fallback cap.
  const match = findMatchingAvalancheZone(features, 40.7763, -110.3729, 20);
  expect(match.mode).toBe('nearest');
  expect(match.feature?.id).toBe('uac-zone');
  expect(Number(match.fallbackDistanceKm)).toBeGreaterThan(20);
});

test('deriveOverallDangerLevelFromElevations returns max level when bands are close', () => {
  const overall = deriveOverallDangerLevelFromElevations({
    above: { level: 3 },
    at: { level: 3 },
    below: { level: 2 },
  });
  expect(overall).toBe(3);
});

test('deriveOverallDangerLevelFromElevations returns almost-worst level for a single high outlier band', () => {
  const overall = deriveOverallDangerLevelFromElevations({
    above: { level: 4 },
    at: { level: 2 },
    below: { level: 2 },
  });
  expect(overall).toBe(3);
});

test('applyDerivedOverallAvalancheDanger updates reported overall risk from elevation bands', () => {
  const updated = applyDerivedOverallAvalancheDanger({
    risk: 'Moderate',
    dangerLevel: 2,
    dangerUnknown: false,
    coverageStatus: 'reported',
    elevations: {
      above: { level: 4, label: 'High' },
      at: { level: 2, label: 'Moderate' },
      below: { level: 2, label: 'Moderate' },
    },
  });

  expect(updated.dangerLevel).toBe(3);
  expect(updated.risk).toBe('Considerable');
});

test('evaluateAvalancheRelevance marks avalanche relevant when Snowpack Snapshot shows material snowpack', () => {
  const result = evaluateAvalancheRelevance({
    lat: 40.76,
    selectedDate: '2026-06-20',
    weatherData: {
      elevation: 8200,
      temp: 42,
      feelsLike: 40,
      precipChance: 10,
      description: 'Partly Sunny',
      forecastDate: '2026-06-20',
    },
    avalancheData: {
      coverageStatus: 'no_active_forecast',
      dangerUnknown: true,
    },
    snowpackData: {
      status: 'ok',
      snotel: { snowDepthIn: 14, sweIn: 4.1, distanceKm: 12 },
      nohrsc: { snowDepthIn: 18, sweIn: 5.2 },
    },
  });

  expect(result.relevant).toBe(true);
  expect(String(result.reason)).toMatch(/Snowpack Snapshot/i);
});

test('evaluateAvalancheRelevance marks avalanche relevant when Snowpack Snapshot shows measurable snowpack', () => {
  const result = evaluateAvalancheRelevance({
    lat: 39.1,
    selectedDate: '2026-06-20',
    weatherData: {
      elevation: 7600,
      temp: 50,
      feelsLike: 49,
      precipChance: 15,
      description: 'Mostly Sunny',
      forecastDate: '2026-06-20',
    },
    avalancheData: {
      coverageStatus: 'no_active_forecast',
      dangerUnknown: true,
    },
    snowpackData: {
      status: 'ok',
      snotel: { snowDepthIn: 2.4, sweIn: 0.8, distanceKm: 11 },
      nohrsc: { snowDepthIn: 2.1, sweIn: 0.6 },
    },
  });

  expect(result.relevant).toBe(true);
  expect(String(result.reason)).toMatch(/measurable snowpack|Snowpack Snapshot/i);
});

test('evaluateAvalancheRelevance de-emphasizes avalanche when snowpack is near-zero and center is out of season', () => {
  const result = evaluateAvalancheRelevance({
    lat: 34.1,
    selectedDate: '2026-07-15',
    weatherData: {
      elevation: 4200,
      temp: 78,
      feelsLike: 78,
      precipChance: 5,
      description: 'Sunny',
      forecastDate: '2026-07-15',
    },
    avalancheData: {
      coverageStatus: 'no_active_forecast',
      dangerUnknown: true,
    },
    snowpackData: {
      status: 'ok',
      snotel: { snowDepthIn: 0, sweIn: 0, distanceKm: 9 },
      nohrsc: { snowDepthIn: 0, sweIn: 0 },
    },
  });

  expect(result.relevant).toBe(false);
  expect(String(result.reason)).toMatch(/low snow signal|out of forecast season/i);
});

test('evaluateAvalancheRelevance de-emphasizes avalanche when snowpack is near-zero and no center covers the objective', () => {
  const result = evaluateAvalancheRelevance({
    lat: 34.2,
    selectedDate: '2026-07-15',
    weatherData: {
      elevation: 5100,
      temp: 80,
      feelsLike: 80,
      precipChance: 0,
      description: 'Sunny',
      forecastDate: '2026-07-15',
    },
    avalancheData: {
      coverageStatus: 'no_center_coverage',
      dangerUnknown: true,
    },
    snowpackData: {
      status: 'ok',
      snotel: { snowDepthIn: 0, sweIn: 0, distanceKm: 12 },
      nohrsc: { snowDepthIn: 0, sweIn: 0 },
    },
  });

  expect(result.relevant).toBe(false);
  expect(String(result.reason)).toMatch(/low snow signal|No local avalanche center coverage/i);
});

test('evaluateAvalancheRelevance still uses winter/elevation fallback when snowpack snapshot is unavailable', () => {
  const result = evaluateAvalancheRelevance({
    lat: 46.85,
    selectedDate: '2026-02-20',
    weatherData: {
      elevation: 12000,
      temp: 45,
      feelsLike: 42,
      precipChance: 20,
      description: 'Mostly Cloudy',
      forecastDate: '2026-02-20',
    },
    avalancheData: {
      coverageStatus: 'no_center_coverage',
      dangerUnknown: true,
    },
    snowpackData: {
      status: 'unavailable',
      snotel: null,
      nohrsc: null,
    },
  });

  expect(result.relevant).toBe(true);
  expect(String(result.reason)).toMatch(/High-elevation objective/i);
});

test('calculateSafetyScore applies lower score for future start due forecast uncertainty', () => {
  const now = Date.now();
  const nearStartIso = new Date(now + 30 * 60 * 1000).toISOString();
  const futureStartIso = new Date(now + 48 * 60 * 60 * 1000).toISOString();
  const tomorrowIso = new Date(now + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const inTwoDaysIso = new Date(now + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const baseWeather = {
    description: 'Mostly Clear',
    windSpeed: 5,
    windGust: 8,
    precipChance: 5,
    humidity: 40,
    temp: 45,
    feelsLike: 45,
    isDaytime: true,
    issuedTime: new Date(now - 30 * 60 * 1000).toISOString(),
    trend: Array.from({ length: 8 }, (_, idx) => ({
      temp: 45 + (idx % 2),
      wind: 5,
      gust: 8,
    })),
  };

  const nearResult = calculateSafetyScore({
    weatherData: { ...baseWeather, forecastStartTime: nearStartIso },
    avalancheData: { relevant: false, dangerUnknown: false, coverageStatus: 'no_center_coverage' },
    alertsData: { status: 'none', activeCount: 0, alerts: [] },
    airQualityData: { status: 'ok', usAqi: 30, category: 'Good' },
    fireRiskData: { status: 'ok', level: 1, source: 'Fire risk synthesis' },
    selectedDate: tomorrowIso,
  });

  const futureResult = calculateSafetyScore({
    weatherData: { ...baseWeather, forecastStartTime: futureStartIso },
    avalancheData: { relevant: false, dangerUnknown: false, coverageStatus: 'no_center_coverage' },
    alertsData: { status: 'future_time_not_supported', activeCount: 0, alerts: [] },
    airQualityData: { status: 'ok', usAqi: 30, category: 'Good' },
    fireRiskData: { status: 'ok', level: 1, source: 'Fire risk synthesis' },
    selectedDate: inTwoDaysIso,
  });

  expect(futureResult.score).toBeLessThan(nearResult.score);
  expect(futureResult.explanations.some((line) => /fewer real-time feeds can be projected/i.test(String(line)))).toBe(true);
});
