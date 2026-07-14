'use strict';

// ============================================================================
// unit.local-conditions.test.js
//
// Unit tests for backend/src/utils/local-conditions.js — the pure
// classification + assembly helpers behind the Tier B providers
// (streamflow, smoke/PM2.5 outlook, tides, NPS closures).
// ============================================================================

const {
  classifyFlowTrend,
  categorizePm25,
  summarizeTides,
  filterClosureAlerts,
  buildLocalConditions,
} = require('../src/utils/local-conditions');

describe('classifyFlowTrend', () => {
  test('detects a rising series', () => {
    expect(classifyFlowTrend([10, 11, 12, 20, 22, 25])).toBe('rising');
  });
  test('detects a falling series', () => {
    expect(classifyFlowTrend([25, 22, 18, 12, 11, 10])).toBe('falling');
  });
  test('detects a steady series', () => {
    expect(classifyFlowTrend([10, 10.2, 9.9, 10.1, 10, 9.95])).toBe('steady');
  });
  test('returns unknown for short series', () => {
    expect(classifyFlowTrend([10])).toBe('unknown');
    expect(classifyFlowTrend([])).toBe('unknown');
  });
  test('ignores non-finite values', () => {
    expect(classifyFlowTrend([null, 10, undefined, 11, 12, 20, 22, 25])).toBe('rising');
  });
});

describe('categorizePm25', () => {
  test('EPA breakpoints', () => {
    expect(categorizePm25(8)).toBe('Good');
    expect(categorizePm25(30)).toBe('Moderate');
    expect(categorizePm25(45)).toBe('Unhealthy for Sensitive Groups');
    expect(categorizePm25(60)).toBe('Unhealthy');
    expect(categorizePm25(200)).toBe('Very Unhealthy');
    expect(categorizePm25(300)).toBe('Hazardous');
  });
  test('null for missing input', () => {
    expect(categorizePm25(null)).toBeNull();
    expect(categorizePm25('')).toBeNull();
  });
});

describe('summarizeTides', () => {
  const predictions = [
    { t: '2030-01-01 03:00', v: '5.1', type: 'H' },
    { t: '2030-01-01 09:00', v: '0.4', type: 'L' },
    { t: '2030-01-01 15:00', v: '5.6', type: 'H' },
  ];

  test('returns next high and low after now', () => {
    const now = Date.parse('2030-01-01T03:00:00') - 3_600_000; // 1h before first event (local)
    const summary = summarizeTides(predictions, now);
    expect(summary.nextHigh.heightFt).toBe(5.1);
    expect(summary.nextLow.heightFt).toBe(0.4);
    expect(summary.direction).toBe('rising');
  });

  test('direction is falling when the next event is a low', () => {
    const now = Date.parse('2030-01-01T05:00:00'); // between first high and the low
    const summary = summarizeTides(predictions, now);
    expect(summary.direction).toBe('falling');
    expect(summary.nextLow.heightFt).toBe(0.4);
  });

  test('handles empty predictions', () => {
    const summary = summarizeTides([], Date.now());
    expect(summary.nextHigh).toBeNull();
    expect(summary.nextLow).toBeNull();
    expect(summary.direction).toBe('unknown');
  });
});

describe('filterClosureAlerts', () => {
  test('ranks closures/dangers ahead of informational alerts and drops empty titles', () => {
    const result = filterClosureAlerts([
      { title: 'Visitor center hours', category: 'Information' },
      { title: '', category: 'Park Closure' },
      { title: 'Tioga Road closed', category: 'Park Closure', url: 'https://nps.gov/x', lastIndexedDate: '2026-07-14' },
      { title: 'Bear activity', category: 'Caution' },
    ]);
    expect(result[0].title).toBe('Tioga Road closed');
    expect(result[0].lastIndexedDate).toBe('2026-07-14');
    expect(result.map((a) => a.title)).not.toContain('');
    expect(result.map((a) => a.title)).not.toContain('Visitor center hours');
  });

  test('respects the limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ title: `Alert ${i}`, category: 'Caution' }));
    expect(filterClosureAlerts(many, { limit: 3 })).toHaveLength(3);
  });
});

describe('buildLocalConditions', () => {
  test('flags hasAnySignal when any provider is available', () => {
    const built = buildLocalConditions({
      streamflow: { available: false },
      smoke: { available: true, peakPm25: 40 },
      tides: null,
      closures: { available: false },
      radar: { available: true, echoDetected: false },
    });
    expect(built.hasAnySignal).toBe(true);
    expect(built.smoke.peakPm25).toBe(40);
    expect(built.tides).toBeNull();
  });

  test('hasAnySignal is false when nothing is available', () => {
    const built = buildLocalConditions({
      streamflow: { available: false },
      smoke: { available: false },
      tides: { available: false },
      closures: { available: false },
      weatherObservation: { available: false },
      radar: { available: false },
      access: { available: false },
      wildfire: { available: false },
    });
    expect(built.hasAnySignal).toBe(false);
  });
});
