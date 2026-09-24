import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeReport } from '../dev/mock-data.mjs';
import { getDefaultUserPreferences } from '../src/app/preferences';
import { buildTripForecastDays, compareTripDays, sameTripRank } from '../src/app/trip-forecast';
import { buildTripChatContext, dayConcerns, longestStretch } from '../src/field/trip-days';

const preferences = { ...getDefaultUserPreferences(), travelWindowHours: 12 };
const plan = { lat: 46.8523, lon: -121.7603, start: '07:00', travel_window_hours: 12 };
// Future dates keep the mock forecast fresh for the decision's freshness check.
const date = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const report = (offset, scenario, edit = data => data) => edit(makeReport({ ...plan, date: date(offset) }, scenario));
const build = (reports, hours = 12) => buildTripForecastDays(reports, reports.map(data => data.forecast.selectedDate),
  '07:00', hours, { ...preferences, travelWindowHours: hours });
const chatPlan = { objectiveName: 'Rainier', position: { lat: plan.lat, lng: plan.lon }, startTime: '07:00', travelWindowHours: 12, preferences };

test('peak gust and rain / snow chance cover the planned hours, not just departure', () => {
  // Mixed hours: clear (gusts 15–17 mph, 0 %), cloudy (23–24, 15 %), rain (29–31, 80 %), snow (28–29, 75 %).
  const [day] = build([report(1, 'mixed')]);
  assert.equal(day.windGustMph, 15);
  assert.equal(day.peakGustMph, 31);
  assert.equal(day.precipChance, 0);
  assert.equal(day.peakPrecipChance, 80);
  const [short] = build([report(1, 'mixed')], 4);
  assert.equal(short.peakGustMph, 23, 'hours after the plan ends do not count');
  assert.equal(short.peakPrecipChance, 15);
});

test('missing gust and precipitation readings are skipped, never read as calm or dry', () => {
  const [partly] = build([report(1, 'rain', data => {
    data.weather.windGust = null;
    data.weather.trend.forEach((hour, index) => { if (index > 0) { hour.gust = null; hour.precipChance = ''; } });
    return data;
  })]);
  assert.equal(partly.peakGustMph, 29);
  assert.equal(partly.peakPrecipChance, 80);
  const [none] = build([report(1, 'clear', data => {
    data.weather.windGust = null;
    data.weather.precipChance = undefined;
    data.weather.trend.forEach(hour => { hour.gust = null; hour.precipChance = null; });
    return data;
  })]);
  assert.equal(none.peakGustMph, null);
  assert.equal(none.peakPrecipChance, null);
});

test('each day keeps the checks behind a Caution or No-go and none for Go', () => {
  const [clear, mixed, storm] = build([report(1, 'clear'), report(2, 'mixed'), report(3, 'storm')]);
  assert.equal(clear.decisionLevel, 'GO');
  assert.deepEqual(clear.limitingChecks, []);
  assert.equal(mixed.decisionLevel, 'CAUTION');
  assert.deepEqual(dayConcerns(mixed), ['Precipitation chance reaches 80%', 'Wind gusts reach about 31 mph']);
  assert.match(mixed.limitingChecks[0], /Allow extra travel time/, 'the full check, with its action, is kept for the chat');
  assert.equal(storm.decisionLevel, 'NO-GO');
  assert.deepEqual(dayConcerns(storm), ['Precipitation chance reaches 95%', 'Wind gusts reach about 54 mph']);
});

test('a day with no hour inside the limits names the limits, including ones the decision does not raise', () => {
  // Deep snow fails every travel hour but raises no caution of its own.
  const [snowbound] = build([report(1, 'clear', data => {
    data.terrainCondition = { ...data.terrainCondition, signals: { ...data.terrainCondition?.signals, maxSnowDepthIn: 20 } };
    return data;
  })]);
  assert.equal(snowbound.travelPassHours, 0);
  assert.equal(snowbound.decisionLevel, 'CAUTION');
  assert.deepEqual(dayConcerns(snowbound), ['No hour is within all of your limits (deep snow)']);
  const [rain] = build([report(1, 'rain')]);
  assert.equal(dayConcerns(rain)[0], 'No hour is within all of your limits (wind gusts, rain / snow chance)');
  assert.deepEqual(dayConcerns(rain).slice(1), ['Precipitation chance reaches 80%', 'Wind gusts reach about 31 mph']);
});

test('the longest stretch within limits is named only for a partly clear day', () => {
  const [mixed, clear, rain] = build([report(1, 'mixed'), report(2, 'clear'), report(3, 'rain')]);
  assert.equal(mixed.travelPassHours, 8);
  assert.deepEqual(mixed.travelBestWindow, { start: '07:00', end: '11:00', length: 5 });
  assert.equal(longestStretch(mixed, 'ampm'), 'Longest stretch 5 h from 7:00 AM');
  assert.equal(longestStretch(mixed, '24h'), 'Longest stretch 5 h from 07:00');
  assert.equal(longestStretch(clear, 'ampm'), null, 'every hour is within limits');
  assert.equal(longestStretch(rain, 'ampm'), null, 'no hour is within limits');
});

test('days rank by decision, then score, then hours within limits; a missing score ranks last', () => {
  const day = (decisionLevel, score, travelPassHours) => ({ decisionLevel, score, travelPassHours });
  const blocked = day('NO-GO', 99, 12), go = day('GO', 60, 4), caution = day('CAUTION', 90, 10),
    moreHours = day('CAUTION', 90, 12), unscored = day('CAUTION', null, 12);
  assert.deepEqual([blocked, unscored, caution, go, moreHours].sort(compareTripDays), [go, moreHours, caution, unscored, blocked]);
  assert.ok(sameTripRank(day('CAUTION', 80, 6), day('CAUTION', 80, 6)));
  assert.ok(sameTripRank(day('CAUTION', null, 6), day('CAUTION', null, 6)), 'two missing scores still tie');
  assert.ok(!sameTripRank(day('CAUTION', 80, 6), day('CAUTION', 80, 7)));
  assert.ok(!sameTripRank(day('CAUTION', 80, 6), day('CAUTION', null, 6)));
});

test('the trip chat reads a compact week that fits the chat limit', () => {
  const reports = Array.from({ length: 7 }, (_, index) => report(index + 1, ['clear', 'mixed', 'storm'][index % 3], data => {
    // A real report runs near 50,000 characters; the chat accepts 120,000 in all.
    data.supplementalEvidence = { note: 'x'.repeat(50_000) };
    return data;
  }));
  const days = build(reports);
  const context = buildTripChatContext(days, chatPlan);
  const json = JSON.stringify(context);
  assert.ok(json.length < 120_000, `${json.length} characters`);
  assert.doesNotMatch(json, /x{100}|"safetyData"/);
  assert.equal(context.days.length, 7);
  assert.equal(context.days[0].weatherWindowLabel, 'WEATHER CLEAR');
  assert.equal(context.days[1].peakWindGustMph, 31);
  assert.equal(context.days[1].departureWindGustMph, 15);
  assert.deepEqual(context.days[1].limitingChecks, days[1].limitingChecks);
  assert.equal(context.days[1].hourlyTravelWindow.length, 12);
  assert.equal(context.ranking.bestDate, days[0].date);
  assert.deepEqual(context.ranking.datesTiedWithBest, [days[3].date, days[6].date]);
  assert.equal(context.limits.maxWindGustMph, preferences.maxWindGustMph);
});

test('the trip chat leaves out domains the report has turned off', () => {
  const days = build([report(1, 'clear', data => ({ ...data, featureFlags: { ...data.featureFlags, daylightTimeline: false, airQualityDetails: false } }))]);
  const [day] = buildTripChatContext(days, chatPlan).days;
  assert.equal('sunrise' in day, false);
  assert.equal('airQualityAqi' in day, false);
  assert.ok('visibilityRisk' in day);
});
