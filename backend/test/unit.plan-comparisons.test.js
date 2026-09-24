const express = require('express');
const request = require('supertest');

const { registerPlanComparisonRoutes } = require('../src/routes/plan-comparisons');
const { attachPlanEvaluation } = require('../src/utils/plan-evaluation');
const {
  buildStartTimeScenario,
  compareStartTimeScenarios,
  includeUserStartTimeScenario,
} = require('../src/utils/start-time-scenarios');
const { buildDayOverDayChanges, formatScoreDelta, scoresComparable } = require('../src/utils/day-over-day');
const { makeReport } = require('./fixtures/plan-report');

const DATE = new Date().toISOString().slice(0, 10);
const PLAN = { lat: '46.8523', lon: '-121.7603', date: DATE, start: '07:00', travel_window_hours: '10', approach: 'off' };

// The safety handler as the routes see it: an evaluated report for each query.
const fakeSafetyHandler = (shape = () => {}) => jest.fn(async (query) => {
  const report = makeReport({ date: query.date, start: query.start, hours: Number(query.travel_window_hours) || 12 });
  shape(report, query);
  return { statusCode: 200, payload: attachPlanEvaluation(report, query) };
});

const makeApp = (invokeSafetyHandler, options = {}) => {
  const app = express();
  registerPlanComparisonRoutes({ app, invokeSafetyHandler, ensureStartTimesEnabled: () => {}, ...options });
  return app;
};

describe('start-time scenarios', () => {
  test('the planned start replaces the closest preset departure', () => {
    // Equidistant presets: the earlier one gives way.
    expect(includeUserStartTimeScenario(['04:00', '06:00', '08:00'], '07:00')).toEqual(['04:00', '07:00', '08:00']);
    expect(includeUserStartTimeScenario(['04:00', '06:00', '08:00'], '07:30')).toEqual(['04:00', '06:00', '07:30']);
    expect(includeUserStartTimeScenario(['04:00', '06:00', '08:00'], '06:00')).toEqual(['04:00', '06:00', '08:00']);
    expect(includeUserStartTimeScenario(['04:00', '06:00', '08:00'], 'dawn')).toEqual(['04:00', '06:00', '08:00']);
  });

  test('each departure is evaluated for the plan and ranked', async () => {
    const invoke = fakeSafetyHandler((report, query) => {
      // Later starts run into afternoon gusts.
      if (query.start >= '07:00') report.weather.trend[5].gust = 45;
    });
    const res = await request(makeApp(invoke)).get('/api/start-time-scenarios').query(PLAN);
    expect(res.status).toBe(200);
    expect(invoke.mock.calls.map(([query]) => query.start)).toEqual(['04:00', '07:00', '08:00']);
    expect(invoke.mock.calls.every(([query, options]) => query.approach === 'off' && options.suppressReportLog)).toBe(true);
    const { comparison } = res.body;
    expect(comparison.scenarios.map((scenario) => scenario.startTime)).toEqual(['04:00', '07:00', '08:00']);
    expect(comparison.scenarios.map((scenario) => scenario.decision.level)).toEqual(['GO', 'NO-GO', 'NO-GO']);
    expect(comparison.bestStartTime).toBe('04:00');
    expect(comparison.suggestion).toBe('changes the decision to Go');
    expect(comparison.scenarios[0].planned.rows).toHaveLength(10);
    expect(res.body.error).toBeNull();
  });

  test('more departures are compared on request, and failures are reported', async () => {
    const invoke = jest.fn(async (query) => (query.start === '05:00'
      ? { statusCode: 500, payload: { error: 'boom' } }
      : { statusCode: 200, payload: attachPlanEvaluation(makeReport({ date: query.date, start: query.start }), query) }));
    const res = await request(makeApp(invoke)).get('/api/start-time-scenarios').query({ ...PLAN, set: 'extended' });
    expect(res.body.requestedTimes).toEqual(['03:00', '04:00', '05:00', '06:00', '07:00', '08:00', '09:00', '10:00']);
    expect(res.body.comparison.scenarios).toHaveLength(7);
    expect(res.body.error).toMatch(/could not be evaluated/);
  });

  test('a return past midnight is checked on the start day', async () => {
    const res = await request(makeApp(fakeSafetyHandler())).get('/api/start-time-scenarios')
      .query({ ...PLAN, travel_window_hours: '16' });
    const late = res.body.comparison.scenarios.find((scenario) => scenario.startTime === '08:00');
    expect(late.returnTime).toBe('00:00');
    expect(late.returnDayOffset).toBe(1);
    expect(late.daylightRemainingMinutes).toBeLessThan(0);
  });

  test('an invalid plan or a disabled feature is refused', async () => {
    const app = makeApp(fakeSafetyHandler());
    expect((await request(app).get('/api/start-time-scenarios').query({ ...PLAN, start: '7am' })).status).toBe(400);
    const disabled = makeApp(fakeSafetyHandler(), {
      ensureStartTimesEnabled: () => { throw Object.assign(new Error('This feature is unavailable'), { statusCode: 503 }); },
    });
    expect((await request(disabled).get('/api/start-time-scenarios').query(PLAN)).status).toBe(503);
  });

  const scenario = (startTime, level, score, daylight) => ({
    ...buildStartTimeScenario(startTime, makeReport({ start: startTime }), attachPlanEvaluation(makeReport({ start: startTime }), { start: startTime }).evaluation, 10),
    decision: { level, headline: '' },
    score,
    daylightRemainingMinutes: daylight,
  });
  const context = { limits: { maxWindGustMph: 25, maxPrecipChance: 60, minFeelsLikeF: 5, maxFeelsLikeF: 95 }, travelWindowHours: 10, plannedStart: '08:00' };

  test('nothing is suggested when every departure is a no-go', () => {
    const comparison = compareStartTimeScenarios([scenario('04:00', 'NO-GO', 30, 313), scenario('08:00', 'NO-GO', 40, 73)], context);
    expect(comparison.allNoGo).toBe(true);
    expect(comparison.recommendationReason).toMatch(/Every departure compared here is a no-go/);
    expect(comparison.suggestion).toBeNull();
  });

  test('the most daylight is claimed only when it is true', () => {
    const tiedLater = compareStartTimeScenarios([scenario('04:00', 'GO', 90, 313), scenario('08:00', 'GO', 90.5, 73)], context);
    expect(tiedLater.bestStartTime).toBe('08:00');
    expect(tiedLater.recommendationReason).not.toMatch(/daylight/);
    const tiedEarlier = compareStartTimeScenarios([scenario('04:00', 'GO', 90.5, 313), scenario('08:00', 'GO', 90, 73)], context);
    expect(tiedEarlier.recommendationReason).toMatch(/leaves the most daylight/);
    expect(tiedEarlier.suggestion).toBeNull();
  });

  test('a clearly higher score is suggested with both scores', () => {
    const comparison = compareStartTimeScenarios([scenario('04:00', 'GO', 95, 313), scenario('08:00', 'GO', 80, 73)], context);
    expect(comparison.suggestion).toBe('scores higher (95 vs 80)');
  });

  test('a start that only ranks higher on a tiebreak is not suggested over the plan', () => {
    // A third departure with a worse decision keeps the set from reading as tied.
    const comparison = compareStartTimeScenarios([
      scenario('04:00', 'CAUTION', 74, 313),
      scenario('08:00', 'CAUTION', 74, 73),
      scenario('10:00', 'NO-GO', 60, 0),
    ], context);
    expect(comparison.effectivelyTied).toBe(false);
    expect(comparison.bestStartTime).toBe('04:00');
    expect(comparison.suggestion).toBeNull();
  });

  test('unknown peaks stay unknown', () => {
    const report = makeReport();
    Object.assign(report.weather, { temp: null, feelsLike: null, windGust: null, precipChance: null });
    report.weather.trend = report.weather.trend.map((hour) => ({ ...hour, temp: null, gust: null, precipChance: null }));
    const built = buildStartTimeScenario('07:00', report, attachPlanEvaluation(report, { start: '07:00' }).evaluation, 10);
    expect([built.peakGustMph, built.peakFeelsLikeF, built.peakPrecipChance]).toEqual([null, null, null]);
  });
});

describe('day over day', () => {
  test('compares the plan with the same plan a day earlier', async () => {
    const invoke = fakeSafetyHandler((report, query) => {
      if (query.date !== DATE) {
        report.safety.score = 70;
        report.weather.windGust = 30;
      }
    });
    const res = await request(makeApp(invoke)).get('/api/day-over-day').query({ ...PLAN, wind_unit: 'kph' });
    expect(res.status).toBe(200);
    const previousDate = new Date(Date.parse(`${DATE}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    expect(invoke.mock.calls.map(([query]) => [query.date, query.start, query.travel_window_hours])).toEqual([
      [DATE, '07:00', '10'],
      [previousDate, '07:00', '10'],
    ]);
    expect(res.body.comparison).toMatchObject({
      previousDate,
      startTime: '07:00',
      travelWindowHours: 10,
      previousScore: 70,
      delta: 21,
      deltaLabel: '+21',
      scoreComparable: true,
    });
    expect(res.body.comparison.changes).toContain('Wind gust changed -24 km/h.');
  });

  test('no comparison without a scored prior day', async () => {
    const invoke = fakeSafetyHandler((report, query) => {
      if (query.date !== DATE) report.safety.score = null;
    });
    expect((await request(makeApp(invoke)).get('/api/day-over-day').query(PLAN)).body.comparison).toBeNull();
  });

  test('score changes round like the scores and skip days without a score', () => {
    expect(formatScoreDelta(38 - 50.6)).toBe('-12.6');
    expect(formatScoreDelta(0.04)).toBe('0');
    expect(formatScoreDelta(3)).toBe('+3');
    const scored = makeReport();
    scored.safety = { ...scored.safety, score: 38.4, assessmentStatus: 'supported' };
    const previous = makeReport();
    previous.safety = { ...previous.safety, score: 51, assessmentStatus: 'supported' };
    expect(scoresComparable(scored, previous)).toBe(true);
    expect(buildDayOverDayChanges(scored, previous, {})).toContain('Safety score -12.6 (51 -> 38.4).');
    const unscored = { ...scored, safety: { ...scored.safety, assessmentStatus: 'insufficient_evidence' } };
    expect(scoresComparable(unscored, previous)).toBe(false);
    expect(buildDayOverDayChanges(unscored, previous, {}).some((line) => /Safety score/.test(line))).toBe(false);
  });

  test('a real zero prior score compares; a missing one does not', () => {
    const { buildDayOverDay } = require('../src/utils/day-over-day');
    const compare = (previousScore) => {
      const previous = makeReport();
      previous.safety.score = previousScore;
      return buildDayOverDay({ current: makeReport(), previous, previousDate: '2026-09-05', startTime: '07:00', travelWindowHours: 10, units: {} });
    };
    expect(compare(0)).toMatchObject({ previousScore: 0, delta: 91 });
    for (const missing of [null, '', '   ']) expect(compare(missing)).toBeNull();
  });

  test('blank readings are missing evidence, not changes', () => {
    const current = makeReport();
    const previous = makeReport();
    previous.safety.score = null;
    previous.weather.windGust = null;
    previous.weather.feelsLike = '';
    previous.weather.temp = null;
    previous.weather.precipChance = ' ';
    expect(buildDayOverDayChanges(current, previous, {})).toEqual([]);
    previous.safety.score = 0;
    previous.weather.windGust = 0;
    const changes = buildDayOverDayChanges(current, previous, {});
    expect(changes.some((change) => change.startsWith('Safety score'))).toBe(true);
    expect(changes.some((change) => change.startsWith('Wind gust'))).toBe(true);
  });

  test('missing evidence is not a change, a genuine zero is', () => {
    const current = makeReport();
    const previous = makeReport();
    current.weather.windGust = null;
    previous.weather.precipChance = 0;
    current.weather.precipChance = 40;
    const changes = buildDayOverDayChanges(current, previous, {});
    expect(changes.some((line) => /Wind gust/.test(line))).toBe(false);
    expect(changes).toContain('Precip chance changed +40%.');
  });
});
