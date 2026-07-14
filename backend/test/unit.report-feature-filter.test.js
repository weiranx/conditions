'use strict';

const {
  getScoreFeatureSnapshot,
  removeAvalancheNarrativeReferences,
  reportMatchesScoreFeatures,
  sanitizeReportForFeatureFlags,
} = require('../src/utils/report-feature-filter');

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
      gear: [
        { id: 'avalanche-kit', title: 'Avalanche rescue kit' },
        { id: 'layering-core', title: 'Layering system' },
      ],
      safety: {
        primaryHazard: 'Avalanche',
        factors: [
          { group: 'avalanche', hazard: 'Avalanche', impact: -25 },
          { group: 'weather', hazard: 'Wind', impact: -5 },
        ],
        explanations: ['Avalanche danger is Considerable.', 'Strong wind is expected.'],
        confidenceReasons: ['Avalanche bulletin is current.', 'Weather forecast is current.'],
        sourcesUsed: ['Avalanche center', 'NOAA forecast'],
        groupImpacts: { avalanche: -25, weather: -5 },
      },
    };

    const filtered = sanitizeReportForFeatureFlags(report, flags);

    expect(filtered.avalanche).toBeUndefined();
    expect(filtered.gear).toEqual([{ id: 'layering-core', title: 'Layering system' }]);
    expect(filtered.safety.factors).toEqual([{ group: 'weather', hazard: 'Wind', impact: -5 }]);
    expect(filtered.safety.explanations).toEqual(['Strong wind is expected.']);
    expect(filtered.safety.confidenceReasons).toEqual(['Weather forecast is current.']);
    expect(filtered.safety.sourcesUsed).toEqual(['NOAA forecast']);
    expect(filtered.safety.groupImpacts).toEqual({ weather: -5 });
    expect(filtered.safety.primaryHazard).toBe('Wind');
    expect(filtered.alerts.alerts).toEqual([{ event: 'High Wind Warning', severity: 'Moderate' }]);
    expect(filtered.alerts.activeCount).toBe(1);
    expect(filtered.localConditions.closures.alerts).toEqual([{ title: 'Trailhead gate closed' }]);
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
