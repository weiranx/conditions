const {
  buildAvalancheDisplay,
  buildBluebird,
  buildDaylightFromStart,
  buildPressureTrend,
  buildRainfallDisplay,
  buildReportInterpretation,
  buildSnowpackDisplay,
  buildSnowpackInsights,
  buildSnowpackInterpretation,
  buildSourceFreshness,
  buildTerrainConditionDisplay,
  buildVisibility,
  buildWeatherTrendRows,
} = require('../src/utils/report-interpretation');
const {
  buildElevationByHour,
  buildTerrainView,
  buildTerrainWindow,
  buildTerrainWindowByAspect,
  estimateAtElevation,
  rebaseElevationBands,
} = require('../src/utils/terrain-window');
const { formatAgeFromNow } = require('../src/utils/source-freshness');
const { buildPlanContext } = require('../src/utils/plan-context');
const { attachPlanEvaluation } = require('../src/utils/plan-evaluation');
const { makeReport } = require('./fixtures/plan-report');

const NOW = Date.parse('2026-09-24T12:00:00Z');
const imperial = { temperature: 'f', wind: 'mph', elevation: 'ft', timeStyle: 'ampm' };
const metric = { temperature: 'c', wind: 'kph', elevation: 'm', timeStyle: '24h' };

const weatherHour = {
  time: '09:00',
  temp: 50,
  wind: 10,
  gust: 15,
  precipChance: 0,
  condition: 'Clear',
  cloudCover: 5,
  humidity: 40,
  dewPoint: 32,
  windDirection: 'NW',
  isDaytime: true,
};

describe('bluebird share', () => {
  test('excludes night and respects cloud, precipitation and visibility limits', () => {
    const result = buildBluebird([
      weatherHour,
      { ...weatherHour, cloudCover: 20, precipChance: 10 },
      { ...weatherHour, cloudCover: 21 },
      { ...weatherHour, precipChance: 11 },
      { ...weatherHour, condition: 'Fog' },
      { ...weatherHour, condition: 'Snow showers' },
      { ...weatherHour, isDaytime: false },
    ]);
    expect(result).toMatchObject({ percent: 33, daylightHours: 6, bluebirdHours: 2 });
  });

  test('preserves missing evidence and genuine zeroes', () => {
    for (const value of [null, undefined, NaN, Infinity, -1, 101]) {
      expect(buildBluebird([{ ...weatherHour, cloudCover: value }]).percent).toBeNull();
      expect(buildBluebird([{ ...weatherHour, precipChance: value }]).percent).toBeNull();
    }
    expect(buildBluebird([]).percent).toBeNull();
    expect(buildBluebird([{ ...weatherHour, isDaytime: false }]).percent).toBeNull();
    expect(buildBluebird([weatherHour, { ...weatherHour, isDaytime: null }]).reason).toMatch(/incomplete/);
    expect(buildBluebird([{ ...weatherHour, cloudCover: 100 }]).percent).toBe(0);
    expect(buildBluebird([{ ...weatherHour, cloudCover: 0, precipChance: 0 }]).percent).toBe(100);
  });
});

describe('snowpack', () => {
  test('a station that reports no depth or SWE is not a no-snow signal', () => {
    const snowpack = { snotel: { stationName: 'Test', snowDepthIn: null, sweIn: null, distanceKm: 4, elevationFt: 9000 }, nohrsc: null, cdec: null };
    expect(buildSnowpackInterpretation(snowpack, 9500, 'ft', NOW)).toBeNull();

    const sweOnly = { ...snowpack, snotel: { ...snowpack.snotel, sweIn: 12 }, nohrsc: { snowDepthIn: 40, sweIn: null } };
    const interpretation = buildSnowpackInterpretation(sweOnly, 9500, 'ft', NOW);
    expect(interpretation.headline).toMatch(/Substantial snowpack/);
    expect(interpretation.bullets.some((text) => /diverge/.test(text))).toBe(false);
  });

  test('an unknown objective elevation is not compared as sea level', () => {
    const snowpack = { snotel: { snowDepthIn: 30, sweIn: 10, distanceKm: 4, elevationFt: 9000 }, nohrsc: { snowDepthIn: 32 }, cdec: null };
    for (const elevation of [null, undefined]) {
      expect(buildSnowpackInterpretation(snowpack, elevation, 'ft', NOW).bullets.some((text) => /elevation differs/.test(text))).toBe(false);
    }
    const bullets = buildSnowpackInterpretation(snowpack, 5000, 'm', NOW).bullets;
    expect(bullets.find((text) => /elevation differs/.test(text))).toMatch(/~1,219 m/);
  });

  test('a CDEC-only reading counts as a snowpack signal', () => {
    const snowpack = (cdec) => ({ status: 'partial', snotel: null, nohrsc: null, cdec });
    expect(buildSnowpackInterpretation(snowpack({ snowDepthIn: 4, sweIn: null }), 8000, 'ft', NOW).headline).toMatch(/Some snowpack signal/);
    expect(buildSnowpackInterpretation(snowpack({ snowDepthIn: 0, sweIn: 0 }), 8000, 'ft', NOW).headline).toMatch(/Minimal broad snow signal/);
  });

  test('strongly disagreeing sources show a range instead of one depth', () => {
    const report = {
      weather: { elevation: 9000, timezone: 'America/Denver' },
      snowpack: {
        status: 'ok',
        snotel: { snowDepthIn: 2, sweIn: 0.5, distanceKm: 3, elevationFt: 9100, observedDate: '2026-09-24' },
        nohrsc: { snowDepthIn: 30, sweIn: 8, sampledTime: '2026-09-24T12:00:00Z' },
        cdec: null,
      },
    };
    const insights = buildSnowpackInsights(report.snowpack, 9000, 'ft', NOW);
    expect(insights.agreement.label).toBe('Sources diverge');
    const display = buildSnowpackDisplay(report, imperial, insights);
    expect(display).toMatchObject({
      bestDepthDisplay: '30 in',
      bestDepthSource: 'NOHRSC grid',
      depthConflict: true,
      depthRangeDisplay: '2 in – 30 in',
      sources: { snotel: { depthDisplay: '2 in', sweDisplay: '0.5 in SWE', distanceDisplay: '1.9 mi' }, cdec: { depthDisplay: 'N/A' } },
    });
    expect(display.depthConflictCaption).toMatch(/NOHRSC grid reads 30 in but SNOTEL reads 2 in/);
    expect(display.observationContext).toBe('Using observations: SNOTEL obs 2026-09-24 • NOHRSC sample Sep 24, 6:00 AM MDT');
    expect(buildSnowpackDisplay(report, metric, insights).observationContext).toMatch(/NOHRSC sample Sep 24, 06:00 MDT/);
  });
});

describe('avalanche', () => {
  test('the brief caption gives the rating, or why there is none', () => {
    const caption = (avalanche) => buildAvalancheDisplay({ avalanche }, imperial).briefCaption;
    expect(caption({ relevant: true, dangerLevel: 3, coverageStatus: 'reported', center: 'Northwest Avalanche Center' }))
      .toBe('Considerable (3 of 5) is the highest rating in the Northwest Avalanche Center forecast.');
    expect(caption({ relevant: true, dangerLevel: 0, dangerUnknown: true, coverageStatus: 'no_active_forecast', center: 'Northwest Avalanche Center', relevanceReason: 'Forecast includes wintry signals (snow/ice/freezing conditions).' }))
      .toBe('Northwest Avalanche Center has no current forecast for this zone. Forecast includes wintry signals (snow/ice/freezing conditions).');
    expect(caption({ relevant: false, relevanceReason: 'No snow on the ground.' })).toBe('No snow on the ground.');
    expect(caption(null)).toBe('No avalanche information is available for this plan.');
  });

  test('problem terrain keeps an unstated aspect or elevation empty', () => {
    const { problemTerrain } = buildAvalancheDisplay({
      avalanche: {
        relevant: true,
        problems: [
          { name: 'Wind slab', location: ['north upper', 'northeast upper'] },
          { name: 'Persistent slab', location: [] },
        ],
      },
    }, imperial);
    expect(problemTerrain).toEqual([
      { name: 'Wind slab', aspects: ['N', 'NE'], elevations: ['upper'], description: 'N, NE · above treeline' },
      { name: 'Persistent slab', aspects: [], elevations: [], description: 'Aspects not stated · elevations not stated' },
    ]);
  });
});

describe('source freshness', () => {
  test('ages read as when a later forecast hour applies, not as fresh', () => {
    expect(formatAgeFromNow(new Date(NOW + (9 * 60 + 30) * 60000).toISOString(), NOW)).toBe('valid in 9h 30m');
    expect(formatAgeFromNow(new Date(NOW - 95 * 60000).toISOString(), NOW)).toBe('1h 35m ago');
    expect(formatAgeFromNow(new Date(NOW + 60000).toISOString(), NOW)).toBe('0m ago');
    expect(formatAgeFromNow(null, NOW)).toBe('Unavailable');
  });

  test('a source without a timestamp is missing, and a source with nothing to report is not', () => {
    const report = {
      weather: { issuedTime: new Date(NOW - 20 * 3600000).toISOString() },
      alerts: { status: 'none', alerts: [] },
      airQuality: { status: 'not_applicable_future_date' },
      avalanche: { coverageStatus: 'no_active_forecast' },
    };
    const freshness = buildSourceFreshness(report, true, 8, NOW);
    const state = Object.fromEntries(freshness.rows.map((row) => [row.label, row.state]));
    expect(state).toEqual({ Weather: 'stale', Avalanche: 'fresh', Alerts: 'fresh', 'Air Quality': 'fresh', Precipitation: 'missing', Snowpack: 'missing' });
    expect(freshness.rows.find((row) => row.label === 'Avalanche').displayValue).toBe('No bulletin (seasonal)');
    expect(freshness.hasWarning).toBe(true);
    expect(freshness.warningSummary).toBe('Weather: 20h ago • Precipitation: missing • Snowpack: Unavailable');
    expect(freshness.airQualityFutureNotApplicable).toBe(true);
  });

  test('older reports carrying precipitation as rainfallData still date it', () => {
    const anchorTime = new Date(NOW - 3600000).toISOString();
    const interpretation = buildReportInterpretation({ weather: {}, rainfallData: { anchorTime, status: 'ok', totals: { rainPast24hIn: 0.3 } } },
      buildPlanContext({}, null, { nowMs: NOW }));
    expect(interpretation.sourceFreshness.rows.find((row) => row.label === 'Precipitation').state).toBe('fresh');
    expect(interpretation.rainfall.insightLine).toMatch(/Moderate rain signal: 24h rain 0.30 in/);
  });
});

describe('precipitation, surface, visibility and weather trend', () => {
  test('recent precipitation reads in the plan units and a gap is not zero', () => {
    const rainfall = { status: 'ok', mode: 'observed_recent', totals: { rainPast24hIn: 0.7, rainPast24hMm: 17.8, snowPast24hIn: 3, snowPast24hCm: 7.6 } };
    const display = buildRainfallDisplay(rainfall, metric, 8);
    expect(display.rainDisplay.past24h).toBe('18 mm');
    expect(display.snowDisplay.past24h).toBe('7.6 cm');
    expect(display.insightLine).toBe('Mixed precip signal: 24h rain 18 mm plus 24h snow 7.6 cm.');
    expect(display.rainIn).toEqual({ past12h: null, past24h: 0.7, past48h: null });
    expect(display.modeLabel).toBe('Observed recent accumulation');
    expect(buildRainfallDisplay(null, imperial, 8).insightLine).toBe('Recent rain/snow totals are unavailable for this objective/time.');
  });

  test('fire and heat cards are over at high levels and missing without a rating', () => {
    const { buildFireRiskDisplay, buildHeatRiskDisplay } = require('../src/utils/report-interpretation');
    expect(buildFireRiskDisplay({ fireRisk: { level: 3, label: 'Moderate' } }).status).toBe('over');
    expect(buildFireRiskDisplay({ fireRisk: { level: 1, label: 'Low' } }).status).toBe('ok');
    expect(buildFireRiskDisplay({})).toMatchObject({ level: null, label: 'Unknown', status: 'missing' });
    expect(buildHeatRiskDisplay({ heatRisk: { level: 2, label: 'Elevated' } }).status).toBe('over');
    // Without a heat assessment the start hour's feels-like sets the level.
    expect(buildHeatRiskDisplay({ weather: { feelsLike: 93 } })).toMatchObject({ level: 3, label: 'High', status: 'over' });
    expect(buildHeatRiskDisplay({ weather: { feelsLike: null } })).toMatchObject({ level: 0, label: 'Low', status: 'ok' });
  });

  test('surface status follows the hazard code, not whether a label exists', () => {
    const status = (terrainCondition) => buildTerrainConditionDisplay({ terrainCondition }).status;
    expect(status({ code: 'snow_ice', label: 'Snow and ice' })).toBe('over');
    expect(status({ code: 'weather_unavailable', label: 'Unavailable' })).toBe('missing');
    expect(status(null)).toBe('missing');
    expect(status({ code: 'dry_firm', label: 'Dry' })).toBe('ok');
    expect(buildTerrainConditionDisplay({ terrainCondition: { code: 'dry_firm', label: '🥾 Dry and firm' } }).surfaceLabel).toBe('Dry and firm');
  });

  test('visibility falls back to the start hour without a forecast assessment', () => {
    const report = { weather: { description: 'Heavy snow', precipChance: 85, windSpeed: 20, windGust: 40, humidity: 95, cloudCover: 95, isDaytime: true } };
    const visibility = buildVisibility(report, metric);
    // 30 heavy snow + 20 precipitation + 12 wind + 16 humid overcast.
    expect(visibility).toMatchObject({ level: 'High', score: 78, status: 'over' });
    expect(visibility.source).toBe('Derived from selected weather hour');
    expect(visibility.detail).toBe('reduced-visibility weather signal • precip 85% • wind/gust 64 kph');
    // A missing precipitation chance is not 0%, and the forecast's own assessment wins.
    const provided = buildVisibility({ weather: { visibilityRisk: { level: 'low', score: 25, factors: ['patchy fog'], source: 'NOAA' } } }, imperial);
    expect(provided).toMatchObject({ level: 'Low', score: 25, detail: 'patchy fog', source: 'NOAA' });
  });

  test('chart rows carry feels-like and wind direction without inventing readings', () => {
    const [row, gap] = buildWeatherTrendRows([{ ...weatherHour, temp: 20, wind: 15 }, { time: '10:00', temp: null, wind: 5, windDirection: 'VRB' }], '24h');
    expect(row).toMatchObject({ label: '09:00', hourValue: '09:00', temp: 20, wind: 15, gust: 15, windDirection: 315, windDirectionLabel: 'NW' });
    expect(row.feelsLike).toBeLessThan(20);
    expect(gap).toMatchObject({ temp: null, feelsLike: null, gust: 5, windDirection: null, windDirectionLabel: 'VRB', precipChance: null });
  });

  test('pressure trend and daylight from the start', () => {
    expect(buildPressureTrend([{ pressure: 1012 }, { pressure: null }, { pressure: 1009.5 }], 8)).toBe('Falling pressure over 8h: -2.5 hPa (1012.0 → 1009.5 hPa)');
    expect(buildPressureTrend([{ pressure: 1012 }], 8)).toBeNull();
    const solar = { solar: { sunrise: '6:45:00 AM', sunset: '7:05:00 PM' } };
    expect(buildDaylightFromStart(solar, '05:00').label).toBe('12h 20m (start before sunrise)');
    expect(buildDaylightFromStart(solar, '20:00').label).toBe('0m (start is after sunset)');
    expect(buildDaylightFromStart({}, '05:00')).toEqual({ minutes: null, label: 'N/A' });
  });
});

describe('terrain window', () => {
  const row = (extra = {}) => ({ time: '07:00', pass: true, gust: 34, reasonSummary: '', ...extra });

  test('without wind-loading aspects the window keeps its elevation lanes but no lee split', () => {
    const input = {
      rows: [row()],
      elevationBands: [{ label: 'Lower', elevationFt: 8000 }, { label: 'Objective', elevationFt: 11000 }],
      avalancheProblems: [],
      avalancheRelevant: false,
      avalancheUnknown: false,
      avalancheDanger: null,
      maxWindGustMph: 40,
    };
    const withLee = buildTerrainWindow({ ...input, leewardAspects: ['E', 'NE', 'SE'], secondaryAspects: [] });
    expect(withLee.lanes).toHaveLength(4);
    expect(withLee.lanes.some((lane) => lane.cells[0].reasons.some((reason) => /wind-loading/.test(reason)))).toBe(true);

    const withoutLee = buildTerrainWindow({ ...input, leewardAspects: [], secondaryAspects: [] });
    expect(withoutLee.lanes.map((lane) => lane.aspectLabel)).toEqual(['All aspects', 'All aspects']);
    expect(withoutLee.lanes.every((lane) => lane.cells[0].reasons.every((reason) => !/wind-loading|Cross-loading/.test(reason)))).toBe(true);
    expect(withoutLee.explanation).not.toMatch(/avalanche/);
  });

  test('per-aspect terrain keeps a north avalanche problem and a south lee slope apart', () => {
    const input = {
      // Strong enough to load the lee slope (60% of the limit), below the 70% caution for every slope.
      rows: [row({ gust: 24 })],
      elevationBands: [{ label: 'Objective', elevationFt: 11000 }],
      // No elevation stated, so the problem reaches every band on its aspect.
      avalancheProblems: [{ name: 'Wind slab', location: ['north'] }],
      avalancheRelevant: true,
      avalancheUnknown: false,
      avalancheDanger: 2,
      leewardAspects: ['S'],
      secondaryAspects: [],
      maxWindGustMph: 40,
    };
    const byAspect = buildTerrainWindowByAspect(input);
    const cell = (aspect) => byAspect[aspect].lanes.find((lane) => lane.aspects.includes(aspect)).cells[0];
    expect(cell('N').reasons.join(' ')).toMatch(/Wind slab/);
    expect(cell('N').reasons.join(' ')).not.toMatch(/wind-loading/);
    expect(cell('S').reasons.join(' ')).toMatch(/wind-loading/);
    expect(cell('S').reasons.join(' ')).not.toMatch(/Wind slab/);
    expect(cell('E').level).toBe('lower');
    // The grouped window, by contrast, puts N and S in one lane with both reasons.
    expect(buildTerrainWindow(input).lanes.find((lane) => lane.aspects.includes('N')).aspects).toContain('S');
  });

  test('the view keeps only each aspect’s own lanes and hides what the report does not show', () => {
    const report = {
      featureFlags: { avalancheDetails: false },
      weather: { elevationForecast: [{ label: 'Objective', elevationFt: 11000, deltaFromObjectiveFt: 0 }] },
      avalanche: { problems: [{ name: 'Wind slab', location: ['north'] }] },
    };
    const view = buildTerrainView(report, {
      rows: [row({ gust: 24 })],
      avalanche: { relevant: true, unknown: false, overallLevel: 3 },
      windLoading: { applies: true, leewardAspects: ['S'], secondaryAspects: [] },
      limits: { maxWindGustMph: 40 },
    });
    expect(view.byAspect.N).toEqual([{ elevationFt: 11000, cells: [{ level: 'lower', reasons: [] }] }]);
    expect(view.byAspect.S[0].cells[0].reasons.join(' ')).toMatch(/wind-loading/);
    expect(view.grouped.explanation).not.toMatch(/avalanche/);
  });
});

describe('elevation by hour', () => {
  const bands = [
    { label: 'Lower Terrain', elevationFt: 7000, deltaFromObjectiveFt: -2000, temp: 40, feelsLike: 36, windSpeed: 6, windGust: 15 },
    { label: 'Objective Elevation', elevationFt: 9000, deltaFromObjectiveFt: 0, temp: 33, feelsLike: 26, windSpeed: 10, windGust: 20 },
  ];

  test('bands re-derive from a later hour with the start-hour lapse model', () => {
    const later = rebaseElevationBands(bands, { temp: 50, wind: 12, gust: 25 });
    expect(later.map((band) => [band.elevationFt, band.temp, band.windSpeed, band.windGust])).toEqual([[7000, 57, 8, 20], [9000, 50, 12, 25]]);
    expect(later[0].label).toBe('Lower Terrain');
    expect(rebaseElevationBands(bands, { temp: NaN, wind: 5, gust: 10 })).toBe(bands);
    const above = estimateAtElevation({ temp: 20, wind: 15, gust: NaN }, 1000);
    expect([above.temp, above.windSpeed, above.windGust]).toEqual([17, 17, 17]);
    expect(above.feelsLike).toBeLessThan(above.temp);
  });

  test('each planned hour has its bands, and a target elevation its estimate', () => {
    const report = { weather: { elevation: 9000, temp: 33, windSpeed: 10, windGust: 20, elevationForecast: bands } };
    const rows = [
      { time: '07:00', temp: 33, wind: 10, gust: 20 },
      { time: '08:00', temp: 60, wind: 5, gust: 9, objectiveReading: { temp: 50, wind: 12, gust: 25 } },
      { time: '09:00', temp: NaN, wind: 5, gust: 9 },
    ];
    const { bandsByHour, target } = buildElevationByHour(report, rows, 10000);
    expect(bandsByHour[0]).toBe(bands);
    expect(bandsByHour[1][1]).toMatchObject({ temp: 50, windSpeed: 12, windGust: 25 });
    expect(bandsByHour[2]).toBe(bands);
    expect(target).toMatchObject({ elevationFt: 10000, deltaFt: 1000 });
    expect(target.byHour.map((hour) => hour && hour.temp)).toEqual([30, 47, null]);
    expect(buildElevationByHour({ weather: { ...report.weather, temp: null } }, rows, 10000).target).toBeNull();
    expect(buildElevationByHour(report, rows, null).target).toMatchObject({ elevationFt: 9000, deltaFt: 0, byHour: [{ temp: 33, windSpeed: 10 }, { temp: 50 }, null] });
  });

  test('the evaluation estimates the plan’s target elevation', () => {
    const { evaluation } = attachPlanEvaluation(makeReport(), { approach: 'off', target_elevation_ft: '12000' });
    expect(evaluation.params.target_elevation_ft).toBe('12000');
    expect(evaluation.elevation.target.elevationFt).toBe(12000);
    expect(evaluation.elevation.bandsByHour).toHaveLength(evaluation.travelWindow.planned.rows.length);
    expect(evaluation.interpretation.weatherTrend).toHaveLength(makeReport().weather.trend.slice(0, evaluation.plan.travelWindowHours).length);
    expect(Object.keys(evaluation.terrain.byAspect)).toEqual(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
    // Without a target, the objective itself.
    const objective = attachPlanEvaluation(makeReport(), { approach: 'off' }).evaluation.elevation.target;
    expect(objective).toMatchObject({ elevationFt: Math.round(makeReport().weather.elevation), deltaFt: 0 });
  });
});
