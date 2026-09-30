'use strict';

const {
  getScoreFeatureSnapshot,
  removeAvalancheNarrativeReferences,
  removeAvalancheReferences,
  removeDisabledFeatureReferences,
  reportMatchesScoreFeatures,
  sanitizeReportForFeatureFlags,
} = require('../src/utils/report-feature-filter');
const { buildPlanContext } = require('../src/utils/plan-context');
const { evaluatePlan } = require('../src/utils/plan-evaluation');
const { makeReport } = require('./fixtures/plan-report');

describe('report feature filtering', () => {
  test('removes disabled avalanche inputs from the full downstream report boundary', () => {
    const flags = { avalancheDetails: false };
    const report = {
      featureFlags: getScoreFeatureSnapshot(flags),
      weather: { description: 'Cloudy', temp: 31 },
      avalanche: { risk: 'Considerable', problems: [{ name: 'Deep Persistent Slab' }] },
      alerts: {
        activeCount: 2,
        totalActiveCount: 2,
        highestSeverity: 'Severe',
        alerts: [
          { event: 'Avalanche Warning', severity: 'Severe' },
          { event: 'High Wind Warning', severity: 'Moderate' },
        ],
      },
      localConditions: {
        closures: { alerts: [{ title: 'Road closed for avalanche control' }, { title: 'Trailhead gate closed' }] },
      },
      snowpack: {
        summary: 'Snowpack observations remain available.',
        snotel: { stationName: 'Paradise', snowDepthIn: 40, sweIn: 18 },
        snotelStations: [{ stationName: 'Avalanche Lake', snowDepthIn: 38, sweIn: 17 }],
      },
      gear: [
        { id: 'avalanche-kit', title: 'Avalanche rescue kit' },
        { id: 'layering-core', title: 'Layering system' },
      ],
      safety: {
        primaryHazard: 'Avalanche',
        factors: [
          { group: 'avalanche', hazard: 'Avalanche', impact: -25 },
          { group: 'snowpack', hazard: 'Snowpack', impact: -6 },
          { group: 'weather', hazard: 'Wind', impact: -5 },
        ],
        explanations: ['Avalanche danger is Considerable.', 'Snowpack depth is 40 in.', 'Strong wind is expected.'],
        confidenceReasons: ['Avalanche bulletin is current.', 'Weather forecast is current.'],
        sourcesUsed: ['Avalanche center', 'NRCS SNOTEL', 'NOAA forecast'],
        groupImpacts: { avalanche: -25, snowpack: -6, weather: -5 },
      },
    };

    const filtered = sanitizeReportForFeatureFlags(report, flags);

    expect(filtered.avalanche).toBeUndefined();
    expect(filtered.gear).toEqual([{ id: 'layering-core', title: 'Layering system' }]);
    expect(filtered.safety.factors).toEqual([
      { group: 'snowpack', hazard: 'Snowpack', impact: -6 },
      { group: 'weather', hazard: 'Wind', impact: -5 },
    ]);
    expect(filtered.safety.explanations).toEqual(['Snowpack depth is 40 in.', 'Strong wind is expected.']);
    expect(filtered.safety.confidenceReasons).toEqual(['Weather forecast is current.']);
    expect(filtered.safety.sourcesUsed).toEqual(['NRCS SNOTEL', 'NOAA forecast']);
    expect(filtered.safety.groupImpacts).toEqual({ snowpack: -6, weather: -5 });
    expect(filtered.safety.primaryHazard).toBe('Snowpack');
    expect(filtered.alerts.alerts).toEqual([{ event: 'High Wind Warning', severity: 'Moderate' }]);
    expect(filtered.alerts.activeCount).toBe(1);
    expect(filtered.localConditions.closures.alerts).toEqual([{ title: 'Trailhead gate closed' }]);
    expect(filtered.snowpack.summary).toBe('Snowpack observations remain available.');
    expect(filtered.snowpack.snotel).toEqual({ stationName: 'Paradise', snowDepthIn: 40, sweIn: 18 });
    expect(filtered.snowpack.snotelStations).toEqual([{ snowDepthIn: 38, sweIn: 17 }]);
    const { featureFlags, ...reportWithoutFlagMetadata } = filtered;
    expect(JSON.stringify(reportWithoutFlagMetadata)).not.toMatch(/avalanche|Considerable|Deep Persistent Slab/i);
    expect(report.avalanche.risk).toBe('Considerable');
  });

  test('requires an exact scored-feature snapshot and treats legacy reports as all-enabled only', () => {
    const disabledFlags = { avalancheDetails: false };
    const enabledFlags = {};
    const matchingReport = { featureFlags: getScoreFeatureSnapshot(disabledFlags) };

    expect(reportMatchesScoreFeatures(matchingReport, disabledFlags)).toBe(true);
    expect(reportMatchesScoreFeatures(matchingReport, enabledFlags)).toBe(false);
    expect(reportMatchesScoreFeatures({}, enabledFlags)).toBe(true);
    expect(reportMatchesScoreFeatures({}, disabledFlags)).toBe(false);
  });

  test('removes every disabled risk domain while retaining the complete report-time flag snapshot', () => {
    const flags = {
      tripPlanning: false,
      routeAnalysis: false,
      elevationForecast: false,
      gearRecommendations: false,
      scoreBreakdown: false,
      avalancheDetails: false,
      airQualityDetails: false,
      fireRiskDetails: false,
      heatRiskDetails: false,
      snowpackDetails: false,
      fieldObservations: false,
      windLoadingDetails: false,
      daylightTimeline: false,
      weatherContextDetails: false,
    };
    const filtered = sanitizeReportForFeatureFlags({
      weather: {
        description: 'Cloudy and windy',
        visibilityRisk: { level: 'High' },
        elevationForecast: [{ elevationFt: 9000 }],
      },
      solar: { sunrise: '05:30', sunset: '20:45' },
      avalanche: { risk: 'High' },
      airQuality: { aqi: 180 },
      fireRisk: { level: 'High' },
      heatRisk: { level: 'Extreme' },
      snowpack: { snotel: { snowDepthIn: 40 } },
      localConditions: { stations: [{ name: 'Nearby weather station' }] },
      gear: [{ id: 'navigation-low-vis', title: 'Navigation backup' }],
      safety: {
        score: 68,
        primaryHazard: 'Wind',
        factors: [{ hazard: 'Darkness', impact: -8 }],
        explanations: ['Daylight is limited.'],
        confidenceReasons: ['Nearby station is current.'],
        sourcesUsed: ['SNOTEL'],
      },
    }, flags);

    expect(filtered.featureFlags).toEqual(flags);
    expect(filtered.weather).toEqual({ description: 'Cloudy and windy' });
    expect(filtered.safety).toEqual({ score: 68, primaryHazard: 'Wind' });
    expect(filtered).not.toHaveProperty('solar');
    expect(filtered).not.toHaveProperty('avalanche');
    expect(filtered).not.toHaveProperty('airQuality');
    expect(filtered).not.toHaveProperty('fireRisk');
    expect(filtered).not.toHaveProperty('heatRisk');
    expect(filtered).not.toHaveProperty('snowpack');
    expect(filtered).not.toHaveProperty('localConditions');
    expect(filtered).not.toHaveProperty('gear');
    const { featureFlags, ...reportContent } = filtered;
    expect(JSON.stringify(reportContent)).not.toMatch(/avalanche|air quality|AQI|fire risk|heat risk|snowpack|SNOTEL|nearby station|daylight|visibility risk/i);
  });

  test('removes avalanche sentences while preserving brief section labels and enabled content', () => {
    expect(removeAvalancheNarrativeReferences(
      'BIG PICTURE: Avalanche danger is high. Wind gusts reach 45 mph.\nBEST MOVE: Check the avalanche bulletin. Use sheltered terrain.',
    )).toBe(
      'BIG PICTURE: Wind gusts reach 45 mph.\nBEST MOVE: Use sheltered terrain.',
    );
  });
});

describe('alerts through the feature filter', () => {
  const reportWith = (alerts) => ({
    weather: { description: 'Clear', trend: [] },
    safety: { score: 90, factors: [] },
    alerts: { source: 'NOAA/NWS Active Alerts', highestSeverity: 'Unknown', ...alerts },
  });
  // The three ways a report reaches the filter with a feature turned off.
  const filters = {
    'sanitize (avalanche off)': (report) => sanitizeReportForFeatureFlags(report, { avalancheDetails: false }),
    'removeAvalancheReferences': (report) => removeAvalancheReferences(report),
    'removeDisabledFeatureReferences (fire off)': (report) => removeDisabledFeatureReferences(report, { fireRiskDetails: false }),
  };

  test.each(Object.keys(filters))('%s: an alert feed that was down is not turned into "no alerts"', (name) => {
    const { alerts } = filters[name](reportWith({ status: 'unavailable', activeCount: 0, totalActiveCount: 0, alerts: [] }));
    expect(alerts.status).toBe('unavailable');
    expect(alerts.activeCount).toBe(0);
    expect(alerts.highestSeverity).toBe('Unknown');
  });

  test.each(Object.keys(filters))('%s: "none at your start" keeps its meaning and the alerts that exist elsewhere', (name) => {
    const { alerts } = filters[name](reportWith({
      status: 'none_for_selected_start',
      activeCount: 0,
      totalActiveCount: 3,
      note: 'No currently issued alert is active at the selected start time.',
      alerts: [],
    }));
    expect(alerts.status).toBe('none_for_selected_start');
    expect(alerts.totalActiveCount).toBe(3);
    expect(alerts.note).toMatch(/selected start time/);
  });

  test('removing every listed alert leaves "none"', () => {
    const report = reportWith({
      status: 'ok',
      activeCount: 1,
      totalActiveCount: 1,
      highestSeverity: 'Severe',
      alerts: [{ event: 'Avalanche Warning', severity: 'Severe' }],
    });
    const { alerts } = sanitizeReportForFeatureFlags(report, { avalancheDetails: false });
    expect(alerts).toMatchObject({ status: 'none', activeCount: 0, totalActiveCount: 0, alerts: [] });
    expect(alerts.highestSeverity).toBeUndefined();
  });

  // The fetch keeps the six most severe alerts and counts them all, so a filter can remove every listed alert while others stay active.
  const listedSix = (event) => Array.from({ length: 6 }, (_, i) => ({ event: `${event} ${i + 1}`, severity: 'Extreme' }));
  const beyondTheSix = { status: 'ok', activeCount: 8, totalActiveCount: 9, highestSeverity: 'Extreme' };

  test.each(['sanitize (avalanche off)', 'removeAvalancheReferences'])('%s: alerts beyond the six listed stay active when every listed one is filtered out', (name) => {
    const { alerts } = filters[name](reportWith({ ...beyondTheSix, alerts: listedSix('Avalanche Warning') }));
    // Two alerts were never in the capped list. They are still active; how severe they are is unknown.
    expect(alerts).toMatchObject({ status: 'ok', activeCount: 2, totalActiveCount: 3, highestSeverity: 'Unknown', alerts: [] });
  });

  test('the same holds when the feature that hides the listed alerts is fire', () => {
    const { alerts } = sanitizeReportForFeatureFlags(reportWith({ ...beyondTheSix, alerts: listedSix('Red Flag Warning') }), { fireRiskDetails: false });
    expect(alerts).toMatchObject({ status: 'ok', activeCount: 2, totalActiveCount: 3, highestSeverity: 'Unknown', alerts: [] });
  });

  test('when only alerts outside the selected start remain, the status says so instead of "none"', () => {
    const report = reportWith({
      status: 'ok',
      activeCount: 2,
      totalActiveCount: 5,
      highestSeverity: 'Extreme',
      alerts: [{ event: 'Avalanche Warning', severity: 'Extreme' }, { event: 'Avalanche Watch', severity: 'Severe' }],
    });
    const { alerts } = sanitizeReportForFeatureFlags(report, { avalancheDetails: false });
    expect(alerts).toMatchObject({ status: 'none_for_selected_start', activeCount: 0, totalActiveCount: 3, alerts: [] });
    expect(alerts.highestSeverity).toBeUndefined();
  });

  test('a block that still has active alerts is not read downstream as "No active"', () => {
    const report = makeReport();
    report.alerts = { source: 'NOAA/NWS Active Alerts', ...beyondTheSix, alerts: listedSix('Avalanche Warning') };
    const filtered = sanitizeReportForFeatureFlags(report, { avalancheDetails: false });
    const evaluation = evaluatePlan(filtered, buildPlanContext({ start: '07:00', travel_window_hours: '10', approach: 'off' }, filtered));
    expect(evaluation.decision.cautions.join(' ')).toMatch(/2 active NWS alerts overlap the selected start/);
    const row = evaluation.interpretation.sourceFreshness.rows.find((entry) => entry.label === 'Alerts');
    expect(row.displayValue).not.toBe('No active');
    expect(row.state).not.toBe('fresh');
  });

  test('removing some alerts lowers the counts by that many, even beyond the six listed', () => {
    const listed = [
      { event: 'Avalanche Warning', severity: 'Extreme' },
      { event: 'High Wind Warning', severity: 'Moderate' },
      { event: 'Winter Weather Advisory', severity: 'Minor' },
      { event: 'Wind Advisory', severity: 'Minor' },
      { event: 'Frost Advisory', severity: 'Minor' },
      { event: 'Dense Fog Advisory', severity: 'Minor' },
    ];
    const report = reportWith({ status: 'ok', activeCount: 8, totalActiveCount: 9, highestSeverity: 'Extreme', alerts: listed });
    const { alerts } = sanitizeReportForFeatureFlags(report, { avalancheDetails: false });
    expect(alerts.alerts.map((alert) => alert.event)).not.toContain('Avalanche Warning');
    expect(alerts).toMatchObject({ status: 'ok', activeCount: 7, totalActiveCount: 8, highestSeverity: 'Moderate' });
  });

  test('a filter that removes nothing leaves the counts as they were', () => {
    const report = reportWith({
      status: 'ok',
      activeCount: 8,
      totalActiveCount: 9,
      highestSeverity: 'Moderate',
      alerts: [{ event: 'High Wind Warning', severity: 'Moderate' }],
    });
    const { alerts } = sanitizeReportForFeatureFlags(report, { avalancheDetails: false });
    expect(alerts).toMatchObject({ status: 'ok', activeCount: 8, totalActiveCount: 9, highestSeverity: 'Moderate' });
  });
});
