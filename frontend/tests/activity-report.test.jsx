import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIVITY_PROFILES, ACTIVITY_PROFILE_ORDER, activityProfile, orderActivityChecks, reportActivity } from '../src/app/activity-profiles';

test('every activity orders every chapter and check exactly once', () => {
  for (const key of ACTIVITY_PROFILE_ORDER) {
    const { chapters, checks } = ACTIVITY_PROFILES[key].report;
    assert.deepEqual([...chapters].sort(), ['forecast', 'route', 'terrain', 'timing'], key);
    assert.deepEqual([...checks].sort(), ['air', 'alerts', 'avalanche', 'daylight', 'terrain', 'weather'], key);
  }
});

test('every activity leads the brief with two different headline numbers', () => {
  for (const key of ACTIVITY_PROFILE_ORDER) {
    const { numbers, numbersNote } = ACTIVITY_PROFILES[key].report;
    assert.equal(new Set(numbers).size, 2, key);
    assert.ok(numbersNote, key);
  }
});

test('a report keeps the activity it was generated for', () => {
  assert.equal(reportActivity({ safetyData: { forecast: { activity: 'ski-touring' } }, preferences: { defaultActivity: 'hiking' } }), 'ski-touring');
  assert.equal(reportActivity({ safetyData: { forecast: {} }, preferences: { defaultActivity: 'scrambling' } }), 'scrambling');
  assert.equal(reportActivity({ safetyData: { forecast: { activity: 'kiting' } }, preferences: null }), 'backcountry');
  assert.equal(activityProfile('nope'), ACTIVITY_PROFILES.backcountry);
});

test('failing checks lead; the rest follow the activity', () => {
  const checks = ['weather', 'alerts', 'daylight', 'terrain', 'avalanche', 'air'].map((key) => ({ key, over: key === 'air' }));
  assert.deepEqual(orderActivityChecks(checks, 'ski-touring').map((c) => c.key), ['air', 'avalanche', 'terrain', 'weather', 'alerts', 'daylight']);
  assert.deepEqual(orderActivityChecks(checks.map((c) => ({ ...c, over: false })), 'trail-running').map((c) => c.key),
    ['weather', 'air', 'daylight', 'alerts', 'terrain', 'avalanche']);
});
