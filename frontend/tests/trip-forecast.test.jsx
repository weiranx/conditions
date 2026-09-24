import assert from 'node:assert/strict';
import { test } from 'node:test';
import { longestStretch, sameTripRank } from '../src/field/trip-days';

// Each day's decision, limits, ranking and the trip chat are built by the
// backend (backend/test/unit.trip-days.test.js). These cover how days read.
const day = (overrides) => ({
  travelPassHours: 8, travelTotalHours: 12, travelBestWindow: { start: '07:00', end: '12:00', length: 5 }, rankValue: 108000, ...overrides,
});

test('the longest stretch within limits is named only for a partly clear day', () => {
  assert.equal(longestStretch(day(), 'ampm'), 'Longest stretch 5 h from 7:00 AM');
  assert.equal(longestStretch(day(), '24h'), 'Longest stretch 5 h from 07:00');
  assert.equal(longestStretch(day({ travelPassHours: 12 }), 'ampm'), null, 'every hour is within limits');
  assert.equal(longestStretch(day({ travelPassHours: 0, travelBestWindow: null }), 'ampm'), null, 'no hour is within limits');
});

test('days the backend ranks the same are shown as tied', () => {
  assert.ok(sameTripRank(day(), day()));
  assert.ok(!sameTripRank(day(), day({ rankValue: 108001 })));
});
