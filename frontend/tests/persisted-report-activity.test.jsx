import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPersistedReport, persistedReportMatchesPlan } from '../src/app/report-storage';
import { getDefaultUserPreferences } from '../src/app/preferences';
import { makeReport } from '../dev/mock-data.mjs';

const plan = { lat: 46.8523, lon: -121.7603, forecastDate: '2026-09-06', alpineStartTime: '07:00', travelWindowHours: 10 };
const persisted = (activity, preferences = null) => buildPersistedReport(
  { ...plan, objectiveName: 'Rainier', searchQuery: '', targetElevationInput: '' },
  makeReport({ lat: plan.lat, lon: plan.lon, date: plan.forecastDate, start: plan.alpineStartTime, travel_window_hours: 10, activity }, 'clear'),
  {},
  { preferences },
);

test('a persisted report only restores for the activity it was generated for', () => {
  const report = persisted('ski-touring');
  assert.equal(persistedReportMatchesPlan(report, { ...plan, activity: 'ski-touring' }), true);
  assert.equal(persistedReportMatchesPlan(report, { ...plan, activity: 'mountaineering' }), false);
});

test('reports from before forecast.activity fall back to their saved preferences', () => {
  const report = persisted('hiking', { ...getDefaultUserPreferences(), defaultActivity: 'scrambling' });
  delete report.safetyData.forecast.activity;
  assert.equal(persistedReportMatchesPlan(report, { ...plan, activity: 'scrambling' }), true);
  assert.equal(persistedReportMatchesPlan(report, { ...plan, activity: 'hiking' }), false);
});
