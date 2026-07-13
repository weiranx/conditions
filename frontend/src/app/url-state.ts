import L from 'leaflet';
import type { LinkState, UserPreferences } from './types';
import { DEFAULT_CENTER } from './constants';
import {
  isValidLatLon,
  normalizeActivity,
  normalizeForecastDate,
  normalizeTimeOrFallback,
} from './core';
import { normalizeElevationInput } from './planner-helpers';
import { getInitialForecastDate } from './planned-start';

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
  const initialForecastDate = getInitialForecastDate(todayDate, preferences.defaultStartTime);
  const defaults: LinkState = {
    view: 'home',
    activity: preferences.defaultActivity,
    position: DEFAULT_CENTER,
    hasObjective: false,
    objectiveName: '',
    searchQuery: '',
    forecastDate: initialForecastDate,
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
  // Support path-based routing (/admin, /settings, etc.) with legacy ?view= fallback.
  // Keep /logs working as an alias for existing bookmarks.
  const pathSegment = window.location.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  const viewParam = pathSegment || params.get('view') || '';
  const hasExplicitSettingsView = viewParam === 'settings';
  const hasExplicitStatusView = viewParam === 'status';
  const hasExplicitTripView = viewParam === 'trip';
  const hasExplicitAdminView = viewParam === 'admin' || viewParam === 'logs';
  const hasExplicitPrivacyView = viewParam === 'privacy';
  const hasExplicitTermsView = viewParam === 'terms';
  const hasUnknownView = Boolean(viewParam) && ![
    'home',
    'planner',
    'settings',
    'status',
    'trip',
    'admin',
    'logs',
    'privacy',
    'terms',
  ].includes(viewParam);

  return {
    view: hasUnknownView
      ? 'not-found'
      : hasExplicitSettingsView
      ? 'settings'
      : hasExplicitStatusView
        ? 'status'
        : hasExplicitTripView
          ? 'trip'
          : hasExplicitAdminView
            ? 'admin'
            : hasExplicitPrivacyView
              ? 'privacy'
              : hasExplicitTermsView
                ? 'terms'
                : viewParam === 'planner' || hasCoords
                  ? 'planner'
                  : 'home',
    activity: normalizeActivity(params.get('activity') || preferences.defaultActivity),
    position: hasCoords ? new L.LatLng(lat, lon) : DEFAULT_CENTER,
    hasObjective: hasCoords,
    objectiveName,
    searchQuery,
    forecastDate: params.has('date')
      ? normalizeForecastDate(params.get('date'), todayDate, maxForecastDate)
      : initialForecastDate,
    alpineStartTime: normalizeTimeOrFallback(params.get('start'), preferences.defaultStartTime),
    targetElevationInput: normalizeElevationInput(params.get('elev')),
    travelWindowHours: params.has('tw') && Number.isFinite(Number(params.get('tw'))) && Number(params.get('tw')) >= 1 && Number(params.get('tw')) <= 24 ? Number(params.get('tw')) : null,
  };
}

export function buildShareQuery(state: {
  view: 'home' | 'planner' | 'settings' | 'status' | 'trip' | 'admin' | 'privacy' | 'terms' | 'not-found';
  hasObjective: boolean;
  position: L.LatLng;
  objectiveName: string;
  searchQuery: string;
  forecastDate: string;
  alpineStartTime: string;
  targetElevationInput: string;
  travelWindowHours?: number;
  activity?: UserPreferences['defaultActivity'];
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
  if (state.activity) {
    params.set('activity', state.activity);
  }
  if (state.targetElevationInput.trim()) {
    params.set('elev', state.targetElevationInput.trim());
  }
  if (state.travelWindowHours != null && state.travelWindowHours !== 12) {
    params.set('tw', String(state.travelWindowHours));
  }

  return params.toString();
}

export function buildSafetyRequestKey(lat: number, lon: number, date: string, startTime: string, travelWindowHours: number): string {
  return `${lat.toFixed(5)},${lon.toFixed(5)}@${date}@${startTime}@w${travelWindowHours}`;
}
