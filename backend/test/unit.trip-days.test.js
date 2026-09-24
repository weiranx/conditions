const { buildPlanContext } = require('../src/utils/plan-context');
const { buildHighlights, buildTripChatContext, buildTripDay, rankDays, rankValue, tripNote, withDayDeltas } = require('../src/utils/trip-days');
const { makeReport } = require('./fixtures/plan-report');

const date = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const report = (offset, scenario, edit = (data) => data, hours = 12) => edit(makeReport({ date: date(offset), start: '07:00', hours, scenario }));
const dayFor = (data, { start = '07:00', hours = 12, includeAvalanche = false } = {}) => buildTripDay(data, buildPlanContext(
  { date: data.forecast.selectedDate, start, travel_window_hours: String(hours), activity: 'hiking', approach: 'off' },
  data,
  { withTurnaround: false, ignoreAvalancheForDecision: !includeAvalanche },
), { requiredHours: hours });

test('peak gust and rain / snow chance cover the planned hours, not just departure', () => {
  const day = dayFor(report(1, 'mixed'));
  expect(day.windGustMph).toBe(15);
  expect(day.peakGustMph).toBe(31);
  expect(day.precipChance).toBe(0);
  expect(day.peakPrecipChance).toBe(80);
  const short = dayFor(report(1, 'mixed'), { hours: 4 });
  expect(short.peakGustMph).toBe(23);
  expect(short.peakPrecipChance).toBe(15);
});

test('a start off the hour reaches into the reading that holds the final partial hour', () => {
  const hourly = (time, gust, precipChance) => ({ time, temp: 50, wind: 10, gust, precipChance, condition: 'Cloudy' });
  const data = report(1, 'clear', (value) => {
    value.weather.windGust = 12;
    value.weather.precipChance = 10;
    value.weather.trend = [hourly('06:00', 12, 10), hourly('07:00', 14, 10), hourly('08:00', 15, 20), hourly('09:00', 38, 70)];
    return value;
  });
  const offHour = dayFor(data, { start: '06:30', hours: 3 });
  expect(offHour.peakGustMph).toBe(38);
  expect(offHour.peakPrecipChance).toBe(70);
  expect(offHour.hourlyWeather).toHaveLength(4);
  const onHour = dayFor(data, { start: '06:00', hours: 3 });
  expect(onHour.peakGustMph).toBe(15);
  expect(onHour.hourlyWeather).toHaveLength(3);
});

test('missing gust and precipitation readings are skipped, never read as calm or dry', () => {
  const none = dayFor(report(1, 'clear', (data) => {
    data.weather.windGust = null;
    data.weather.precipChance = undefined;
    data.weather.trend.forEach((hour) => { hour.gust = null; hour.precipChance = null; });
    return data;
  }));
  expect(none.peakGustMph).toBeNull();
  expect(none.peakPrecipChance).toBeNull();
});

test('hours with a missing reading are not counted as complete passing hours', () => {
  const day = dayFor(report(1, 'clear', (data) => {
    data.weather.trend.slice(0, 3).forEach((hour) => { hour.gust = null; });
    data.weather.trend[3].precipChance = null;
    return data;
  }));
  expect(day.travelPassHours).toBe(12);
  expect(day.travelCompletePassHours).toBe(8);
});

test('each day keeps the checks behind a Caution or No-go and none for Go', () => {
  const clear = dayFor(report(1, 'clear'));
  expect(clear.decisionLevel).toBe('GO');
  expect(clear.limitingChecks).toEqual([]);
  const mixed = dayFor(report(2, 'mixed'));
  expect(mixed.decisionLevel).toBe('CAUTION');
  expect(mixed.concerns).toEqual(['Precipitation chance reaches 80%', 'Wind gusts reach about 31 mph']);
  expect(mixed.limitingChecks[0]).toMatch(/Allow extra travel time/);
  const storm = dayFor(report(3, 'storm'));
  expect(storm.decisionLevel).toBe('NO-GO');
  expect(storm.concerns).toEqual(['Precipitation chance reaches 95%', 'Wind gusts reach about 54 mph']);
});

test('a day with no hour inside the limits names the limits, including ones the decision does not raise', () => {
  const snowbound = dayFor(report(1, 'clear', (data) => {
    data.terrainCondition = { ...data.terrainCondition, signals: { maxSnowDepthIn: 20 } };
    return data;
  }));
  expect(snowbound.travelPassHours).toBe(0);
  expect(snowbound.decisionLevel).toBe('CAUTION');
  expect(snowbound.concerns).toEqual(['No hour is within all of your limits (deep snow)']);
});

test('the best continuous window is named for a partly clear day', () => {
  const mixed = dayFor(report(1, 'mixed'));
  expect(mixed.travelPassHours).toBe(8);
  expect(mixed.travelBestWindow).toMatchObject({ start: '07:00', length: 5 });
});

test('days rank by decision, then score, then complete hours within limits; a missing score ranks last', () => {
  const day = (date, decisionLevel, score, travelCompletePassHours) => {
    const value = { date, decisionLevel, score, travelCompletePassHours };
    return { ...value, rankValue: rankValue(value) };
  };
  const days = [day('a', 'NO-GO', 99, 12), day('b', 'CAUTION', null, 12), day('c', 'CAUTION', 90, 10), day('d', 'GO', 60, 4), day('e', 'CAUTION', 90, 12)];
  expect(rankDays(days)).toEqual({ order: ['d', 'e', 'c', 'b', 'a'], bestDate: 'd', tiedWithBest: [] });
  expect(rankDays([day('x', 'CAUTION', 80, 6), day('y', 'CAUTION', 80, 6)]).tiedWithBest).toEqual(['y']);
  expect(rankDays([day('x', 'CAUTION', null, 6), day('y', 'CAUTION', null, 6)]).tiedWithBest).toEqual(['y']);
  // Hours counted as passing only because a reading was missing do not win a tie.
  const zeroFilled = { ...day('z', 'CAUTION', 80, 8), travelPassHours: 12 };
  const measured = { ...day('m', 'CAUTION', 80, 10), travelPassHours: 10 };
  expect(rankDays([zeroFilled, measured]).order).toEqual(['m', 'z']);
});

test('only days with complete evidence can be ranked', () => {
  expect(dayFor(report(1, 'clear')).rankable).toBe(true);
  expect(dayFor(report(1, 'clear', (data) => ({ ...data, partialData: true }))).rankable).toBe(false);
  expect(dayFor(report(1, 'clear', (data) => ({ ...data, safety: { score: null } }))).rankable).toBe(false);
  expect(dayFor(report(1, 'clear', (data) => data, 4)).rankable).toBe(false);
});

test('avalanche danger counts only when the comparison includes it', () => {
  const avalanche = (data) => ({ ...data, avalanche: { relevant: true, dangerLevel: 3, coverageStatus: 'reported', publishedTime: new Date().toISOString() } });
  expect(dayFor(report(1, 'clear', avalanche)).decisionLevel).toBe('GO');
  expect(dayFor(report(1, 'clear', avalanche), { includeAvalanche: true }).decisionLevel).toBe('NO-GO');
});

test('days carry their change from the day before, highlights and a note', () => {
  const days = withDayDeltas([dayFor(report(2, 'mixed')), dayFor(report(1, 'clear'))]);
  expect(days.map((day) => day.date)).toEqual([date(1), date(2)]);
  expect(days[0].deltas).toBeNull();
  expect(days[1].deltas.windGustMph).toBe(0);
  const highlights = buildHighlights(days);
  expect(highlights.find((item) => item.key === 'calmest').dates).toEqual([date(1)]);
  expect(tripNote({ requestedDays: 7, loadedDays: 5, failedDays: 2 })).toBe('2 days could not be loaded and were skipped.');
  expect(tripNote({ requestedDays: 7, loadedDays: 5, failedDays: 0 })).toBe('Only 5 days are available inside the current forecast range.');
  expect(tripNote({ requestedDays: 5, loadedDays: 5, failedDays: 0 })).toBeNull();
});

test('the trip chat reads a compact week and leaves out domains the report turned off', () => {
  const days = withDayDeltas([1, 2, 3, 4, 5, 6, 7].map((offset) => dayFor(report(offset, 'mixed'))));
  const context = buildPlanContext({ start: '07:00', travel_window_hours: '12' });
  const chat = buildTripChatContext({
    days,
    ranking: rankDays(days),
    context,
    featureFlags: { airQualityDetails: false },
    objective: { name: 'Rainier', latitude: 46.85, longitude: -121.76, timezone: 'America/Los_Angeles' },
  });
  expect(chat.contextType).toBe('multi-day-trip-plan');
  expect(chat.days).toHaveLength(7);
  expect(chat.days[0]).not.toHaveProperty('airQualityAqi');
  expect(chat.days[0]).toHaveProperty('sunrise');
  expect(JSON.stringify(chat).length).toBeLessThan(120000);
  expect(JSON.stringify(chat)).not.toMatch(/"safetyData"/);
});

test('blank readings stay missing and a genuine zero stays zero', () => {
  const days = [null, '', 0].map((value, index) => dayFor(report(index + 1, 'clear', (data) => {
    data.safety.score = value;
    data.weather.windGust = value;
    data.weather.precipChance = value;
    return data;
  })));
  for (const field of ['score', 'windGustMph', 'precipChance']) {
    expect(days.map((day) => day[field])).toEqual([null, null, 0]);
  }
});
