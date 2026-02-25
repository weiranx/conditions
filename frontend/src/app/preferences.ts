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
import { currentLocalTimeInput } from './date-time-inputs';
import type { UserPreferences } from './types';

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

export function getDefaultUserPreferences(): UserPreferences {
  return {
    defaultActivity: 'backcountry',
    defaultStartTime: currentLocalTimeInput(),
    defaultBackByTime: '12:00',
    themeMode: 'system',
    temperatureUnit: 'f',
    elevationUnit: 'ft',
    windSpeedUnit: 'mph',
    timeStyle: 'ampm',
    maxWindGustMph: 25,
    maxPrecipChance: 60,
    minFeelsLikeF: 5,
    travelWindowHours: 12,
  };
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

    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    const storedStartTime = normalizeTimeOrFallback(parsed.defaultStartTime || null, defaults.defaultStartTime);
    const normalizedStartTime =
      storedStartTime === LEGACY_DEFAULT_START_TIME
        ? defaults.defaultStartTime
        : storedStartTime;
    return {
      defaultActivity: parsed.defaultActivity ? normalizeActivity(parsed.defaultActivity) : defaults.defaultActivity,
      defaultStartTime: normalizedStartTime,
      defaultBackByTime: normalizeTimeOrFallback(parsed.defaultBackByTime || null, defaults.defaultBackByTime),
      themeMode: normalizeThemeMode(parsed.themeMode),
      temperatureUnit: normalizeTemperatureUnit(parsed.temperatureUnit),
      elevationUnit: normalizeElevationUnit(parsed.elevationUnit),
      windSpeedUnit: normalizeWindSpeedUnit(parsed.windSpeedUnit),
      timeStyle: normalizeTimeStyle(parsed.timeStyle),
      maxWindGustMph: normalizeDecimalPreference(parsed.maxWindGustMph, defaults.maxWindGustMph, 10, 80, 2),
      maxPrecipChance: normalizeNumberPreference(parsed.maxPrecipChance, defaults.maxPrecipChance, 0, 100),
      minFeelsLikeF: normalizeDecimalPreference(parsed.minFeelsLikeF, defaults.minFeelsLikeF, -40, 60, 2),
      travelWindowHours: normalizeNumberPreference(
        parsed.travelWindowHours,
        defaults.travelWindowHours,
        MIN_TRAVEL_WINDOW_HOURS,
        MAX_TRAVEL_WINDOW_HOURS,
      ),
    };
  } catch {
    return defaults;
  }
}

export function persistUserPreferences(preferences: UserPreferences): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(USER_PREFERENCES_KEY, JSON.stringify(preferences));
}
