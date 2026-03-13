import React, { useState, useEffect, useCallback, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import './App.css';
import {
  DATE_FMT,
  GUST_INCREASE_MPH_PER_1000FT,
  MAP_STYLE_OPTIONS,
  MAX_TRAVEL_WINDOW_HOURS,
  MIN_TRAVEL_WINDOW_HOURS,
  TEMP_LAPSE_F_PER_1000FT,
  WIND_INCREASE_MPH_PER_1000FT,
} from './app/constants';
import {
  type ActivityType,
  type MapStyle,
  type SafetyData,
  type SummitDecision,
  type UserPreferences,
  type WeatherTrendPoint,
} from './app/types';
import {
  convertDisplayElevationToFeet,
  convertElevationFeetToDisplayValue,
  formatAgeFromNow,
  formatClockForStyle,
  formatDateInput,
  formatDistanceForElevationUnit,
  formatElevationDeltaForUnit,
  formatElevationForUnit,
  formatSnowDepthForElevationUnit,
  formatSweForElevationUnit,
  formatTemperatureForUnit,
  formatWindForUnit,
  minutesToTwentyFourHourClock,
  normalizeForecastDate,
  parseIsoToMs,
  parseOptionalFiniteNumber,
  parseHourLabelToMinutes,
  parseSolarClockMinutes,
  parseTimeInputMinutes,
} from './app/core';
import { currentDateTimeInputs, dateTimeInputsFor } from './app/date-time-inputs';
import {
  windDirectionToDegrees,
} from './utils/avalanche';
import {
  computeFeelsLikeF,
  getDangerLevelClass,
  normalizeDangerLevel,
  parseOptionalElevationInput,
} from './app/planner-helpers';
import { loadUserPreferences } from './app/preferences';
import {
  collapseWhitespace,
  stringifyRawPayload,
  summarizeText,
  toPlainText,
  truncateText,
} from './app/text-utils';
import { buildSnowpackInterpretation, buildSnowpackInsights } from './app/snowpack-display';
import {
  normalizeWindHintDirection,
  windDirectionFromDegrees,
} from './app/wind-analysis';
import { assessCriticalWindowPoint, criticalRiskLevelText } from './app/critical-window';
import {
  visibilityRiskPillClass,
  normalizeVisibilityRiskLevel,
  estimateVisibilityRiskFromPoint,
  type VisibilityRiskEstimate,
} from './app/visibility';
import {
  weatherConditionEmoji,
  inferWeatherSourceLabel,
  formatDurationMinutes,
} from './app/weather-display';
import {
  buildTravelWindowRows,
  formatTravelWindowSpan,
  buildTravelWindowInsights,
  buildTrendWindowFromStart,
} from './app/travel-window';
import { sanitizeExternalUrl, parseLinkState } from './app/url-state';
import {
  evaluateBackcountryDecision,
} from './app/decision';
import { PlannerView } from './components/planner/PlannerView';
import { buildReportCardOrder } from './app/card-ordering';
import { buildWindLoadingDisplay } from './app/wind-loading-display';
import { buildRainfallDisplay } from './app/rainfall-display';
import { buildSourceFreshnessDisplay } from './app/source-freshness-display';
import { LogsView } from './components/views/LogsView';
import { StatusView } from './components/views/StatusView';
import { SettingsView } from './components/views/SettingsView';
import { TripView } from './components/views/TripView';
import { HomeView } from './components/views/HomeView';
import { useHealthChecks } from './hooks/useHealthChecks';
import { useRouteAnalysis } from './hooks/useRouteAnalysis';
import { useTripForecast } from './hooks/useTripForecast';
import { useSafetyData } from './hooks/useSafetyData';
import { useSearchSuggestions } from './hooks/useSearchSuggestions';
import { useUrlState, useSyncUrlEffect } from './hooks/useUrlState';
import type { AppView } from './hooks/useUrlState';
import { useDayComparisons } from './hooks/useDayComparisons';
import { usePreferenceHandlers, TRAVEL_THRESHOLD_PRESETS } from './hooks/usePreferenceHandlers';
import type { TravelThresholdPresetKey } from './hooks/usePreferenceHandlers';

import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({ iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
L.Marker.prototype.options.icon = DefaultIcon;
const TARGET_ELEVATION_STEP_FEET = 1000;
type WeatherTrendMetricKey =
  | 'temp'
  | 'feelsLike'
  | 'wind'
  | 'gust'
  | 'pressure'
  | 'precipChance'
  | 'humidity'
  | 'dewPoint'
  | 'cloudCover'
  | 'windDirection';

const WEATHER_TREND_METRIC_LABELS: Record<WeatherTrendMetricKey, string> = {
  temp: 'Temp',
  feelsLike: 'Feels-like',
  wind: 'Wind',
  gust: 'Gust',
  pressure: 'Pressure',
  precipChance: 'Precip',
  humidity: 'Humidity',
  dewPoint: 'Dew Point',
  cloudCover: 'Cloud Cover',
  windDirection: 'Wind Direction',
};

function airQualityPillClass(aqi: number | null | undefined): 'go' | 'caution' | 'nogo' {
  const value = Number(aqi);
  if (!Number.isFinite(value)) return 'caution';
  if (value <= 50) return 'go';
  if (value <= 100) return 'caution';
  return 'nogo';
}

function formatIsoDateLabel(isoDate: string): string {
  if (!DATE_FMT.test(isoDate)) {
    return isoDate;
  }
  const parsedMs = parseIsoToMs(`${isoDate}T00:00:00Z`);
  if (parsedMs === null) {
    return isoDate;
  }
  return new Date(parsedMs).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function App() {
  const isProductionBuild = import.meta.env.PROD;
  const todayDate = formatDateInput(new Date());
  const maxForecastDate = formatDateInput(new Date(Date.now() + 1000 * 60 * 60 * 24 * 7));
  const initialPreferences = React.useMemo(() => loadUserPreferences(), []);
  const initialLinkState = React.useMemo(() => parseLinkState(todayDate, maxForecastDate, initialPreferences), [todayDate, maxForecastDate, initialPreferences]);

  const [preferences, setPreferences] = useState<UserPreferences>(() => {
    if (initialLinkState.travelWindowHours) {
      return { ...initialPreferences, travelWindowHours: initialLinkState.travelWindowHours };
    }
    return initialPreferences;
  });
  const activity: ActivityType = 'backcountry';
  const [position, setPosition] = useState<L.LatLng>(initialLinkState.position);
  const [hasObjective, setHasObjective] = useState(initialLinkState.hasObjective);
  const [objectiveName, setObjectiveName] = useState(initialLinkState.objectiveName);
  const objectiveNameRef = useRef(initialLinkState.objectiveName);
  useEffect(() => { objectiveNameRef.current = objectiveName; }, [objectiveName]);

  // --- Extracted hooks ---
  const {
    healthChecks, healthLoading, healthCheckedAt, healthError, backendMeta, runHealthChecks,
  } = useHealthChecks();

  const {
    routeSuggestions, setRouteSuggestions, routeAnalysis, routeLoading, routeError, setRouteError,
    customRouteName, setCustomRouteName,
    fetchRouteSuggestions, fetchRouteAnalysis, resetRouteState,
  } = useRouteAnalysis();

  const safetyHook = useSafetyData({
    todayDate,
    preferences,
    isProductionBuild,
    objectiveNameRef,
  });
  const {
    safetyData, setSafetyData, loading, error, setError,
    aiBriefNarrative, setAiBriefNarrative, aiBriefLoading, setAiBriefLoading, aiBriefError, setAiBriefError,
    fetchSafetyData, clearLastLoadedKey, clearWakeRetry,
    handleRequestAiBrief,
  } = safetyHook;

  const [forecastDate, setForecastDate] = useState(initialLinkState.forecastDate);
  const [alpineStartTime, setAlpineStartTime] = useState(initialLinkState.alpineStartTime);
  const [targetElevationInput, setTargetElevationInput] = useState(initialLinkState.targetElevationInput);
  const [targetElevationManual, setTargetElevationManual] = useState(Boolean(initialLinkState.targetElevationInput));
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedRawPayload, setCopiedRawPayload] = useState(false);
  const [travelWindowExpanded, setTravelWindowExpanded] = useState(false);
  const [weatherTrendMetric, setWeatherTrendMetric] = useState<WeatherTrendMetricKey>('temp');
  const [weatherHourPreviewTime, setWeatherHourPreviewTime] = useState<string | null>(null);
  const [mapStyle, setMapStyle] = useState<MapStyle>('topo');
  const [mobileMapControlsExpanded, setMobileMapControlsExpanded] = useState(() => {
    try {
      const stored = window.localStorage.getItem('summitsafe:mobile-controls-expanded');
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  });
  const [mapFocusNonce, setMapFocusNonce] = useState(0);
  const [locatingUser, setLocatingUser] = useState(false);
  const hasInitializedHistoryRef = useRef(false);
  const isApplyingPopStateRef = useRef(false);
  const copyResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rawCopyResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeBasemap = MAP_STYLE_OPTIONS[mapStyle];

  const tripHook = useTripForecast({
    hasObjective,
    position,
    todayDate,
    maxForecastDate,
    preferences,
  });
  const {
    tripStartDate, setTripStartDate, tripStartTime, setTripStartTime,
    tripDurationDays, setTripDurationDays,
    tripForecastRows, setTripForecastRows: setTripForecastRowsDirect,
    tripForecastLoading, tripForecastError, setTripForecastError: setTripForecastErrorDirect,
    tripForecastNote, setTripForecastNote: setTripForecastNoteDirect,
    runTripForecast,
  } = tripHook;

  const updateObjectivePosition = useCallback((nextPosition: L.LatLng, label?: string) => {
    clearWakeRetry();
    setPosition(nextPosition);
    setMapFocusNonce((prev) => prev + 1);
    setHasObjective(true);
    setTravelWindowExpanded(false);
    setSafetyData(null);
    setDayOverDay(null);
    setError(null);
    setAiBriefNarrative(null);
    setAiBriefLoading(false);
    setAiBriefError(null);
    setTargetElevationInput('');
    setTargetElevationManual(false);
    setTripForecastRowsDirect([]);
    setTripForecastErrorDirect(null);
    setTripForecastNoteDirect(null);
    resetRouteState();
    if (label) {
      setObjectiveName(label);
    } else {
      setObjectiveName((prev) => prev || 'Dropped pin');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setDayOverDay is a stable setter from useDayComparisons, declared later in hook order
  }, [clearWakeRetry, setSafetyData, setError, setAiBriefNarrative, setAiBriefLoading, setAiBriefError, resetRouteState, setTripForecastRowsDirect, setTripForecastErrorDirect, setTripForecastNoteDirect]);

  const searchHook = useSearchSuggestions({
    initialSearchQuery: initialLinkState.searchQuery,
    updateObjectivePosition,
  });
  const {
    searchQuery, setSearchQuery: setSearchInputValue, committedSearchQuery, setCommittedSearchQuery,
    suggestions, showSuggestions, setShowSuggestions,
    searchLoading, activeSuggestionIndex, setActiveSuggestionIndex,
    searchInputRef, searchWrapperRef,
    selectSuggestion,
    handleInputChange, handleSearchKeyDown, handleSearchSubmit, handleFocus, handleSearchClear,
    handleUseTypedCoordinates,
    handleToggleSaveObjective: handleToggleSaveObjectiveRaw,
    recordRecentSuggestion,
    parsedTypedCoordinates,
  } = searchHook;

  const handleToggleSaveObjective = useCallback(() => {
    handleToggleSaveObjectiveRaw({ hasObjective, objectiveName, position });
  }, [handleToggleSaveObjectiveRaw, hasObjective, objectiveName, position]);

  // URL state: view, isViewPending, navigateToView
  const urlState = useUrlState({
    todayDate,
    maxForecastDate,
    preferences,
    initialView: initialLinkState.view as AppView,
    isApplyingPopStateRef,
    onPopState: useCallback((linkState: ReturnType<typeof parseLinkState>) => {
      clearWakeRetry();
      setSafetyData(null);
      setAiBriefNarrative(null);
      setAiBriefLoading(false);
      setAiBriefError(null);
      clearLastLoadedKey();
      setPosition(linkState.position);
      setHasObjective(linkState.hasObjective);
      setObjectiveName(linkState.objectiveName);
      setSearchInputValue(linkState.searchQuery);
      setCommittedSearchQuery(linkState.searchQuery);
      setForecastDate(linkState.forecastDate);
      setAlpineStartTime(linkState.alpineStartTime);
      setTargetElevationInput(linkState.targetElevationInput);
      setTargetElevationManual(Boolean(linkState.targetElevationInput));
      if (linkState.travelWindowHours) {
        setPreferences(prev => ({ ...prev, travelWindowHours: linkState.travelWindowHours! }));
      }
      setError(null);
    }, [clearWakeRetry, setSafetyData, setAiBriefNarrative, setAiBriefLoading, setAiBriefError, clearLastLoadedKey, setSearchInputValue, setCommittedSearchQuery, setError]),
  });
  const { view, setView, isViewPending, startViewChange, navigateToView } = urlState;

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

    if (view === 'trip') {
      document.title = 'Multi-Day Trip Tool - Backcountry Conditions';
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

  useSyncUrlEffect({
    view,
    hasObjective,
    position,
    objectiveName,
    committedSearchQuery,
    forecastDate,
    alpineStartTime,
    targetElevationInput,
    travelWindowHours: Math.max(
      MIN_TRAVEL_WINDOW_HOURS,
      Math.min(MAX_TRAVEL_WINDOW_HOURS, Math.round(Number(preferences.travelWindowHours) || 12)),
    ),
    isApplyingPopStateRef,
    hasInitializedHistoryRef,
  });

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
      if (copyResetTimeout.current) {
        clearTimeout(copyResetTimeout.current);
      }
      if (rawCopyResetTimeout.current) {
        clearTimeout(rawCopyResetTimeout.current);
      }
    };
  }, []);

  useEffect(() => {
    setTravelWindowExpanded(false);
  }, [safetyData?.forecast?.selectedDate, safetyData?.forecast?.selectedStartTime]);

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
        recordRecentSuggestion({
          name: coordinateLabel,
          lat,
          lon,
          class: 'recent',
          type: 'coordinate',
        });
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

  const handleWeatherHourSelect = (nextStartTime: string) => {
    if (nextStartTime === weatherHourPreviewTime) {
      return;
    }
    setWeatherHourPreviewTime(nextStartTime);
  };

  const handleTargetElevationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = e.target.value.replace(/[^\d]/g, '').slice(0, 5);
    setTargetElevationInput(digitsOnly);
    setTargetElevationManual(true);
  };
  const handleTargetElevationStep = (deltaFeet: number) => {
    const parsedDisplayValue = parseOptionalElevationInput(targetElevationInput);
    const objectiveElevationFeet = Number(safetyData?.weather.elevation);
    const baseFeet = parsedDisplayValue !== null
      ? convertDisplayElevationToFeet(parsedDisplayValue, preferences.elevationUnit)
      : Number.isFinite(objectiveElevationFeet)
        ? objectiveElevationFeet
        : 0;
    const nextFeet = Math.max(0, Math.min(20000, Math.round(baseFeet + deltaFeet)));
    const nextDisplayValue = Math.max(0, Math.round(convertElevationFeetToDisplayValue(nextFeet, preferences.elevationUnit)));
    setTargetElevationInput(String(nextDisplayValue));
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

  const handleRequestAiBriefAction = async () => {
    if (!safetyData || !decision || aiBriefLoading) return;
    void handleRequestAiBrief({
      safetyData,
      decisionLevel: decision.level,
      fieldBriefPrimaryReason,
      fieldBriefTopRisks,
    });
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

  const handleRetryFetch = () => {
    if (!hasObjective) {
      return;
    }
    fetchSafetyData(position.lat, position.lng, forecastDate, alpineStartTime, { force: true });
  };

  const openPlannerView = () => {
    if (!hasObjective && !searchQuery.trim()) {
      setAlpineStartTime(preferences.defaultStartTime);
    }
    startViewChange(() => setView('planner'));
  };

  const openTripToolView = () => {
    setTripStartDate(forecastDate);
    setTripStartTime(alpineStartTime);
    setTripForecastRowsDirect([]);
    setTripForecastErrorDirect(null);
    setTripForecastNoteDirect(null);
    startViewChange(() => setView('trip'));
  };
  const jumpToPlannerSection = useCallback((sectionId: string) => {
    if (typeof document === 'undefined') {
      return;
    }
    const section = document.getElementById(sectionId);
    if (!section) {
      return;
    }
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const appShellClassName = `app-container page-shell page-shell-${view}${isViewPending ? ' is-nav-pending' : ''}`;
  const liveSearchQuery = searchQuery;
  const trimmedSearchQuery = liveSearchQuery.trim();
  const objectiveIsSaved = hasObjective && searchHook.objectiveIsSaved(position.lat, position.lng);

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

    const parsedMs = parseIsoToMs(isoString);
    if (parsedMs === null) {
      return isoString;
    }
    const date = new Date(parsedMs);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric', hour12: useHour12Clock });
  };

  const formatForecastPeriodLabel = (isoString?: string | null, timeZone?: string | null) => {
    if (!isoString) {
      return 'Not available';
    }
    const parsedMs = parseIsoToMs(isoString);
    if (parsedMs === null) {
      return isoString;
    }
    const date = new Date(parsedMs);
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

  const prefHandlers = usePreferenceHandlers({
    preferences,
    setPreferences,
    travelWindowHours,
    targetElevationInput,
    setTargetElevationInput,
    onApplyToPlanner: useCallback(() => {
      setAlpineStartTime(preferences.defaultStartTime);
      startViewChange(() => setView('planner'));
    }, [preferences.defaultStartTime, startViewChange, setView]),
  });
  const {
    travelWindowHoursDraft,
    maxPrecipChanceDraft,
    maxWindGustDraft,
    minFeelsLikeDraft,
    windThresholdStep,
    windThresholdMin,
    windThresholdMax,
    feelsLikeThresholdStep,
    feelsLikeThresholdMin,
    feelsLikeThresholdMax,
    handlePreferenceTimeChange,
    handleThemeModeChange,
    handleTemperatureUnitChange,
    handleWindSpeedUnitChange,
    handleElevationUnitChange,
    handleTimeStyleChange,
    handleTravelWindowHoursDraftChange,
    handleTravelWindowHoursDraftBlur,
    handleMaxPrecipChanceDraftChange,
    handleMaxPrecipChanceDraftBlur,
    handleWindThresholdDisplayChange,
    handleWindThresholdDisplayBlur,
    handleFeelsLikeThresholdDisplayChange,
    handleFeelsLikeThresholdDisplayBlur,
    handleApplyTravelThresholdPreset,
    applyPreferencesToPlanner,
    resetPreferences,
    travelThresholdEditorOpen,
    setTravelThresholdEditorOpen,
  } = prefHandlers;

  const returnMinutes = cutoffMinutes !== null ? cutoffMinutes + travelWindowHours * 60 : null;
  const returnExtendsPastMidnight = returnMinutes !== null && returnMinutes > 1439;
  const returnTimeFormatted = returnMinutes !== null ? minutesToTwentyFourHourClock(Math.min(returnMinutes, 1439)) : null;
  let decision = safetyData
    ? evaluateBackcountryDecision(safetyData, alpineStartTime, preferences, { turnaroundTime: returnTimeFormatted ?? undefined })
    : null;

  const dayComparisonsHook = useDayComparisons({
    hasObjective,
    view,
    safetyData,
    decisionLevel: decision?.level,
    forecastDate,
    alpineStartTime,
    position: { lat: position.lat, lng: position.lng },
    preferences,
    maxForecastDate,
  });
  const { dayOverDay, setDayOverDay, betterDaySuggestions, betterDaySuggestionsLoading, betterDaySuggestionsNote } = dayComparisonsHook;

  const failedCriticalChecks = decision ? decision.checks.filter((check) => !check.ok) : [];
  const passedCriticalChecks = decision ? decision.checks.filter((check) => check.ok) : [];
  const orderedCriticalChecks = [...failedCriticalChecks, ...passedCriticalChecks];
  const topCriticalAttentionChecks = failedCriticalChecks.slice(0, 3);
  const criticalCheckFailCount = failedCriticalChecks.length;
  const criticalCheckTotal = orderedCriticalChecks.length;
  const describeFailedCriticalCheck = (check: SummitDecision['checks'][number]): string => {
    switch (check.key) {
      case 'avalanche':
        return /coverage unavailable/i.test(String(check.detail || ''))
          ? 'Avalanche bulletin is unavailable for selected objective/time'
          : 'Avalanche danger exceeds Moderate';
      case 'convective-signal':
        return 'Convective storm signal appears in forecast';
      case 'precipitation':
        return 'Precipitation chance exceeds threshold';
      case 'wind-gust':
        return 'Wind gust exceeds threshold';
      case 'daylight':
        return 'Start time misses the 30-minute daylight buffer';
      case 'feels-like':
        return 'Apparent temperature is below threshold';
      case 'nws-alerts':
        return 'Active NWS alert overlaps selected travel window';
      case 'air-quality':
        return 'Air quality exceeds 100 AQI';
      case 'fire-risk':
        return 'Fire risk is High or above';
      case 'heat-risk':
        return 'Heat risk is High or above';
      case 'terrain-signal':
        return 'Terrain/trail condition signal is unavailable';
      case 'source-freshness':
        return 'Core source freshness has stale or missing feeds';
      default:
        return check.label;
    }
  };
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
        { key: 'above', label: 'Above treeline', rating: safetyData.avalanche.elevations?.above?.level ?? null },
        { key: 'at', label: 'Near treeline', rating: safetyData.avalanche.elevations?.at?.level ?? null },
        { key: 'below', label: 'Below treeline', rating: safetyData.avalanche.elevations?.below?.level ?? null },
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
  const objectiveElevationFt = Number(safetyData?.weather.elevation);
  const baseTargetElevationFeet =
    hasTargetElevation
      ? targetElevationFt
      : Number.isFinite(objectiveElevationFt) && objectiveElevationFt >= 0
        ? objectiveElevationFt
        : 0;
  const canDecreaseTargetElevation = baseTargetElevationFeet > 0;
  const windThresholdDisplay = formatWindDisplay(preferences.maxWindGustMph);
  const feelsLikeThresholdDisplay = formatTempDisplay(preferences.minFeelsLikeF);
  const activeTravelThresholdPreset = (Object.entries(TRAVEL_THRESHOLD_PRESETS).find(([, preset]) => {
    return (
      Math.abs(preferences.maxWindGustMph - preset.maxWindGustMph) <= 0.01 &&
      preferences.maxPrecipChance === preset.maxPrecipChance &&
      Math.abs(preferences.minFeelsLikeF - preset.minFeelsLikeF) <= 0.01
    );
  })?.[0] || null) as TravelThresholdPresetKey | null;
  const travelWindowHoursLabel = `${travelWindowHours}h`;
  const windUnitLabel = preferences.windSpeedUnit;
  const tempUnitLabel = preferences.temperatureUnit.toUpperCase();
  const elevationUnitLabel = preferences.elevationUnit;
  const weatherTrendMetricOptions: Array<{ key: WeatherTrendMetricKey; label: string }> = [
    { key: 'temp', label: `Temp (${tempUnitLabel})` },
    { key: 'feelsLike', label: `Feels (${tempUnitLabel})` },
    { key: 'wind', label: `Wind (${windUnitLabel})` },
    { key: 'gust', label: `Gust (${windUnitLabel})` },
    { key: 'pressure', label: 'Pressure (hPa)' },
    { key: 'precipChance', label: 'Precip (%)' },
    { key: 'humidity', label: 'Humidity (%)' },
    { key: 'dewPoint', label: `Dew (${tempUnitLabel})` },
    { key: 'cloudCover', label: 'Cloud (%)' },
    { key: 'windDirection', label: 'Wind Dir (deg)' },
  ];
  type WeatherTrendChartRow = {
    label: string;
    hourValue: string | null;
    temp: number | null;
    feelsLike: number | null;
    wind: number | null;
    gust: number | null;
    pressure: number | null;
    precipChance: number | null;
    humidity: number | null;
    dewPoint: number | null;
    cloudCover: number | null;
    windDirection: number | null;
    windDirectionLabel: string | null;
  };
  const weatherTrendRows: WeatherTrendChartRow[] = trendWindow.map((point) => {
    const parsedPointMinutes =
      parseTimeInputMinutes(String(point?.time || '').trim()) ??
      parseHourLabelToMinutes(String(point?.time || '').trim()) ??
      parseSolarClockMinutes(point?.time || undefined);
    const temp = parseOptionalFiniteNumber(point?.temp);
    const wind = parseOptionalFiniteNumber(point?.wind);
    const gust = parseOptionalFiniteNumber(point?.gust);
    const pressure = parseOptionalFiniteNumber(point?.pressure);
    const humidity = parseOptionalFiniteNumber(point?.humidity);
    const dewPoint = parseOptionalFiniteNumber(point?.dewPoint);
    const cloudCover = parseOptionalFiniteNumber(point?.cloudCover);
    const windDirectionLabel = normalizeWindHintDirection(point?.windDirection || null);
    const windDirectionDegrees =
      windDirectionLabel && windDirectionLabel !== 'CALM' && windDirectionLabel !== 'VRB'
        ? windDirectionToDegrees(windDirectionLabel)
        : null;
    return {
      label: formatClockForStyle(point?.time || '', preferences.timeStyle),
      hourValue: parsedPointMinutes === null ? null : minutesToTwentyFourHourClock(parsedPointMinutes),
      temp,
      feelsLike: temp !== null && wind !== null ? computeFeelsLikeF(temp, wind) : null,
      wind,
      gust: gust ?? wind,
      pressure,
      precipChance: parseOptionalFiniteNumber(point?.precipChance),
      humidity,
      dewPoint,
      cloudCover,
      windDirection: windDirectionDegrees,
      windDirectionLabel: windDirectionLabel || null,
    };
  });
  const weatherTrendValueForMetric = (row: WeatherTrendChartRow, metric: WeatherTrendMetricKey): number | null => {
    switch (metric) {
      case 'temp':
        return row.temp;
      case 'feelsLike':
        return row.feelsLike;
      case 'wind':
        return row.wind;
      case 'gust':
        return row.gust;
      case 'pressure':
        return row.pressure;
      case 'precipChance':
        return row.precipChance;
      case 'humidity':
        return row.humidity;
      case 'dewPoint':
        return row.dewPoint;
      case 'cloudCover':
        return row.cloudCover;
      case 'windDirection':
        return row.windDirection;
      default:
        return null;
    }
  };
  const weatherTrendChartData = weatherTrendRows.map((row) => ({
    label: row.label,
    hourValue: row.hourValue,
    value: weatherTrendValueForMetric(row, weatherTrendMetric),
    windDirectionLabel: row.windDirectionLabel,
  }));
  const weatherTrendHasData = weatherTrendChartData.some(
    (row) => row.value !== null && Number.isFinite(row.value),
  );
  const weatherTrendMetricLabel = WEATHER_TREND_METRIC_LABELS[weatherTrendMetric];
  const weatherTrendTickFormatter = (value: number) => {
    if (!Number.isFinite(value)) {
      return '';
    }
    if (weatherTrendMetric === 'temp' || weatherTrendMetric === 'feelsLike' || weatherTrendMetric === 'dewPoint') {
      return formatTempDisplay(value, { includeUnit: false });
    }
    if (weatherTrendMetric === 'wind' || weatherTrendMetric === 'gust') {
      return formatWindDisplay(value, { includeUnit: false });
    }
    if (weatherTrendMetric === 'pressure') {
      return `${Number(value).toFixed(0)}`;
    }
    if (weatherTrendMetric === 'precipChance' || weatherTrendMetric === 'humidity' || weatherTrendMetric === 'cloudCover') {
      return `${Math.round(value)}%`;
    }
    if (weatherTrendMetric === 'windDirection') {
      return `${Math.round(value)}°`;
    }
    return String(Math.round(value));
  };
  const formatWeatherTrendValue = (value: number | null | undefined, directionLabel?: string | null): string => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return 'N/A';
    }
    if (weatherTrendMetric === 'temp' || weatherTrendMetric === 'feelsLike' || weatherTrendMetric === 'dewPoint') {
      return formatTempDisplay(numeric);
    }
    if (weatherTrendMetric === 'wind' || weatherTrendMetric === 'gust') {
      return formatWindDisplay(numeric);
    }
    if (weatherTrendMetric === 'pressure') {
      return `${numeric.toFixed(1)} hPa`;
    }
    if (weatherTrendMetric === 'precipChance' || weatherTrendMetric === 'humidity' || weatherTrendMetric === 'cloudCover') {
      return `${Math.round(numeric)}%`;
    }
    if (weatherTrendMetric === 'windDirection') {
      const cardinal = directionLabel || windDirectionFromDegrees(numeric);
      return `${cardinal} (${Math.round(numeric)}°)`;
    }
    return String(Math.round(numeric));
  };
  const weatherTrendYAxisDomain: [number, number] | ['auto', 'auto'] =
    weatherTrendMetric === 'windDirection'
      ? [0, 360]
      : weatherTrendMetric === 'precipChance' || weatherTrendMetric === 'humidity' || weatherTrendMetric === 'cloudCover'
        ? [0, 100]
        : ['auto', 'auto'];
  const weatherTrendLineColor =
    weatherTrendMetric === 'temp'
      ? '#d56d45'
      : weatherTrendMetric === 'feelsLike'
        ? '#c8576f'
        : weatherTrendMetric === 'wind'
          ? '#3f82b8'
          : weatherTrendMetric === 'gust'
            ? '#d2993a'
            : weatherTrendMetric === 'pressure'
              ? '#5f7f92'
            : weatherTrendMetric === 'precipChance'
              ? '#1f7d65'
              : weatherTrendMetric === 'humidity'
                ? '#3b9bb8'
                : weatherTrendMetric === 'dewPoint'
                  ? '#5b7ca0'
                  : weatherTrendMetric === 'cloudCover'
                    ? '#7f8e99'
                    : '#6d7a88';
  const weatherPressureTrend = (() => {
    const pressureValues = weatherTrendRows
      .map((row) => row.pressure)
      .filter((value): value is number => Number.isFinite(Number(value)));
    if (pressureValues.length < 2) {
      return null;
    }
    const start = pressureValues[0];
    const end = pressureValues[pressureValues.length - 1];
    const delta = end - start;
    const direction = delta >= 1 ? 'Rising' : delta <= -1 ? 'Falling' : 'Steady';
    const deltaLabel = `${delta > 0 ? '+' : ''}${delta.toFixed(1)} hPa`;
    const rangeLabel = `${start.toFixed(1)} → ${end.toFixed(1)} hPa`;
    const summary = `${direction} pressure over ${travelWindowHoursLabel}: ${deltaLabel} (${rangeLabel})`;
    return { summary, direction, deltaLabel, rangeLabel };
  })();
  const weatherPressureTrendSummary = weatherPressureTrend?.summary ?? null;
  const pressureTrendDirection = weatherPressureTrend?.direction ?? null;
  const pressureDeltaLabel = weatherPressureTrend?.deltaLabel ?? null;
  const pressureRangeLabel = weatherPressureTrend?.rangeLabel ?? null;
  const weatherTrendTempRange = (() => {
    const temps = weatherTrendRows.map(r => r.temp).filter((t): t is number => Number.isFinite(Number(t)));
    if (temps.length < 2) return null;
    return { low: Math.min(...temps), high: Math.max(...temps) };
  })();
  useEffect(() => {
    setWeatherHourPreviewTime(null);
  }, [alpineStartTime, forecastDate, objectiveName]);
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
  const rainfallPayload = React.useMemo(() => {
    if (!safetyData) {
      return null;
    }
    if (safetyData.rainfall && typeof safetyData.rainfall === 'object') {
      return safetyData.rainfall;
    }
    const legacy = (safetyData as SafetyData & { rainfallData?: SafetyData['rainfall'] }).rainfallData;
    return legacy && typeof legacy === 'object' ? legacy : null;
  }, [safetyData]);
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
              backByTime: returnTimeFormatted,
              targetElevationFt: hasTargetElevation ? Math.round(targetElevationFt) : null,
            },
            forecast: safetyData.forecast || null,
            weather: safetyData.weather,
            solar: safetyData.solar,
            avalanche: safetyData.avalanche,
            alerts: safetyData.alerts || null,
            airQuality: safetyData.airQuality || null,
            rainfall: rainfallPayload || null,
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
      returnTimeFormatted,
      hasTargetElevation,
      targetElevationFt,
      decision,
      rainfallPayload,
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
  const safeRainfallLink = sanitizeExternalUrl(rainfallPayload?.link || undefined);
  const safeSnotelLink = sanitizeExternalUrl(safetyData?.snowpack?.snotel?.link || undefined);
  const safeNohrscLink = sanitizeExternalUrl(safetyData?.snowpack?.nohrsc?.link || undefined);
  const safeCdecLink = sanitizeExternalUrl(safetyData?.snowpack?.cdec?.link || undefined);
  const rainfallDisplay = buildRainfallDisplay(rainfallPayload, preferences, travelWindowHours);
  const {
    rainfall12hIn, rainfall24hIn, rainfall48hIn,
    snowfall12hIn, snowfall24hIn, snowfall48hIn,
    rainfall24hSeverityClass, rainfallWindowSummary, snowfallWindowSummary,
    rainfall12hDisplay, rainfall24hDisplay, rainfall48hDisplay,
    snowfall12hDisplay, snowfall24hDisplay, snowfall48hDisplay,
    expectedTravelWindowHours, expectedRainWindowDisplay, expectedSnowWindowDisplay,
    expectedPrecipSummaryLine,
    rainfallModeLabel, rainfallNoteLine, expectedPrecipNoteLine, precipInsightLine,
    rainfallExpected, expectedSnowWindowIn,
  } = rainfallDisplay;
  const snotelSweDisplay = formatSweForElevationUnit(Number(safetyData?.snowpack?.snotel?.sweIn), preferences.elevationUnit);
  const snotelDepthDisplay = formatSnowDepthForElevationUnit(Number(safetyData?.snowpack?.snotel?.snowDepthIn), preferences.elevationUnit);
  const nohrscSweDisplay = formatSweForElevationUnit(Number(safetyData?.snowpack?.nohrsc?.sweIn), preferences.elevationUnit);
  const nohrscDepthDisplay = formatSnowDepthForElevationUnit(Number(safetyData?.snowpack?.nohrsc?.snowDepthIn), preferences.elevationUnit);
  const cdecSweDisplay = formatSweForElevationUnit(Number(safetyData?.snowpack?.cdec?.sweIn), preferences.elevationUnit);
  const cdecDepthDisplay = formatSnowDepthForElevationUnit(Number(safetyData?.snowpack?.cdec?.snowDepthIn), preferences.elevationUnit);
  const cdecDistanceDisplay = formatDistanceForElevationUnit(Number(safetyData?.snowpack?.cdec?.distanceKm), preferences.elevationUnit);
  const snotelDistanceDisplay = formatDistanceForElevationUnit(Number(safetyData?.snowpack?.snotel?.distanceKm), preferences.elevationUnit);
  const snotelDepthIn = Number(safetyData?.snowpack?.snotel?.snowDepthIn);
  const nohrscDepthIn = Number(safetyData?.snowpack?.nohrsc?.snowDepthIn);
  const cdecDepthIn = Number(safetyData?.snowpack?.cdec?.snowDepthIn);
  const snotelSweIn = Number(safetyData?.snowpack?.snotel?.sweIn);
  const nohrscSweIn = Number(safetyData?.snowpack?.nohrsc?.sweIn);
  const cdecSweIn = Number(safetyData?.snowpack?.cdec?.sweIn);
  const snowpackMetricAvailable =
    Number.isFinite(snotelDepthIn) ||
    Number.isFinite(nohrscDepthIn) ||
    Number.isFinite(cdecDepthIn) ||
    Number.isFinite(snotelSweIn) ||
    Number.isFinite(nohrscSweIn) ||
    Number.isFinite(cdecSweIn);
  const maxSnowDepthSignalIn = Math.max(
    Number.isFinite(snotelDepthIn) ? snotelDepthIn : 0,
    Number.isFinite(nohrscDepthIn) ? nohrscDepthIn : 0,
    Number.isFinite(cdecDepthIn) ? cdecDepthIn : 0,
  );
  const maxSnowSweSignalIn = Math.max(
    Number.isFinite(snotelSweIn) ? snotelSweIn : 0,
    Number.isFinite(nohrscSweIn) ? nohrscSweIn : 0,
    Number.isFinite(cdecSweIn) ? cdecSweIn : 0,
  );
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
  const snowpackHistorical = safetyData?.snowpack?.historical || null;
  const snowpackHistoricalStatus = String(snowpackHistorical?.overall?.status || 'unknown').toLowerCase();
  const snowpackHistoricalPillClass =
    snowpackHistoricalStatus === 'above_average'
      ? 'caution'
      : snowpackHistoricalStatus === 'below_average'
        ? 'watch'
        : snowpackHistoricalStatus === 'at_average'
          ? 'go'
          : 'watch';
  const snowpackHistoricalStatusLabel =
    snowpackHistoricalStatus === 'above_average'
      ? 'Above average'
      : snowpackHistoricalStatus === 'below_average'
        ? 'Below average'
        : snowpackHistoricalStatus === 'at_average'
          ? 'At average'
          : 'Comparison unavailable';
  const snowpackHistoricalTargetDateLabel = snowpackHistorical?.targetDate ? formatIsoDateLabel(snowpackHistorical.targetDate) : null;
  const snowpackHistoricalMetricLabel = String(snowpackHistorical?.overall?.metric || '').trim();
  const snowpackHistoricalPercent = parseOptionalFiniteNumber(snowpackHistorical?.overall?.percentOfAverage);
  const snowpackHistoricalSweCurrentDisplay = formatSweForElevationUnit(
    parseOptionalFiniteNumber(snowpackHistorical?.swe?.currentIn),
    preferences.elevationUnit,
  );
  const snowpackHistoricalSweAverageDisplay = formatSweForElevationUnit(
    parseOptionalFiniteNumber(snowpackHistorical?.swe?.averageIn),
    preferences.elevationUnit,
  );
  const snowpackHistoricalDepthCurrentDisplay = formatSnowDepthForElevationUnit(
    parseOptionalFiniteNumber(snowpackHistorical?.depth?.currentIn),
    preferences.elevationUnit,
  );
  const snowpackHistoricalDepthAverageDisplay = formatSnowDepthForElevationUnit(
    parseOptionalFiniteNumber(snowpackHistorical?.depth?.averageIn),
    preferences.elevationUnit,
  );
  const snowpackHistoricalComparisonLine = (() => {
    if (!snowpackHistorical) {
      return 'Historical average unavailable for this selected date.';
    }
    const metricLine =
      snowpackHistoricalMetricLabel.toUpperCase() === 'SWE'
        ? `SWE ${snowpackHistoricalSweCurrentDisplay} vs avg ${snowpackHistoricalSweAverageDisplay}`
        : snowpackHistoricalMetricLabel.toLowerCase() === 'snow depth'
          ? `Depth ${snowpackHistoricalDepthCurrentDisplay} vs avg ${snowpackHistoricalDepthAverageDisplay}`
          : null;
    const percentLine = Number.isFinite(snowpackHistoricalPercent) ? `${snowpackHistoricalPercent}% of average` : null;
    const parts = [metricLine, percentLine, snowpackHistoricalTargetDateLabel ? `for ${snowpackHistoricalTargetDateLabel}` : null].filter(Boolean);
    return parts.length > 0 ? parts.join(' • ') : 'Historical average unavailable for this selected date.';
  })();
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
  const weatherHourQuickOptions: Array<{ value: string; label: string; tempLabel: string | null; point: WeatherTrendPoint }> = [];
  if (safetyData && Array.isArray(safetyData.weather.trend)) {
    const seenStartTimes = new Set<string>();
    for (const point of safetyData.weather.trend) {
      const rawTime = String(point?.time || '').trim();
      const parsedMinutes =
        parseTimeInputMinutes(rawTime) ??
        parseHourLabelToMinutes(rawTime) ??
        parseSolarClockMinutes(rawTime || undefined);
      if (parsedMinutes === null) {
        continue;
      }
      const value = minutesToTwentyFourHourClock(parsedMinutes);
      if (seenStartTimes.has(value)) {
        continue;
      }
      seenStartTimes.add(value);
      weatherHourQuickOptions.push({
        value,
        label: formatClockForStyle(value, preferences.timeStyle),
        tempLabel: Number.isFinite(Number(point?.temp)) ? formatTempDisplay(Number(point?.temp)) : null,
        point,
      });
      if (weatherHourQuickOptions.length >= 12) {
        break;
      }
    }
  }
  const activeWeatherHourValue = weatherHourPreviewTime || alpineStartTime;
  const selectedWeatherHourIndex = (() => {
    if (!weatherHourQuickOptions.length) {
      return -1;
    }
    const exactIndex = weatherHourQuickOptions.findIndex((option) => option.value === activeWeatherHourValue);
    if (exactIndex >= 0) {
      return exactIndex;
    }
    const selectedMinutes = parseTimeInputMinutes(activeWeatherHourValue);
    if (selectedMinutes === null) {
      return 0;
    }
    let bestIndex = 0;
    let bestDiff = Number.POSITIVE_INFINITY;
    weatherHourQuickOptions.forEach((option, index) => {
      const optionMinutes = parseTimeInputMinutes(option.value);
      if (optionMinutes === null) {
        return;
      }
      let diff = Math.abs(optionMinutes - selectedMinutes);
      if (diff > 720) {
        diff = 1440 - diff;
      }
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = index;
      }
    });
    return bestIndex;
  })();
  const selectedWeatherHour = selectedWeatherHourIndex >= 0 ? weatherHourQuickOptions[selectedWeatherHourIndex] : null;
  const weatherPreviewActive = Boolean(selectedWeatherHour && selectedWeatherHour.value !== alpineStartTime);
  const weatherPreviewPoint = selectedWeatherHour?.point || null;
  const weatherForecastPeriodLabel = safetyData
    ? formatForecastPeriodLabel(
        (typeof weatherPreviewPoint?.timeIso === 'string' && weatherPreviewPoint.timeIso.trim()
          ? weatherPreviewPoint.timeIso
          : safetyData.weather.forecastStartTime) || null,
        safetyData.weather.timezone || null,
      )
    : 'Not available';
  const weatherCardTemp = Number.isFinite(Number(weatherPreviewPoint?.temp)) ? Number(weatherPreviewPoint?.temp) : Number(safetyData?.weather.temp);
  const weatherCardWind = Number.isFinite(Number(weatherPreviewPoint?.wind)) ? Number(weatherPreviewPoint?.wind) : Number(safetyData?.weather.windSpeed);
  const weatherCardGust = Number.isFinite(Number(weatherPreviewPoint?.gust))
    ? Number(weatherPreviewPoint?.gust)
    : Number(safetyData?.weather.windGust);
  const weatherCardFeelsLike = Number.isFinite(weatherCardTemp)
    ? computeFeelsLikeF(weatherCardTemp, Number.isFinite(weatherCardWind) ? weatherCardWind : 0)
    : Number(safetyData?.weather.feelsLike ?? safetyData?.weather.temp);
  const weatherCardDescription = String(weatherPreviewPoint?.condition || safetyData?.weather.description || 'Unknown');
  const weatherCardIsDaytime = typeof weatherPreviewPoint?.isDaytime === 'boolean' ? weatherPreviewPoint.isDaytime : safetyData?.weather.isDaytime;
  const weatherCardEmoji = weatherConditionEmoji(weatherCardDescription, weatherCardIsDaytime ?? null);
  const weatherCardWithEmoji = `${weatherCardEmoji} ${weatherCardDescription}`;
  const weatherCardPrecip = Number.isFinite(Number(weatherPreviewPoint?.precipChance))
    ? Math.round(Number(weatherPreviewPoint?.precipChance))
    : Number(safetyData?.weather.precipChance);
  const weatherCardHumidity = Number.isFinite(Number(weatherPreviewPoint?.humidity))
    ? Number(weatherPreviewPoint?.humidity)
    : Number(safetyData?.weather.humidity);
  const weatherCardDewPoint = Number.isFinite(Number(weatherPreviewPoint?.dewPoint))
    ? Number(weatherPreviewPoint?.dewPoint)
    : Number(safetyData?.weather.dewPoint);
  const weatherCardPressure = Number.isFinite(Number(weatherPreviewPoint?.pressure))
    ? Number(weatherPreviewPoint?.pressure)
    : parseOptionalFiniteNumber(safetyData?.weather.pressure);
  const weatherCardPressureLabel = Number.isFinite(Number(weatherCardPressure))
    ? `${Number(weatherCardPressure).toFixed(1)} hPa`
    : 'N/A';
  const pressureObjectiveElevationFt = Number(safetyData?.weather.elevation);
  const estimatedSeaLevelPressureHpa =
    Number.isFinite(Number(weatherCardPressure)) && Number.isFinite(pressureObjectiveElevationFt) && pressureObjectiveElevationFt >= 0
      ? Number(weatherCardPressure) * Math.exp((pressureObjectiveElevationFt * 0.3048) / 8434.5)
      : Number.NaN;
  const estimatedSeaLevelPressureLabel = Number.isFinite(estimatedSeaLevelPressureHpa)
    ? `${estimatedSeaLevelPressureHpa.toFixed(1)} hPa`
    : null;
  const weatherPressureContextLine = Number.isFinite(Number(weatherCardPressure))
    ? [
        Number.isFinite(pressureObjectiveElevationFt) ? `Station at ${formatElevationDisplay(pressureObjectiveElevationFt)}` : 'Station pressure',
        estimatedSeaLevelPressureLabel ? `Sea-level est ${estimatedSeaLevelPressureLabel}` : null,
      ]
        .filter(Boolean)
        .join(' • ')
    : 'Pressure unavailable from selected forecast hour.';
  const weatherCardWindDirection = normalizeWindHintDirection(weatherPreviewPoint?.windDirection ?? safetyData?.weather.windDirection ?? null) || 'N/A';
  const weatherCloudCover = parseOptionalFiniteNumber(safetyData?.weather.cloudCover);
  const weatherCardCloudCover = Number.isFinite(Number(weatherPreviewPoint?.cloudCover))
    ? Number(weatherPreviewPoint?.cloudCover)
    : weatherCloudCover;
  const weatherCardCloudCoverLabel = Number.isFinite(weatherCardCloudCover) ? `${Math.round(weatherCardCloudCover)}%` : 'N/A';
  const weatherVisibilityFallback = estimateVisibilityRiskFromPoint({
    description: weatherCardDescription,
    precipChance: weatherCardPrecip,
    wind: weatherCardWind,
    gust: weatherCardGust,
    humidity: weatherCardHumidity,
    cloudCover: weatherCardCloudCover,
    isDaytime: weatherCardIsDaytime ?? null,
  });
  const backendVisibilityRiskScore = parseOptionalFiniteNumber(safetyData?.weather.visibilityRisk?.score ?? null);
  const backendVisibilityRiskLevel = normalizeVisibilityRiskLevel(
    safetyData?.weather.visibilityRisk?.level ?? null,
    backendVisibilityRiskScore,
  );
  const backendVisibilityFactors =
    Array.isArray(safetyData?.weather.visibilityRisk?.factors) && safetyData.weather.visibilityRisk.factors.length > 0
      ? safetyData.weather.visibilityRisk.factors.slice(0, 3)
      : [];
  const backendVisibilitySummary = String(safetyData?.weather.visibilityRisk?.summary || '').trim();
  const backendVisibilityActiveHours = parseOptionalFiniteNumber(safetyData?.weather.visibilityRisk?.activeHours ?? null);
  const backendVisibilityWindowHours = parseOptionalFiniteNumber(safetyData?.weather.visibilityRisk?.windowHours ?? null);
  const weatherVisibilityRisk: VisibilityRiskEstimate = weatherPreviewActive
    ? weatherVisibilityFallback
    : {
        score: backendVisibilityRiskScore ?? weatherVisibilityFallback.score,
        level: backendVisibilityRiskScore !== null || backendVisibilityRiskLevel !== 'Unknown'
          ? backendVisibilityRiskLevel
          : weatherVisibilityFallback.level,
        summary: backendVisibilitySummary || weatherVisibilityFallback.summary,
        factors: backendVisibilityFactors.length > 0 ? backendVisibilityFactors : weatherVisibilityFallback.factors,
        activeHours: backendVisibilityActiveHours,
        windowHours: backendVisibilityWindowHours,
        source: String(safetyData?.weather.visibilityRisk?.source || weatherVisibilityFallback.source),
      };
  const weatherVisibilityPill = visibilityRiskPillClass(weatherVisibilityRisk.level);
  const weatherVisibilityScoreLabel = Number.isFinite(Number(weatherVisibilityRisk.score))
    ? `${Math.round(Number(weatherVisibilityRisk.score))}/100`
    : 'N/A';
  const weatherVisibilityScoreMeaning = Number.isFinite(Number(weatherVisibilityRisk.score))
    ? 'Higher score = worse visibility risk.'
    : 'Visibility score unavailable.';
  const weatherVisibilityDetail = weatherVisibilityRisk.factors.length > 0
    ? weatherVisibilityRisk.factors.join(' • ')
    : weatherVisibilityRisk.summary;
  const weatherVisibilityContextLine = (() => {
    const precip = Number.isFinite(Number(weatherCardPrecip)) ? Number(weatherCardPrecip) : null;
    if ((weatherVisibilityRisk.level === 'Minimal' || weatherVisibilityRisk.level === 'Low') && precip !== null && precip >= 40) {
      return 'Precip signal is present, but no strong fog/blowing-snow/wind combination is detected at this hour.';
    }
    return null;
  })();
  const weatherVisibilityActiveWindowText =
    Number.isFinite(weatherVisibilityRisk.activeHours) &&
    Number.isFinite(weatherVisibilityRisk.windowHours) &&
    Number(weatherVisibilityRisk.windowHours) > 0
      ? `${Math.round(Number(weatherVisibilityRisk.activeHours))}/${Math.round(Number(weatherVisibilityRisk.windowHours))}h low-vis signal`
      : null;
  const weatherCardDisplayTime = selectedWeatherHour?.label || formatClockForStyle(alpineStartTime, preferences.timeStyle);
  const handleWeatherTrendChartClick = (chartState: unknown) => {
    const parsedState = chartState as { activePayload?: Array<{ payload?: { hourValue?: string | null } }>; activeLabel?: string | number } | null;
    if (!parsedState) {
      return;
    }
    const payloadHourValue = parsedState.activePayload?.[0]?.payload?.hourValue;
    if (payloadHourValue) {
      handleWeatherHourSelect(payloadHourValue);
      return;
    }
    const activeLabel = String(parsedState.activeLabel || '');
    if (!activeLabel) {
      return;
    }
    const matchedRow = weatherTrendChartData.find((row) => row.label === activeLabel && row.hourValue);
    if (matchedRow?.hourValue) {
      handleWeatherHourSelect(matchedRow.hourValue);
    }
  };
  const satObjectiveLabel = truncateText((objectiveName || 'Objective').split(',')[0].trim(), 22);
  const satAvalancheSnippet =
    !safetyData
      ? 'avy n/a'
      : !avalancheRelevant
        ? 'avy n/a'
        : avalancheUnknown
          ? 'avy unk'
          : `avy L${normalizeDangerLevel(safetyData.avalanche.dangerLevel)}`;
  const satWorstWindowSnippet = (() => {
    const satWindowLabel = `worst${travelWindowHours}h`;
    if (!worstTravelWindowRow) {
      return `${satWindowLabel} n/a`;
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
      `${satWindowLabel} ${peakHour} ${peakHazard} f${formatTempDisplay(peakFeelsLike)} g${formatWindDisplay(worstTravelWindowRow.gust)} p${peakPrecip}%`,
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
            )} g${formatWindDisplay(safetyData.weather.windGust)} p${safetyData.weather.precipChance}% | ${satWorstWindowSnippet} | ${satAvalancheSnippet} | ${decision.level}`,
          ),
          170,
        )
      : '';
  const forecastLeadHoursDisplay = (() => {
    if (!safetyData?.forecast?.selectedDate) return null;
    // Prefer the ISO 8601 forecastStartTime (includes timezone) to avoid
    // device-timezone-dependent parsing of bare date + time strings.
    const isoStart = safetyData.weather?.forecastStartTime;
    const forecastMs = isoStart
      ? Date.parse(isoStart)
      : Date.parse(`${safetyData.forecast.selectedDate}T${(safetyData.forecast.selectedStartTime || '00:00').slice(0, 5)}:00Z`);
    if (!Number.isFinite(forecastMs)) return null;
    const leadHours = (forecastMs - Date.now()) / (1000 * 60 * 60);
    if (leadHours <= 24) return null;
    const rounded = Math.round(leadHours);
    return `${rounded}h forecast`;
  })();
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
  const snowpackDepthSignalValues = [
    Number(safetyData?.snowpack?.snotel?.snowDepthIn),
    Number(safetyData?.snowpack?.nohrsc?.snowDepthIn),
  ].filter((value) => Number.isFinite(value) && value > 0);
  const snowpackSweSignalValues = [
    Number(safetyData?.snowpack?.snotel?.sweIn),
    Number(safetyData?.snowpack?.nohrsc?.sweIn),
  ].filter((value) => Number.isFinite(value) && value > 0);
  const hasSnowpackSignal = snowpackDepthSignalValues.length > 0 || snowpackSweSignalValues.length > 0;
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
  const objectiveTimezone = safetyData?.weather.timezone || null;
  const precipitationDisplayTimezone = objectiveTimezone || safetyData?.rainfall?.timezone || null;
  const deviceTimezone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone || null : null;
  const timezoneMismatch = Boolean(objectiveTimezone && deviceTimezone && objectiveTimezone !== deviceTimezone);
  const handleUseNowConditions = () => {
    const nowInputs = currentDateTimeInputs(objectiveTimezone);
    const objectiveToday = nowInputs.date;
    const objectiveMaxDate = dateTimeInputsFor(new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), objectiveTimezone).date;
    const nextDate = normalizeForecastDate(nowInputs.date, objectiveToday, objectiveMaxDate);
    const nextTime = parseTimeInputMinutes(nowInputs.time) === null ? preferences.defaultStartTime : nowInputs.time;

    setForecastDate(nextDate);
    setAlpineStartTime(nextTime);
    setError(null);

    if (hasObjective && view === 'planner') {
      void fetchSafetyData(position.lat, position.lng, nextDate, nextTime, { force: true });
    }
  };
  const freshness = buildSourceFreshnessDisplay(safetyData, rainfallPayload, avalancheRelevant, travelWindowHours);
  const {
    sourceFreshnessRows, hasFreshnessWarning, freshnessWarningSummary,
    reportGeneratedAt, airQualityFutureNotApplicable,
  } = freshness;
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
  const windLoading = buildWindLoadingDisplay(
    safetyData, trendWindow, avalancheRelevant, formatWindDisplay, preferences.timeStyle,
  );
  const {
    resolvedWindDirection, resolvedWindDirectionSource, trendWindDirections,
    leewardAspectHints, secondaryWindAspects, aspectOverlapProblems,
    windGustMph, calmOrVariableSignal, lightWindSignal,
    trendAgreementRatio,
    windLoadingLevel, windLoadingConfidence, windLoadingPillClass,
    windLoadingActiveWindowLabel, windLoadingActiveHoursDetail,
    windLoadingElevationFocus, windLoadingActionLine, windLoadingSummary, windLoadingNotes,
    windLoadingHintsRelevant,
  } = windLoading;
  if (decision && aspectOverlapProblems.length > 0) {
    const overlapCaution = `Wind loading aligns with active avalanche problem aspects (${aspectOverlapProblems.join(', ')}). Current winds may be actively building slabs on these aspects.`;
    if (!decision.cautions.includes(overlapCaution)) {
      decision = { ...decision, cautions: [...decision.cautions, overlapCaution] };
    }
  }
  const terrainConditionDetails = safetyData
    ? (() => {
        const upstreamTerrain = safetyData.terrainCondition;
        const snowProfile = upstreamTerrain?.snowProfile
          ? {
              label: upstreamTerrain.snowProfile.label || 'Snow profile unavailable',
              summary: upstreamTerrain.snowProfile.summary || '',
              reasons: Array.isArray(upstreamTerrain.snowProfile.reasons) ? upstreamTerrain.snowProfile.reasons.slice(0, 4) : [],
              confidence: upstreamTerrain.snowProfile.confidence || null,
            }
          : null;
        if (upstreamTerrain && (upstreamTerrain.summary || (Array.isArray(upstreamTerrain.reasons) && upstreamTerrain.reasons.length > 0))) {
          return {
            summary:
              upstreamTerrain.summary ||
              'Surface classification is based on weather, precipitation totals, trend, and snowpack observations.',
            reasons: Array.isArray(upstreamTerrain.reasons) ? upstreamTerrain.reasons.slice(0, 6) : [],
            confidence: upstreamTerrain.confidence || null,
            impact: upstreamTerrain.impact || null,
            recommendedTravel: upstreamTerrain.recommendedTravel || null,
            footwear: upstreamTerrain.footwear || null,
            snowProfile,
          };
        }
        return {
          summary:
            'Surface classification is based on weather description, precip probability, rolling rain/snow totals, temperature trend, and available snowpack observations.',
          reasons: [] as string[],
          confidence: null as 'high' | 'medium' | 'low' | null,
          impact: null as string | null,
          recommendedTravel: null as string | null,
          footwear: null as string | null,
          snowProfile,
        };
      })()
    : {
        summary: 'Surface classification unavailable until a forecast is loaded.',
        reasons: [] as string[],
        confidence: null as 'high' | 'medium' | 'low' | null,
        impact: null as string | null,
        recommendedTravel: null as string | null,
        footwear: null as string | null,
        snowProfile: null as { label: string; summary: string; reasons: string[]; confidence: 'high' | 'medium' | 'low' | null } | null,
      };
  const terrainConditionPillClass = (() => {
    const terrainCode = String(safetyData?.terrainCondition?.code || '').toLowerCase();
    if (terrainCode === 'dry_firm') {
      return 'go';
    }
    if (terrainCode === 'weather_unavailable') {
      return 'watch';
    }
    if (['snow_ice', 'snow_fresh_powder', 'snow_mixed', 'spring_snow', 'wet_snow', 'wet_muddy', 'cold_slick', 'dry_loose'].includes(terrainCode)) {
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
  const gearRecommendations = Array.isArray(safetyData?.gear)
    ? safetyData.gear
        .map((rawItem) => {
          // Structured object from backend
          if (rawItem && typeof rawItem === 'object' && typeof rawItem.title === 'string') {
            const { title, detail, category, tone } = rawItem;
            return {
              title: String(title || '').trim(),
              detail: String(detail || '').trim(),
              category: String(category || 'General'),
              tone: String(tone || 'go'),
            };
          }
          // Legacy: plain text string fallback
          const text = String(rawItem || '').replace(/\s+/g, ' ').trim();
          if (!text) {
            return null;
          }
          const splitIdx = text.indexOf(':');
          const hasReadablePrefix = splitIdx >= 2 && splitIdx <= 44;
          const title = hasReadablePrefix ? text.slice(0, splitIdx).trim() : 'Gear note';
          const detail = hasReadablePrefix ? text.slice(splitIdx + 1).trim() : text;
          const combined = `${title} ${detail}`.toLowerCase();
          const category = /avalanche|beacon|probe|shovel|alerts contingency|coverage gap|comms|communication/.test(combined)
            ? 'Safety'
            : /shell|rain|wet|snow|ice|mud|traction|gaiter|insulation|extremities|layer|wind/.test(combined)
              ? 'Conditions'
              : /aqi|air quality|heat|fire|sun/.test(combined)
                ? 'Exposure'
                : 'General';
          const tone = /coverage gap|avalanche rescue|alerts contingency/.test(combined)
            ? 'nogo'
            : /storm shell|snow\/ice traction|cold extremities|static insulation/.test(combined)
              ? 'caution'
              : category === 'General'
                ? 'watch'
                : 'go';
          return { title, detail, category, tone };
        })
        .filter((item): item is { title: string; detail: string; category: string; tone: string } => item !== null)
    : [];
  const reportCardOrder = buildReportCardOrder({
    safetyData, decision, preferences,
    travelWindowRows, criticalWindow,
    criticalCheckTotal, criticalCheckFailCount,
    avalancheRelevant, avalancheUnknown,
    windLoadingHintsRelevant, windLoadingLevel, windLoadingConfidence,
    resolvedWindDirection, calmOrVariableSignal, lightWindSignal, trendWindDirections,
    rainfall12hIn, rainfall24hIn, rainfall48hIn,
    snowfall12hIn, snowfall24hIn, snowfall48hIn,
    snowpackDepthSignalValues, snowpackSweSignalValues, hasSnowpackSignal,
    sourceFreshnessRows, gearRecommendations, dayOverDay,
    fireRiskLevel, heatRiskLevel,
  });
  const shouldRenderRankedCard = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (_key: string): boolean => true,
    [],
  );

  useEffect(() => {
    if (view !== 'trip' || !hasObjective || tripForecastLoading || tripForecastRows.length > 0 || Boolean(tripForecastError)) {
      return;
    }
    void runTripForecast();
  }, [view, hasObjective, tripForecastLoading, tripForecastRows.length, tripForecastError, runTripForecast]);

  if (view === 'status') {
    return (
      <StatusView
        appShellClassName={appShellClassName}
        isViewPending={isViewPending}
        healthChecks={healthChecks}
        healthLoading={healthLoading}
        healthError={healthError}
        healthCheckedAt={healthCheckedAt}
        backendMeta={backendMeta}
        formatPubTime={formatPubTime}
        runHealthChecks={runHealthChecks}
        navigateToView={navigateToView}
        openPlannerView={openPlannerView}
      />
    );
  }

  if (view === 'logs') {
    return (
      <div key="view-logs" className={appShellClassName} aria-busy={isViewPending}>
        <section className="settings-shell">
          <LogsView onHome={() => navigateToView('home')} />
        </section>
      </div>
    );
  }

  if (view === 'settings') {
    return (
      <SettingsView
        appShellClassName={appShellClassName}
        isViewPending={isViewPending}
        preferences={preferences}
        displayDefaultStartTime={displayDefaultStartTime}
        travelWindowHoursLabel={travelWindowHoursLabel}
        windThresholdDisplay={windThresholdDisplay}
        feelsLikeThresholdDisplay={feelsLikeThresholdDisplay}
        windUnitLabel={windUnitLabel}
        tempUnitLabel={tempUnitLabel}
        travelWindowHoursDraft={travelWindowHoursDraft}
        maxWindGustDraft={maxWindGustDraft}
        maxPrecipChanceDraft={maxPrecipChanceDraft}
        minFeelsLikeDraft={minFeelsLikeDraft}
        windThresholdMin={windThresholdMin}
        windThresholdMax={windThresholdMax}
        windThresholdStep={windThresholdStep}
        feelsLikeThresholdMin={feelsLikeThresholdMin}
        feelsLikeThresholdMax={feelsLikeThresholdMax}
        feelsLikeThresholdStep={feelsLikeThresholdStep}
        handlePreferenceTimeChange={handlePreferenceTimeChange}
        handleThemeModeChange={handleThemeModeChange}
        handleTemperatureUnitChange={handleTemperatureUnitChange}
        handleElevationUnitChange={handleElevationUnitChange}
        handleWindSpeedUnitChange={handleWindSpeedUnitChange}
        handleTimeStyleChange={handleTimeStyleChange}
        handleTravelWindowHoursDraftChange={handleTravelWindowHoursDraftChange}
        handleTravelWindowHoursDraftBlur={handleTravelWindowHoursDraftBlur}
        handleWindThresholdDisplayChange={handleWindThresholdDisplayChange}
        handleWindThresholdDisplayBlur={handleWindThresholdDisplayBlur}
        handleMaxPrecipChanceDraftChange={handleMaxPrecipChanceDraftChange}
        handleMaxPrecipChanceDraftBlur={handleMaxPrecipChanceDraftBlur}
        handleFeelsLikeThresholdDisplayChange={handleFeelsLikeThresholdDisplayChange}
        handleFeelsLikeThresholdDisplayBlur={handleFeelsLikeThresholdDisplayBlur}
        applyPreferencesToPlanner={applyPreferencesToPlanner}
        resetPreferences={resetPreferences}
        navigateToView={navigateToView}
        openPlannerView={openPlannerView}
      />
    );
  }

  if (view === 'trip') {
    return (
      <TripView
        appShellClassName={appShellClassName}
        isViewPending={isViewPending}
        hasObjective={hasObjective}
        objectiveName={objectiveName}
        position={position}
        tripStartDate={tripStartDate}
        tripStartTime={tripStartTime}
        tripDurationDays={tripDurationDays}
        tripForecastRows={tripForecastRows}
        tripForecastLoading={tripForecastLoading}
        tripForecastError={tripForecastError}
        tripForecastNote={tripForecastNote}
        travelWindowHoursLabel={travelWindowHoursLabel}
        todayDate={todayDate}
        maxForecastDate={maxForecastDate}
        timeStyle={preferences.timeStyle}
        formatIsoDateLabel={formatIsoDateLabel}
        formatTempDisplay={formatTempDisplay}
        formatWindDisplay={formatWindDisplay}
        formatPubTime={formatPubTime}
        localizeUnitText={localizeUnitText}
        getScoreColor={getScoreColor}
        setTripStartDate={setTripStartDate}
        setTripStartTime={setTripStartTime}
        setTripDurationDays={setTripDurationDays}
        setTripForecastRows={setTripForecastRowsDirect}
        setTripForecastError={setTripForecastErrorDirect}
        setTripForecastNote={setTripForecastNoteDirect}
        runTripForecast={runTripForecast}
        navigateToView={navigateToView}
        openPlannerView={openPlannerView}
        onUseDayInPlanner={(date, startTime) => {
          setForecastDate(date);
          setAlpineStartTime(startTime);
          setError(null);
          startViewChange(() => setView('planner'));
        }}
      />
    );
  }

  if (view === 'home') {
    const navigateToPlanner = () => startViewChange(() => setView('planner'));

    return (
      <HomeView
        appShellClassName={appShellClassName}
        isViewPending={isViewPending}
        searchWrapperRef={searchWrapperRef}
        searchInputRef={searchInputRef}
        searchQuery={searchQuery}
        trimmedSearchQuery={trimmedSearchQuery}
        showSuggestions={showSuggestions}
        searchLoading={searchLoading}
        suggestions={suggestions}
        activeSuggestionIndex={activeSuggestionIndex}
        canUseCoordinates={Boolean(parsedTypedCoordinates)}
        handleInputChange={handleInputChange}
        handleFocus={handleFocus}
        handleSearchKeyDown={handleSearchKeyDown}
        handleSearchSubmit={handleSearchSubmit}
        handleSearchClear={handleSearchClear}
        handleUseTypedCoordinates={handleUseTypedCoordinates}
        selectSuggestion={selectSuggestion}
        setActiveSuggestionIndex={setActiveSuggestionIndex}
        navigateToPlanner={navigateToPlanner}
        navigateToView={navigateToView}
        openTripToolView={openTripToolView}
      />
    );
  }

  return (
    <PlannerView
      // Shell / layout
      appShellClassName={appShellClassName}
      isViewPending={isViewPending}
      // Navigation
      navigateToView={navigateToView}
      openTripToolView={openTripToolView}
      jumpToPlannerSection={jumpToPlannerSection}
      // Search box
      searchWrapperRef={searchWrapperRef}
      searchInputRef={searchInputRef}
      searchQuery={searchQuery}
      trimmedSearchQuery={trimmedSearchQuery}
      showSuggestions={showSuggestions}
      searchLoading={searchLoading}
      suggestions={suggestions}
      activeSuggestionIndex={activeSuggestionIndex}
      parsedTypedCoordinates={parsedTypedCoordinates}
      handleInputChange={handleInputChange}
      handleFocus={handleFocus}
      handleSearchKeyDown={handleSearchKeyDown}
      handleSearchSubmit={handleSearchSubmit}
      handleSearchClear={handleSearchClear}
      handleUseTypedCoordinates={handleUseTypedCoordinates}
      selectSuggestion={selectSuggestion}
      setActiveSuggestionIndex={setActiveSuggestionIndex}
      // Header controls
      hasObjective={hasObjective}
      objectiveIsSaved={objectiveIsSaved}
      handleToggleSaveObjective={handleToggleSaveObjective}
      copiedLink={copiedLink}
      handleCopyLink={handleCopyLink}
      // Map
      position={position}
      activeBasemap={activeBasemap}
      preferences={preferences}
      updateObjectivePosition={updateObjectivePosition}
      mapFocusNonce={mapFocusNonce}
      mapStyle={mapStyle}
      setMapStyle={setMapStyle}
      locatingUser={locatingUser}
      handleUseCurrentLocation={handleUseCurrentLocation}
      handleRecenterMap={handleRecenterMap}
      safetyData={safetyData}
      mapElevationChipTitle={mapElevationChipTitle}
      mapElevationLabel={mapElevationLabel}
      mapWeatherEmoji={mapWeatherEmoji}
      mapWeatherTempLabel={mapWeatherTempLabel}
      mapWeatherConditionLabel={mapWeatherConditionLabel}
      mapWeatherChipTitle={mapWeatherChipTitle}
      // Map actions / plan controls
      mobileMapControlsExpanded={mobileMapControlsExpanded}
      setMobileMapControlsExpanded={setMobileMapControlsExpanded}
      forecastDate={forecastDate}
      todayDate={todayDate}
      maxForecastDate={maxForecastDate}
      handleDateChange={handleDateChange}
      startLabel={startLabel}
      alpineStartTime={alpineStartTime}
      handlePlannerTimeChange={handlePlannerTimeChange}
      setAlpineStartTime={setAlpineStartTime}
      travelWindowHoursDraft={travelWindowHoursDraft}
      handleTravelWindowHoursDraftChange={handleTravelWindowHoursDraftChange}
      handleTravelWindowHoursDraftBlur={handleTravelWindowHoursDraftBlur}
      objectiveTimezone={objectiveTimezone}
      handleUseNowConditions={handleUseNowConditions}
      loading={loading}
      handleRetryFetch={handleRetryFetch}
      satelliteConditionLine={satelliteConditionLine}
      timezoneMismatch={timezoneMismatch}
      deviceTimezone={deviceTimezone}
      // Decision / safety
      decision={decision}
      avalancheRelevant={avalancheRelevant}
      // Freshness warning
      hasFreshnessWarning={hasFreshnessWarning}
      freshnessWarningSummary={freshnessWarningSummary}
      // Score card
      getScoreColor={getScoreColor}
      forecastLeadHoursDisplay={forecastLeadHoursDisplay}
      objectiveName={objectiveName}
      displayStartTime={displayStartTime}
      returnTimeFormatted={returnTimeFormatted}
      returnExtendsPastMidnight={returnExtendsPastMidnight}
      formatClockForStyle={formatClockForStyle}
      error={error}
      aiBriefNarrative={aiBriefNarrative}
      aiBriefError={aiBriefError}
      aiBriefLoading={aiBriefLoading}
      handleRequestAiBriefAction={handleRequestAiBriefAction}
      // Route analysis
      routeSuggestions={routeSuggestions}
      routeAnalysis={routeAnalysis}
      routeLoading={routeLoading}
      routeError={routeError}
      fetchRouteSuggestions={fetchRouteSuggestions}
      fetchRouteAnalysis={fetchRouteAnalysis}
      customRouteName={customRouteName}
      setCustomRouteName={setCustomRouteName}
      setRouteSuggestions={setRouteSuggestions}
      setRouteError={setRouteError}
      reportCardOrder={reportCardOrder}
      travelWindowHours={travelWindowHours}
      formatTempDisplay={formatTempDisplay}
      formatWindDisplay={formatWindDisplay}
      formatElevationDisplay={formatElevationDisplay}
      formatElevationDeltaDisplay={formatElevationDeltaDisplay}
      // Visibility banner
      weatherVisibilityRisk={weatherVisibilityRisk}
      weatherVisibilityPill={weatherVisibilityPill}
      weatherVisibilityDetail={weatherVisibilityDetail}
      // Decision Gate card
      decisionActionLine={decisionActionLine}
      fieldBriefPrimaryReason={fieldBriefPrimaryReason}
      fieldBriefTopRisks={fieldBriefTopRisks}
      rainfall24hSeverityClass={rainfall24hSeverityClass}
      rainfall24hDisplay={rainfall24hDisplay}
      decisionPassingChecksCount={decisionPassingChecksCount}
      decisionFailingChecks={decisionFailingChecks}
      decisionKeyDrivers={decisionKeyDrivers}
      orderedCriticalChecks={orderedCriticalChecks}
      betterDaySuggestions={betterDaySuggestions}
      betterDaySuggestionsLoading={betterDaySuggestionsLoading}
      betterDaySuggestionsNote={betterDaySuggestionsNote}
      localizeUnitText={localizeUnitText}
      formatIsoDateLabel={formatIsoDateLabel}
      setForecastDate={setForecastDate}
      setError={setError}
      // Travel Window card
      peakCriticalWindow={peakCriticalWindow}
      travelWindowInsights={travelWindowInsights}
      travelWindowRows={travelWindowRows}
      formatTravelWindowSpan={formatTravelWindowSpan}
      windThresholdDisplay={windThresholdDisplay}
      feelsLikeThresholdDisplay={feelsLikeThresholdDisplay}
      activeTravelThresholdPreset={activeTravelThresholdPreset}
      onApplyTravelThresholdPreset={handleApplyTravelThresholdPreset}
      travelThresholdEditorOpen={travelThresholdEditorOpen}
      setTravelThresholdEditorOpen={setTravelThresholdEditorOpen}
      windUnitLabel={windUnitLabel}
      windThresholdMin={windThresholdMin}
      windThresholdMax={windThresholdMax}
      windThresholdStep={windThresholdStep}
      maxWindGustDraft={maxWindGustDraft}
      handleWindThresholdDisplayChange={handleWindThresholdDisplayChange}
      handleWindThresholdDisplayBlur={handleWindThresholdDisplayBlur}
      maxPrecipChanceDraft={maxPrecipChanceDraft}
      handleMaxPrecipChanceDraftChange={handleMaxPrecipChanceDraftChange}
      handleMaxPrecipChanceDraftBlur={handleMaxPrecipChanceDraftBlur}
      tempUnitLabel={tempUnitLabel}
      feelsLikeThresholdMin={feelsLikeThresholdMin}
      feelsLikeThresholdMax={feelsLikeThresholdMax}
      feelsLikeThresholdStep={feelsLikeThresholdStep}
      minFeelsLikeDraft={minFeelsLikeDraft}
      handleFeelsLikeThresholdDisplayChange={handleFeelsLikeThresholdDisplayChange}
      handleFeelsLikeThresholdDisplayBlur={handleFeelsLikeThresholdDisplayBlur}
      travelWindowSummary={travelWindowSummary}
      criticalWindow={criticalWindow}
      travelWindowExpanded={travelWindowExpanded}
      setTravelWindowExpanded={setTravelWindowExpanded}
      visibleCriticalWindowRows={visibleCriticalWindowRows}
      travelWindowHoursLabel={travelWindowHoursLabel}
      // Critical Checks card
      topCriticalAttentionChecks={topCriticalAttentionChecks}
      criticalCheckFailCount={criticalCheckFailCount}
      describeFailedCriticalCheck={describeFailedCriticalCheck}
      // Score Trace card
      dayOverDay={dayOverDay}
      shouldRenderRankedCard={shouldRenderRankedCard}
      // Weather card
      weatherCardTemp={weatherCardTemp}
      weatherCardWind={weatherCardWind}
      weatherCardFeelsLike={weatherCardFeelsLike}
      weatherCardWithEmoji={weatherCardWithEmoji}
      weatherCardPrecip={weatherCardPrecip}
      weatherCardHumidity={weatherCardHumidity}
      weatherCardDewPoint={weatherCardDewPoint}
      weatherCardDescription={weatherCardDescription}
      weatherCardDisplayTime={weatherCardDisplayTime}
      weatherForecastPeriodLabel={weatherForecastPeriodLabel}
      weatherPreviewActive={weatherPreviewActive}
      weatherPressureTrendSummary={weatherPressureTrendSummary}
      pressureTrendDirection={pressureTrendDirection}
      pressureDeltaLabel={pressureDeltaLabel}
      pressureRangeLabel={pressureRangeLabel}
      weatherHourQuickOptions={weatherHourQuickOptions}
      selectedWeatherHourIndex={selectedWeatherHourIndex}
      handleWeatherHourSelect={handleWeatherHourSelect}
      weatherConditionEmojiValue={weatherConditionEmoji}
      weatherTrendChartData={weatherTrendChartData}
      weatherTrendHasData={weatherTrendHasData}
      weatherTrendMetric={weatherTrendMetric}
      weatherTrendMetricLabel={weatherTrendMetricLabel}
      weatherTrendMetricOptions={weatherTrendMetricOptions}
      weatherTrendLineColor={weatherTrendLineColor}
      weatherTrendYAxisDomain={weatherTrendYAxisDomain}
      weatherTrendTickFormatter={weatherTrendTickFormatter}
      formatWeatherTrendValue={formatWeatherTrendValue}
      onTrendMetricChange={(key) => setWeatherTrendMetric(key as typeof weatherTrendMetric)}
      handleWeatherTrendChartClick={handleWeatherTrendChartClick}
      selectedWeatherHourValue={selectedWeatherHour?.value || null}
      formattedWind={formatWindDisplay(weatherCardWind)}
      formattedGust={formatWindDisplay(weatherCardGust)}
      weatherCardPressureLabel={weatherCardPressureLabel}
      weatherPressureContextLine={weatherPressureContextLine}
      weatherCardWindDirection={weatherCardWindDirection}
      weatherCardCloudCoverLabel={weatherCardCloudCoverLabel}
      weatherVisibilityScoreLabel={weatherVisibilityScoreLabel}
      weatherVisibilityActiveWindowText={weatherVisibilityActiveWindowText}
      weatherVisibilityScoreMeaning={weatherVisibilityScoreMeaning}
      weatherVisibilityContextLine={weatherVisibilityContextLine}
      targetElevationInput={targetElevationInput}
      handleTargetElevationChange={handleTargetElevationChange}
      handleTargetElevationStep={handleTargetElevationStep}
      canDecreaseTargetElevation={canDecreaseTargetElevation}
      hasTargetElevation={hasTargetElevation}
      targetElevationForecast={targetElevationForecast}
      targetElevationFt={targetElevationFt}
      TARGET_ELEVATION_STEP_FEET={TARGET_ELEVATION_STEP_FEET}
      elevationUnitLabel={elevationUnitLabel}
      elevationForecastBands={elevationForecastBands}
      objectiveElevationFt={objectiveElevationFt}
      safeWeatherLink={safeWeatherLink}
      weatherLinkCta={weatherLinkCta}
      weatherSourceDisplay={weatherSourceDisplay}
      formatPubTime={formatPubTime}
      weatherTrendTempRange={weatherTrendTempRange}
      getDangerLevelClass={getDangerLevelClass}
      getDangerText={getDangerText}
      // Heat Risk card
      heatRiskGuidance={heatRiskGuidance}
      heatRiskReasons={heatRiskReasons}
      heatRiskMetrics={heatRiskMetrics}
      heatRiskPillClass={heatRiskPillClass}
      heatRiskLabel={heatRiskLabel}
      lowerTerrainHeatLabel={lowerTerrainHeatLabel}
      // Terrain card
      terrainConditionDetails={terrainConditionDetails}
      terrainConditionPillClass={terrainConditionPillClass}
      rainfall12hDisplay={rainfall12hDisplay}
      rainfall48hDisplay={rainfall48hDisplay}
      snowfall12hDisplay={snowfall12hDisplay}
      snowfall24hDisplay={snowfall24hDisplay}
      snowfall48hDisplay={snowfall48hDisplay}
      snowfall12hIn={snowfall12hIn}
      snowfall24hIn={snowfall24hIn}
      snowfall48hIn={snowfall48hIn}
      // Rainfall card
      precipInsightLine={precipInsightLine}
      expectedPrecipSummaryLine={expectedPrecipSummaryLine}
      expectedTravelWindowHours={expectedTravelWindowHours}
      expectedRainWindowDisplay={expectedRainWindowDisplay}
      expectedSnowWindowIn={expectedSnowWindowIn}
      expectedSnowWindowDisplay={expectedSnowWindowDisplay}
      rainfallExpected={rainfallExpected}
      precipitationDisplayTimezone={precipitationDisplayTimezone}
      expectedPrecipNoteLine={expectedPrecipNoteLine}
      rainfallModeLabel={rainfallModeLabel}
      rainfallPayload={rainfallPayload}
      rainfallNoteLine={rainfallNoteLine}
      safeRainfallLink={safeRainfallLink}
      formatForecastPeriodLabel={formatForecastPeriodLabel}
      // Wind Loading card
      windLoadingHintsRelevant={windLoadingHintsRelevant}
      windLoadingLevel={windLoadingLevel}
      windLoadingConfidence={windLoadingConfidence}
      windLoadingPillClass={windLoadingPillClass}
      windLoadingActiveWindowLabel={windLoadingActiveWindowLabel}
      windLoadingActiveHoursDetail={windLoadingActiveHoursDetail}
      resolvedWindDirectionSource={resolvedWindDirectionSource}
      trendAgreementRatio={trendAgreementRatio}
      windLoadingElevationFocus={windLoadingElevationFocus}
      leewardAspectHints={leewardAspectHints}
      secondaryWindAspects={secondaryWindAspects}
      windGustMph={windGustMph}
      windLoadingNotes={windLoadingNotes}
      aspectOverlapProblems={aspectOverlapProblems}
      windLoadingSummary={windLoadingSummary}
      windLoadingActionLine={windLoadingActionLine}
      avalancheUnknown={avalancheUnknown}
      // Source Freshness card
      sourceFreshnessRows={sourceFreshnessRows}
      reportGeneratedAt={reportGeneratedAt}
      avalancheExpiredForSelectedStart={avalancheExpiredForSelectedStart}
      formatAgeFromNow={formatAgeFromNow}
      // NWS Alerts card
      nwsAlertCount={nwsAlertCount}
      nwsTotalAlertCount={nwsTotalAlertCount}
      nwsTopAlerts={nwsTopAlerts}
      // Air Quality card
      airQualityPillClassFn={airQualityPillClass}
      airQualityFutureNotApplicable={airQualityFutureNotApplicable}
      // Snowpack card
      snowpackInsights={snowpackInsights}
      snotelDistanceDisplay={snotelDistanceDisplay}
      snotelDepthDisplay={snotelDepthDisplay}
      snotelSweDisplay={snotelSweDisplay}
      nohrscDepthDisplay={nohrscDepthDisplay}
      nohrscSweDisplay={nohrscSweDisplay}
      cdecDepthDisplay={cdecDepthDisplay}
      cdecSweDisplay={cdecSweDisplay}
      cdecDistanceDisplay={cdecDistanceDisplay}
      snowpackPillClass={snowpackPillClass}
      snowpackStatusLabel={snowpackStatusLabel}
      snowpackHistoricalStatusLabel={snowpackHistoricalStatusLabel}
      snowpackHistoricalPillClass={snowpackHistoricalPillClass}
      snowpackHistoricalComparisonLine={snowpackHistoricalComparisonLine}
      snowpackInterpretation={snowpackInterpretation}
      snowpackTakeaways={snowpackTakeaways}
      snowfallWindowSummary={snowfallWindowSummary}
      rainfallWindowSummary={rainfallWindowSummary}
      snowpackObservationContext={snowpackObservationContext}
      safeSnotelLink={safeSnotelLink}
      safeNohrscLink={safeNohrscLink}
      safeCdecLink={safeCdecLink}
      // Fire Risk card
      fireRiskLabel={fireRiskLabel}
      fireRiskPillClass={fireRiskPillClass}
      fireRiskAlerts={fireRiskAlerts}
      // Plan Snapshot card
      sunriseMinutesForPlan={sunriseMinutesForPlan}
      sunsetMinutesForPlan={sunsetMinutesForPlan}
      startMinutesForPlan={startMinutesForPlan}
      returnMinutes={returnMinutes}
      daylightRemainingFromStartLabel={daylightRemainingFromStartLabel}
      // Gear card
      gearRecommendations={gearRecommendations}
      // Avalanche forecast card
      overallAvalancheLevel={overallAvalancheLevel}
      avalancheNotApplicableReason={avalancheNotApplicableReason}
      avalancheElevationRows={avalancheElevationRows}
      safeAvalancheLink={safeAvalancheLink}
      normalizeDangerLevel={normalizeDangerLevel}
      getDangerGlyph={getDangerGlyph}
      summarizeText={summarizeText}
      toPlainText={toPlainText}
      // Deep Dive card
      safeShareLink={safeShareLink}
      weatherFieldSources={weatherFieldSources}
      weatherCloudCover={weatherCloudCover}
      weatherBlended={!!safetyData?.weather.sourceDetails?.blended}
      rawReportPayload={rawReportPayload}
      copiedRawPayload={copiedRawPayload}
      handleCopyRawPayload={handleCopyRawPayload}
      // Footer
      formatGeneratedAt={formatGeneratedAt}
    />
  );

}

export default App;

