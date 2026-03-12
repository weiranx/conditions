import L from 'leaflet';
import type { LinkState, UserPreferences } from './types';
import { DEFAULT_CENTER } from './constants';
import {
  isValidLatLon,
  normalizeForecastDate,
  normalizeTimeOrFallback,
} from './core';
import { normalizeElevationInput } from './planner-helpers';

export function sanitizeExternalUrl(rawUrl?: string): string | null {
  if (!rawUrl) {
    return null;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }
  const httpsNormalized = /^http:\/\//i.test(trimmed) ? trimmed.replace(/^http:\/\//i, 'https://') : trimmed;
  if (!/^https?:\/\//i.test(httpsNormalized)) {
    return null;
  }
  try {
    const parsed = new URL(httpsNormalized);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    if (!parsed.hostname) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function parseLinkState(todayDate: string, maxForecastDate: string, preferences: UserPreferences): LinkState {
  const defaults: LinkState = {
    view: 'home',
    activity: 'backcountry',
    position: DEFAULT_CENTER,
    hasObjective: false,
    objectiveName: '',
    searchQuery: '',
    forecastDate: todayDate,
    alpineStartTime: preferences.defaultStartTime,
    targetElevationInput: '',
  };

  if (typeof window === 'undefined') {
    return defaults;
  }

  const params = new URLSearchParams(window.location.search);
  const lat = parseFloat(params.get('lat') || '');
  const lon = parseFloat(params.get('lon') || '');
  const hasCoords = isValidLatLon(lat, lon);

  const objectiveName = (params.get('name') || '').trim();
  const searchQuery = (params.get('q') || objectiveName).trim();
  // Support path-based routing (/logs, /settings, etc.) with legacy ?view= fallback
  const pathSegment = window.location.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  const viewParam = pathSegment || params.get('view') || '';
  const hasExplicitSettingsView = viewParam === 'settings';
  const hasExplicitStatusView = viewParam === 'status';
  const hasExplicitTripView = viewParam === 'trip';
  const hasExplicitLogsView = viewParam === 'logs';

  return {
    view: hasExplicitSettingsView
      ? 'settings'
      : hasExplicitStatusView
        ? 'status'
        : hasExplicitTripView
          ? 'trip'
          : hasExplicitLogsView
            ? 'logs'
            : viewParam === 'planner' || hasCoords
              ? 'planner'
              : 'home',
    activity: 'backcountry',
    position: hasCoords ? new L.LatLng(lat, lon) : DEFAULT_CENTER,
    hasObjective: hasCoords,
    objectiveName,
    searchQuery,
    forecastDate: normalizeForecastDate(params.get('date'), todayDate, maxForecastDate),
    alpineStartTime: normalizeTimeOrFallback(params.get('start'), preferences.defaultStartTime),
    targetElevationInput: normalizeElevationInput(params.get('elev')),
  };
}

export function buildShareQuery(state: {
  view: 'home' | 'planner' | 'settings' | 'status' | 'trip' | 'logs';
  hasObjective: boolean;
  position: L.LatLng;
  objectiveName: string;
  searchQuery: string;
  forecastDate: string;
  alpineStartTime: string;
  targetElevationInput: string;
}): string {
  const params = new URLSearchParams();

  if (state.hasObjective) {
    params.set('lat', state.position.lat.toFixed(5));
    params.set('lon', state.position.lng.toFixed(5));
  }

  if (state.objectiveName.trim()) {
    params.set('name', state.objectiveName.trim());
  }

  if (state.searchQuery.trim()) {
    params.set('q', state.searchQuery.trim());
  }

  params.set('date', state.forecastDate);
  params.set('start', state.alpineStartTime);
  if (state.targetElevationInput.trim()) {
    params.set('elev', state.targetElevationInput.trim());
  }

  return params.toString();
}

export function buildSafetyRequestKey(lat: number, lon: number, date: string, startTime: string, travelWindowHours: number): string {
  return `${lat.toFixed(5)},${lon.toFixed(5)}@${date}@${startTime}@w${travelWindowHours}`;
}
