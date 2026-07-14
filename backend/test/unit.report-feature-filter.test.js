'use strict';

const {
  getScoreFeatureSnapshot,
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
    expect(JSON.stringify(filtered)).not.toMatch(/Considerable|Deep Persistent Slab|Avalanche rescue kit/);
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
});
