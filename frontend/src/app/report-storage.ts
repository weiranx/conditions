import {
  DATE_FMT,
  MAX_TRAVEL_WINDOW_HOURS,
  MIN_TRAVEL_WINDOW_HOURS,
  PERSISTED_REPORT_KEY,
} from './constants';
import { isValidLatLon, parseTimeInputMinutes } from './core';
import { hasStoredUserPreferences, normalizeUserPreferences } from './preferences';
import type { SafetyData, UserPreferences } from './types';
import { buildSafetyRequestKey } from './url-state';
import type { RouteAnalysisResult, RouteOption } from '../hooks/useRouteAnalysis';

const PERSISTED_REPORT_VERSION = 2;

export interface PersistedReportPlan {
  lat: number;
  lon: number;
  objectiveName: string;
  searchQuery: string;
  forecastDate: string;
  alpineStartTime: string;
  targetElevationInput: string;
  travelWindowHours: number;
}

export interface PersistedReportAiFields {
  aiBriefNarrative: string | null;
  snowVisionAnalysis: string | null;
  snowVisionImage: string | null;
  reportChatMessages: PersistedReportChatMessage[];
}

export interface PersistedReportChatPart {
  type: string;
  [key: string]: unknown;
}

export interface PersistedReportChatMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: PersistedReportChatPart[];
}

export interface PersistedReportRouteFields {
  routeSuggestions: RouteOption[] | null;
  routeAnalysis: RouteAnalysisResult | null;
  customRouteName: string;
}

export interface PersistedReport {
  version: typeof PERSISTED_REPORT_VERSION;
  savedAt: string;
  plan: PersistedReportPlan;
  preferences: UserPreferences | null;
  safetyData: SafetyData;
  ai: PersistedReportAiFields;
  route: PersistedReportRouteFields;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSafetyData(value: unknown): value is SafetyData {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isRecord(value.location) &&
    isValidLatLon(Number(value.location.lat), Number(value.location.lon)) &&
    isRecord(value.weather) &&
    isRecord(value.solar) &&
    isRecord(value.avalanche) &&
    isRecord(value.safety)
  );
}

function parseChatMessages(value: unknown): PersistedReportChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((message) => {
    if (
      !isRecord(message)
      || typeof message.id !== 'string'
      || (message.role !== 'user' && message.role !== 'assistant')
      || !Array.isArray(message.parts)
    ) {
      return [];
    }
    const parts = message.parts.filter((part): part is PersistedReportChatPart => (
      isRecord(part) && typeof part.type === 'string'
    ));
    return parts.length > 0 ? [{ id: message.id, role: message.role, parts }] : [];
  });
}

export function parsePersistedReport(value: unknown): PersistedReport | null {
  if (!isRecord(value) || (value.version !== 1 && value.version !== PERSISTED_REPORT_VERSION) || !isRecord(value.plan)) {
    return null;
  }

  const plan = value.plan;
  const lat = Number(plan.lat);
  const lon = Number(plan.lon);
  const travelWindowHours = Number(plan.travelWindowHours);
  const forecastDate = typeof plan.forecastDate === 'string' ? plan.forecastDate : '';
  const alpineStartTime = typeof plan.alpineStartTime === 'string' ? plan.alpineStartTime : '';
  if (
    !isValidLatLon(lat, lon) ||
    !DATE_FMT.test(forecastDate) ||
    parseTimeInputMinutes(alpineStartTime) === null ||
    !Number.isInteger(travelWindowHours) ||
    travelWindowHours < MIN_TRAVEL_WINDOW_HOURS ||
    travelWindowHours > MAX_TRAVEL_WINDOW_HOURS ||
    !isSafetyData(value.safetyData)
  ) {
    return null;
  }

  return {
    version: PERSISTED_REPORT_VERSION,
    savedAt: typeof value.savedAt === 'string' ? value.savedAt : '',
    plan: {
      lat,
      lon,
      objectiveName: typeof plan.objectiveName === 'string' ? plan.objectiveName : '',
      searchQuery: typeof plan.searchQuery === 'string' ? plan.searchQuery : '',
      forecastDate,
      alpineStartTime,
      targetElevationInput: typeof plan.targetElevationInput === 'string' ? plan.targetElevationInput : '',
      travelWindowHours,
    },
    preferences: hasStoredUserPreferences(value.preferences)
      ? normalizeUserPreferences(value.preferences)
      : null,
    safetyData: value.safetyData,
    ai: {
      aiBriefNarrative: isRecord(value.ai) && typeof value.ai.aiBriefNarrative === 'string'
        ? value.ai.aiBriefNarrative
        : null,
      snowVisionAnalysis: isRecord(value.ai) && typeof value.ai.snowVisionAnalysis === 'string'
        ? value.ai.snowVisionAnalysis
        : null,
      snowVisionImage: isRecord(value.ai) && typeof value.ai.snowVisionImage === 'string'
        ? value.ai.snowVisionImage
        : null,
      reportChatMessages: isRecord(value.ai)
        ? parseChatMessages(value.ai.reportChatMessages)
        : [],
    },
    route: {
      routeSuggestions: isRecord(value.route) && Array.isArray(value.route.routeSuggestions)
        ? value.route.routeSuggestions as RouteOption[]
        : null,
      routeAnalysis: isRecord(value.route) && isRecord(value.route.routeAnalysis)
        ? value.route.routeAnalysis as unknown as RouteAnalysisResult
        : null,
      customRouteName: isRecord(value.route) && typeof value.route.customRouteName === 'string'
        ? value.route.customRouteName
        : '',
    },
  };
}

export function loadPersistedReport(): PersistedReport | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(PERSISTED_REPORT_KEY);
    if (!raw) {
      return null;
    }
    const parsed = parsePersistedReport(JSON.parse(raw));
    if (!parsed) {
      window.localStorage.removeItem(PERSISTED_REPORT_KEY);
    }
    return parsed;
  } catch {
    try {
      window.localStorage.removeItem(PERSISTED_REPORT_KEY);
    } catch {
      // Storage may be unavailable; there is nothing else to recover.
    }
    return null;
  }
}

export function persistReport(
  plan: PersistedReportPlan,
  safetyData: SafetyData,
  ai: PersistedReportAiFields,
  extras?: {
    preferences?: UserPreferences | null;
    route?: PersistedReportRouteFields;
  },
): void {
  if (typeof window === 'undefined') {
    return;
  }

  const report = buildPersistedReport(plan, safetyData, ai, extras);
  try {
    window.localStorage.setItem(PERSISTED_REPORT_KEY, JSON.stringify(report));
  } catch {
    // QuotaExceededError or SecurityError — keep the in-memory report working.
  }
}

export function buildPersistedReport(
  plan: PersistedReportPlan,
  safetyData: SafetyData,
  ai: PersistedReportAiFields,
  extras?: {
    preferences?: UserPreferences | null;
    route?: PersistedReportRouteFields;
  },
): PersistedReport {
  return {
    version: PERSISTED_REPORT_VERSION,
    savedAt: new Date().toISOString(),
    plan,
    preferences: extras?.preferences ?? null,
    safetyData,
    ai,
    route: extras?.route ?? {
      routeSuggestions: null,
      routeAnalysis: null,
      customRouteName: '',
    },
  };
}

export function clearPersistedReport(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(PERSISTED_REPORT_KEY);
  } catch {
    // Storage may be unavailable; the current in-memory report can still be cleared.
  }
}

export function persistedReportMatchesPlan(
  report: PersistedReport,
  plan: { lat: number; lon: number; forecastDate: string; alpineStartTime: string; travelWindowHours: number },
): boolean {
  return buildSafetyRequestKey(
    report.plan.lat,
    report.plan.lon,
    report.plan.forecastDate,
    report.plan.alpineStartTime,
    report.plan.travelWindowHours,
  ) === buildSafetyRequestKey(
    plan.lat,
    plan.lon,
    plan.forecastDate,
    plan.alpineStartTime,
    plan.travelWindowHours,
  );
}
