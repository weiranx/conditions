const { buildPlanContext } = require('../src/utils/plan-context');
const { buildPlannedRows, buildReadingRows, buildTravelWindowInsights } = require('../src/utils/travel-window');

// Default hiking limits: gusts 25 mph, precipitation 60%, feels-like 5–95 °F.
const context = buildPlanContext({ activity: 'hiking', approach: 'off' });
const weatherHour = {
  time: '09:00',
  temp: 50,
  wind: 10,
  gust: 15,
  precipChance: 0,
  condition: 'Clear',
  cloudCover: 5,
  isDaytime: true,
};
const weatherData = (trend, extra = {}) => ({ weather: { trend, ...extra } });
const planned = (data, hours, start = '06:00') => buildPlannedRows(data, context, hours, { start, date: '2026-09-06', approach: null });
const readings = (data, hours) => buildReadingRows(data, context, hours);

test('reading coverage preserves zero measurements and excludes hazards outside the window', () => {
  const rows = readings(weatherData([{ ...weatherHour, precipChance: 0 }, { ...weatherHour, gust: 80 }]), 1);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ complete: true, pass: true });
});

test('planned weather rows preserve gaps and ignore duplicates and out-of-window hazards', () => {
  const data = weatherData([6, 6, 8, 9].map((hour) => ({ ...weatherHour, time: `${hour}:00`, gust: hour === 9 ? 90 : 5 })));
  const rows = planned(data, 3);
  expect(rows.map((row) => [row.time, row.complete, row.pass])).toEqual([
    ['06:00', true, true], ['07:00', false, false], ['08:00', true, true],
  ]);
  expect(rows[1].reasonSummary).toMatch(/No hourly forecast covers/);
  expect(buildTravelWindowInsights(rows).passHours).toBe(2);
});

test('missing gust and precipitation fail an hour but a measured zero passes', () => {
  const data = weatherData([
    { ...weatherHour, time: '06:00', gust: null, precipChance: null },
    { ...weatherHour, time: '07:00', gust: 0, wind: 0, precipChance: 0 },
  ]);
  const rows = planned(data, 2);
  expect(rows.map((row) => row.pass)).toEqual([false, true]);
  expect(buildTravelWindowInsights(rows).passHours).toBe(1);
  expect(rows[0].reasonSummary).toMatch(/incomplete/);
});

test('planned coverage uses dates and the objective timezone across midnight', () => {
  const data = weatherData([
    { ...weatherHour, time: '11 PM', timeIso: '2026-09-07T06:00:00Z' },
    { ...weatherHour, time: '12 AM', timeIso: '2026-09-07T07:00:00Z' },
    { ...weatherHour, time: '1 AM', timeIso: '2026-09-08T08:00:00Z' },
  ], { timezone: 'America/Los_Angeles' });
  expect(planned(data, 3, '23:00').map((row) => [row.time, row.pass])).toEqual([['23:00', true], ['00:00', true], ['01:00', false]]);
});

test('legacy clock labels roll over midnight and fractional starts do not borrow future readings', () => {
  const data = weatherData(['11 PM', '12 AM', '1 AM'].map((time) => ({ ...weatherHour, time })));
  expect(planned(data, 3, '23:00').map((row) => row.pass)).toEqual([true, true, true]);
  const later = weatherData(['07:00', '08:00', '09:00'].map((time) => ({ ...weatherHour, time })));
  expect(planned(later, 3, '06:30').map((row) => row.pass)).toEqual([false, true, true]);
});

test('missing weather does not erase known high-wind warnings', () => {
  const [row] = readings(weatherData([{ ...weatherHour, gust: 90, precipChance: null }]), 1);
  expect(row.reasonSummary).toMatch(/incomplete/);
  expect(row.reasonSummary).toMatch(/gust/);
});

test('missing temperature never invents a freezing reading in the reasons', () => {
  const [row] = readings(weatherData([{ ...weatherHour, temp: null }]), 1);
  expect(row.reasonSummary).toMatch(/incomplete/);
  expect(row.reasonSummary).not.toMatch(/feels|0°F/);
  expect(row.failedRuleLabels).toEqual(['Incomplete hourly evidence']);
});

test('fractional departures include hazards in the final partial hour', () => {
  const data = weatherData([7, 8, 9].map((hour) => ({
    ...weatherHour,
    time: `${hour}:00`,
    gust: hour === 9 ? 90 : 5,
    condition: hour === 9 ? 'Thunderstorms' : 'Clear',
  })));
  const rows = planned(data, 3, '06:30');
  expect(rows.map((row) => [row.complete, row.pass])).toEqual([[false, false], [true, true], [true, false]]);
  expect(rows[2].gust).toBe(90);
  expect(rows[2].lightningRisk).toBe(true);
  expect(rows[2].reasonSummary).toMatch(/Thunderstorms/);
  expect(rows[2].reasonSummary).toMatch(/gust/);
});

test('a gap in the final half hour is incomplete even when the slot starts with data', () => {
  const rows = planned(weatherData([6, 7, 8].map((hour) => ({ ...weatherHour, time: `${hour}:00` }))), 3, '06:30');
  expect(rows.map((row) => row.complete)).toEqual([true, true, false]);
  expect(rows[2].pass).toBe(false);
  expect(rows[2].reasonSummary).toMatch(/coverage is incomplete/);
});

test('interval checks retain cold and heat extremes and exclude hazards at the return boundary', () => {
  const data = weatherData([
    { ...weatherHour, time: '06:00', temp: -20 },
    { ...weatherHour, time: '07:00', temp: 110 },
    { ...weatherHour, time: '07:30', gust: 100, condition: 'Thunderstorms' },
  ]);
  const [row] = planned(data, 1, '06:30');
  expect(row.complete).toBe(true);
  expect(row.pass).toBe(false);
  expect(row.failedRuleLabels).toEqual(expect.arrayContaining(['Feels-like below limit', 'Heat above limit']));
  expect(row.lightningRisk).toBe(false);
  expect(row.gust).toBe(weatherHour.gust);
});

test('fractional intervals cross midnight without losing the next day storm', () => {
  const data = weatherData(['23:00', '00:00', '01:00'].map((time, index) => ({
    ...weatherHour,
    time,
    timeIso: `2026-09-${index === 0 ? '06' : '07'}T${time}:00-07:00`,
    condition: index === 2 ? 'Thunderstorms' : 'Clear',
  })));
  const rows = planned(data, 2, '23:30');
  expect(rows.map((row) => row.complete)).toEqual([true, true]);
  expect(rows[1].lightningRisk).toBe(true);
  expect(rows[1].pass).toBe(false);
});

test('insights summarize the best window, first clean hour and the risk trend', () => {
  const data = weatherData([6, 7, 8, 9].map((hour) => ({ ...weatherHour, time: `${hour}:00`, gust: hour === 6 ? 40 : 5 })));
  const insights = buildTravelWindowInsights(planned(data, 4), '24h');
  expect(insights.passHours).toBe(3);
  expect(insights.bestWindow).toEqual({ start: '07:00', end: '10:00', length: 3 });
  expect(insights.summary).toMatch(/First clean hour starts at 07:00/);
  expect(insights.topFailureLabels).toEqual(['Gust above limit (1h)']);
});

test('deep snow reads in the plan units', () => {
  const report = weatherData([{ ...weatherHour }]);
  report.snowpack = { snotel: { snowDepthIn: 16 } };
  const metric = buildPlanContext({ activity: 'hiking', approach: 'off', elevation_unit: 'm' });
  const [row] = buildReadingRows(report, metric, 1);
  expect(row.failedRules).toContain('snow depth 41 cm');
  expect(readings(report, 1)[0].failedRules).toContain('snow depth 16 in');
});
