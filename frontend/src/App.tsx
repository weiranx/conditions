import React, { useState, useEffect, useCallback, useRef, useTransition } from 'react';
import { MapContainer, TileLayer, Marker, ScaleControl, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  Search,
  Wind,
  CloudRain,
  Thermometer,
  Zap,
  AlertTriangle,
  Mountain,
  Compass,
  Map as MapIcon,
  LocateFixed,
  Layers,
  Navigation,
  Clock,
  House,
  Link2,
  CalendarDays,
  CheckCircle2,
  XCircle,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Printer,
  MessageSquare,
  Info,
  Flame,
  Sun,
  RefreshCw,
} from 'lucide-react';
import './App.css';
import { fetchApi, readApiErrorMessage } from './lib/api-client';
import {
  getLocalPopularSuggestions,
  normalizeSuggestionText,
  rankAndDeduplicateSuggestions,
  type Suggestion,
} from './lib/search';
import { SearchBox } from './components/planner/SearchBox';
import { ForecastLoading } from './components/planner/ForecastLoading';
import {
  ASPECT_ROSE_ORDER,
  leewardAspectsFromWind,
  windDirectionToDegrees,
  parseLikelihoodRange,
  parseProblemSizeRange,
  getLocationEntries,
  parseTerrainFromLocation,
} from './utils/avalanche';

import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({ iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
L.Marker.prototype.options.icon = DefaultIcon;

const DATE_FMT = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_CENTER = new L.LatLng(39.8283, -98.5795);
const USER_PREFERENCES_KEY = 'summitsafe:user-preferences:v1';
const LEGACY_DEFAULT_START_TIME = '04:30';
const TEMP_LAPSE_F_PER_1000FT = 3.3;
const WIND_INCREASE_MPH_PER_1000FT = 2;
const GUST_INCREASE_MPH_PER_1000FT = 2.5;
const MIN_TRAVEL_WINDOW_HOURS = 4;
const MAX_TRAVEL_WINDOW_HOURS = 12;
const SEARCH_DEBOUNCE_MS = 180;
const BACKEND_WAKE_NOTICE_DELAY_MS = 1400;
const BACKEND_WAKE_RETRY_DELAY_MS = 2500;
const BACKEND_WAKE_RETRY_MAX_ATTEMPTS = 24;
const APP_DISCLAIMER_TEXT =
  'Backcountry Conditions is a planning aid, not a safety guarantee. Data can be delayed, incomplete, or wrong. Verify official weather, avalanche, fire, and land-management products, then make final decisions from field observations and team judgment.';
const APP_CREDIT_TEXT = 'Built by Weiran Xiong with AI support.';

type DecisionLevel = 'GO' | 'CAUTION' | 'NO-GO';
type ActivityType = 'backcountry';
type ThemeMode = 'system' | 'light' | 'dark';
type MapStyle = 'topo' | 'street';
type TemperatureUnit = 'f' | 'c';
type ElevationUnit = 'ft' | 'm';
type WindSpeedUnit = 'mph' | 'kph';
type TimeStyle = 'ampm' | '24h';

const FT_PER_METER = 3.28084;
const METER_PER_FOOT = 1 / FT_PER_METER;
const KPH_PER_MPH = 1.60934;
const MM_PER_INCH = 25.4;
const CM_PER_INCH = 2.54;
const KM_PER_MILE = 1.60934;

const MAP_STYLE_OPTIONS: Record<MapStyle, { label: string; url: string; attribution: string }> = {
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

function normalizeActivity(rawActivity: string | null): ActivityType {
  if (!rawActivity) {
    return 'backcountry';
  }

  const cleaned = rawActivity.trim().toLowerCase();
  if (cleaned === 'backcountry' || cleaned === 'general') {
    return 'backcountry';
  }
  if (cleaned === 'mountaineer' || cleaned === 'hiker' || cleaned === 'hiking' || cleaned === 'trail_runner' || cleaned === 'trail-runner' || cleaned === 'runner') {
    return 'backcountry';
  }
  return 'backcountry';
}

interface AvalancheElevationBand {
  level?: number;
  label?: string;
}

interface AvalancheProblem {
  id?: number;
  name?: string;
  likelihood?: string;
  size?: Array<string | number> | string | number;
  location?: string[] | string | Record<string, unknown>;
  discussion?: string;
  problem_description?: string;
  icon?: string;
}

interface WeatherTrendPoint {
  time: string;
  temp: number;
  wind: number;
  gust: number;
  windDirection?: string | null;
  precipChance?: number;
  condition: string;
}

interface ElevationForecastBand {
  label: string;
  elevationFt: number;
  deltaFromObjectiveFt: number;
  temp: number;
  feelsLike: number;
  windSpeed: number;
  windGust: number;
}

interface SafetyData {
  generatedAt?: string;
  location: { lat: number; lon: number };
  forecast?: {
    selectedDate?: string;
    selectedStartTime?: string;
    selectedEndTime?: string;
    isFuture?: boolean;
    availableRange?: { start?: string; end?: string };
  };
  weather: {
    temp: number;
    feelsLike?: number;
    dewPoint?: number | null;
    description: string;
    windSpeed: number;
    windGust: number;
    windDirection?: string | null;
    humidity: number;
    cloudCover: number;
    precipChance: number;
    isDaytime?: boolean | null;
    forecastLink?: string;
    issuedTime?: string;
    generatedTime?: string | null;
    timezone?: string | null;
    forecastStartTime?: string;
    forecastEndTime?: string;
    forecastDate?: string;
    trend?: WeatherTrendPoint[];
    elevation?: number | null;
    elevationUnit?: string;
    elevationSource?: string;
    elevationForecast?: ElevationForecastBand[];
    elevationForecastNote?: string;
    sourceDetails?: {
      primary?: string;
      blended?: boolean;
      supplementalSources?: string[];
      fieldSources?: Record<string, string>;
    };
  };
  solar: { sunrise: string; sunset: string; dayLength: string };
  avalanche: {
    risk: string;
    dangerLevel: number;
    dangerUnknown?: boolean;
    relevant?: boolean;
    relevanceReason?: string;
    coverageStatus?: 'reported' | 'no_center_coverage' | 'temporarily_unavailable' | 'no_active_forecast' | 'expired_for_selected_start';
    center?: string;
    zone?: string;
    problems?: AvalancheProblem[];
    bottomLine?: string;
    advice?: string;
    link?: string;
    elevations?: {
      below?: AvalancheElevationBand;
      at?: AvalancheElevationBand;
      above?: AvalancheElevationBand;
    };
    publishedTime?: string;
    expiresTime?: string;
    generatedTime?: string | null;
  };
  alerts?: {
    source?: string;
    status?: string;
    activeCount?: number;
    totalActiveCount?: number;
    targetTime?: string | null;
    highestSeverity?: string;
    alerts?: Array<{
      event?: string;
      severity?: string;
      urgency?: string;
      certainty?: string;
      headline?: string;
      description?: string | null;
      instruction?: string | null;
      areaDesc?: string | null;
      affectedAreas?: string[];
      senderName?: string | null;
      response?: string | null;
      messageType?: string | null;
      category?: string | null;
      sent?: string | null;
      onset?: string | null;
      ends?: string | null;
      effective?: string | null;
      expires?: string | null;
      link?: string | null;
    }>;
    note?: string | null;
    generatedTime?: string | null;
  };
  airQuality?: {
    source?: string;
    status?: string;
    usAqi?: number | null;
    category?: string;
    pm25?: number | null;
    pm10?: number | null;
    ozone?: number | null;
    measuredTime?: string | null;
    generatedTime?: string | null;
  };
  rainfall?: {
    source?: string;
    status?: string;
    mode?: 'observed_recent' | 'projected_for_selected_start';
    issuedTime?: string | null;
    anchorTime?: string | null;
    timezone?: string | null;
    expected?: {
      status?: string;
      travelWindowHours?: number | null;
      startTime?: string | null;
      endTime?: string | null;
      rainWindowMm?: number | null;
      rainWindowIn?: number | null;
      snowWindowCm?: number | null;
      snowWindowIn?: number | null;
      note?: string | null;
    };
    totals?: {
      rainPast12hMm?: number | null;
      rainPast24hMm?: number | null;
      rainPast48hMm?: number | null;
      rainPast12hIn?: number | null;
      rainPast24hIn?: number | null;
      rainPast48hIn?: number | null;
      snowPast12hCm?: number | null;
      snowPast24hCm?: number | null;
      snowPast48hCm?: number | null;
      snowPast12hIn?: number | null;
      snowPast24hIn?: number | null;
      snowPast48hIn?: number | null;
      past12hMm?: number | null;
      past24hMm?: number | null;
      past48hMm?: number | null;
      past12hIn?: number | null;
      past24hIn?: number | null;
      past48hIn?: number | null;
    };
    note?: string | null;
    link?: string | null;
    generatedTime?: string | null;
  };
  snowpack?: {
    source?: string;
    status?: string;
    summary?: string;
    snotel?: {
      source?: string;
      status?: string;
      stationTriplet?: string;
      stationId?: string | null;
      stationName?: string;
      networkCode?: string | null;
      stateCode?: string | null;
      distanceKm?: number | null;
      elevationFt?: number | null;
      observedDate?: string | null;
      snowDepthIn?: number | null;
      sweIn?: number | null;
      precipIn?: number | null;
      obsTempF?: number | null;
      link?: string | null;
      note?: string | null;
    } | null;
    nohrsc?: {
      source?: string;
      status?: string;
      sampledTime?: string | null;
      snowDepthIn?: number | null;
      sweIn?: number | null;
      depthMeters?: number | null;
      sweMillimeters?: number | null;
      depthDataset?: string | null;
      sweDataset?: string | null;
      link?: string | null;
      note?: string | null;
    } | null;
    generatedTime?: string | null;
  };
  fireRisk?: {
    source?: string;
    status?: string;
    level?: number;
    label?: string;
    guidance?: string;
    reasons?: string[];
    alertsUsed?: number;
    alertsConsidered?: Array<{
      event?: string;
      severity?: string;
      expires?: string | null;
      link?: string | null;
    }>;
  };
  heatRisk?: {
    source?: string;
    status?: string;
    level?: number;
    label?: string;
    guidance?: string;
    reasons?: string[];
    metrics?: {
      tempF?: number | null;
      feelsLikeF?: number | null;
      humidity?: number | null;
      peakTemp12hF?: number | null;
      peakFeelsLike12hF?: number | null;
      lowerTerrainTempF?: number | null;
      lowerTerrainFeelsLikeF?: number | null;
      lowerTerrainLabel?: string | null;
      lowerTerrainElevationFt?: number | null;
      isDaytime?: boolean | null;
    };
    generatedTime?: string | null;
  };
  gear?: string[];
  trail?: string;
  terrainCondition?: {
    code?: string;
    label?: string;
    confidence?: 'high' | 'medium' | 'low';
    summary?: string;
    reasons?: string[];
    signals?: {
      tempF?: number | null;
      precipChance?: number | null;
      humidity?: number | null;
      windMph?: number | null;
      gustMph?: number | null;
      wetTrendHours?: number | null;
      snowTrendHours?: number | null;
      rain12hIn?: number | null;
      rain24hIn?: number | null;
      rain48hIn?: number | null;
      snow12hIn?: number | null;
      snow24hIn?: number | null;
      snow48hIn?: number | null;
      maxSnowDepthIn?: number | null;
      maxSweIn?: number | null;
      snotelDistanceKm?: number | null;
    };
  };
  safety: {
    score: number;
    confidence?: number;
    primaryHazard: string;
    explanations: string[];
    sourcesUsed?: string[];
    factors?: Array<{ hazard?: string; impact?: number; source?: string; message?: string }>;
    groupImpacts?: Record<string, { raw?: number; capped?: number; cap?: number }>;
    confidenceReasons?: string[];
    airQualityCategory?: string;
  };
  aiAnalysis: string;
}

interface SummitDecision {
  level: DecisionLevel;
  headline: string;
  blockers: string[];
  cautions: string[];
  checks: { key?: string; label: string; ok: boolean; detail?: string; action?: string }[];
}

type NwsAlertItem = NonNullable<NonNullable<SafetyData['alerts']>['alerts']>[number];

interface SnowpackInterpretation {
  headline: string;
  confidence: 'solid' | 'watch' | 'low';
  bullets: string[];
}

interface SnowpackInsightBadge {
  label: string;
  detail: string;
  tone: 'good' | 'watch' | 'warn';
}

interface SnowpackSnapshotInsights {
  signal: SnowpackInsightBadge;
  freshness: SnowpackInsightBadge;
  representativeness: SnowpackInsightBadge;
  agreement: SnowpackInsightBadge;
}

interface LinkState {
  view: 'home' | 'planner' | 'settings' | 'status';
  activity: ActivityType;
  position: L.LatLng;
  hasObjective: boolean;
  objectiveName: string;
  searchQuery: string;
  forecastDate: string;
  alpineStartTime: string;
  turnaroundTime: string;
  targetElevationInput: string;
}

interface UserPreferences {
  defaultActivity: ActivityType;
  defaultStartTime: string;
  defaultBackByTime: string;
  themeMode: ThemeMode;
  temperatureUnit: TemperatureUnit;
  elevationUnit: ElevationUnit;
  windSpeedUnit: WindSpeedUnit;
  timeStyle: TimeStyle;
  maxWindGustMph: number;
  maxPrecipChance: number;
  minFeelsLikeF: number;
  travelWindowHours: number;
}

function formatDateInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function addDaysToIsoDate(dateStr: string, days: number): string {
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return dateStr;
  }
  parsed.setDate(parsed.getDate() + days);
  return formatDateInput(parsed);
}

function parseIsoToMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00Z` : trimmed;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function pickOldestIsoTimestamp(values: Array<string | null | undefined>): string | null {
  let pickedValue: string | null = null;
  let pickedMs = Number.POSITIVE_INFINITY;
  values.forEach((value) => {
    const ms = parseIsoToMs(value);
    if (ms === null) {
      return;
    }
    if (ms < pickedMs) {
      pickedMs = ms;
      pickedValue = value || null;
    }
  });
  return pickedValue;
}

function pickNewestIsoTimestamp(values: Array<string | null | undefined>): string | null {
  let pickedValue: string | null = null;
  let pickedMs = Number.NEGATIVE_INFINITY;
  values.forEach((value) => {
    const ms = parseIsoToMs(value);
    if (ms === null) {
      return;
    }
    if (ms > pickedMs) {
      pickedMs = ms;
      pickedValue = value || null;
    }
  });
  return pickedValue;
}

function formatAgeFromNow(value: string | null | undefined): string {
  const ms = parseIsoToMs(value);
  if (ms === null) {
    return 'Unavailable';
  }
  const ageMinutes = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (ageMinutes < 60) {
    return `${ageMinutes}m ago`;
  }
  const hours = Math.floor(ageMinutes / 60);
  const minutes = ageMinutes % 60;
  return minutes === 0 ? `${hours}h ago` : `${hours}h ${minutes}m ago`;
}

type FreshnessState = 'fresh' | 'aging' | 'stale' | 'missing';

function freshnessClass(value: string | null | undefined, staleHours: number): FreshnessState {
  const ms = parseIsoToMs(value);
  if (ms === null) {
    return 'missing';
  }
  const ageHours = (Date.now() - ms) / 3600000;
  if (ageHours <= staleHours * 0.5) {
    return 'fresh';
  }
  if (ageHours <= staleHours) {
    return 'aging';
  }
  return 'stale';
}

function classifySnowpackFreshness(
  snotelObservedDate: string | null | undefined,
  nohrscSampledTime: string | null | undefined,
): {
  state: FreshnessState;
  referenceTimestamp: string | null;
  displayValue: string;
} {
  const snotelMs = parseIsoToMs(snotelObservedDate);
  const nohrscMs = parseIsoToMs(nohrscSampledTime);
  const snotelAgeHours = snotelMs === null ? null : (Date.now() - snotelMs) / 3600000;
  const nohrscAgeHours = nohrscMs === null ? null : (Date.now() - nohrscMs) / 3600000;

  const classifyByAge = (ageHours: number | null, freshHours: number, agingHours: number): FreshnessState => {
    if (ageHours === null) return 'missing';
    if (ageHours <= freshHours) return 'fresh';
    if (ageHours <= agingHours) return 'aging';
    return 'stale';
  };

  const snotelState = classifyByAge(snotelAgeHours, 60, 120);
  const nohrscState = classifyByAge(nohrscAgeHours, 8, 24);
  const states = [snotelState, nohrscState].filter((state) => state !== 'missing');

  const state: FreshnessState = (() => {
    if (states.length === 0) return 'missing';
    if (!states.includes('stale')) {
      if (states.includes('aging')) return 'aging';
      return 'fresh';
    }
    if (states.includes('fresh') || states.includes('aging')) {
      return 'aging';
    }
    return 'stale';
  })();

  const snotelAgeLabel = formatCompactAge(snotelObservedDate);
  const nohrscAgeLabel = formatCompactAge(nohrscSampledTime);
  const detailParts = [nohrscAgeLabel ? `NOHRSC ${nohrscAgeLabel}` : null, snotelAgeLabel ? `SNOTEL ${snotelAgeLabel}` : null].filter(Boolean);
  const displayValue = detailParts.length > 0 ? detailParts.join(' • ') : 'Unavailable';
  const referenceTimestamp = pickNewestIsoTimestamp([nohrscSampledTime || null, snotelObservedDate || null]);

  return { state, referenceTimestamp, displayValue };
}

function resolveSelectedTravelWindowMs(data: SafetyData | null | undefined, fallbackTravelWindowHours: number): { startMs: number; endMs: number } | null {
  if (!data) {
    return null;
  }
  const startMs = parseIsoToMs(data.weather?.forecastStartTime || data.forecast?.selectedStartTime || null);
  if (startMs === null) {
    return null;
  }
  const fallbackDurationMs = Math.max(1, Math.round(Number(fallbackTravelWindowHours) || 12)) * 3600000;
  const explicitEndMs = parseIsoToMs(data.forecast?.selectedEndTime || data.weather?.forecastEndTime || null);
  const endMs = explicitEndMs !== null && explicitEndMs > startMs ? explicitEndMs : startMs + fallbackDurationMs;
  return { startMs, endMs };
}

function isTravelWindowCoveredByAlertWindow(window: { startMs: number; endMs: number } | null, alerts: NwsAlertItem[] | null | undefined): boolean {
  if (!window || !Array.isArray(alerts) || alerts.length === 0) {
    return false;
  }
  return alerts.some((alert) => {
    const alertStartMs = parseIsoToMs(alert.onset || alert.effective || alert.sent || null);
    const alertEndMs = parseIsoToMs(alert.ends || alert.expires || null);
    if (alertStartMs === null && alertEndMs === null) {
      return false;
    }
    const normalizedStartMs = alertStartMs ?? Number.NEGATIVE_INFINITY;
    const normalizedEndMs = alertEndMs ?? Number.POSITIVE_INFINITY;
    if (normalizedEndMs <= normalizedStartMs) {
      return false;
    }
    return window.startMs >= normalizedStartMs && window.endMs <= normalizedEndMs;
  });
}

function parseCoordinates(input: string): { lat: number; lon: number } | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const coordinateMatch =
    trimmed.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/) ||
    trimmed.match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/);
  if (!coordinateMatch) return null;

  const lat = parseFloat(coordinateMatch[1]);
  const lon = parseFloat(coordinateMatch[2]);

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return null;
  }

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }

  return { lat, lon };
}

function parseTimeInputMinutes(value: string): number | null {
  const trimmed = value.trim();
  const twentyFourHourMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHourMatch) {
    const hour = parseInt(twentyFourHourMatch[1], 10);
    const minute = parseInt(twentyFourHourMatch[2], 10);

    if (Number.isNaN(hour) || Number.isNaN(minute) || hour > 23 || minute > 59) {
      return null;
    }

    return hour * 60 + minute;
  }

  const amPmMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!amPmMatch) {
    return null;
  }

  const hour12 = parseInt(amPmMatch[1], 10);
  const minute = parseInt(amPmMatch[2], 10);
  const meridiem = amPmMatch[3].toUpperCase();

  if (Number.isNaN(hour12) || Number.isNaN(minute) || hour12 < 1 || hour12 > 12 || minute > 59) {
    return null;
  }

  const hour24 = meridiem === 'PM' ? (hour12 % 12) + 12 : hour12 % 12;
  return hour24 * 60 + minute;
}

function minutesToTwentyFourHourClock(minutes: number): string {
  const clamped = Math.max(0, Math.min(1439, Math.round(minutes)));
  const hour24 = Math.floor(clamped / 60);
  const minute = clamped % 60;
  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function formatClockAmPm(value: string | null | undefined): string {
  if (!value) {
    return 'N/A';
  }
  const minutes = parseTimeInputMinutes(value);
  if (minutes === null) {
    return value;
  }
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${ampm}`;
}

function formatClockForStyle(value: string | null | undefined, style: TimeStyle): string {
  let minutes = parseTimeInputMinutes(value || '');
  if (minutes === null) {
    minutes = parseHourLabelToMinutes(value || '');
  }
  if (minutes === null) {
    minutes = parseSolarClockMinutes(value || undefined);
  }
  if (minutes === null) {
    return value || 'N/A';
  }
  if (style === '24h') {
    return minutesToTwentyFourHourClock(minutes);
  }
  return formatClockAmPm(minutesToTwentyFourHourClock(minutes));
}

function convertTempFToDisplayValue(tempF: number, unit: TemperatureUnit): number {
  if (!Number.isFinite(tempF)) {
    return tempF;
  }
  if (unit === 'c') {
    return (tempF - 32) * (5 / 9);
  }
  return tempF;
}

function convertDisplayTempToF(value: number, unit: TemperatureUnit): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  if (unit === 'c') {
    return value * (9 / 5) + 32;
  }
  return value;
}

function convertWindMphToDisplayValue(mph: number, unit: WindSpeedUnit): number {
  if (!Number.isFinite(mph)) {
    return mph;
  }
  if (unit === 'kph') {
    return mph * KPH_PER_MPH;
  }
  return mph;
}

function convertDisplayWindToMph(value: number, unit: WindSpeedUnit): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  if (unit === 'kph') {
    return value / KPH_PER_MPH;
  }
  return value;
}

function convertElevationFeetToDisplayValue(feet: number, unit: ElevationUnit): number {
  if (!Number.isFinite(feet)) {
    return feet;
  }
  if (unit === 'm') {
    return feet * METER_PER_FOOT;
  }
  return feet;
}

function convertDisplayElevationToFeet(value: number, unit: ElevationUnit): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  if (unit === 'm') {
    return value * FT_PER_METER;
  }
  return value;
}

function formatTemperatureForUnit(
  tempF: number | null | undefined,
  unit: TemperatureUnit,
  options?: { includeUnit?: boolean; precision?: number },
): string {
  const numericValue = typeof tempF === 'number' ? tempF : Number.NaN;
  if (!Number.isFinite(numericValue)) {
    return 'N/A';
  }
  const precision = options?.precision ?? 0;
  const value = convertTempFToDisplayValue(numericValue, unit);
  const rounded = precision > 0 ? value.toFixed(precision) : String(Math.round(value));
  if (options?.includeUnit === false) {
    return `${rounded}°`;
  }
  return `${rounded}°${unit.toUpperCase()}`;
}

function formatWindForUnit(
  windMph: number | null | undefined,
  unit: WindSpeedUnit,
  options?: { includeUnit?: boolean; precision?: number },
): string {
  const numericValue = typeof windMph === 'number' ? windMph : Number.NaN;
  if (!Number.isFinite(numericValue)) {
    return 'N/A';
  }
  const precision = options?.precision ?? 0;
  const value = convertWindMphToDisplayValue(numericValue, unit);
  const rounded = precision > 0 ? value.toFixed(precision) : String(Math.round(value));
  if (options?.includeUnit === false) {
    return rounded;
  }
  return `${rounded} ${unit}`;
}

function formatElevationForUnit(
  elevationFt: number | null | undefined,
  unit: ElevationUnit,
  options?: { includeUnit?: boolean; precision?: number },
): string {
  const numericValue = typeof elevationFt === 'number' ? elevationFt : Number.NaN;
  if (!Number.isFinite(numericValue)) {
    return 'N/A';
  }
  const precision = options?.precision ?? 0;
  const value = convertElevationFeetToDisplayValue(numericValue, unit);
  const rounded =
    precision > 0
      ? Number(value.toFixed(precision)).toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision })
      : Math.round(value).toLocaleString();
  if (options?.includeUnit === false) {
    return rounded;
  }
  return `${rounded} ${unit}`;
}

function formatElevationDeltaForUnit(deltaFt: number | null | undefined, unit: ElevationUnit): string {
  const numericValue = typeof deltaFt === 'number' ? deltaFt : Number.NaN;
  if (!Number.isFinite(numericValue)) {
    return 'N/A';
  }
  const value = convertElevationFeetToDisplayValue(numericValue, unit);
  const rounded = Math.round(value);
  if (rounded === 0) {
    return 'objective';
  }
  return `${rounded > 0 ? '+' : '-'}${Math.abs(rounded).toLocaleString()} ${unit}`;
}

function formatDistanceForElevationUnit(distanceKm: number | null | undefined, elevationUnit: ElevationUnit): string {
  const numericValue = typeof distanceKm === 'number' ? distanceKm : Number.NaN;
  if (!Number.isFinite(numericValue)) {
    return 'N/A';
  }
  if (elevationUnit === 'm') {
    return `${numericValue.toFixed(1)} km`;
  }
  return `${(numericValue / KM_PER_MILE).toFixed(1)} mi`;
}

function formatRainAmountForElevationUnit(
  inches: number | null | undefined,
  millimeters: number | null | undefined,
  elevationUnit: ElevationUnit,
): string {
  const inValue = typeof inches === 'number' ? inches : Number.NaN;
  const mmValue = typeof millimeters === 'number' ? millimeters : Number.NaN;
  if (elevationUnit === 'm') {
    if (Number.isFinite(mmValue)) {
      return `${Math.round(mmValue)} mm`;
    }
    if (Number.isFinite(inValue)) {
      return `${Math.round(inValue * MM_PER_INCH)} mm`;
    }
    return 'N/A';
  }
  if (Number.isFinite(inValue)) {
    return `${inValue.toFixed(2)} in`;
  }
  if (Number.isFinite(mmValue)) {
    return `${(mmValue / MM_PER_INCH).toFixed(2)} in`;
  }
  return 'N/A';
}

function formatSnowfallAmountForElevationUnit(
  inches: number | null | undefined,
  centimeters: number | null | undefined,
  elevationUnit: ElevationUnit,
): string {
  const inValue = typeof inches === 'number' ? inches : Number.NaN;
  const cmValue = typeof centimeters === 'number' ? centimeters : Number.NaN;
  if (elevationUnit === 'm') {
    if (Number.isFinite(cmValue)) {
      return `${cmValue.toFixed(1)} cm`;
    }
    if (Number.isFinite(inValue)) {
      return `${(inValue * CM_PER_INCH).toFixed(1)} cm`;
    }
    return 'N/A';
  }
  if (Number.isFinite(inValue)) {
    return `${inValue.toFixed(2)} in`;
  }
  if (Number.isFinite(cmValue)) {
    return `${(cmValue / CM_PER_INCH).toFixed(2)} in`;
  }
  return 'N/A';
}

function parseOptionalFiniteNumber(value: unknown): number {
  if (value === null || value === undefined) {
    return Number.NaN;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return Number.NaN;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatSnowDepthForElevationUnit(
  inches: number | null | undefined,
  elevationUnit: ElevationUnit,
): string {
  const inValue = typeof inches === 'number' ? inches : Number.NaN;
  if (!Number.isFinite(inValue)) {
    return 'N/A';
  }
  if (elevationUnit === 'm') {
    return `${Math.round(inValue * CM_PER_INCH)} cm`;
  }
  return `${Math.round(inValue)} in`;
}

function formatSweForElevationUnit(
  inches: number | null | undefined,
  elevationUnit: ElevationUnit,
): string {
  const inValue = typeof inches === 'number' ? inches : Number.NaN;
  if (!Number.isFinite(inValue)) {
    return 'N/A';
  }
  if (elevationUnit === 'm') {
    return `${Math.round(inValue * MM_PER_INCH)} mm SWE`;
  }
  return `${inValue.toFixed(1)} in SWE`;
}

function parseSolarClockMinutes(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (!match) {
    return null;
  }

  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const meridiem = match[3].toUpperCase();

  if (meridiem === 'PM' && hour < 12) {
    hour += 12;
  }
  if (meridiem === 'AM' && hour === 12) {
    hour = 0;
  }

  return hour * 60 + minute;
}

function formatMinutesRelativeToSunset(deltaMinutes: number, requiredBuffer: number): string {
  const abs = Math.abs(deltaMinutes);
  const relation = deltaMinutes >= 0 ? 'before sunset' : 'after sunset';
  const bufferStatus = deltaMinutes >= requiredBuffer ? 'meets daylight buffer' : 'below daylight buffer';
  return `${abs} min ${relation} (${bufferStatus})`;
}

function normalizeForecastDate(rawDate: string | null, todayDate: string, maxForecastDate: string): string {
  if (!rawDate || !DATE_FMT.test(rawDate)) {
    return todayDate;
  }
  if (rawDate < todayDate) {
    return todayDate;
  }
  if (rawDate > maxForecastDate) {
    return maxForecastDate;
  }
  return rawDate;
}

function isValidLatLon(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function normalizeTimeOrFallback(rawTime: string | null, fallback: string): string {
  if (!rawTime) {
    return fallback;
  }
  const parsedMinutes = parseTimeInputMinutes(rawTime);
  return parsedMinutes !== null ? minutesToTwentyFourHourClock(parsedMinutes) : fallback;
}

function normalizeThemeMode(rawTheme: string | null | undefined): ThemeMode {
  if (rawTheme === 'light' || rawTheme === 'dark' || rawTheme === 'system') {
    return rawTheme;
  }
  return 'system';
}

function normalizeTemperatureUnit(rawUnit: string | null | undefined): TemperatureUnit {
  return rawUnit === 'c' ? 'c' : 'f';
}

function normalizeElevationUnit(rawUnit: string | null | undefined): ElevationUnit {
  return rawUnit === 'm' ? 'm' : 'ft';
}

function normalizeWindSpeedUnit(rawUnit: string | null | undefined): WindSpeedUnit {
  return rawUnit === 'kph' ? 'kph' : 'mph';
}

function normalizeTimeStyle(rawStyle: string | null | undefined): TimeStyle {
  return rawStyle === '24h' ? '24h' : 'ampm';
}

function parseIsoDateToUtcMs(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return null;
  }
  const parsed = Date.parse(`${value.trim()}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSnowpackInterpretation(
  snowpack: SafetyData['snowpack'] | null | undefined,
  objectiveElevationFt: number | null | undefined,
  elevationUnit: ElevationUnit = 'ft',
): SnowpackInterpretation | null {
  const snotel = snowpack?.snotel || null;
  const nohrsc = snowpack?.nohrsc || null;

  const snotelDepth = Number(snotel?.snowDepthIn);
  const nohrscDepth = Number(nohrsc?.snowDepthIn);
  const snotelSwe = Number(snotel?.sweIn);
  const nohrscSwe = Number(nohrsc?.sweIn);
  const stationDistanceKm = Number(snotel?.distanceKm);
  const stationElevationFt = Number(snotel?.elevationFt);

  const hasSnotelDepth = Number.isFinite(snotelDepth);
  const hasNohrscDepth = Number.isFinite(nohrscDepth);
  const hasSnotelSwe = Number.isFinite(snotelSwe);
  const hasNohrscSwe = Number.isFinite(nohrscSwe);
  const hasAnySnowSignal =
    (hasSnotelDepth && snotelDepth > 0) ||
    (hasNohrscDepth && nohrscDepth > 0) ||
    (hasSnotelSwe && snotelSwe > 0) ||
    (hasNohrscSwe && nohrscSwe > 0);
  const maxDepthIn = Math.max(hasSnotelDepth ? snotelDepth : 0, hasNohrscDepth ? nohrscDepth : 0);
  const maxSweIn = Math.max(hasSnotelSwe ? snotelSwe : 0, hasNohrscSwe ? nohrscSwe : 0);
  const lowBroadSnowSignal =
    (hasSnotelDepth || hasNohrscDepth || hasSnotelSwe || hasNohrscSwe) &&
    maxDepthIn <= 1 &&
    maxSweIn <= 0.2;

  if (!hasSnotelDepth && !hasNohrscDepth && !hasSnotelSwe && !hasNohrscSwe) {
    return null;
  }

  let confidence: SnowpackInterpretation['confidence'] = 'solid';
  const bullets: string[] = [];

  if (hasSnotelDepth && hasNohrscDepth) {
    const baseline = Math.max(Math.abs(snotelDepth), Math.abs(nohrscDepth), 1);
    const depthDeltaPct = (Math.abs(nohrscDepth - snotelDepth) / baseline) * 100;
    if (depthDeltaPct <= 30) {
      bullets.push('SNOTEL and NOHRSC depth are broadly aligned, so snow coverage confidence is higher.');
    } else {
      confidence = lowBroadSnowSignal ? 'solid' : 'watch';
      bullets.push('SNOTEL vs NOHRSC depth diverge significantly, indicating patchy or elevation-sensitive snow distribution.');
    }
  } else {
    confidence = lowBroadSnowSignal ? 'solid' : 'watch';
    bullets.push(
      lowBroadSnowSignal
        ? 'Only one depth source is available, but broad snow signal remains minimal.'
        : 'Only one depth source is available; treat this as directional context, not a full snowpack picture.',
    );
  }

  if (Number.isFinite(stationDistanceKm) && !lowBroadSnowSignal) {
    const stationDistanceDisplay = formatDistanceForElevationUnit(stationDistanceKm, elevationUnit);
    if (stationDistanceKm <= 10) {
      bullets.push(`Nearest SNOTEL is close (${stationDistanceDisplay}), improving local representativeness.`);
    } else if (stationDistanceKm > 25) {
      confidence = confidence === 'solid' ? 'watch' : confidence;
      bullets.push(`Nearest SNOTEL is ${stationDistanceDisplay} away, so conditions may differ materially at your objective.`);
    }
  }

  if (Number.isFinite(stationElevationFt) && Number.isFinite(Number(objectiveElevationFt)) && !lowBroadSnowSignal) {
    const elevDelta = Math.abs(stationElevationFt - Number(objectiveElevationFt));
    if (elevDelta >= 2000) {
      confidence = confidence === 'solid' ? 'watch' : confidence;
      const displayDelta = convertElevationFeetToDisplayValue(elevDelta, elevationUnit);
      bullets.push(
        `SNOTEL station elevation differs by ~${Math.round(displayDelta).toLocaleString()} ${elevationUnit} from the objective; expect vertical snowpack variability.`,
      );
    }
  }

  const observedDateMs = parseIsoDateToUtcMs(snotel?.observedDate || null);
  if (observedDateMs !== null) {
    const ageDays = Math.max(0, Math.floor((Date.now() - observedDateMs) / (24 * 60 * 60 * 1000)));
    if (ageDays >= 3) {
      confidence = lowBroadSnowSignal ? 'watch' : 'low';
      bullets.push(
        lowBroadSnowSignal
          ? `SNOTEL observation is ${ageDays} days old; broad no-snow signal is likely still valid, but verify for shaded pockets.`
          : `SNOTEL observation is ${ageDays} days old; re-verify with latest center/weather products before committing.`,
      );
    } else if (ageDays >= 1) {
      confidence = confidence === 'solid' ? 'watch' : confidence;
      bullets.push(`SNOTEL observation is ${ageDays} day${ageDays === 1 ? '' : 's'} old; recent weather may have changed conditions.`);
    }
  }

  if (hasAnySnowSignal) {
    const headline =
      (hasNohrscDepth && nohrscDepth >= 24) || (hasSnotelSwe && snotelSwe >= 8) || (hasNohrscSwe && nohrscSwe >= 8)
        ? 'Substantial snowpack signal. Treat avalanche terrain as consequential.'
        : 'Some snowpack signal present. Validate terrain-specific stability as you travel.';
    return {
      headline,
      confidence,
      bullets: bullets.slice(0, 4),
    };
  }

  return {
    headline: 'Minimal broad snow signal in these sources. Non-snow travel is more likely, but isolated snow/ice pockets can remain.',
    confidence: confidence === 'low' ? 'watch' : confidence,
    bullets: bullets.slice(0, 4),
  };
}

function formatCompactAge(value: string | null | undefined): string | null {
  const ms = parseIsoToMs(value);
  if (ms === null) {
    return null;
  }
  const ageMinutes = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (ageMinutes < 60) {
    return `${ageMinutes}m old`;
  }
  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) {
    return `${ageHours}h old`;
  }
  const ageDays = Math.floor(ageHours / 24);
  return `${ageDays}d old`;
}

function buildSnowpackInsights(
  snowpack: SafetyData['snowpack'] | null | undefined,
  objectiveElevationFt: number | null | undefined,
  elevationUnit: ElevationUnit = 'ft',
): SnowpackSnapshotInsights {
  const snotel = snowpack?.snotel || null;
  const nohrsc = snowpack?.nohrsc || null;

  const snotelDepth = Number(snotel?.snowDepthIn);
  const nohrscDepth = Number(nohrsc?.snowDepthIn);
  const snotelSwe = Number(snotel?.sweIn);
  const nohrscSwe = Number(nohrsc?.sweIn);
  const maxDepth = Math.max(
    Number.isFinite(snotelDepth) ? snotelDepth : 0,
    Number.isFinite(nohrscDepth) ? nohrscDepth : 0,
  );
  const maxSwe = Math.max(
    Number.isFinite(snotelSwe) ? snotelSwe : 0,
    Number.isFinite(nohrscSwe) ? nohrscSwe : 0,
  );
  const hasObservedSnowpack =
    Number.isFinite(snotelDepth) ||
    Number.isFinite(nohrscDepth) ||
    Number.isFinite(snotelSwe) ||
    Number.isFinite(nohrscSwe);
  const lowBroadSnowSignal = hasObservedSnowpack && maxDepth <= 1 && maxSwe <= 0.2;

  let signal: SnowpackInsightBadge;
  if (!hasObservedSnowpack) {
    signal = {
      label: 'Signal limited',
      detail: 'No usable SNOTEL/NOHRSC snow metrics were returned.',
      tone: 'watch',
    };
  } else if (maxDepth >= 24 || maxSwe >= 8) {
    signal = {
      label: 'Strong signal',
      detail: `Depth up to ${formatSnowDepthForElevationUnit(maxDepth, elevationUnit)} or SWE up to ${formatSweForElevationUnit(maxSwe, elevationUnit)}.`,
      tone: 'watch',
    };
  } else if (maxDepth >= 6 || maxSwe >= 1.5) {
    signal = {
      label: 'Measurable signal',
      detail: `Depth up to ${formatSnowDepthForElevationUnit(maxDepth, elevationUnit)} and SWE up to ${formatSweForElevationUnit(maxSwe, elevationUnit)}.`,
      tone: 'watch',
    };
  } else {
    signal = {
      label: 'Minimal broad signal',
      detail: `Depth/SWE are low (${formatSnowDepthForElevationUnit(maxDepth, elevationUnit)}, ${formatSweForElevationUnit(maxSwe, elevationUnit)}), but isolated snow terrain may still exist.`,
      tone: 'good',
    };
  }

  const snotelDistanceKm = Number(snotel?.distanceKm);
  const snotelElevationFt = Number(snotel?.elevationFt);
  const objectiveElevation = Number(objectiveElevationFt);
  const hasDistance = Number.isFinite(snotelDistanceKm);
  const hasElevDelta = Number.isFinite(snotelElevationFt) && Number.isFinite(objectiveElevation);
  const elevDeltaFt = hasElevDelta ? Math.abs(snotelElevationFt - objectiveElevation) : null;
  const distanceText = hasDistance ? formatDistanceForElevationUnit(snotelDistanceKm, elevationUnit) : 'N/A';
  const elevDeltaText =
    elevDeltaFt !== null
      ? `${Math.round(convertElevationFeetToDisplayValue(elevDeltaFt, elevationUnit)).toLocaleString()} ${elevationUnit}`
      : 'N/A';

  let representativeness: SnowpackInsightBadge;
  if (!hasDistance && !hasElevDelta) {
    representativeness = {
      label: lowBroadSnowSignal ? 'Context optional' : 'Representativeness unknown',
      detail: lowBroadSnowSignal
        ? 'Distance/elevation context is unavailable, but broad no-snow signal is still informative.'
        : 'Nearest SNOTEL distance/elevation context is unavailable.',
      tone: lowBroadSnowSignal ? 'good' : 'warn',
    };
  } else if ((hasDistance && snotelDistanceKm <= 10) && (elevDeltaFt === null || elevDeltaFt <= 1500)) {
    representativeness = {
      label: 'High representativeness',
      detail: `Nearest station is ${distanceText} away${elevDeltaFt !== null ? ` with ~${elevDeltaText} elevation offset` : ''}.`,
      tone: 'good',
    };
  } else if ((hasDistance && snotelDistanceKm > 30) || (elevDeltaFt !== null && elevDeltaFt > 3000)) {
    representativeness = {
      label: lowBroadSnowSignal ? 'Lower representativeness' : 'Low representativeness',
      detail: `Station context is less local (${distanceText}${elevDeltaFt !== null ? `, ~${elevDeltaText} elevation offset` : ''}); verify with on-route observations.`,
      tone: lowBroadSnowSignal ? 'watch' : 'warn',
    };
  } else {
    representativeness = {
      label: 'Moderate representativeness',
      detail: `Station context is usable but not exact (${distanceText}${elevDeltaFt !== null ? `, ~${elevDeltaText} elevation offset` : ''}).`,
      tone: 'watch',
    };
  }

  const depthPairAvailable = Number.isFinite(snotelDepth) && Number.isFinite(nohrscDepth);
  const swePairAvailable = Number.isFinite(snotelSwe) && Number.isFinite(nohrscSwe);
  const depthDeltaIn = depthPairAvailable ? Math.abs((snotelDepth as number) - (nohrscDepth as number)) : null;
  const sweDeltaIn = swePairAvailable ? Math.abs((snotelSwe as number) - (nohrscSwe as number)) : null;
  const depthDeltaPct =
    depthPairAvailable && Math.max(Math.abs(snotelDepth), Math.abs(nohrscDepth), 1) > 0
      ? (Math.abs((snotelDepth as number) - (nohrscDepth as number)) / Math.max(Math.abs(snotelDepth), Math.abs(nohrscDepth), 1)) * 100
      : null;
  const sweDeltaPct =
    swePairAvailable && Math.max(Math.abs(snotelSwe), Math.abs(nohrscSwe), 0.1) > 0
      ? (Math.abs((snotelSwe as number) - (nohrscSwe as number)) / Math.max(Math.abs(snotelSwe), Math.abs(nohrscSwe), 0.1)) * 100
      : null;
  const maxDeltaPct = Math.max(depthDeltaPct ?? 0, sweDeltaPct ?? 0);

  let agreement: SnowpackInsightBadge;
  if (!depthPairAvailable && !swePairAvailable) {
    agreement = {
      label: 'Single-source view',
      detail: 'Only one source has usable snow metrics. Treat this as directional context.',
      tone: lowBroadSnowSignal ? 'good' : 'watch',
    };
  } else {
    const agreementParts = [
      depthDeltaIn !== null
        ? `Depth Δ ${formatSnowDepthForElevationUnit(depthDeltaIn, elevationUnit)}${depthDeltaPct !== null ? ` (${Math.round(depthDeltaPct)}%)` : ''}`
        : null,
      sweDeltaIn !== null
        ? `SWE Δ ${formatSweForElevationUnit(sweDeltaIn, elevationUnit)}${sweDeltaPct !== null ? ` (${Math.round(sweDeltaPct)}%)` : ''}`
        : null,
    ]
      .filter(Boolean)
      .join(' • ');

    if (maxDeltaPct <= 35) {
      agreement = {
        label: 'Sources aligned',
        detail: agreementParts || 'SNOTEL and NOHRSC broadly agree.',
        tone: 'good',
      };
    } else if (maxDeltaPct <= 70 || lowBroadSnowSignal) {
      agreement = {
        label: 'Partial agreement',
        detail: `${agreementParts || 'Sources diverge somewhat.'} Expect patchy distribution.`,
        tone: 'watch',
      };
    } else {
      agreement = {
        label: 'Sources diverge',
        detail: `${agreementParts || 'Large disagreement between sources.'} Verify snow coverage on route before committing.`,
        tone: 'warn',
      };
    }
  }

  const snotelObsAgeLabel = formatCompactAge(snotel?.observedDate || null);
  const nohrscAgeLabel = formatCompactAge(nohrsc?.sampledTime || null);
  const snotelObsMs = parseIsoToMs(snotel?.observedDate || null);
  const nohrscObsMs = parseIsoToMs(nohrsc?.sampledTime || null);
  const snotelAgeHours = snotelObsMs === null ? null : (Date.now() - snotelObsMs) / 3600000;
  const nohrscAgeHours = nohrscObsMs === null ? null : (Date.now() - nohrscObsMs) / 3600000;

  let freshness: SnowpackInsightBadge;
  if (snotelAgeHours === null && nohrscAgeHours === null) {
    freshness = {
      label: lowBroadSnowSignal ? 'Timestamp limited' : 'Freshness unknown',
      detail: lowBroadSnowSignal
        ? 'No timestamps were returned; broad no-snow signal is likely still directionally useful.'
        : 'No observation timestamps were returned.',
      tone: lowBroadSnowSignal ? 'watch' : 'warn',
    };
  } else if ((nohrscAgeHours === null || nohrscAgeHours <= 8) && (snotelAgeHours === null || snotelAgeHours <= 60)) {
    freshness = {
      label: 'Fresh data',
      detail: [
        snotelObsAgeLabel ? `SNOTEL ${snotelObsAgeLabel}` : null,
        nohrscAgeLabel ? `NOHRSC ${nohrscAgeLabel}` : null,
      ]
        .filter(Boolean)
        .join(' • '),
      tone: 'good',
    };
  } else if ((nohrscAgeHours === null || nohrscAgeHours <= 18) && (snotelAgeHours === null || snotelAgeHours <= 96)) {
    freshness = {
      label: 'Aging data',
      detail: [
        snotelObsAgeLabel ? `SNOTEL ${snotelObsAgeLabel}` : null,
        nohrscAgeLabel ? `NOHRSC ${nohrscAgeLabel}` : null,
      ]
        .filter(Boolean)
        .join(' • '),
      tone: 'watch',
    };
  } else {
    freshness = {
      label: lowBroadSnowSignal ? 'Aging data' : 'Stale data',
      detail: [
        snotelObsAgeLabel ? `SNOTEL ${snotelObsAgeLabel}` : null,
        nohrscAgeLabel ? `NOHRSC ${nohrscAgeLabel}` : null,
      ]
        .filter(Boolean)
        .join(' • ') || 'Observation times are outdated.',
      tone: lowBroadSnowSignal ? 'watch' : 'warn',
    };
  }

  return { signal, freshness, representativeness, agreement };
}

function normalizeWindHintDirection(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = String(value).trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  if (normalized === 'VARIABLE') {
    return 'VRB';
  }
  if (normalized === 'VRB' || normalized === 'CALM') {
    return normalized;
  }
  return windDirectionToDegrees(normalized) === null ? null : normalized;
}

function windDirectionDeltaDegrees(a: string | null | undefined, b: string | null | undefined): number | null {
  const aDeg = windDirectionToDegrees(a || null);
  const bDeg = windDirectionToDegrees(b || null);
  if (aDeg === null || bDeg === null) {
    return null;
  }
  const diff = Math.abs(aDeg - bDeg) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function resolveDominantTrendWindDirection(trend: WeatherTrendPoint[] | null | undefined): {
  direction: string | null;
  count: number;
  total: number;
  ratio: number;
} {
  const directionalRows = Array.isArray(trend)
    ? trend
        .map((row) => normalizeWindHintDirection(row.windDirection))
        .filter((entry): entry is string => Boolean(entry) && entry !== 'CALM' && entry !== 'VRB')
    : [];
  if (directionalRows.length === 0) {
    return { direction: null, count: 0, total: 0, ratio: 0 };
  }

  const counts = new Map<string, number>();
  directionalRows.forEach((direction) => {
    counts.set(direction, (counts.get(direction) || 0) + 1);
  });
  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top) {
    return { direction: null, count: 0, total: directionalRows.length, ratio: 0 };
  }

  return {
    direction: top[0],
    count: top[1],
    total: directionalRows.length,
    ratio: top[1] / directionalRows.length,
  };
}

function secondaryCrossLoadingAspects(direction: string | null | undefined): string[] {
  const directionDeg = windDirectionToDegrees(direction || null);
  if (directionDeg === null) {
    return [];
  }
  const leewardDeg = (directionDeg + 180) % 360;
  const centerIndex = Math.round(leewardDeg / 45) % ASPECT_ROSE_ORDER.length;
  const left = ASPECT_ROSE_ORDER[(centerIndex + 2) % ASPECT_ROSE_ORDER.length];
  const right = ASPECT_ROSE_ORDER[(centerIndex + ASPECT_ROSE_ORDER.length - 2) % ASPECT_ROSE_ORDER.length];
  return Array.from(new Set([left, right]));
}

function normalizeElevationInput(rawValue: string | null | undefined): string {
  if (!rawValue) {
    return '';
  }
  const cleaned = rawValue.trim().replace(/,/g, '');
  if (!/^\d{3,5}$/.test(cleaned)) {
    return '';
  }
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 20000) {
    return '';
  }
  return String(Math.round(numeric));
}

function parseOptionalElevationInput(rawValue: string): number | null {
  const cleaned = String(rawValue || '').trim().replace(/,/g, '');
  if (!cleaned) {
    return null;
  }
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
}

function currentLocalTimeInput(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function currentDateTimeInputs(timeZone?: string | null): { date: string; time: string } {
  const now = new Date();
  const fallback = {
    date: formatDateInput(now),
    time: currentLocalTimeInput(),
  };

  if (!timeZone || typeof Intl === 'undefined') {
    return fallback;
  }

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const partMap = parts.reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') {
        acc[part.type] = part.value;
      }
      return acc;
    }, {});
    if (partMap.year && partMap.month && partMap.day && partMap.hour && partMap.minute) {
      return {
        date: `${partMap.year}-${partMap.month}-${partMap.day}`,
        time: `${partMap.hour}:${partMap.minute}`,
      };
    }
  } catch {
    // Fall back to local device time/date if timezone formatting fails.
  }

  return fallback;
}

function computeFeelsLikeF(tempF: number, windMph: number): number {
  if (!Number.isFinite(tempF)) {
    return tempF;
  }
  if (tempF <= 50 && windMph >= 3) {
    const feelsLike = 35.74 + 0.6215 * tempF - 35.75 * Math.pow(windMph, 0.16) + 0.4275 * tempF * Math.pow(windMph, 0.16);
    return Math.round(feelsLike);
  }
  return Math.round(tempF);
}

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

function getDefaultUserPreferences(): UserPreferences {
  return {
    defaultActivity: 'backcountry',
    defaultStartTime: currentLocalTimeInput(),
    defaultBackByTime: '12:00',
    themeMode: 'system',
    temperatureUnit: 'f',
    elevationUnit: 'ft',
    windSpeedUnit: 'mph',
    timeStyle: 'ampm',
    maxWindGustMph: 32,
    maxPrecipChance: 60,
    minFeelsLikeF: 5,
    travelWindowHours: 12,
  };
}

function loadUserPreferences(): UserPreferences {
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

function persistUserPreferences(preferences: UserPreferences): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(USER_PREFERENCES_KEY, JSON.stringify(preferences));
}

function normalizeDangerLevel(level: number | undefined): number {
  if (!Number.isFinite(level)) {
    return 0;
  }
  return Math.max(0, Math.min(5, Math.round(level || 0)));
}

function getDangerLevelClass(level: number | undefined): string {
  return `danger-level-${normalizeDangerLevel(level)}`;
}

function toPlainText(input: string | undefined): string {
  if (!input) {
    return '';
  }

  if (typeof window !== 'undefined' && typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(input, 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeText(input: string | undefined, maxLength?: number): string {
  const text = toPlainText(input);
  if (!text) {
    return '';
  }

  if (!Number.isFinite(maxLength) || (maxLength as number) <= 0) {
    return text;
  }

  const max = Math.round(maxLength as number);
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max).trimEnd()}...`;
}

function normalizeAlertNarrative(input: string | null | undefined, maxLength = 3200): string {
  if (!input) {
    return '';
  }
  const normalized = String(input)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function splitAlertNarrativeParagraphs(input: string | null | undefined, maxLength = 3200): string[] {
  return normalizeAlertNarrative(input, maxLength)
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean);
}

function stringifyRawPayload(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return '{"error":"Unable to serialize raw payload"}';
  }
}

interface HealthCheckResult {
  label: string;
  status: 'ok' | 'warn' | 'down';
  detail: string;
}

function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function truncateText(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type CriticalRiskLevel = 'stable' | 'watch' | 'high';

function assessCriticalWindowPoint(point: WeatherTrendPoint): { level: CriticalRiskLevel; reasons: string[]; score: number } {
  const reasons: string[] = [];
  let score = 0;
  const condition = String(point.condition || '').toLowerCase();
  const gust = Number(point.gust);
  const wind = Number(point.wind);
  const temp = Number(point.temp);
  const precipChance = Number(point.precipChance);

  if (/thunder|storm|lightning|hail|blizzard/.test(condition)) {
    score += 4;
    reasons.push('convective storm signal');
  }
  if (/snow|sleet|freezing|ice|wintry/.test(condition)) {
    score += 2;
    reasons.push('winter precip signal');
  } else if (/rain|shower/.test(condition)) {
    score += 1;
    reasons.push('precipitation signal');
  }
  if (Number.isFinite(precipChance) && precipChance >= 70) {
    score += 2;
    reasons.push(`precip ${Math.round(precipChance)}%`);
  } else if (Number.isFinite(precipChance) && precipChance >= 45) {
    score += 1;
    reasons.push(`precip ${Math.round(precipChance)}%`);
  }

  if (Number.isFinite(gust) && gust >= 45) {
    score += 4;
    reasons.push(`gusts ${Math.round(gust)} mph`);
  } else if (Number.isFinite(gust) && gust >= 35) {
    score += 2;
    reasons.push(`gusts ${Math.round(gust)} mph`);
  } else if (Number.isFinite(wind) && wind >= 25) {
    score += 1;
    reasons.push(`wind ${Math.round(wind)} mph`);
  }

  if (Number.isFinite(temp) && temp <= 10) {
    score += 1;
    reasons.push(`cold ${Math.round(temp)}F`);
  }

  if (score >= 6) {
    return { level: 'high', reasons, score };
  }
  if (score >= 3) {
    return { level: 'watch', reasons, score };
  }
  return { level: 'stable', reasons, score };
}

function criticalRiskLevelText(level: CriticalRiskLevel): string {
  if (level === 'high') return 'High Risk';
  if (level === 'watch') return 'Watch';
  return 'Stable';
}

function airQualityPillClass(aqi: number | null | undefined): 'go' | 'caution' | 'nogo' {
  const value = Number(aqi);
  if (!Number.isFinite(value)) return 'caution';
  if (value <= 50) return 'go';
  if (value <= 100) return 'caution';
  return 'nogo';
}

function parseHourLabelToMinutes(label: string | undefined): number | null {
  if (!label) {
    return null;
  }
  const match = label.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (!match) {
    return null;
  }
  const rawHour = Number(match[1]);
  const rawMinute = Number(match[2] || 0);
  if (!Number.isFinite(rawHour) || rawHour < 1 || rawHour > 12 || !Number.isFinite(rawMinute) || rawMinute < 0 || rawMinute > 59) {
    return null;
  }
  const meridiem = match[3].toUpperCase();
  const hour24 = rawHour % 12 + (meridiem === 'PM' ? 12 : 0);
  return hour24 * 60 + rawMinute;
}

function buildTrendWindowFromStart(trend: WeatherTrendPoint[], _startTime: string, windowSize = 12): WeatherTrendPoint[] {
  if (!Array.isArray(trend) || trend.length === 0) {
    return [];
  }
  // Backend trend is already aligned to the selected start time. Re-slicing by clock labels
  // can mis-handle midnight rollovers and locale-specific hour labels.
  return trend.slice(0, windowSize);
}

function weatherConditionEmoji(description: string | undefined, isDaytime?: boolean | null): string {
  const text = String(description || '').toLowerCase();
  if (/thunder|lightning|storm|hail/.test(text)) return '⛈️';
  if (/snow|blizzard|sleet|wintry|freezing/.test(text)) return '❄️';
  if (/rain|shower|drizzle/.test(text)) return '🌧️';
  if (/fog|smoke|haze|mist/.test(text)) return '🌫️';
  if (/wind|breezy|gust/.test(text)) return '💨';
  if (/overcast|cloud/.test(text)) return '☁️';
  if (/clear|sunny/.test(text)) return isDaytime ? '☀️' : '🌙';
  return '🌤️';
}

function inferWeatherSourceLabel(weather: SafetyData['weather'] | null | undefined): string {
  const primary = String(weather?.sourceDetails?.primary || '').trim();
  if (primary === 'NOAA') return 'NOAA / Weather.gov';
  if (primary === 'Open-Meteo') return 'Open-Meteo';
  if (primary) return primary;

  const link = String(weather?.forecastLink || '').toLowerCase();
  if (link.includes('weather.gov')) return 'NOAA / Weather.gov';
  if (link.includes('open-meteo.com')) return 'Open-Meteo';
  return 'Source not provided';
}

function HelpHint({ text }: { text: string }) {
  return (
    <span className="help-hint" tabIndex={0} role="note" aria-label="More information">
      <Info size={13} />
      <span className="help-tooltip">{text}</span>
    </span>
  );
}

function formatSignedDelta(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) {
    return '0';
  }
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

function formatClockShort(value: string | undefined | null, style: TimeStyle = 'ampm'): string {
  const minutes = parseSolarClockMinutes(value || undefined);
  if (minutes === null) {
    return value || 'N/A';
  }
  if (style === '24h') {
    return minutesToTwentyFourHourClock(minutes);
  }
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${ampm}`;
}

function formatDurationMinutes(value: number | null | undefined): string {
  const total = Number(value);
  if (!Number.isFinite(total)) {
    return 'N/A';
  }
  const rounded = Math.max(0, Math.round(total));
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours <= 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

interface DayOverDayComparison {
  previousDate: string;
  previousScore: number;
  delta: number;
  changes: string[];
}

interface TravelWindowRow {
  time: string;
  pass: boolean;
  reasonSummary: string;
  failedRules: string[];
  failedRuleLabels: string[];
  temp: number;
  feelsLike: number;
  wind: number;
  gust: number;
  precipChance: number;
}

interface TravelWindowSpan {
  start: string;
  end: string;
  length: number;
}

interface TravelWindowInsights {
  passHours: number;
  failHours: number;
  bestWindow: TravelWindowSpan | null;
  nextCleanWindow: TravelWindowSpan | null;
  topFailureLabels: string[];
  summary: string;
}

function buildTravelWindowRows(trend: WeatherTrendPoint[], preferences: UserPreferences): TravelWindowRow[] {
  const maxGust = preferences.maxWindGustMph;
  const maxPrecip = preferences.maxPrecipChance;
  const minFeelsLike = preferences.minFeelsLikeF;

  return trend.map((point) => {
    const gust = Number.isFinite(Number(point.gust)) ? Number(point.gust) : 0;
    const wind = Number.isFinite(Number(point.wind)) ? Number(point.wind) : 0;
    const temp = Number.isFinite(Number(point.temp)) ? Number(point.temp) : 0;
    const feelsLike = computeFeelsLikeF(temp, wind);
    const precipChance = Number.isFinite(Number(point.precipChance)) ? Number(point.precipChance) : 0;
    const failedRules: string[] = [];
    const failedRuleLabels: string[] = [];
    const displayGust = Math.round(convertWindMphToDisplayValue(gust, preferences.windSpeedUnit));
    const displayMaxGust = Math.round(convertWindMphToDisplayValue(maxGust, preferences.windSpeedUnit));
    const displayFeelsLike = formatTemperatureForUnit(feelsLike, preferences.temperatureUnit);
    const displayMinFeelsLike = formatTemperatureForUnit(minFeelsLike, preferences.temperatureUnit);

    if (gust > maxGust) {
      failedRules.push(`gust ${displayGust}>${displayMaxGust} ${preferences.windSpeedUnit}`);
      failedRuleLabels.push('Gust above limit');
    }
    if (precipChance > maxPrecip) {
      failedRules.push(`precip ${Math.round(precipChance)}%>${maxPrecip}%`);
      failedRuleLabels.push('Precip above limit');
    }
    if (feelsLike < minFeelsLike) {
      failedRules.push(`feels ${displayFeelsLike}<${displayMinFeelsLike}`);
      failedRuleLabels.push('Feels-like below limit');
    }

    return {
      time: point.time,
      pass: failedRules.length === 0,
      reasonSummary: failedRules.length === 0 ? 'Meets thresholds' : failedRules.join(' • '),
      failedRules,
      failedRuleLabels,
      temp,
      feelsLike,
      wind,
      gust,
      precipChance,
    };
  });
}

function deriveTravelWindowSpans(rows: TravelWindowRow[]): TravelWindowSpan[] {
  const spans: TravelWindowSpan[] = [];
  let startIndex = -1;

  rows.forEach((row, idx) => {
    if (row.pass && startIndex === -1) {
      startIndex = idx;
    }
    const spanEnded = startIndex !== -1 && (!row.pass || idx === rows.length - 1);
    if (!spanEnded) {
      return;
    }
    const endIndex = row.pass ? idx : idx - 1;
    const length = endIndex - startIndex + 1;
    if (length > 0) {
      spans.push({ start: rows[startIndex].time, end: rows[endIndex].time, length });
    }
    startIndex = -1;
  });

  return spans;
}

function formatTravelWindowSpan(span: TravelWindowSpan, timeStyle: TimeStyle): string {
  const start = formatClockForStyle(span.start, timeStyle);
  const end = formatClockForStyle(span.end, timeStyle);
  if (span.length <= 1) {
    return `${start} only`;
  }
  return `${start} to ${end}`;
}

function buildTravelWindowInsights(rows: TravelWindowRow[], timeStyle: TimeStyle = 'ampm'): TravelWindowInsights {
  if (rows.length === 0) {
    return {
      passHours: 0,
      failHours: 0,
      bestWindow: null,
      nextCleanWindow: null,
      topFailureLabels: [],
      summary: 'No hourly trend data available for travel-window analysis.',
    };
  }

  const passHours = rows.filter((row) => row.pass).length;
  const failHours = rows.length - passHours;
  const spans = deriveTravelWindowSpans(rows);
  const bestWindow =
    spans.length > 0
      ? spans.slice().sort((a, b) => (b.length === a.length ? a.start.localeCompare(b.start) : b.length - a.length))[0]
      : null;
  const nextCleanWindow = spans.length > 0 ? spans[0] : null;

  const failureCounts = new Map<string, number>();
  rows
    .filter((row) => !row.pass)
    .forEach((row) => {
      row.failedRuleLabels.forEach((label) => {
        failureCounts.set(label, (failureCounts.get(label) || 0) + 1);
      });
    });

  const topFailureLabels = Array.from(failureCounts.entries())
    .sort((a, b) => (b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] - a[1]))
    .slice(0, 3)
    .map(([label, count]) => `${label} (${count}h)`);

  if (passHours === 0) {
    return {
      passHours,
      failHours,
      bestWindow,
      nextCleanWindow,
      topFailureLabels,
      summary: `No clean travel window in the next ${rows.length} hours under current thresholds.`,
    };
  }

  if (!bestWindow) {
    return {
      passHours,
      failHours,
      bestWindow,
      nextCleanWindow,
      topFailureLabels,
      summary: `Passing ${passHours}/${rows.length} hours.`,
    };
  }

  const spanLabel = formatTravelWindowSpan(bestWindow, timeStyle);
  const baseSummary = `Passing ${passHours}/${rows.length} hours. Best continuous window: ${spanLabel} (${bestWindow.length}h).`;
  if (nextCleanWindow && nextCleanWindow.start !== rows[0].time) {
    return {
      passHours,
      failHours,
      bestWindow,
      nextCleanWindow,
      topFailureLabels,
      summary: `${baseSummary} First clean hour starts at ${formatClockForStyle(nextCleanWindow.start, timeStyle)}.`,
    };
  }

  return {
    passHours,
    failHours,
    bestWindow,
    nextCleanWindow,
    topFailureLabels,
    summary: baseSummary,
  };
}

function buildDayOverDayChanges(current: SafetyData, previous: SafetyData, preferences: UserPreferences): string[] {
  const changes: string[] = [];
  const currentScore = Number(current?.safety?.score);
  const previousScore = Number(previous?.safety?.score);
  if (Number.isFinite(currentScore) && Number.isFinite(previousScore)) {
    const scoreDelta = currentScore - previousScore;
    if (Math.abs(scoreDelta) >= 1) {
      changes.push(`Safety score ${formatSignedDelta(scoreDelta)} (${Math.round(previousScore)} -> ${Math.round(currentScore)}).`);
    }
  }

  const currentDanger = Number(current?.avalanche?.dangerLevel);
  const previousDanger = Number(previous?.avalanche?.dangerLevel);
  if (Number.isFinite(currentDanger) && Number.isFinite(previousDanger) && currentDanger !== previousDanger) {
    changes.push(`Avalanche danger changed ${formatSignedDelta(currentDanger - previousDanger)} level(s).`);
  }

  const currentGust = Number(current?.weather?.windGust);
  const previousGust = Number(previous?.weather?.windGust);
  if (Number.isFinite(currentGust) && Number.isFinite(previousGust) && Math.abs(currentGust - previousGust) >= 3) {
    changes.push(
      `Wind gust changed ${formatSignedDelta(convertWindMphToDisplayValue(currentGust - previousGust, preferences.windSpeedUnit))} ${preferences.windSpeedUnit}.`,
    );
  }

  const currentFeels = Number(current?.weather?.feelsLike ?? current?.weather?.temp);
  const previousFeels = Number(previous?.weather?.feelsLike ?? previous?.weather?.temp);
  if (Number.isFinite(currentFeels) && Number.isFinite(previousFeels) && Math.abs(currentFeels - previousFeels) >= 3) {
    const feelsDelta = convertTempFToDisplayValue(currentFeels - previousFeels, preferences.temperatureUnit);
    changes.push(`Feels-like changed ${formatSignedDelta(feelsDelta)}°${preferences.temperatureUnit.toUpperCase()}.`);
  }

  const currentPrecip = Number(current?.weather?.precipChance);
  const previousPrecip = Number(previous?.weather?.precipChance);
  if (Number.isFinite(currentPrecip) && Number.isFinite(previousPrecip) && Math.abs(currentPrecip - previousPrecip) >= 10) {
    changes.push(`Precip chance changed ${formatSignedDelta(currentPrecip - previousPrecip)}%.`);
  }

  const currentDesc = String(current?.weather?.description || '').trim();
  const previousDesc = String(previous?.weather?.description || '').trim();
  if (currentDesc && previousDesc && currentDesc.toLowerCase() !== previousDesc.toLowerCase()) {
    changes.push(`Weather changed from "${previousDesc}" to "${currentDesc}".`);
  }

  return changes.slice(0, 6);
}

function sanitizeExternalUrl(rawUrl?: string): string | null {
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

function parseLinkState(todayDate: string, maxForecastDate: string, preferences: UserPreferences): LinkState {
  const defaults: LinkState = {
    view: 'home',
    activity: 'backcountry',
    position: DEFAULT_CENTER,
    hasObjective: false,
    objectiveName: '',
    searchQuery: '',
    forecastDate: todayDate,
    alpineStartTime: preferences.defaultStartTime,
    turnaroundTime: preferences.defaultBackByTime,
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
  const viewParam = params.get('view');
  const hasExplicitSettingsView = viewParam === 'settings';
  const hasExplicitStatusView = viewParam === 'status';

  return {
    view: hasExplicitSettingsView ? 'settings' : hasExplicitStatusView ? 'status' : viewParam === 'planner' || hasCoords ? 'planner' : 'home',
    activity: 'backcountry',
    position: hasCoords ? new L.LatLng(lat, lon) : DEFAULT_CENTER,
    hasObjective: hasCoords,
    objectiveName,
    searchQuery,
    forecastDate: normalizeForecastDate(params.get('date'), todayDate, maxForecastDate),
    alpineStartTime: normalizeTimeOrFallback(params.get('start'), preferences.defaultStartTime),
    turnaroundTime: normalizeTimeOrFallback(params.get('turn'), preferences.defaultBackByTime),
    targetElevationInput: normalizeElevationInput(params.get('elev')),
  };
}

function buildShareQuery(state: {
  view: 'home' | 'planner' | 'settings' | 'status';
  hasObjective: boolean;
  position: L.LatLng;
  objectiveName: string;
  searchQuery: string;
  forecastDate: string;
  alpineStartTime: string;
  targetElevationInput: string;
}): string {
  const params = new URLSearchParams();

  if (state.view === 'planner') {
    params.set('view', 'planner');
  } else if (state.view === 'settings') {
    params.set('view', 'settings');
  } else if (state.view === 'status') {
    params.set('view', 'status');
  }

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

function buildSafetyRequestKey(lat: number, lon: number, date: string, startTime: string, travelWindowHours: number): string {
  return `${lat.toFixed(5)},${lon.toFixed(5)}@${date}@${startTime}@w${travelWindowHours}`;
}

function evaluateBackcountryDecision(data: SafetyData, cutoffTime: string, preferences: UserPreferences): SummitDecision {
  const blockers: string[] = [];
  const cautions: string[] = [];
  const addBlocker = (message: string) => {
    if (!blockers.includes(message)) {
      blockers.push(message);
    }
  };
  const addCaution = (message: string) => {
    if (!cautions.includes(message)) {
      cautions.push(message);
    }
  };

  const danger = data.avalanche.dangerLevel || 0;
  const gust = data.weather.windGust || 0;
  const precip = data.weather.precipChance || 0;
  const score = data.safety.score || 0;
  const feelsLike = data.weather.feelsLike ?? data.weather.temp;
  const description = data.weather.description || '';
  const normalizedConditionText = String(description || '').trim() || 'No forecast condition text available.';
  const hasStormSignal = /thunder|storm|lightning|hail|blizzard/i.test(description);
  const avalancheRelevant = data.avalanche.relevant !== false;
  const avalancheUnknown = avalancheRelevant && Boolean(data.avalanche.dangerUnknown || data.avalanche.coverageStatus !== 'reported');
  const avalancheGateRequired = avalancheRelevant;
  const unknownSnowpackMode = avalancheGateRequired && avalancheUnknown;
  const avalancheCheckLabel = (safeDangerLabel: string): string => {
    if (!avalancheRelevant) {
      return 'Avalanche check not required for this location profile';
    }
    if (avalancheUnknown) {
      return 'Avalanche forecast coverage is unavailable for this location';
    }
    return `Avalanche danger is ${safeDangerLabel}`;
  };
  const maxGustThreshold = Math.max(10, preferences.maxWindGustMph);
  const maxPrecipThreshold = Math.max(0, preferences.maxPrecipChance);
  const minFeelsLikeThreshold = preferences.minFeelsLikeF;
  const windUnit = preferences.windSpeedUnit;
  const tempUnit = preferences.temperatureUnit;
  const formatWind = (valueMph: number) => formatWindForUnit(valueMph, windUnit);
  const formatTemp = (valueF: number) => formatTemperatureForUnit(valueF, tempUnit);
  const displayMaxGustThreshold = formatWind(maxGustThreshold);
  const displayMinFeelsLikeThreshold = formatTemp(minFeelsLikeThreshold);
  const alertSeverityRank = (severity: string | undefined | null): number => {
    const normalized = String(severity || '').trim().toLowerCase();
    if (!normalized) return 1;
    if (['extreme', 'severe'].includes(normalized)) return 5;
    if (normalized === 'warning') return 4;
    if (['advisory', 'watch'].includes(normalized)) return 3;
    if (normalized === 'moderate') return 2;
    return 1;
  };

  const alertsStatus = String(data.alerts?.status || '').toLowerCase();
  const alertsRelevantForSelectedStart = true;
  const alertsNoActiveForSelectedStart = alertsStatus === 'none' || alertsStatus === 'none_for_selected_start';
  const selectedTravelWindowMs = resolveSelectedTravelWindowMs(data, preferences.travelWindowHours);
  const alertsWindowCovered = isTravelWindowCoveredByAlertWindow(selectedTravelWindowMs, data.alerts?.alerts || []);
  const activeAlertCount = Number(data.alerts?.activeCount);
  const hasActiveAlertCount = Number.isFinite(activeAlertCount);
  const highestAlertSeverity = String(data.alerts?.highestSeverity || 'Unknown');
  const highestAlertSeverityRank = alertSeverityRank(highestAlertSeverity);

  const airQualityStatus = String(data.airQuality?.status || '').toLowerCase();
  const aqi = Number(data.airQuality?.usAqi);
  const hasAqi = Number.isFinite(aqi) && airQualityStatus !== 'unavailable';

  const fireRiskStatus = String(data.fireRisk?.status || '').toLowerCase();
  const fireRiskLevel = Number(data.fireRisk?.level);
  const hasFireRisk = Number.isFinite(fireRiskLevel) && fireRiskStatus !== 'unavailable';

  const heatRiskStatus = String(data.heatRisk?.status || '').toLowerCase();
  const heatRiskLevel = Number(data.heatRisk?.level);
  const hasHeatRisk = Number.isFinite(heatRiskLevel) && heatRiskStatus !== 'unavailable';

  const terrainCode = String(data.terrainCondition?.code || '').toLowerCase();
  const terrainLabel = data.terrainCondition?.label || data.trail || 'Unknown';
  const terrainConfidence = String(data.terrainCondition?.confidence || '').toLowerCase();
  const terrainNeedsAttention = ['snow_ice', 'wet_muddy', 'cold_slick', 'dry_loose'].includes(terrainCode);
  const terrainCriticalGateFail = terrainCode === 'weather_unavailable';

  const weatherFreshnessState = freshnessClass(
    pickOldestIsoTimestamp([
      data.weather.issuedTime || null,
      data.weather.forecastStartTime || null,
    ]),
    12,
  );
  const avalancheFreshnessState = avalancheRelevant
    ? freshnessClass(pickOldestIsoTimestamp([data.avalanche.publishedTime || null]), 24)
    : null;
  const alertsFreshnessState = alertsRelevantForSelectedStart
    ? alertsNoActiveForSelectedStart || alertsWindowCovered
      ? 'fresh'
      : freshnessClass(
          pickNewestIsoTimestamp(
            (data.alerts?.alerts || []).flatMap((alert) => [alert.sent || null, alert.effective || null, alert.onset || null]),
          ),
          6,
        )
    : null;
  const airQualityFreshnessState = hasAqi ? freshnessClass(pickOldestIsoTimestamp([data.airQuality?.measuredTime || null]), 8) : null;
  const precipitationFreshnessState = freshnessClass(
    pickOldestIsoTimestamp([data.rainfall?.anchorTime || null, data.rainfall?.issuedTime || null]),
    8,
  );
  const snowpackStatus = String(data.snowpack?.status || '').toLowerCase();
  const snowpackAvailable = snowpackStatus === 'ok' || snowpackStatus === 'partial';
  const snowpackFreshness = classifySnowpackFreshness(data.snowpack?.snotel?.observedDate || null, data.snowpack?.nohrsc?.sampledTime || null);
  const snowpackFreshnessState = snowpackAvailable
    ? snowpackFreshness.state
    : null;
  const freshnessIssues = [
    weatherFreshnessState === 'stale' || weatherFreshnessState === 'missing' ? 'weather' : null,
    avalancheFreshnessState === 'stale' || avalancheFreshnessState === 'missing' ? 'avalanche' : null,
    alertsFreshnessState === 'stale' || alertsFreshnessState === 'missing' ? 'alerts' : null,
    airQualityFreshnessState === 'stale' || airQualityFreshnessState === 'missing' ? 'air quality' : null,
    precipitationFreshnessState === 'stale' || precipitationFreshnessState === 'missing' ? 'precipitation' : null,
    snowpackFreshnessState === 'stale' || snowpackFreshnessState === 'missing' ? 'snowpack' : null,
  ].filter(Boolean) as string[];

  if (unknownSnowpackMode) {
    addCaution(
      'Avalanche forecast coverage is unavailable for this location. Do not treat this as low risk; keep terrain conservative and avoid avalanche features.',
    );
    addCaution('Limited avalanche coverage: use low-angle terrain, avoid terrain traps, and increase spacing/communication.');
  }

  if (avalancheGateRequired && !avalancheUnknown && danger >= 4) {
    addBlocker('Avalanche danger is High/Extreme. Avoid avalanche terrain.');
  } else if (avalancheGateRequired && !avalancheUnknown && danger === 3) {
    addCaution('Avalanche danger is Considerable. Conservative terrain choices are required.');
  }
  if (hasStormSignal) {
    addCaution('Storm or thunder signal in forecast. Avoid exposed terrain and keep fallback options ready.');
  }
  if (precip >= Math.max(85, maxPrecipThreshold + 25)) {
    addBlocker(`Precipitation chance at ${precip}% is too high for stable travel conditions.`);
  } else if (precip >= Math.max(55, maxPrecipThreshold)) {
    addCaution(`Precipitation chance at ${precip}% can create slick surfaces and slower travel.`);
  }
  if (gust >= Math.max(42, maxGustThreshold + 10)) {
    addBlocker(`Wind gusts around ${formatWind(gust)} exceed conservative backcountry thresholds.`);
  } else if (gust >= maxGustThreshold) {
    addCaution(`Wind gusts near ${formatWind(gust)} can affect exposed movement and stability.`);
  }
  if (score < 42) {
    addBlocker(`Overall safety score is low at ${score}%.`);
  } else if (score < 68) {
    addCaution(`Safety score at ${score}% suggests tightening route controls.`);
  }
  if (feelsLike >= 95) {
    addBlocker(`Apparent temperature near ${formatTemp(feelsLike)} has high heat-stress risk.`);
  } else if (feelsLike <= minFeelsLikeThreshold) {
    addCaution(`Apparent temperature near ${formatTemp(feelsLike)} increases cold-exposure risk.`);
  }

  if (alertsRelevantForSelectedStart && hasActiveAlertCount && activeAlertCount > 0) {
    if (highestAlertSeverityRank >= 4) {
      addBlocker(`${activeAlertCount} active NWS alert(s) include high-severity products (${highestAlertSeverity}).`);
    } else {
      addCaution(`${activeAlertCount} active NWS alert(s) are in effect at selected start time.`);
    }
  }

  if (hasAqi) {
    if (aqi >= 151) {
      addBlocker(`Air quality is unhealthy/hazardous (AQI ${Math.round(aqi)}).`);
    } else if (aqi >= 101) {
      addCaution(`Air quality is unhealthy for sensitive groups (AQI ${Math.round(aqi)}).`);
    } else if (aqi >= 51) {
      addCaution(`Air quality is moderate (AQI ${Math.round(aqi)}).`);
    }
  }

  if (hasFireRisk) {
    if (fireRiskLevel >= 4) {
      addBlocker(`Fire danger is extreme (${data.fireRisk?.label || `L${Math.round(fireRiskLevel)}`}).`);
    } else if (fireRiskLevel >= 3) {
      addCaution(`Fire danger is high (${data.fireRisk?.label || `L${Math.round(fireRiskLevel)}`}).`);
    } else if (fireRiskLevel >= 2) {
      addCaution(`Fire danger is elevated (${data.fireRisk?.label || `L${Math.round(fireRiskLevel)}`}).`);
    }
  }

  if (hasHeatRisk) {
    if (heatRiskLevel >= 4) {
      addBlocker(`Heat risk is extreme (${data.heatRisk?.label || `L${Math.round(heatRiskLevel)}`}).`);
    } else if (heatRiskLevel >= 3) {
      addCaution(`Heat risk is high (${data.heatRisk?.label || `L${Math.round(heatRiskLevel)}`}).`);
    } else if (heatRiskLevel >= 2) {
      addCaution(`Heat risk is elevated (${data.heatRisk?.label || `L${Math.round(heatRiskLevel)}`}).`);
    }
  }

  if (terrainNeedsAttention) {
    addCaution(`Terrain/trail condition needs attention (${terrainLabel}).`);
  }

  if (freshnessIssues.length > 0) {
    addCaution(`Some feeds are stale or missing timestamps (${freshnessIssues.join(', ')}). Re-verify before committing.`);
  }

  const cutoffMinutes = parseTimeInputMinutes(cutoffTime);
  const sunsetMinutes = parseSolarClockMinutes(data.solar.sunset);
  const daylightBuffer = 30;
  const hasDaylightInputs = cutoffMinutes !== null && sunsetMinutes !== null;
  const daylightOkay = hasDaylightInputs ? cutoffMinutes <= sunsetMinutes - daylightBuffer : false;
  const daylightMarginMinutes = hasDaylightInputs ? sunsetMinutes - cutoffMinutes : null;
  if (!hasDaylightInputs) {
    addCaution('Daylight timing data is unavailable. Confirm sunset timing from official sources before committing.');
  } else if (!daylightOkay) {
    addCaution(`Daylight margin is too thin for this plan. Keep at least a ${daylightBuffer}-minute buffer before sunset.`);
  }

  const checks: SummitDecision['checks'] = [
    {
      key: 'avalanche',
      label: avalancheGateRequired ? 'Avalanche danger is Moderate or lower' : avalancheCheckLabel('Moderate or lower'),
      ok: avalancheGateRequired ? (!avalancheUnknown && danger <= 2) : true,
      detail: !avalancheRelevant
        ? 'Not required by current seasonal and snowpack profile.'
        : avalancheUnknown
          ? 'Coverage unavailable for this objective/time.'
          : `Current danger level ${normalizeDangerLevel(danger)}.`,
      action:
        avalancheGateRequired && avalancheUnknown
          ? 'Use conservative, low-consequence terrain until a current bulletin is available.'
          : avalancheGateRequired && danger > 2
            ? 'Choose lower-angle terrain or delay until hazard rating drops.'
            : undefined,
    },
    {
      key: 'convective-signal',
      label: 'No convective storm signal (thunder/lightning/hail)',
      ok: !hasStormSignal,
      detail: hasStormSignal
        ? `Convective risk keywords detected in forecast text: ${normalizedConditionText}.`
        : `Forecast text: ${normalizedConditionText}. No convective keywords detected.`,
      action: hasStormSignal ? 'Avoid exposed ridgelines and move to lower-consequence terrain windows.' : undefined,
    },
    {
      key: 'precipitation',
      label: `Precipitation chance is under ${maxPrecipThreshold}%`,
      ok: precip < maxPrecipThreshold,
      detail: `Now ${precip}% (limit ${maxPrecipThreshold}%).`,
      action: precip >= maxPrecipThreshold ? 'Expect slower travel and reduced traction; tighten route and timing.' : undefined,
    },
    {
      key: 'wind-gust',
      label: `Wind gusts are under ${displayMaxGustThreshold}`,
      ok: gust < maxGustThreshold,
      detail: `Now ${formatWind(gust)} (limit ${displayMaxGustThreshold}).`,
      action: gust >= maxGustThreshold ? 'Reduce ridge exposure and shorten high-wind segments.' : undefined,
    },
    {
      key: 'daylight',
      label: 'Start time is at least 30 min before sunset',
      ok: daylightOkay,
      detail: hasDaylightInputs
        ? `${cutoffTime} start • ${data.solar.sunset} sunset • ${
            daylightMarginMinutes === null
              ? 'margin unavailable'
              : daylightMarginMinutes < 0
                ? `${Math.abs(daylightMarginMinutes)} min after sunset`
                : `${daylightMarginMinutes} min margin`
          }`
        : 'Start or sunset time unavailable.',
      action:
        hasDaylightInputs && !daylightOkay
          ? 'Move start earlier or shorten the plan to preserve at least 30 minutes of daylight margin.'
          : undefined,
    },
    {
      key: 'feels-like',
      label: `Apparent temperature is above ${displayMinFeelsLikeThreshold}`,
      ok: feelsLike > minFeelsLikeThreshold,
      detail: `Now ${formatTemp(feelsLike)} (limit ${displayMinFeelsLikeThreshold}).`,
      action: feelsLike <= minFeelsLikeThreshold ? 'Increase insulation/warmth margin or reduce exposure duration.' : undefined,
    },
  ];

  if (alertsRelevantForSelectedStart && hasActiveAlertCount) {
    checks.push({
      key: 'nws-alerts',
      label: 'No active NWS alerts at selected start time',
      ok: activeAlertCount === 0,
      detail:
        activeAlertCount === 0
          ? 'No active alerts.'
          : `${activeAlertCount} active • highest severity ${highestAlertSeverity}.`,
      action: activeAlertCount > 0 ? 'Open alert details and verify your route is outside affected zones/time windows.' : undefined,
    });
  }

  if (hasAqi) {
    checks.push({
      key: 'air-quality',
      label: 'Air quality is <= 100 AQI',
      ok: aqi <= 100,
      detail: `Current AQI ${Math.round(aqi)} (${data.airQuality?.category || 'Unknown'}).`,
      action: aqi > 100 ? 'Reduce exertion, carry respiratory protection, or pick a cleaner-air objective.' : undefined,
    });
  }

  if (hasFireRisk) {
    checks.push({
      key: 'fire-risk',
      label: 'Fire risk is below High (L3+)',
      ok: fireRiskLevel < 3,
      detail: `${data.fireRisk?.label || 'Unknown'} (${Number.isFinite(fireRiskLevel) ? `L${Math.round(fireRiskLevel)}` : 'L?'})`,
      action: fireRiskLevel >= 3 ? 'Avoid fire-restricted areas and plan low-spark/no-flame operations.' : undefined,
    });
  }

  if (hasHeatRisk) {
    checks.push({
      key: 'heat-risk',
      label: 'Heat risk is below High (L3+)',
      ok: heatRiskLevel < 3,
      detail: `${data.heatRisk?.label || 'Unknown'} (${Number.isFinite(heatRiskLevel) ? `L${Math.round(heatRiskLevel)}` : 'L?'})`,
      action: heatRiskLevel >= 3 ? 'Shift to cooler hours/elevations and increase hydration/cooling controls.' : undefined,
    });
  }

  if (terrainCode) {
    checks.push({
      key: 'terrain-signal',
      label: 'Terrain / trail surface signal is available',
      ok: !terrainCriticalGateFail,
      detail: terrainCriticalGateFail
        ? 'Surface/trail classification unavailable from current weather inputs.'
        : terrainConfidence
          ? `${terrainLabel} • confidence ${terrainConfidence} • use as advisory context, not a hard gate.`
          : `${terrainLabel} • use as advisory context, not a hard gate.`,
      action: terrainCriticalGateFail ? 'Use field observations for traction/surface risk since model signal is unavailable.' : undefined,
    });
  }

  checks.push({
    key: 'source-freshness',
    label: 'Core source freshness has no stale/missing feeds',
    ok: freshnessIssues.length === 0,
    detail: freshnessIssues.length === 0 ? 'Timestamps are current enough for active feeds.' : `Issue: ${freshnessIssues.join(', ')}.`,
    action: freshnessIssues.length > 0 ? 'Refresh and verify upstream official products before committing.' : undefined,
  });

  let level: DecisionLevel = 'GO';
  let headline = 'Proceed with conservative backcountry travel controls.';

  if (blockers.length > 0) {
    level = 'NO-GO';
    headline = 'High-likelihood failure modes detected. Delay or change objective.';
  } else if (unknownSnowpackMode) {
    level = 'CAUTION';
    headline = 'Limited avalanche coverage. Favor conservative terrain and explicit abort triggers.';
  } else if (cautions.length > 0 || score < 80) {
    level = 'CAUTION';
    headline = 'Conditions are workable with conservative timing and route choices.';
  }

  return { level, headline, blockers, cautions, checks };
}

function LocationMarker({ position, setPosition }: { position: L.LatLng; setPosition: (p: L.LatLng) => void }) {
  const markerRef = useRef<L.Marker>(null);

  const eventHandlers = React.useMemo(
    () => ({
      dragend() {
        if (markerRef.current) {
          setPosition(markerRef.current.getLatLng());
        }
      },
    }),
    [setPosition],
  );

  useMapEvents({
    click(e) {
      setPosition(e.latlng);
    },
  });

  return <Marker draggable={true} eventHandlers={eventHandlers} position={position} ref={markerRef} />;
}

function MapUpdater({ position, zoom, focusKey }: { position: L.LatLng; zoom: number; focusKey: number }) {
  const map = useMap();

  useEffect(() => {
    map.flyTo(position, zoom, { animate: true, duration: 1.05 });
    setTimeout(() => map.invalidateSize(), 400);
  }, [position, zoom, focusKey, map]);

  return null;
}

function AppDisclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <aside className={`app-disclaimer ${compact ? 'compact' : ''}`} role="note" aria-label="Safety disclaimer">
      <div className="app-disclaimer-title">
        <AlertTriangle size={14} /> Disclaimer
      </div>
      <p>{APP_DISCLAIMER_TEXT}</p>
    </aside>
  );
}

function App() {
  const isProductionBuild = import.meta.env.PROD;
  const todayDate = formatDateInput(new Date());
  const maxForecastDate = formatDateInput(new Date(Date.now() + 1000 * 60 * 60 * 24 * 7));
  const initialPreferences = React.useMemo(() => loadUserPreferences(), []);
  const initialLinkState = React.useMemo(() => parseLinkState(todayDate, maxForecastDate, initialPreferences), [todayDate, maxForecastDate, initialPreferences]);

  const [view, setView] = useState<'home' | 'planner' | 'settings' | 'status'>(initialLinkState.view);
  const [preferences, setPreferences] = useState<UserPreferences>(initialPreferences);
  const activity: ActivityType = 'backcountry';
  const [position, setPosition] = useState<L.LatLng>(initialLinkState.position);
  const [hasObjective, setHasObjective] = useState(initialLinkState.hasObjective);
  const [objectiveName, setObjectiveName] = useState(initialLinkState.objectiveName);

  const [safetyData, setSafetyData] = useState<SafetyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState(initialLinkState.searchQuery);
  const [committedSearchQuery, setCommittedSearchQuery] = useState(initialLinkState.searchQuery);
  const [forecastDate, setForecastDate] = useState(initialLinkState.forecastDate);
  const [alpineStartTime, setAlpineStartTime] = useState(initialLinkState.alpineStartTime);
  const [turnaroundTime, setTurnaroundTime] = useState(initialLinkState.turnaroundTime);
  const [isViewPending, startViewChange] = useTransition();
  const [targetElevationInput, setTargetElevationInput] = useState(initialLinkState.targetElevationInput);
  const [targetElevationManual, setTargetElevationManual] = useState(Boolean(initialLinkState.targetElevationInput));
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedRawPayload, setCopiedRawPayload] = useState(false);
  const [copiedSatLine, setCopiedSatLine] = useState(false);
  const [copiedTeamBrief, setCopiedTeamBrief] = useState(false);
  const [dayOverDay, setDayOverDay] = useState<DayOverDayComparison | null>(null);
  const [healthChecks, setHealthChecks] = useState<HealthCheckResult[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthCheckedAt, setHealthCheckedAt] = useState<string | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [travelWindowExpanded, setTravelWindowExpanded] = useState(false);
  const [travelThresholdEditorOpen, setTravelThresholdEditorOpen] = useState(false);
  const [travelWindowHoursDraft, setTravelWindowHoursDraft] = useState(() => String(initialPreferences.travelWindowHours));
  const [maxPrecipChanceDraft, setMaxPrecipChanceDraft] = useState(() => String(initialPreferences.maxPrecipChance));
  const [maxWindGustDraft, setMaxWindGustDraft] = useState(() =>
    convertWindMphToDisplayValue(initialPreferences.maxWindGustMph, initialPreferences.windSpeedUnit).toFixed(
      initialPreferences.windSpeedUnit === 'kph' ? 1 : 0,
    ),
  );
  const [minFeelsLikeDraft, setMinFeelsLikeDraft] = useState(() =>
    convertTempFToDisplayValue(initialPreferences.minFeelsLikeF, initialPreferences.temperatureUnit).toFixed(
      initialPreferences.temperatureUnit === 'c' ? 1 : 0,
    ),
  );
  const [mapStyle, setMapStyle] = useState<MapStyle>('topo');
  const [mapFocusNonce, setMapFocusNonce] = useState(0);
  const [locatingUser, setLocatingUser] = useState(false);
  const lastLoadedSafetyKeyRef = useRef<string | null>(null);
  const inFlightSafetyKeyRef = useRef<string | null>(null);
  const pendingSafetyRequestRef = useRef<{
    lat: number;
    lon: number;
    date: string;
    startTime: string;
    force: boolean;
  } | null>(null);
  const fetchSafetyDataRef = useRef<
    ((lat: number, lon: number, date: string, startTime: string, options?: { force?: boolean }) => Promise<void>) | null
  >(null);
  const wakeRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeRetryStateRef = useRef<{
    key: string;
    lat: number;
    lon: number;
    date: string;
    startTime: string;
    attempts: number;
  } | null>(null);

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showBackendWakeNotice, setShowBackendWakeNotice] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const searchWrapperRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const latestSuggestionRequestId = useRef(0);
  const suggestionCacheRef = useRef<Map<string, Suggestion[]>>(new Map());
  const suggestionAbortControllerRef = useRef<AbortController | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rawCopyResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const satCopyResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const teamBriefCopyResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backendWakeNoticeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeBasemap = MAP_STYLE_OPTIONS[mapStyle];

  const clearWakeRetry = useCallback(() => {
    if (wakeRetryTimeoutRef.current) {
      clearTimeout(wakeRetryTimeoutRef.current);
      wakeRetryTimeoutRef.current = null;
    }
    wakeRetryStateRef.current = null;
  }, []);

  const isRetriableWakeupError = useCallback((message: string) => {
    const normalized = String(message || '').toLowerCase();
    if (!normalized) {
      return false;
    }
    return (
      normalized.includes('failed to fetch') ||
      normalized.includes('networkerror') ||
      normalized.includes('network request failed') ||
      normalized.includes('timeout') ||
      /\(\s*5\d\d\s*\)/.test(normalized) ||
      normalized.includes('unable to reach backend api')
    );
  }, []);

  const scheduleWakeRetry = useCallback((payload: { key: string; lat: number; lon: number; date: string; startTime: string }) => {
    if (!isProductionBuild) {
      return;
    }

    const existing = wakeRetryStateRef.current;
    const attempts = existing && existing.key === payload.key ? existing.attempts + 1 : 1;
    if (attempts > BACKEND_WAKE_RETRY_MAX_ATTEMPTS) {
      clearWakeRetry();
      return;
    }

    wakeRetryStateRef.current = { ...payload, attempts };
    if (wakeRetryTimeoutRef.current) {
      clearTimeout(wakeRetryTimeoutRef.current);
      wakeRetryTimeoutRef.current = null;
    }

    wakeRetryTimeoutRef.current = setTimeout(async () => {
      const state = wakeRetryStateRef.current;
      if (!state || state.key !== payload.key) {
        return;
      }

      let backendHealthy = false;
      try {
        const { response, payload: healthPayload } = await fetchApi('/api/healthz');
        backendHealthy = response.ok && Boolean((healthPayload as { ok?: boolean } | null)?.ok);
      } catch {
        backendHealthy = false;
      }

      if (backendHealthy) {
        clearWakeRetry();
        const fetchFn = fetchSafetyDataRef.current;
        if (fetchFn) {
          void fetchFn(state.lat, state.lon, state.date, state.startTime, { force: true });
        }
        return;
      }

      scheduleWakeRetry(payload);
    }, BACKEND_WAKE_RETRY_DELAY_MS);
  }, [clearWakeRetry, isProductionBuild]);

  const updateObjectivePosition = useCallback((nextPosition: L.LatLng, label?: string) => {
    clearWakeRetry();
    setPosition(nextPosition);
    setMapFocusNonce((prev) => prev + 1);
    setHasObjective(true);
    setTravelWindowExpanded(false);
    setSafetyData(null);
    setDayOverDay(null);
    setError(null);
    setTargetElevationInput('');
    setTargetElevationManual(false);
    if (label) {
      setObjectiveName(label);
    } else {
      setObjectiveName((prev) => prev || 'Dropped pin');
    }
  }, [clearWakeRetry]);

  const fetchSafetyData = useCallback(
    async (lat: number, lon: number, date: string, startTime: string, options?: { force?: boolean }) => {
      const safeDate = DATE_FMT.test(date) ? date : todayDate;
      const safeStartTime = parseTimeInputMinutes(startTime) === null ? preferences.defaultStartTime : startTime;
      const safeTravelWindowHours = Math.max(
        MIN_TRAVEL_WINDOW_HOURS,
        Math.min(MAX_TRAVEL_WINDOW_HOURS, Math.round(Number(preferences.travelWindowHours) || 12)),
      );
      const requestKey = buildSafetyRequestKey(lat, lon, safeDate, safeStartTime, safeTravelWindowHours);
      const forceReload = options?.force === true;

      if (wakeRetryStateRef.current?.key && wakeRetryStateRef.current.key !== requestKey) {
        clearWakeRetry();
      }

      if (!forceReload && lastLoadedSafetyKeyRef.current === requestKey) {
        return;
      }
      if (inFlightSafetyKeyRef.current) {
        pendingSafetyRequestRef.current = {
          lat,
          lon,
          date: safeDate,
          startTime: safeStartTime,
          force: forceReload,
        };
        return;
      }
      if (!forceReload && inFlightSafetyKeyRef.current === requestKey) {
        return;
      }

      setLoading(true);
      setError(null);
      inFlightSafetyKeyRef.current = requestKey;

      try {
        const { response, payload, requestId } = await fetchApi(
          `/api/safety?lat=${lat}&lon=${lon}&date=${encodeURIComponent(safeDate)}&start=${encodeURIComponent(
            safeStartTime,
          )}&travel_window_hours=${safeTravelWindowHours}`,
        );

        if (!response.ok) {
          const baseMessage = readApiErrorMessage(payload, `Safety API request failed (${response.status})`);
          throw new Error(requestId ? `${baseMessage} (request ${requestId})` : baseMessage);
        }

        if (!payload || typeof payload !== 'object') {
          const emptyResponseMsg = 'Safety API returned an empty or invalid response.';
          throw new Error(requestId ? `${emptyResponseMsg} (request ${requestId})` : emptyResponseMsg);
        }

        setSafetyData(payload as SafetyData);
        lastLoadedSafetyKeyRef.current = requestKey;
        if (wakeRetryStateRef.current?.key === requestKey) {
          clearWakeRetry();
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'System error';
        setError(message);
        if (isRetriableWakeupError(message)) {
          scheduleWakeRetry({ key: requestKey, lat, lon, date: safeDate, startTime: safeStartTime });
        }
      } finally {
        inFlightSafetyKeyRef.current = null;
        setLoading(false);
        const pending = pendingSafetyRequestRef.current;
        pendingSafetyRequestRef.current = null;
        if (pending) {
          const nextFetch = fetchSafetyDataRef.current;
          if (nextFetch) {
            void nextFetch(pending.lat, pending.lon, pending.date, pending.startTime, { force: pending.force });
          }
        }
      }
    },
    [todayDate, preferences.defaultStartTime, preferences.travelWindowHours, isRetriableWakeupError, scheduleWakeRetry, clearWakeRetry],
  );

  useEffect(() => {
    fetchSafetyDataRef.current = fetchSafetyData;
  }, [fetchSafetyData]);

  const runHealthChecks = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const { response, payload, requestId } = await fetchApi('/api/healthz');
      if (!response.ok || !payload || typeof payload !== 'object') {
        const baseMessage = readApiErrorMessage(payload, `Health check failed (${response.status})`);
        throw new Error(requestId ? `${baseMessage} (request ${requestId})` : baseMessage);
      }

      const backendOk = Boolean((payload as { ok?: boolean }).ok);
      const backendService = String((payload as { service?: string }).service || 'summitsafe-backend');
      const backendEnv = String((payload as { env?: string }).env || 'unknown');
      const nowIso = new Date().toISOString();
      const localStorageAvailable = (() => {
        try {
          if (typeof window === 'undefined' || !window.localStorage) {
            return false;
          }
          const probeKey = '__summitsafe_health_probe__';
          window.localStorage.setItem(probeKey, '1');
          window.localStorage.removeItem(probeKey);
          return true;
        } catch {
          return false;
        }
      })();

      const checks: HealthCheckResult[] = [
        {
          label: 'Backend API',
          status: backendOk ? 'ok' : 'down',
          detail: backendOk ? `${backendService} responded healthy (${backendEnv}).` : 'Backend health endpoint returned not-ok.',
        },
        {
          label: 'Browser Network',
          status: typeof navigator !== 'undefined' && navigator.onLine ? 'ok' : 'warn',
          detail: typeof navigator !== 'undefined' && navigator.onLine ? 'Browser reports online.' : 'Browser reports offline mode.',
        },
        {
          label: 'Browser Storage',
          status: localStorageAvailable ? 'ok' : 'warn',
          detail: localStorageAvailable ? 'Local preferences storage is available.' : 'Local storage unavailable (private mode/policy).',
        },
      ];

      setHealthChecks(checks);
      setHealthCheckedAt(nowIso);
    } catch (error) {
      setHealthChecks([]);
      setHealthError(error instanceof Error ? error.message : 'Health check failed.');
      setHealthCheckedAt(new Date().toISOString());
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      clearWakeRetry();
    };
  }, [clearWakeRetry]);

  useEffect(() => {
    if (backendWakeNoticeTimeout.current) {
      clearTimeout(backendWakeNoticeTimeout.current);
      backendWakeNoticeTimeout.current = null;
    }

    if (!isProductionBuild || !loading) {
      setShowBackendWakeNotice(false);
      return;
    }

    setShowBackendWakeNotice(false);
    backendWakeNoticeTimeout.current = setTimeout(() => {
      setShowBackendWakeNotice(true);
      backendWakeNoticeTimeout.current = null;
    }, BACKEND_WAKE_NOTICE_DELAY_MS);

    return () => {
      if (backendWakeNoticeTimeout.current) {
        clearTimeout(backendWakeNoticeTimeout.current);
        backendWakeNoticeTimeout.current = null;
      }
    };
  }, [isProductionBuild, loading]);

  useEffect(() => {
    if (!hasObjective || view !== 'planner') {
      return;
    }

    fetchSafetyData(position.lat, position.lng, forecastDate, alpineStartTime);
  }, [position, forecastDate, alpineStartTime, hasObjective, view, fetchSafetyData]);

  useEffect(() => {
    if (!hasObjective || !safetyData) {
      return;
    }
    if (targetElevationManual) {
      return;
    }
    const objectiveElevation = Number(safetyData.weather.elevation);
    if (!Number.isFinite(objectiveElevation) || objectiveElevation <= 0) {
      return;
    }
    const objectiveElevationDisplay = convertElevationFeetToDisplayValue(objectiveElevation, preferences.elevationUnit);
    const next = String(Math.round(objectiveElevationDisplay));
    if (targetElevationInput !== next) {
      setTargetElevationInput(next);
    }
  }, [hasObjective, safetyData, targetElevationInput, targetElevationManual, preferences.elevationUnit]);

  useEffect(() => {
    if (view === 'home') {
      document.title = 'Backcountry Conditions';
      return;
    }

    if (view === 'settings') {
      document.title = 'Settings - Backcountry Conditions';
      return;
    }

    if (view === 'status') {
      document.title = 'Status - Backcountry Conditions';
      return;
    }

    if (objectiveName) {
      document.title = `${objectiveName} plan - Backcountry Conditions`;
    } else if (committedSearchQuery) {
      document.title = `${committedSearchQuery.split(',')[0]} - Backcountry Conditions`;
    } else {
      document.title = 'Backcountry Conditions Planner';
    }
  }, [view, objectiveName, committedSearchQuery]);

  useEffect(() => {
    if (view !== 'status') {
      return;
    }
    void runHealthChecks();
  }, [view, runHealthChecks]);

  useEffect(() => {
    const hasSharableState = view === 'planner' || hasObjective || committedSearchQuery.trim();
    const query = hasSharableState
      ? buildShareQuery({
          view,
          hasObjective,
          position,
          objectiveName,
          searchQuery: committedSearchQuery,
          forecastDate,
          alpineStartTime,
          targetElevationInput,
        })
      : '';

    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState(null, '', nextUrl);
    }
  }, [view, hasObjective, position, objectiveName, committedSearchQuery, forecastDate, alpineStartTime, targetElevationInput]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const resolvedTheme: 'light' | 'dark' = preferences.themeMode === 'system' ? (mediaQuery.matches ? 'dark' : 'light') : preferences.themeMode;
      document.documentElement.setAttribute('data-theme', resolvedTheme);
    };

    applyTheme();
    mediaQuery.addEventListener('change', applyTheme);
    return () => {
      mediaQuery.removeEventListener('change', applyTheme);
    };
  }, [preferences.themeMode]);

  useEffect(() => {
    return () => {
      latestSuggestionRequestId.current += 1;
      if (suggestionAbortControllerRef.current) {
        suggestionAbortControllerRef.current.abort();
        suggestionAbortControllerRef.current = null;
      }
      if (searchTimeout.current) {
        clearTimeout(searchTimeout.current);
      }
      if (copyResetTimeout.current) {
        clearTimeout(copyResetTimeout.current);
      }
      if (rawCopyResetTimeout.current) {
        clearTimeout(rawCopyResetTimeout.current);
      }
      if (satCopyResetTimeout.current) {
        clearTimeout(satCopyResetTimeout.current);
      }
      if (teamBriefCopyResetTimeout.current) {
        clearTimeout(teamBriefCopyResetTimeout.current);
      }
    };
  }, []);

  const getLiveSearchValue = useCallback(() => {
    const currentValue = searchInputRef.current?.value;
    return typeof currentValue === 'string' ? currentValue : searchQuery;
  }, [searchQuery]);

  const setSearchInputValue = useCallback((value: string) => {
    if (searchInputRef.current && searchInputRef.current.value !== value) {
      searchInputRef.current.value = value;
    }
    setSearchQuery(value);
  }, []);

  const fetchSuggestions = useCallback(async (q: string) => {
    const requestId = ++latestSuggestionRequestId.current;
    const query = q.trim();
    if (!query || query.length < 2) {
      const localSuggestions = getLocalPopularSuggestions(query);
      setSuggestions(localSuggestions);
      setShowSuggestions(true);
      setActiveSuggestionIndex(-1);
      setSearchLoading(false);
      return;
    }

    const cacheKey = normalizeSuggestionText(query);
    const cached = suggestionCacheRef.current.get(cacheKey);

    if (cached) {
      setSuggestions(cached);
      setShowSuggestions(true);
      setActiveSuggestionIndex(-1);
      setSearchLoading(false);
      return;
    }

    if (suggestionAbortControllerRef.current) {
      suggestionAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    suggestionAbortControllerRef.current = controller;

    setSearchLoading(true);
    try {
      const queryParam = query ? `?q=${encodeURIComponent(query)}` : '';
      const { response, payload, requestId: apiRequestId } = await fetchApi(
        `/api/search${queryParam}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        const baseMessage = readApiErrorMessage(payload, `Search request failed (${response.status})`);
        throw new Error(apiRequestId ? `${baseMessage} (request ${apiRequestId})` : baseMessage);
      }
      if (requestId !== latestSuggestionRequestId.current) {
        return;
      }
      const nextSuggestions = Array.isArray(payload) ? payload : [];
      const resolvedSuggestions = rankAndDeduplicateSuggestions(nextSuggestions, query);
      suggestionCacheRef.current.set(cacheKey, resolvedSuggestions);
      if (suggestionCacheRef.current.size > 50) {
        const oldestKey = suggestionCacheRef.current.keys().next().value;
        if (typeof oldestKey === 'string') {
          suggestionCacheRef.current.delete(oldestKey);
        }
      }
      setSuggestions(resolvedSuggestions);
      setShowSuggestions(true);
      setActiveSuggestionIndex(-1);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      if (requestId !== latestSuggestionRequestId.current) {
        return;
      }
      const fallback = getLocalPopularSuggestions(query);
      suggestionCacheRef.current.set(cacheKey, fallback);
      setSuggestions(fallback);
      setShowSuggestions(true);
      setActiveSuggestionIndex(-1);
      console.error('Search error:', err);
    } finally {
      if (suggestionAbortControllerRef.current === controller) {
        suggestionAbortControllerRef.current = null;
      }
      if (requestId === latestSuggestionRequestId.current) {
        setSearchLoading(false);
      }
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (activeSuggestionIndex !== -1) {
      setActiveSuggestionIndex(-1);
    }

    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
    }

    if (value.length > 0) {
      setShowSuggestions(true);
      searchTimeout.current = setTimeout(() => {
        setSearchQuery(value);
        void fetchSuggestions(value);
      }, SEARCH_DEBOUNCE_MS);
    } else {
      setSearchQuery('');
      void fetchSuggestions('');
    }
  };

  const selectSuggestion = useCallback(
    (s: Suggestion) => {
      const label = s.name.split(',')[0];
      setSearchInputValue(label);
      setCommittedSearchQuery(label);
      setShowSuggestions(false);
      setActiveSuggestionIndex(-1);
      updateObjectivePosition(new L.LatLng(parseFloat(String(s.lat)), parseFloat(String(s.lon))), label);
    },
    [setSearchInputValue, updateObjectivePosition],
  );

  const handleUseTypedCoordinates = useCallback(
    (value: string) => {
      const parsed = parseCoordinates(value);
      if (!parsed) {
        return;
      }
      setSearchInputValue(value);
      setCommittedSearchQuery(value);
      updateObjectivePosition(new L.LatLng(parsed.lat, parsed.lon), 'Dropped pin');
      setShowSuggestions(false);
      setActiveSuggestionIndex(-1);
    },
    [setSearchInputValue, updateObjectivePosition],
  );

  const searchAndSelectFirst = useCallback(
    async (rawQuery: string) => {
      const query = rawQuery.trim();
      if (!query) {
        return false;
      }

      const parsed = parseCoordinates(query);
      if (parsed) {
        setSearchInputValue(query);
        setCommittedSearchQuery(query);
        updateObjectivePosition(new L.LatLng(parsed.lat, parsed.lon), 'Dropped pin');
        setShowSuggestions(false);
        setActiveSuggestionIndex(-1);
        return true;
      }

      const cached = suggestionCacheRef.current.get(normalizeSuggestionText(query));
      if (cached && cached[0]) {
        setSuggestions(cached);
        selectSuggestion(cached[0]);
        return true;
      }

      if (query.length < 2) {
        const localSuggestions = getLocalPopularSuggestions(query);
        setSuggestions(localSuggestions);
        if (localSuggestions[0]) {
          selectSuggestion(localSuggestions[0]);
          return true;
        }
        setShowSuggestions(true);
        setActiveSuggestionIndex(-1);
        return false;
      }

      setSearchLoading(true);
      try {
        const queryParam = query ? `?q=${encodeURIComponent(query)}` : '';
        const { response, payload, requestId: apiRequestId } = await fetchApi(
          `/api/search${queryParam}`,
        );
        if (!response.ok) {
          const baseMessage = readApiErrorMessage(payload, `Search request failed (${response.status})`);
          throw new Error(apiRequestId ? `${baseMessage} (request ${apiRequestId})` : baseMessage);
        }
        const nextSuggestions = Array.isArray(payload) ? payload : [];
        const resolvedSuggestions = rankAndDeduplicateSuggestions(nextSuggestions, query);
        setSuggestions(resolvedSuggestions);
        if (resolvedSuggestions[0]) {
          selectSuggestion(resolvedSuggestions[0]);
          return true;
        }
        setShowSuggestions(true);
        setActiveSuggestionIndex(-1);
        return false;
      } catch (err) {
        console.error('Search submit error:', err);
        const fallbackSuggestions = getLocalPopularSuggestions(query);
        setSuggestions(fallbackSuggestions);
        if (fallbackSuggestions[0]) {
          selectSuggestion(fallbackSuggestions[0]);
          return true;
        }
        setShowSuggestions(true);
        setActiveSuggestionIndex(-1);
        return false;
      } finally {
        setSearchLoading(false);
      }
    },
    [selectSuggestion, setSearchInputValue, updateObjectivePosition],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!searchWrapperRef.current) {
        return;
      }
      const target = event.target;
      if (target instanceof Node && searchWrapperRef.current.contains(target)) {
        return;
      }
      setShowSuggestions(false);
      setActiveSuggestionIndex(-1);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, []);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      searchInputRef.current?.focus();
      setShowSuggestions(true);
      if (!getLiveSearchValue().trim()) {
        void fetchSuggestions('');
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  }, [fetchSuggestions, getLiveSearchValue]);

  useEffect(() => {
    setTravelWindowExpanded(false);
  }, [safetyData?.forecast?.selectedDate, safetyData?.forecast?.selectedStartTime]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowSuggestions(false);
      setActiveSuggestionIndex(-1);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!showSuggestions) {
        setShowSuggestions(true);
      }
      if (suggestions.length > 0) {
        setActiveSuggestionIndex((prev) => (prev < 0 ? 0 : (prev + 1) % suggestions.length));
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (suggestions.length > 0) {
        setActiveSuggestionIndex((prev) => {
          if (prev < 0) {
            return suggestions.length - 1;
          }
          return prev === 0 ? suggestions.length - 1 : prev - 1;
        });
      }
      return;
    }

    if (e.key !== 'Enter') {
      return;
    }

    e.preventDefault();
    const liveQuery = getLiveSearchValue();
    const suggestionsMatchLiveQuery =
      normalizeSuggestionText(liveQuery) === normalizeSuggestionText(searchQuery);

    if (suggestionsMatchLiveQuery && activeSuggestionIndex >= 0 && suggestions[activeSuggestionIndex]) {
      selectSuggestion(suggestions[activeSuggestionIndex]);
      return;
    }

    if (suggestionsMatchLiveQuery && suggestions.length > 0) {
      selectSuggestion(suggestions[0]);
      return;
    }

    void searchAndSelectFirst(liveQuery);
  };

  const handleSearchSubmit = () => {
    const liveQuery = getLiveSearchValue();
    const suggestionsMatchLiveQuery =
      normalizeSuggestionText(liveQuery) === normalizeSuggestionText(searchQuery);
    if (!liveQuery.trim()) {
      setShowSuggestions(true);
      setActiveSuggestionIndex(-1);
      if (!suggestions.length && !searchLoading) {
        void fetchSuggestions('');
      }
      return;
    }
    if (suggestionsMatchLiveQuery && activeSuggestionIndex >= 0 && suggestions[activeSuggestionIndex]) {
      selectSuggestion(suggestions[activeSuggestionIndex]);
      return;
    }
    if (suggestionsMatchLiveQuery && suggestions.length > 0) {
      selectSuggestion(suggestions[0]);
      return;
    }
    setCommittedSearchQuery(liveQuery.trim());
    void searchAndSelectFirst(liveQuery);
  };

  const handleFocus = () => {
    setShowSuggestions(true);
    setActiveSuggestionIndex(-1);
    const liveQuery = getLiveSearchValue();
    if (!liveQuery) {
      void fetchSuggestions('');
      return;
    }

    if (!suggestions.length && !searchLoading) {
      void fetchSuggestions(liveQuery);
    }
  };

  const handleSearchClear = () => {
    setSearchInputValue('');
    setCommittedSearchQuery('');
    setActiveSuggestionIndex(-1);
    setShowSuggestions(true);
    void fetchSuggestions('');
  };

  const handleRecenterMap = () => {
    setMapFocusNonce((prev) => prev + 1);
  };

  const handleUseCurrentLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Geolocation is not available in this browser.');
      return;
    }

    setLocatingUser(true);
    navigator.geolocation.getCurrentPosition(
      (result) => {
        const lat = Number(result.coords.latitude);
        const lon = Number(result.coords.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          setError('Current location returned invalid coordinates.');
          setLocatingUser(false);
          return;
        }

        const nextPosition = new L.LatLng(lat, lon);
        updateObjectivePosition(nextPosition, 'Current location');
        const coordinateLabel = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        setSearchInputValue(coordinateLabel);
        setCommittedSearchQuery(coordinateLabel);
        setShowSuggestions(false);
        setActiveSuggestionIndex(-1);
        setLocatingUser(false);
      },
      (geoError) => {
        const message = geoError?.message ? `Unable to read current location: ${geoError.message}` : 'Unable to read current location.';
        setError(message);
        setLocatingUser(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 60000,
      },
    );
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (!DATE_FMT.test(value)) {
      return;
    }
    setForecastDate(value);
  };

  const handlePlannerTimeChange = (setter: React.Dispatch<React.SetStateAction<string>>) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (parseTimeInputMinutes(value) === null) {
      return;
    }
    setter(value);
  };

  const handleTargetElevationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = e.target.value.replace(/[^\d]/g, '').slice(0, 5);
    setTargetElevationInput(digitsOnly);
    setTargetElevationManual(true);
  };

  const handleCopyLink = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      if (copyResetTimeout.current) {
        clearTimeout(copyResetTimeout.current);
      }
      copyResetTimeout.current = setTimeout(() => setCopiedLink(false), 1500);
    } catch {
      setCopiedLink(false);
    }
  };

  const handleCopyRawPayload = async () => {
    if (!rawReportPayload || typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }
    try {
      await navigator.clipboard.writeText(rawReportPayload);
      setCopiedRawPayload(true);
      if (rawCopyResetTimeout.current) {
        clearTimeout(rawCopyResetTimeout.current);
      }
      rawCopyResetTimeout.current = setTimeout(() => setCopiedRawPayload(false), 1500);
    } catch {
      setCopiedRawPayload(false);
    }
  };

  const handleCopySatelliteLine = async () => {
    if (!satelliteConditionLine || typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(satelliteConditionLine);
      setCopiedSatLine(true);
      if (satCopyResetTimeout.current) {
        clearTimeout(satCopyResetTimeout.current);
      }
      satCopyResetTimeout.current = setTimeout(() => setCopiedSatLine(false), 1600);
    } catch {
      setCopiedSatLine(false);
    }
  };

  const handleCopyTeamBrief = async () => {
    if (!teamBriefChecklist || typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(teamBriefChecklist);
      setCopiedTeamBrief(true);
      if (teamBriefCopyResetTimeout.current) {
        clearTimeout(teamBriefCopyResetTimeout.current);
      }
      teamBriefCopyResetTimeout.current = setTimeout(() => setCopiedTeamBrief(false), 1600);
    } catch {
      setCopiedTeamBrief(false);
    }
  };

  const handlePrintReport = () => {
    if (typeof window === 'undefined' || !safetyData || !decision) {
      return;
    }

    const reportObjective = objectiveName || 'Pinned Objective';
    const reportDate = safetyData.forecast?.selectedDate || forecastDate;
    const normalizedDanger = normalizeDangerLevel(safetyData.avalanche.dangerLevel);
    const avalancheSummary = avalancheUnknown ? 'Unknown (no official center coverage)' : `L${normalizedDanger} ${getDangerText(normalizedDanger)}`;
    const blockersMarkup =
      decision.blockers.length > 0
        ? decision.blockers.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
        : '<li>None listed</li>';
    const cautionsMarkup =
      decision.cautions.length > 0
        ? decision.cautions.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
        : '<li>None listed</li>';
    const checksMarkup =
      decision.checks.length > 0
        ? decision.checks
            .map((check) => `<li>${check.ok ? 'PASS' : 'WARN'} - ${escapeHtml(check.label)}${check.detail ? ` (${escapeHtml(check.detail)})` : ''}</li>`)
            .join('')
        : '<li>No checks available</li>';
    const printAvalancheRelevant = safetyData.avalanche.relevant !== false;
    const printAvalancheExpired = safetyData.avalanche.coverageStatus === 'expired_for_selected_start';
    const printNwsAlerts = safetyData.alerts?.alerts || [];
    const printAlertsMarkup =
      printNwsAlerts.length > 0
        ? printNwsAlerts
            .slice(0, 4)
            .map((alert) => {
              const safeAlertLink = sanitizeExternalUrl(alert.link || undefined);
              return `<li>${escapeHtml(alert.event || 'Alert')} • ${escapeHtml(alert.severity || 'Unknown')} • ${escapeHtml(
                alert.urgency || 'Unknown urgency',
              )}${alert.expires ? ` • Expires ${escapeHtml(formatPubTime(alert.expires))}` : ''}${
                safeAlertLink ? ` • <a href="${escapeHtml(safeAlertLink)}" target="_blank" rel="noreferrer">Source link</a>` : ''
              }</li>`;
            })
            .join('')
        : '<li>No active NWS alerts at objective point</li>';
    const gearMarkup =
      safetyData.gear && safetyData.gear.length > 0
        ? safetyData.gear.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
        : '<li>Standard kit only (no special gear flags)</li>';
    const printAvalancheSection = printAvalancheRelevant
      ? `<article class="section">
        <h3>Avalanche Snapshot</h3>
        <ul>
          <li>${escapeHtml(avalancheSummary)}</li>
          <li>Avalanche center: ${escapeHtml(safetyData.avalanche.center || 'N/A')}</li>
          <li>Zone: ${escapeHtml(safetyData.avalanche.zone || 'N/A')}</li>
          <li>Published: ${escapeHtml(safetyData.avalanche.publishedTime ? formatPubTime(safetyData.avalanche.publishedTime) : 'Not available')}</li>
          <li>Expires: ${escapeHtml(safetyData.avalanche.expiresTime ? formatPubTime(safetyData.avalanche.expiresTime) : 'Not available')}</li>
          ${printAvalancheExpired ? '<li>This bulletin expired before the selected start time. Treat as stale context and verify latest update.</li>' : ''}
        </ul>
      </article>`
      : `<article class="section">
        <h3>Avalanche Snapshot</h3>
        <ul>
          <li>Not applicable for this objective/time.</li>
          <li>${escapeHtml(localizeUnitText(safetyData.avalanche.relevanceReason || 'Avalanche forecasting is currently de-emphasized based on season and snowpack context.'))}</li>
        </ul>
      </article>`;
    const printAlertsSection = `<article class="section">
        <h3>NWS Alerts</h3>
        <ul>${printAlertsMarkup}</ul>
      </article>`;
    const printFireAlertRows =
      safetyData.fireRisk?.alertsConsidered && safetyData.fireRisk.alertsConsidered.length > 0
        ? safetyData.fireRisk.alertsConsidered
            .slice(0, 4)
            .map((alert) => {
              const safeAlertLink = sanitizeExternalUrl(alert.link || undefined);
              return `<li>${escapeHtml(alert.event || 'Alert')} • ${escapeHtml(alert.severity || 'Unknown')}${
                alert.expires ? ` • Expires ${escapeHtml(formatPubTime(alert.expires || undefined))}` : ''
              }${safeAlertLink ? ` • <a href="${escapeHtml(safeAlertLink)}" target="_blank" rel="noreferrer">Source link</a>` : ''}</li>`;
            })
            .join('')
        : '<li>No fire-weather specific alerts in current NWS set.</li>';
    const printFireSection = `<article class="section">
        <h3>Fire Risk</h3>
        <ul>
          <li>Level: ${escapeHtml(safetyData.fireRisk?.label || 'Unknown')}</li>
          <li>${escapeHtml(safetyData.fireRisk?.guidance || 'No fire-risk guidance available.')}</li>
          <li>Signal: ${escapeHtml((safetyData.fireRisk?.reasons && safetyData.fireRisk.reasons[0]) || 'No notable fire signal.')}</li>
          ${printFireAlertRows}
        </ul>
      </article>`;
    const printSnotelDistance = formatDistanceForElevationUnit(Number(safetyData.snowpack?.snotel?.distanceKm), preferences.elevationUnit);
    const printSnotelSwe = formatSweForElevationUnit(Number(safetyData.snowpack?.snotel?.sweIn), preferences.elevationUnit);
    const printSnotelDepth = formatSnowDepthForElevationUnit(Number(safetyData.snowpack?.snotel?.snowDepthIn), preferences.elevationUnit);
    const printNohrscSwe = formatSweForElevationUnit(Number(safetyData.snowpack?.nohrsc?.sweIn), preferences.elevationUnit);
    const printNohrscDepth = formatSnowDepthForElevationUnit(Number(safetyData.snowpack?.nohrsc?.snowDepthIn), preferences.elevationUnit);
    const printSnowpackSection = `<article class="section">
        <h3>Snowpack Snapshot</h3>
        <ul>
          <li>${escapeHtml(localizeUnitText(safetyData.snowpack?.summary || 'Snowpack observations unavailable.'))}</li>
          <li>Nearest SNOTEL: ${escapeHtml(safetyData.snowpack?.snotel?.stationName || 'N/A')}${
            Number.isFinite(Number(safetyData.snowpack?.snotel?.distanceKm))
              ? ` (${escapeHtml(printSnotelDistance)})`
              : ''
          }</li>
          <li>SNOTEL SWE: ${escapeHtml(
            printSnotelSwe,
          )} • Depth: ${escapeHtml(
            printSnotelDepth,
          )}</li>
          <li>NOHRSC SWE: ${escapeHtml(
            printNohrscSwe,
          )} • Depth: ${escapeHtml(
            printNohrscDepth,
          )}</li>
        </ul>
      </article>`;
    const bottomLine = localizeUnitText(
      toPlainText(safetyData.avalanche.bottomLine || safetyData.avalanche.advice || 'No avalanche bottom line available.'),
    );
    const defaultPrintAbortTrigger = 'Abort if wind slabs, whiteout conditions, unstable snow signs, or collapsing daylight margin appear.';
    const printFieldBriefText = collapseWhitespace(
      [
        decision.headline,
        `Weather: ${weatherConditionEmoji(safetyData.weather.description, safetyData.weather.isDaytime)} ${safetyData.weather.description}, ${formatTempDisplay(
          safetyData.weather.temp,
        )} (feels ${formatTempDisplay(safetyData.weather.feelsLike ?? safetyData.weather.temp)}), wind ${formatWindDisplay(
          safetyData.weather.windSpeed,
        )} (gust ${formatWindDisplay(safetyData.weather.windGust)}).`,
        `Avalanche: ${avalancheSummary}.`,
        `Primary abort trigger: ${decision.blockers[0] || defaultPrintAbortTrigger}`,
      ].join(' '),
    );
    const printTitle = `${reportObjective} - Backcountry Conditions Printable Report`;

    const printHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(printTitle)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: light;
      }
      body {
        margin: 0;
        padding: 24px;
        background: #fff;
        color: #112118;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        line-height: 1.45;
      }
      h1, h2, h3 {
        margin: 0 0 8px;
        line-height: 1.2;
      }
      p {
        margin: 0;
      }
      .header {
        border: 1px solid #d5dfd5;
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 14px;
        background: #f6faf6;
      }
      .kicker {
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #466357;
        font-weight: 700;
        margin-bottom: 6px;
      }
      .meta {
        margin-top: 10px;
        font-size: 13px;
        color: #2d4338;
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 14px;
      }
      .tile {
        border: 1px solid #d5dfd5;
        border-radius: 10px;
        padding: 10px;
        background: #fff;
      }
      .tile-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #567163;
        margin-bottom: 4px;
        font-weight: 700;
      }
      .tile-value {
        font-size: 17px;
        font-weight: 700;
        color: #1a2d23;
      }
      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      .section {
        border: 1px solid #dce4dc;
        border-radius: 10px;
        padding: 12px;
      }
      .section h3 {
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #466458;
        margin-bottom: 8px;
      }
      .section ul {
        margin: 0;
        padding-left: 18px;
      }
      .section li {
        margin: 4px 0;
      }
      .line {
        margin-top: 10px;
        border: 1px solid #dce4dc;
        border-radius: 10px;
        padding: 10px;
        background: #f8faf8;
        font-size: 13px;
      }
      .footer {
        margin-top: 16px;
        border-top: 1px solid #dce4dc;
        padding-top: 10px;
        font-size: 11px;
        color: #61766c;
      }
      @media print {
        body {
          padding: 12mm;
        }
      }
    </style>
  </head>
  <body>
    <section class="header">
      <div class="kicker">Backcountry Conditions Printable Report</div>
      <h1>${escapeHtml(reportObjective)}</h1>
      <p>Objective plan for ${escapeHtml(reportDate)}</p>
      <p class="meta">Start ${escapeHtml(displayStartTime)} | Coordinates ${escapeHtml(position.lat.toFixed(5))}, ${escapeHtml(position.lng.toFixed(5))}</p>
    </section>

    <section class="summary">
      <article class="tile">
        <div class="tile-label">Safety Score</div>
        <div class="tile-value">${escapeHtml(String(safetyData.safety.score))}%</div>
      </article>
      <article class="tile">
        <div class="tile-label">Decision</div>
        <div class="tile-value">${escapeHtml(decision.level)}</div>
      </article>
      <article class="tile">
        <div class="tile-label">Primary Hazard</div>
        <div class="tile-value">${escapeHtml(safetyData.safety.primaryHazard || 'N/A')}</div>
      </article>
    </section>

    <section class="grid">
      <article class="section">
        <h3>Weather Snapshot</h3>
        <ul>
          <li>${escapeHtml(`${weatherConditionEmoji(safetyData.weather.description, safetyData.weather.isDaytime)} ${safetyData.weather.description}`)}</li>
          <li>Temp ${escapeHtml(formatTempDisplay(safetyData.weather.temp))}, feels ${escapeHtml(formatTempDisplay(safetyData.weather.feelsLike ?? safetyData.weather.temp))}</li>
          <li>Wind ${escapeHtml(formatWindDisplay(safetyData.weather.windSpeed))}, gust ${escapeHtml(formatWindDisplay(safetyData.weather.windGust))}</li>
          <li>Precipitation chance ${escapeHtml(String(safetyData.weather.precipChance))}%</li>
          <li>Forecast issued ${escapeHtml(safetyData.weather.issuedTime ? formatPubTime(safetyData.weather.issuedTime) : 'Not available')}</li>
        </ul>
      </article>

      ${printAvalancheSection}
      ${printAlertsSection}
      ${printSnowpackSection}
      ${printFireSection}

      <article class="section">
        <h3>Decision Checks</h3>
        <ul>${checksMarkup}</ul>
      </article>

      <article class="section">
        <h3>Gear Recommendations</h3>
        <ul>${gearMarkup}</ul>
      </article>

      <article class="section">
        <h3>Blockers</h3>
        <ul>${blockersMarkup}</ul>
      </article>

      <article class="section">
        <h3>Cautions</h3>
        <ul>${cautionsMarkup}</ul>
      </article>
    </section>

    <section class="line">
      <h3 style="margin-bottom: 6px;">Avalanche Bottom Line</h3>
      <p>${escapeHtml(bottomLine)}</p>
    </section>

    <section class="line">
      <h3 style="margin-bottom: 6px;">SAT One-Liner</h3>
      <p>${escapeHtml(satelliteConditionLine)}</p>
    </section>

    <section class="line">
      <h3 style="margin-bottom: 6px;">Field Brief</h3>
      <p>${escapeHtml(printFieldBriefText)}</p>
    </section>

    <p class="footer">Generated ${escapeHtml(formatGeneratedAt())} by Backcountry Conditions. ${escapeHtml(APP_CREDIT_TEXT)} Sources include NOAA weather products and avalanche center data where available. Disclaimer: Backcountry Conditions is planning support only, not a safety guarantee. Verify official products and current field conditions before committing.</p>
  </body>
</html>`;

    const printWindow = window.open('', '_blank', 'width=960,height=1100');
    if (!printWindow) {
      window.print();
      return;
    }

    printWindow.document.open();
    printWindow.document.write(printHtml);
    printWindow.document.close();
    printWindow.focus();
    printWindow.onload = () => {
      printWindow.print();
    };
  };

  const handleRetryFetch = () => {
    if (!hasObjective) {
      return;
    }
    fetchSafetyData(position.lat, position.lng, forecastDate, alpineStartTime, { force: true });
  };

  const updatePreferences = (patch: Partial<UserPreferences>) => {
    setPreferences((prev) => {
      const next = { ...prev, ...patch };
      persistUserPreferences(next);
      return next;
    });
  };

  const handlePreferenceTimeChange = (field: 'defaultStartTime' | 'defaultBackByTime', value: string) => {
    if (parseTimeInputMinutes(value) === null) {
      return;
    }

    updatePreferences({ [field]: value });
  };

  const handleThemeModeChange = (themeMode: ThemeMode) => {
    updatePreferences({ themeMode });
  };

  const handleTemperatureUnitChange = (temperatureUnit: TemperatureUnit) => {
    updatePreferences({ temperatureUnit });
  };

  const handleWindSpeedUnitChange = (windSpeedUnit: WindSpeedUnit) => {
    updatePreferences({ windSpeedUnit });
  };

  const handleElevationUnitChange = (elevationUnit: ElevationUnit) => {
    if (elevationUnit === preferences.elevationUnit) {
      return;
    }
    const parsed = parseOptionalElevationInput(targetElevationInput);
    if (parsed !== null) {
      const asFeet = convertDisplayElevationToFeet(parsed, preferences.elevationUnit);
      const nextDisplay = convertElevationFeetToDisplayValue(asFeet, elevationUnit);
      setTargetElevationInput(String(Math.max(0, Math.round(nextDisplay))));
    }
    updatePreferences({ elevationUnit });
  };

  const handleTimeStyleChange = (timeStyle: TimeStyle) => {
    updatePreferences({ timeStyle });
  };

  const commitRoundedThresholdValue = (
    rawValue: string,
    field: 'maxPrecipChance' | 'travelWindowHours',
    min: number,
    max: number,
    fallback: number,
  ): number => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return fallback;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    const committed = Math.max(min, Math.min(max, Math.round(parsed)));
    updatePreferences({ [field]: committed } as Partial<UserPreferences>);
    return committed;
  };

  const handleTravelWindowHoursDraftChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setTravelWindowHoursDraft(raw);
    if (!raw.trim()) {
      return;
    }
    commitRoundedThresholdValue(raw, 'travelWindowHours', MIN_TRAVEL_WINDOW_HOURS, MAX_TRAVEL_WINDOW_HOURS, travelWindowHours);
  };

  const handleTravelWindowHoursDraftBlur = () => {
    const committed = commitRoundedThresholdValue(
      travelWindowHoursDraft,
      'travelWindowHours',
      MIN_TRAVEL_WINDOW_HOURS,
      MAX_TRAVEL_WINDOW_HOURS,
      travelWindowHours,
    );
    setTravelWindowHoursDraft(String(committed));
  };

  const handleMaxPrecipChanceDraftChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setMaxPrecipChanceDraft(raw);
    if (!raw.trim()) {
      return;
    }
    commitRoundedThresholdValue(raw, 'maxPrecipChance', 0, 100, preferences.maxPrecipChance);
  };

  const handleMaxPrecipChanceDraftBlur = () => {
    const committed = commitRoundedThresholdValue(maxPrecipChanceDraft, 'maxPrecipChance', 0, 100, preferences.maxPrecipChance);
    setMaxPrecipChanceDraft(String(committed));
  };

  const handleWindThresholdDisplayChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setMaxWindGustDraft(raw);
    if (!raw.trim()) {
      return;
    }
    const displayValue = Number(raw);
    if (!Number.isFinite(displayValue)) {
      return;
    }
    const mphValue = convertDisplayWindToMph(displayValue, preferences.windSpeedUnit);
    updatePreferences({ maxWindGustMph: Number(Math.max(10, Math.min(80, mphValue)).toFixed(2)) });
  };

  const handleWindThresholdDisplayBlur = () => {
    const raw = maxWindGustDraft.trim();
    if (!raw) {
      setMaxWindGustDraft(
        convertWindMphToDisplayValue(preferences.maxWindGustMph, preferences.windSpeedUnit).toFixed(preferences.windSpeedUnit === 'kph' ? 1 : 0),
      );
      return;
    }
    const displayValue = Number(raw);
    if (!Number.isFinite(displayValue)) {
      setMaxWindGustDraft(
        convertWindMphToDisplayValue(preferences.maxWindGustMph, preferences.windSpeedUnit).toFixed(preferences.windSpeedUnit === 'kph' ? 1 : 0),
      );
      return;
    }
    const mphValue = convertDisplayWindToMph(displayValue, preferences.windSpeedUnit);
    const committedMph = Number(Math.max(10, Math.min(80, mphValue)).toFixed(2));
    updatePreferences({ maxWindGustMph: committedMph });
    setMaxWindGustDraft(
      convertWindMphToDisplayValue(committedMph, preferences.windSpeedUnit).toFixed(preferences.windSpeedUnit === 'kph' ? 1 : 0),
    );
  };

  const handleFeelsLikeThresholdDisplayChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setMinFeelsLikeDraft(raw);
    if (!raw.trim()) {
      return;
    }
    const displayValue = Number(raw);
    if (!Number.isFinite(displayValue)) {
      return;
    }
    const valueF = convertDisplayTempToF(displayValue, preferences.temperatureUnit);
    updatePreferences({ minFeelsLikeF: Number(Math.max(-40, Math.min(60, valueF)).toFixed(2)) });
  };

  const handleFeelsLikeThresholdDisplayBlur = () => {
    const raw = minFeelsLikeDraft.trim();
    if (!raw) {
      setMinFeelsLikeDraft(
        convertTempFToDisplayValue(preferences.minFeelsLikeF, preferences.temperatureUnit).toFixed(preferences.temperatureUnit === 'c' ? 1 : 0),
      );
      return;
    }
    const displayValue = Number(raw);
    if (!Number.isFinite(displayValue)) {
      setMinFeelsLikeDraft(
        convertTempFToDisplayValue(preferences.minFeelsLikeF, preferences.temperatureUnit).toFixed(preferences.temperatureUnit === 'c' ? 1 : 0),
      );
      return;
    }
    const valueF = convertDisplayTempToF(displayValue, preferences.temperatureUnit);
    const committedF = Number(Math.max(-40, Math.min(60, valueF)).toFixed(2));
    updatePreferences({ minFeelsLikeF: committedF });
    setMinFeelsLikeDraft(
      convertTempFToDisplayValue(committedF, preferences.temperatureUnit).toFixed(preferences.temperatureUnit === 'c' ? 1 : 0),
    );
  };

  const applyPreferencesToPlanner = () => {
    setAlpineStartTime(preferences.defaultStartTime);
    setTurnaroundTime(preferences.defaultBackByTime);
    startViewChange(() => setView('planner'));
  };

  const resetPreferences = () => {
    const defaults = getDefaultUserPreferences();
    setPreferences(defaults);
    persistUserPreferences(defaults);
  };

  const openPlannerView = () => {
    if (!hasObjective && !getLiveSearchValue().trim()) {
      setAlpineStartTime(preferences.defaultStartTime);
      setTurnaroundTime(preferences.defaultBackByTime);
    }
    startViewChange(() => setView('planner'));
  };

  const openStatusView = () => {
    startViewChange(() => setView('status'));
  };
  const navigateToView = useCallback(
    (nextView: 'home' | 'planner' | 'settings' | 'status') => {
      startViewChange(() => setView(nextView));
    },
    [startViewChange],
  );
  const appShellClassName = `app-container page-shell page-shell-${view}${isViewPending ? ' is-nav-pending' : ''}`;
  const liveSearchQuery = getLiveSearchValue();
  const trimmedSearchQuery = liveSearchQuery.trim();
  const parsedTypedCoordinates = parseCoordinates(trimmedSearchQuery);

  const getScoreColor = (score: number) => {
    if (score >= 80) {
      return 'var(--accent-green)';
    }
    if (score >= 50) {
      return 'var(--accent-yellow)';
    }
    return 'var(--accent-red)';
  };

  const getDangerText = (lvl: number) => {
    const levels = ['No Rating', 'Low', 'Moderate', 'Considerable', 'High', 'Extreme'];
    return levels[lvl] || 'N/A';
  };
  const getDangerGlyph = (lvl: number) => {
    if (lvl >= 5) return '!!';
    if (lvl >= 4) return 'X';
    if (lvl >= 3) return '!';
    if (lvl >= 2) return '•';
    return '✓';
  };

  const useHour12Clock = preferences.timeStyle !== '24h';

  const formatPubTime = (isoString?: string) => {
    if (!isoString) {
      return 'Not available';
    }

    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return isoString;
    }
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric', hour12: useHour12Clock });
  };

  const formatForecastPeriodLabel = (isoString?: string | null, timeZone?: string | null) => {
    if (!isoString) {
      return 'Not available';
    }
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return isoString;
    }
    const baseOptions: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      hour12: useHour12Clock,
    };
    if (timeZone) {
      try {
        return date.toLocaleString([], { ...baseOptions, timeZone });
      } catch {
        // Fall through to environment-local formatting.
      }
    }
    return date.toLocaleString([], baseOptions);
  };

  const formatGeneratedAt = (value: Date = new Date()) =>
    value.toLocaleString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: useHour12Clock,
    });

  const formatTempDisplay = (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) =>
    formatTemperatureForUnit(value, preferences.temperatureUnit, options);
  const formatWindDisplay = (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) =>
    formatWindForUnit(value, preferences.windSpeedUnit, options);
  const formatElevationDisplay = (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) =>
    formatElevationForUnit(value, preferences.elevationUnit, options);
  const formatElevationDeltaDisplay = (value: number | null | undefined) => formatElevationDeltaForUnit(value, preferences.elevationUnit);
  const localizeUnitText = (text: string): string =>
    text
      .replace(/SWE\s*~?\s*(-?\d+(?:\.\d+)?)\s?in\b/gi, (_, value) => `SWE ~${formatSweForElevationUnit(Number(value), preferences.elevationUnit).replace(/\s*SWE$/i, '')}`)
      .replace(/depth\s*~?\s*(-?\d+(?:\.\d+)?)\s?in\b/gi, (_, value) => `depth ~${formatSnowDepthForElevationUnit(Number(value), preferences.elevationUnit)}`)
      .replace(/(-?\d+(?:\.\d+)?)\s?km\b/gi, (_, value) => formatDistanceForElevationUnit(Number(value), preferences.elevationUnit))
      .replace(/(-?\d+(?:\.\d+)?)\s?ft\b/gi, (_, value) => formatElevationDisplay(Number(value)))
      .replace(/(-?\d+(?:\.\d+)?)\s?mph\b/gi, (_, value) => formatWindDisplay(Number(value)))
      .replace(/(-?\d+(?:\.\d+)?)F\b/g, (_, value) => formatTempDisplay(Number(value)));

  const cutoffMinutes = parseTimeInputMinutes(alpineStartTime);
  const displayStartTime = formatClockForStyle(alpineStartTime, preferences.timeStyle);
  const displayDefaultStartTime = formatClockForStyle(preferences.defaultStartTime, preferences.timeStyle);
  const travelWindowHours = Math.max(
    MIN_TRAVEL_WINDOW_HOURS,
    Math.min(MAX_TRAVEL_WINDOW_HOURS, Math.round(Number(preferences.travelWindowHours) || 12)),
  );
  const decision = safetyData ? evaluateBackcountryDecision(safetyData, alpineStartTime, preferences) : null;
  const failedCriticalChecks = decision ? decision.checks.filter((check) => !check.ok) : [];
  const passedCriticalChecks = decision ? decision.checks.filter((check) => check.ok) : [];
  const orderedCriticalChecks = [...failedCriticalChecks, ...passedCriticalChecks];
  const topCriticalAttentionChecks = failedCriticalChecks.slice(0, 3);
  const criticalCheckTotal = orderedCriticalChecks.length;
  const criticalCheckPassCount = passedCriticalChecks.length;
  const criticalCheckFailCount = failedCriticalChecks.length;
  const startLabel = 'Start time';
  const avalancheRelevant = safetyData ? safetyData.avalanche.relevant !== false : true;
  const avalancheExpiredForSelectedStart = safetyData ? safetyData.avalanche.coverageStatus === 'expired_for_selected_start' : false;
  const avalancheCoverageUnknown = safetyData
    ? ['no_center_coverage', 'temporarily_unavailable', 'no_active_forecast'].includes(String(safetyData.avalanche.coverageStatus || ''))
    : false;
  const avalancheUnknown = safetyData
    ? avalancheRelevant && Boolean(safetyData.avalanche.dangerUnknown || avalancheCoverageUnknown)
    : false;
  const overallAvalancheLevel = safetyData && !avalancheUnknown ? normalizeDangerLevel(safetyData.avalanche.dangerLevel) : null;
  const avalancheNotApplicableReason = safetyData
    ? localizeUnitText(
        safetyData.avalanche.relevanceReason || 'Avalanche forecast is not applicable for this objective/date based on seasonal and snowpack context.',
      )
    : '';
  const avalancheElevationRows = safetyData && !avalancheUnknown
    ? [
        { key: 'above', label: 'Above treeline', rating: safetyData.avalanche.elevations?.above },
        { key: 'at', label: 'Near treeline', rating: safetyData.avalanche.elevations?.at },
        { key: 'below', label: 'Below treeline', rating: safetyData.avalanche.elevations?.below },
      ]
    : [];
  const elevationForecastBands = safetyData?.weather.elevationForecast || [];
  const trendWindow = safetyData ? buildTrendWindowFromStart(safetyData.weather.trend || [], alpineStartTime, travelWindowHours) : [];
  const criticalWindow = safetyData
    ? trendWindow.map((point) => {
        const assessment = assessCriticalWindowPoint(point);
        return {
          ...point,
          ...assessment,
        };
      })
    : [];
  const travelWindowRows = safetyData ? buildTravelWindowRows(trendWindow, preferences) : [];
  const travelWindowInsights = buildTravelWindowInsights(travelWindowRows, preferences.timeStyle);
  const travelWindowSummary = travelWindowInsights.summary;
  const worstTravelWindowIndex = travelWindowRows.length
    ? travelWindowRows.reduce((worstIdx, row, idx) => {
        const criticalScore = criticalWindow[idx]?.score || 0;
        const gustOver = Math.max(0, row.gust - preferences.maxWindGustMph);
        const precipOver = Math.max(0, row.precipChance - preferences.maxPrecipChance);
        const coldOver = Math.max(0, preferences.minFeelsLikeF - row.feelsLike);
        const failCount = row.failedRuleLabels.length;
        const rowSeverity = failCount * 100 + gustOver * 2 + precipOver + coldOver * 1.5 + criticalScore;

        const currentWorst = travelWindowRows[worstIdx];
        const currentCriticalScore = criticalWindow[worstIdx]?.score || 0;
        const currentGustOver = Math.max(0, currentWorst.gust - preferences.maxWindGustMph);
        const currentPrecipOver = Math.max(0, currentWorst.precipChance - preferences.maxPrecipChance);
        const currentColdOver = Math.max(0, preferences.minFeelsLikeF - currentWorst.feelsLike);
        const currentFailCount = currentWorst.failedRuleLabels.length;
        const worstSeverity = currentFailCount * 100 + currentGustOver * 2 + currentPrecipOver + currentColdOver * 1.5 + currentCriticalScore;

        if (rowSeverity === worstSeverity && criticalScore > currentCriticalScore) {
          return idx;
        }
        return rowSeverity > worstSeverity ? idx : worstIdx;
      }, 0)
    : -1;
  const worstTravelWindowRow = worstTravelWindowIndex >= 0 ? travelWindowRows[worstTravelWindowIndex] : null;
  const worstTravelWindowCritical = worstTravelWindowIndex >= 0 ? criticalWindow[worstTravelWindowIndex] || null : null;
  const peakCriticalWindowIndex = criticalWindow.length
    ? criticalWindow.reduce((bestIndex, current, idx, rows) => (current.score > rows[bestIndex].score ? idx : bestIndex), 0)
    : -1;
  const peakCriticalWindow = peakCriticalWindowIndex >= 0 ? criticalWindow[peakCriticalWindowIndex] : null;
  const visibleCriticalWindowRows = travelWindowExpanded ? criticalWindow : [];
  const parsedTargetElevation = parseOptionalElevationInput(targetElevationInput);
  const targetElevationFt =
    parsedTargetElevation === null ? Number.NaN : convertDisplayElevationToFeet(parsedTargetElevation, preferences.elevationUnit);
  const hasTargetElevation = Number.isFinite(targetElevationFt) && targetElevationFt >= 0;
  const windThresholdDisplay = formatWindDisplay(preferences.maxWindGustMph);
  const feelsLikeThresholdDisplay = formatTempDisplay(preferences.minFeelsLikeF);
  const travelWindowHoursLabel = `${travelWindowHours}h`;
  const windUnitLabel = preferences.windSpeedUnit;
  const tempUnitLabel = preferences.temperatureUnit.toUpperCase();
  const elevationUnitLabel = preferences.elevationUnit;
  const windThresholdPrecision = preferences.windSpeedUnit === 'kph' ? 1 : 0;
  const windThresholdStep = preferences.windSpeedUnit === 'kph' ? 0.5 : 1;
  const windThresholdMin = Number(convertWindMphToDisplayValue(10, preferences.windSpeedUnit).toFixed(windThresholdPrecision));
  const windThresholdMax = Number(convertWindMphToDisplayValue(80, preferences.windSpeedUnit).toFixed(windThresholdPrecision));
  const windThresholdInputValue = Number(
    convertWindMphToDisplayValue(preferences.maxWindGustMph, preferences.windSpeedUnit).toFixed(windThresholdPrecision),
  );
  const feelsLikeThresholdPrecision = preferences.temperatureUnit === 'c' ? 1 : 0;
  const feelsLikeThresholdStep = preferences.temperatureUnit === 'c' ? 0.5 : 1;
  const feelsLikeThresholdMin = Number(convertTempFToDisplayValue(-40, preferences.temperatureUnit).toFixed(feelsLikeThresholdPrecision));
  const feelsLikeThresholdMax = Number(convertTempFToDisplayValue(60, preferences.temperatureUnit).toFixed(feelsLikeThresholdPrecision));
  const feelsLikeThresholdInputValue = Number(
    convertTempFToDisplayValue(preferences.minFeelsLikeF, preferences.temperatureUnit).toFixed(feelsLikeThresholdPrecision),
  );
  useEffect(() => {
    setTravelWindowHoursDraft(String(travelWindowHours));
  }, [travelWindowHours]);
  useEffect(() => {
    setMaxPrecipChanceDraft(String(preferences.maxPrecipChance));
  }, [preferences.maxPrecipChance]);
  useEffect(() => {
    setMaxWindGustDraft(String(windThresholdInputValue));
  }, [windThresholdInputValue]);
  useEffect(() => {
    setMinFeelsLikeDraft(String(feelsLikeThresholdInputValue));
  }, [feelsLikeThresholdInputValue]);
  const targetElevationForecast =
    safetyData && hasTargetElevation && Number.isFinite(Number(safetyData.weather.elevation))
      ? (() => {
          const baseElevationFt = Number(safetyData.weather.elevation);
          const deltaKft = (targetElevationFt - baseElevationFt) / 1000;
          const temp = Math.round(safetyData.weather.temp - deltaKft * TEMP_LAPSE_F_PER_1000FT);
          const windSpeed = Math.max(0, Math.round(safetyData.weather.windSpeed + deltaKft * WIND_INCREASE_MPH_PER_1000FT));
          const windGust = Math.max(windSpeed, Math.round(safetyData.weather.windGust + deltaKft * GUST_INCREASE_MPH_PER_1000FT));
          const feelsLike = computeFeelsLikeF(temp, windSpeed);
          return { temp, feelsLike, windSpeed, windGust, deltaFt: Math.round(targetElevationFt - baseElevationFt) };
        })()
      : null;
  const rawReportPayload = React.useMemo(
    () =>
      safetyData
        ? stringifyRawPayload({
            objective: {
              name: objectiveName || 'Pinned Objective',
              activity,
              coordinates: { lat: Number(position.lat.toFixed(5)), lon: Number(position.lng.toFixed(5)) },
              forecastDate: safetyData.forecast?.selectedDate || forecastDate,
              startTime: alpineStartTime,
              backByTime: turnaroundTime,
              targetElevationFt: hasTargetElevation ? Math.round(targetElevationFt) : null,
            },
            forecast: safetyData.forecast || null,
            weather: safetyData.weather,
            solar: safetyData.solar,
            avalanche: safetyData.avalanche,
            alerts: safetyData.alerts || null,
            airQuality: safetyData.airQuality || null,
            rainfall: safetyData.rainfall || null,
            snowpack: safetyData.snowpack || null,
            fireRisk: safetyData.fireRisk || null,
            heatRisk: safetyData.heatRisk || null,
            safety: safetyData.safety,
            decision,
          })
        : '',
    [
      safetyData,
      objectiveName,
      activity,
      position.lat,
      position.lng,
      forecastDate,
      alpineStartTime,
      turnaroundTime,
      hasTargetElevation,
      targetElevationFt,
      decision,
    ],
  );
  const deepDiveShareLink = typeof window !== 'undefined' ? window.location.href : '';
  const safeShareLink = sanitizeExternalUrl(deepDiveShareLink);
  const safeWeatherLink = sanitizeExternalUrl(safetyData?.weather.forecastLink);
  const weatherLinkHostLabel = (() => {
    if (!safeWeatherLink) {
      return null;
    }
    try {
      const host = new URL(safeWeatherLink).hostname.toLowerCase().replace(/^www\./, '');
      if (host.includes('weather.gov')) {
        return 'WEATHER.GOV';
      }
      if (host.includes('open-meteo.com')) {
        return 'OPEN-METEO';
      }
      return host.toUpperCase();
    } catch {
      return null;
    }
  })();
  const weatherLinkCta = weatherLinkHostLabel ? `View full weather forecast at ${weatherLinkHostLabel} →` : 'View full weather forecast source →';
  const safeAvalancheLink = sanitizeExternalUrl(safetyData?.avalanche.link);
  const safeRainfallLink = sanitizeExternalUrl(safetyData?.rainfall?.link || undefined);
  const safeSnotelLink = sanitizeExternalUrl(safetyData?.snowpack?.snotel?.link || undefined);
  const safeNohrscLink = sanitizeExternalUrl(safetyData?.snowpack?.nohrsc?.link || undefined);
  const rainfallTotals = safetyData?.rainfall?.totals || null;
  const rainfall12hIn = parseOptionalFiniteNumber(rainfallTotals?.rainPast12hIn ?? rainfallTotals?.past12hIn);
  const rainfall24hIn = parseOptionalFiniteNumber(rainfallTotals?.rainPast24hIn ?? rainfallTotals?.past24hIn);
  const rainfall48hIn = parseOptionalFiniteNumber(rainfallTotals?.rainPast48hIn ?? rainfallTotals?.past48hIn);
  const rainfall12hMm = parseOptionalFiniteNumber(rainfallTotals?.rainPast12hMm ?? rainfallTotals?.past12hMm);
  const rainfall24hMm = parseOptionalFiniteNumber(rainfallTotals?.rainPast24hMm ?? rainfallTotals?.past24hMm);
  const rainfall48hMm = parseOptionalFiniteNumber(rainfallTotals?.rainPast48hMm ?? rainfallTotals?.past48hMm);
  const snowfall12hIn = parseOptionalFiniteNumber(rainfallTotals?.snowPast12hIn);
  const snowfall24hIn = parseOptionalFiniteNumber(rainfallTotals?.snowPast24hIn);
  const snowfall48hIn = parseOptionalFiniteNumber(rainfallTotals?.snowPast48hIn);
  const snowfall12hCm = parseOptionalFiniteNumber(rainfallTotals?.snowPast12hCm);
  const snowfall24hCm = parseOptionalFiniteNumber(rainfallTotals?.snowPast24hCm);
  const snowfall48hCm = parseOptionalFiniteNumber(rainfallTotals?.snowPast48hCm);
  const rainfall24hSeverityClass =
    Number.isFinite(rainfall24hIn) && rainfall24hIn >= 0.6
      ? 'nogo'
      : Number.isFinite(rainfall24hIn) && rainfall24hIn >= 0.25
        ? 'caution'
        : Number.isFinite(rainfall24hIn)
          ? 'go'
          : 'watch';
  const rainfallWindowSummary = [
    formatRainAmountForElevationUnit(rainfall12hIn, rainfall12hMm, preferences.elevationUnit),
    formatRainAmountForElevationUnit(rainfall24hIn, rainfall24hMm, preferences.elevationUnit),
    formatRainAmountForElevationUnit(rainfall48hIn, rainfall48hMm, preferences.elevationUnit),
  ].join(' / ');
  const snowfallWindowSummary = [
    formatSnowfallAmountForElevationUnit(snowfall12hIn, snowfall12hCm, preferences.elevationUnit),
    formatSnowfallAmountForElevationUnit(snowfall24hIn, snowfall24hCm, preferences.elevationUnit),
    formatSnowfallAmountForElevationUnit(snowfall48hIn, snowfall48hCm, preferences.elevationUnit),
  ].join(' / ');
  const terrainPrecipContextLine = `Rain 12h/24h/48h: ${rainfallWindowSummary} • Snowfall 12h/24h/48h: ${snowfallWindowSummary}`;
  const rainfall12hDisplay = formatRainAmountForElevationUnit(rainfall12hIn, rainfall12hMm, preferences.elevationUnit);
  const rainfall24hDisplay = formatRainAmountForElevationUnit(rainfall24hIn, rainfall24hMm, preferences.elevationUnit);
  const rainfall48hDisplay = formatRainAmountForElevationUnit(rainfall48hIn, rainfall48hMm, preferences.elevationUnit);
  const snowfall12hDisplay = formatSnowfallAmountForElevationUnit(snowfall12hIn, snowfall12hCm, preferences.elevationUnit);
  const snowfall24hDisplay = formatSnowfallAmountForElevationUnit(snowfall24hIn, snowfall24hCm, preferences.elevationUnit);
  const snowfall48hDisplay = formatSnowfallAmountForElevationUnit(snowfall48hIn, snowfall48hCm, preferences.elevationUnit);
  const rainfallExpected = safetyData?.rainfall?.expected || null;
  const expectedTravelWindowHoursRaw = Number(rainfallExpected?.travelWindowHours);
  const expectedTravelWindowHours = Number.isFinite(expectedTravelWindowHoursRaw) ? Math.max(1, Math.round(expectedTravelWindowHoursRaw)) : travelWindowHours;
  const expectedRainWindowIn = parseOptionalFiniteNumber(rainfallExpected?.rainWindowIn);
  const expectedRainWindowMm = parseOptionalFiniteNumber(rainfallExpected?.rainWindowMm);
  const expectedSnowWindowIn = parseOptionalFiniteNumber(rainfallExpected?.snowWindowIn);
  const expectedSnowWindowCm = parseOptionalFiniteNumber(rainfallExpected?.snowWindowCm);
  const expectedRainWindowDisplay = formatRainAmountForElevationUnit(expectedRainWindowIn, expectedRainWindowMm, preferences.elevationUnit);
  const expectedSnowWindowDisplay = formatSnowfallAmountForElevationUnit(expectedSnowWindowIn, expectedSnowWindowCm, preferences.elevationUnit);
  const expectedPrecipDataAvailable =
    Number.isFinite(expectedRainWindowIn) ||
    Number.isFinite(expectedRainWindowMm) ||
    Number.isFinite(expectedSnowWindowIn) ||
    Number.isFinite(expectedSnowWindowCm);
  const expectedPrecipSummaryLine = expectedPrecipDataAvailable
    ? `Expected in next ${expectedTravelWindowHours}h: rain ${expectedRainWindowDisplay} • snow ${expectedSnowWindowDisplay}.`
    : `Expected precipitation totals are unavailable for the next ${expectedTravelWindowHours}h window.`;
  const rainfallModeLabel =
    safetyData?.rainfall?.mode === 'projected_for_selected_start'
      ? 'Projected around selected start'
      : safetyData?.rainfall?.mode === 'observed_recent'
        ? 'Observed recent accumulation'
        : 'Mode unavailable';
  const rainfallStatus = String(safetyData?.rainfall?.status || '').toLowerCase();
  const rainfallDataAvailable = rainfallStatus === 'ok' || rainfallStatus === 'partial';
  const rainfallNoteLine =
    (typeof safetyData?.rainfall?.note === 'string' && safetyData.rainfall.note.trim()) ||
    (rainfallDataAvailable
      ? safetyData?.rainfall?.mode === 'projected_for_selected_start'
        ? 'Rolling rain and snowfall totals are anchored to selected start time and can include forecast hours.'
        : 'Rolling rain and snowfall totals are based on recent hours prior to the selected period.'
      : 'Rolling rain/snow totals unavailable for this objective/time.');
  const expectedPrecipNoteLine =
    (typeof rainfallExpected?.note === 'string' && rainfallExpected.note.trim()) ||
    `Expected precipitation totals for the next ${expectedTravelWindowHours}h from selected start time.`;
  const precipInsightLine = (() => {
    const rain24 = Number.isFinite(rainfall24hIn) ? rainfall24hIn : null;
    const snow24 = Number.isFinite(snowfall24hIn) ? snowfall24hIn : null;
    const hasAny24hSignal = rain24 !== null || snow24 !== null;
    const no24hPrecipSignal =
      hasAny24hSignal &&
      (rain24 === null || rain24 <= 0.01) &&
      (snow24 === null || snow24 <= 0.01);
    if (rain24 !== null && rain24 >= 0.6 && snow24 !== null && snow24 >= 2) {
      return `Mixed precip signal: 24h rain ${rainfall24hDisplay} plus 24h snow ${snowfall24hDisplay}.`;
    }
    if (rain24 !== null && rain24 >= 0.6) {
      return `Strong rain signal: 24h rain ${rainfall24hDisplay}. Expect wetter, softer footing.`;
    }
    if (snow24 !== null && snow24 >= 4) {
      return `Strong snow signal: 24h snow ${snowfall24hDisplay}. Fresh coverage likely.`;
    }
    if (rain24 !== null && rain24 >= 0.25) {
      return `Moderate rain signal: 24h rain ${rainfall24hDisplay}. Slick/muddy sections are likely.`;
    }
    if (snow24 !== null && snow24 >= 1.5) {
      return `Moderate snow signal: 24h snow ${snowfall24hDisplay}. Patchy fresh snow likely.`;
    }
    if (no24hPrecipSignal) {
      return `No recent precip signal: 24h rain ${rainfall24hDisplay} • 24h snow ${snowfall24hDisplay}.`;
    }
    if (rain24 !== null || snow24 !== null) {
      return `Light recent precip: 24h rain ${rainfall24hDisplay} • 24h snow ${snowfall24hDisplay}.`;
    }
    return 'Recent rain/snow totals are unavailable for this objective/time.';
  })();
  const snotelSweDisplay = formatSweForElevationUnit(Number(safetyData?.snowpack?.snotel?.sweIn), preferences.elevationUnit);
  const snotelDepthDisplay = formatSnowDepthForElevationUnit(Number(safetyData?.snowpack?.snotel?.snowDepthIn), preferences.elevationUnit);
  const nohrscSweDisplay = formatSweForElevationUnit(Number(safetyData?.snowpack?.nohrsc?.sweIn), preferences.elevationUnit);
  const nohrscDepthDisplay = formatSnowDepthForElevationUnit(Number(safetyData?.snowpack?.nohrsc?.snowDepthIn), preferences.elevationUnit);
  const snotelDistanceDisplay = formatDistanceForElevationUnit(Number(safetyData?.snowpack?.snotel?.distanceKm), preferences.elevationUnit);
  const snotelDepthIn = Number(safetyData?.snowpack?.snotel?.snowDepthIn);
  const nohrscDepthIn = Number(safetyData?.snowpack?.nohrsc?.snowDepthIn);
  const snotelSweIn = Number(safetyData?.snowpack?.snotel?.sweIn);
  const nohrscSweIn = Number(safetyData?.snowpack?.nohrsc?.sweIn);
  const snowpackMetricAvailable =
    Number.isFinite(snotelDepthIn) ||
    Number.isFinite(nohrscDepthIn) ||
    Number.isFinite(snotelSweIn) ||
    Number.isFinite(nohrscSweIn);
  const maxSnowDepthSignalIn = Math.max(Number.isFinite(snotelDepthIn) ? snotelDepthIn : 0, Number.isFinite(nohrscDepthIn) ? nohrscDepthIn : 0);
  const maxSnowSweSignalIn = Math.max(Number.isFinite(snotelSweIn) ? snotelSweIn : 0, Number.isFinite(nohrscSweIn) ? nohrscSweIn : 0);
  const lowBroadSnowSignal = snowpackMetricAvailable && maxSnowDepthSignalIn <= 1 && maxSnowSweSignalIn <= 0.2;
  const snowpackPillClass = lowBroadSnowSignal
    ? 'go'
    : safetyData?.snowpack?.status === 'ok'
      ? 'go'
      : safetyData?.snowpack?.status === 'partial'
        ? 'watch'
        : 'caution';
  const snowpackStatusLabel = lowBroadSnowSignal ? 'Low snow signal' : String(safetyData?.snowpack?.status || 'unavailable').toUpperCase();
  const snowpackInterpretation = safetyData
    ? buildSnowpackInterpretation(safetyData.snowpack, Number(safetyData.weather?.elevation), preferences.elevationUnit)
    : null;
  const snowpackInsights = safetyData
    ? buildSnowpackInsights(safetyData.snowpack, Number(safetyData.weather?.elevation), preferences.elevationUnit)
    : null;
  const snowpackTakeaways = (() => {
    if (!safetyData) {
      return [] as string[];
    }
    const notes: string[] = [];
    if (!snowpackMetricAvailable) {
      notes.push('No reliable snowpack metrics returned. Keep uncertainty high and verify terrain conditions directly.');
      return notes;
    }

    if (lowBroadSnowSignal) {
      notes.push('Broad snow signal is minimal. Non-snow travel is more likely, but shaded gullies and icy pockets can persist.');
    } else if (maxSnowDepthSignalIn >= 24 || maxSnowSweSignalIn >= 8) {
      notes.push('Substantial snowpack signal exists. Assume avalanche terrain remains consequential at and above treeline.');
    } else {
      notes.push('Measurable snowpack is present. Expect mixed coverage and elevation-dependent conditions.');
    }

    if (Number.isFinite(snowfall24hIn) && snowfall24hIn >= 4) {
      notes.push(`Recent snowfall is meaningful (${snowfall24hDisplay} in 24h). Treat prior tracks and old assumptions as stale.`);
    } else if (Number.isFinite(rainfall24hIn) && rainfall24hIn >= 0.5 && maxSnowDepthSignalIn >= 4) {
      notes.push(`Rain-on-snow signal (${rainfall24hDisplay} rain in 24h) can rapidly weaken surface conditions.`);
    }

    if (snowpackInsights?.agreement.tone === 'warn') {
      notes.push('SNOTEL and NOHRSC disagree strongly. Plan for localized variability and confirm conditions as you move.');
    } else if (snowpackInsights?.representativeness.tone === 'warn') {
      notes.push('Nearest SNOTEL may not represent your objective well due to distance/elevation mismatch.');
    } else if (snowpackInsights?.freshness.tone === 'warn') {
      notes.push('Snowpack timestamps are stale. Re-check center products before departure.');
    }

    return notes.slice(0, 3);
  })();
  const snowpackObservationContext = safetyData
    ? (() => {
        const parts = [
          safetyData.snowpack?.snotel?.observedDate ? `SNOTEL obs ${safetyData.snowpack.snotel.observedDate}` : null,
          safetyData.snowpack?.nohrsc?.sampledTime
            ? `NOHRSC sample ${formatForecastPeriodLabel(safetyData.snowpack.nohrsc.sampledTime, safetyData.weather.timezone || null)}`
            : null,
        ].filter(Boolean) as string[];
        if (parts.length === 0) {
          return 'Using latest available snowpack observations.';
        }
        return `Using observations: ${parts.join(' • ')}`;
      })()
    : '';
  const fireRiskLevel = Number(safetyData?.fireRisk?.level);
  const fireRiskLabel = safetyData?.fireRisk?.label || 'Low';
  const fireRiskPillClass = !Number.isFinite(fireRiskLevel)
    ? 'caution'
    : fireRiskLevel >= 4
      ? 'nogo'
      : fireRiskLevel >= 3
        ? 'caution'
        : fireRiskLevel >= 2
          ? 'watch'
          : 'go';
  const fireRiskAlerts = safetyData?.fireRisk?.alertsConsidered || [];
  const heatRiskLevel = (() => {
    const payloadLevel = Number(safetyData?.heatRisk?.level);
    if (Number.isFinite(payloadLevel)) {
      return Math.max(0, Math.min(4, Math.round(payloadLevel)));
    }
    const feelsLike = Number(safetyData?.weather.feelsLike ?? safetyData?.weather.temp);
    if (Number.isFinite(feelsLike) && feelsLike >= 100) return 4;
    if (Number.isFinite(feelsLike) && feelsLike >= 92) return 3;
    if (Number.isFinite(feelsLike) && feelsLike >= 84) return 2;
    if (Number.isFinite(feelsLike) && feelsLike >= 76) return 1;
    return 0;
  })();
  const heatRiskLabel = safetyData?.heatRisk?.label || ['Low', 'Guarded', 'Elevated', 'High', 'Extreme'][heatRiskLevel];
  const heatRiskPillClass =
    heatRiskLevel >= 4 ? 'nogo'
      : heatRiskLevel >= 2 ? 'caution'
        : heatRiskLevel >= 1 ? 'watch'
          : 'go';
  const heatRiskGuidance =
    safetyData?.heatRisk?.guidance ||
    (heatRiskLevel >= 4
      ? 'Extreme heat-stress risk. Avoid long exposed pushes during this window.'
      : heatRiskLevel >= 3
        ? 'High heat-stress risk. Increase water, shorten pushes, and add cooling breaks.'
        : heatRiskLevel >= 2
          ? 'Heat stress is possible. Use conservative pace and hydration.'
          : heatRiskLevel >= 1
            ? 'Warm conditions possible; monitor hydration and pace.'
            : 'No notable heat signal from current forecast inputs.');
  const heatRiskReasons = Array.isArray(safetyData?.heatRisk?.reasons) && safetyData.heatRisk.reasons.length > 0
    ? safetyData.heatRisk.reasons.slice(0, 4)
    : [];
  const heatRiskMetrics = safetyData?.heatRisk?.metrics || {};
  const lowerTerrainHeatLabel = (() => {
    const label = String(heatRiskMetrics.lowerTerrainLabel || '').trim();
    const elevationFt = Number(heatRiskMetrics.lowerTerrainElevationFt);
    if (!label && !Number.isFinite(elevationFt)) {
      return null;
    }
    if (label && Number.isFinite(elevationFt)) {
      return `${label} (${formatElevationDisplay(elevationFt)})`;
    }
    return label || formatElevationDisplay(elevationFt);
  })();
  const weatherEmoji = safetyData ? weatherConditionEmoji(safetyData.weather.description, safetyData.weather.isDaytime) : '';
  const weatherWithEmoji = safetyData ? `${weatherEmoji} ${safetyData.weather.description}` : '';
  const mapWeatherEmoji = safetyData ? weatherConditionEmoji(safetyData.weather.description, safetyData.weather.isDaytime) : '🌤️';
  const mapWeatherTempLabel = safetyData ? formatTempDisplay(safetyData.weather.temp) : loading ? 'Loading…' : 'N/A';
  const mapWeatherConditionLabel = safetyData
    ? truncateText(safetyData.weather.description || 'Conditions unavailable', 34)
    : loading
      ? 'Fetching forecast'
      : 'Conditions unavailable';
  const mapWeatherChipTitle = safetyData
    ? [
        `${formatTempDisplay(safetyData.weather.temp)} (feels ${formatTempDisplay(safetyData.weather.feelsLike ?? safetyData.weather.temp)})`,
        safetyData.weather.description || 'Conditions unavailable',
      ].join(' • ')
    : 'Forecast not loaded';
  const mapObjectiveElevationFt = safetyData ? Number(safetyData.weather.elevation) : Number.NaN;
  const hasMapObjectiveElevation = Number.isFinite(mapObjectiveElevationFt) && mapObjectiveElevationFt > 0;
  const mapElevationLabel = hasMapObjectiveElevation ? formatElevationDisplay(mapObjectiveElevationFt) : loading ? 'Loading…' : 'N/A';
  const mapElevationChipTitle = hasMapObjectiveElevation
    ? [formatElevationDisplay(mapObjectiveElevationFt), safetyData?.weather.elevationSource || null].filter(Boolean).join(' • ')
    : 'Objective elevation unavailable';
  const forecastPeriodLabel = safetyData
    ? formatForecastPeriodLabel(safetyData.weather.forecastStartTime || null, safetyData.weather.timezone || null)
    : 'Not available';
  const weatherWindDirectionLabel = normalizeWindHintDirection(safetyData?.weather.windDirection || null) || 'N/A';
  const weatherCloudCoverLabel = Number.isFinite(Number(safetyData?.weather.cloudCover))
    ? `${Math.round(Number(safetyData?.weather.cloudCover))}%`
    : 'N/A';
  const satObjectiveLabel = truncateText((objectiveName || 'Objective').split(',')[0].trim(), 22);
  const satAvalancheSnippet =
    !safetyData
      ? 'avy n/a'
      : !avalancheRelevant
        ? 'avy n/a'
        : avalancheUnknown
          ? 'avy unk'
          : `avy L${normalizeDangerLevel(safetyData.avalanche.dangerLevel)}`;
  const satWorst12hSnippet = (() => {
    if (!worstTravelWindowRow) {
      return 'worst12h n/a';
    }
    const peakHour = formatClockForStyle(worstTravelWindowRow.time, preferences.timeStyle).replace(/\s+/g, '');
    const peakFeelsLike = Number.isFinite(Number(worstTravelWindowRow.feelsLike))
      ? Number(worstTravelWindowRow.feelsLike)
      : computeFeelsLikeF(Number(worstTravelWindowRow.temp), Number(worstTravelWindowRow.wind));
    const peakPrecip = Number.isFinite(Number(worstTravelWindowRow.precipChance))
      ? Math.round(Number(worstTravelWindowRow.precipChance))
      : Number.isFinite(Number(worstTravelWindowCritical?.precipChance))
        ? Math.round(Number(worstTravelWindowCritical?.precipChance))
        : 0;
    const failedHazards = worstTravelWindowRow.failedRuleLabels
      .map((label) => {
        if (label === 'Gust above limit') return 'gust';
        if (label === 'Precip above limit') return 'precip';
        if (label === 'Feels-like below limit') return 'cold';
        return '';
      })
      .filter(Boolean)
      .slice(0, 2);
    const peakHazard =
      failedHazards.length > 0
        ? failedHazards.join('+')
        : worstTravelWindowCritical?.reasons?.[0]
          ? localizeUnitText(worstTravelWindowCritical.reasons[0])
          : criticalRiskLevelText(worstTravelWindowCritical?.level || 'stable').toLowerCase();
    return collapseWhitespace(
      `worst12h ${peakHour} ${peakHazard} f${formatTempDisplay(peakFeelsLike)} g${formatWindDisplay(worstTravelWindowRow.gust)} p${peakPrecip}%`,
    );
  })();
  const satelliteConditionLine =
    safetyData && decision
      ? truncateText(
          collapseWhitespace(
            `${satObjectiveLabel} ${safetyData.forecast?.selectedDate || forecastDate} ${displayStartTime} | ${formatTempDisplay(
              safetyData.weather.temp,
            )} f${formatTempDisplay(safetyData.weather.feelsLike ?? safetyData.weather.temp)} | w${formatWindDisplay(
              safetyData.weather.windSpeed,
            )} g${formatWindDisplay(safetyData.weather.windGust)} p${safetyData.weather.precipChance}% | ${satWorst12hSnippet} | ${satAvalancheSnippet} | ${decision.level}`,
          ),
          170,
        )
      : '';
  const dangerSummaryText =
    !safetyData
      ? 'Unknown'
      : !avalancheRelevant
        ? 'Not primary for this objective'
        : !avalancheUnknown
          ? `L${normalizeDangerLevel(safetyData.avalanche.dangerLevel)} ${getDangerText(normalizeDangerLevel(safetyData.avalanche.dangerLevel))}`
          : 'Unknown (no official center coverage)';
  const daylightBufferMinutes = 30;
  const startMinutesForPlan = parseTimeInputMinutes(alpineStartTime);
  const sunriseMinutesForPlan = safetyData ? parseSolarClockMinutes(safetyData.solar.sunrise) : null;
  const sunsetMinutesForPlan = safetyData ? parseSolarClockMinutes(safetyData.solar.sunset) : null;
  const daylightRemainingFromStartMinutes =
    startMinutesForPlan !== null && sunriseMinutesForPlan !== null && sunsetMinutesForPlan !== null
      ? Math.max(0, sunsetMinutesForPlan - Math.max(startMinutesForPlan, sunriseMinutesForPlan))
      : null;
  const daylightRemainingFromStartLabel =
    daylightRemainingFromStartMinutes !== null
      ? startMinutesForPlan !== null && sunsetMinutesForPlan !== null && startMinutesForPlan >= sunsetMinutesForPlan
        ? `${formatDurationMinutes(daylightRemainingFromStartMinutes)} (start is after sunset)`
        : startMinutesForPlan !== null && sunriseMinutesForPlan !== null && startMinutesForPlan < sunriseMinutesForPlan
          ? `${formatDurationMinutes(daylightRemainingFromStartMinutes)} (start before sunrise)`
          : formatDurationMinutes(daylightRemainingFromStartMinutes)
      : 'N/A';
  const daylightMarginMinutes = sunsetMinutesForPlan !== null && cutoffMinutes !== null ? sunsetMinutesForPlan - cutoffMinutes : null;
  const daylightBriefLine = safetyData
    ? daylightMarginMinutes !== null
      ? `Conservative daylight margin is ${formatMinutesRelativeToSunset(daylightMarginMinutes, daylightBufferMinutes)}.`
      : `Sunset ${formatClockShort(safetyData.solar.sunset, preferences.timeStyle)}; keep at least ${daylightBufferMinutes} min daylight buffer.`
    : '';
  const fieldBriefSnapshot = safetyData
    ? [
        `Forecast ${safetyData.forecast?.selectedDate || forecastDate}: ${weatherWithEmoji}.`,
        `Temp ${formatTempDisplay(safetyData.weather.temp)} (feels ${formatTempDisplay(
          safetyData.weather.feelsLike ?? safetyData.weather.temp,
        )}), wind ${formatWindDisplay(safetyData.weather.windSpeed)}, gust ${formatWindDisplay(safetyData.weather.windGust)}.`,
        Number.isFinite(rainfall24hIn) || Number.isFinite(snowfall24hIn)
          ? `Recent precip (24h): rain ${rainfall24hDisplay}${Number.isFinite(snowfall24hIn) ? `, snowfall ${snowfall24hDisplay}` : ''}.`
          : '',
        `Avalanche ${dangerSummaryText}${safetyData.avalanche.center ? ` • ${safetyData.avalanche.center}` : ''}.`,
        daylightBriefLine,
      ].filter(Boolean)
    : [];
  const snowpackDepthSignalValues = [
    Number(safetyData?.snowpack?.snotel?.snowDepthIn),
    Number(safetyData?.snowpack?.nohrsc?.snowDepthIn),
  ].filter((value) => Number.isFinite(value) && value > 0);
  const snowpackSweSignalValues = [
    Number(safetyData?.snowpack?.snotel?.sweIn),
    Number(safetyData?.snowpack?.nohrsc?.sweIn),
  ].filter((value) => Number.isFinite(value) && value > 0);
  const hasSnowpackSignal = snowpackDepthSignalValues.length > 0 || snowpackSweSignalValues.length > 0;
  const hasWintryWeatherSignal = safetyData
    ? /snow|sleet|ice|freezing|blizzard|flurr|graupel|rime|wintry/.test(String(safetyData.weather.description || '').toLowerCase()) ||
      (Number.isFinite(Number(safetyData.weather.temp)) && Number(safetyData.weather.temp) <= 34)
    : false;
  const shouldUseSnowAbortTriggers = Boolean(safetyData) && (avalancheRelevant || hasSnowpackSignal || hasWintryWeatherSignal);
  const defaultAbortTriggers = [
    ...(shouldUseSnowAbortTriggers
      ? [
          'Abort if signs of slab instability or active loading appear.',
          'Abort if ridge wind exposure exceeds team stability limits.',
        ]
      : [
          'Abort if surface conditions degrade beyond team traction/footing limits.',
          'Abort if sustained wind exposure exceeds team terrain limits on open ridges/slabs.',
        ]),
    'Abort if daylight margin begins collapsing.',
  ];
  const fieldBriefAbortTriggers = decision
    ? (decision.blockers.length > 0 ? decision.blockers.slice(0, 3) : defaultAbortTriggers)
    : [];
  const fieldBriefActions = decision
    ? [
        `Re-check latest weather and avalanche products before departure at ${displayStartTime}.`,
        'Push SAT one-liner to your support contact.',
        decision.level === 'GO'
          ? 'Proceed only if observed conditions match forecast; reassess at first exposed checkpoint.'
          : 'Use a shorter/lower-angle backup objective and enforce conservative turn-around timing.',
      ]
    : [];
  const fieldBriefHeadline = decision
    ? decision.level === 'NO-GO'
      ? 'Do not commit to this objective window. Switch to a safer alternative or delay.'
      : decision.level === 'CAUTION'
        ? 'Proceed only with conservative terrain choices and strict timing discipline.'
        : 'Conditions are within plan limits. Execute with routine risk controls.'
    : '';
  const fieldBriefPrimaryReason = decision
    ? decision.level === 'NO-GO'
      ? decision.blockers[0] || 'High-likelihood failure modes detected. Delay or choose a safer objective.'
      : decision.level === 'CAUTION'
        ? decision.cautions[0] || 'Conservative execution is recommended for this window.'
        : 'No dominant blocker in current model outputs.'
    : '';
  const fieldBriefTopRisks = decision
    ? (decision.blockers.length > 0 ? decision.blockers : decision.cautions).slice(0, 3)
    : [];
  const fieldBriefImmediateActions = fieldBriefActions.slice(0, 2);
  const fieldBriefAtAGlance = safetyData
    ? [
        { label: 'Start', value: displayStartTime },
        { label: 'Daylight left', value: daylightRemainingFromStartLabel },
        { label: 'Surface', value: safetyData.terrainCondition?.label || safetyData.trail || 'Unknown' },
        { label: 'Avalanche', value: dangerSummaryText },
        { label: 'Safety score', value: `${safetyData.safety.score}%` },
      ]
    : [];
  const decisionFailingChecks = decision ? decision.checks.filter((check) => !check.ok) : [];
  const decisionPassingChecksCount = decision ? decision.checks.filter((check) => check.ok).length : 0;
  const decisionActionLine = decision
    ? decision.level === 'NO-GO'
      ? 'Do not commit to this objective window. Move to a safer backup objective or delay.'
      : decision.level === 'CAUTION'
        ? 'Proceed only on conservative terrain with strict timing and explicit abort triggers.'
        : 'Proceed with normal controls and continue checkpoint-based reassessment.'
    : '';
  const decisionKeyDrivers = decision
    ? decision.blockers.length > 0
      ? decision.blockers.slice(0, 3)
      : decision.cautions.length > 0
        ? decision.cautions.slice(0, 3)
        : decision.checks
            .filter((check) => check.ok)
            .slice(0, 3)
            .map((check) => check.label)
    : [];
  const fieldBriefExecutionSteps = decision
    ? [
        `Pre-departure (${displayStartTime}): confirm latest weather, avalanche, alerts, and route assumptions before leaving.`,
        decision.level === 'GO'
          ? 'On-route: continue only while observed wind, snowpack, and trail surface match forecast expectations.'
          : 'On-route: bias to lower-angle / lower-consequence terrain and shorten commitments between safe decision points.',
        `Abort immediately if ${String(fieldBriefAbortTriggers[0] || 'daylight margin begins collapsing')
          .replace(/^Abort if\s+/i, '')
          .replace(/\.$/, '')}.`,
      ]
    : [];
  const objectiveTimezone = safetyData?.weather.timezone || null;
  const deviceTimezone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone || null : null;
  const timezoneMismatch = Boolean(objectiveTimezone && deviceTimezone && objectiveTimezone !== deviceTimezone);
  const handleUseNowConditions = () => {
    const nowInputs = currentDateTimeInputs(objectiveTimezone);
    const nextDate = normalizeForecastDate(nowInputs.date, todayDate, maxForecastDate);
    setForecastDate(nextDate);
    setAlpineStartTime(nowInputs.time);
    setError(null);

    if (hasObjective && view === 'planner') {
      void fetchSafetyData(position.lat, position.lng, nextDate, nowInputs.time, { force: true });
    }
  };
  const alertsStatus = safetyData?.alerts?.status || null;
  const alertsNoActiveForSelectedTime = alertsStatus === 'none' || alertsStatus === 'none_for_selected_start';
  const selectedTravelWindowMs = resolveSelectedTravelWindowMs(safetyData, travelWindowHours);
  const alertsWindowCovered = isTravelWindowCoveredByAlertWindow(selectedTravelWindowMs, safetyData?.alerts?.alerts || []);
  const reportGeneratedAt = safetyData?.generatedAt || null;
  const weatherFreshnessTimestamp = safetyData
    ? pickOldestIsoTimestamp([
        safetyData.weather.issuedTime || null,
        safetyData.weather.forecastStartTime || null,
      ])
    : null;
  const avalancheFreshnessTimestamp = safetyData
    ? pickOldestIsoTimestamp([
        safetyData.avalanche.publishedTime || null,
      ])
    : null;
  const alertsFreshnessTimestamp = safetyData
    ? pickNewestIsoTimestamp(
        (safetyData.alerts?.alerts || []).flatMap((alert) => [
          alert.sent || null,
          alert.effective || null,
          alert.onset || null,
        ]),
      )
    : null;
  const airQualityFreshnessTimestamp = safetyData
    ? pickOldestIsoTimestamp([
        safetyData.airQuality?.measuredTime || null,
      ])
    : null;
  const precipitationFreshnessTimestamp = safetyData
    ? pickOldestIsoTimestamp([
        safetyData.rainfall?.anchorTime || null,
        safetyData.rainfall?.issuedTime || null,
      ])
    : null;
  const snowpackFreshness = classifySnowpackFreshness(
    safetyData?.snowpack?.snotel?.observedDate || null,
    safetyData?.snowpack?.nohrsc?.sampledTime || null,
  );
  const snowpackFreshnessTimestamp = snowpackFreshness.referenceTimestamp;
  const sourceFreshnessRows = safetyData
    ? [
        { label: 'Weather', issued: weatherFreshnessTimestamp, staleHours: 12 },
        ...(avalancheRelevant
          ? [
              {
                label: 'Avalanche',
                issued: avalancheFreshnessTimestamp,
                staleHours: 24,
              },
            ]
          : []),
        {
          label: 'Alerts',
          issued: alertsFreshnessTimestamp,
          staleHours: 6,
          displayValue: alertsNoActiveForSelectedTime ? 'No active' : alertsWindowCovered ? 'Window covered' : undefined,
          stateOverride: alertsNoActiveForSelectedTime || alertsWindowCovered ? ('fresh' as const) : undefined,
        },
        { label: 'Air Quality', issued: airQualityFreshnessTimestamp, staleHours: 8 },
        {
          label: 'Precipitation',
          issued: precipitationFreshnessTimestamp,
          staleHours: 8,
        },
        {
          label: 'Snowpack',
          issued: snowpackFreshnessTimestamp,
          staleHours: 30,
          displayValue: snowpackFreshness.displayValue,
          stateOverride: snowpackFreshness.state,
        },
      ]
    : [];
  const nwsAlerts = safetyData?.alerts?.alerts || [];
  const nwsAlertCount = safetyData?.alerts?.activeCount ?? nwsAlerts.length;
  const nwsTotalAlertCount = safetyData?.alerts?.totalActiveCount ?? nwsAlertCount;
  const nwsTopAlerts = nwsAlerts.slice(0, 3);
  const weatherFieldSources = safetyData?.weather.sourceDetails?.fieldSources || {};
  const weatherSourceLabel = inferWeatherSourceLabel(safetyData?.weather);
  const weatherSourceDisplay =
    safetyData?.weather.sourceDetails?.blended && weatherSourceLabel === 'NOAA / Weather.gov'
      ? 'NOAA / Weather.gov + Open-Meteo'
      : weatherSourceLabel;
  const primaryWindDirection = normalizeWindHintDirection(safetyData?.weather.windDirection || null);
  const windTrendRows = Array.isArray(safetyData?.weather.trend) ? safetyData.weather.trend.slice(0, 12) : [];
  const trendWindDirections = Array.isArray(safetyData?.weather.trend)
    ? safetyData.weather.trend
        .map((point) => normalizeWindHintDirection(point?.windDirection || null))
        .filter((entry): entry is string => Boolean(entry))
    : [];
  const directionalTrendWindDirections = trendWindDirections.filter((entry) => entry !== 'CALM' && entry !== 'VRB');
  const dominantTrendDirection = resolveDominantTrendWindDirection(safetyData?.weather.trend || []);
  const resolvedWindDirection =
    primaryWindDirection && primaryWindDirection !== 'CALM' && primaryWindDirection !== 'VRB'
      ? primaryWindDirection
      : dominantTrendDirection.direction;
  const resolvedWindDirectionSource =
    primaryWindDirection && primaryWindDirection !== 'CALM' && primaryWindDirection !== 'VRB'
      ? 'Selected start hour'
      : dominantTrendDirection.direction
        ? `Trend consensus (${dominantTrendDirection.count}/${dominantTrendDirection.total}h)`
        : 'Unavailable';
  const leewardAspectHints = resolvedWindDirection ? leewardAspectsFromWind(resolvedWindDirection) : [];
  const secondaryWindAspects = resolvedWindDirection ? secondaryCrossLoadingAspects(resolvedWindDirection) : [];
  const windSpeedMph = Number(safetyData?.weather.windSpeed);
  const windGustMph = Number(safetyData?.weather.windGust);
  const calmOrVariableSignal = primaryWindDirection === 'CALM' || primaryWindDirection === 'VRB';
  const lightWindSignal =
    Number.isFinite(windSpeedMph) &&
    Number.isFinite(windGustMph) &&
    windSpeedMph <= 5 &&
    windGustMph <= 10;
  const windTransportHours = windTrendRows.filter((point) => {
    const trendWind = Number(point?.wind);
    const trendGust = Number(point?.gust);
    return (Number.isFinite(trendWind) && trendWind >= 12) || (Number.isFinite(trendGust) && trendGust >= 18);
  }).length;
  const activeTransportHours = windTrendRows.filter((point) => {
    const trendWind = Number(point?.wind);
    const trendGust = Number(point?.gust);
    return (Number.isFinite(trendWind) && trendWind >= 18) || (Number.isFinite(trendGust) && trendGust >= 28);
  }).length;
  const severeTransportHours = windTrendRows.filter((point) => {
    const trendWind = Number(point?.wind);
    const trendGust = Number(point?.gust);
    return (Number.isFinite(trendWind) && trendWind >= 25) || (Number.isFinite(trendGust) && trendGust >= 38);
  }).length;
  const trendDirectionalCoverageRatio =
    trendWindDirections.length > 0 ? directionalTrendWindDirections.length / trendWindDirections.length : null;
  const trendAgreementRatio =
    resolvedWindDirection && directionalTrendWindDirections.length > 0
      ? directionalTrendWindDirections.filter((direction) => {
          const delta = windDirectionDeltaDegrees(direction, resolvedWindDirection);
          return delta !== null && delta <= 45;
        }).length / directionalTrendWindDirections.length
      : null;
  const windLoadingLevel: 'Minimal' | 'Localized' | 'Active' | 'Severe' = (() => {
    if (!safetyData || calmOrVariableSignal || lightWindSignal) {
      return 'Minimal';
    }
    if (
      (Number.isFinite(windSpeedMph) && windSpeedMph >= 28) ||
      (Number.isFinite(windGustMph) && windGustMph >= 40) ||
      severeTransportHours >= 2
    ) {
      return 'Severe';
    }
    if (
      (Number.isFinite(windSpeedMph) && windSpeedMph >= 20) ||
      (Number.isFinite(windGustMph) && windGustMph >= 30) ||
      activeTransportHours >= 2
    ) {
      return 'Active';
    }
    if (
      (Number.isFinite(windSpeedMph) && windSpeedMph >= 12) ||
      (Number.isFinite(windGustMph) && windGustMph >= 18) ||
      windTransportHours >= 1
    ) {
      return 'Localized';
    }
    return 'Minimal';
  })();
  const windLoadingConfidence: 'High' | 'Moderate' | 'Low' = (() => {
    if (!safetyData || windLoadingLevel === 'Minimal' || !resolvedWindDirection) {
      return 'Low';
    }
    if (
      trendAgreementRatio !== null &&
      trendAgreementRatio >= 0.7 &&
      trendDirectionalCoverageRatio !== null &&
      trendDirectionalCoverageRatio >= 0.5 &&
      ((Number.isFinite(windSpeedMph) && windSpeedMph >= 14) || (Number.isFinite(windGustMph) && windGustMph >= 22))
    ) {
      return 'High';
    }
    if (
      (trendAgreementRatio !== null && trendAgreementRatio >= 0.45) ||
      (dominantTrendDirection.ratio >= 0.35 && dominantTrendDirection.total >= 3) ||
      (Number.isFinite(windSpeedMph) && windSpeedMph >= 10) ||
      (Number.isFinite(windGustMph) && windGustMph >= 16)
    ) {
      return 'Moderate';
    }
    return 'Low';
  })();
  const windLoadingPillClass =
    !safetyData
      ? 'caution'
      : windLoadingLevel === 'Minimal'
        ? 'go'
        : windLoadingLevel === 'Severe'
          ? 'nogo'
          : windLoadingLevel === 'Active'
            ? windLoadingConfidence === 'High'
              ? 'nogo'
              : 'caution'
            : 'watch';
  const windLoadingActiveWindowLabel =
    windTrendRows.length > 0
      ? `${activeTransportHours}/${windTrendRows.length} h active`
      : 'N/A';
  const windLoadingElevationFocus =
    !safetyData
      ? 'Load forecast to see terrain focus.'
      : windLoadingLevel === 'Severe'
        ? 'Above and near treeline are primary hazard zones. Expect rapid slab growth on lee ridges, rollovers, and gully walls.'
        : windLoadingLevel === 'Active'
          ? 'Focus near and above treeline, plus connected terrain below loaded start zones.'
          : windLoadingLevel === 'Localized'
            ? 'Loading likely stays localized around exposed ridges, terrain breaks, and cross-loaded gully features.'
            : 'Wind transport is limited; drift pockets can still form near ridgelines.';
  const windLoadingActionLine =
    !safetyData
      ? ''
      : windLoadingLevel === 'Severe'
        ? 'Route action: avoid lee convexities and cross-loaded start zones; use sheltered, lower-angle terrain.'
        : windLoadingLevel === 'Active'
          ? 'Route action: keep ridgeline exposure short and avoid terrain traps beneath lee start zones.'
          : windLoadingLevel === 'Localized'
            ? 'Route action: probe small test slopes and watch for drifted pillows before committing to steeper terrain.'
            : 'Route action: wind loading is a secondary hazard, but still check for isolated drifts near ridges.';
  const windLoadingSummary =
    !safetyData
      ? 'Wind loading hints unavailable until a forecast is loaded.'
      : calmOrVariableSignal
        ? `Winds are ${primaryWindDirection === 'CALM' ? 'calm' : 'variable'}. Broad loading is unlikely, but localized drifts can still form around terrain breaks.`
        : lightWindSignal
          ? 'Winds are light at the selected start window. Broad loading is less likely, but small drift pockets can still form.'
          : resolvedWindDirection
            ? `${windLoadingLevel} transport signal: wind from ${resolvedWindDirection} at ${formatWindDisplay(
                safetyData.weather.windSpeed,
              )} (gust ${formatWindDisplay(safetyData.weather.windGust)}). Primary lee aspects: ${leewardAspectHints.join(', ') || 'unknown'}.`
            : `${windLoadingLevel} transport signal, but direction is uncertain. Infer loading from field clues (fresh cornices, drift pillows, textured snow).`;
  const windLoadingNotes = safetyData
    ? [
        `Direction source: ${resolvedWindDirectionSource}.`,
        trendWindDirections.length > 0 && trendDirectionalCoverageRatio !== null
          ? `Directional coverage: ${Math.round(trendDirectionalCoverageRatio * 100)}% of trend hours reported usable direction.`
          : 'Directional coverage: not enough trend direction data.',
        directionalTrendWindDirections.length > 0 && trendAgreementRatio !== null
          ? `Trend agreement: ${Math.round(trendAgreementRatio * 100)}% of ${directionalTrendWindDirections.length} nearby hour(s) align within 45 degrees.`
          : 'Trend agreement: not enough directional trend data.',
        windTrendRows.length > 0
          ? `Active loading window: ${activeTransportHours}/${windTrendRows.length} hour(s) show active wind-transport signal.`
          : null,
        secondaryWindAspects.length > 0 && Number.isFinite(windGustMph) && windGustMph >= 20
          ? `Secondary cross-loading possible on ${secondaryWindAspects.join(', ')} aspects.`
          : null,
        !resolvedWindDirection && Number.isFinite(windSpeedMph) && windSpeedMph >= 10
          ? 'Stronger winds with missing direction: treat all lee start zones as suspect until confirmed in the field.'
          : null,
        windLoadingLevel === 'Severe'
          ? 'Field cues: rapid cornice growth, hollow slab feel, and fresh drifts extending farther below ridges.'
          : windLoadingLevel === 'Active'
            ? 'Field cues: fresh drift pillows, shooting cracks, and wind-textured snow near lee features.'
            : windLoadingLevel === 'Localized'
              ? 'Field cues: isolated drift pockets near gully walls, sub-ridges, and convex terrain breaks.'
              : null,
      ].filter((entry): entry is string => Boolean(entry))
    : [];
  const windLoadingHintsRelevant = avalancheRelevant && !avalancheUnknown;
  const terrainConditionDetails = safetyData
    ? (() => {
        const upstreamTerrain = safetyData.terrainCondition;
        if (upstreamTerrain && (upstreamTerrain.summary || (Array.isArray(upstreamTerrain.reasons) && upstreamTerrain.reasons.length > 0))) {
          return {
            summary:
              upstreamTerrain.summary ||
              'Surface classification is based on weather, precipitation totals, trend, and snowpack observations.',
            reasons: Array.isArray(upstreamTerrain.reasons) ? upstreamTerrain.reasons.slice(0, 6) : [],
            confidence: upstreamTerrain.confidence || null,
          };
        }
        return {
          summary:
            'Surface classification is based on weather description, precip probability, rolling rain/snow totals, temperature trend, and available snowpack observations.',
          reasons: [] as string[],
          confidence: null as 'high' | 'medium' | 'low' | null,
        };
      })()
    : {
        summary: 'Surface classification unavailable until a forecast is loaded.',
        reasons: [] as string[],
        confidence: null as 'high' | 'medium' | 'low' | null,
      };
  const terrainConditionPillClass = (() => {
    const terrainCode = String(safetyData?.terrainCondition?.code || '').toLowerCase();
    if (terrainCode === 'dry_firm') {
      return 'go';
    }
    if (terrainCode === 'weather_unavailable') {
      return 'watch';
    }
    if (['snow_ice', 'wet_muddy', 'cold_slick', 'dry_loose'].includes(terrainCode)) {
      return 'caution';
    }
    if (terrainCode) {
      return 'watch';
    }
    const normalized = String(safetyData?.terrainCondition?.label || safetyData?.trail || '').toLowerCase();
    if (!normalized) {
      return 'caution';
    }
    if (/weather unavailable|partially unavailable|unknown/.test(normalized)) {
      return 'watch';
    }
    if (/snow|icy|wet|muddy|slick/.test(normalized)) {
      return 'caution';
    }
    return 'go';
  })();
  const teamBriefChecklist =
    safetyData && decision
      ? [
          `${objectiveName || 'Pinned Objective'} - ${safetyData.forecast?.selectedDate || forecastDate}`,
          `Decision: ${decision.level}`,
          `Start: ${displayStartTime}`,
          `Weather: ${weatherWithEmoji}, ${formatTempDisplay(safetyData.weather.temp)} (feels ${formatTempDisplay(
            safetyData.weather.feelsLike ?? safetyData.weather.temp,
          )}), wind ${formatWindDisplay(safetyData.weather.windSpeed)}, gust ${formatWindDisplay(safetyData.weather.windGust)}${
            resolvedWindDirection ? ` from ${resolvedWindDirection}` : ''
          }.`,
          `Avalanche: ${
            !avalancheRelevant
              ? 'Not primary for this objective'
              : avalancheUnknown
                ? 'Limited avalanche coverage (no official center coverage)'
                : `L${normalizeDangerLevel(safetyData.avalanche.dangerLevel)} ${getDangerText(normalizeDangerLevel(safetyData.avalanche.dangerLevel))}`
          }`,
          '',
          'Situation snapshot:',
          ...fieldBriefSnapshot.map((item) => `- ${item}`),
          '',
          'Abort triggers:',
          ...fieldBriefAbortTriggers.map((item) => `- ${item}`),
          '',
          'Immediate actions:',
          ...fieldBriefActions.map((item) => `- ${item}`),
          ...(windLoadingHintsRelevant ? ['', `Wind loading hint: ${windLoadingSummary}`] : []),
        ].join('\n')
      : '';
  const reportCardOrder = (() => {
    type SortableCardKey =
      | 'decisionGate'
      | 'criticalChecks'
      | 'atmosphericData'
      | 'heatRisk'
      | 'nwsAlerts'
      | 'travelWindowPlanner'
      | 'planSnapshot'
      | 'terrainTrailCondition'
      | 'snowpackSnapshot'
      | 'windLoadingHints'
      | 'recentRainfall'
      | 'fireRisk'
      | 'airQuality'
      | 'sourceFreshness'
      | 'scoreTrace'
      | 'recommendedGear';

    const clampRiskLevel = (value: number): number => Math.max(0, Math.min(5, Math.round(value)));
    const alertSeverityRank = (severity: string | undefined | null): number => {
      const normalized = String(severity || '').trim().toLowerCase();
      if (!normalized) return 1;
      if (['extreme', 'severe'].includes(normalized)) return 5;
      if (['warning'].includes(normalized)) return 4;
      if (['advisory', 'watch'].includes(normalized)) return 3;
      if (['moderate'].includes(normalized)) return 2;
      return 1;
    };

    const trailText = String(safetyData?.terrainCondition?.label || safetyData?.trail || '').toLowerCase();
    const weatherDescription = String(safetyData?.weather.description || '').toLowerCase();
    const windGustNumeric = Number(safetyData?.weather.windGust);
    const windSpeedNumeric = Number(safetyData?.weather.windSpeed);
    const feelsLikeNumeric = Number(safetyData?.weather.feelsLike ?? safetyData?.weather.temp);
    const precipChanceNumeric = Number(safetyData?.weather.precipChance);
    const aqiNumeric = Number(safetyData?.airQuality?.usAqi);
    const scoreFactors = Array.isArray(safetyData?.safety?.factors) ? safetyData.safety.factors : [];
    const safetyScoreNumeric = Number(safetyData?.safety?.score);
    const weatherAvailable =
      Number.isFinite(Number(safetyData?.weather.temp)) ||
      (weatherDescription.length > 0 && weatherDescription !== 'unknown');
    const travelAvailable = travelWindowRows.length > 0;
    const terrainAvailable = trailText.length > 0 && !/weather unavailable/.test(trailText);
    const rainfallAvailable =
      Number.isFinite(rainfall12hIn) ||
      Number.isFinite(rainfall24hIn) ||
      Number.isFinite(rainfall48hIn) ||
      Number.isFinite(snowfall12hIn) ||
      Number.isFinite(snowfall24hIn) ||
      Number.isFinite(snowfall48hIn);
    const snowpackAvailable = ['ok', 'partial'].includes(String(safetyData?.snowpack?.status || '').toLowerCase());
    const windHintsAvailable =
      windLoadingHintsRelevant &&
      (Boolean(resolvedWindDirection) || calmOrVariableSignal || lightWindSignal || trendWindDirections.length > 0);
    const fireRiskAvailable = String(safetyData?.fireRisk?.status || '').toLowerCase() !== 'unavailable';
    const heatRiskAvailable =
      String(safetyData?.heatRisk?.status || '').toLowerCase() !== 'unavailable' ||
      Number.isFinite(Number(safetyData?.weather.temp)) ||
      Number.isFinite(Number(safetyData?.weather.feelsLike));
    const airQualityAvailable =
      Number.isFinite(aqiNumeric) ||
      Number.isFinite(Number(safetyData?.airQuality?.pm25)) ||
      Number.isFinite(Number(safetyData?.airQuality?.pm10));
    const sourceFreshnessAvailable = sourceFreshnessRows.length > 0;
    const scoreTraceAvailable = scoreFactors.length > 0 || Boolean(dayOverDay);
    const gearAvailable = Array.isArray(safetyData?.gear) && safetyData.gear.length > 0;
    const planAvailable = Boolean(safetyData?.solar?.sunrise || safetyData?.solar?.sunset || safetyData?.forecast?.selectedDate);
    const alertsCardRelevant = true;
    const alertsList = safetyData?.alerts?.alerts || [];
    const alertsActive = alertsCardRelevant && nwsAlertCount > 0;
    const highestAlertSeverity = Math.max(
      alertSeverityRank(safetyData?.alerts?.highestSeverity),
      alertsList.reduce((maxSeverity, alert) => Math.max(maxSeverity, alertSeverityRank(alert.severity)), 0),
    );
    const staleSourceCount = sourceFreshnessRows.filter((row) => (row.stateOverride || freshnessClass(row.issued, row.staleHours)) === 'stale').length;
    const missingSourceCount = sourceFreshnessRows.filter((row) => (row.stateOverride || freshnessClass(row.issued, row.staleHours)) === 'missing').length;
    const decisionLevel = decision?.level || 'CAUTION';
    const stormSignal = /thunder|storm|lightning|hail|blizzard/.test(weatherDescription);
    const travelFailHours = travelWindowRows.filter((row) => !row.pass).length;
    const travelFailRatio = travelWindowRows.length > 0 ? travelFailHours / travelWindowRows.length : 0;
    const criticalHighHours = criticalWindow.filter((row) => row.level === 'high').length;
    const criticalWatchHours = criticalWindow.filter((row) => row.level === 'watch').length;
    const daylightCheckFailed = Boolean(
      decision?.checks?.find((check) => /30 min before sunset/i.test(check.label || '') && check.ok === false),
    );
    const maxSnowpackDepth = Math.max(0, ...snowpackDepthSignalValues);
    const maxSnowpackSwe = Math.max(0, ...snowpackSweSignalValues);
    const terrainCode = String(safetyData?.terrainCondition?.code || '').toLowerCase();
    const gustThresholdDelta = Number.isFinite(windGustNumeric) ? windGustNumeric - preferences.maxWindGustMph : 0;
    const precipThresholdDelta = Number.isFinite(precipChanceNumeric) ? precipChanceNumeric - preferences.maxPrecipChance : 0;
    const coldThresholdDelta = Number.isFinite(feelsLikeNumeric) ? preferences.minFeelsLikeF - feelsLikeNumeric : 0;
    const windThresholdDelta = Number.isFinite(windSpeedNumeric) ? windSpeedNumeric - preferences.maxWindGustMph * 0.6 : 0;

    const decisionRiskLevel = decisionLevel === 'NO-GO' ? 5 : decisionLevel === 'CAUTION' ? 3 : 1;
    const criticalChecksRiskLevel =
      criticalCheckFailCount >= 3 ? 5 : criticalCheckFailCount >= 1 ? 4 : decisionLevel === 'NO-GO' ? 4 : 2;
    const atmosphericRiskLevel = (() => {
      if (stormSignal || gustThresholdDelta >= 15 || precipThresholdDelta >= 25) return 5;
      if (gustThresholdDelta >= 8 || precipThresholdDelta >= 10 || coldThresholdDelta >= 10) return 4;
      if (gustThresholdDelta > 0 || precipThresholdDelta > 0 || coldThresholdDelta > 0 || windThresholdDelta > 0) return 3;
      return 2;
    })();
    const heatRiskCardLevel = (() => {
      if (!heatRiskAvailable) return 0;
      if (!Number.isFinite(heatRiskLevel)) return 1;
      if (heatRiskLevel >= 4) return 5;
      if (heatRiskLevel >= 3) return 4;
      if (heatRiskLevel >= 2) return 3;
      if (heatRiskLevel >= 1) return 2;
      return 1;
    })();
    const alertsRiskLevel = (() => {
      if (!alertsCardRelevant) return 0;
      if (alertsActive && highestAlertSeverity >= 4) return 5;
      if (alertsActive && highestAlertSeverity >= 3) return 4;
      if (alertsActive) return 3;
      if (Number(safetyData?.alerts?.totalActiveCount) > 0) return 2;
      return 1;
    })();
    const travelRiskLevel = (() => {
      if (!travelAvailable) return 0;
      if (travelFailRatio >= 0.6 || criticalHighHours >= 3) return 5;
      if (travelFailRatio >= 0.35 || criticalHighHours >= 1) return 4;
      if (travelFailRatio > 0 || criticalWatchHours >= 3) return 3;
      return 2;
    })();
    const terrainRiskLevel = (() => {
      if (!terrainAvailable) return 0;
      if (terrainCode === 'snow_ice') return 4;
      if (['wet_muddy', 'cold_slick', 'dry_loose'].includes(terrainCode)) return 3;
      if (/snow|icy|wet|muddy|slick|loose/.test(trailText)) return 3;
      return 2;
    })();
    const snowpackRiskLevel = (() => {
      if (!snowpackAvailable) return 0;
      if (!avalancheRelevant) return 1;
      if (avalancheUnknown) return 4;
      if (maxSnowpackDepth >= 24 || maxSnowpackSwe >= 8) return 4;
      if (hasSnowpackSignal) return 3;
      return 2;
    })();
    const windLoadingRiskLevel = (() => {
      if (!windHintsAvailable) return 0;
      if (windLoadingConfidence === 'High') return 4;
      if (windLoadingConfidence === 'Moderate') return 3;
      return 2;
    })();
    const rainfallRiskLevel = (() => {
      if (!rainfallAvailable) return 0;
      if ((Number.isFinite(rainfall24hIn) && rainfall24hIn >= 0.75) || (Number.isFinite(snowfall24hIn) && snowfall24hIn >= 8)) return 4;
      if ((Number.isFinite(rainfall24hIn) && rainfall24hIn >= 0.25) || (Number.isFinite(snowfall24hIn) && snowfall24hIn >= 2)) return 3;
      if ((Number.isFinite(rainfall12hIn) && rainfall12hIn > 0) || (Number.isFinite(snowfall12hIn) && snowfall12hIn > 0)) return 2;
      return 1;
    })();
    const sourceFreshnessRiskLevel = (() => {
      if (!sourceFreshnessAvailable) return 0;
      if (missingSourceCount >= 2 || staleSourceCount >= 3) return 4;
      if (missingSourceCount >= 1 || staleSourceCount >= 1) return 3;
      return 1;
    })();
    const fireRiskCardLevel = (() => {
      if (!fireRiskAvailable) return 0;
      if (!Number.isFinite(fireRiskLevel)) return 1;
      if (fireRiskLevel >= 4) return 5;
      if (fireRiskLevel >= 3) return 4;
      if (fireRiskLevel >= 2) return 3;
      return 2;
    })();
    const airQualityRiskLevel = (() => {
      if (!airQualityAvailable) return 0;
      if (!Number.isFinite(aqiNumeric)) return 1;
      if (aqiNumeric > 150) return 5;
      if (aqiNumeric > 100) return 4;
      if (aqiNumeric > 50) return 3;
      return 2;
    })();
    const planRiskLevel = !planAvailable ? 0 : daylightCheckFailed ? 4 : 2;
    const scoreTraceRiskLevel = (() => {
      if (!scoreTraceAvailable) return 0;
      if (!Number.isFinite(safetyScoreNumeric)) return decisionRiskLevel;
      if (safetyScoreNumeric < 42) return 5;
      if (safetyScoreNumeric < 60) return 4;
      if (safetyScoreNumeric < 75) return 3;
      return 2;
    })();
    const recommendedGearRiskLevel = !gearAvailable ? 0 : Math.max(1, decisionRiskLevel - 1);

    const cards: Array<{ key: SortableCardKey; base: number; available: boolean; relevant: boolean; riskLevel: number }> = [
      { key: 'decisionGate', base: 100, available: true, relevant: true, riskLevel: decisionRiskLevel },
      { key: 'criticalChecks', base: 96, available: criticalCheckTotal > 0, relevant: true, riskLevel: criticalChecksRiskLevel },
      { key: 'atmosphericData', base: 94, available: weatherAvailable, relevant: true, riskLevel: atmosphericRiskLevel },
      { key: 'heatRisk', base: 93, available: heatRiskAvailable, relevant: true, riskLevel: heatRiskCardLevel },
      { key: 'nwsAlerts', base: 92, available: alertsCardRelevant, relevant: alertsCardRelevant, riskLevel: alertsRiskLevel },
      { key: 'travelWindowPlanner', base: 90, available: travelAvailable, relevant: true, riskLevel: travelRiskLevel },
      { key: 'terrainTrailCondition', base: 84, available: terrainAvailable, relevant: true, riskLevel: terrainRiskLevel },
      { key: 'snowpackSnapshot', base: 82, available: snowpackAvailable, relevant: true, riskLevel: snowpackRiskLevel },
      {
        key: 'windLoadingHints',
        base: 80,
        available: windHintsAvailable,
        relevant: windLoadingHintsRelevant,
        riskLevel: windLoadingRiskLevel,
      },
      { key: 'recentRainfall', base: 78, available: rainfallAvailable, relevant: true, riskLevel: rainfallRiskLevel },
      { key: 'sourceFreshness', base: 76, available: sourceFreshnessAvailable, relevant: true, riskLevel: sourceFreshnessRiskLevel },
      { key: 'fireRisk', base: 74, available: fireRiskAvailable, relevant: true, riskLevel: fireRiskCardLevel },
      { key: 'airQuality', base: 72, available: airQualityAvailable, relevant: true, riskLevel: airQualityRiskLevel },
      { key: 'planSnapshot', base: 70, available: planAvailable, relevant: true, riskLevel: planRiskLevel },
      { key: 'scoreTrace', base: 68, available: scoreTraceAvailable, relevant: true, riskLevel: scoreTraceRiskLevel },
      { key: 'recommendedGear', base: 64, available: gearAvailable, relevant: true, riskLevel: recommendedGearRiskLevel },
    ];

    const scored = cards.map((card) => {
      const relevancePenalty = card.relevant ? 0 : 60;
      const availabilityPenalty = card.available ? 0 : 35;
      const normalizedRisk = card.relevant && card.available ? clampRiskLevel(card.riskLevel) : 0;
      const score = card.base + normalizedRisk * 12 - relevancePenalty - availabilityPenalty + (card.available ? 0.25 : 0);
      return { ...card, riskLevel: normalizedRisk, score };
    });

    scored.sort((a, b) => b.riskLevel - a.riskLevel || b.score - a.score || b.base - a.base);
    const sortedKeys = scored.map((entry) => entry.key);
    const innerOrder = new Map<SortableCardKey, number>();
    sortedKeys.forEach((key, idx) => innerOrder.set(key, idx + 10));

    return {
      scoreCard: 0,
      fieldBrief: 1,
      avalancheForecast: avalancheRelevant ? 2 : 130,
      reportColumns: 3,
      decisionGate: innerOrder.get('decisionGate') ?? 10,
      criticalChecks: innerOrder.get('criticalChecks') ?? 11,
      atmosphericData: innerOrder.get('atmosphericData') ?? 12,
      heatRisk: innerOrder.get('heatRisk') ?? 13,
      nwsAlerts: innerOrder.get('nwsAlerts') ?? 14,
      travelWindowPlanner: innerOrder.get('travelWindowPlanner') ?? 15,
      planSnapshot: innerOrder.get('planSnapshot') ?? 16,
      terrainTrailCondition: innerOrder.get('terrainTrailCondition') ?? 17,
      snowpackSnapshot: innerOrder.get('snowpackSnapshot') ?? 18,
      windLoadingHints: innerOrder.get('windLoadingHints') ?? 19,
      recentRainfall: innerOrder.get('recentRainfall') ?? 20,
      fireRisk: innerOrder.get('fireRisk') ?? 21,
      airQuality: innerOrder.get('airQuality') ?? 22,
      sourceFreshness: innerOrder.get('sourceFreshness') ?? 23,
      scoreTrace: innerOrder.get('scoreTrace') ?? 24,
      recommendedGear: innerOrder.get('recommendedGear') ?? 25,
      deepDiveData: 140,
    } as const;
  })();

  useEffect(() => {
    setCopiedSatLine(false);
    if (satCopyResetTimeout.current) {
      clearTimeout(satCopyResetTimeout.current);
      satCopyResetTimeout.current = null;
    }
  }, [satelliteConditionLine]);

  useEffect(() => {
    setCopiedTeamBrief(false);
    if (teamBriefCopyResetTimeout.current) {
      clearTimeout(teamBriefCopyResetTimeout.current);
      teamBriefCopyResetTimeout.current = null;
    }
  }, [teamBriefChecklist]);

  useEffect(() => {
    if (!hasObjective || !safetyData) {
      setDayOverDay(null);
      return;
    }

    const selectedDate = safetyData.forecast?.selectedDate || forecastDate;
    if (!DATE_FMT.test(selectedDate)) {
      setDayOverDay(null);
      return;
    }

    const previousDate = addDaysToIsoDate(selectedDate, -1);
    let cancelled = false;

    (async () => {
      try {
        const { response, payload } = await fetchApi(
          `/api/safety?lat=${position.lat}&lon=${position.lng}&date=${encodeURIComponent(previousDate)}`,
        );
        if (!response.ok || !payload || typeof payload !== 'object') {
          if (!cancelled) setDayOverDay(null);
          return;
        }

        const previousPayload = payload as SafetyData;
        const prevScore = Number(previousPayload?.safety?.score);
        if (!Number.isFinite(prevScore)) {
          if (!cancelled) setDayOverDay(null);
          return;
        }

        if (!cancelled) {
          setDayOverDay({
            previousDate,
            previousScore: prevScore,
            delta: safetyData.safety.score - prevScore,
            changes: buildDayOverDayChanges(safetyData, previousPayload, preferences),
          });
        }
      } catch {
        if (!cancelled) setDayOverDay(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasObjective, safetyData, forecastDate, position.lat, position.lng, preferences]);

  if (view === 'status') {
    return (
      <div key="view-status" className={appShellClassName} aria-busy={isViewPending}>
        <section className="settings-shell status-shell">
          <div className="settings-head">
            <div>
              <div className="home-kicker">Backcountry Conditions System Health</div>
              <h2>Status</h2>
              <p>Live application health checks for backend availability and browser capabilities.</p>
            </div>
            <div className="settings-nav">
              <button className="settings-btn" onClick={() => navigateToView('home')}>
                <House size={14} /> Homepage
              </button>
              <button className="settings-btn" onClick={openPlannerView}>
                <Route size={14} /> Planner
              </button>
              <button className="settings-btn" onClick={() => navigateToView('settings')}>
                <SlidersHorizontal size={14} /> Settings
              </button>
              <button className="primary-btn" onClick={() => void runHealthChecks()} disabled={healthLoading}>
                <ShieldCheck size={14} /> {healthLoading ? 'Checking…' : 'Run Checks'}
              </button>
            </div>
          </div>

          {healthError && (
            <article className="settings-card error-banner">
              <h3>Health Check Error</h3>
              <p>{healthError}</p>
            </article>
          )}

          <div className="status-grid">
            {healthChecks.map((check) => (
              <article key={check.label} className="settings-card status-card">
                <div className="status-card-head">
                  <h3>{check.label}</h3>
                  <span className={`decision-pill ${check.status === 'ok' ? 'go' : check.status === 'warn' ? 'caution' : 'nogo'}`}>
                    {check.status.toUpperCase()}
                  </span>
                </div>
                <p>{check.detail}</p>
              </article>
            ))}
            {!healthLoading && healthChecks.length === 0 && !healthError && (
              <article className="settings-card status-card">
                <h3>No checks yet</h3>
                <p>Run checks to view current application health.</p>
              </article>
            )}
          </div>

          <div className="settings-note">
            Last checked: {healthCheckedAt ? formatPubTime(healthCheckedAt) : 'Never'}
          </div>
          <AppDisclaimer compact />
        </section>
      </div>
    );
  }

  if (view === 'settings') {
    return (
      <div key="view-settings" className={appShellClassName} aria-busy={isViewPending}>
        <section className="settings-shell">
          <div className="settings-head">
            <div>
              <div className="home-kicker">Backcountry Conditions Preferences</div>
              <h2>Settings</h2>
              <p>Set default planning values for this device. Shared links can still override these values.</p>
            </div>
            <div className="settings-nav">
              <button className="settings-btn" onClick={() => navigateToView('home')}>
                <House size={14} /> Homepage
              </button>
              <button className="primary-btn" onClick={openPlannerView}>
                <Route size={14} /> Planner
              </button>
              <button className="settings-btn" onClick={openStatusView}>
                <ShieldCheck size={14} /> Status
              </button>
            </div>
          </div>

          <div className="settings-grid">
            <article className="settings-card">
              <h3>Default timing</h3>
              <p>Applied when you start a new objective without shared time values.</p>
              <div className="settings-time-row">
                <label className="date-control">
                  <span>Start time</span>
                  <input type="time" value={preferences.defaultStartTime} onChange={(e) => handlePreferenceTimeChange('defaultStartTime', e.target.value)} />
                </label>
              </div>
            </article>

            <article className="settings-card">
              <h3>Appearance</h3>
              <p>Theme follows your system by default. Override it here if needed.</p>
              <div className="settings-theme-row">
                <button type="button" className={`theme-chip ${preferences.themeMode === 'system' ? 'active' : ''}`} onClick={() => handleThemeModeChange('system')}>
                  System
                </button>
                <button type="button" className={`theme-chip ${preferences.themeMode === 'light' ? 'active' : ''}`} onClick={() => handleThemeModeChange('light')}>
                  Light
                </button>
                <button type="button" className={`theme-chip ${preferences.themeMode === 'dark' ? 'active' : ''}`} onClick={() => handleThemeModeChange('dark')}>
                  Dark
                </button>
              </div>
            </article>

            <article className="settings-card">
              <h3>Units & time</h3>
              <p>Controls display units in report cards and exported summaries.</p>
              <div className="settings-time-row">
                <label className="settings-number-row">
                  <span>Temperature</span>
                  <div className="settings-theme-row">
                    <button type="button" className={`theme-chip ${preferences.temperatureUnit === 'f' ? 'active' : ''}`} onClick={() => handleTemperatureUnitChange('f')}>
                      °F
                    </button>
                    <button type="button" className={`theme-chip ${preferences.temperatureUnit === 'c' ? 'active' : ''}`} onClick={() => handleTemperatureUnitChange('c')}>
                      °C
                    </button>
                  </div>
                </label>
                <label className="settings-number-row">
                  <span>Elevation</span>
                  <div className="settings-theme-row">
                    <button type="button" className={`theme-chip ${preferences.elevationUnit === 'ft' ? 'active' : ''}`} onClick={() => handleElevationUnitChange('ft')}>
                      ft
                    </button>
                    <button type="button" className={`theme-chip ${preferences.elevationUnit === 'm' ? 'active' : ''}`} onClick={() => handleElevationUnitChange('m')}>
                      m
                    </button>
                  </div>
                </label>
                <label className="settings-number-row">
                  <span>Wind speed</span>
                  <div className="settings-theme-row">
                    <button type="button" className={`theme-chip ${preferences.windSpeedUnit === 'mph' ? 'active' : ''}`} onClick={() => handleWindSpeedUnitChange('mph')}>
                      mph
                    </button>
                    <button type="button" className={`theme-chip ${preferences.windSpeedUnit === 'kph' ? 'active' : ''}`} onClick={() => handleWindSpeedUnitChange('kph')}>
                      kph
                    </button>
                  </div>
                </label>
                <label className="settings-number-row">
                  <span>Time style</span>
                  <div className="settings-theme-row">
                    <button type="button" className={`theme-chip ${preferences.timeStyle === 'ampm' ? 'active' : ''}`} onClick={() => handleTimeStyleChange('ampm')}>
                      12h (AM/PM)
                    </button>
                    <button type="button" className={`theme-chip ${preferences.timeStyle === '24h' ? 'active' : ''}`} onClick={() => handleTimeStyleChange('24h')}>
                      24h
                    </button>
                  </div>
                </label>
              </div>
            </article>

            <article className="settings-card">
              <h3>Travel window thresholds</h3>
              <p>Used by the pass/fail timeline in planner view.</p>
              <div className="settings-time-row">
                <label className="settings-number-row">
                  <span>Window length (hours)</span>
                  <input
                    type="number"
                    min={MIN_TRAVEL_WINDOW_HOURS}
                    max={MAX_TRAVEL_WINDOW_HOURS}
                    step={1}
                    value={travelWindowHoursDraft}
                    onChange={handleTravelWindowHoursDraftChange}
                    onBlur={handleTravelWindowHoursDraftBlur}
                  />
                </label>
                <label className="settings-number-row">
                  <span>Max gust ({windUnitLabel})</span>
                  <input
                    type="number"
                    min={windThresholdMin}
                    max={windThresholdMax}
                    step={windThresholdStep}
                    value={maxWindGustDraft}
                    onChange={handleWindThresholdDisplayChange}
                    onBlur={handleWindThresholdDisplayBlur}
                  />
                </label>
                <label className="settings-number-row">
                  <span>Max precip chance (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={maxPrecipChanceDraft}
                    onChange={handleMaxPrecipChanceDraftChange}
                    onBlur={handleMaxPrecipChanceDraftBlur}
                  />
                </label>
                <label className="settings-number-row">
                  <span>Min feels-like ({tempUnitLabel})</span>
                  <input
                    type="number"
                    min={feelsLikeThresholdMin}
                    max={feelsLikeThresholdMax}
                    step={feelsLikeThresholdStep}
                    value={minFeelsLikeDraft}
                    onChange={handleFeelsLikeThresholdDisplayChange}
                    onBlur={handleFeelsLikeThresholdDisplayBlur}
                  />
                </label>
              </div>
            </article>

            <article className="settings-card settings-card-full">
              <h3>Actions</h3>
              <p>Preferences are saved in your browser and stay on this device.</p>
              <div className="settings-actions">
                <button className="primary-btn" onClick={applyPreferencesToPlanner}>
                  Apply Defaults To Planner
                </button>
                <button className="settings-btn settings-reset-btn" onClick={resetPreferences}>
                  Reset Built-in Defaults
                </button>
              </div>
              <div className="settings-note">
                Current defaults: Start {displayDefaultStartTime} • Theme {preferences.themeMode} • Units {preferences.temperatureUnit.toUpperCase()}/{preferences.elevationUnit}/{preferences.windSpeedUnit} • Time {preferences.timeStyle === 'ampm' ? '12h' : '24h'} • Window {travelWindowHoursLabel} • Gust {windThresholdDisplay} • Precip {preferences.maxPrecipChance}% • Feels-like {feelsLikeThresholdDisplay}
              </div>
            </article>
          </div>
          <AppDisclaimer compact />
        </section>
      </div>
    );
  }

  if (view === 'home') {
    const objectiveSummary = hasObjective ? objectiveName || `${position.lat.toFixed(4)}, ${position.lng.toFixed(4)}` : 'Not selected yet';
    const forecastModeSummary = forecastDate > todayDate ? `Future • ${forecastDate}` : `Today • ${forecastDate}`;
    const decisionSummary = decision ? decision.level : 'Not evaluated';
    const weatherSourceSummary = safetyData ? weatherSourceDisplay : 'Loads after selecting an objective';
    const mapStyleSummary = activeBasemap.label;
    const resumeLabel = hasObjective ? `Resume ${objectiveName || 'Current Objective'}` : 'Open Backcountry Planner';

    return (
      <div key="view-home" className={appShellClassName} aria-busy={isViewPending}>
        <section className="home-hero">
          <div className="home-hero-main">
            <div className="home-kicker">Backcountry Conditions</div>
            <h1>Plan safer backcountry days in one place.</h1>
            <p>
              Build objective-aware weather, avalanche, alert, snowpack, and travel-window checks before committing your route and timing.
            </p>
            <div className="home-actions">
              <button className="primary-btn" onClick={openPlannerView}>
                {resumeLabel}
              </button>
              <button className="settings-btn" onClick={() => navigateToView('settings')}>
                <SlidersHorizontal size={14} /> Settings
              </button>
              <button className="settings-btn" onClick={openStatusView}>
                <ShieldCheck size={14} /> App Health
              </button>
            </div>
          </div>
          <aside className="home-hero-panel" aria-label="Current planning context">
            <div className="home-panel-kicker">Current Plan Context</div>
            <dl className="home-context-grid">
              <div className="home-context-item">
                <dt>Objective</dt>
                <dd>{objectiveSummary}</dd>
              </div>
              <div className="home-context-item">
                <dt>Forecast</dt>
                <dd>{forecastModeSummary}</dd>
              </div>
              <div className="home-context-item">
                <dt>{startLabel}</dt>
                <dd>{displayStartTime}</dd>
              </div>
              <div className="home-context-item">
                <dt>Decision</dt>
                <dd>{decisionSummary}</dd>
              </div>
              <div className="home-context-item">
                <dt>Weather Source</dt>
                <dd>{weatherSourceSummary}</dd>
              </div>
              <div className="home-context-item">
                <dt>Map Style</dt>
                <dd>{mapStyleSummary}</dd>
              </div>
            </dl>
          </aside>
        </section>

        <section className="home-quick-row" aria-label="Planner quick facts">
          <div className="home-chip">
            <CalendarDays size={14} /> Date-aware planning
          </div>
          <div className="home-chip">
            <Clock size={14} /> {travelWindowHoursLabel} travel window analysis
          </div>
          <div className="home-chip">
            <MapIcon size={14} /> Shareable objective link
          </div>
          <div className="home-chip">
            <ShieldCheck size={14} /> Risk-ranked report cards
          </div>
        </section>

        <section className="home-grid">
          <article className="home-card">
            <div className="home-card-head">
              <CloudRain size={18} />
              <h3>Atmospheric Conditions</h3>
            </div>
            <p>Evaluate temperature, feels-like, wind, precipitation chance, and period timestamps for your selected start time.</p>
            <ul className="home-card-points">
              <li>Displays forecast period used in the report</li>
              <li>Supports elevation-adjusted weather checks</li>
            </ul>
          </article>
          <article className="home-card">
            <div className="home-card-head">
              <Mountain size={18} />
              <h3>Snowpack & Avalanche</h3>
            </div>
            <p>Combines avalanche center products with SNOTEL and NOHRSC signals to show where snow hazards matter and how current data is.</p>
            <ul className="home-card-points">
              <li>Keeps avalanche card visible with applicability reason</li>
              <li>Highlights expired bulletin windows clearly</li>
            </ul>
          </article>
          <article className="home-card">
            <div className="home-card-head">
              <AlertTriangle size={18} />
              <h3>Operational Risk Gates</h3>
            </div>
            <p>Decision Gate, Critical Checks, and Travel Window Planner update from your thresholds and start-time window.</p>
            <ul className="home-card-points">
              <li>NWS alerts and score trace integrated</li>
              <li>Cards sorted dynamically by active risk level</li>
            </ul>
          </article>
          <article className="home-card">
            <div className="home-card-head">
              <Route size={18} />
              <h3>Execution Ready Output</h3>
            </div>
            <p>Generate printable reports and concise SAT messages for field teams while preserving source links for verification.</p>
            <ul className="home-card-points">
              <li>Shareable planner URL for each search</li>
              <li>One-liner built for satellite messaging limits</li>
            </ul>
          </article>
        </section>
        <AppDisclaimer />
      </div>
    );
  }

  return (
    <div key="view-planner" className={appShellClassName} aria-busy={isViewPending}>
      <header className="header-section">
        <div className="brand">
          <div className="brand-mark">
            <img src="/summitsafe-icon.svg" alt="Backcountry Conditions" className="brand-mark-icon" />
          </div>
          <div className="brand-copy">
            <h1>
              Backcountry Conditions
            </h1>
            <p className="brand-subtitle">Backcountry planning dashboard</p>
          </div>
        </div>

        <div className="header-controls">
          <SearchBox
            searchWrapperRef={searchWrapperRef}
            searchInputRef={searchInputRef}
            searchQuery={searchQuery}
            trimmedSearchQuery={trimmedSearchQuery}
            showSuggestions={showSuggestions}
            searchLoading={searchLoading}
            suggestions={suggestions}
            activeSuggestionIndex={activeSuggestionIndex}
            canUseCoordinates={Boolean(parsedTypedCoordinates)}
            onInputChange={handleInputChange}
            onFocus={handleFocus}
            onKeyDown={handleSearchKeyDown}
            onSubmit={handleSearchSubmit}
            onClear={handleSearchClear}
            onUseCoordinates={handleUseTypedCoordinates}
            onSelectSuggestion={selectSuggestion}
            onHoverSuggestion={setActiveSuggestionIndex}
          />

          <button className="secondary-btn" onClick={() => navigateToView('home')}>
            <House size={14} /> Homepage
          </button>
          <button className="secondary-btn" onClick={() => navigateToView('settings')}>
            <SlidersHorizontal size={14} /> Settings
          </button>
          <button className="secondary-btn" onClick={openStatusView}>
            <ShieldCheck size={14} /> Status
          </button>
          <button className="secondary-btn" onClick={handleCopyLink}>
            <Link2 size={14} /> {copiedLink ? 'Copied' : 'Copy Link'}
          </button>
        </div>
      </header>

      <section className="map-shell">
        <div className="map-section">
          <MapContainer center={position} zoom={hasObjective ? 11 : 4} style={{ height: '100%', width: '100%' }}>
            <TileLayer attribution={activeBasemap.attribution} url={activeBasemap.url} />
            <ScaleControl
              position="bottomleft"
              imperial={preferences.elevationUnit === 'ft'}
              metric={preferences.elevationUnit === 'm'}
            />
            <LocationMarker position={position} setPosition={updateObjectivePosition} />
            <MapUpdater position={position} zoom={hasObjective ? 11 : 4} focusKey={mapFocusNonce} />
          </MapContainer>
        </div>

        <div className="map-actions">
          <div className="map-actions-top">
            <label className="date-control">
              <span>Forecast date</span>
              <input type="date" value={forecastDate} min={todayDate} max={maxForecastDate} onChange={handleDateChange} />
            </label>

            <label className="date-control compact">
              <span>{startLabel}</span>
              <input
                type="time"
                aria-label={startLabel}
                title="When you plan to start moving."
                value={alpineStartTime}
                onChange={handlePlannerTimeChange(setAlpineStartTime)}
              />
            </label>

            <button
              type="button"
              className="now-control-btn"
              onClick={handleUseNowConditions}
              title={objectiveTimezone ? `Set date/time to now in ${objectiveTimezone}` : 'Set date/time to now'}
            >
              <Clock size={14} /> Now
            </button>

            <label className="date-control compact">
              <span>
                <Layers size={13} /> Map
              </span>
              <select
                aria-label="Basemap style"
                title="Switch between terrain and street basemaps."
                value={mapStyle}
                onChange={(e) => setMapStyle(e.target.value as MapStyle)}
              >
                <option value="topo">Terrain</option>
                <option value="street">Street</option>
              </select>
            </label>
          </div>
          {timezoneMismatch && (
            <p className="map-time-help is-warning">
              Objective timezone: <strong>{objectiveTimezone}</strong>. Your device timezone is <strong>{deviceTimezone}</strong>. Times in this report are objective-local.
            </p>
          )}

          <div className="map-actions-bottom">
            <span className="map-coords">
              {position.lat.toFixed(4)}, {position.lng.toFixed(4)}
            </span>
            {hasObjective && (
              <span className={`map-elevation-chip ${safetyData ? '' : 'is-pending'}`} title={mapElevationChipTitle}>
                <Mountain size={13} aria-hidden="true" />
                <span className="map-elevation-label">Elev</span>
                <span className="map-elevation-value">{mapElevationLabel}</span>
              </span>
            )}
            {hasObjective && (
              <span className={`map-weather-chip ${safetyData ? '' : 'is-pending'}`} title={mapWeatherChipTitle}>
                <span className="map-weather-chip-emoji" aria-hidden="true">
                  {mapWeatherEmoji}
                </span>
                <span className="map-weather-chip-temp">{mapWeatherTempLabel}</span>
                <span className="map-weather-chip-condition">{mapWeatherConditionLabel}</span>
              </span>
            )}

            <div className="map-link-group">
              <button type="button" className="action-btn" onClick={handleRetryFetch} disabled={!hasObjective || loading}>
                <RefreshCw size={14} className={loading ? 'spin' : ''} /> {loading ? 'Refreshing...' : 'Refresh'}
              </button>
              <button type="button" className="action-btn" onClick={handleUseCurrentLocation} disabled={locatingUser}>
                <LocateFixed size={14} /> {locatingUser ? 'Locating...' : 'Use My Location'}
              </button>
              <button type="button" className="action-btn" onClick={handleRecenterMap}>
                <Navigation size={14} /> Recenter
              </button>
            </div>

            <div className="map-link-group">
              <a href={`https://caltopo.com/map.html#ll=${position.lat},${position.lng}&z=14&b=mbt`} target="_blank" rel="noreferrer" className="action-btn">
                <MapIcon size={14} /> CalTopo
              </a>
              <a href={`https://www.gaiagps.com/map/?lat=${position.lat}&lon=${position.lng}&zoom=14`} target="_blank" rel="noreferrer" className="action-btn">
                <Compass size={14} /> Gaia GPS
              </a>
              <a href={`https://www.windy.com/?${position.lat},${position.lng},12`} target="_blank" rel="noreferrer" className="action-btn">
                <Wind size={14} /> Windy
              </a>
            </div>
          </div>
        </div>
      </section>

      {!hasObjective && (
        <div className="empty-state">
          <h3>Select a location to start planning</h3>
          <p>Search for a peak, trail area, zone, or click the map to place a pin.</p>
        </div>
      )}

      {loading && !safetyData && <ForecastLoading showBackendWakeNotice={showBackendWakeNotice} />}

      {loading && safetyData && (
        <div className="loading-state inline-loading-state" role="status" aria-live="polite">
          <strong>Refreshing conditions…</strong>
          <span>{showBackendWakeNotice ? 'Backend API is waking up. Existing report remains visible until fresh data arrives.' : 'Existing report remains visible until fresh data arrives.'}</span>
        </div>
      )}

      {error && (
        <div className="error-banner">
          <h3>System Alert</h3>
          <p>{error}</p>
          {hasObjective && (
            <div className="error-banner-actions">
              <button className="settings-btn" onClick={handleRetryFetch}>
                Retry Data Fetch
              </button>
            </div>
          )}
        </div>
      )}

      {hasObjective && safetyData && decision && (
        <div className="data-grid">
          <div className="score-card" style={{ borderColor: getScoreColor(safetyData.safety.score), order: reportCardOrder.scoreCard }}>
            <div className="score-value" style={{ color: getScoreColor(safetyData.safety.score) }}>
              {safetyData.safety.score}%
            </div>
            <div className="score-meta">
              <span className="status-badge" style={{ color: getScoreColor(safetyData.safety.score) }}>
                {safetyData.safety.score >= 80 ? 'Optimal' : safetyData.safety.score >= 50 ? 'Caution' : 'Critical'}
              </span>
              <div className="hazard-badge">
                <AlertTriangle size={12} /> Primary hazard: {safetyData.safety.primaryHazard}
              </div>
              <div className="source-line">
                Confidence: {typeof safetyData.safety.confidence === 'number' ? `${safetyData.safety.confidence}%` : 'N/A'}
              </div>
              <div className="objective-line">
                {objectiveName || 'Pinned Objective'} • {startLabel} {displayStartTime}
              </div>
              {Array.isArray(safetyData.safety.sourcesUsed) && safetyData.safety.sourcesUsed.length > 0 && (
                <div className="source-line">Score sources: {safetyData.safety.sourcesUsed.join(' • ')}</div>
              )}
              {(loading || error) && (
                <div className="source-line">
                  {loading
                    ? 'Showing last successful report while new data loads.'
                    : 'Showing last successful report. Latest refresh failed.'}
                </div>
              )}
              <div className="source-line">Report cards below are sorted dynamically by current risk level and data relevance.</div>
              <div className="report-action-row">
                <button type="button" className="settings-btn report-action-btn" onClick={handlePrintReport}>
                  <Printer size={14} /> Printable Report
                </button>
                <button type="button" className="settings-btn report-action-btn" onClick={handleCopySatelliteLine} disabled={!satelliteConditionLine}>
                  <MessageSquare size={14} /> {copiedSatLine ? 'Copied SAT Message' : 'Copy SAT Message'}
                </button>
                <button type="button" className="settings-btn report-action-btn" onClick={handleCopyTeamBrief} disabled={!teamBriefChecklist}>
                  <ShieldCheck size={14} /> {copiedTeamBrief ? 'Copied Field Brief' : 'Copy Field Brief'}
                </button>
              </div>
              {satelliteConditionLine && <p className="sat-line-preview">{satelliteConditionLine}</p>}
            </div>
          </div>

          <div className="report-columns" style={{ order: reportCardOrder.reportColumns }}>
            <div className="report-column">
              <div className="card decision-card" style={{ order: reportCardOrder.decisionGate }}>
                <div className="card-header">
                  <span className="card-title">
                    <ShieldCheck size={14} /> Decision Gate
                    <HelpHint text="Top-line go/caution/no-go recommendation based on weather, avalanche, alerts, score, and daylight checks." />
                  </span>
                  <span className={`decision-pill ${decision.level.toLowerCase().replace('-', '')}`}>{decision.level}</span>
                </div>
                <p className="decision-headline">{decision.headline}</p>
                <div className={`decision-action ${decision.level.toLowerCase().replace('-', '')}`}>
                  <span className="decision-action-label">Recommended action</span>
                  <p>{decisionActionLine}</p>
                </div>
                <div className="decision-summary-grid" role="list" aria-label="Decision check summary">
                  <article className="decision-summary-item" role="listitem">
                    <span>Passing checks</span>
                    <strong>
                      {decisionPassingChecksCount}/{decision.checks.length}
                    </strong>
                  </article>
                  <article className="decision-summary-item" role="listitem">
                    <span>Attn checks</span>
                    <strong>{decisionFailingChecks.length}</strong>
                  </article>
                  <article className="decision-summary-item" role="listitem">
                    <span>Dominant risk</span>
                    <strong>{decision.blockers.length > 0 ? 'Hard blocker' : decision.cautions.length > 0 ? 'Caution signal' : 'No dominant risk'}</strong>
                  </article>
                </div>
                <div className="decision-group">
                  <h4>
                    <AlertTriangle size={14} /> Key drivers
                  </h4>
                  {decisionKeyDrivers.length > 0 ? (
                    <div className="decision-driver-chips" role="list" aria-label="Decision key drivers">
                      {decisionKeyDrivers.map((item, idx) => (
                        <span key={`${item}-${idx}`} className="decision-driver-chip" role="listitem">
                          {localizeUnitText(item)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="muted-note">No dominant risk trigger detected from current model signals.</p>
                  )}
                </div>
                <details className="decision-details">
                  <summary>Show detailed blockers, cautions, and check outcomes</summary>
                  {decision.blockers.length > 0 && (
                    <div className="decision-group">
                      <h4>
                        <XCircle size={14} /> Blockers
                      </h4>
                      <ul className="signal-list compact">
                        {decision.blockers.map((item, idx) => (
                          <li key={idx}>{localizeUnitText(item)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {decision.cautions.length > 0 && (
                    <div className="decision-group">
                      <h4>
                        <AlertTriangle size={14} /> Cautions
                      </h4>
                      <ul className="signal-list compact">
                        {decision.cautions.map((item, idx) => (
                          <li key={idx}>{localizeUnitText(item)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="decision-group">
                    <h4>
                      <CheckCircle2 size={14} /> Check outcomes
                    </h4>
                    <ul className="signal-list compact">
                      {orderedCriticalChecks.map((check, idx) => (
                        <li key={`${check.label}-${idx}`}>
                          <strong>{check.ok ? 'PASS' : 'ATTN'}:</strong> {localizeUnitText(check.label)}
                          {check.detail ? ` - ${localizeUnitText(check.detail)}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              </div>

              <div className="card projection-card" style={{ order: reportCardOrder.travelWindowPlanner }}>
                <div className="card-header">
                  <span className="card-title">
                    Travel Window Planner ({travelWindowHoursLabel})
                    <HelpHint text="Hourly pass/fail timeline starting at your selected start time using your selected window length, plus wind, precip, and feels-like thresholds." />
                  </span>
                </div>
                {peakCriticalWindow ? (
                  <div className="critical-window">
                    <p className="critical-summary">
                      Peak risk near <strong>{formatClockForStyle(peakCriticalWindow.time, preferences.timeStyle)}</strong>: {criticalRiskLevelText(peakCriticalWindow.level)}
                      {peakCriticalWindow.reasons.length > 0 ? ` (${localizeUnitText(peakCriticalWindow.reasons.join(', '))})` : ''}.
                    </p>
                    <div className="travel-overview-grid" role="list" aria-label="Travel window summary">
                      <article
                        className={`travel-overview-item ${
                          travelWindowInsights.passHours >= Math.ceil(Math.max(1, travelWindowRows.length * 0.6))
                            ? 'is-good'
                            : travelWindowInsights.passHours === 0
                              ? 'is-bad'
                              : 'is-watch'
                        }`}
                        role="listitem"
                      >
                        <span className="travel-overview-label">Passing Hours</span>
                        <strong className="travel-overview-value">
                          {travelWindowInsights.passHours}/{travelWindowRows.length || travelWindowHours}
                        </strong>
                      </article>
                      <article className="travel-overview-item" role="listitem">
                        <span className="travel-overview-label">Best Window</span>
                        <strong className="travel-overview-value">
                          {travelWindowInsights.bestWindow
                            ? `${formatTravelWindowSpan(travelWindowInsights.bestWindow, preferences.timeStyle)} (${travelWindowInsights.bestWindow.length}h)`
                            : 'None'}
                        </strong>
                      </article>
                      <article className="travel-overview-item" role="listitem">
                        <span className="travel-overview-label">Most Common Blocker</span>
                        <strong className="travel-overview-value">{travelWindowInsights.topFailureLabels[0] || 'None dominant'}</strong>
                      </article>
                    </div>
                    <div className="travel-thresholds">
                      <span>Gust &lt;= {windThresholdDisplay}</span>
                      <span>Precip &lt;= {preferences.maxPrecipChance}%</span>
                      <span>Feels-like &gt;= {feelsLikeThresholdDisplay}</span>
                    </div>
                    <div className="travel-threshold-actions">
                      <button
                        type="button"
                        className="settings-btn travel-window-toggle"
                        onClick={() => setTravelThresholdEditorOpen((prev) => !prev)}
                        aria-expanded={travelThresholdEditorOpen}
                        aria-controls="travel-threshold-editor"
                      >
                        {travelThresholdEditorOpen ? 'Hide threshold controls' : 'Edit thresholds'}
                      </button>
                    </div>
                    {travelThresholdEditorOpen && (
                      <>
                        <div className="travel-threshold-editor" id="travel-threshold-editor" aria-label="Travel window threshold controls">
                          <label className="travel-threshold-row">
                            <span>Window (h)</span>
                            <input
                              type="number"
                              min={MIN_TRAVEL_WINDOW_HOURS}
                              max={MAX_TRAVEL_WINDOW_HOURS}
                              step={1}
                              value={travelWindowHoursDraft}
                              onChange={handleTravelWindowHoursDraftChange}
                              onBlur={handleTravelWindowHoursDraftBlur}
                            />
                          </label>
                          <label className="travel-threshold-row">
                            <span>Max gust ({windUnitLabel})</span>
                            <input
                              type="number"
                              min={windThresholdMin}
                              max={windThresholdMax}
                              step={windThresholdStep}
                              value={maxWindGustDraft}
                              onChange={handleWindThresholdDisplayChange}
                              onBlur={handleWindThresholdDisplayBlur}
                            />
                          </label>
                          <label className="travel-threshold-row">
                            <span>Max precip (%)</span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              value={maxPrecipChanceDraft}
                              onChange={handleMaxPrecipChanceDraftChange}
                              onBlur={handleMaxPrecipChanceDraftBlur}
                            />
                          </label>
                          <label className="travel-threshold-row">
                            <span>Min feels-like ({tempUnitLabel})</span>
                            <input
                              type="number"
                              min={feelsLikeThresholdMin}
                              max={feelsLikeThresholdMax}
                              step={feelsLikeThresholdStep}
                              value={minFeelsLikeDraft}
                              onChange={handleFeelsLikeThresholdDisplayChange}
                              onBlur={handleFeelsLikeThresholdDisplayBlur}
                            />
                          </label>
                        </div>
                        <p className="muted-note travel-threshold-note">Edits apply immediately and are saved to Settings.</p>
                      </>
                    )}
                    <p className="muted-note">{travelWindowSummary}</p>
                    {travelWindowRows.length > 0 && (
                      <div className="travel-timeline" role="list" aria-label={`${travelWindowHours}-hour travel window timeline`}>
                        {travelWindowRows.map((row, idx) => {
                          const riskLevel = criticalWindow[idx]?.level || 'stable';
                          return (
                            <article
                              key={`timeline-${row.time}-${idx}`}
                              className={`travel-timeline-cell ${row.pass ? 'pass' : 'fail'} ${riskLevel}`}
                              role="listitem"
                              title={`${formatClockForStyle(row.time, preferences.timeStyle)} • ${
                                row.pass ? 'within limits' : localizeUnitText(row.reasonSummary)
                              }`}
                            >
                              <span className="travel-timeline-time">{formatClockForStyle(row.time, preferences.timeStyle)}</span>
                              <span className="travel-timeline-status">{row.pass ? 'OK' : 'ATTN'}</span>
                            </article>
                          );
                        })}
                      </div>
                    )}
                    <div className="travel-window-actions">
                      <button
                        type="button"
                        className="settings-btn travel-window-toggle"
                        onClick={() => setTravelWindowExpanded((prev) => !prev)}
                      >
                        {travelWindowExpanded ? 'Hide hourly details' : `Show hourly details (${travelWindowRows.length})`}
                      </button>
                    </div>
                    {travelWindowExpanded && (
                    <div className="critical-list" role="list" aria-label="Hourly critical window assessment">
                      {visibleCriticalWindowRows.map((row, idx) => {
                        const travelRow = travelWindowRows[idx];
                        return (
                        <article
                          key={`${row.time}-${idx}`}
                          className={`critical-row ${row.level} ${travelRow?.pass ? 'pass' : 'fail'}`}
                          role="listitem"
                        >
                          <div className="critical-row-time">{formatClockForStyle(row.time, preferences.timeStyle)}</div>
                          <div className="critical-row-main">
                            <div className="critical-row-head">
                              <span className={`critical-level ${row.level}`}>{criticalRiskLevelText(row.level)}</span>
                              <span className={`travel-pass-pill ${travelRow?.pass ? 'pass' : 'fail'}`}>
                                {travelRow?.pass ? 'Within limits' : 'Outside limits'}
                              </span>
                              <span className="critical-metrics">
                                {formatTempDisplay(row.temp)} • feels {formatTempDisplay(travelRow?.feelsLike ?? row.temp)} • wind {formatWindDisplay(
                                  row.wind,
                                )} • gust {formatWindDisplay(row.gust)} • precip {travelRow?.precipChance ?? row.precipChance ?? 0}%
                              </span>
                            </div>
                            <p className="critical-row-reason">
                              {travelRow?.pass
                                ? 'Within configured thresholds for this hour.'
                                : localizeUnitText(
                                    travelRow?.reasonSummary || (row.reasons.length > 0 ? row.reasons.join(', ') : 'No major hazard signal for this hour.'),
                                  )}
                            </p>
                            {!travelRow?.pass && travelRow?.failedRuleLabels?.length ? (
                              <div className="travel-failure-chips" aria-label="Failed thresholds">
                                {travelRow.failedRuleLabels.map((label, failIdx) => (
                                  <span key={`${row.time}-fail-${failIdx}`} className="travel-failure-chip">
                                    {label}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </article>
                        );
                      })}
                    </div>
                    )}
                  </div>
                ) : (
                  <p className="muted-note">Hourly trend data is unavailable for this objective/date.</p>
                )}
              </div>

              <div className="card checks-card" style={{ order: reportCardOrder.criticalChecks }}>
                <div className="card-header">
                  <span className="card-title">
                    <CheckCircle2 size={14} /> Critical Checks
                    <HelpHint text="Must-pass gates before committing. Failed checks are sorted first with live threshold context." />
                  </span>
                  <span className={`decision-pill ${criticalCheckFailCount === 0 ? 'go' : 'caution'}`}>
                    {criticalCheckPassCount}/{criticalCheckTotal} passing
                  </span>
                </div>
                {topCriticalAttentionChecks.length > 0 && (
                  <div className="checks-attention" role="status" aria-live="polite">
                    <strong className="checks-attention-title">Needs attention now</strong>
                    <ul className="checks-attention-list">
                      {topCriticalAttentionChecks.map((check, idx) => (
                        <li key={`${check.key || check.label}-${idx}`}>
                          <span className="checks-attention-label">{localizeUnitText(check.label)}</span>
                          <small>{localizeUnitText(check.action || check.detail || 'Review this signal before departure.')}</small>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="checks-summary">
                  <span className={`checks-summary-pill ${criticalCheckFailCount === 0 ? 'go' : 'caution'}`}>
                    {criticalCheckFailCount === 0 ? 'Ready' : `${criticalCheckFailCount} attention`}
                  </span>
                  <span className="checks-summary-text">
                    {criticalCheckFailCount === 0 ? 'All critical checks are currently passing.' : 'Address failing checks before departure.'}
                  </span>
                </div>
                <div className="checks-list">
                  {orderedCriticalChecks.map((check, idx) => (
                    <div key={idx} className={`check-item ${check.ok ? 'ok' : 'warn'}`}>
                      <div className="check-item-main">
                        <div className="check-item-label">
                          {check.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                          <span>{check.label}</span>
                        </div>
                        {check.detail && <small className="check-item-detail">{localizeUnitText(check.detail)}</small>}
                        {!check.ok && check.action && <small className="check-item-action">{localizeUnitText(check.action)}</small>}
                      </div>
                      <span className={`check-item-status ${check.ok ? 'ok' : 'warn'}`}>{check.ok ? 'PASS' : 'ATTN'}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card score-trace-card" style={{ order: reportCardOrder.scoreTrace }}>
                <div className="card-header">
                  <span className="card-title">
                    <ShieldCheck size={14} /> Score Trace
                    <HelpHint text="Shows top factors pulling the safety score down or up, plus what changed vs yesterday." />
                  </span>
                  {dayOverDay && (
                    <span className={`decision-pill ${dayOverDay.delta <= -1 ? 'nogo' : dayOverDay.delta >= 1 ? 'go' : 'caution'}`}>
                      {dayOverDay.delta > 0 ? '+' : ''}
                      {dayOverDay.delta} vs {dayOverDay.previousDate}
                    </span>
                  )}
                </div>
                {Array.isArray(safetyData.safety.factors) && safetyData.safety.factors.length > 0 ? (
                  <ul className="score-trace-list">
                    {safetyData.safety.factors
                      .slice()
                      .sort((a, b) => Math.abs(Number(b.impact || 0)) - Math.abs(Number(a.impact || 0)))
                      .slice(0, 5)
                      .map((factor, idx) => (
                        <li key={`${factor.hazard || 'factor'}-${idx}`}>
                          <span className="score-trace-hazard">{factor.hazard || 'Factor'}</span>
                          <span className={`score-trace-impact ${(factor.impact || 0) >= 0 ? 'down' : 'up'}`}>
                            {(factor.impact || 0) >= 0 ? '-' : '+'}
                            {Math.abs(Math.round(Number(factor.impact || 0)))}
                          </span>
                          <small>{factor.message || factor.source || 'No detail provided.'}</small>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="muted-note">No factor-level trace available for this report.</p>
                )}
                {dayOverDay && dayOverDay.changes.length > 0 && (
                  <div className="score-change-block">
                    <strong>What changed since {dayOverDay.previousDate}</strong>
                    <ul className="signal-list compact">
                      {dayOverDay.changes.map((change, idx) => (
                        <li key={`${dayOverDay.previousDate}-change-${idx}`}>{change}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <div className="report-column">
              <div className="card weather-card" style={{ order: reportCardOrder.atmosphericData }}>
                <div className="card-header">
                  <span className="card-title">
                    <Thermometer size={14} /> Weather
                    <HelpHint text="Weather at your selected start time, including temperature, wind, precip, humidity, cloud cover, and source attribution." />
                  </span>
                  <div className="weather-header-meta">
                    <span className={`forecast-badge ${safetyData.forecast?.isFuture ? 'future' : ''}`}>
                      {safetyData.forecast?.isFuture ? 'Forecast' : 'Current'} • {safetyData.forecast?.selectedDate || forecastDate}
                    </span>
                    {safetyData.weather.issuedTime && <span className="weather-issued">Issued • {formatPubTime(safetyData.weather.issuedTime)}</span>}
                    <span className="weather-source-pill">Source • {weatherSourceDisplay}</span>
                  </div>
                </div>

                <div className="weather-row">
                  <div>
                    <div className="big-stat">{formatTempDisplay(safetyData.weather.temp)}</div>
                    <div className="stat-label">Feels like {formatTempDisplay(safetyData.weather.feelsLike)}</div>
                  </div>
                  <div className="weather-condition">
                    <div className={`big-stat condition-text ${safetyData.weather.description.toLowerCase().includes('snow') ? 'is-cold' : ''}`}>
                      {weatherWithEmoji}
                    </div>
                    <div className="stat-label">Conditions at {displayStartTime}</div>
                  </div>
                </div>
                <p className="weather-period-line">Using forecast period: {forecastPeriodLabel}</p>

                <div className="weather-metrics">
                  <div className="metric-chip">
                    <span className="stat-label">Wind</span>
                    <strong>{formatWindDisplay(safetyData.weather.windSpeed)}</strong>
                  </div>
                  <div className="metric-chip">
                    <span className="stat-label">Gusts</span>
                    <strong className="gust-value">{formatWindDisplay(safetyData.weather.windGust)}</strong>
                  </div>
                  <div className="metric-chip">
                    <span className="stat-label">Precip</span>
                    <strong>{safetyData.weather.precipChance}%</strong>
                  </div>
                  <div className="metric-chip">
                    <span className="stat-label">Humidity</span>
                    <strong>{Number.isFinite(Number(safetyData.weather.humidity)) ? `${Math.round(Number(safetyData.weather.humidity))}%` : 'N/A'}</strong>
                  </div>
                  <div className="metric-chip">
                    <span className="stat-label">Dew Point</span>
                    <strong>{formatTempDisplay(safetyData.weather.dewPoint)}</strong>
                  </div>
                  <div className="metric-chip">
                    <span className="stat-label">Wind Dir</span>
                    <strong>{weatherWindDirectionLabel}</strong>
                  </div>
                  <div className="metric-chip">
                    <span className="stat-label">Cloud Cover</span>
                    <strong>{weatherCloudCoverLabel}</strong>
                  </div>
                </div>

                <section className="elevation-forecast" aria-label="Target elevation forecast">
                  <div className="elevation-forecast-head">
                    <h4>Target Elevation Forecast</h4>
                    <label className="target-elev-inline-control">
                      <span>Target ({elevationUnitLabel})</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        aria-label={`Target elevation in ${elevationUnitLabel}`}
                        title={`Optional elevation to estimate weather at that altitude (${elevationUnitLabel}).`}
                        placeholder={elevationUnitLabel === 'm' ? 'e.g. 2600' : 'e.g. 8500'}
                        value={targetElevationInput}
                        onChange={handleTargetElevationChange}
                      />
                    </label>
                  </div>
                  {hasTargetElevation ? (
                    targetElevationForecast ? (
                      <article className="elevation-row">
                        <div className="elevation-row-main">
                          <strong>Estimated at target elevation</strong>
                          <span>{formatElevationDisplay(targetElevationFt)} • {formatElevationDeltaDisplay(targetElevationForecast.deltaFt)} vs objective</span>
                        </div>
                        <div className="elevation-row-metrics">
                          <span>{formatTempDisplay(targetElevationForecast.temp)}</span>
                          <span>Feels {formatTempDisplay(targetElevationForecast.feelsLike)}</span>
                          <span>Wind {formatWindDisplay(targetElevationForecast.windSpeed)}</span>
                          <span>Gust {formatWindDisplay(targetElevationForecast.windGust)}</span>
                        </div>
                      </article>
                    ) : (
                      <p className="muted-note">Objective elevation is unavailable, so target elevation estimate cannot be generated.</p>
                    )
                  ) : (
                    <p className="muted-note">Set a target elevation to estimate temperature, wind, and feels-like conditions at that altitude.</p>
                  )}
                </section>

                {safetyData.weather.sourceDetails?.blended && (
                  <p className="muted-note">
                    Weather is blended. NOAA is primary; Open-Meteo filled missing fields.
                  </p>
                )}
                {safeWeatherLink && (
                  <a href={safeWeatherLink} target="_blank" rel="noreferrer" className="avy-external-link weather-external-link">
                    {weatherLinkCta}
                  </a>
                )}

                <section className="elevation-forecast" aria-label="Forecast by elevation">
                  <div className="elevation-forecast-head">
                    <h4>Elevation Forecast</h4>
                    <span>
                      Objective{' '}
                      {formatElevationDisplay(
                        safetyData.weather.elevation != null ? safetyData.weather.elevation : null,
                      )}
                    </span>
                  </div>
                  {elevationForecastBands.length > 0 ? (
                    <div className="elevation-rows">
                      {elevationForecastBands.map((band) => (
                        <article key={`${band.label}-${band.elevationFt}`} className="elevation-row">
                          <div className="elevation-row-main">
                            <strong>{band.label}</strong>
                            <span>
                              {formatElevationDisplay(band.elevationFt)} ({formatElevationDeltaDisplay(band.deltaFromObjectiveFt)})
                            </span>
                          </div>
                          <div className="elevation-row-metrics">
                            <span>{formatTempDisplay(band.temp)}</span>
                            <span>Feels {formatTempDisplay(band.feelsLike)}</span>
                            <span>Wind {formatWindDisplay(band.windSpeed)}</span>
                            <span>Gust {formatWindDisplay(band.windGust)}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="muted-note">Elevation-adjusted forecast is unavailable for this point.</p>
                  )}
                  {safetyData.weather.elevationForecastNote && (
                    <p className="elevation-note">{localizeUnitText(safetyData.weather.elevationForecastNote)}</p>
                  )}
                </section>
              </div>

              <div className="card heat-risk-card" style={{ order: reportCardOrder.heatRisk }}>
                <div className="card-header">
                  <span className="card-title">
                    <Sun size={14} /> Heat Risk
                    <HelpHint text="Heat-stress signal synthesized from selected-period apparent temperature, humidity, near-term trend peaks, and lower-terrain elevation estimates." />
                  </span>
                  <span className={`decision-pill ${heatRiskPillClass}`}>{String(heatRiskLabel || 'Low').toUpperCase()}</span>
                </div>
                <p className="muted-note">{heatRiskGuidance}</p>
                <div className="plan-grid">
                  <div>
                    <span className="stat-label">Temp</span>
                    <strong>{formatTempDisplay(heatRiskMetrics.tempF ?? safetyData.weather.temp)}</strong>
                  </div>
                  <div>
                    <span className="stat-label">Feels Like</span>
                    <strong>{formatTempDisplay(heatRiskMetrics.feelsLikeF ?? safetyData.weather.feelsLike ?? safetyData.weather.temp)}</strong>
                  </div>
                  <div>
                    <span className="stat-label">Humidity</span>
                    <strong>{Number.isFinite(Number(heatRiskMetrics.humidity ?? safetyData.weather.humidity)) ? `${Math.round(Number(heatRiskMetrics.humidity ?? safetyData.weather.humidity))}%` : 'N/A'}</strong>
                  </div>
                  <div>
                    <span className="stat-label">12h Peak Temp</span>
                    <strong>{formatTempDisplay(heatRiskMetrics.peakTemp12hF ?? null)}</strong>
                  </div>
                  <div>
                    <span className="stat-label">Lower Terrain Feels</span>
                    <strong>{formatTempDisplay(heatRiskMetrics.lowerTerrainFeelsLikeF ?? null)}</strong>
                    {lowerTerrainHeatLabel && <small>{lowerTerrainHeatLabel}</small>}
                  </div>
                </div>
                {heatRiskReasons.length > 0 ? (
                  <ul className="signal-list compact">
                    {heatRiskReasons.map((reason, idx) => (
                      <li key={`heat-risk-reason-${idx}`}>{localizeUnitText(reason)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-note">No strong heat-stress signal was detected for this objective/time.</p>
                )}
                <p className="muted-note">Source: {safetyData.heatRisk?.source || 'Derived from forecast temperature and humidity signals'}</p>
              </div>

              <div className="card terrain-condition-card" style={{ order: reportCardOrder.terrainTrailCondition }}>
                <div className="card-header">
                  <span className="card-title">
                    <Route size={14} /> Terrain / Trail Condition
                    <HelpHint text={terrainConditionDetails.summary} />
                  </span>
                  <span className={`decision-pill ${terrainConditionPillClass}`}>{safetyData.terrainCondition?.label || safetyData.trail || 'Unknown'}</span>
                </div>
                <p className="muted-note">{terrainConditionDetails.summary}</p>
                <p className="terrain-context-line">{terrainPrecipContextLine}</p>
                {terrainConditionDetails.confidence && (
                  <p className="muted-note">
                    Classification confidence:{' '}
                    {terrainConditionDetails.confidence === 'high'
                      ? 'High'
                      : terrainConditionDetails.confidence === 'medium'
                        ? 'Moderate'
                        : 'Low'}
                  </p>
                )}
                {terrainConditionDetails.reasons.length > 0 ? (
                  <ul className="signal-list compact">
                    {terrainConditionDetails.reasons.map((reason, index) => (
                      <li key={`terrain-condition-reason-${index}`}>{reason}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-note">No strong surface signal was detected from current upstream data.</p>
                )}
                <p className="muted-note">Classification updates when you change location, date, or start time.</p>
              </div>

              <div className="card rainfall-card" style={{ order: reportCardOrder.recentRainfall }}>
                <div className="card-header">
                  <span className="card-title">
                    <CloudRain size={14} /> Recent Precipitation Totals
                    <HelpHint text="Observed rolling totals (past 12h/24h/48h) plus expected precipitation for your selected travel-window duration." />
                  </span>
                  <span className={`decision-pill ${rainfall24hSeverityClass}`}>
                    24h rain {rainfall24hDisplay}
                    {Number.isFinite(snowfall24hIn) ? ` · snow ${snowfall24hDisplay}` : ''}
                  </span>
                </div>
                <p className="precip-insight-line">{precipInsightLine}</p>
                <p className="precip-insight-line expected">{expectedPrecipSummaryLine}</p>
                <div className="precip-split-grid">
                  <section className="precip-column rain">
                    <div className="precip-column-head">
                      <CloudRain size={14} />
                      <span>Rain</span>
                    </div>
                    <ul className="precip-metric-list">
                      <li>
                        <span className="precip-metric-label">Past 12h</span>
                        <strong>{rainfall12hDisplay}</strong>
                      </li>
                      <li className="precip-metric-highlight">
                        <span className="precip-metric-label">Past 24h</span>
                        <strong>{rainfall24hDisplay}</strong>
                      </li>
                      <li>
                        <span className="precip-metric-label">Past 48h</span>
                        <strong>{rainfall48hDisplay}</strong>
                      </li>
                    </ul>
                  </section>
                  <section className="precip-column snow">
                    <div className="precip-column-head">
                      <Mountain size={14} />
                      <span>Snow</span>
                    </div>
                    <ul className="precip-metric-list">
                      <li>
                        <span className="precip-metric-label">Past 12h</span>
                        <strong>{snowfall12hDisplay}</strong>
                      </li>
                      <li className="precip-metric-highlight">
                        <span className="precip-metric-label">Past 24h</span>
                        <strong>{snowfall24hDisplay}</strong>
                      </li>
                      <li>
                        <span className="precip-metric-label">Past 48h</span>
                        <strong>{snowfall48hDisplay}</strong>
                      </li>
                    </ul>
                  </section>
                </div>
                <div className="precip-expected-block">
                  <div className="precip-expected-title">
                    <span>Expected Precipitation (Travel Window)</span>
                    <strong>{expectedTravelWindowHours}h</strong>
                  </div>
                  <div className="precip-split-grid">
                    <section className="precip-column rain">
                      <div className="precip-column-head">
                        <CloudRain size={14} />
                        <span>Rain</span>
                      </div>
                      <ul className="precip-metric-list">
                        <li className="precip-metric-highlight">
                          <span className="precip-metric-label">Next {expectedTravelWindowHours}h</span>
                          <strong>{expectedRainWindowDisplay}</strong>
                        </li>
                      </ul>
                    </section>
                    <section className="precip-column snow">
                      <div className="precip-column-head">
                        <Mountain size={14} />
                        <span>Snow</span>
                      </div>
                      <ul className="precip-metric-list">
                        <li className="precip-metric-highlight">
                          <span className="precip-metric-label">Next {expectedTravelWindowHours}h</span>
                          <strong>{expectedSnowWindowDisplay}</strong>
                        </li>
                      </ul>
                    </section>
                  </div>
                  <div className="precip-meta-grid">
                    <div>
                      <span className="stat-label">Forecast start</span>
                      <strong>
                        {rainfallExpected?.startTime
                          ? formatForecastPeriodLabel(rainfallExpected.startTime, safetyData.rainfall?.timezone || null)
                          : 'N/A'}
                      </strong>
                    </div>
                    <div>
                      <span className="stat-label">Forecast end</span>
                      <strong>
                        {rainfallExpected?.endTime
                          ? formatForecastPeriodLabel(rainfallExpected.endTime, safetyData.rainfall?.timezone || null)
                          : 'N/A'}
                      </strong>
                    </div>
                  </div>
                  <p className="muted-note">{expectedPrecipNoteLine}</p>
                </div>
                <div className="precip-meta-grid">
                  <div>
                    <span className="stat-label">Window mode</span>
                    <strong>{rainfallModeLabel}</strong>
                  </div>
                  <div>
                    <span className="stat-label">Anchor time</span>
                    <strong>
                      {safetyData.rainfall?.anchorTime
                        ? formatForecastPeriodLabel(safetyData.rainfall.anchorTime, safetyData.rainfall?.timezone || null)
                        : 'N/A'}
                    </strong>
                  </div>
                </div>
                <p className="muted-note">
                  {rainfallNoteLine}
                </p>
                <p className="muted-note">
                  Source:{' '}
                  {safeRainfallLink ? (
                    <a href={safeRainfallLink} target="_blank" rel="noreferrer" className="raw-link-value">
                      {safetyData.rainfall?.source || 'Open-Meteo precipitation history (rain + snowfall)'}
                    </a>
                  ) : (
                    safetyData.rainfall?.source || 'Open-Meteo precipitation history (rain + snowfall)'
                  )}
                </p>
              </div>

              {windLoadingHintsRelevant && (
                <div className="card wind-hints-card" style={{ order: reportCardOrder.windLoadingHints }}>
                  <div className="card-header">
                    <span className="card-title">
                      <Wind size={14} /> Wind Loading Hints
                      <HelpHint text="Uses start-time wind plus nearby trend hours to infer likely loaded aspects and where wind transport is most relevant." />
                    </span>
                    <span className={`decision-pill ${windLoadingPillClass}`}>{windLoadingLevel} • {windLoadingConfidence}</span>
                  </div>
                  <p className="wind-hint-line">{windLoadingSummary}</p>
                  {windLoadingActionLine && <p className="wind-action-line">{windLoadingActionLine}</p>}
                  <div className="wind-hint-meta">
                    <div className="wind-hint-meta-item">
                      <span className="stat-label">Transport Level</span>
                      <strong>{windLoadingLevel}</strong>
                    </div>
                    <div className="wind-hint-meta-item">
                      <span className="stat-label">Active Window</span>
                      <strong>{windLoadingActiveWindowLabel}</strong>
                    </div>
                    <div className="wind-hint-meta-item">
                      <span className="stat-label">Direction Source</span>
                      <strong>{resolvedWindDirectionSource}</strong>
                    </div>
                    <div className="wind-hint-meta-item">
                      <span className="stat-label">Trend Agreement</span>
                      <strong>
                        {trendAgreementRatio !== null
                          ? `${Math.round(trendAgreementRatio * 100)}%`
                          : 'N/A'}
                      </strong>
                    </div>
                    <div className="wind-hint-meta-item wind-hint-meta-wide">
                      <span className="stat-label">Elevation Focus</span>
                      <strong>{windLoadingElevationFocus}</strong>
                    </div>
                  </div>
                  {leewardAspectHints.length > 0 && (
                    <div className="wind-aspect-block">
                      <span className="stat-label">Likely Lee Aspects</span>
                      <div className="wind-aspect-chips">
                        {leewardAspectHints.map((aspect) => (
                          <span key={aspect} className="wind-aspect-chip">
                            {aspect}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {secondaryWindAspects.length > 0 && Number.isFinite(windGustMph) && windGustMph >= 20 && (
                    <div className="wind-aspect-block">
                      <span className="stat-label">Secondary Cross-Loading</span>
                      <div className="wind-aspect-chips">
                        {secondaryWindAspects.map((aspect) => (
                          <span key={`secondary-${aspect}`} className="wind-aspect-chip secondary">
                            {aspect}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {windLoadingNotes.length > 0 && (
                    <ul className="signal-list compact">
                      {windLoadingNotes.map((note, idx) => (
                        <li key={`wind-loading-note-${idx}`}>{note}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="card source-freshness-card" style={{ order: reportCardOrder.sourceFreshness }}>
                <div className="card-header">
                  <span className="card-title">
                    <Clock size={14} /> Source Freshness
                    <HelpHint text="How old each feed is based on upstream publish/observation timestamps (not local report generation time)." />
                  </span>
                </div>
                <ul className="source-freshness-list">
                  {sourceFreshnessRows.map((row) => {
                    const state = row.stateOverride || freshnessClass(row.issued, row.staleHours);
                    return (
                      <li key={row.label}>
                        <span>{row.label}</span>
                        <strong className={`freshness-pill ${state}`}>{row.displayValue || formatAgeFromNow(row.issued)}</strong>
                      </li>
                    );
                  })}
                </ul>
                {reportGeneratedAt && <p className="muted-note">Report generated: {formatPubTime(reportGeneratedAt)}</p>}
                <p className="muted-note">Freshness badges use upstream publish/observation times when available.</p>
                {avalancheExpiredForSelectedStart && (
                  <p className="muted-note">
                    Avalanche bulletin expires before your selected start time. Report is shown as stale guidance; verify the latest update before departure.
                  </p>
                )}
                {objectiveTimezone && (
                  <p className="muted-note">
                    Objective timezone: {objectiveTimezone}
                    {deviceTimezone ? ` • Device: ${deviceTimezone}` : ''}
                  </p>
                )}
              </div>

              <div className="card nws-alerts-card" style={{ order: reportCardOrder.nwsAlerts }}>
                  <div className="card-header">
                    <span className="card-title">
                      <AlertTriangle size={14} /> NWS Alerts
                      <HelpHint text="Official National Weather Service alerts active at your selected start time for this location." />
                    </span>
                    <span className={`decision-pill ${nwsAlertCount > 0 ? 'nogo' : 'go'}`}>{nwsAlertCount} active</span>
                  </div>
                  <p className="muted-note">
                    Source: {safetyData.alerts?.source || 'NWS CAP feed'}
                    {safetyData.alerts?.highestSeverity ? ` • Highest: ${safetyData.alerts.highestSeverity}` : ''}
                  </p>
                  {safetyData.alerts?.status === 'none_for_selected_start' && nwsTotalAlertCount > 0 && (
                    <p className="muted-note">
                      {nwsTotalAlertCount} alert(s) exist now, but none are active at your selected start time.
                    </p>
                  )}
                  {nwsTopAlerts.length > 0 ? (
                    <ul className="score-trace-list nws-alert-list">
                      {nwsTopAlerts.map((alert, idx) => {
                        const alertLink = sanitizeExternalUrl(alert.link || undefined);
                        const headline = normalizeAlertNarrative(alert.headline, 400);
                        const descriptionParagraphs = splitAlertNarrativeParagraphs(alert.description, 2600);
                        const instructionParagraphs = splitAlertNarrativeParagraphs(alert.instruction, 1600);
                        const areaList = Array.isArray(alert.affectedAreas) ? alert.affectedAreas.filter(Boolean).slice(0, 8) : [];
                        const areaDesc = normalizeAlertNarrative(alert.areaDesc, 1200);
                        const hasExtendedAlertDetails =
                          Boolean(headline) ||
                          descriptionParagraphs.length > 0 ||
                          instructionParagraphs.length > 0 ||
                          areaList.length > 0 ||
                          Boolean(areaDesc) ||
                          Boolean(alert.senderName) ||
                          Boolean(alert.response) ||
                          Boolean(alert.messageType) ||
                          Boolean(alert.category);
                        return (
                        <li key={`${alert.event || 'alert'}-${idx}`}>
                          <span className="score-trace-hazard">
                            {alertLink ? (
                              <a
                                href={alertLink}
                                target="_blank"
                                rel="noreferrer"
                                className="raw-link-value"
                                title={alert.headline || 'Open NWS alert source'}
                              >
                                {alert.event || 'Alert'}
                              </a>
                            ) : (
                              <span>{alert.event || 'Alert'}</span>
                            )}
                          </span>
                          <span className="score-trace-impact down">{alert.severity || 'Unknown'}</span>
                          <small>
                            {alert.urgency || 'Unknown urgency'}
                            {alert.certainty ? ` • Certainty ${alert.certainty}` : ''}
                            {alert.response ? ` • Response ${alert.response}` : ''}
                            {alert.effective ? ` • Effective ${formatPubTime(alert.effective)}` : ''}
                            {alert.onset ? ` • Onset ${formatPubTime(alert.onset)}` : ''}
                            {alert.ends ? ` • Ends ${formatPubTime(alert.ends)}` : ''}
                            {alert.expires ? ` • Expires ${formatPubTime(alert.expires)}` : ''}
                          </small>
                          {hasExtendedAlertDetails && (
                            <details className="alert-description-details">
                              <summary title={headline || alert.event || 'Open alert details'}>Details & guidance</summary>
                              <div className="alert-detail-body">
                                {headline && <p className="alert-detail-lead">{headline}</p>}
                                {descriptionParagraphs.length > 0 && (
                                  <div className="alert-detail-section">
                                    <strong>Description</strong>
                                    {descriptionParagraphs.slice(0, 4).map((paragraph, paragraphIdx) => (
                                      <p key={`alert-desc-${idx}-${paragraphIdx}`}>{paragraph}</p>
                                    ))}
                                  </div>
                                )}
                                {instructionParagraphs.length > 0 && (
                                  <div className="alert-detail-section">
                                    <strong>Recommended Action</strong>
                                    {instructionParagraphs.slice(0, 3).map((paragraph, paragraphIdx) => (
                                      <p key={`alert-inst-${idx}-${paragraphIdx}`}>{paragraph}</p>
                                    ))}
                                  </div>
                                )}
                                {areaList.length > 0 && (
                                  <div className="alert-detail-section">
                                    <strong>Affected Areas</strong>
                                    <p>{areaList.join(', ')}</p>
                                  </div>
                                )}
                                {areaList.length === 0 && areaDesc && (
                                  <div className="alert-detail-section">
                                    <strong>Area</strong>
                                    <p>{areaDesc}</p>
                                  </div>
                                )}
                                {(alert.senderName || alert.messageType || alert.category) && (
                                  <div className="alert-detail-section">
                                    <strong>Source Metadata</strong>
                                    <p>
                                      {alert.senderName ? `Issued by ${alert.senderName}` : 'Issuer not specified'}
                                      {alert.messageType ? ` • Type: ${alert.messageType}` : ''}
                                      {alert.category ? ` • Category: ${alert.category}` : ''}
                                    </p>
                                  </div>
                                )}
                                {alertLink && (
                                  <p className="alert-detail-link-line">
                                    <a href={alertLink} target="_blank" rel="noreferrer" className="raw-link-value">
                                      Open official full alert
                                    </a>
                                  </p>
                                )}
                              </div>
                            </details>
                          )}
                        </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="muted-note">No active NWS alerts for this objective point.</p>
                  )}
                </div>

              <div className="card air-quality-card" style={{ order: reportCardOrder.airQuality }}>
                <div className="card-header">
                  <span className="card-title">
                    <Wind size={14} /> Air Quality
                    <HelpHint text="AQI and pollutant values near your objective. Elevated values can reduce performance and increase risk." />
                  </span>
                  <span className={`decision-pill ${airQualityPillClass(safetyData.airQuality?.usAqi)}`}>
                    AQI {Number.isFinite(Number(safetyData.airQuality?.usAqi)) ? Math.round(Number(safetyData.airQuality?.usAqi)) : 'N/A'}
                  </span>
                </div>
                <div className="plan-grid">
                  <div>
                    <span className="stat-label">Category</span>
                    <strong>{safetyData.airQuality?.category || 'Unknown'}</strong>
                  </div>
                  <div>
                    <span className="stat-label">PM2.5</span>
                    <strong>{Number.isFinite(Number(safetyData.airQuality?.pm25)) ? Number(safetyData.airQuality?.pm25).toFixed(1) : 'N/A'}</strong>
                  </div>
                  <div>
                    <span className="stat-label">PM10</span>
                    <strong>{Number.isFinite(Number(safetyData.airQuality?.pm10)) ? Number(safetyData.airQuality?.pm10).toFixed(1) : 'N/A'}</strong>
                  </div>
                  <div>
                    <span className="stat-label">Ozone</span>
                    <strong>{Number.isFinite(Number(safetyData.airQuality?.ozone)) ? Number(safetyData.airQuality?.ozone).toFixed(1) : 'N/A'}</strong>
                  </div>
                </div>
                <p className="muted-note">
                  Source: {safetyData.airQuality?.source || 'Open-Meteo Air Quality API'}
                  {safetyData.airQuality?.measuredTime ? ` • Measured ${formatPubTime(safetyData.airQuality.measuredTime)}` : ''}
                </p>
              </div>

              <div className="card snowpack-card" style={{ order: reportCardOrder.snowpackSnapshot }}>
                <div className="card-header">
                  <span className="card-title">
                    <Mountain size={14} /> Snowpack Snapshot
                    <HelpHint text="Observed and modeled snowpack context with practical takeaways from nearest SNOTEL and NOAA NOHRSC at your objective." />
                  </span>
                  <span className={`decision-pill ${snowpackPillClass}`}>
                    {snowpackStatusLabel}
                  </span>
                </div>

                {snowpackInsights && (
                  <div className="snowpack-insight-grid snowpack-insight-grid-compact">
                    <div className={`snowpack-insight-item snowpack-insight-${snowpackInsights.signal.tone}`}>
                      <span className="stat-label">Signal</span>
                      <strong>{snowpackInsights.signal.label}</strong>
                      <small>{snowpackInsights.signal.detail}</small>
                    </div>
                    <div className={`snowpack-insight-item snowpack-insight-${snowpackInsights.freshness.tone}`}>
                      <span className="stat-label">Freshness</span>
                      <strong>{snowpackInsights.freshness.label}</strong>
                      <small>{snowpackInsights.freshness.detail}</small>
                    </div>
                  </div>
                )}

                <div className="snowpack-core-grid">
                  <div className="snowpack-core-item">
                    <span className="stat-label stat-label-with-help">
                      Nearest SNOTEL
                      <HelpHint text="Closest USDA NRCS snow station to your objective. Station observations are used as local snowpack ground truth." />
                    </span>
                    <strong>{safetyData.snowpack?.snotel?.stationName || 'Unavailable'}</strong>
                    <small>{snotelDistanceDisplay !== 'N/A' ? `${snotelDistanceDisplay} from objective` : 'Distance unavailable'}</small>
                  </div>
                  <div className="snowpack-core-item">
                    <span className="stat-label">SNOTEL Station Snow</span>
                    <strong>Depth {snotelDepthDisplay} • SWE {snotelSweDisplay}</strong>
                    <small>{safetyData.snowpack?.snotel?.observedDate ? `Observed ${safetyData.snowpack.snotel.observedDate}` : 'Observation date unavailable'}</small>
                  </div>
                  <div className="snowpack-core-item">
                    <span className="stat-label">NOHRSC Grid Snow</span>
                    <strong>Depth {nohrscDepthDisplay} • SWE {nohrscSweDisplay}</strong>
                    <small>
                      {safetyData.snowpack?.nohrsc?.sampledTime
                        ? `Sampled ${formatForecastPeriodLabel(safetyData.snowpack.nohrsc.sampledTime, safetyData.weather?.timezone || null)}`
                        : 'Sample time unavailable'}
                    </small>
                  </div>
                  <div className="snowpack-core-item">
                    <span className="stat-label">Recent 24h</span>
                    <strong>Rain {rainfall24hDisplay} • Snow {snowfall24hDisplay}</strong>
                    <small>Use this for fresh loading context.</small>
                  </div>
                </div>

                <p className="muted-note">
                  {snowpackInterpretation?.headline
                    ? localizeUnitText(snowpackInterpretation.headline)
                    : localizeUnitText(safetyData.snowpack?.summary || 'Snowpack observations unavailable.')}
                </p>

                <details className="snowpack-details">
                  <summary>More snowpack details</summary>

                  {snowpackInsights && (
                    <div className="snowpack-insight-grid">
                      <div className={`snowpack-insight-item snowpack-insight-${snowpackInsights.representativeness.tone}`}>
                        <span className="stat-label">Representativeness</span>
                        <strong>{snowpackInsights.representativeness.label}</strong>
                        <small>{snowpackInsights.representativeness.detail}</small>
                      </div>
                      <div className={`snowpack-insight-item snowpack-insight-${snowpackInsights.agreement.tone}`}>
                        <span className="stat-label">Agreement</span>
                        <strong>{snowpackInsights.agreement.label}</strong>
                        <small>{snowpackInsights.agreement.detail}</small>
                      </div>
                    </div>
                  )}

                  {snowpackInterpretation && snowpackInterpretation.bullets.length > 0 && (
                    <div className={`snowpack-read snowpack-read-${snowpackInterpretation.confidence}`}>
                      <span className="snowpack-takeaway-title">Interpretation notes</span>
                      <ul className="signal-list compact">
                        {snowpackInterpretation.bullets.map((item, idx) => (
                          <li key={`snowpack-read-${idx}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {snowpackTakeaways.length > 0 && (
                    <div className="snowpack-takeaways">
                      <span className="snowpack-takeaway-title">How To Use This Snapshot</span>
                      <ul className="signal-list compact">
                        {snowpackTakeaways.map((item, idx) => (
                          <li key={`snowpack-takeaway-${idx}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="plan-grid">
                    <div>
                      <span className="stat-label">Recent Snowfall (12h/24h/48h)</span>
                      <strong>{snowfallWindowSummary}</strong>
                    </div>
                    <div>
                      <span className="stat-label">Recent Rainfall (12h/24h/48h)</span>
                      <strong>{rainfallWindowSummary}</strong>
                    </div>
                  </div>

                  <p className="muted-note">
                    {snowpackObservationContext}
                  </p>
                  <p className="muted-note">
                    Data snapshot: {localizeUnitText(safetyData.snowpack?.summary || 'Snowpack observations unavailable.')}
                  </p>
                  <p className="muted-note">
                    Sources:{' '}
                    {safeSnotelLink ? (
                      <>
                        <a href={safeSnotelLink} target="_blank" rel="noreferrer" className="raw-link-value">
                          NRCS AWDB / SNOTEL
                        </a>
                        {' • '}
                      </>
                    ) : (
                      'NRCS AWDB / SNOTEL • '
                    )}
                    {safeNohrscLink ? (
                      <a href={safeNohrscLink} target="_blank" rel="noreferrer" className="raw-link-value">
                        NOAA NOHRSC Snow Analysis
                      </a>
                    ) : (
                      'NOAA NOHRSC Snow Analysis'
                    )}
                  </p>
                </details>
              </div>

              <div className="card fire-risk-card" style={{ order: reportCardOrder.fireRisk }}>
                <div className="card-header">
                  <span className="card-title">
                    <Flame size={14} /> Fire Risk
                    <HelpHint text="Fire-weather and smoke risk synthesized from forecast heat/dryness/wind, NWS fire-weather alerts, and air-quality context." />
                  </span>
                  <span className={`decision-pill ${fireRiskPillClass}`}>{fireRiskLabel.toUpperCase()}</span>
                </div>
                <p className="muted-note">{safetyData.fireRisk?.guidance || 'No fire-risk guidance available.'}</p>
                {safetyData.fireRisk?.reasons && safetyData.fireRisk.reasons.length > 0 && (
                  <ul className="signal-list compact">
                    {safetyData.fireRisk.reasons.slice(0, 3).map((reason, idx) => (
                      <li key={`fire-reason-${idx}`}>{reason}</li>
                    ))}
                  </ul>
                )}
                {fireRiskAlerts.length > 0 && (
                  <ul className="score-trace-list nws-alert-list">
                    {fireRiskAlerts.slice(0, 3).map((alert, idx) => {
                      const safeAlertLink = sanitizeExternalUrl(alert.link || undefined);
                      return (
                        <li key={`${alert.event || 'fire-alert'}-${idx}`}>
                          <span className="score-trace-hazard">{alert.event || 'Alert'}</span>
                          <span className="score-trace-impact down">{alert.severity || 'Unknown'}</span>
                          <small>{alert.expires ? `Expires ${formatPubTime(alert.expires)}` : 'Expiry not specified'}</small>
                          {safeAlertLink && (
                            <small>
                              <a href={safeAlertLink} target="_blank" rel="noreferrer" className="raw-link-value">
                                Source link
                              </a>
                            </small>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="muted-note">Source: {safetyData.fireRisk?.source || 'Not provided'}</p>
              </div>

              <div className="card plan-card" style={{ order: reportCardOrder.planSnapshot }}>
                <div className="card-header">
                  <span className="card-title">
                    <Route size={14} /> Plan Snapshot
                    <HelpHint text="Quick view of start time, solar windows, and selected forecast date for the current plan." />
                  </span>
                </div>
                <div className="plan-summary-grid">
                  <article className="plan-summary-item">
                    <span className="plan-label">{startLabel}</span>
                    <strong className="plan-value">{displayStartTime}</strong>
                  </article>
                  <article className="plan-summary-item">
                    <span className="plan-label">Sunrise</span>
                    <strong className="plan-value">{formatClockShort(safetyData.solar.sunrise, preferences.timeStyle)}</strong>
                  </article>
                  <article className="plan-summary-item">
                    <span className="plan-label">Sunset</span>
                    <strong className="plan-value">{formatClockShort(safetyData.solar.sunset, preferences.timeStyle)}</strong>
                  </article>
                  <article className="plan-summary-item">
                    <span className="plan-label">Daylight left from start</span>
                    <strong className="plan-value">{daylightRemainingFromStartLabel}</strong>
                  </article>
                  <article className="plan-summary-item plan-summary-item-wide">
                    <span className="plan-label">Forecast date</span>
                    <strong className="plan-value">{safetyData.forecast?.selectedDate || forecastDate}</strong>
                  </article>
                </div>
              </div>

              <div className="card gear-card" style={{ order: reportCardOrder.recommendedGear }}>
                <div className="card-header">
                  <span className="card-title">
                    Gear Recommendations
                    <HelpHint text="Prioritized gear suggestions with plain-language reasons based on weather, precipitation, snowpack, avalanche relevance, alerts, air quality, and fire signals." />
                  </span>
                </div>
                {safetyData.gear && safetyData.gear.length > 0 ? (
                  <ul className="signal-list compact">
                    {safetyData.gear.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-note">No special gear flags detected. Use your standard backcountry safety kit and expected seasonal layers.</p>
                )}
              </div>
            </div>
          </div>

          <div className="card avy-card" style={{ order: reportCardOrder.avalancheForecast }}>
            <div className="card-header">
              <span className="card-title">
                <Zap size={14} /> Avalanche Forecast
                <HelpHint text="Center-issued avalanche danger by elevation, bottom line, and published avalanche problems for this zone/date." />
              </span>
              <div className="source-meta">
                <span>Avalanche center: {safetyData.avalanche.center || 'N/A'}</span>
                {safetyData.avalanche.zone && <span className="source-zone">{safetyData.avalanche.zone}</span>}
                {safetyData.avalanche.publishedTime && (
                  <span className="published-chip">
                    <Clock size={10} /> Issued: {formatPubTime(safetyData.avalanche.publishedTime)}
                  </span>
                )}
                {safetyData.avalanche.expiresTime && (
                  <span className={`published-chip ${avalancheExpiredForSelectedStart ? 'published-chip-expired' : ''}`}>
                    <Clock size={10} /> {avalancheExpiredForSelectedStart ? 'Expired:' : 'Expires:'} {formatPubTime(safetyData.avalanche.expiresTime)}
                  </span>
                )}
              </div>
            </div>
            {avalancheExpiredForSelectedStart && (
              <p className="muted-note">
                This bulletin is expired for the selected start time and is shown for context only.
              </p>
            )}

            {!avalancheRelevant ? (
              <div className="avy-forecast-body">
                <div className="avy-coverage-note unknown-mode-panel">
                  <strong>Avalanche Forecast Not Applicable</strong>
                  <p>{avalancheNotApplicableReason}</p>
                  <p className="muted-note">
                    Result is hidden for this objective/time because avalanche forecasting is currently de-emphasized. Re-check if weather or snowpack changes.
                  </p>
                </div>
              </div>
            ) : (
              <div className="avy-forecast-body">
                <div className="danger-summary-box">
                  <div className="danger-summary-header">
                    <span className="section-label">{avalancheUnknown ? 'Avalanche Coverage Status' : 'Danger Rating By Elevation'}</span>
                    <span className={`overall-danger-chip ${avalancheUnknown ? 'danger-level-unknown' : getDangerLevelClass(overallAvalancheLevel ?? undefined)}`}>
                      {avalancheUnknown ? 'Overall: Unknown' : `Overall: L${overallAvalancheLevel} ${getDangerText(overallAvalancheLevel ?? 0)}`}
                    </span>
                  </div>

                  {avalancheUnknown ? (
                    <div className="avy-coverage-note unknown-mode-panel">
                      <strong>Limited Avalanche Coverage</strong>
                      <p>
                        No official avalanche forecast is available for this objective. This does not imply low risk.
                      </p>
                      <ul className="signal-list compact">
                        <li>Avoid avalanche terrain and terrain traps unless you can independently assess snowpack.</li>
                        <li>Favor low-angle routes and wind-sheltered aspects.</li>
                        <li>Use explicit abort triggers and tighter partner spacing.</li>
                      </ul>
                    </div>
                  ) : (
                    <>
                      <div className="avy-danger-layout">
                        <div
                          className={`avy-danger-pyramid ${getDangerLevelClass(overallAvalancheLevel ?? undefined)}`}
                          aria-hidden="true"
                        />
                        <div className="danger-rows">
                          {avalancheElevationRows.map((row) => {
                            const rowLevel = normalizeDangerLevel(row.rating?.level);
                            const rowText = row.rating?.label || getDangerText(rowLevel);
                            return (
                              <div key={row.key} className={`danger-row ${getDangerLevelClass(rowLevel)}`}>
                                <span className="danger-row-band">{row.label}</span>
                                <strong className="danger-row-text">
                                  {rowLevel} - {rowText}
                                </strong>
                                <span className={`danger-level-diamond ${getDangerLevelClass(rowLevel)}`}>
                                  <span>{getDangerGlyph(rowLevel)}</span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="avy-scale-wrap">
                        <span className="section-label">Danger Scale</span>
                        <div className="avy-scale-track">
                          {[1, 2, 3, 4, 5].map((level) => (
                            <div key={level} className={`avy-scale-segment ${getDangerLevelClass(level)}`}>
                              {level} - {getDangerText(level)}
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {(safetyData.avalanche.bottomLine || safetyData.avalanche.advice) && (
                  <div className="avy-bottom-line">
                    <div className="bl-header">The Bottom Line</div>
                    <div className="bl-content">{toPlainText(safetyData.avalanche.bottomLine || safetyData.avalanche.advice)}</div>
                  </div>
                )}

                {safetyData.avalanche.problems && safetyData.avalanche.problems.length > 0 && (
                  <div className="avy-problems">
                    <span className="section-label">Avalanche Problems</span>
                    <div className="problems-grid">
                      {safetyData.avalanche.problems.map((problem, i) => {
                      const terrain = parseTerrainFromLocation(problem.location);
                      const locationEntries = getLocationEntries(problem.location);
                      const summary = summarizeText(problem.discussion || problem.problem_description);
                      const iconUrl = problem.icon ? problem.icon.replace(/^http:\/\//i, 'https://') : '';
                      const likelihoodRange = parseLikelihoodRange(problem.likelihood);
                      const sizeRange = parseProblemSizeRange(problem.size);
                      const likelihoodScaleStyle =
                        likelihoodRange !== null
                          ? ({
                              ['--scale-indicator-top-index' as string]: String(5 - likelihoodRange.max),
                              ['--scale-indicator-span' as string]: String(likelihoodRange.max - likelihoodRange.min + 1),
                            } as React.CSSProperties)
                          : undefined;
                      const sizeScaleStyle =
                        sizeRange.min !== null && sizeRange.max !== null
                          ? ({
                              ['--scale-indicator-top-index' as string]: String(5 - sizeRange.max),
                              ['--scale-indicator-span' as string]: String(sizeRange.max - sizeRange.min + 1),
                            } as React.CSSProperties)
                          : undefined;

                      return (
                        <article key={problem.id || i} className="avy-problem-card avy-problem-card-structured">
                          <h4 className="problem-structured-title">Problem #{i + 1}: {(problem.name || `Problem ${i + 1}`).toUpperCase()}</h4>
                          <div className="problem-structured-grid">
                            <section className="problem-structured-col">
                              <div className="problem-structured-label">Problem Type</div>
                              <div className="problem-type-box">
                                <div className="problem-icon problem-icon-lg">
                                  {iconUrl ? <img src={iconUrl} alt={`${problem.name || 'Avalanche problem'} icon`} /> : <AlertTriangle size={18} />}
                                </div>
                                <div className="problem-type-name">{problem.name || `Problem ${i + 1}`}</div>
                              </div>
                            </section>

                            <section className="problem-structured-col">
                              <div className="problem-structured-label">Aspect/Elevation</div>
                              <div className="aspect-elevation-box">
                                <div className="aspect-elevation-simple">
                                  <div className="aspect-simple-group">
                                    <span className="aspect-simple-heading">Aspects</span>
                                    <div className="aspect-chip-grid" role="list" aria-label="Avalanche problem aspects">
                                      {ASPECT_ROSE_ORDER.map((aspect) => {
                                        const isActive = terrain.aspects.size === 0 || terrain.aspects.has(aspect);
                                        return (
                                          <span key={`${problem.id || i}-${aspect}`} className={`aspect-chip ${isActive ? 'active' : ''}`} role="listitem">
                                            {aspect}
                                          </span>
                                        );
                                      })}
                                    </div>
                                    <p className="aspect-simple-note">
                                      {terrain.aspects.size === 0
                                        ? 'No specific aspects listed; treat all aspects as potentially involved.'
                                        : 'Highlighted aspects are identified in the bulletin.'}
                                    </p>
                                  </div>

                                  <div className="aspect-simple-group">
                                    <span className="aspect-simple-heading">Elevation Bands</span>
                                    <div className="elevation-band-list" role="list" aria-label="Avalanche problem elevation bands">
                                      {[
                                        { band: 'upper', label: 'Above Treeline' },
                                        { band: 'middle', label: 'Near Treeline' },
                                        { band: 'lower', label: 'Below Treeline' },
                                      ].map((entry) => {
                                        const isActive = terrain.elevations.size === 0 || terrain.elevations.has(entry.band as 'upper' | 'middle' | 'lower');
                                        return (
                                          <div key={`${problem.id || i}-${entry.band}`} className={`elevation-band-row ${isActive ? 'active' : ''}`} role="listitem">
                                            <span className="elevation-band-label">{entry.label}</span>
                                            <span className="elevation-band-state">{isActive ? 'Included' : 'Not highlighted'}</span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </section>

                            <section className="problem-structured-col">
                              <div className="problem-structured-label">Likelihood</div>
                              <div className="vertical-scale" style={likelihoodScaleStyle}>
                                <div className="scale-rail" />
                                {likelihoodRange !== null && <div className="scale-indicator" aria-hidden="true" />}
                                {[5, 4, 3, 2, 1].map((step) => (
                                  <div
                                    key={step}
                                    className={`scale-step ${
                                      likelihoodRange !== null && step >= likelihoodRange.min && step <= likelihoodRange.max ? 'active' : ''
                                    }`}
                                  >
                                    <span className="scale-tick" />
                                    <span className="scale-text">
                                      {step === 5 ? 'Certain' : step === 4 ? 'Very Likely' : step === 3 ? 'Likely' : step === 2 ? 'Possible' : 'Unlikely'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </section>

                            <section className="problem-structured-col">
                              <div className="problem-structured-label">Size</div>
                              <div className="vertical-scale size-scale" style={sizeScaleStyle}>
                                <div className="scale-rail" />
                                {sizeRange.min !== null && sizeRange.max !== null && <div className="scale-indicator" aria-hidden="true" />}
                                {[5, 4, 3, 2, 1].map((step) => {
                                  const activeRange =
                                    sizeRange.min !== null &&
                                    sizeRange.max !== null &&
                                    step >= sizeRange.min &&
                                    step <= sizeRange.max;
                                  return (
                                    <div key={step} className={`scale-step ${activeRange ? 'active' : ''}`}>
                                      <span className="scale-tick" />
                                      <span className="scale-text">
                                        {step === 5 ? 'Historic (D4-5)' : step === 4 ? 'Very Large (D3)' : step === 3 ? 'Large (D2)' : step === 2 ? 'Small-Large (D1-2)' : 'Small (D1)'}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </section>
                          </div>

                          {locationEntries.length > 0 && terrain.elevations.size === 0 && terrain.aspects.size === 0 && (
                            <p className="problem-location-line">Terrain: {locationEntries.join(', ')}</p>
                          )}

                          {summary && <p className="problem-summary">{summary}</p>}
                        </article>
                      );
                    })}
                    </div>
                  </div>
                )}

                {(!safetyData.avalanche.problems || safetyData.avalanche.problems.length === 0) && (
                  <p className="muted-note avy-problems-empty">
                    {avalancheUnknown
                      ? 'No avalanche center problem list is available for this objective.'
                      : 'Center did not publish a detailed avalanche problem breakdown for this zone/date.'}
                  </p>
                )}
              </div>
            )}

            {safeAvalancheLink && (
              <a href={safeAvalancheLink} target="_blank" rel="noreferrer" className="avy-external-link">
                View full forecast at {safetyData.avalanche.center?.toUpperCase() || 'OFFICIAL CENTER'} →
              </a>
            )}
          </div>

          <div className="ai-box field-brief-card" style={{ order: reportCardOrder.fieldBrief }}>
            <div className="card-header">
              <span className="card-title">
                <ShieldCheck size={14} /> Field Brief
                <HelpHint text="Action-first field brief with primary call, top risks, immediate actions, and optional details." />
              </span>
              <span className={`decision-pill ${decision.level.toLowerCase().replace('-', '')}`}>{decision.level}</span>
            </div>
            <p className="field-brief-headline">{fieldBriefHeadline}</p>

            <div className="field-brief-primary">
              <span className="field-brief-primary-label">Command intent</span>
              <p className="field-brief-primary-text">{fieldBriefPrimaryReason}</p>
              <p className="field-brief-primary-action">{decisionActionLine}</p>
            </div>

            <div className="field-brief-glance-grid" role="list" aria-label="Field brief at a glance">
              {fieldBriefAtAGlance.map((item) => (
                <article key={item.label} className="field-brief-glance-item" role="listitem">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </article>
              ))}
            </div>

            <div className="field-brief-split">
              <div className="field-brief-group">
                <h4>Execution Plan (Next 2-4h)</h4>
                <ol className="field-brief-steps">
                  {(fieldBriefExecutionSteps.length > 0
                    ? fieldBriefExecutionSteps
                    : ['Re-check conditions at departure and continue only if field observations match forecast assumptions.']
                  ).map((item, idx) => (
                    <li key={idx}>{localizeUnitText(item)}</li>
                  ))}
                </ol>
              </div>

              <div className="field-brief-group">
                <h4>Top Watchouts</h4>
                <ul className="signal-list compact">
                  {(fieldBriefTopRisks.length > 0 ? fieldBriefTopRisks : ['No dominant risk trigger detected from current model signals.']).map((item, idx) => (
                    <li key={idx}>{localizeUnitText(item)}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="field-brief-group">
              <h4>Immediate Actions</h4>
              <ul className="signal-list compact">
                {(fieldBriefImmediateActions.length > 0 ? fieldBriefImmediateActions : fieldBriefActions).map((item, idx) => (
                  <li key={idx}>{localizeUnitText(item)}</li>
                ))}
              </ul>
            </div>

            <details className="field-brief-details">
              <summary>Show full snapshot, abort triggers, and all actions</summary>
              <div className="field-brief-group">
                <h4>Situation Snapshot</h4>
                <ul className="signal-list compact">
                  {fieldBriefSnapshot.map((item, idx) => (
                    <li key={idx}>{localizeUnitText(item)}</li>
                  ))}
                </ul>
              </div>
              <div className="field-brief-group">
                <h4>Abort Triggers</h4>
                <ul className="signal-list compact">
                  {fieldBriefAbortTriggers.map((item, idx) => (
                    <li key={idx}>{localizeUnitText(item)}</li>
                  ))}
                </ul>
              </div>
              <div className="field-brief-group">
                <h4>Full Action List</h4>
                <ul className="signal-list compact">
                  {fieldBriefActions.map((item, idx) => (
                    <li key={idx}>{localizeUnitText(item)}</li>
                  ))}
                </ul>
              </div>
            </details>
          </div>

          <div className="card raw-report-card" style={{ order: reportCardOrder.deepDiveData }}>
            <div className="card-header">
              <span className="card-title">
                <Search size={14} /> Deep Dive Report Data
                <HelpHint text="Raw source fields and report payload for validation, troubleshooting, and deeper analysis." />
              </span>
              <div className="raw-report-actions">
                <span className="raw-report-hint">Optional</span>
                <button type="button" className="raw-copy-btn" onClick={handleCopyRawPayload} disabled={!rawReportPayload}>
                  {copiedRawPayload ? 'Copied JSON' : 'Copy JSON'}
                </button>
              </div>
            </div>

            <details className="raw-report-details">
              <summary>Show raw source fields and report payload</summary>

              <div className="raw-grid">
                <section className="raw-group">
                  <h4>Planner Input Fields</h4>
                  <ul className="raw-kv-list">
                    <li>
                      <span className="raw-key">Objective</span>
                      <span className="raw-value">{objectiveName || 'Pinned Objective'}</span>
                    </li>
                    <li>
                      <span className="raw-key">Coordinates</span>
                      <span className="raw-value">
                        {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">Forecast Date</span>
                      <span className="raw-value">{safetyData.forecast?.selectedDate || forecastDate}</span>
                    </li>
                    <li>
                      <span className="raw-key">Start Time</span>
                      <span className="raw-value">{displayStartTime}</span>
                    </li>
                    <li>
                      <span className="raw-key">Share Link</span>
                      <span className="raw-value">
                        {safeShareLink ? (
                          <a href={safeShareLink} target="_blank" rel="noreferrer" className="raw-link-value">
                            Open current plan URL
                          </a>
                        ) : (
                          'N/A'
                        )}
                      </span>
                    </li>
                  </ul>
                </section>

                <section className="raw-group">
                  <h4>Weather Source Fields</h4>
                  <ul className="raw-kv-list">
                    <li>
                      <span className="raw-key">Issued</span>
                      <span className="raw-value">{safetyData.weather.issuedTime ? formatPubTime(safetyData.weather.issuedTime) : 'N/A'}</span>
                    </li>
                    <li>
                      <span className="raw-key">Forecast Start</span>
                      <span className="raw-value">
                        {safetyData.weather.forecastStartTime
                          ? formatForecastPeriodLabel(safetyData.weather.forecastStartTime, safetyData.weather.timezone || null)
                          : 'N/A'}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">Forecast End</span>
                      <span className="raw-value">
                        {safetyData.weather.forecastEndTime
                          ? formatForecastPeriodLabel(safetyData.weather.forecastEndTime, safetyData.weather.timezone || null)
                          : 'N/A'}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">Humidity</span>
                      <span className="raw-value">
                        {Number.isFinite(Number(safetyData.weather.humidity)) ? `${Math.round(Number(safetyData.weather.humidity))}%` : 'N/A'}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">Dew Point</span>
                      <span className="raw-value">{formatTempDisplay(safetyData.weather.dewPoint)}</span>
                    </li>
                    <li>
                      <span className="raw-key">Cloud Cover</span>
                      <span className="raw-value">{safetyData.weather.cloudCover}%</span>
                    </li>
                    <li>
                      <span className="raw-key">Rainfall 12h/24h/48h</span>
                      <span className="raw-value">
                        {rainfall12hDisplay} / {rainfall24hDisplay} / {rainfall48hDisplay}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">Snowfall 12h/24h/48h</span>
                      <span className="raw-value">
                        {snowfall12hDisplay} / {snowfall24hDisplay} / {snowfall48hDisplay}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">Forecast URL</span>
                      <span className="raw-value">
                        {safeWeatherLink ? (
                          <a href={safeWeatherLink} target="_blank" rel="noreferrer" className="raw-link-value">
                            Open source forecast
                          </a>
                        ) : (
                          'N/A'
                        )}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">Primary Weather Source</span>
                      <span className="raw-value">{weatherSourceDisplay}</span>
                    </li>
                    <li>
                      <span className="raw-key">Weather Blended</span>
                      <span className="raw-value">{safetyData.weather.sourceDetails?.blended ? 'true' : 'false'}</span>
                    </li>
                    <li>
                      <span className="raw-key">Field Source Map</span>
                      <span className={`raw-value ${Object.keys(weatherFieldSources).length > 0 ? 'raw-value-stack' : ''}`}>
                        {Object.keys(weatherFieldSources).length > 0
                          ? Object.entries(weatherFieldSources).map(([field, source]) => <span key={field}>{field}: {source}</span>)
                          : 'N/A'}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">Objective Elevation</span>
                      <span className="raw-value">
                        {safetyData.weather.elevation != null
                          ? formatElevationDisplay(safetyData.weather.elevation)
                          : 'N/A'}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">Elevation Source</span>
                      <span className="raw-value">{safetyData.weather.elevationSource || 'N/A'}</span>
                    </li>
                    <li>
                      <span className="raw-key">Elevation Forecast Note</span>
                      <span className="raw-value">{safetyData.weather.elevationForecastNote ? localizeUnitText(safetyData.weather.elevationForecastNote) : 'N/A'}</span>
                    </li>
                    <li>
                      <span className="raw-key">Elevation Bands</span>
                      <span className={`raw-value ${elevationForecastBands.length > 0 ? 'raw-value-stack' : ''}`}>
                        {elevationForecastBands.length > 0
                          ? elevationForecastBands.map((band) => (
                              <span key={`${band.label}-${band.elevationFt}`}>
                                {band.label}: {formatElevationDisplay(band.elevationFt)} ({formatElevationDeltaDisplay(
                                  band.deltaFromObjectiveFt,
                                )}), {formatTempDisplay(band.temp)}, feels {formatTempDisplay(band.feelsLike)}, wind {formatWindDisplay(
                                  band.windSpeed,
                                )}, gust {formatWindDisplay(band.windGust)}
                              </span>
                            ))
                          : 'N/A'}
                      </span>
                    </li>
                  </ul>
                </section>

                <section className="raw-group">
                  <h4>Avalanche Source Fields</h4>
                  <ul className="raw-kv-list">
                    <li>
                      <span className="raw-key">Avalanche Center</span>
                      <span className="raw-value">{safetyData.avalanche.center || 'N/A'}</span>
                    </li>
                    <li>
                      <span className="raw-key">Zone</span>
                      <span className="raw-value">{safetyData.avalanche.zone || 'N/A'}</span>
                    </li>
                    <li>
                      <span className="raw-key">Published</span>
                      <span className="raw-value">{safetyData.avalanche.publishedTime ? formatPubTime(safetyData.avalanche.publishedTime) : 'N/A'}</span>
                    </li>
                    <li>
                      <span className="raw-key">Expires</span>
                      <span className="raw-value">{safetyData.avalanche.expiresTime ? formatPubTime(safetyData.avalanche.expiresTime) : 'N/A'}</span>
                    </li>
                    <li>
                      <span className="raw-key">Danger Level</span>
                      <span className="raw-value">
                        {avalancheUnknown ? 'Unknown (No Coverage)' : `L${normalizeDangerLevel(safetyData.avalanche.dangerLevel)}`}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">Coverage Status</span>
                      <span className="raw-value">{safetyData.avalanche.coverageStatus || 'N/A'}</span>
                    </li>
                    <li>
                      <span className="raw-key">Unknown Risk Flag</span>
                      <span className="raw-value">{safetyData.avalanche.dangerUnknown ? 'true' : 'false'}</span>
                    </li>
                    <li>
                      <span className="raw-key">Problem Count</span>
                      <span className="raw-value">{safetyData.avalanche.problems?.length || 0}</span>
                    </li>
                    <li>
                      <span className="raw-key">Avalanche Center Link</span>
                      <span className="raw-value">
                        {safeAvalancheLink ? (
                          <a href={safeAvalancheLink} target="_blank" rel="noreferrer" className="raw-link-value">
                            Open center bulletin
                          </a>
                        ) : (
                          'N/A'
                        )}
                      </span>
                    </li>
                  </ul>
                </section>

                <section className="raw-group">
                  <h4>Additional Risk Sources</h4>
                  <ul className="raw-kv-list">
                    <li>
                      <span className="raw-key">NWS Alert Count</span>
                      <span className="raw-value">{safetyData.alerts?.activeCount ?? 0}</span>
                    </li>
                    <li>
                      <span className="raw-key">Highest Alert Severity</span>
                      <span className="raw-value">{safetyData.alerts?.highestSeverity || 'N/A'}</span>
                    </li>
                    <li>
                      <span className="raw-key">Alert Events</span>
                      <span className={`raw-value ${safetyData.alerts?.alerts && safetyData.alerts.alerts.length > 0 ? 'raw-value-stack' : ''}`}>
                        {safetyData.alerts?.alerts && safetyData.alerts.alerts.length > 0
                          ? safetyData.alerts.alerts.map((alert, idx) => {
                              const safeAlertLink = sanitizeExternalUrl(alert.link || undefined);
                              return (
                                <span key={`${alert.event || 'alert'}-${idx}`}>
                                  {(alert.event || 'Alert')} • {alert.severity || 'Unknown'} • {alert.urgency || 'Unknown'}
                                  {safeAlertLink ? (
                                    <>
                                      {' '}
                                      •{' '}
                                      <a href={safeAlertLink} target="_blank" rel="noreferrer" className="raw-link-value">
                                        Source link
                                      </a>
                                    </>
                                  ) : null}
                                </span>
                              );
                            })
                          : 'None'}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">US AQI</span>
                      <span className="raw-value">
                        {safetyData.airQuality?.usAqi != null ? `${Math.round(safetyData.airQuality.usAqi)} (${safetyData.airQuality.category || 'N/A'})` : 'N/A'}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">Heat Risk Level</span>
                      <span className="raw-value">
                        {safetyData.heatRisk?.label || heatRiskLabel || 'N/A'}
                        {Number.isFinite(Number(safetyData.heatRisk?.level)) ? ` (L${Number(safetyData.heatRisk?.level)})` : ''}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">Heat Risk Guidance</span>
                      <span className="raw-value">{safetyData.heatRisk?.guidance || heatRiskGuidance || 'N/A'}</span>
                    </li>
                    <li>
                      <span className="raw-key">Fire Risk Level</span>
                      <span className="raw-value">
                        {safetyData.fireRisk?.label || 'N/A'}
                        {Number.isFinite(Number(safetyData.fireRisk?.level)) ? ` (L${Number(safetyData.fireRisk?.level)})` : ''}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">Fire Risk Guidance</span>
                      <span className="raw-value">{safetyData.fireRisk?.guidance || 'N/A'}</span>
                    </li>
                    <li>
                      <span className="raw-key">Fire Alert Signals</span>
                      <span className={`raw-value ${fireRiskAlerts.length > 0 ? 'raw-value-stack' : ''}`}>
                        {fireRiskAlerts.length > 0
                          ? fireRiskAlerts.map((alert, idx) => {
                              const safeAlertLink = sanitizeExternalUrl(alert.link || undefined);
                              return (
                                <span key={`${alert.event || 'fire'}-${idx}`}>
                                  {alert.event || 'Alert'} • {alert.severity || 'Unknown'}
                                  {safeAlertLink ? (
                                    <>
                                      {' '}
                                      •{' '}
                                      <a href={safeAlertLink} target="_blank" rel="noreferrer" className="raw-link-value">
                                        Source link
                                      </a>
                                    </>
                                  ) : null}
                                </span>
                              );
                            })
                          : 'None'}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">PM2.5</span>
                      <span className="raw-value">
                        {safetyData.airQuality?.pm25 != null ? `${safetyData.airQuality.pm25} μg/m³` : 'N/A'}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">AQI Sample Time (UTC)</span>
                      <span className="raw-value">
                        {safetyData.airQuality?.measuredTime
                          ? formatForecastPeriodLabel(safetyData.airQuality.measuredTime, 'UTC')
                          : 'N/A'}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">Snowpack Summary</span>
                      <span className="raw-value">{safetyData.snowpack?.summary ? localizeUnitText(safetyData.snowpack.summary) : 'N/A'}</span>
                    </li>
                    <li>
                      <span className="raw-key">SNOTEL Station</span>
                      <span className="raw-value">
                        {safetyData.snowpack?.snotel?.stationName
                          ? `${safetyData.snowpack.snotel.stationName}${snotelDistanceDisplay !== 'N/A' ? ` (${snotelDistanceDisplay})` : ''}`
                          : 'N/A'}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">SNOTEL SWE / Depth</span>
                      <span className="raw-value">
                        {Number.isFinite(Number(safetyData.snowpack?.snotel?.sweIn)) || Number.isFinite(Number(safetyData.snowpack?.snotel?.snowDepthIn))
                          ? `${snotelSweDisplay !== 'N/A' ? snotelSweDisplay : 'SWE N/A'} • ${snotelDepthDisplay !== 'N/A' ? `${snotelDepthDisplay} depth` : 'Depth N/A'}`
                          : 'N/A'}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">NOHRSC SWE / Depth</span>
                      <span className="raw-value">
                        {Number.isFinite(Number(safetyData.snowpack?.nohrsc?.sweIn)) || Number.isFinite(Number(safetyData.snowpack?.nohrsc?.snowDepthIn))
                          ? `${nohrscSweDisplay !== 'N/A' ? nohrscSweDisplay : 'SWE N/A'} • ${nohrscDepthDisplay !== 'N/A' ? `${nohrscDepthDisplay} depth` : 'Depth N/A'}`
                          : 'N/A'}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">Snowpack Source Links</span>
                      <span className={`raw-value ${safeSnotelLink || safeNohrscLink ? 'raw-value-stack' : ''}`}>
                        {safeSnotelLink || safeNohrscLink ? (
                          <>
                            {safeSnotelLink ? (
                              <span>
                                <a href={safeSnotelLink} target="_blank" rel="noreferrer" className="raw-link-value">
                                  NRCS AWDB / SNOTEL
                                </a>
                              </span>
                            ) : null}
                            {safeNohrscLink ? (
                              <span>
                                <a href={safeNohrscLink} target="_blank" rel="noreferrer" className="raw-link-value">
                                  NOAA NOHRSC Snow Analysis
                                </a>
                              </span>
                            ) : null}
                          </>
                        ) : (
                          'N/A'
                        )}
                      </span>
                    </li>
                  </ul>
                </section>

                <section className="raw-group">
                  <h4>Report Output Fields</h4>
                  <ul className="raw-kv-list">
                    <li>
                      <span className="raw-key">Safety Score</span>
                      <span className="raw-value">{safetyData.safety.score}</span>
                    </li>
                    <li>
                      <span className="raw-key">Score Confidence</span>
                      <span className="raw-value">
                        {typeof safetyData.safety.confidence === 'number' ? `${safetyData.safety.confidence}%` : 'N/A'}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">Primary Hazard</span>
                      <span className="raw-value">{safetyData.safety.primaryHazard || 'N/A'}</span>
                    </li>
                    <li>
                      <span className="raw-key">Decision Level</span>
                      <span className="raw-value">{decision?.level || 'N/A'}</span>
                    </li>
                    <li>
                      <span className="raw-key">Blocker Count</span>
                      <span className="raw-value">{decision?.blockers.length || 0}</span>
                    </li>
                    <li>
                      <span className="raw-key">Caution Count</span>
                      <span className="raw-value">{decision?.cautions.length || 0}</span>
                    </li>
                    <li>
                      <span className="raw-key">Applied Risk Factors</span>
                      <span className="raw-value">{safetyData.safety.factors?.length || 0}</span>
                    </li>
                    <li>
                      <span className="raw-key">Risk Groups</span>
                      <span className="raw-value">{Object.keys(safetyData.safety.groupImpacts || {}).length}</span>
                    </li>
                    <li>
                      <span className="raw-key">Safety Sources</span>
                      <span className={`raw-value ${safetyData.safety.sourcesUsed && safetyData.safety.sourcesUsed.length > 0 ? 'raw-value-stack' : ''}`}>
                        {safetyData.safety.sourcesUsed && safetyData.safety.sourcesUsed.length > 0
                          ? safetyData.safety.sourcesUsed.map((source, idx) => <span key={`${source}-${idx}`}>{source}</span>)
                          : 'N/A'}
                      </span>
                    </li>
                    <li>
                      <span className="raw-key">SAT One-Liner Length</span>
                      <span className="raw-value">{satelliteConditionLine.length || 0} chars</span>
                    </li>
                  </ul>
                </section>
              </div>

              <details className="raw-json-details">
                <summary>Open full JSON payload used to build this report</summary>
                <pre className="raw-json-pre">{rawReportPayload}</pre>
              </details>
            </details>
          </div>

        </div>
      )}
      <div className="planner-footer-stack">
        <AppDisclaimer compact />
        {hasObjective && safetyData && !loading && !error && decision && (
          <div className="footer">
            Generated by Backcountry Conditions • {formatGeneratedAt()} • {APP_CREDIT_TEXT}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
