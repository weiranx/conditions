const express = require('express');
const request = require('supertest');

const { evaluateDecision, trendRowsCoveringWindow } = require('../src/utils/decision');
const { buildPlanContext } = require('../src/utils/plan-context');
const { evaluatePlan, attachPlanEvaluation } = require('../src/utils/plan-evaluation');
const {
  buildPlannedRows,
  buildReadingRows,
  buildTravelWindowInsights,
  deriveTravelWindowSpans,
} = require('../src/utils/travel-window');
const { buildApproachProfile, readingMinutesAfterStart, summarizeApproachHours } = require('../src/utils/approach-elevation');
const { localizeDistanceText, localizeUnitText } = require('../src/utils/display-format');
const { assessCriticalWindowPoint } = require('../src/utils/critical-window');
const { registerEvaluateRoute } = require('../src/routes/evaluate');
const { makeReport } = require('./fixtures/plan-report');

// Approach adjustment has its own tests; the rest check the objective forecast.
const DEFAULT_PARAMS = { start: '07:00', travel_window_hours: '10', activity: 'hiking', approach: 'off' };
const contextFor = (report, params = {}, options = {}) => buildPlanContext({ ...DEFAULT_PARAMS, ...params }, report, options);
const decide = (report, params = {}, options = {}) => evaluateDecision(report, contextFor(report, params, options));
const check = (decision, key) => decision.checks.find((item) => item.key === key);

describe('plan context', () => {
  test('limits come from the request, falling back to the activity defaults', () => {
    const report = makeReport();
    expect(contextFor(report, { activity: 'trail-running' }).limits)
      .toEqual({ maxWindGustMph: 30, maxPrecipChance: 50, minFeelsLikeF: 25, maxFeelsLikeF: 85 });
    const custom = contextFor(report, { max_gust_mph: '40', max_precip_chance: '33.4', min_feels_like_f: '-10', max_feels_like_f: 'hot' });
    expect(custom.limits).toEqual({ maxWindGustMph: 40, maxPrecipChance: 33, minFeelsLikeF: -10, maxFeelsLikeF: 95 });
    expect(contextFor(report, { max_gust_mph: '500' }).limits.maxWindGustMph).toBe(80);
  });

  test('units default to imperial and a 12-hour clock', () => {
    expect(contextFor(makeReport()).units).toEqual({ temperature: 'f', wind: 'mph', elevation: 'ft', timeStyle: 'ampm' });
    expect(contextFor(makeReport(), { temp_unit: 'c', wind_unit: 'kph', elevation_unit: 'm', time_style: '24h' }).units)
      .toEqual({ temperature: 'c', wind: 'kph', elevation: 'm', timeStyle: '24h' });
  });

  test('the turnaround is the end of the travel window, held at 23:59 past midnight', () => {
    expect(contextFor(makeReport(), { start: '07:00', travel_window_hours: '10' }).turnaroundTime).toBe('17:00');
    expect(contextFor(makeReport(), { start: '20:00', travel_window_hours: '8' }).turnaroundTime).toBe('23:59');
    expect(contextFor(makeReport(), {}, { withTurnaround: false }).turnaroundTime).toBeNull();
  });

  test('only plan keys are echoed, as strings', () => {
    const context = contextFor(makeReport(), { lat: '40', name: 'Peak', max_gust_mph: 30 });
    expect(context.params).toEqual({ ...DEFAULT_PARAMS, max_gust_mph: '30' });
  });
});

describe('decision', () => {
  test('a clear day within limits is a GO', () => {
    const decision = decide(makeReport());
    expect(decision.level).toBe('GO');
    expect(decision.blockers).toEqual([]);
    expect(decision.cautions).toEqual([]);
  });

  test('an hour without a temperature reading is not scored as 0 °F', () => {
    const report = makeReport();
    report.weather.trend[3].temp = null;
    const decision = decide(report);
    expect(check(decision, 'feels-like').ok).toBe(true);
    expect(check(decision, 'feels-like').detail).not.toMatch(/-\d+°F|\b0°F/);
    expect(decision.cautions.some((text) => /Apparent temperature falls/.test(text))).toBe(false);
  });

  test('the heat blocker uses the hottest hour of the window, not the coldest', () => {
    const report = makeReport();
    report.weather.trend[6].temp = 101;
    const decision = decide(report);
    expect(decision.level).toBe('NO-GO');
    expect(decision.blockers.some((text) => /Apparent temperature reaches about 101°F/.test(text))).toBe(true);
  });

  test('missing gust and precipitation are reported as unavailable, not as passing at 0', () => {
    const report = makeReport();
    report.weather.windGust = null;
    report.weather.precipChance = null;
    report.weather.trend = report.weather.trend.map((hour) => ({ ...hour, gust: null, precipChance: null }));
    const decision = decide(report);
    expect([check(decision, 'wind-gust'), check(decision, 'precipitation')].map(({ ok, detail }) => [ok, detail]))
      .toEqual([[false, 'Wind gust data unavailable.'], [false, 'Precipitation chance unavailable.']]);
  });

  test('measured calm and dry readings still pass', () => {
    const report = makeReport();
    report.weather.windGust = 0;
    report.weather.trend = report.weather.trend.map((hour) => ({ ...hour, gust: 0, precipChance: 0 }));
    const decision = decide(report);
    expect(check(decision, 'wind-gust').ok).toBe(true);
    expect(check(decision, 'precipitation').ok).toBe(true);
    expect(check(decision, 'precipitation').detail).toMatch(/0%/);
  });

  test('a fire decision says what sets the fire risk, in the viewer\'s distance unit', () => {
    const report = makeReport();
    report.fireRisk = {
      status: 'ok',
      level: 4,
      label: 'Extreme',
      reasons: ['The Garda Falls fire (73 acres, 0% contained) is about 8 km (5 mi) away.', 'Moderate AQI could affect exertion.'],
    };
    const decision = decide(report);
    expect(decision.level).toBe('NO-GO');
    expect(decision.blockers[0]).toBe('Fire risk is extreme: The Garda Falls fire (73 acres, 0% contained) is about 5 mi away. Choose another area or time, verify closures, and do not enter fire-affected terrain.');
    expect(check(decision, 'fire-risk')).toMatchObject({
      label: 'Fire risk is below High',
      detail: 'Extreme (L4). The Garda Falls fire (73 acres, 0% contained) is about 5 mi away.',
    });
    expect(decide(report, { elevation_unit: 'm' }).blockers[0]).toMatch(/is about 8 km away\./);
  });

  test('fire-weather numbers in the reason follow the viewer\'s units', () => {
    const report = makeReport();
    report.fireRisk = { status: 'ok', level: 3, label: 'High', reasons: ['Warm, dry, breezy fire weather (86F, RH 20%, wind 18 mph).'] };
    const decision = decide(report, { temp_unit: 'c', wind_unit: 'kph' });
    expect(decision.cautions.join(' ')).toMatch(/Fire risk is high: Warm, dry, breezy fire weather \(30°C, RH 20%, wind 29 km\/h\)\./);
  });

  test('limits and messages follow the requested units', () => {
    const report = makeReport();
    report.weather.trend[2].gust = 30;
    const decision = decide(report, { wind_unit: 'kph', temp_unit: 'c' });
    expect(check(decision, 'wind-gust').label).toBe('Wind gusts are at or below 40 km/h');
    expect(check(decision, 'wind-gust').detail).toBe('Peak 48 km/h at 09:00 in window (limit 40 km/h).');
    expect(check(decision, 'feels-like').label).toBe('Apparent temperature is at or above -15°C');
  });

  test('an off-the-hour start keeps its last partial hour in the decision', () => {
    expect(trendRowsCoveringWindow('05:30', 10)).toBe(11);
    expect(trendRowsCoveringWindow('06:00', 10)).toBe(10);
    const report = makeReport({ start: '05:00', hours: 11 });
    report.weather.trend[10].gust = 40;
    const gust = check(decide(report, { start: '05:30', travel_window_hours: '10' }), 'wind-gust');
    expect(gust.ok).toBe(false);
    expect(gust.detail).toMatch(/Peak 40 mph at 15:00/);
  });

  test('the daylight check uses the turnaround at the end of the travel window', () => {
    const late = decide(makeReport({ start: '12:00' }), { start: '12:00', travel_window_hours: '10' });
    expect(check(late, 'daylight').ok).toBe(false);
    expect(check(late, 'daylight').detail).toMatch(/12:00 start • back by 22:00 • 7:30 PM sunset • 150 min after sunset/);
    expect(late.cautions.some((text) => /Turnaround time is 150 minutes after sunset/.test(text))).toBe(true);
  });

  test('checks with nothing to do carry no action', () => {
    const decision = decide(makeReport());
    expect(check(decision, 'wind-gust')).not.toHaveProperty('action');
  });

  test('avalanche danger ignored for a multi-day comparison does not block', () => {
    const report = makeReport();
    report.avalanche = { relevant: true, dangerLevel: 3, coverageStatus: 'reported', publishedTime: new Date().toISOString() };
    expect(decide(report).level).toBe('NO-GO');
    expect(decide(report, {}, { ignoreAvalancheForDecision: true }).level).toBe('GO');
  });
});

describe('travel window rows', () => {
  const plannedFor = (report, params = {}) => {
    const context = contextFor(report, params);
    return buildPlannedRows(report, context, context.travelWindowHours, { start: context.start, date: context.date, approach: context.approach });
  };

  test('a missing start reading stays missing, not 0', () => {
    const report = makeReport({ hours: 2 });
    report.weather.trend[0] = { ...report.weather.trend[0], temp: null, precipChance: null };
    const rows = plannedFor(report, { travel_window_hours: '2', approach: 'off' });
    expect(Number.isNaN(rows[0].temp) && Number.isNaN(rows[0].feelsLike) && Number.isNaN(rows[0].precipChance)).toBe(true);
    expect(rows[0].complete).toBe(false);
    expect(rows[0].pass).toBe(false);
    expect(rows[1].complete).toBe(true);
  });

  test('evaluation rows send missing readings as null', () => {
    const report = makeReport({ hours: 2 });
    report.weather.trend[0] = { ...report.weather.trend[0], temp: null };
    const evaluation = evaluatePlan(report, contextFor(report, { travel_window_hours: '2', approach: 'off' }));
    const [first] = evaluation.travelWindow.planned.rows;
    expect(first.temp).toBeNull();
    expect(first.feelsLike).toBeNull();
    expect(JSON.parse(JSON.stringify(evaluation)).travelWindow.planned.rows[0].temp).toBeNull();
  });

  test('hour failure reasons use the requested units', () => {
    const report = makeReport({ hours: 1 });
    report.weather.trend[0].gust = 40;
    const [row] = plannedFor(report, { travel_window_hours: '1', wind_unit: 'kph', approach: 'off' });
    expect(row.failedRules).toEqual(['gust 64>40 km/h']);
  });

  test('the best continuous window ends when its last hour ends', () => {
    const rows = ['05:30', '06:30', '07:30'].map((time) => ({ time, pass: true, condition: 'Sunny', reasonSummary: '', failedRules: [], failedRuleLabels: [] }));
    expect(deriveTravelWindowSpans(rows)).toEqual([{ start: '05:30', end: '08:30', length: 3 }]);
    expect(buildTravelWindowInsights(rows, '24h').summary).toMatch(/Best continuous window: 05:30 to 08:30 \(3h\)/);
    const hourLabels = ['1 PM', '2 PM'].map((time) => ({ ...rows[0], time }));
    expect(deriveTravelWindowSpans(hourLabels)[0].end).toBe('15:00');
  });
});

describe('approach', () => {
  const timingParams = { ascent_min_per_kft: '45' };
  const bands = [
    { label: 'Approach Terrain', elevationFt: 8200, deltaFromObjectiveFt: -2800 },
    { label: 'Objective Elevation', elevationFt: 11000, deltaFromObjectiveFt: 0 },
  ];
  const hour = { temp: 20, wind: 12, gust: 28, precipChance: 10, cloudCover: 90, condition: 'Mostly Cloudy' };
  const reportWith = (trend) => ({
    weather: {
      elevation: 11000, elevationForecast: bands, temp: trend[0].temp, windSpeed: trend[0].wind,
      windGust: trend[0].gust, precipChance: trend[0].precipChance, cloudCover: trend[0].cloudCover,
      description: trend[0].condition, humidity: 40, trend,
    },
    solar: { sunrise: '6:30 AM', sunset: '7:30 PM' },
    forecast: { selectedDate: '2026-09-23' },
    safety: { score: 80, factors: [] },
  });
  const limits = { max_gust_mph: '25', min_feels_like_f: '5', travel_window_hours: '4' };
  const gustCaution = (decision) => [...decision.cautions, ...decision.blockers].some((item) => /Wind gusts reach/.test(item));

  test('early hours at the trailhead no longer fail on summit gusts, later hours still do', () => {
    const report = reportWith(['05:00', '06:00', '07:00', '08:00'].map((time) => ({ ...hour, time })));
    const plan = (params) => {
      const context = buildPlanContext({ start: '05:00', date: '2026-09-23', ...limits, ...timingParams, ...params }, report);
      return buildPlannedRows(report, context, 4, { start: '05:00', date: '2026-09-23', approach: context.approach });
    };
    const summitOnly = plan({ approach: 'off' });
    expect(summitOnly.map((row) => row.pass)).toEqual([false, false, false, false]);
    expect(summitOnly[0].elevationFt).toBeUndefined();

    const rows = plan({ trailhead_ft: '7000' });
    expect(rows.map((row) => row.elevationFt)).toEqual([8333, 9667, 11000, 11000]);
    expect(rows.map((row) => row.approachAdjusted)).toEqual([true, true, false, false]);
    expect(rows.map((row) => row.pass)).toEqual([true, true, false, false]);
    expect(rows[2].gust).toBe(28);
    expect(rows[0].objectiveReading).toEqual({ temp: 20, wind: 12, gust: 28 });
  });

  test('a clear, calm alpine start can fail at the trailhead because of an inversion', () => {
    const report = reportWith([{ time: '04:00', temp: 8, wind: 2, gust: 5, precipChance: 0, cloudCover: 5, condition: 'Clear' }]);
    const context = buildPlanContext({ start: '04:00', date: '2026-09-23', ...limits, travel_window_hours: '1', trailhead_ft: '7000' }, report);
    const [row] = buildPlannedRows(report, context, 1, { start: '04:00', date: '2026-09-23', approach: context.approach });
    expect(row.inversionRisk).toBe(true);
    expect(row.pass).toBe(false);
    expect(row.failedRuleLabels).toContain('Feels-like below limit');
  });

  test('the go/no-go decision scores approach hours at the party elevation', () => {
    const report = reportWith([
      { ...hour, time: '05:00', gust: 32 },
      { ...hour, time: '06:00', gust: 28 },
      { ...hour, time: '07:00', gust: 18 },
      { ...hour, time: '08:00', gust: 18 },
    ]);
    const decision = (params) => evaluateDecision(report, buildPlanContext({ start: '05:00', ...limits, ...timingParams, ...params }, report));
    expect(gustCaution(decision({ approach: 'off' }))).toBe(true);
    expect(gustCaution(decision({ trailhead_ft: '6000' }))).toBe(false);
  });

  test('a cold caution caused by a likely inversion says so', () => {
    const report = reportWith([{ time: '4 AM', temp: 8, wind: 2, gust: 5, precipChance: 0, cloudCover: 5, condition: 'Clear' }]);
    const caution = (params) => evaluateDecision(report, buildPlanContext({ start: '04:00', ...limits, ...params }, report))
      .cautions.find((item) => /Apparent temperature/.test(item)) || '';
    expect(caution({ approach: 'off' })).toBe('');
    expect(caution({ trailhead_ft: '7000' }))
      .toMatch(/near the trailhead: clear, calm conditions can pool colder air in the valley than at the summit/);
  });

  test('an off-the-hour start checks each reading at the elevation for its own minutes', () => {
    const report = reportWith([
      { ...hour, time: '05:00', gust: 10 },
      { ...hour, time: '06:00', gust: 29 },
      { ...hour, time: '07:00', gust: 10 },
      { ...hour, time: '08:00', gust: 10 },
    ]);
    const context = buildPlanContext({ start: '05:30', ...limits, trailhead_ft: '7000', ...timingParams }, report);
    const rows = buildReadingRows(report, context, 4, { profile: context.approach, start: '05:30' });
    expect(rows.slice(0, 2).map((row) => row.elevationFt)).toEqual([7667, 9000]);
    expect(rows[1].gust).toBe(24);
    expect(gustCaution(evaluateDecision(report, context))).toBe(false);
  });

  test('each reading covers the part of the trip its own clock time falls in', () => {
    expect(readingMinutesAfterStart('05:00', '05:30', 0)).toEqual({ from: 0, to: 30 });
    expect(readingMinutesAfterStart('06:00', '05:30', 1)).toEqual({ from: 30, to: 90 });
    expect(readingMinutesAfterStart('6 AM', '05:30', 1)).toEqual({ from: 30, to: 90 });
    expect(readingMinutesAfterStart('00:00', '23:00', 1)).toEqual({ from: 60, to: 120 });
    expect(readingMinutesAfterStart('05:00', '06:00', 23)).toEqual({ from: 1380, to: 1440 });
    expect(readingMinutesAfterStart('Unavailable', '05:30', 2)).toEqual({ from: 120, to: 180 });
  });

  test('the approach summary lists adjusted spans, elevation range and inversion hours', () => {
    const report = reportWith([
      { time: '05:00', temp: 20, wind: 4, gust: 8, precipChance: 0, cloudCover: 5, condition: 'Clear' },
      { ...hour, time: '06:00' },
      { ...hour, time: '07:00' },
      { ...hour, time: '08:00' },
    ]);
    const evaluation = evaluatePlan(report, buildPlanContext({ start: '05:00', date: '2026-09-23', ...limits, ...timingParams }, report));
    const summary = evaluation.travelWindow.planned.approachSummary;
    expect(summary.adjustedHours).toBe(2);
    expect(summary.adjustedRuns).toEqual([{ start: 0, end: 1 }]);
    expect(summary.inversionRuns).toEqual([{ start: 0, end: 0 }]);
    expect(evaluation.plan.approach).toEqual({ source: 'estimated', trailheadElevationFt: 8200, objectiveElevationFt: 11000 });
    expect(evaluation.travelWindow.readings.rows.map((row) => row.pass)).toEqual(evaluation.travelWindow.planned.rows.map((row) => row.pass));
    expect(summarizeApproachHours([{ approachAdjusted: false, elevationFt: 11000 }])).toBeNull();
  });

  test('trailhead temperatures follow the travel window when the approach starts well below the summit', () => {
    const report = reportWith(['12:00', '13:00'].map((time) => ({ ...hour, time })));
    const evaluation = evaluatePlan(report, buildPlanContext({ start: '12:00', ...limits, travel_window_hours: '2', trailhead_ft: '8000' }, report));
    expect(evaluation.trailheadTemperatures).toEqual({ trailheadElevationFt: 8000, objectiveElevationFt: 11000, temps: [30, 30] });
    const close = evaluatePlan(report, buildPlanContext({ start: '12:00', ...limits, travel_window_hours: '2', trailhead_ft: '10600' }, report));
    expect(close.trailheadTemperatures).toBeNull();
  });

  test('the comfort score is scored for the plan\'s approach', () => {
    const report = reportWith(['05:00', '06:00', '07:00', '08:00'].map((time) => ({ ...hour, time, timeIso: `2026-09-23T${time}:00-07:00` })));
    report.weather.forecastStartTime = '2026-09-23T05:00:00-07:00';
    const manual = evaluatePlan(report, buildPlanContext({ start: '05:00', date: '2026-09-23', ...limits, trailhead_ft: '7000' }, report));
    expect(manual.pleasantness.approach).toMatchObject({ source: 'manual', trailheadElevationFt: 7000 });
    const off = evaluatePlan(report, buildPlanContext({ start: '05:00', date: '2026-09-23', ...limits, approach: 'off' }, report));
    expect(off.pleasantness.approach ?? null).toBeNull();
    expect(buildApproachProfile({ objectiveElevationFt: 11000, trailheadElevationFt: 10900 })).toBeNull();
  });
});

describe('critical window', () => {
  test('a missing reading is not a cold, calm or dry one', () => {
    expect(assessCriticalWindowPoint({ condition: 'Clear', temp: null, gust: null, precipChance: null })).toEqual({ level: 'stable', reasons: [], score: 0 });
  });

  test('reasons use the requested units', () => {
    const assessment = assessCriticalWindowPoint({ condition: 'Snow showers', temp: 5, gust: 50, precipChance: 80 }, { wind: 'kph', temperature: 'c' });
    expect(assessment.level).toBe('high');
    expect(assessment.reasons).toEqual(['winter precip signal', 'precip 80%', 'gusts 80 km/h', 'cold -15°C']);
  });

  test('the evaluation names the first highest-scoring hour', () => {
    const report = makeReport({ hours: 4 });
    report.weather.trend[2].gust = 50;
    const { criticalWindow } = evaluatePlan(report, contextFor(report, { travel_window_hours: '4' }));
    expect(criticalWindow.peak).toMatchObject({ time: '09:00', level: 'watch', score: 4 });
    expect(criticalWindow.peakTime).toBe('09:00');
    const calm = evaluatePlan(makeReport({ hours: 4 }), contextFor(makeReport({ hours: 4 }), { travel_window_hours: '4' }));
    expect(calm.criticalWindow).toEqual({ peak: null, peakTime: null });
    // A 05:30 start opens with the 05:00 reading: its peak is named by the start.
    const early = makeReport({ start: '05:00', hours: 4 });
    early.weather.trend[0].gust = 50;
    expect(evaluatePlan(early, contextFor(early, { start: '05:30', travel_window_hours: '4' })).criticalWindow.peakTime).toBe('05:30');
  });
});

describe('display text', () => {
  test('distances read in the viewer\'s unit without a doubled miles note', () => {
    expect(localizeDistanceText('about 8 km (5 mi) away', 'ft')).toBe('about 5 mi away');
    expect(localizeDistanceText('about 8 km (5 mi) away', 'm')).toBe('about 8 km away');
    expect(localizeDistanceText('within 1.6 km', 'ft')).toBe('within 1.0 mi');
    expect(localizeDistanceText('no distance here', 'ft')).toBe('no distance here');
  });

  test('imperial values in provider text follow the viewer\'s units', () => {
    expect(localizeUnitText('gusts 35 mph near 9000 ft, 20F', { wind: 'kph', elevation: 'm', temperature: 'c' }))
      .toBe('gusts 56 km/h near 2,743 m, -7°C');
  });
});

describe('attachPlanEvaluation', () => {
  test('adds the evaluation for the request\'s plan', () => {
    const report = makeReport();
    const attached = attachPlanEvaluation(report, { ...DEFAULT_PARAMS, lat: '33.8', max_gust_mph: '20' });
    expect(attached.evaluation.params).toEqual({ ...DEFAULT_PARAMS, max_gust_mph: '20' });
    expect(attached.evaluation.plan.limits.maxWindGustMph).toBe(20);
    expect(attached.evaluation.decision.level).toBe('GO');
    expect(attached.evaluation.travelWindow.planned.rows).toHaveLength(10);
  });

  test('a failed evaluation leaves the report and reports the error', () => {
    const onError = jest.fn();
    const report = { weather: { get trend() { throw new Error('boom'); } } };
    expect(attachPlanEvaluation(report, {}, { onError })).toBe(report);
    expect(onError).toHaveBeenCalled();
  });
});

describe('POST /api/evaluate', () => {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  registerEvaluateRoute({ app });

  test('re-evaluates a report for another plan without upstream calls', async () => {
    const report = makeReport();
    report.weather.trend[4].gust = 28;
    const loose = await request(app).post('/api/evaluate').send({ report, plan: { ...DEFAULT_PARAMS, max_gust_mph: '30' } });
    expect(loose.status).toBe(200);
    expect(loose.body.evaluation.decision.level).toBe('GO');
    const strict = await request(app).post('/api/evaluate').send({ report, plan: { ...DEFAULT_PARAMS, max_gust_mph: '20' } });
    expect(strict.body.evaluation.decision.level).toBe('CAUTION');
    expect(strict.body.evaluation.params.max_gust_mph).toBe('20');
  });

  test('rejects a body without a report', async () => {
    expect((await request(app).post('/api/evaluate').send({ plan: {} })).status).toBe(400);
    expect((await request(app).post('/api/evaluate').send({ report: { weather: {} } })).status).toBe(400);
    expect((await request(app).post('/api/evaluate').send({ report: makeReport(), plan: [] })).status).toBe(400);
  });
});

describe('wind loading', () => {
  const { buildWindLoading, hasSnowpackSignal } = require('../src/utils/wind-loading');
  const { leewardAspectsFromWind, parseTerrainFromLocation } = require('../src/utils/avalanche-terrain');
  const units = { temperature: 'f', wind: 'mph', elevation: 'ft', timeStyle: 'ampm' };

  test('a wind loads the three aspects downwind of it', () => {
    expect(new Set(leewardAspectsFromWind('SW'))).toEqual(new Set(['N', 'NE', 'E']));
    expect(leewardAspectsFromWind('CALM')).toEqual([]);
    const { aspects, elevations } = parseTerrainFromLocation(['north upper', 'northeast middle']);
    expect([...aspects].sort()).toEqual(['N', 'NE']);
    expect([...elevations].sort()).toEqual(['middle', 'upper']);
  });

  test('strong, steady wind is an active signal with its hours named', () => {
    const report = makeReport({ hours: 4 });
    report.weather.windDirection = 'SW';
    report.weather.windSpeed = 22;
    report.weather.windGust = 34;
    report.weather.trend = report.weather.trend.map((point) => ({ ...point, wind: 22, gust: 34, windDirection: 'SW' }));
    const loading = buildWindLoading(report, report.weather.trend, { units });
    expect(loading).toMatchObject({ level: 'Active', confidence: 'High', tone: 'nogo', activeHours: 4, activeWindowLabel: '4/4 h active' });
    expect(loading.activeHoursDetail).toBe('7:00 AM–10:00 AM');
    expect(loading.summary).toBe('Active transport signal: wind from SW at 22 mph (gust 34 mph). Primary lee aspects: N, NE, E.');
  });

  test('wind loading applies only with an avalanche context or measured snow', () => {
    const windy = (avalanche, snowpack) => ({ weather: { windDirection: 'W', windSpeed: 22, windGust: 34 }, avalanche, snowpack });
    const trend = [{ time: '07:00', windDirection: 'W', wind: 22, gust: 34 }];
    const loading = (report) => buildWindLoading(report, trend, { units });
    expect(loading(windy({ relevant: false, problems: [] }, null)).applies).toBe(false);
    expect(loading(windy({ relevant: true, problems: [] }, null)).applies).toBe(true);
    expect(loading(windy(null, { cdec: { snowDepthIn: 4 } })).applies).toBe(true);
    // Direction is still resolved, so the hints stay off only because there is no snow.
    expect(loading(windy({ relevant: false }, null)).hintsRelevant).toBe(false);
    expect(loading(windy({ relevant: false }, null)).leewardAspects.length).toBeGreaterThan(0);
  });

  test('missing wind readings are not a light-wind signal', () => {
    const report = makeReport({ hours: 2 });
    report.weather.windSpeed = null;
    report.weather.windGust = null;
    expect(buildWindLoading(report, report.weather.trend, { units }).lightWind).toBe(false);
  });

  test('loading on the bulletin\'s problem aspects adds a caution to the decision', () => {
    const report = makeReport({ hours: 4 });
    report.weather.windDirection = 'SW';
    report.avalanche = {
      relevant: false,
      dangerLevel: 2,
      coverageStatus: 'reported',
      publishedTime: new Date().toISOString(),
      problems: [{ name: 'Wind slab', location: ['north upper', 'northeast upper'] }],
    };
    const evaluation = evaluatePlan(report, contextFor(report, { travel_window_hours: '4' }));
    expect(evaluation.windLoading.aspectOverlapProblems).toEqual(['Wind slab']);
    expect(evaluation.decision.cautions).toContain('Wind loading aligns with active avalanche problem aspects (Wind slab). Current winds may be actively building slabs on these aspects.');
    expect(hasSnowpackSignal({ snotel: { snowDepthIn: null, sweIn: 0 } })).toBe(false);
    expect(hasSnowpackSignal({ nohrsc: { snowDepthIn: 3 } })).toBe(true);
  });
});

describe('verdict', () => {
  const { buildFieldSignals, buildVerdict, buildDecisionSummary, checkSummary } = require('../src/utils/verdict');
  const report = makeReport();
  const verdictFor = (decision, signals = []) => {
    const full = { headline: 'Headline', blockers: [], cautions: [], checks: [], ...decision };
    return buildVerdict(report, full, buildDecisionSummary(full), signals);
  };

  test('a lone caution needs no list; several are named without repeating the reason', () => {
    expect(verdictFor({ level: 'CAUTION', cautions: ['Wind gusts reach about 31 mph. Shorten ridge exposure.'] }).limitingChecks).toEqual([]);
    expect(verdictFor({ level: 'CAUTION', cautions: ['Cold start. Layer up.', 'Stale sources. Refresh.'] }).limitingChecks).toEqual(['Stale sources']);
  });

  test('a strong score under a caution explains that the decision is set by the checks', () => {
    const verdict = verdictFor({ level: 'CAUTION', cautions: ['Cold start. Layer up.'] });
    expect(verdict.bridge).toBe('The score of 91 rates conditions overall. The decision is set by a check that needs attention.');
    expect(verdict.tone).toBe('watch');
  });

  test('check summaries keep the lead sentence', () => {
    expect(checkSummary('Wind gusts reach about 12.5 m/s. Shorten ridge exposure.')).toBe('Wind gusts reach about 12.5 m/s');
    expect(checkSummary('Air quality is moderate (AQI 58). Sensitive members should ease off.')).toBe('Air quality is moderate (AQI 58)');
    expect(checkSummary('No trailing period')).toBe('No trailing period');
  });

  test('field signals flag nearby observations and missing feeds', () => {
    expect(buildFieldSignals(null, { maxWindGustMph: 25 })[0].tone).toBe('unavailable');
    const now = Date.parse('2026-09-24T12:00:00Z');
    const signals = buildFieldSignals({
      access: { available: true, closedRoadCount: 1 },
      closures: { available: true, alertCount: 0 },
      radar: { available: true, lightning: { available: true, detectionAtObjective: true } },
      wildfire: { available: false },
      weatherObservation: { available: true, gustMph: 30, observedTime: '2026-09-24T07:00:00Z' },
    }, { maxWindGustMph: 25 }, now);
    expect(signals.map((signal) => signal.key)).toEqual(['roads', 'lightning', 'gust', 'stale', 'missing-fire']);
  });

  test('the evaluation leads with failed checks and carries the verdict', () => {
    const windy = makeReport();
    windy.weather.trend[6].gust = 45;
    const evaluation = evaluatePlan(windy, contextFor(windy));
    expect(evaluation.decisionSummary.orderedChecks[0]).toMatchObject({ key: 'wind-gust', ok: false, failedLabel: 'Wind gusts are above your limit' });
    expect(evaluation.decisionSummary.primaryReason).toMatch(/Wind gusts reach about 45 mph/);
    expect(evaluation.verdict.tone).toBe('stop');
  });
});

describe('decision and verdict edge cases', () => {
  const { buildVerdict, buildDecisionSummary } = require('../src/utils/verdict');
  const accessInsight = {
    id: 'access',
    tone: 'caution',
    title: 'Verify the approach before committing',
    meaning: 'Nearby closures have not been matched to your route.',
    action: 'Check road names and choose an alternate approach if needed.',
    features: ['fieldObservations'],
    decisionRelevant: true,
    evidence: [],
  };

  test('insufficient report evidence cannot produce GO', () => {
    const report = makeReport();
    report.safety = { ...report.safety, score: 99, assessmentStatus: 'insufficient_evidence', evidenceReasons: ['Wind unavailable for the return.'] };
    const decision = decide(report);
    expect(decision.level).not.toBe('GO');
    expect(check(decision, 'evidence-coverage')).toMatchObject({ ok: false, detail: 'Wind unavailable for the return.' });
    const verdict = buildVerdict(report, decision, buildDecisionSummary(decision), []);
    expect(verdict).toMatchObject({ insufficient: true, scoreValue: null, bridge: '' });
  });

  const lightningInsight = {
    id: 'lightning',
    tone: 'caution',
    title: 'Lightning needs an immediate check',
    meaning: 'Lightning was detected at the objective.',
    action: 'Reassess exposed travel before committing.',
    features: ['fieldObservations'],
    decisionRelevant: true,
    evidence: [],
  };

  test('a source review becomes a decision check without changing the safety score', () => {
    const report = makeReport();
    report.reportInsights = { version: 1, summary: '', items: [lightningInsight] };
    const decision = decide(report);
    expect(decision.level).toBe('CAUTION');
    expect(check(decision, 'source-lightning')).toMatchObject({ ok: false, detail: lightningInsight.meaning });
    expect(decision.cautions.some((text) => text.includes(lightningInsight.action))).toBe(true);
    expect(report.safety.score).toBe(91);
    report.featureFlags = { fieldObservations: false };
    expect(check(decide(report), 'source-lightning')).toBeUndefined();
  });

  test('nearby closures not matched to the route are advice, not a caution', () => {
    const report = makeReport();
    report.reportInsights = { version: 1, summary: '', items: [accessInsight] };
    const decision = decide(report);
    expect(check(decision, 'source-access')).toBeUndefined();
    expect(decision.cautions.some((text) => text.includes(accessInsight.action))).toBe(false);
    expect(decision.advisories.some((text) => text.includes(accessInsight.action))).toBe(true);
  });

  test('a source review turns an otherwise GO decision to CAUTION and never weakens NO-GO', () => {
    const report = makeReport();
    const relaxed = { max_gust_mph: '80', max_precip_chance: '100', min_feels_like_f: '-40', max_feels_like_f: '120' };
    expect(decide(report, relaxed).level).toBe('GO');
    report.reportInsights = { version: 1, summary: '', items: [accessInsight] };
    expect(decide(report, relaxed).level).toBe('GO');
    report.reportInsights = { version: 1, summary: '', items: [accessInsight, lightningInsight] };
    expect(decide(report, relaxed).level).toBe('CAUTION');
    report.weather.description = 'Weather data unavailable';
    expect(decide(report, relaxed).level).toBe('NO-GO');
  });

  test('minor signals inside the limits advise without lowering a GO', () => {
    const report = makeReport();
    report.featureFlags = { avalancheDetails: false, daylightTimeline: false, snowpackDetails: false, airQualityDetails: true, heatRiskDetails: true, fireRiskDetails: true, fieldObservations: false };
    report.airQuality = { status: 'ok', usAqi: 62, category: 'Moderate', measuredTime: new Date().toISOString() };
    report.fireRisk = { status: 'ok', level: 2, label: 'Elevated', reasons: [] };
    report.heatRisk = { status: 'ok', level: 2, label: 'Elevated' };
    report.terrainCondition = { code: 'dry_loose', label: 'Drying / Footing Uncertain', impact: 'moderate' };
    const relaxed = { max_gust_mph: '80', max_precip_chance: '100', min_feels_like_f: '-40', max_feels_like_f: '120' };
    const decision = decide(report, relaxed);
    expect(decision.level).toBe('GO');
    for (const text of ['Air quality is moderate', 'Fire risk is elevated', 'Heat risk is elevated', 'Terrain and trail surfaces']) {
      expect(decision.advisories.some((item) => item.startsWith(text))).toBe(true);
    }
    report.terrainCondition = { code: 'snow_ice', label: 'Icy / Firm Snow', impact: 'high' };
    const icy = decide(report, relaxed);
    expect(icy.level).toBe('CAUTION');
    expect(icy.cautions.some((item) => item.startsWith('Terrain and trail surfaces'))).toBe(true);
  });

  test('the verdict explains a high score under a stricter decision only when they disagree', () => {
    const report = makeReport();
    const verdict = (decision) => {
      const full = { headline: 'Headline', blockers: [], cautions: [], checks: [], ...decision };
      return buildVerdict(report, full, buildDecisionSummary(full), []);
    };
    expect(verdict({ level: 'CAUTION', cautions: ['Cold', 'Wind'] }).bridge)
      .toBe('The score of 91 rates conditions overall. The decision is set by 2 checks that need attention.');
    expect(verdict({ level: 'NO-GO', blockers: ['Storm'] }).bridge).toMatch(/The decision is set by a blocking check\./);
    expect(verdict({ level: 'GO' }).bridge).toBe('');
    report.safety.score = 78;
    expect(verdict({ level: 'CAUTION', cautions: ['Cold'] }).bridge).toBe('');
  });

  test('the verdict names the checks behind the decision instead of only counting them', () => {
    const report = makeReport();
    report.safety.score = 97.8;
    const verdict = (decision) => {
      const full = { headline: 'Headline', blockers: [], cautions: [], checks: [], ...decision };
      return buildVerdict(report, full, buildDecisionSummary(full), []);
    };
    const cautions = [
      'Fire danger is elevated (Moderate). Check closures and incident updates, avoid ignition sources, and keep a clear exit route.',
      'Check fire locations against your approach and escape routes. Compare current fire perimeters and official restrictions with the route and road access before choosing an approach.',
    ];
    // The reason already states the first caution, so only the other one is listed.
    expect(verdict({ level: 'CAUTION', cautions }).limitingChecks).toEqual(['Check fire locations against your approach and escape routes']);
    // A single limiting check under a high score is named only when the reason is something else.
    expect(verdict({ level: 'CAUTION', cautions: ['Wind gusts reach about 31 mph. Shorten ridge exposure.'] }).limitingChecks).toEqual([]);
    // No-go lists blockers, not the cautions beside them.
    expect(verdict({ level: 'NO-GO', blockers: ['Storm. Delay.', 'Heat. Move.'], cautions: ['Cold'] }).limitingChecks).toEqual(['Heat']);
    expect(verdict({ level: 'GO', cautions: ['Cold'] }).limitingChecks).toEqual([]);
    report.safety.score = 60;
    expect(verdict({ level: 'CAUTION', cautions: ['Cold. Layer up.'] }).limitingChecks).toEqual([]);
  });

  test('the verdict leads with lightning at the objective and drops disabled field observations', () => {
    const report = makeReport();
    const signals = [
      { key: 'roads', title: '1 road closure nearby', detail: '', tone: 'attention' },
      { key: 'lightning', title: 'Lightning detected at the objective', detail: '', tone: 'attention' },
      { key: 'missing-fire', title: 'Wildfire feed unavailable', detail: '', tone: 'unavailable' },
    ];
    const decision = { level: 'CAUTION', headline: 'Headline', blockers: [], cautions: ['Stale. Refresh.'], checks: [] };
    const verdict = buildVerdict(report, decision, buildDecisionSummary(decision), signals);
    expect(verdict.warnings.map((signal) => signal.key)).toEqual(['lightning', 'roads']);
    expect(verdict.missing.map((signal) => signal.key)).toEqual(['missing-fire']);
    report.featureFlags = { fieldObservations: false };
    const off = buildVerdict(report, decision, buildDecisionSummary(decision), signals);
    expect(off.warnings).toEqual([]);
    expect(off.missing).toEqual([]);
  });
});
