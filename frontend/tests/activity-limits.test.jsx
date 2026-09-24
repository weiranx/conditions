import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeActivityKey,
  activeActivityLabel,
  applyPreferencePatch,
  builtInActivityLimits,
  builtInRouteTiming,
  createCustomActivityPatch,
  deleteCustomActivityPatch,
  pickActivityLimits,
  pickRouteTiming,
  renameCustomActivityPatch,
} from '../src/app/activity-limits';
import { getDefaultUserPreferences, normalizeUserPreferences } from '../src/app/preferences';

const start = () => normalizeUserPreferences(getDefaultUserPreferences());

test('switching activity loads that activity\'s limits', () => {
  const prefs = applyPreferencePatch(start(), { defaultActivity: 'alpine-climbing' });
  assert.deepEqual(pickActivityLimits(prefs), builtInActivityLimits('alpine-climbing'));
  assert.equal(prefs.maxWindGustMph, 18);
});

test('an edited limit belongs to the activity it was edited for', () => {
  let prefs = applyPreferencePatch(start(), { defaultActivity: 'ski-touring' });
  prefs = applyPreferencePatch(prefs, { maxWindGustMph: 35 });
  prefs = applyPreferencePatch(prefs, { defaultActivity: 'hiking' });
  assert.equal(prefs.maxWindGustMph, builtInActivityLimits('hiking').maxWindGustMph);
  prefs = applyPreferencePatch(prefs, { defaultActivity: 'ski-touring' });
  assert.equal(prefs.maxWindGustMph, 35);
});

test('patching activity and limits together keeps the patched limits', () => {
  const prefs = applyPreferencePatch(start(), { defaultActivity: 'trail-running', maxWindGustMph: 12 });
  assert.equal(prefs.maxWindGustMph, 12);
  assert.equal(prefs.activityLimits['trail-running'].maxWindGustMph, 12);
});

test('custom activities keep their own limits and plan as their base activity', () => {
  let prefs = applyPreferencePatch(start(), { defaultActivity: 'ski-touring' });
  prefs = applyPreferencePatch(prefs, { maxWindGustMph: 22 });
  prefs = applyPreferencePatch(prefs, { defaultActivity: 'hiking' });
  prefs = applyPreferencePatch(prefs, createCustomActivityPatch(prefs, '  Winter  peaks ', 'ski-touring'));
  const customId = prefs.customActivityId;
  assert.match(customId, /^custom-/);
  assert.equal(prefs.defaultActivity, 'ski-touring');
  assert.equal(activeActivityLabel(prefs), 'Winter peaks');
  // Starts from the user's limits for its base activity.
  assert.equal(prefs.maxWindGustMph, 22);
  assert.equal(prefs.maxPrecipChance, builtInActivityLimits('ski-touring').maxPrecipChance);

  prefs = applyPreferencePatch(prefs, { maxPrecipChance: 20 });
  prefs = applyPreferencePatch(prefs, { defaultActivity: 'ski-touring', customActivityId: null });
  assert.equal(activeActivityKey(prefs), 'ski-touring');
  assert.equal(prefs.maxPrecipChance, builtInActivityLimits('ski-touring').maxPrecipChance);
  assert.equal(prefs.maxWindGustMph, 22);

  prefs = applyPreferencePatch(prefs, { defaultActivity: 'ski-touring', customActivityId: customId });
  assert.equal(prefs.maxPrecipChance, 20);
  assert.equal(prefs.maxWindGustMph, 22);
});

test('a built-in activity from a link leaves a custom activity with another base', () => {
  let prefs = applyPreferencePatch(start(), createCustomActivityPatch(start(), 'Dawn patrol', 'ski-touring'));
  const same = applyPreferencePatch(prefs, { defaultActivity: 'ski-touring' });
  assert.equal(same.customActivityId, prefs.customActivityId);
  prefs = applyPreferencePatch(prefs, { defaultActivity: 'hiking' });
  assert.equal(prefs.customActivityId, null);
  assert.equal(activeActivityKey(prefs), 'hiking');
});

test('rename and delete custom activities', () => {
  let prefs = applyPreferencePatch(start(), createCustomActivityPatch(start(), 'Dawn patrol', 'ski-touring'));
  const id = prefs.customActivityId;
  prefs = applyPreferencePatch(prefs, { maxWindGustMph: 40 });
  assert.equal(renameCustomActivityPatch(prefs, id, '   '), null);
  prefs = applyPreferencePatch(prefs, renameCustomActivityPatch(prefs, id, 'Early laps'));
  assert.equal(activeActivityLabel(prefs), 'Early laps');

  prefs = applyPreferencePatch(prefs, deleteCustomActivityPatch(prefs, id));
  assert.equal(prefs.customActivities.length, 0);
  assert.equal(prefs.customActivityId, null);
  assert.equal(prefs.defaultActivity, 'ski-touring');
  assert.equal(prefs.maxWindGustMph, builtInActivityLimits('ski-touring').maxWindGustMph);
  assert.equal(prefs.activityLimits[id], undefined);
});

test('an empty name does not create an activity', () => {
  assert.equal(createCustomActivityPatch(start(), '   ', 'hiking'), null);
});

test('stored preferences from before per-activity limits keep their limits', () => {
  const legacy = { ...getDefaultUserPreferences(), defaultActivity: 'scrambling', maxWindGustMph: 33 };
  delete legacy.activityLimits;
  delete legacy.customActivities;
  delete legacy.customActivityId;
  const prefs = normalizeUserPreferences(legacy);
  assert.equal(prefs.maxWindGustMph, 33);
  assert.equal(prefs.activityLimits.scrambling.maxWindGustMph, 33);
  assert.deepEqual(prefs.customActivities, []);
  assert.equal(prefs.customActivityId, null);
});

test('untouched legacy limits give way to the activity\'s own defaults', () => {
  const legacy = { ...getDefaultUserPreferences(), defaultActivity: 'alpine-climbing' };
  delete legacy.activityLimits;
  const prefs = normalizeUserPreferences(legacy, { adoptActivityDefaults: true });
  assert.deepEqual(pickActivityLimits(prefs), builtInActivityLimits('alpine-climbing'));
  // A saved report's snapshot keeps the limits it was checked against.
  assert.equal(normalizeUserPreferences(legacy).maxWindGustMph, 25);
});

test('normalization drops malformed custom activities and orphaned limits', () => {
  const prefs = normalizeUserPreferences({
    ...getDefaultUserPreferences(),
    customActivityId: 'custom-gone',
    customActivities: [
      { id: 'custom-ok', label: 'Fine', baseActivity: 'hiking' },
      { id: 'bad id', label: 'Nope', baseActivity: 'hiking' },
      { id: 'custom-kayak', label: 'Kayak', baseActivity: 'kayaking' },
    ],
    activityLimits: {
      'custom-gone': { maxWindGustMph: 30, maxPrecipChance: 30, minFeelsLikeF: 0, maxFeelsLikeF: 90 },
      'custom-ok': { maxWindGustMph: 500, maxPrecipChance: 30, minFeelsLikeF: 0, maxFeelsLikeF: 90 },
    },
  });
  assert.deepEqual(prefs.customActivities.map((activity) => activity.id), ['custom-ok']);
  assert.equal(prefs.customActivityId, null);
  assert.equal(prefs.activityLimits['custom-gone'], undefined);
  assert.equal(prefs.activityLimits['custom-ok'].maxWindGustMph, 80);
});

test('switching activity loads that activity\'s route timing, from Settings or the planner', () => {
  const prefs = applyPreferencePatch(start(), { defaultActivity: 'trail-running', customActivityId: null });
  assert.deepEqual(pickRouteTiming(prefs), builtInRouteTiming('trail-running'));
  assert.equal(prefs.runnerPaceMinutesPerMile, 20);
  // Weather limits are untouched by route timing and vice versa.
  assert.deepEqual(pickActivityLimits(prefs), builtInActivityLimits('trail-running'));
});

test('an edited pace belongs to the activity it was edited for', () => {
  let prefs = applyPreferencePatch(start(), { defaultActivity: 'trail-running' });
  prefs = applyPreferencePatch(prefs, { runnerPaceMinutesPerMile: 14, runnerStopBufferMinutes: 10 });
  prefs = applyPreferencePatch(prefs, { defaultActivity: 'mountaineering' });
  assert.deepEqual(pickRouteTiming(prefs), builtInRouteTiming('mountaineering'));
  prefs = applyPreferencePatch(prefs, { defaultActivity: 'trail-running' });
  assert.equal(prefs.runnerPaceMinutesPerMile, 14);
  assert.equal(prefs.runnerStopBufferMinutes, 10);
  assert.equal(prefs.runnerAscentMinutesPer1000Ft, builtInRouteTiming('trail-running').runnerAscentMinutesPer1000Ft);
  assert.equal(prefs.maxWindGustMph, builtInActivityLimits('trail-running').maxWindGustMph);
});

test('custom activities start from their base activity\'s timing and keep their own', () => {
  let prefs = applyPreferencePatch(start(), { defaultActivity: 'ski-touring' });
  prefs = applyPreferencePatch(prefs, { runnerPaceMinutesPerMile: 25 });
  prefs = applyPreferencePatch(prefs, { defaultActivity: 'hiking' });
  prefs = applyPreferencePatch(prefs, createCustomActivityPatch(prefs, 'Dawn patrol', 'ski-touring'));
  const id = prefs.customActivityId;
  assert.equal(prefs.runnerPaceMinutesPerMile, 25);
  prefs = applyPreferencePatch(prefs, { runnerPaceMinutesPerMile: 18 });
  prefs = applyPreferencePatch(prefs, { defaultActivity: 'ski-touring', customActivityId: null });
  assert.equal(prefs.runnerPaceMinutesPerMile, 25);
  prefs = applyPreferencePatch(prefs, { defaultActivity: 'ski-touring', customActivityId: id });
  assert.equal(prefs.runnerPaceMinutesPerMile, 18);
  prefs = applyPreferencePatch(prefs, deleteCustomActivityPatch(prefs, id));
  assert.equal(prefs.runnerPaceMinutesPerMile, 25);
  assert.equal(prefs.activityRouteTiming[id], undefined);
});

test('stored route timing round-trips and is clamped', () => {
  let prefs = applyPreferencePatch(start(), { defaultActivity: 'scrambling' });
  prefs = applyPreferencePatch(prefs, { runnerPaceMinutesPerMile: 33 });
  prefs = applyPreferencePatch(prefs, { defaultActivity: 'hiking' });
  const restored = normalizeUserPreferences(JSON.parse(JSON.stringify(prefs)), { adoptActivityDefaults: true });
  assert.equal(restored.activityRouteTiming.scrambling.runnerPaceMinutesPerMile, 33);
  const clamped = normalizeUserPreferences({
    ...prefs,
    activityRouteTiming: { ...prefs.activityRouteTiming, 'alpine-climbing': { runnerPaceMinutesPerMile: 500 } },
  });
  assert.equal(clamped.activityRouteTiming['alpine-climbing'].runnerPaceMinutesPerMile, 90);
  assert.equal(
    clamped.activityRouteTiming['alpine-climbing'].runnerStopBufferMinutes,
    builtInRouteTiming('alpine-climbing').runnerStopBufferMinutes,
  );
});

test('a legacy global pace left at an activity\'s defaults adopts the active activity\'s timing', () => {
  // Picking trail running in Settings used to copy its pace into the one global
  // setting; switching to mountaineering in the planner left it there.
  const legacy = { ...getDefaultUserPreferences(), defaultActivity: 'mountaineering', ...builtInRouteTiming('trail-running') };
  delete legacy.activityRouteTiming;
  const prefs = normalizeUserPreferences(legacy, { adoptActivityDefaults: true });
  assert.deepEqual(pickRouteTiming(prefs), builtInRouteTiming('mountaineering'));

  const tuned = { ...legacy, runnerPaceMinutesPerMile: 17 };
  const kept = normalizeUserPreferences(tuned, { adoptActivityDefaults: true });
  assert.equal(kept.runnerPaceMinutesPerMile, 17);
  assert.equal(kept.activityRouteTiming.mountaineering.runnerPaceMinutesPerMile, 17);
});
