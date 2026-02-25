import L from 'leaflet';
import type { MapStyle } from './types';

export const DATE_FMT = /^\d{4}-\d{2}-\d{2}$/;
export const DEFAULT_CENTER = new L.LatLng(39.8283, -98.5795);
export const USER_PREFERENCES_KEY = 'summitsafe:user-preferences:v1';
export const LEGACY_DEFAULT_START_TIME = '04:30';
export const TEMP_LAPSE_F_PER_1000FT = 3.3;
export const WIND_INCREASE_MPH_PER_1000FT = 2;
export const GUST_INCREASE_MPH_PER_1000FT = 2.5;
export const MIN_TRAVEL_WINDOW_HOURS = 1;
export const MAX_TRAVEL_WINDOW_HOURS = 24;
export const SEARCH_DEBOUNCE_MS = 180;
export const BACKEND_WAKE_NOTICE_DELAY_MS = 10000;
export const BACKEND_WAKE_RETRY_DELAY_MS = 2500;
export const BACKEND_WAKE_RETRY_MAX_ATTEMPTS = 24;
export const APP_DISCLAIMER_TEXT =
  'Backcountry Conditions is a planning aid, not a safety guarantee. Data can be delayed, incomplete, or wrong. Verify official weather, avalanche, fire, and land-management products, then make final decisions from field observations and team judgment.';
export const APP_CREDIT_TEXT = 'Built by Weiran Xiong with AI support.';

export const FT_PER_METER = 3.28084;
export const METER_PER_FOOT = 1 / FT_PER_METER;
export const KPH_PER_MPH = 1.60934;
export const MM_PER_INCH = 25.4;
export const CM_PER_INCH = 2.54;
export const KM_PER_MILE = 1.60934;

export const MAP_STYLE_OPTIONS: Record<MapStyle, { label: string; url: string; attribution: string }> = {
  topo: {
    label: 'Terrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors, SRTM | style: OpenTopoMap (CC-BY-SA)',
  },
  street: {
    label: 'Street',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
};
