import { ACTIVITY_PROFILES } from './activity-profiles';
import type { ActivityLimits, ActivityRouteTiming, ActivityType, CustomActivity, UserPreferences } from './types';

export const ACTIVITY_LIMIT_KEYS = ['maxWindGustMph', 'maxPrecipChance', 'minFeelsLikeF', 'maxFeelsLikeF'] as const;
export const ROUTE_TIMING_KEYS = ['runnerPaceMinutesPerMile', 'runnerAscentMinutesPer1000Ft', 'runnerStopBufferMinutes'] as const;
export const MAX_CUSTOM_ACTIVITIES = 12;
export const MAX_CUSTOM_ACTIVITY_LABEL_LENGTH = 40;
const CUSTOM_ACTIVITY_ID_PATTERN = /^custom-[a-z0-9]{1,32}$/;

export function isCustomActivityId(value: unknown): value is string {
  return typeof value === 'string' && CUSTOM_ACTIVITY_ID_PATTERN.test(value);
}

export function pickActivityLimits(source: ActivityLimits): ActivityLimits {
  return {
    maxWindGustMph: source.maxWindGustMph,
    maxPrecipChance: source.maxPrecipChance,
    minFeelsLikeF: source.minFeelsLikeF,
    maxFeelsLikeF: source.maxFeelsLikeF,
  };
}

export function builtInActivityLimits(activity: ActivityType): ActivityLimits {
  return pickActivityLimits(ACTIVITY_PROFILES[activity].preferencePatch);
}

export function sameActivityLimits(a: ActivityLimits, b: ActivityLimits): boolean {
  return Math.abs(a.maxWindGustMph - b.maxWindGustMph) <= 0.01
    && a.maxPrecipChance === b.maxPrecipChance
    && Math.abs(a.minFeelsLikeF - b.minFeelsLikeF) <= 0.01
    && Math.abs(a.maxFeelsLikeF - b.maxFeelsLikeF) <= 0.01;
}

export function pickRouteTiming(source: ActivityRouteTiming): ActivityRouteTiming {
  return {
    runnerPaceMinutesPerMile: source.runnerPaceMinutesPerMile,
    runnerAscentMinutesPer1000Ft: source.runnerAscentMinutesPer1000Ft,
    runnerStopBufferMinutes: source.runnerStopBufferMinutes,
  };
}

export function builtInRouteTiming(activity: ActivityType): ActivityRouteTiming {
  return pickRouteTiming(ACTIVITY_PROFILES[activity].preferencePatch);
}

export function sameRouteTiming(a: ActivityRouteTiming, b: ActivityRouteTiming): boolean {
  return ROUTE_TIMING_KEYS.every((key) => a[key] === b[key]);
}

type ActivitySelection = Pick<UserPreferences, 'defaultActivity' | 'customActivityId' | 'customActivities'>;

export function findCustomActivity(preferences: ActivitySelection, id: string | null): CustomActivity | null {
  if (!id) return null;
  return preferences.customActivities.find((activity) => activity.id === id) || null;
}

/** The key the active weather limits are saved under: a custom activity id or the built-in type. */
export function activeActivityKey(preferences: ActivitySelection): string {
  return findCustomActivity(preferences, preferences.customActivityId)?.id || preferences.defaultActivity;
}

export function activeActivityLabel(preferences: ActivitySelection): string {
  return findCustomActivity(preferences, preferences.customActivityId)?.label
    || ACTIVITY_PROFILES[preferences.defaultActivity].label;
}

/** Limits a fresh activity starts from: a custom activity inherits its base activity's defaults. */
export function defaultLimitsForKey(preferences: ActivitySelection, key: string): ActivityLimits {
  const custom = findCustomActivity(preferences, key);
  return builtInActivityLimits(custom ? custom.baseActivity : (key as ActivityType));
}

export function savedLimitsForKey(preferences: Pick<UserPreferences, 'activityLimits'> & ActivitySelection, key: string): ActivityLimits {
  return preferences.activityLimits[key] || defaultLimitsForKey(preferences, key);
}

/** Route timing a fresh activity starts from: a custom activity inherits its base activity's. */
export function defaultRouteTimingForKey(preferences: ActivitySelection, key: string): ActivityRouteTiming {
  const custom = findCustomActivity(preferences, key);
  return builtInRouteTiming(custom ? custom.baseActivity : (key as ActivityType));
}

export function savedRouteTimingForKey(
  preferences: Pick<UserPreferences, 'activityRouteTiming'> & ActivitySelection,
  key: string,
): ActivityRouteTiming {
  return preferences.activityRouteTiming[key] || defaultRouteTimingForKey(preferences, key);
}

/** Drops values saved for custom activities that no longer exist. */
function withoutDeletedActivities<T>(saved: Record<string, T>, customIds: Set<string>): Record<string, T> {
  const kept: Record<string, T> = {};
  for (const [key, value] of Object.entries(saved)) {
    if (!isCustomActivityId(key) || customIds.has(key)) kept[key] = value;
  }
  return kept;
}

/**
 * Applies a preference patch while keeping weather limits and route timing
 * per activity.
 *
 * The flat limit and timing fields are always the active activity's. Switching
 * activity (without also patching them) loads that activity's saved values,
 * and the active values are written back under the active key, so editing a
 * limit or pace only changes the activity it was edited for.
 */
export function applyPreferencePatch(prev: UserPreferences, patch: Partial<UserPreferences>): UserPreferences {
  let next: UserPreferences = { ...prev, ...patch };

  // Selecting a different built-in activity leaves a custom activity built on another base.
  if (!('customActivityId' in patch) && 'defaultActivity' in patch) {
    const current = findCustomActivity(next, next.customActivityId);
    if (current && current.baseActivity !== next.defaultActivity) next = { ...next, customActivityId: null };
  }
  const selected = findCustomActivity(next, next.customActivityId);
  if (next.customActivityId && !selected) next = { ...next, customActivityId: null };
  if (selected) next = { ...next, defaultActivity: selected.baseActivity };

  const customIds = new Set(next.customActivities.map((activity) => activity.id));
  const activityLimits = withoutDeletedActivities(next.activityLimits, customIds);
  const activityRouteTiming = withoutDeletedActivities(next.activityRouteTiming, customIds);

  const prevKey = activeActivityKey(prev);
  const nextKey = activeActivityKey(next);
  if (nextKey !== prevKey) {
    if (!ACTIVITY_LIMIT_KEYS.some((key) => key in patch)) {
      next = { ...next, ...savedLimitsForKey({ ...next, activityLimits }, nextKey) };
    }
    if (!ROUTE_TIMING_KEYS.some((key) => key in patch)) {
      next = { ...next, ...savedRouteTimingForKey({ ...next, activityRouteTiming }, nextKey) };
    }
  }
  activityLimits[nextKey] = pickActivityLimits(next);
  activityRouteTiming[nextKey] = pickRouteTiming(next);
  return { ...next, activityLimits, activityRouteTiming };
}

function newCustomActivityId(existing: CustomActivity[]): string {
  const taken = new Set(existing.map((activity) => activity.id));
  for (;;) {
    const id = `custom-${Math.random().toString(36).slice(2, 10) || '0'}`;
    if (!taken.has(id)) return id;
  }
}

export function normalizeCustomActivityLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim().slice(0, MAX_CUSTOM_ACTIVITY_LABEL_LENGTH);
}

/**
 * A patch that creates a custom activity and selects it. It starts from the
 * limits and route timing the user has for its base activity. Returns null
 * when the name is empty or the list is full.
 */
export function createCustomActivityPatch(
  preferences: UserPreferences,
  label: string,
  baseActivity: ActivityType,
): Partial<UserPreferences> | null {
  const cleanLabel = normalizeCustomActivityLabel(label);
  if (!cleanLabel || preferences.customActivities.length >= MAX_CUSTOM_ACTIVITIES) return null;
  const activity: CustomActivity = { id: newCustomActivityId(preferences.customActivities), label: cleanLabel, baseActivity };
  return {
    customActivities: [...preferences.customActivities, activity],
    customActivityId: activity.id,
    defaultActivity: baseActivity,
    ...savedLimitsForKey(preferences, baseActivity),
    ...savedRouteTimingForKey(preferences, baseActivity),
  };
}

export function renameCustomActivityPatch(preferences: UserPreferences, id: string, label: string): Partial<UserPreferences> | null {
  const cleanLabel = normalizeCustomActivityLabel(label);
  if (!cleanLabel || !findCustomActivity(preferences, id)) return null;
  return {
    customActivities: preferences.customActivities.map((activity) => (
      activity.id === id ? { ...activity, label: cleanLabel } : activity
    )),
  };
}

/** Deleting the selected custom activity falls back to its base activity. */
export function deleteCustomActivityPatch(preferences: UserPreferences, id: string): Partial<UserPreferences> {
  const removed = findCustomActivity(preferences, id);
  const patch: Partial<UserPreferences> = {
    customActivities: preferences.customActivities.filter((activity) => activity.id !== id),
  };
  if (removed && preferences.customActivityId === id) {
    patch.customActivityId = null;
    patch.defaultActivity = removed.baseActivity;
  }
  return patch;
}
