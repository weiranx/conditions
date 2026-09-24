import {
  LEGACY_DEFAULT_START_TIME,
  MAX_TRAVEL_WINDOW_HOURS,
  MIN_TRAVEL_WINDOW_HOURS,
  USER_PREFERENCES_KEY,
} from './constants';
import {
  normalizeActivity,
  normalizeElevationUnit,
  normalizeTemperatureUnit,
  normalizeThemeMode,
  normalizeTimeOrFallback,
  normalizeTimeStyle,
  normalizeWindSpeedUnit,
} from './core';
import {
  ACTIVITY_LIMIT_KEYS,
  MAX_CUSTOM_ACTIVITIES,
  ROUTE_TIMING_KEYS,
  activeActivityKey,
  builtInActivityLimits,
  builtInRouteTiming,
  defaultRouteTimingForKey,
  isCustomActivityId,
  normalizeCustomActivityLabel,
  pickActivityLimits,
  pickRouteTiming,
  sameActivityLimits,
  sameRouteTiming,
} from './activity-limits';
import { ACTIVITY_PROFILE_ORDER } from './activity-profiles';
import type { ActivityLimits, ActivityRouteTiming, ActivityType, CustomActivity, UserPreferences } from './types';

function normalizeNumberPreference(rawValue: unknown, fallback: number, min: number, max: number): number {
  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(numericValue)));
}

function normalizeDecimalPreference(rawValue: unknown, fallback: number, min: number, max: number, precision = 2): number {
  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  const clamped = Math.max(min, Math.min(max, numericValue));
  return Number(clamped.toFixed(precision));
}

const WEATHER_LIMIT_BOUNDS = {
  maxWindGustMph: [10, 80],
  maxPrecipChance: [0, 100],
  minFeelsLikeF: [-40, 60],
  maxFeelsLikeF: [70, 120],
} as const;

function normalizeActivityLimits(value: unknown, fallback: ActivityLimits): ActivityLimits {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<ActivityLimits> : {};
  const limits = { ...fallback };
  for (const key of ACTIVITY_LIMIT_KEYS) {
    const [min, max] = WEATHER_LIMIT_BOUNDS[key];
    limits[key] = key === 'maxPrecipChance'
      ? normalizeNumberPreference(raw[key], fallback[key], min, max)
      : normalizeDecimalPreference(raw[key], fallback[key], min, max, 2);
  }
  return limits;
}

export const ROUTE_TIMING_BOUNDS = {
  runnerPaceMinutesPerMile: [5, 90],
  runnerAscentMinutesPer1000Ft: [0, 120],
  runnerStopBufferMinutes: [0, 240],
} as const;

function normalizeRouteTiming(value: unknown, fallback: ActivityRouteTiming): ActivityRouteTiming {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<ActivityRouteTiming> : {};
  const timing = { ...fallback };
  for (const key of ROUTE_TIMING_KEYS) {
    const [min, max] = ROUTE_TIMING_BOUNDS[key];
    timing[key] = normalizeNumberPreference(raw[key], fallback[key], min, max);
  }
  return timing;
}

function isKnownActivityKey(key: string, customIds: Set<string>): boolean {
  return isCustomActivityId(key) ? customIds.has(key) : ACTIVITY_PROFILE_ORDER.includes(key as ActivityType);
}

function normalizeCustomActivities(value: unknown): CustomActivity[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const activities: CustomActivity[] = [];
  for (const item of value) {
    if (activities.length >= MAX_CUSTOM_ACTIVITIES) break;
    if (!item || typeof item !== 'object') continue;
    const { id, label, baseActivity } = item as Partial<CustomActivity>;
    const cleanLabel = typeof label === 'string' ? normalizeCustomActivityLabel(label) : '';
    if (!isCustomActivityId(id) || seen.has(id) || !cleanLabel) continue;
    if (!ACTIVITY_PROFILE_ORDER.includes(baseActivity as ActivityType)) continue;
    seen.add(id);
    activities.push({ id, label: cleanLabel, baseActivity: baseActivity as ActivityType });
  }
  return activities;
}

export function getDefaultUserPreferences(): UserPreferences {
  return {
    defaultActivity: 'hiking',
    customActivityId: null,
    customActivities: [],
    activityLimits: {},
    activityRouteTiming: {},
    defaultStartTime: '07:00',
    themeMode: 'system',
    temperatureUnit: 'f',
    elevationUnit: 'ft',
    windSpeedUnit: 'mph',
    timeStyle: 'ampm',
    maxWindGustMph: 25,
    maxPrecipChance: 60,
    minFeelsLikeF: 5,
    maxFeelsLikeF: 95,
    travelWindowHours: 12,
    runnerPaceMinutesPerMile: 30,
    runnerAscentMinutesPer1000Ft: 45,
    runnerStopBufferMinutes: 45,
    approachElevationAdjustment: true,
  };
}

export function hasStoredUserPreferences(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const preferences = value as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(preferences, 'defaultActivity')
    || Object.prototype.hasOwnProperty.call(preferences, 'defaultStartTime')
    || Object.prototype.hasOwnProperty.call(preferences, 'themeMode');
}

/**
 * `adoptActivityDefaults` is for a person's live preferences only: saved
 * report snapshots keep the limits they were checked against.
 */
export function normalizeUserPreferences(
  value: unknown,
  { adoptActivityDefaults = false }: { adoptActivityDefaults?: boolean } = {},
): UserPreferences {
  const defaults = getDefaultUserPreferences();
  const parsed = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<UserPreferences>
    : {};
  const storedStartTime = normalizeTimeOrFallback(parsed.defaultStartTime || null, defaults.defaultStartTime);
  const normalizedStartTime = storedStartTime === LEGACY_DEFAULT_START_TIME
    ? defaults.defaultStartTime
    : storedStartTime;

  const customActivities = normalizeCustomActivities(parsed.customActivities);
  const customActivity = customActivities.find((activity) => activity.id === parsed.customActivityId) || null;
  const rawActivityLimits = parsed.activityLimits && typeof parsed.activityLimits === 'object' && !Array.isArray(parsed.activityLimits)
    ? parsed.activityLimits as Record<string, unknown>
    : {};
  const rawActivityRouteTiming = parsed.activityRouteTiming && typeof parsed.activityRouteTiming === 'object'
    && !Array.isArray(parsed.activityRouteTiming)
    ? parsed.activityRouteTiming as Record<string, unknown>
    : {};
  const customIds = new Set(customActivities.map((activity) => activity.id));

  const normalized: UserPreferences = {
    defaultActivity: customActivity
      ? customActivity.baseActivity
      : parsed.defaultActivity ? normalizeActivity(parsed.defaultActivity) : defaults.defaultActivity,
    customActivityId: customActivity?.id || null,
    customActivities,
    activityLimits: {},
    activityRouteTiming: {},
    defaultStartTime: normalizedStartTime,
    themeMode: normalizeThemeMode(parsed.themeMode),
    temperatureUnit: normalizeTemperatureUnit(parsed.temperatureUnit),
    elevationUnit: normalizeElevationUnit(parsed.elevationUnit),
    windSpeedUnit: normalizeWindSpeedUnit(parsed.windSpeedUnit),
    timeStyle: normalizeTimeStyle(parsed.timeStyle),
    maxWindGustMph: normalizeDecimalPreference(parsed.maxWindGustMph, defaults.maxWindGustMph, 10, 80, 2),
    maxPrecipChance: normalizeNumberPreference(parsed.maxPrecipChance, defaults.maxPrecipChance, 0, 100),
    minFeelsLikeF: normalizeDecimalPreference(parsed.minFeelsLikeF, defaults.minFeelsLikeF, -40, 60, 2),
    maxFeelsLikeF: normalizeDecimalPreference(parsed.maxFeelsLikeF, defaults.maxFeelsLikeF, 70, 120, 2),
    travelWindowHours: normalizeNumberPreference(
      parsed.travelWindowHours,
      defaults.travelWindowHours,
      MIN_TRAVEL_WINDOW_HOURS,
      MAX_TRAVEL_WINDOW_HOURS,
    ),
    ...normalizeRouteTiming(parsed, pickRouteTiming(defaults)),
    approachElevationAdjustment: typeof parsed.approachElevationAdjustment === 'boolean'
      ? parsed.approachElevationAdjustment
      : defaults.approachElevationAdjustment,
  };

  // The flat limits are the active activity's; saved limits for the others
  // ride along. Preferences from before per-activity limits had one global set:
  // limits someone tuned seed the active activity, untouched defaults give way
  // to that activity's own defaults.
  const legacy = !parsed.activityLimits;
  if (adoptActivityDefaults && legacy && sameActivityLimits(pickActivityLimits(normalized), pickActivityLimits(defaults))) {
    Object.assign(normalized, builtInActivityLimits(normalized.defaultActivity));
  }
  const fallbackLimits = pickActivityLimits(normalized);
  for (const [key, limits] of Object.entries(rawActivityLimits)) {
    if (isKnownActivityKey(key, customIds)) normalized.activityLimits[key] = normalizeActivityLimits(limits, fallbackLimits);
  }
  normalized.activityLimits[activeActivityKey(normalized)] = fallbackLimits;

  // Route timing works the same way. Before it was saved per activity, picking
  // an activity in Settings copied that activity's defaults into the one global
  // pace, so a pace matching any activity's defaults was never tuned by hand.
  if (
    adoptActivityDefaults
    && !parsed.activityRouteTiming
    && ACTIVITY_PROFILE_ORDER.some((activity) => sameRouteTiming(pickRouteTiming(normalized), builtInRouteTiming(activity)))
  ) {
    Object.assign(normalized, defaultRouteTimingForKey(normalized, activeActivityKey(normalized)));
  }
  for (const [key, timing] of Object.entries(rawActivityRouteTiming)) {
    if (isKnownActivityKey(key, customIds)) {
      normalized.activityRouteTiming[key] = normalizeRouteTiming(timing, defaultRouteTimingForKey(normalized, key));
    }
  }
  normalized.activityRouteTiming[activeActivityKey(normalized)] = pickRouteTiming(normalized);
  return normalized;
}

export function loadUserPreferences(): UserPreferences {
  const defaults = getDefaultUserPreferences();

  if (typeof window === 'undefined') {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(USER_PREFERENCES_KEY);
    if (!raw) {
      return defaults;
    }

    return normalizeUserPreferences(JSON.parse(raw), { adoptActivityDefaults: true });
  } catch {
    return defaults;
  }
}

export function persistUserPreferences(preferences: UserPreferences): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(USER_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // QuotaExceededError or SecurityError — silently ignore
  }
}
