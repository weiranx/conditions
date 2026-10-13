const { compactReportForAI, fitReportForAI } = require('../src/utils/ai-report-context');

const row = (i) => ({ time: `${String(i % 24).padStart(2, '0')}:00`, temp: 30 + i, gust: 10 + i, note: 'x'.repeat(200) });
const bigReport = () => ({
  safety: { score: 61 },
  weather: { windGust: 32, trend: Array.from({ length: 24 }, (_, i) => row(i)) },
  objectiveImage: { url: 'https://example.test/image.jpg' },
  evaluation: {
    decision: { level: 'CAUTION', headline: 'Gusts build by noon.' },
    verdict: { tone: 'watch' },
    terrain: { byAspect: Array.from({ length: 200 }, (_, i) => row(i)), grouped: [row(1)] },
    elevation: { bandsByHour: Array.from({ length: 150 }, (_, i) => row(i)), target: { ft: 14411 } },
    travelWindow: { readings: Array.from({ length: 100 }, (_, i) => row(i)), planned: { rows: [row(1)] } },
  },
});

test('a report that fits is passed through untouched', () => {
  const report = { safety: { score: 61 } };
  expect(fitReportForAI(report, 1000)).toBe(report);
});

test('restated detail is left out first, and the decision, verdict and readings stay', () => {
  const report = bigReport();
  const limit = JSON.stringify(report).length - 40000;
  const fitted = fitReportForAI(report, limit);
  expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(limit);
  expect(fitted.omittedForLength).toEqual(['objectiveImage', 'evaluation.terrain.byAspect']);
  expect(fitted.evaluation.decision).toEqual(report.evaluation.decision);
  expect(fitted.evaluation.terrain.grouped).toHaveLength(1);
  expect(fitted.weather.windGust).toBe(32);
  expect(report.evaluation.terrain.byAspect).toHaveLength(200);
});

test('with the tables gone, long text and lists are shortened before anything is refused', () => {
  const report = { ...bigReport(), notes: 'y'.repeat(30000) };
  const fitted = fitReportForAI(report, 12000);
  expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(12000);
  expect(fitted.omittedForLength).toEqual(expect.arrayContaining(['evaluation.terrain', 'evaluation.travelWindow', expect.stringMatching(/shortened/)]));
  expect(fitted.evaluation.decision.level).toBe('CAUTION');
  expect(fitted.safety.score).toBe(61);
  expect(fitReportForAI(report, 200)).toBeNull();
});

test('shortening never cuts the hours, checks or hazards behind the decision', () => {
  const checks = Array.from({ length: 30 }, (_, i) => ({ id: `check-${i}`, ok: i !== 29, detail: 'z'.repeat(300) }));
  const report = { ...bigReport(), evaluation: { ...bigReport().evaluation, decision: { level: 'CAUTION', checks } }, notes: Array.from({ length: 400 }, () => 'n'.repeat(300)) };
  const fitted = fitReportForAI(report, 40000);
  expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(40000);
  expect(fitted.weather.trend).toHaveLength(24);
  expect(fitted.weather.trend[23].note).toHaveLength(200);
  expect(fitted.evaluation.decision.checks).toHaveLength(30);
  expect(fitted.evaluation.decision.checks[29]).toEqual(checks[29]);
  expect(fitted.notes.length).toBeLessThan(400);
});

test('the hours judged below the objective are lifted out so the AI can explain them', () => {
  const report = {
    evaluation: {
      params: {},
      travelWindow: { planned: {
        rows: [{ time: '07:00' }, { time: '08:00' }, { time: '09:00' }],
        approachSummary: { adjustedHours: 2, lowFt: 11487, highFt: 12210, adjustedRuns: [{ start: 0, end: 1 }], inversionRuns: [{ start: 0, end: 0 }] },
      } },
    },
  };
  const { approach } = compactReportForAI(report);
  expect(approach).toMatchObject({
    trailhead: 'estimated', hoursBelowObjective: 2, lowestFt: 11487, highestFt: 12210,
    belowObjective: [{ firstHour: '07:00', lastHour: '08:00' }],
    inversionRisk: [{ firstHour: '07:00', lastHour: '07:00' }],
  });
  expect(compactReportForAI({ evaluation: { travelWindow: { planned: { rows: [], approachSummary: null } } } }).approach).toBeUndefined();
  const fitted = fitReportForAI({ ...compactReportForAI(report), padding: 'x'.repeat(5000) }, 3000);
  expect(fitted.approach).toEqual(approach);
});
