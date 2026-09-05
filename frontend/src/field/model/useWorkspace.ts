// The established planning controller, separated from its previous presentation.
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import L from "leaflet";
import {
  DATE_FMT,
  GUST_INCREASE_MPH_PER_1000FT,
  KM_PER_MILE,
  MAP_STYLE_OPTIONS,
  MAX_TRAVEL_WINDOW_HOURS,
  MIN_TRAVEL_WINDOW_HOURS,
  TEMP_LAPSE_F_PER_1000FT,
  WIND_INCREASE_MPH_PER_1000FT,
} from "../../app/constants";
import {
  type ActivityType,
  type MapStyle,
  type SafetyData,
  type UserPreferences,
} from "../../app/types";
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
  parseSolarClockMinutes,
  parseTimeInputMinutes,
} from "../../app/core";
import {
  currentDateTimeInputs,
  dateTimeInputsFor,
} from "../../app/date-time-inputs";
import {
  type PastPlannedStart,
  getTomorrowDate,
  resolveObjectiveTimeZone,
} from "../../app/planned-start";
import {
  computeFeelsLikeF,
  getDangerLevelClass,
  normalizeDangerLevel,
  parseOptionalElevationInput,
} from "../../app/planner-helpers";
import {
  hasStoredUserPreferences,
  loadUserPreferences,
  normalizeUserPreferences,
  persistUserPreferences,
} from "../../app/preferences";
import {
  GUEST_REPORT_COUNT_KEY,
  GUEST_REPORT_LIMIT,
  incrementGuestReportCount,
  loadGuestReportCount,
} from "../../app/guest-report-limit";
import {
  stringifyRawPayload,
  summarizeText,
  toPlainText,
  truncateText,
} from "../../app/text-utils";
import {
  buildSnowpackInterpretation,
  buildSnowpackInsights,
} from "../../app/snowpack-display";
import { windDirectionFromDegrees } from "../../app/wind-analysis";
import { assessCriticalWindowPoint } from "../../app/critical-window";
import {
  weatherConditionEmoji,
  inferWeatherSourceLabel,
  formatDurationMinutes,
} from "../../app/weather-display";
import {
  type WeatherTrendMetricKey,
  WEATHER_TREND_METRIC_LABELS,
  buildWeatherTrendRows,
  buildWeatherTrendChartData,
  buildPressureTrend,
  buildWeatherTrendTempRange,
  getWeatherTrendLineColor,
  getWeatherTrendYAxisDomain,
  buildWeatherTrendMetricOptions,
  buildWeatherHourQuickOptions,
  findSelectedWeatherHourIndex,
  buildWeatherCardValues,
  buildVisibilityRiskDisplay,
} from "../../app/weather-card-state";
import { buildAvalancheDisplayState } from "../../app/avalanche-display";
import {
  buildDecisionDisplayState,
  describeFailedCriticalCheck,
} from "../../app/decision-display";
import {
  buildFireRiskDisplay,
  buildHeatRiskDisplay,
  buildTerrainConditionDisplay,
  buildSnowpackDisplayState,
  pillClassForLevel,
} from "../../app/risk-display";
import {
  buildTravelWindowRows,
  formatTravelWindowSpan,
  buildTravelWindowInsights,
  buildTrendWindowFromStart,
} from "../../app/travel-window";
import { sanitizeExternalUrl, parseLinkState } from "../../app/url-state";
import { readAccountLinkAction } from "../../app/account-links";
import type { MultiDayUsage } from "../../app/multi-day-usage";
import { evaluateBackcountryDecision } from "../../app/decision";
import { buildReportCardOrder } from "../../app/card-ordering";
import { buildWindLoadingDisplay } from "../../app/wind-loading-display";
import { buildRainfallDisplay } from "../../app/rainfall-display";
import { buildSourceFreshnessDisplay } from "../../app/source-freshness-display";
import {
  buildPersistedReport,
  clearPersistedReport,
  loadPersistedReport,
  parsePersistedReport,
  persistedReportMatchesPlan,
  type PersistedReport,
  type PersistedReportChatMessage,
  type PersistedReportPlan,
} from "../../app/report-storage";
import { copyTextToClipboard } from "../../app/clipboard";
import { parseReportSectionHash } from "../../app/report-sections";
import { useHealthChecks } from "../../hooks/useHealthChecks";
import { useRouteAnalysis } from "../../hooks/useRouteAnalysis";
import type { RouteAnalysisOptions } from "../../hooks/useRouteAnalysis";
import { useTripForecast } from "../../hooks/useTripForecast";
import { useSafetyData } from "../../hooks/useSafetyData";
import { useSearchSuggestions } from "../../hooks/useSearchSuggestions";
import { normalizeSuggestionText } from "../../lib/search";
import { estimateRouteDurationHours, type ParsedGpxRoute } from "../../lib/gpx";
import { useUrlState, useSyncUrlEffect } from "../../hooks/useUrlState";
import type { AppView } from "../../hooks/useUrlState";
import { useReportGeneration } from "./useReportGeneration";
import { useReportComparisons } from "./useReportComparisons";
import { useSavedReportSession, useSavedReportSync } from "./useSavedReportSync";
import {
  usePreferenceHandlers,
  TRAVEL_THRESHOLD_PRESETS,
} from "../../hooks/usePreferenceHandlers";
import type { TravelThresholdPresetKey } from "../../hooks/usePreferenceHandlers";
import { useProductFeatureFlags } from "../../contexts/feature-flags";
import { useAccount } from "../../hooks/useAccount";
import {
  buildSavedReportShareUrl,
  getSharedReport,
} from "../../lib/saved-reports";
type AccountAccessReason =
  | "ai"
  | "report-email"
  | "guest-report-limit"
  | "account-report-limit"
  | "guest-multi-day-limit"
  | "account-multi-day-limit";
const TARGET_ELEVATION_STEP_FEET = 1000;
const ADMIN_ACCOUNT_EMAIL = "weiranxiong@gmail.com";
function airQualityPillClass(
  aqi: number | null | undefined,
): "go" | "caution" | "nogo" {
  // AQI only uses a three-tier scale (no 'watch' tier); collapsing the
  // caution/watch thresholds to the same value makes the shared four-tier
  // helper degenerate into this three-tier mapping.
  return pillClassForLevel(
    aqi,
    { nogo: 101, caution: 51, watch: 51 },
    "caution",
  ) as "go" | "caution" | "nogo";
}
function formatIsoDateLabel(isoDate: string): string {
  if (!DATE_FMT.test(isoDate)) {
    return isoDate;
  }
  const parsedMs = parseIsoToMs(`${isoDate}T00:00:00Z`);
  if (parsedMs === null) {
    return isoDate;
  }
  return new Date(parsedMs).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
export function useWorkspace() {
  const featureFlags = useProductFeatureFlags();
  const {
    loading: accountLoading,
    refreshAccount,
    reportUsage: accountReportUsage,
    syncMultiDayUsage,
    savePreferences: saveAccountPreferences,
    syncGeneratedReportUsage,
    user: accountUser,
  } = useAccount();
  const accountUserId = accountUser?.id;
  const [accountAccessReason, setAccountAccessReason] =
    useState<AccountAccessReason | null>(null);
  const handleMultiDayUsageUpdated = useCallback(
    (usage: MultiDayUsage) => {
      if (usage.tierKey !== "guest" && accountUserId) {
        syncMultiDayUsage(accountUserId, usage);
      }
    },
    [accountUserId, syncMultiDayUsage],
  );
  const handleMultiDayUsageLimitReached = useCallback(
    (usage: MultiDayUsage) => {
      setAccountAccessReason(
        usage.tierKey === "guest"
          ? "guest-multi-day-limit"
          : "account-multi-day-limit",
      );
    },
    [],
  );
  const [guestReportCount, setGuestReportCount] =
    useState(loadGuestReportCount);
  const isProductionBuild = import.meta.env.PROD;
  const todayDate = formatDateInput(new Date());
  const maxForecastDate = formatDateInput(
    new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
  );
  const initialPreferences = React.useMemo(() => loadUserPreferences(), []);
  const initialPersistedReport = React.useMemo(() => loadPersistedReport(), []);
  const parsedInitialLinkState = React.useMemo(
    () => parseLinkState(todayDate, maxForecastDate, initialPreferences),
    [todayDate, maxForecastDate, initialPreferences],
  );
  // Capture account-action tokens before URL synchronization removes query parameters.
  // The account panel is lazy-loaded through SettingsView and may render after cleanup.
  const initialAccountLinkAction = React.useMemo(readAccountLinkAction, []);
  const initialLinkState = React.useMemo(() => {
    if (
      !initialPersistedReport ||
      parsedInitialLinkState.hasObjective ||
      parsedInitialLinkState.sharedReportToken ||
      (parsedInitialLinkState.view !== "home" &&
        parsedInitialLinkState.view !== "planner")
    ) {
      return parsedInitialLinkState;
    }
    const plan = initialPersistedReport.plan;
    return {
      ...parsedInitialLinkState,
      view: "planner" as const,
      position: new L.LatLng(plan.lat, plan.lon),
      hasObjective: true,
      objectiveName: plan.objectiveName,
      searchQuery: plan.searchQuery,
      forecastDate: plan.forecastDate,
      alpineStartTime: plan.alpineStartTime,
      targetElevationInput: plan.targetElevationInput,
      travelWindowHours: plan.travelWindowHours,
    };
  }, [initialPersistedReport, parsedInitialLinkState]);
  const [sharedReportToken, setSharedReportToken] = useState(
    initialLinkState.sharedReportToken,
  );
  const [sharedReportLoading, setSharedReportLoading] = useState(
    Boolean(initialLinkState.sharedReportToken),
  );
  const [sharedReportError, setSharedReportError] = useState<string | null>(
    null,
  );
  const [sharedReportLoadAttempt, setSharedReportLoadAttempt] = useState(0);
  const sharedReportResolvedTokenRef = useRef<string | null>(null);

  const [preferences, setPreferences] = useState<UserPreferences>(() => {
    return {
      ...initialPreferences,
      defaultActivity: initialLinkState.activity,
      ...(initialLinkState.travelWindowHours
        ? { travelWindowHours: initialLinkState.travelWindowHours }
        : {}),
    };
  });
  const preferencesRef = useRef(preferences);
  const preHistoryPreferencesRef = useRef<UserPreferences | null>(null);
  const historyReportPreferencesRef = useRef<UserPreferences | null>(null);
  const accountPreferenceOwnerRef = useRef<string | null>(null);
  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    if (accountLoading) return;
    if (!accountUser) {
      if (accountPreferenceOwnerRef.current) {
        persistUserPreferences(preferencesRef.current);
      }
      accountPreferenceOwnerRef.current = null;
      return;
    }
    if (accountPreferenceOwnerRef.current === accountUser.id) return;

    accountPreferenceOwnerRef.current = accountUser.id;
    if (hasStoredUserPreferences(accountUser.preferences)) {
      const accountPreferences = normalizeUserPreferences(
        accountUser.preferences,
      );
      setPreferences(
        initialLinkState.hasObjective
          ? {
              ...accountPreferences,
              defaultActivity: preferencesRef.current.defaultActivity,
              travelWindowHours: preferencesRef.current.travelWindowHours,
            }
          : accountPreferences,
      );
      return;
    }
    void saveAccountPreferences(preferencesRef.current).catch(() => {
      // The settings screen exposes the sync error and allows an explicit retry.
    });
  }, [
    accountLoading,
    accountUser,
    initialLinkState.hasObjective,
    saveAccountPreferences,
  ]);

  const preferenceSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const scheduleAccountPreferenceSave = useCallback(
    (nextPreferences: UserPreferences) => {
      if (!accountUser) return;
      if (preferenceSyncTimerRef.current)
        clearTimeout(preferenceSyncTimerRef.current);
      preferenceSyncTimerRef.current = setTimeout(() => {
        preferenceSyncTimerRef.current = null;
        void saveAccountPreferences(nextPreferences).catch(() => {
          // The latest values remain in memory and can be retried from Settings.
        });
      }, 500);
    },
    [accountUser, saveAccountPreferences],
  );

  useEffect(
    () => () => {
      if (preferenceSyncTimerRef.current)
        clearTimeout(preferenceSyncTimerRef.current);
    },
    [accountUser?.id],
  );
  const activity: ActivityType = preferences.defaultActivity;
  const [position, setPosition] = useState<L.LatLng>(initialLinkState.position);
  const [hasObjective, setHasObjective] = useState(
    initialLinkState.hasObjective,
  );
  const [objectiveName, setObjectiveName] = useState(
    initialLinkState.objectiveName,
  );
  const objectiveNameRef = useRef(initialLinkState.objectiveName);
  useEffect(() => {
    objectiveNameRef.current = objectiveName;
  }, [objectiveName]);

  const handleNewReportGenerated = useCallback(() => {
    if (!accountUser) {
      setGuestReportCount((currentCount) =>
        incrementGuestReportCount(currentCount),
      );
    }
  }, [accountUser]);

  useEffect(() => {
    const syncGuestReportCount = (event: StorageEvent) => {
      if (event.key === GUEST_REPORT_COUNT_KEY) {
        setGuestReportCount(loadGuestReportCount());
      }
    };
    window.addEventListener("storage", syncGuestReportCount);
    return () => window.removeEventListener("storage", syncGuestReportCount);
  }, []);

  const initialRestoredReport = React.useMemo(() => {
    if (
      !initialPersistedReport ||
      !initialLinkState.hasObjective ||
      initialLinkState.sharedReportToken
    ) {
      return null;
    }
    const travelWindowHours =
      initialLinkState.travelWindowHours ||
      initialPreferences.travelWindowHours;
    return persistedReportMatchesPlan(initialPersistedReport, {
      lat: initialLinkState.position.lat,
      lon: initialLinkState.position.lng,
      forecastDate: initialLinkState.forecastDate,
      alpineStartTime: initialLinkState.alpineStartTime,
      travelWindowHours,
    })
      ? initialPersistedReport
      : null;
  }, [
    initialPersistedReport,
    initialLinkState,
    initialPreferences.travelWindowHours,
  ]);
  const [importedGpxRoute, setImportedGpxRoute] =
    useState<ParsedGpxRoute | null>(
      initialRestoredReport?.route.gpxRoute ?? null,
    );

  // --- Extracted hooks ---
  const {
    healthChecks,
    healthLoading,
    healthCheckedAt,
    healthError,
    backendMeta,
    runHealthChecks,
  } = useHealthChecks();

  const {
    routeSuggestions,
    setRouteSuggestions,
    routeAnalysis,
    routeLoading,
    routeLoadingState,
    routeError,
    setRouteError,
    customRouteName,
    setCustomRouteName,
    fetchRouteSuggestions,
    fetchRouteAnalysis,
    resetRouteState,
    restoreRouteState,
  } = useRouteAnalysis(initialRestoredReport?.route);

  const safetyHook = useSafetyData({
    todayDate,
    preferences,
    isProductionBuild,
    objectiveNameRef,
    onNewReportGenerated: handleNewReportGenerated,
    initialSafetyData: initialRestoredReport?.safetyData,
    initialAiBriefNarrative: initialRestoredReport?.ai.aiBriefNarrative,
    initialSnowVisionAnalysis: initialRestoredReport?.ai.snowVisionAnalysis,
    initialSnowVisionImage: initialRestoredReport?.ai.snowVisionImage,
  });
  const {
    safetyData,
    setSafetyData,
    loading,
    error,
    setError,
    aiBriefNarrative,
    setAiBriefNarrative,
    aiBriefLoading,
    setAiBriefLoading,
    aiBriefError,
    setAiBriefError,
    snowVisionAnalysis,
    snowVisionImage,
    snowVisionLoading,
    snowVisionError,
    setSnowVisionAnalysis,
    setSnowVisionImage,
    setSnowVisionLoading,
    setSnowVisionError,
    handleRequestSnowVision,
    fetchSafetyData,
    clearLastLoadedKey,
    clearWakeRetry,
    handleRequestAiBrief,
  } = safetyHook;
  const [previousSafetyData, setPreviousSafetyData] =
    useState<SafetyData | null>(null);
  const [reportChatMessages, setReportChatMessages] = useState<
    PersistedReportChatMessage[]
  >(initialRestoredReport?.ai.reportChatMessages ?? []);
  const [reportChatSessionKey, setReportChatSessionKey] = useState(0);
  const [viewingHistoryReport, setViewingHistoryReport] = useState(false);
  const [restoredReportSource, setRestoredReportSource] = useState<
    "saved" | "shared" | null
  >(null);
  const savedReportSession = useSavedReportSession({ safetyData, accountLoading, accountUserId });
  const {
    activeSavedReportId, activeSavedReportShareToken, reportGenerationPending,
    setActiveSavedReportId, setActiveSavedReportShareToken, reportSaveIntentRef,
    resetSavedReportTracking, beginSavedReportGeneration,
  } = savedReportSession;
  const beginReportGeneration = useCallback(() => {
    beginSavedReportGeneration();
    setViewingHistoryReport(false);
    setRestoredReportSource(null);
  }, [beginSavedReportGeneration]);
  useEffect(() => {
    if (!safetyData) setPreviousSafetyData(null);
  }, [safetyData]);

  useEffect(() => {
    if (viewingHistoryReport || !preHistoryPreferencesRef.current) return;
    setPreferences(preHistoryPreferencesRef.current);
    preHistoryPreferencesRef.current = null;
    historyReportPreferencesRef.current = null;
  }, [viewingHistoryReport]);

  const coordinateTimezone = useMemo(
    () => resolveObjectiveTimeZone(position.lat, position.lng),
    [position.lat, position.lng],
  );
  const objectiveTimezone = safetyData?.weather.timezone || coordinateTimezone;

  const [forecastDate, setForecastDate] = useState(
    initialLinkState.forecastDate,
  );
  const [alpineStartTime, setAlpineStartTime] = useState(
    initialLinkState.alpineStartTime,
  );
  const [targetElevationInput, setTargetElevationInput] = useState(
    initialLinkState.targetElevationInput,
  );
  const [targetElevationManual, setTargetElevationManual] = useState(
    Boolean(initialLinkState.targetElevationInput),
  );
  const [pastStartPrompt, setPastStartPrompt] =
    useState<PastPlannedStart | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedRawPayload, setCopiedRawPayload] = useState(false);
  const [travelWindowExpanded, setTravelWindowExpanded] = useState(false);
  const [weatherTrendMetric, setWeatherTrendMetric] =
    useState<WeatherTrendMetricKey>("temp");
  const [weatherHourPreviewTime, setWeatherHourPreviewTime] = useState<
    string | null
  >(null);
  const [mapStyle, setMapStyle] = useState<MapStyle>("topo");
  const [mobileMapControlsExpanded, setMobileMapControlsExpanded] = useState(
    () => {
      try {
        const stored = window.localStorage.getItem(
          "summitsafe:mobile-controls-expanded",
        );
        return stored === null ? true : stored === "true";
      } catch {
        return true;
      }
    },
  );
  const collapseMobilePlanControls = useCallback(() => {
    if (
      typeof window === "undefined" ||
      !window.matchMedia("(max-width: 740px)").matches
    ) {
      return;
    }
    setMobileMapControlsExpanded(() => false);
    try {
      window.localStorage.setItem(
        "summitsafe:mobile-controls-expanded",
        "false",
      );
    } catch {
      /* ignore */
    }
  }, []);
  const [mapFocusNonce, setMapFocusNonce] = useState(0);
  const [locatingUser, setLocatingUser] = useState(false);
  const hasInitializedHistoryRef = useRef(false);
  const isApplyingPopStateRef = useRef(false);
  const copyResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rawCopyResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const activeBasemap = MAP_STYLE_OPTIONS[mapStyle];
  const hasVisitedTripRef = useRef(initialLinkState.view === "trip");

  const tripHook = useTripForecast({
    hasObjective,
    position,
    todayDate,
    maxForecastDate,
    initialStartDate: forecastDate,
    initialStartTime: alpineStartTime,
    preferences,
    objectiveName,
    onUsageUpdated: handleMultiDayUsageUpdated,
    onUsageLimitReached: handleMultiDayUsageLimitReached,
  });
  const {
    tripStartDate,
    setTripStartDate,
    tripStartTime,
    setTripStartTime,
    tripDurationDays,
    setTripDurationDays,
    tripForecastRows,
    setTripForecastRows: setTripForecastRowsDirect,
    tripForecastLoading,
    tripForecastError,
    setTripForecastError: setTripForecastErrorDirect,
    tripForecastNote,
    setTripForecastNote: setTripForecastNoteDirect,
    runTripForecast,
  } = tripHook;

  const initializeTripView = useCallback(
    (startDate: string, startTime: string) => {
      if (hasVisitedTripRef.current) {
        return;
      }
      hasVisitedTripRef.current = true;
      setTripStartDate(startDate);
      setTripStartTime(startTime);
    },
    [setTripStartDate, setTripStartTime],
  );

  const updateObjectivePosition = useCallback(
    (nextPosition: L.LatLng, label?: string) => {
      clearWakeRetry();
      resetSavedReportTracking();
      setViewingHistoryReport(false);
      setRestoredReportSource(null);
      setReportChatMessages([]);
      setReportChatSessionKey((value) => value + 1);
      setPosition(nextPosition);
      setMapFocusNonce((prev) => prev + 1);
      setHasObjective(true);
      setTravelWindowExpanded(false);
      setSafetyData(null);
      setError(null);
      setAiBriefNarrative(null);
      setAiBriefLoading(false);
      setAiBriefError(null);
      setSnowVisionAnalysis(null);
      setSnowVisionImage(null);
      setSnowVisionLoading(false);
      setSnowVisionError(null);
      setTargetElevationInput("");
      setTargetElevationManual(false);
      setTripForecastRowsDirect([]);
      setTripForecastErrorDirect(null);
      setTripForecastNoteDirect(null);
      resetRouteState();
      setImportedGpxRoute(null);
      // When no explicit label is supplied (a raw map click/drag, as opposed to a search
      // selection or "use current location"), always relabel as "Dropped pin" rather than
      // silently keeping a stale name (e.g. "Mount Rainier") attached to brand-new coordinates.
      setObjectiveName(label || "Dropped pin");
    },
    [
      clearWakeRetry,
      resetSavedReportTracking,
      setSafetyData,
      setError,
      setAiBriefNarrative,
      setAiBriefLoading,
      setAiBriefError,
      setSnowVisionAnalysis,
      setSnowVisionImage,
      setSnowVisionLoading,
      setSnowVisionError,
      resetRouteState,
      setTripForecastRowsDirect,
      setTripForecastErrorDirect,
      setTripForecastNoteDirect,
    ],
  );

  const searchHook = useSearchSuggestions({
    initialSearchQuery: initialLinkState.searchQuery,
    updateObjectivePosition,
  });
  const {
    searchQuery,
    setSearchQuery: setSearchInputValue,
    committedSearchQuery,
    setCommittedSearchQuery,
    suggestions,
    showSuggestions,
    setShowSuggestions,
    searchLoading,
    activeSuggestionIndex,
    setActiveSuggestionIndex,
    searchInputRef,
    searchWrapperRef,
    selectSuggestion,
    handleInputChange,
    handleSearchKeyDown,
    handleSearchSubmit,
    handleFocus,
    handleSearchClear,
    handleUseTypedCoordinates,
    recordRecentSuggestion,
    parsedTypedCoordinates,
  } = searchHook;
  const objectiveDraftDirty =
    hasObjective &&
    normalizeSuggestionText(searchQuery) !==
      normalizeSuggestionText(committedSearchQuery);

  const handleImportGpxObjective = useCallback(
    (route: ParsedGpxRoute) => {
      if (!featureFlags.gpxImport) return;
      const anchor = route.checkpoints.reduce((closest, checkpoint) =>
        Math.abs(checkpoint.progress_percent - 50) <
        Math.abs(closest.progress_percent - 50)
          ? checkpoint
          : closest,
      );
      const label =
        route.name ||
        route.fileName.replace(/\.gpx$/i, "") ||
        "Imported GPX route";

      updateObjectivePosition(new L.LatLng(anchor.lat, anchor.lon), label);
      setImportedGpxRoute(route);
      setSearchInputValue(label);
      setCommittedSearchQuery(label);
      setShowSuggestions(false);
      setActiveSuggestionIndex(-1);
      if (
        typeof anchor.elev_ft === "number" &&
        Number.isFinite(anchor.elev_ft)
      ) {
        const displayElevation = convertElevationFeetToDisplayValue(
          anchor.elev_ft,
          preferences.elevationUnit,
        );
        setTargetElevationInput(String(Math.round(displayElevation)));
        setTargetElevationManual(true);
      }
      recordRecentSuggestion({
        name: label,
        lat: anchor.lat,
        lon: anchor.lon,
        class: "recent",
        type: "route",
      });
    },
    [
      featureFlags.gpxImport,
      preferences.elevationUnit,
      recordRecentSuggestion,
      setActiveSuggestionIndex,
      setCommittedSearchQuery,
      setSearchInputValue,
      setShowSuggestions,
      updateObjectivePosition,
    ],
  );

  // URL state: view, isViewPending, navigateToView
  const urlState = useUrlState({
    todayDate,
    maxForecastDate,
    preferences,
    initialView: initialLinkState.view as AppView,
    isApplyingPopStateRef,
    onPopState: useCallback(
      (linkState: ReturnType<typeof parseLinkState>) => {
        sharedReportResolvedTokenRef.current = null;
        setSharedReportToken(linkState.sharedReportToken);
        setSharedReportLoading(Boolean(linkState.sharedReportToken));
        setSharedReportError(null);
        if (linkState.sharedReportToken)
          setSharedReportLoadAttempt((attempt) => attempt + 1);
        if (linkState.view === "trip") {
          initializeTripView(linkState.forecastDate, linkState.alpineStartTime);
        }
        // Back/forward within the same plan (e.g. report → Settings → Back) should not
        // throw away the generated report — only a genuinely different plan state resets.
        const sameReport =
          linkState.hasObjective === hasObjective &&
          Math.abs(linkState.position.lat - position.lat) < 1e-6 &&
          Math.abs(linkState.position.lng - position.lng) < 1e-6 &&
          linkState.objectiveName === objectiveName &&
          linkState.forecastDate === forecastDate &&
          linkState.alpineStartTime === alpineStartTime &&
          linkState.targetElevationInput === targetElevationInput &&
          linkState.activity === preferences.defaultActivity &&
          (!linkState.travelWindowHours ||
            linkState.travelWindowHours === preferences.travelWindowHours);
        if (sameReport) {
          setSearchInputValue(linkState.searchQuery);
          setCommittedSearchQuery(linkState.searchQuery);
          setError(null);
          return;
        }
        clearWakeRetry();
        resetSavedReportTracking();
        setViewingHistoryReport(false);
        setRestoredReportSource(null);
        setReportChatMessages([]);
        setReportChatSessionKey((value) => value + 1);
        setSafetyData(null);
        setAiBriefNarrative(null);
        setAiBriefLoading(false);
        setAiBriefError(null);
        setSnowVisionAnalysis(null);
        setSnowVisionImage(null);
        setSnowVisionLoading(false);
        setSnowVisionError(null);
        clearLastLoadedKey();
        setPosition(linkState.position);
        setHasObjective(linkState.hasObjective);
        setObjectiveName(linkState.objectiveName);
        setImportedGpxRoute(null);
        setSearchInputValue(linkState.searchQuery);
        setCommittedSearchQuery(linkState.searchQuery);
        setForecastDate(linkState.forecastDate);
        setAlpineStartTime(linkState.alpineStartTime);
        setTargetElevationInput(linkState.targetElevationInput);
        setTargetElevationManual(Boolean(linkState.targetElevationInput));
        setPreferences((prev) => ({
          ...prev,
          defaultActivity: linkState.activity,
          ...(linkState.travelWindowHours
            ? { travelWindowHours: linkState.travelWindowHours }
            : {}),
        }));
        setError(null);
      },
      [
        clearWakeRetry,
        resetSavedReportTracking,
        setSafetyData,
        setAiBriefNarrative,
        setAiBriefLoading,
        setAiBriefError,
        setSnowVisionAnalysis,
        setSnowVisionImage,
        setSnowVisionLoading,
        setSnowVisionError,
        clearLastLoadedKey,
        setSearchInputValue,
        setCommittedSearchQuery,
        setError,
        initializeTripView,
        hasObjective,
        position,
        objectiveName,
        forecastDate,
        alpineStartTime,
        targetElevationInput,
        preferences.defaultActivity,
        preferences.travelWindowHours,
      ],
    ),
  });
  const { view, isViewPending, navigateToView } = urlState;

  useEffect(() => {
    if (view === "planner") return;
    sharedReportResolvedTokenRef.current = null;
    setSharedReportToken(null);
    setSharedReportLoading(false);
    setSharedReportError(null);
  }, [view]);

  useEffect(() => {
    if (!viewingHistoryReport) return;
    const displayPreferences =
      view === "planner"
        ? historyReportPreferencesRef.current
        : preHistoryPreferencesRef.current;
    if (displayPreferences) setPreferences(displayPreferences);
  }, [view, viewingHistoryReport]);

  useEffect(() => {
    if (!accountUserId || (view !== "settings" && view !== "account")) return;
    void refreshAccount().catch(() => {
      // The existing account details remain visible if the usage refresh is offline.
    });
  }, [accountUserId, refreshAccount, view]);

  const isAdminAccount =
    import.meta.env.DEV ||
    accountUser?.email.trim().toLowerCase() === ADMIN_ACCOUNT_EMAIL;
  const showAdminNotFound =
    view === "admin" && !accountLoading && !isAdminAccount;

  const requestAiAccess = useCallback(() => {
    if (accountUser) return true;
    setAccountAccessReason("ai");
    return false;
  }, [accountUser]);
  const requestReportEmailAccess = useCallback(() => {
    if (accountUser) return true;
    setAccountAccessReason("report-email");
    return false;
  }, [accountUser]);
  const requestNewReportAccess = useCallback(() => {
    if (import.meta.env.DEV) return true;
    if (accountUser) {
      if (!accountReportUsage?.exhausted) return true;
      setAccountAccessReason("account-report-limit");
      return false;
    }
    if (guestReportCount < GUEST_REPORT_LIMIT) return true;
    setAccountAccessReason("guest-report-limit");
    return false;
  }, [accountReportUsage?.exhausted, accountUser, guestReportCount]);
  const aiAccessContextValue = useMemo(
    () => ({ requestAiAccess }),
    [requestAiAccess],
  );
  const closeAccountAccessPrompt = useCallback(
    () => setAccountAccessReason(null),
    [],
  );

  useEffect(() => {
    if (!featureFlags.tripPlanning && view === "trip") {
      navigateToView("planner");
    }
    if (!featureFlags.objectiveWatch && view === "watches") {
      navigateToView("planner");
    }
  }, [
    featureFlags.objectiveWatch,
    featureFlags.tripPlanning,
    navigateToView,
    view,
  ]);

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
    const objectiveElevationDisplay = convertElevationFeetToDisplayValue(
      objectiveElevation,
      preferences.elevationUnit,
    );
    const next = String(Math.round(objectiveElevationDisplay));
    if (targetElevationInput !== next) {
      setTargetElevationInput(next);
    }
  }, [
    hasObjective,
    safetyData,
    targetElevationInput,
    targetElevationManual,
    preferences.elevationUnit,
  ]);

  useEffect(() => {
    if (view === "home") {
      document.title = "Backcountry Conditions";
      return;
    }

    if (view === "settings" || view === "account") {
      document.title = "Settings & Account - Backcountry Conditions";
      return;
    }

    if (view === "history") {
      document.title = "Report History - Backcountry Conditions";
      return;
    }

    if (view === "watches") {
      document.title = "Objective Watches - Backcountry Conditions";
      return;
    }

    if (view === "status") {
      document.title = "Status - Backcountry Conditions";
      return;
    }

    if (view === "trip") {
      document.title = "Multi-Day Trip Tool - Backcountry Conditions";
      return;
    }

    if (view === "privacy") {
      document.title = "Privacy Policy - Backcountry Conditions";
      return;
    }

    if (view === "terms") {
      document.title = "Terms of Use - Backcountry Conditions";
      return;
    }

    if (view === "not-found" || showAdminNotFound) {
      document.title = "Page Not Found - Backcountry Conditions";
      return;
    }

    if (objectiveName) {
      document.title = `${objectiveName} plan - Backcountry Conditions`;
    } else if (committedSearchQuery) {
      document.title = `${committedSearchQuery.split(",")[0]} - Backcountry Conditions`;
    } else {
      document.title = "Backcountry Conditions Planner";
    }
  }, [view, showAdminNotFound, objectiveName, committedSearchQuery]);

  useSyncUrlEffect({
    view,
    activity,
    sharedReportToken,
    hasObjective,
    position,
    objectiveName,
    committedSearchQuery,
    forecastDate: view === "trip" ? tripStartDate : forecastDate,
    alpineStartTime: view === "trip" ? tripStartTime : alpineStartTime,
    targetElevationInput,
    travelWindowHours: Math.max(
      MIN_TRAVEL_WINDOW_HOURS,
      Math.min(
        MAX_TRAVEL_WINDOW_HOURS,
        Math.round(Number(preferences.travelWindowHours) || 12),
      ),
    ),
    isApplyingPopStateRef,
    hasInitializedHistoryRef,
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolvedTheme: "light" | "dark" =
        preferences.themeMode === "system"
          ? mediaQuery.matches
            ? "dark"
            : "light"
          : preferences.themeMode;
      document.documentElement.setAttribute("data-theme", resolvedTheme);
    };

    applyTheme();
    mediaQuery.addEventListener("change", applyTheme);
    return () => {
      mediaQuery.removeEventListener("change", applyTheme);
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
  }, [
    safetyData?.forecast?.selectedDate,
    safetyData?.forecast?.selectedStartTime,
  ]);

  const reportPlan = useMemo(
    () => ({
      lat: position.lat,
      lon: position.lng,
      objectiveName,
      searchQuery: committedSearchQuery,
      forecastDate,
      alpineStartTime,
      targetElevationInput,
      travelWindowHours: Math.max(
        MIN_TRAVEL_WINDOW_HOURS,
        Math.min(
          MAX_TRAVEL_WINDOW_HOURS,
          Math.round(Number(preferences.travelWindowHours) || 12),
        ),
      ),
    }),
    [
      position.lat,
      position.lng,
      objectiveName,
      committedSearchQuery,
      forecastDate,
      alpineStartTime,
      targetElevationInput,
      preferences.travelWindowHours,
    ],
  );

  const reportSnapshot = useMemo(
    () =>
      safetyData
        ? buildPersistedReport(
            reportPlan,
            safetyData,
            {
              aiBriefNarrative,
              snowVisionAnalysis,
              snowVisionImage,
              reportChatMessages,
            },
            {
              preferences,
              route: {
                routeSuggestions,
                routeAnalysis,
                customRouteName,
                gpxRoute: importedGpxRoute,
              },
            },
          )
        : null,
    [
      reportPlan,
      safetyData,
      aiBriefNarrative,
      snowVisionAnalysis,
      snowVisionImage,
      reportChatMessages,
      preferences,
      routeSuggestions,
      routeAnalysis,
      customRouteName,
      importedGpxRoute,
    ],
  );

  useSavedReportSync(savedReportSession, {
    hasObjective, reportSnapshot, safetyData, viewingHistoryReport,
    accountLoading, accountUserId, reportHistoryEnabled: featureFlags.reportHistory,
    syncGeneratedReportUsage, setReportChatMessages, resetRouteState, setReportChatSessionKey,
  });

  const handleRecenterMap = () => {
    setMapFocusNonce((prev) => prev + 1);
  };

  // Direct map interaction (click-to-drop-pin or marker drag) bypasses the search flow, so
  // without this the search box keeps showing the previous query (e.g. "Mount Rainier") while
  // the report silently reloads for a completely different, unrelated location. Mirror the
  // same label + search-box sync that handleUseCurrentLocation already does below, so the
  // change is obvious rather than silent.
  const handleMapPositionChange = useCallback(
    (nextPosition: L.LatLng) => {
      const coordinateLabel = `${nextPosition.lat.toFixed(4)}, ${nextPosition.lng.toFixed(4)}`;
      updateObjectivePosition(nextPosition, "Dropped pin");
      setSearchInputValue(coordinateLabel);
      setCommittedSearchQuery(coordinateLabel);
      setShowSuggestions(false);
      setActiveSuggestionIndex(-1);
    },
    [
      updateObjectivePosition,
      setSearchInputValue,
      setCommittedSearchQuery,
      setShowSuggestions,
      setActiveSuggestionIndex,
    ],
  );

  const handleUseCurrentLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Geolocation is not available in this browser.");
      return;
    }

    setLocatingUser(true);
    navigator.geolocation.getCurrentPosition(
      (result) => {
        const lat = Number(result.coords.latitude);
        const lon = Number(result.coords.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          setError("Current location returned invalid coordinates.");
          setLocatingUser(false);
          return;
        }

        const nextPosition = new L.LatLng(lat, lon);
        updateObjectivePosition(nextPosition, "Current location");
        const coordinateLabel = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        setSearchInputValue(coordinateLabel);
        setCommittedSearchQuery(coordinateLabel);
        setShowSuggestions(false);
        setActiveSuggestionIndex(-1);
        recordRecentSuggestion({
          name: coordinateLabel,
          lat,
          lon,
          class: "recent",
          type: "coordinate",
        });
        setLocatingUser(false);
      },
      (geoError) => {
        const message = geoError?.message
          ? `Unable to read current location: ${geoError.message}`
          : "Unable to read current location.";
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

  const handlePlannerTimeChange =
    (setter: React.Dispatch<React.SetStateAction<string>>) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const handleTargetElevationChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const digitsOnly = e.target.value.replace(/[^\d]/g, "").slice(0, 5);
    setTargetElevationInput(digitsOnly);
    setTargetElevationManual(true);
  };
  const handleTargetElevationStep = (deltaFeet: number) => {
    const parsedDisplayValue =
      parseOptionalElevationInput(targetElevationInput);
    const objectiveElevationFeet = Number(safetyData?.weather.elevation);
    const baseFeet =
      parsedDisplayValue !== null
        ? convertDisplayElevationToFeet(
            parsedDisplayValue,
            preferences.elevationUnit,
          )
        : Number.isFinite(objectiveElevationFeet)
          ? objectiveElevationFeet
          : 0;
    const nextFeet = Math.max(
      0,
      Math.min(20000, Math.round(baseFeet + deltaFeet)),
    );
    const nextDisplayValue = Math.max(
      0,
      Math.round(
        convertElevationFeetToDisplayValue(nextFeet, preferences.elevationUnit),
      ),
    );
    setTargetElevationInput(String(nextDisplayValue));
    setTargetElevationManual(true);
  };

  const handleCopyLink = async () => {
    if (typeof window === "undefined" || !featureFlags.reportSharing) {
      return;
    }

    const shareToken = sharedReportToken || activeSavedReportShareToken;
    const reportSectionId = parseReportSectionHash(window.location.hash);
    const link = shareToken
      ? buildSavedReportShareUrl(
          shareToken,
          window.location.origin,
          reportSectionId,
        )
      : window.location.href;
    try {
      const copied = await copyTextToClipboard(link);
      if (!copied) throw new Error("Clipboard unavailable");
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
    if (!requestAiAccess()) return;
    void handleRequestAiBrief({
      safetyData,
      decisionLevel: decision.level,
    });
  };

  const handleRequestSnowVisionAction = () => {
    if (snowVisionLoading) return;
    if (!requestAiAccess()) return;
    void handleRequestSnowVision(
      position.lat,
      position.lng,
      safetyData?.snowpack,
    );
  };

  const handleFetchRouteSuggestions = useCallback(
    (peak: string, lat: number, lon: number) => {
      if (!requestAiAccess()) return;
      void fetchRouteSuggestions(peak, lat, lon);
    },
    [fetchRouteSuggestions, requestAiAccess],
  );

  const handleFetchRouteAnalysis = useCallback(
    (
      peak: string,
      route: string,
      lat: number,
      lon: number,
      date: string,
      start: string,
      hours: number,
      options?: RouteAnalysisOptions,
    ) => {
      if (!requestAiAccess()) return;
      void fetchRouteAnalysis(
        peak,
        route,
        lat,
        lon,
        date,
        start,
        hours,
        {
          temperature: preferences.temperatureUnit,
          wind: preferences.windSpeedUnit,
          elevation: preferences.elevationUnit,
        },
        options,
      );
    },
    [
      fetchRouteAnalysis,
      preferences.temperatureUnit,
      preferences.windSpeedUnit,
      preferences.elevationUnit,
      requestAiAccess,
    ],
  );

  const handleCopyRawPayload = async () => {
    if (
      !rawReportPayload ||
      typeof navigator === "undefined" ||
      !navigator.clipboard
    ) {
      return;
    }
    try {
      await navigator.clipboard.writeText(rawReportPayload);
      setCopiedRawPayload(true);
      if (rawCopyResetTimeout.current) {
        clearTimeout(rawCopyResetTimeout.current);
      }
      rawCopyResetTimeout.current = setTimeout(
        () => setCopiedRawPayload(false),
        1500,
      );
    } catch {
      setCopiedRawPayload(false);
    }
  };

  const { handleRetryFetch, handleGenerateReport, pendingAutoGenerate, setPendingAutoGenerate } = useReportGeneration({
    autoGenerateInitially: initialLinkState.hasObjective && !initialRestoredReport,
    hasObjective, forecastDate, alpineStartTime, objectiveTimezone,
    accountLoading, view, position, safetyData, requestNewReportAccess, beginReportGeneration,
    collapseMobilePlanControls, fetchSafetyData, setPreviousSafetyData, setPastStartPrompt,
  });

  const handleEditPlan = useCallback(() => {
    if (!requestNewReportAccess()) {
      return false;
    }
    clearPersistedReport();
    sharedReportResolvedTokenRef.current = null;
    setSharedReportToken(null);
    setSharedReportLoading(false);
    setSharedReportError(null);
    resetSavedReportTracking();
    setViewingHistoryReport(false);
    setRestoredReportSource(null);
    setReportChatMessages([]);
    setReportChatSessionKey((value) => value + 1);
    setSafetyData(null);
    setPreviousSafetyData(null);
    setError(null);
    setAiBriefNarrative(null);
    setAiBriefLoading(false);
    setAiBriefError(null);
    setSnowVisionAnalysis(null);
    setSnowVisionImage(null);
    setSnowVisionLoading(false);
    setSnowVisionError(null);
    resetRouteState();
    return true;
  }, [
    resetSavedReportTracking,
    setSafetyData,
    setError,
    setAiBriefNarrative,
    setAiBriefLoading,
    setAiBriefError,
    setSnowVisionAnalysis,
    setSnowVisionImage,
    setSnowVisionLoading,
    setSnowVisionError,
    resetRouteState,
    requestNewReportAccess,
  ]);

  const handleOpenSavedReport = useCallback(
    (
      report: PersistedReport,
      shareToken: string,
      source: "saved" | "shared" = "saved",
    ) => {
      clearWakeRetry();
      clearLastLoadedKey();
      resetSavedReportTracking();
      setPendingAutoGenerate(false);
      setViewingHistoryReport(true);
      setRestoredReportSource(source);
      sharedReportResolvedTokenRef.current = shareToken;
      setSharedReportToken(shareToken);
      setSharedReportLoading(false);
      setSharedReportError(null);
      if (!preHistoryPreferencesRef.current) {
        preHistoryPreferencesRef.current = preferencesRef.current;
      }
      const reportPreferences = {
        ...(report.preferences || preferencesRef.current),
        travelWindowHours: report.plan.travelWindowHours,
      };
      historyReportPreferencesRef.current = reportPreferences;
      setPreferences(reportPreferences);

      setPosition(new L.LatLng(report.plan.lat, report.plan.lon));
      setMapFocusNonce((value) => value + 1);
      setHasObjective(true);
      setObjectiveName(report.plan.objectiveName);
      setSearchInputValue(report.plan.searchQuery || report.plan.objectiveName);
      setCommittedSearchQuery(
        report.plan.searchQuery || report.plan.objectiveName,
      );
      setForecastDate(report.plan.forecastDate);
      setAlpineStartTime(report.plan.alpineStartTime);
      setTargetElevationInput(report.plan.targetElevationInput);
      setTargetElevationManual(Boolean(report.plan.targetElevationInput));
      setImportedGpxRoute(report.route.gpxRoute);
      setPastStartPrompt(null);
      setPreviousSafetyData(null);
      setError(null);
      setSafetyData(report.safetyData);

      setAiBriefNarrative(report.ai.aiBriefNarrative);
      setAiBriefLoading(false);
      setAiBriefError(null);
      setSnowVisionAnalysis(report.ai.snowVisionAnalysis);
      setSnowVisionImage(report.ai.snowVisionImage);
      setSnowVisionLoading(false);
      setSnowVisionError(null);
      setReportChatMessages(report.ai.reportChatMessages);
      setReportChatSessionKey((value) => value + 1);
      restoreRouteState(report.route);

      navigateToView("planner");
    },
    [
      setPendingAutoGenerate,
      clearLastLoadedKey,
      clearWakeRetry,
      resetSavedReportTracking,
      restoreRouteState,
      setAiBriefError,
      setAiBriefLoading,
      setAiBriefNarrative,
      setCommittedSearchQuery,
      setError,
      setSafetyData,
      setSearchInputValue,
      setSnowVisionAnalysis,
      setSnowVisionError,
      setSnowVisionImage,
      setSnowVisionLoading,
      navigateToView,
    ],
  );

  useEffect(() => {
    if (
      !sharedReportToken ||
      sharedReportResolvedTokenRef.current === sharedReportToken
    )
      return;
    const controller = new AbortController();
    setSharedReportLoading(true);
    setSharedReportError(null);
    void getSharedReport(sharedReportToken, controller.signal)
      .then((rawReport) => {
        if (controller.signal.aborted) return;
        const report = parsePersistedReport(rawReport);
        if (!report)
          throw new Error(
            "This shared report is incomplete or no longer compatible.",
          );
        handleOpenSavedReport(report, sharedReportToken, "shared");
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        setSharedReportLoading(false);
        setSharedReportError(
          loadError instanceof Error
            ? loadError.message
            : "Could not retrieve this shared report.",
        );
      });
    return () => controller.abort();
  }, [handleOpenSavedReport, sharedReportLoadAttempt, sharedReportToken]);

  const retrySharedReport = useCallback(() => {
    sharedReportResolvedTokenRef.current = null;
    setSharedReportError(null);
    setSharedReportLoading(true);
    setSharedReportLoadAttempt((attempt) => attempt + 1);
  }, []);

  const openPlannerView = () => {
    if (!hasObjective && !searchQuery.trim()) {
      setAlpineStartTime(preferences.defaultStartTime);
    }
    navigateToView("planner");
  };

  const openBlankPlannerFromSharedReport = () => {
    sharedReportResolvedTokenRef.current = null;
    setSharedReportToken(null);
    setSharedReportLoading(false);
    setSharedReportError(null);
    setViewingHistoryReport(false);
    setRestoredReportSource(null);
    openPlannerView();
  };

  const openTripToolView = () => {
    if (!featureFlags.tripPlanning) {
      openPlannerView();
      return;
    }
    initializeTripView(forecastDate, alpineStartTime);
    navigateToView("trip");
  };

  const handleUseTripDayInPlanner = useCallback(
    (date: string, startTime: string) => {
      const selectedDay = tripForecastRows.find((day) => day.date === date);
      if (
        selectedDay &&
        forecastDate === date &&
        safetyData === selectedDay.safetyData
      ) {
        navigateToView("planner");
        return;
      }

      clearWakeRetry();
      clearLastLoadedKey();
      clearPersistedReport();
      sharedReportResolvedTokenRef.current = null;
      setSharedReportToken(null);
      setSharedReportLoading(false);
      setSharedReportError(null);
      resetSavedReportTracking();
      setPendingAutoGenerate(false);
      setViewingHistoryReport(false);
      setReportChatMessages([]);
      setReportChatSessionKey((value) => value + 1);
      setForecastDate(date);
      setAlpineStartTime(startTime);
      setSafetyData(selectedDay?.safetyData ?? null);
      setPreviousSafetyData(null);
      setPastStartPrompt(null);
      setError(null);
      setAiBriefNarrative(null);
      setAiBriefLoading(false);
      setAiBriefError(null);
      setSnowVisionAnalysis(null);
      setSnowVisionImage(null);
      setSnowVisionLoading(false);
      setSnowVisionError(null);
      resetRouteState();
      navigateToView("planner");
    },
    [
      setPendingAutoGenerate,
      clearLastLoadedKey,
      clearWakeRetry,
      forecastDate,
      resetRouteState,
      resetSavedReportTracking,
      safetyData,
      setAiBriefError,
      setAiBriefLoading,
      setAiBriefNarrative,
      setError,
      setSafetyData,
      setSnowVisionAnalysis,
      setSnowVisionError,
      setSnowVisionImage,
      setSnowVisionLoading,
      navigateToView,
      tripForecastRows,
    ],
  );

  const handleSelectMultiDayForecastDay = useCallback(
    (date: string) => {
      handleUseTripDayInPlanner(date, tripStartTime);
    },
    [handleUseTripDayInPlanner, tripStartTime],
  );

  const handleOpenObjectiveWatch = useCallback(
    (plan: PersistedReportPlan) => {
      sharedReportResolvedTokenRef.current = null;
      setSharedReportToken(null);
      setSharedReportLoading(false);
      setSharedReportError(null);
      clearLastLoadedKey();
      setPendingAutoGenerate(false);
      setPreviousSafetyData(null);
      setPastStartPrompt(null);
      updateObjectivePosition(
        new L.LatLng(plan.lat, plan.lon),
        plan.objectiveName || "Watched objective",
      );
      const searchLabel =
        plan.searchQuery || plan.objectiveName || "Watched objective";
      setSearchInputValue(searchLabel);
      setCommittedSearchQuery(searchLabel);
      setShowSuggestions(false);
      setActiveSuggestionIndex(-1);
      setForecastDate(plan.forecastDate);
      setAlpineStartTime(plan.alpineStartTime);
      setTargetElevationInput(plan.targetElevationInput);
      setTargetElevationManual(Boolean(plan.targetElevationInput));
      setPreferences((current) => ({
        ...current,
        travelWindowHours: plan.travelWindowHours,
      }));
      navigateToView("planner");
    },
    [
      setPendingAutoGenerate,
      clearLastLoadedKey,
      setActiveSuggestionIndex,
      setCommittedSearchQuery,
      setSearchInputValue,
      setShowSuggestions,
      navigateToView,
      updateObjectivePosition,
    ],
  );
  const appShellClassName = `app-container page-shell page-shell-${view}${isViewPending ? " is-nav-pending" : ""}`;
  const liveSearchQuery = searchQuery;
  const trimmedSearchQuery = liveSearchQuery.trim();

  const getScoreColor = (score: number, tier?: string) => {
    const effectiveTier =
      tier ||
      (score >= 85
        ? "Low"
        : score >= 70
          ? "Caution"
          : score >= 55
            ? "Elevated"
            : score >= 40
              ? "High"
              : "Extreme");
    switch (effectiveTier) {
      case "Low":
        return "var(--accent-green)";
      case "Caution":
        return "var(--accent-teal)";
      case "Elevated":
        return "var(--accent-yellow)";
      case "High":
        return "var(--accent-orange)";
      case "Extreme":
        return "var(--accent-red)";
      default:
        return "var(--accent-yellow)";
    }
  };

  const getDangerText = (lvl: number) => {
    const levels = [
      "No Rating",
      "Low",
      "Moderate",
      "Considerable",
      "High",
      "Extreme",
    ];
    return levels[lvl] || "N/A";
  };
  const getDangerGlyph = (lvl: number) => {
    if (lvl >= 5) return "!!";
    if (lvl >= 4) return "X";
    if (lvl >= 3) return "!";
    if (lvl >= 2) return "•";
    return "✓";
  };

  const useHour12Clock = preferences.timeStyle !== "24h";

  const formatPubTime = (isoString?: string) => {
    if (!isoString) {
      return "Not available";
    }

    const parsedMs = parseIsoToMs(isoString);
    if (parsedMs === null) {
      return isoString;
    }
    const date = new Date(parsedMs);
    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      day: "numeric",
      hour12: useHour12Clock,
    });
  };

  const formatForecastPeriodLabel = (
    isoString?: string | null,
    timeZone?: string | null,
  ) => {
    if (!isoString) {
      return "Not available";
    }
    const parsedMs = parseIsoToMs(isoString);
    if (parsedMs === null) {
      return isoString;
    }
    const date = new Date(parsedMs);
    const baseOptions: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
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

  const formatGeneratedAt = (isoString: string | null) => {
    const parsedMs = isoString ? parseIsoToMs(isoString) : null;
    if (parsedMs === null) {
      return "time unavailable";
    }
    return new Date(parsedMs).toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: useHour12Clock,
    });
  };

  const formatTempDisplay = (
    value: number | null | undefined,
    options?: { includeUnit?: boolean; precision?: number },
  ) => formatTemperatureForUnit(value, preferences.temperatureUnit, options);
  const formatWindDisplay = (
    value: number | null | undefined,
    options?: { includeUnit?: boolean; precision?: number },
  ) => formatWindForUnit(value, preferences.windSpeedUnit, options);
  const formatElevationDisplay = (
    value: number | null | undefined,
    options?: { includeUnit?: boolean; precision?: number },
  ) => formatElevationForUnit(value, preferences.elevationUnit, options);
  const formatElevationDeltaDisplay = (value: number | null | undefined) =>
    formatElevationDeltaForUnit(value, preferences.elevationUnit);
  const formatDistanceDisplay = (miles: number | null | undefined) =>
    formatDistanceForElevationUnit(
      Number.isFinite(Number(miles)) ? Number(miles) * KM_PER_MILE : null,
      preferences.elevationUnit,
    );
  const localizeUnitText = (text: string): string =>
    text
      .replace(
        /SWE\s*~?\s*(-?\d+(?:\.\d+)?)\s?in\b/gi,
        (_, value) =>
          `SWE ~${formatSweForElevationUnit(Number(value), preferences.elevationUnit).replace(/\s*SWE$/i, "")}`,
      )
      .replace(
        /depth\s*~?\s*(-?\d+(?:\.\d+)?)\s?in\b/gi,
        (_, value) =>
          `depth ~${formatSnowDepthForElevationUnit(Number(value), preferences.elevationUnit)}`,
      )
      .replace(/(-?\d+(?:\.\d+)?)\s?km\b/gi, (_, value) =>
        formatDistanceForElevationUnit(
          Number(value),
          preferences.elevationUnit,
        ),
      )
      .replace(/(-?\d+(?:\.\d+)?)\s?ft\b/gi, (_, value) =>
        formatElevationDisplay(Number(value)),
      )
      .replace(/(-?\d+(?:\.\d+)?)\s?mph\b/gi, (_, value) =>
        formatWindDisplay(Number(value)),
      )
      .replace(/(-?\d+(?:\.\d+)?)F\b/g, (_, value) =>
        formatTempDisplay(Number(value)),
      );

  const cutoffMinutes = parseTimeInputMinutes(alpineStartTime);
  const displayStartTime = formatClockForStyle(
    alpineStartTime,
    preferences.timeStyle,
  );
  const displayDefaultStartTime = formatClockForStyle(
    preferences.defaultStartTime,
    preferences.timeStyle,
  );
  const travelWindowHours = Math.max(
    MIN_TRAVEL_WINDOW_HOURS,
    Math.min(
      MAX_TRAVEL_WINDOW_HOURS,
      Math.round(Number(preferences.travelWindowHours) || 12),
    ),
  );

  const prefHandlers = usePreferenceHandlers({
    preferences,
    setPreferences,
    travelWindowHours,
    targetElevationInput,
    setTargetElevationInput,
    onApplyToPlanner: useCallback(() => {
      setAlpineStartTime(preferences.defaultStartTime);
      navigateToView("planner");
    }, [navigateToView, preferences.defaultStartTime]),
    persistLocally: !accountUser,
    onPreferencesChange: accountUser
      ? scheduleAccountPreferenceSave
      : undefined,
  });
  const {
    updatePreferences,
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
    maxFeelsLikeDraft,
    heatCeilingMin,
    heatCeilingMax,
    handleHeatCeilingDisplayChange,
    handleHeatCeilingDisplayBlur,
    handleApplyTravelThresholdPreset,
    applyPreferencesToPlanner,
    resetPreferences,
    travelThresholdEditorOpen,
    setTravelThresholdEditorOpen,
  } = prefHandlers;

  const gpxEstimatedDurationHours = React.useMemo(
    () =>
      importedGpxRoute
        ? estimateRouteDurationHours(importedGpxRoute, {
            paceMinutesPerMile: preferences.runnerPaceMinutesPerMile,
            ascentMinutesPer1000Ft: preferences.runnerAscentMinutesPer1000Ft,
            stopBufferMinutes: preferences.runnerStopBufferMinutes,
          })
        : null,
    [
      importedGpxRoute,
      preferences.runnerPaceMinutesPerMile,
      preferences.runnerAscentMinutesPer1000Ft,
      preferences.runnerStopBufferMinutes,
    ],
  );

  const returnMinutes =
    cutoffMinutes !== null ? cutoffMinutes + travelWindowHours * 60 : null;
  const returnExtendsPastMidnight =
    returnMinutes !== null && returnMinutes > 1439;
  const returnTimeFormatted =
    returnMinutes !== null
      ? minutesToTwentyFourHourClock(Math.min(returnMinutes, 1439))
      : null;
  // True clock time for display; the clamped value above feeds same-day decision logic.
  const returnTimeDisplay =
    returnMinutes !== null
      ? minutesToTwentyFourHourClock(returnMinutes % 1440)
      : null;
  let decision = safetyData
    ? evaluateBackcountryDecision(safetyData, alpineStartTime, preferences, {
        turnaroundTime: returnTimeFormatted ?? undefined,
      })
    : null;

  const { dayOverDay, startTimeScenarios } = useReportComparisons({
    hasObjective, view, safetyData, forecastDate, currentStartTime: alpineStartTime,
    position: { lat: position.lat, lng: position.lng }, preferences,
    viewingHistoryReport, loading: loading || reportGenerationPending,
    startTimeComparisonsEnabled: featureFlags.startTimeComparisons,
  });

  const decisionDisplay = buildDecisionDisplayState(decision);
  const {
    orderedCriticalChecks,
    topCriticalAttentionChecks,
    criticalCheckFailCount,
    criticalCheckTotal,
    fieldBriefPrimaryReason,
    fieldBriefTopRisks,
    decisionFailingChecks,
    decisionPassingChecksCount,
    decisionActionLine,
    decisionKeyDrivers,
  } = decisionDisplay;
  const startLabel = "Start time";
  const avalancheDisplay = buildAvalancheDisplayState(
    safetyData,
    localizeUnitText,
  );
  const {
    relevant: avalancheRelevant,
    expiredForSelectedStart: avalancheExpiredForSelectedStart,
    unknown: avalancheUnknown,
    overallLevel: overallAvalancheLevel,
    notApplicableReason: avalancheNotApplicableReason,
    elevationRows: avalancheElevationRows,
  } = avalancheDisplay;
  const elevationForecastBands = safetyData?.weather.elevationForecast || [];
  // trendWindow/criticalWindow/travelWindowRows feed several report cards in
  // PlannerView/RedesignView (both wrapped in React.memo) as direct array
  // props; each row does nontrivial per-hour work (assessCriticalWindowPoint,
  // threshold checks + string formatting in buildTravelWindowRows), so these
  // are memoized to keep stable references across unrelated re-renders and
  // avoid redoing that work every render.
  const trendWindow = useMemo(
    () =>
      safetyData
        ? buildTrendWindowFromStart(
            safetyData.weather.trend || [],
            alpineStartTime,
            travelWindowHours,
          )
        : [],
    [safetyData, alpineStartTime, travelWindowHours],
  );
  const criticalWindow = useMemo(
    () =>
      safetyData
        ? trendWindow.map((point) => {
            const assessment = assessCriticalWindowPoint(point);
            return {
              ...point,
              ...assessment,
            };
          })
        : [],
    [safetyData, trendWindow],
  );
  const travelWindowContext = useMemo(
    () =>
      safetyData
        ? {
            snowDepthIn:
              safetyData.terrainCondition?.signals?.maxSnowDepthIn ??
              safetyData.snowpack?.snotel?.snowDepthIn ??
              safetyData.snowpack?.nohrsc?.snowDepthIn ??
              null,
          }
        : undefined,
    [safetyData],
  );
  const travelWindowRows = useMemo(
    () =>
      safetyData
        ? buildTravelWindowRows(trendWindow, preferences, travelWindowContext)
        : [],
    [safetyData, trendWindow, preferences, travelWindowContext],
  );
  const travelWindowInsights = buildTravelWindowInsights(
    travelWindowRows,
    preferences.timeStyle,
  );
  const travelWindowSummary = travelWindowInsights.summary;
  const peakCriticalWindowIndex = criticalWindow.length
    ? criticalWindow.reduce(
        (bestIndex, current, idx, rows) =>
          current.score > rows[bestIndex].score ? idx : bestIndex,
        0,
      )
    : -1;
  const peakCriticalWindow =
    peakCriticalWindowIndex >= 0
      ? criticalWindow[peakCriticalWindowIndex]
      : null;
  const visibleCriticalWindowRows = useMemo(
    () => (travelWindowExpanded ? criticalWindow : []),
    [travelWindowExpanded, criticalWindow],
  );
  const parsedTargetElevation =
    parseOptionalElevationInput(targetElevationInput);
  const targetElevationFt =
    parsedTargetElevation === null
      ? Number.NaN
      : convertDisplayElevationToFeet(
          parsedTargetElevation,
          preferences.elevationUnit,
        );
  const hasTargetElevation =
    Number.isFinite(targetElevationFt) && targetElevationFt >= 0;
  const objectiveElevationFt = Number(safetyData?.weather.elevation);
  const baseTargetElevationFeet = hasTargetElevation
    ? targetElevationFt
    : Number.isFinite(objectiveElevationFt) && objectiveElevationFt >= 0
      ? objectiveElevationFt
      : 0;
  const canDecreaseTargetElevation = baseTargetElevationFeet > 0;
  const windThresholdDisplay = formatWindDisplay(preferences.maxWindGustMph);
  const feelsLikeThresholdDisplay = formatTempDisplay(
    preferences.minFeelsLikeF,
  );
  const heatCeilingDisplay = formatTempDisplay(preferences.maxFeelsLikeF);
  const formatPresetWindDisplay = (valueMph: number) =>
    formatWindDisplay(valueMph);
  const activeTravelThresholdPreset = (Object.entries(
    TRAVEL_THRESHOLD_PRESETS,
  ).find(([, preset]) => {
    return (
      Math.abs(preferences.maxWindGustMph - preset.maxWindGustMph) <= 0.01 &&
      preferences.maxPrecipChance === preset.maxPrecipChance &&
      Math.abs(preferences.minFeelsLikeF - preset.minFeelsLikeF) <= 0.01 &&
      Math.abs(preferences.maxFeelsLikeF - preset.maxFeelsLikeF) <= 0.01
    );
  })?.[0] || null) as TravelThresholdPresetKey | null;
  const travelWindowHoursLabel = `${travelWindowHours}h`;
  const windUnitLabel = preferences.windSpeedUnit;
  const tempUnitLabel = preferences.temperatureUnit.toUpperCase();
  const elevationUnitLabel = preferences.elevationUnit;
  const weatherTrendMetricOptions = buildWeatherTrendMetricOptions(
    tempUnitLabel,
    windUnitLabel,
  );
  const weatherTrendRows = buildWeatherTrendRows(
    trendWindow,
    preferences.timeStyle,
  );
  const weatherTrendChartData = buildWeatherTrendChartData(
    weatherTrendRows,
    weatherTrendMetric,
  );
  const weatherTrendHasData = weatherTrendChartData.some(
    (row) => row.value !== null && Number.isFinite(row.value),
  );
  const weatherTrendMetricLabel =
    WEATHER_TREND_METRIC_LABELS[weatherTrendMetric];
  const weatherTrendTickFormatter = (value: number) => {
    if (!Number.isFinite(value)) return "";
    if (
      weatherTrendMetric === "temp" ||
      weatherTrendMetric === "feelsLike" ||
      weatherTrendMetric === "dewPoint"
    )
      return formatTempDisplay(value, { includeUnit: false });
    if (weatherTrendMetric === "wind" || weatherTrendMetric === "gust")
      return formatWindDisplay(value, { includeUnit: false });
    if (weatherTrendMetric === "pressure") return `${Number(value).toFixed(0)}`;
    if (
      weatherTrendMetric === "precipChance" ||
      weatherTrendMetric === "humidity" ||
      weatherTrendMetric === "cloudCover"
    )
      return `${Math.round(value)}%`;
    if (weatherTrendMetric === "windDirection") return `${Math.round(value)}°`;
    return String(Math.round(value));
  };
  const formatWeatherTrendValue = (
    value: number | null | undefined,
    directionLabel?: string | null,
  ): string => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "N/A";
    if (
      weatherTrendMetric === "temp" ||
      weatherTrendMetric === "feelsLike" ||
      weatherTrendMetric === "dewPoint"
    )
      return formatTempDisplay(numeric);
    if (weatherTrendMetric === "wind" || weatherTrendMetric === "gust")
      return formatWindDisplay(numeric);
    if (weatherTrendMetric === "pressure") return `${numeric.toFixed(1)} hPa`;
    if (
      weatherTrendMetric === "precipChance" ||
      weatherTrendMetric === "humidity" ||
      weatherTrendMetric === "cloudCover"
    )
      return `${Math.round(numeric)}%`;
    if (weatherTrendMetric === "windDirection") {
      const cardinal = directionLabel || windDirectionFromDegrees(numeric);
      return `${cardinal} (${Math.round(numeric)}°)`;
    }
    return String(Math.round(numeric));
  };
  const weatherTrendYAxisDomain =
    getWeatherTrendYAxisDomain(weatherTrendMetric);
  const weatherTrendLineColor = getWeatherTrendLineColor(weatherTrendMetric);
  const weatherPressureTrend = buildPressureTrend(
    weatherTrendRows,
    travelWindowHoursLabel,
  );
  const weatherPressureTrendSummary = weatherPressureTrend?.summary ?? null;
  const pressureTrendDirection = weatherPressureTrend?.direction ?? null;
  const pressureDeltaLabel = weatherPressureTrend?.deltaLabel ?? null;
  const pressureRangeLabel = weatherPressureTrend?.rangeLabel ?? null;
  const weatherTrendTempRange = buildWeatherTrendTempRange(weatherTrendRows);
  useEffect(() => {
    setWeatherHourPreviewTime(null);
  }, [alpineStartTime, forecastDate, objectiveName]);
  const targetElevationForecast =
    safetyData &&
    hasTargetElevation &&
    Number.isFinite(Number(safetyData.weather.elevation))
      ? (() => {
          const baseElevationFt = Number(safetyData.weather.elevation);
          const deltaKft = (targetElevationFt - baseElevationFt) / 1000;
          const temp = Math.round(
            safetyData.weather.temp - deltaKft * TEMP_LAPSE_F_PER_1000FT,
          );
          const windSpeed = Math.max(
            0,
            Math.round(
              safetyData.weather.windSpeed +
                deltaKft * WIND_INCREASE_MPH_PER_1000FT,
            ),
          );
          const windGust = Math.max(
            windSpeed,
            Math.round(
              safetyData.weather.windGust +
                deltaKft * GUST_INCREASE_MPH_PER_1000FT,
            ),
          );
          const feelsLike = computeFeelsLikeF(temp, windSpeed);
          return {
            temp,
            feelsLike,
            windSpeed,
            windGust,
            deltaFt: Math.round(targetElevationFt - baseElevationFt),
          };
        })()
      : null;
  const rainfallPayload = React.useMemo(() => {
    if (!safetyData) {
      return null;
    }
    if (safetyData.rainfall && typeof safetyData.rainfall === "object") {
      return safetyData.rainfall;
    }
    const legacy = (
      safetyData as SafetyData & { rainfallData?: SafetyData["rainfall"] }
    ).rainfallData;
    return legacy && typeof legacy === "object" ? legacy : null;
  }, [safetyData]);
  const rawReportPayload = React.useMemo(
    () =>
      safetyData
        ? stringifyRawPayload({
            objective: {
              name: objectiveName || "Pinned Objective",
              activity,
              coordinates: {
                lat: Number(position.lat.toFixed(5)),
                lon: Number(position.lng.toFixed(5)),
              },
              forecastDate: safetyData.forecast?.selectedDate || forecastDate,
              startTime: alpineStartTime,
              backByTime: returnTimeFormatted,
              targetElevationFt: hasTargetElevation
                ? Math.round(targetElevationFt)
                : null,
            },
            forecast: safetyData.forecast || null,
            featureFlags: safetyData.featureFlags || null,
            weather: safetyData.weather,
            ...(safetyData.solar ? { solar: safetyData.solar } : {}),
            ...(safetyData.avalanche
              ? { avalanche: safetyData.avalanche }
              : {}),
            alerts: safetyData.alerts || null,
            ...(safetyData.airQuality
              ? { airQuality: safetyData.airQuality }
              : {}),
            rainfall: rainfallPayload || null,
            ...(safetyData.snowpack ? { snowpack: safetyData.snowpack } : {}),
            ...(safetyData.fireRisk ? { fireRisk: safetyData.fireRisk } : {}),
            ...(safetyData.heatRisk ? { heatRisk: safetyData.heatRisk } : {}),
            pleasantness: safetyData.pleasantness || null,
            safety: safetyData.safety,
            decision,
          })
        : "",
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
  const deepDiveShareLink =
    typeof window !== "undefined" ? window.location.href : "";
  const safeShareLink = sanitizeExternalUrl(deepDiveShareLink);
  const safeWeatherLink = sanitizeExternalUrl(safetyData?.weather.forecastLink);
  const weatherLinkHostLabel = (() => {
    if (!safeWeatherLink) {
      return null;
    }
    try {
      const host = new URL(safeWeatherLink).hostname
        .toLowerCase()
        .replace(/^www\./, "");
      if (host.includes("weather.gov")) {
        return "WEATHER.GOV";
      }
      if (host.includes("open-meteo.com")) {
        return "OPEN-METEO";
      }
      return host.toUpperCase();
    } catch {
      return null;
    }
  })();
  const weatherLinkCta = weatherLinkHostLabel
    ? `View full weather forecast at ${weatherLinkHostLabel} →`
    : "View full weather forecast source →";
  const safeAvalancheLink = sanitizeExternalUrl(safetyData?.avalanche?.link);
  const safeRainfallLink = sanitizeExternalUrl(
    rainfallPayload?.link || undefined,
  );
  const safeSnotelLink = sanitizeExternalUrl(
    safetyData?.snowpack?.snotel?.link || undefined,
  );
  const safeNohrscLink = sanitizeExternalUrl(
    safetyData?.snowpack?.nohrsc?.link || undefined,
  );
  const safeCdecLink = sanitizeExternalUrl(
    safetyData?.snowpack?.cdec?.link || undefined,
  );
  const rainfallDisplay = buildRainfallDisplay(
    rainfallPayload,
    preferences,
    travelWindowHours,
  );
  const {
    rainfall12hIn,
    rainfall24hIn,
    rainfall48hIn,
    snowfall12hIn,
    snowfall24hIn,
    snowfall48hIn,
    rainfall24hSeverityClass,
    rainfallWindowSummary,
    snowfallWindowSummary,
    rainfall12hDisplay,
    rainfall24hDisplay,
    rainfall48hDisplay,
    snowfall12hDisplay,
    snowfall24hDisplay,
    snowfall48hDisplay,
    expectedTravelWindowHours,
    expectedRainWindowDisplay,
    expectedSnowWindowDisplay,
    expectedPrecipSummaryLine,
    rainfallModeLabel,
    rainfallNoteLine,
    expectedPrecipNoteLine,
    precipInsightLine,
    rainfallExpected,
    expectedSnowWindowIn,
  } = rainfallDisplay;
  const snowpackInterpretation = safetyData
    ? buildSnowpackInterpretation(
        safetyData.snowpack,
        Number(safetyData.weather?.elevation),
        preferences.elevationUnit,
      )
    : null;
  const snowpackInsights = safetyData
    ? buildSnowpackInsights(
        safetyData.snowpack,
        Number(safetyData.weather?.elevation),
        preferences.elevationUnit,
      )
    : null;
  const snowpackDisplay = buildSnowpackDisplayState(
    safetyData,
    formatSweForElevationUnit,
    formatSnowDepthForElevationUnit,
    formatDistanceForElevationUnit,
    formatForecastPeriodLabel,
    formatIsoDateLabel,
    preferences.elevationUnit,
    snowpackInsights,
    snowfall24hIn,
    snowfall24hDisplay,
    rainfall24hIn,
    rainfall24hDisplay,
  );
  const {
    bestDepthDisplay: snowpackBestDepthDisplay,
    bestDepthSource: snowpackBestDepthSource,
    depthConflict: snowpackDepthConflict,
    depthRangeDisplay: snowpackDepthRangeDisplay,
    depthConflictCaption: snowpackDepthConflictCaption,
    bestSweDisplay: snowpackBestSweDisplay,
    bestSweSource: snowpackBestSweSource,
    snotelSweDisplay,
    snotelDepthDisplay,
    nohrscSweDisplay,
    nohrscDepthDisplay,
    cdecSweDisplay,
    cdecDepthDisplay,
    cdecDistanceDisplay,
    snotelDistanceDisplay,
    pillClass: snowpackPillClass,
    statusLabel: snowpackStatusLabel,
    historicalPillClass: snowpackHistoricalPillClass,
    historicalStatusLabel: snowpackHistoricalStatusLabel,
    historicalComparisonLine: snowpackHistoricalComparisonLine,
    takeaways: snowpackTakeaways,
    observationContext: snowpackObservationContext,
    depthSignalValues: snowpackDepthSignalValues,
    sweSignalValues: snowpackSweSignalValues,
    hasSignal: hasSnowpackSignal,
  } = snowpackDisplay;
  const fireRisk = buildFireRiskDisplay(safetyData);
  const {
    level: fireRiskLevel,
    label: fireRiskLabel,
    pillClass: fireRiskPillClass,
    alerts: fireRiskAlerts,
  } = fireRisk;
  const heatRisk = buildHeatRiskDisplay(safetyData, formatElevationDisplay);
  const {
    level: heatRiskLevel,
    label: heatRiskLabel,
    pillClass: heatRiskPillClass,
    guidance: heatRiskGuidance,
    reasons: heatRiskReasons,
    metrics: heatRiskMetrics,
    lowerTerrainLabel: lowerTerrainHeatLabel,
  } = heatRisk;
  const mapWeatherEmoji = safetyData
    ? weatherConditionEmoji(
        safetyData.weather.description,
        safetyData.weather.isDaytime,
      )
    : "🌤️";
  const mapWeatherTempLabel = safetyData
    ? formatTempDisplay(safetyData.weather.temp)
    : loading
      ? "Loading…"
      : "–";
  const mapWeatherConditionLabel = safetyData
    ? truncateText(
        safetyData.weather.description || "Conditions unavailable",
        34,
      )
    : "Fetching forecast";
  const mapWeatherChipTitle = safetyData
    ? [
        `${formatTempDisplay(safetyData.weather.temp)} (feels ${formatTempDisplay(safetyData.weather.feelsLike ?? safetyData.weather.temp)})`,
        safetyData.weather.description || "Conditions unavailable",
      ].join(" • ")
    : "Generate a report to see the forecast";
  const mapObjectiveElevationFt = safetyData
    ? Number(safetyData.weather.elevation)
    : Number.NaN;
  const hasMapObjectiveElevation =
    Number.isFinite(mapObjectiveElevationFt) && mapObjectiveElevationFt > 0;
  const mapElevationLabel = hasMapObjectiveElevation
    ? formatElevationDisplay(mapObjectiveElevationFt)
    : loading
      ? "Loading…"
      : "–";
  const mapElevationChipTitle = hasMapObjectiveElevation
    ? [
        formatElevationDisplay(mapObjectiveElevationFt),
        safetyData?.weather.elevationSource || null,
      ]
        .filter(Boolean)
        .join(" • ")
    : "Elevation appears once you generate a report";
  const weatherHourQuickOptions = buildWeatherHourQuickOptions(
    safetyData,
    preferences.timeStyle,
    formatTempDisplay,
    formatWindDisplay,
  );
  const activeWeatherHourValue = weatherHourPreviewTime || alpineStartTime;
  const selectedWeatherHourIndex = findSelectedWeatherHourIndex(
    weatherHourQuickOptions,
    activeWeatherHourValue,
  );
  const selectedWeatherHour =
    selectedWeatherHourIndex >= 0
      ? weatherHourQuickOptions[selectedWeatherHourIndex]
      : null;
  const weatherPreviewActive = Boolean(
    selectedWeatherHour && selectedWeatherHour.value !== alpineStartTime,
  );
  const weatherPreviewPoint = selectedWeatherHour?.point || null;
  const weatherForecastPeriodLabel = safetyData
    ? formatForecastPeriodLabel(
        (typeof weatherPreviewPoint?.timeIso === "string" &&
        weatherPreviewPoint.timeIso.trim()
          ? weatherPreviewPoint.timeIso
          : safetyData.weather.forecastStartTime) || null,
        safetyData.weather.timezone || null,
      )
    : "Not available";
  const weatherCard = buildWeatherCardValues(
    safetyData,
    weatherPreviewPoint,
    selectedWeatherHour?.label,
    alpineStartTime,
    preferences.timeStyle,
    formatElevationDisplay,
  );
  const {
    temp: weatherCardTemp,
    wind: weatherCardWind,
    gust: weatherCardGust,
    feelsLike: weatherCardFeelsLike,
    description: weatherCardDescription,
    withEmoji: weatherCardWithEmoji,
    precip: weatherCardPrecip,
    humidity: weatherCardHumidity,
    dewPoint: weatherCardDewPoint,
    pressureLabel: weatherCardPressureLabel,
    pressureContextLine: weatherPressureContextLine,
    windDirection: weatherCardWindDirection,
    cloudCoverLabel: weatherCardCloudCoverLabel,
    displayTime: weatherCardDisplayTime,
  } = weatherCard;
  const weatherCloudCover = parseOptionalFiniteNumber(
    safetyData?.weather.cloudCover,
  );
  const visibilityDisplay = buildVisibilityRiskDisplay(
    safetyData,
    weatherPreviewActive,
    weatherCard,
  );
  const {
    risk: weatherVisibilityRisk,
    pill: weatherVisibilityPill,
    scoreLabel: weatherVisibilityScoreLabel,
    scoreMeaning: weatherVisibilityScoreMeaning,
    detail: weatherVisibilityDetail,
    contextLine: weatherVisibilityContextLine,
    activeWindowText: weatherVisibilityActiveWindowText,
  } = visibilityDisplay;
  const handleWeatherTrendChartClick = (chartState: unknown) => {
    const parsedState = chartState as {
      activePayload?: Array<{ payload?: { hourValue?: string | null } }>;
      activeLabel?: string | number;
    } | null;
    if (!parsedState) {
      return;
    }
    const payloadHourValue = parsedState.activePayload?.[0]?.payload?.hourValue;
    if (payloadHourValue) {
      handleWeatherHourSelect(payloadHourValue);
      return;
    }
    const activeLabel = String(parsedState.activeLabel || "");
    if (!activeLabel) {
      return;
    }
    const matchedRow = weatherTrendChartData.find(
      (row) => row.label === activeLabel && row.hourValue,
    );
    if (matchedRow?.hourValue) {
      handleWeatherHourSelect(matchedRow.hourValue);
    }
  };
  const forecastLeadHoursDisplay = (() => {
    if (!safetyData?.forecast?.selectedDate) return null;
    // Prefer the ISO 8601 forecastStartTime (includes timezone) to avoid
    // device-timezone-dependent parsing of bare date + time strings.
    const isoStart = safetyData.weather?.forecastStartTime;
    const forecastMs = isoStart
      ? Date.parse(isoStart)
      : Date.parse(
          `${safetyData.forecast.selectedDate}T${(safetyData.forecast.selectedStartTime || "00:00").slice(0, 5)}:00Z`,
        );
    if (!Number.isFinite(forecastMs)) return null;
    const leadHours = (forecastMs - Date.now()) / (1000 * 60 * 60);
    if (leadHours <= 24) return null;
    const rounded = Math.round(leadHours);
    return `${rounded}h forecast`;
  })();
  const startMinutesForPlan = parseTimeInputMinutes(alpineStartTime);
  const sunriseMinutesForPlan = safetyData?.solar
    ? parseSolarClockMinutes(safetyData.solar.sunrise)
    : null;
  const sunsetMinutesForPlan = safetyData?.solar
    ? parseSolarClockMinutes(safetyData.solar.sunset)
    : null;
  const daylightRemainingFromStartMinutes =
    startMinutesForPlan !== null &&
    sunriseMinutesForPlan !== null &&
    sunsetMinutesForPlan !== null
      ? Math.max(
          0,
          sunsetMinutesForPlan -
            Math.max(startMinutesForPlan, sunriseMinutesForPlan),
        )
      : null;
  const daylightRemainingFromStartLabel =
    daylightRemainingFromStartMinutes !== null
      ? startMinutesForPlan !== null &&
        sunsetMinutesForPlan !== null &&
        startMinutesForPlan >= sunsetMinutesForPlan
        ? `${formatDurationMinutes(daylightRemainingFromStartMinutes)} (start is after sunset)`
        : startMinutesForPlan !== null &&
            sunriseMinutesForPlan !== null &&
            startMinutesForPlan < sunriseMinutesForPlan
          ? `${formatDurationMinutes(daylightRemainingFromStartMinutes)} (start before sunrise)`
          : formatDurationMinutes(daylightRemainingFromStartMinutes)
      : "N/A";
  const precipitationDisplayTimezone =
    objectiveTimezone || safetyData?.rainfall?.timezone || null;
  const deviceTimezone =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || null
      : null;
  const timezoneMismatch = Boolean(
    objectiveTimezone && deviceTimezone && objectiveTimezone !== deviceTimezone,
  );
  const handleUseNowConditions = () => {
    const nowInputs = currentDateTimeInputs(objectiveTimezone);
    const objectiveToday = nowInputs.date;
    const objectiveMaxDate = dateTimeInputsFor(
      new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      objectiveTimezone,
    ).date;
    const nextDate = normalizeForecastDate(
      nowInputs.date,
      objectiveToday,
      objectiveMaxDate,
    );
    const nextTime =
      parseTimeInputMinutes(nowInputs.time) === null
        ? preferences.defaultStartTime
        : nowInputs.time;

    setForecastDate(nextDate);
    setAlpineStartTime(nextTime);
    setError(null);
  };
  const preparePastStartReplacement = () => {
    if (safetyData) {
      if (!handleEditPlan()) return false;
    } else if (!requestNewReportAccess()) {
      return false;
    }
    setPastStartPrompt(null);
    setError(null);
    return true;
  };
  const handleUseNowAfterPastStart = () => {
    if (!preparePastStartReplacement()) return;
    const nowInputs = currentDateTimeInputs(objectiveTimezone);
    setForecastDate(nowInputs.date);
    setAlpineStartTime(nowInputs.time);
  };
  const handleUseTomorrowAfterPastStart = () => {
    if (!preparePastStartReplacement()) return;
    setForecastDate(getTomorrowDate(objectiveTimezone));
    setAlpineStartTime(preferences.defaultStartTime);
  };
  const freshness = buildSourceFreshnessDisplay(
    safetyData,
    rainfallPayload,
    avalancheRelevant,
    travelWindowHours,
  );
  const {
    sourceFreshnessRows,
    hasFreshnessWarning,
    freshnessWarningSummary,
    reportGeneratedAt,
    airQualityFutureNotApplicable,
  } = freshness;
  const nwsAlerts = safetyData?.alerts?.alerts || [];
  const nwsAlertCount = safetyData?.alerts?.activeCount ?? nwsAlerts.length;
  const nwsTotalAlertCount =
    safetyData?.alerts?.totalActiveCount ?? nwsAlertCount;
  const nwsTopAlerts = nwsAlerts.slice(0, 3);
  const weatherFieldSources =
    safetyData?.weather.sourceDetails?.fieldSources || {};
  const weatherSourceLabel = inferWeatherSourceLabel(safetyData?.weather);
  const weatherSourceDisplay =
    safetyData?.weather.sourceDetails?.blended &&
    weatherSourceLabel === "NOAA / Weather.gov"
      ? "NOAA / Weather.gov + Open-Meteo"
      : weatherSourceLabel;
  const windLoading = buildWindLoadingDisplay(
    safetyData,
    trendWindow,
    avalancheRelevant,
    hasSnowpackSignal,
    formatWindDisplay,
    preferences.timeStyle,
  );
  const {
    resolvedWindDirection,
    resolvedWindDirectionSource,
    trendWindDirections,
    leewardAspectHints,
    secondaryWindAspects,
    aspectOverlapProblems,
    windGustMph,
    calmOrVariableSignal,
    lightWindSignal,
    trendAgreementRatio,
    windLoadingLevel,
    windLoadingConfidence,
    windLoadingPillClass,
    windLoadingActiveWindowLabel,
    windLoadingActiveHoursDetail,
    windLoadingElevationFocus,
    windLoadingActionLine,
    windLoadingSummary,
    windLoadingNotes,
    windLoadingHintsRelevant,
  } = windLoading;
  if (decision && aspectOverlapProblems.length > 0) {
    const overlapCaution = `Wind loading aligns with active avalanche problem aspects (${aspectOverlapProblems.join(", ")}). Current winds may be actively building slabs on these aspects.`;
    if (!decision.cautions.includes(overlapCaution)) {
      decision = {
        ...decision,
        cautions: [...decision.cautions, overlapCaution],
      };
    }
  }
  const terrainCondition = buildTerrainConditionDisplay(safetyData);
  const { pillClass: terrainConditionPillClass, ...terrainConditionDetails } =
    terrainCondition;
  const gearRecommendations = Array.isArray(safetyData?.gear)
    ? safetyData.gear
        .map((rawItem) => {
          // Structured object from backend
          if (
            rawItem &&
            typeof rawItem === "object" &&
            typeof rawItem.title === "string"
          ) {
            const { title, detail, category, tone } = rawItem;
            let detailText = String(detail || "").trim();
            // Backend gear details can quote a single observed snow depth; when the
            // snow sources disagree that number is misleading on its own.
            if (
              snowpackDepthConflict &&
              /observed snow depth/i.test(detailText)
            ) {
              detailText = `${detailText.replace(/\.$/, "")} (snow sources disagree — see Snowpack card).`;
            }
            return {
              title: String(title || "").trim(),
              detail: detailText,
              category: String(category || "General"),
              tone: String(tone || "go"),
            };
          }
          // Legacy: plain text string fallback
          const text = String(rawItem || "")
            .replace(/\s+/g, " ")
            .trim();
          if (!text) {
            return null;
          }
          const splitIdx = text.indexOf(":");
          const hasReadablePrefix = splitIdx >= 2 && splitIdx <= 44;
          const title = hasReadablePrefix
            ? text.slice(0, splitIdx).trim()
            : "Gear note";
          const detail = hasReadablePrefix
            ? text.slice(splitIdx + 1).trim()
            : text;
          const combined = `${title} ${detail}`.toLowerCase();
          const category =
            /avalanche|beacon|probe|shovel|alerts contingency|coverage gap|comms|communication/.test(
              combined,
            )
              ? "Safety"
              : /shell|rain|wet|snow|ice|mud|traction|gaiter|insulation|extremities|layer|wind/.test(
                    combined,
                  )
                ? "Conditions"
                : /aqi|air quality|heat|fire|sun/.test(combined)
                  ? "Exposure"
                  : "General";
          const tone = /coverage gap|avalanche rescue|alerts contingency/.test(
            combined,
          )
            ? "nogo"
            : /storm shell|snow\/ice traction|cold extremities|static insulation/.test(
                  combined,
                )
              ? "caution"
              : category === "General"
                ? "watch"
                : "go";
          return { title, detail, category, tone };
        })
        .filter(
          (
            item,
          ): item is {
            title: string;
            detail: string;
            category: string;
            tone: string;
          } => item !== null,
        )
    : [];

  const reportCardOrder = buildReportCardOrder({
    safetyData,
    decision,
    preferences,
    travelWindowRows,
    criticalWindow,
    criticalCheckTotal,
    criticalCheckFailCount,
    avalancheRelevant,
    avalancheUnknown,
    windLoadingHintsRelevant,
    windLoadingLevel,
    windLoadingConfidence,
    resolvedWindDirection,
    calmOrVariableSignal,
    lightWindSignal,
    trendWindDirections,
    rainfall12hIn,
    rainfall24hIn,
    rainfall48hIn,
    snowfall12hIn,
    snowfall24hIn,
    snowfall48hIn,
    snowpackDepthSignalValues,
    snowpackSweSignalValues,
    hasSnowpackSignal,
    sourceFreshnessRows,
    gearRecommendations,
    dayOverDay,
    fireRiskLevel,
    heatRiskLevel,
  });
  const shouldRenderRankedCard = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (_key: string): boolean => true,
    [],
  );

  const navigateHomeToPlanner = () => {
    openPlannerView();
  };
  return {
    setActiveSavedReportId, setActiveSavedReportShareToken, reportSaveIntentRef,
    featureFlags,
    accountLoading,
    refreshAccount,
    accountReportUsage,
    syncMultiDayUsage,
    saveAccountPreferences,
    syncGeneratedReportUsage,
    accountUser,
    accountUserId,
    accountAccessReason,
    setAccountAccessReason,
    handleMultiDayUsageUpdated,
    handleMultiDayUsageLimitReached,
    guestReportCount,
    setGuestReportCount,
    isProductionBuild,
    todayDate,
    maxForecastDate,
    initialPreferences,
    initialPersistedReport,
    parsedInitialLinkState,
    initialAccountLinkAction,
    initialLinkState,
    sharedReportToken,
    setSharedReportToken,
    sharedReportLoading,
    setSharedReportLoading,
    sharedReportError,
    setSharedReportError,
    sharedReportLoadAttempt,
    setSharedReportLoadAttempt,
    sharedReportResolvedTokenRef,
    preferences,
    setPreferences,
    preferencesRef,
    preHistoryPreferencesRef,
    historyReportPreferencesRef,
    accountPreferenceOwnerRef,
    preferenceSyncTimerRef,
    scheduleAccountPreferenceSave,
    activity,
    position,
    setPosition,
    hasObjective,
    setHasObjective,
    objectiveName,
    setObjectiveName,
    objectiveNameRef,
    handleNewReportGenerated,
    initialRestoredReport,
    importedGpxRoute,
    setImportedGpxRoute,
    healthChecks,
    healthLoading,
    healthCheckedAt,
    healthError,
    backendMeta,
    runHealthChecks,
    routeSuggestions,
    setRouteSuggestions,
    routeAnalysis,
    routeLoading,
    routeLoadingState,
    routeError,
    setRouteError,
    customRouteName,
    setCustomRouteName,
    fetchRouteSuggestions,
    fetchRouteAnalysis,
    resetRouteState,
    restoreRouteState,
    safetyHook,
    safetyData,
    setSafetyData,
    loading,
    error,
    setError,
    aiBriefNarrative,
    setAiBriefNarrative,
    aiBriefLoading,
    setAiBriefLoading,
    aiBriefError,
    setAiBriefError,
    snowVisionAnalysis,
    snowVisionImage,
    snowVisionLoading,
    snowVisionError,
    setSnowVisionAnalysis,
    setSnowVisionImage,
    setSnowVisionLoading,
    setSnowVisionError,
    handleRequestSnowVision,
    fetchSafetyData,
    clearLastLoadedKey,
    clearWakeRetry,
    handleRequestAiBrief,
    previousSafetyData,
    setPreviousSafetyData,
    reportChatMessages,
    setReportChatMessages,
    reportChatSessionKey,
    setReportChatSessionKey,
    viewingHistoryReport,
    setViewingHistoryReport,
    restoredReportSource,
    setRestoredReportSource,
    activeSavedReportId,
    activeSavedReportShareToken,
    reportGenerationPending,
    resetSavedReportTracking,
    beginReportGeneration,
    coordinateTimezone,
    objectiveTimezone,
    forecastDate,
    setForecastDate,
    alpineStartTime,
    setAlpineStartTime,
    targetElevationInput,
    setTargetElevationInput,
    targetElevationManual,
    setTargetElevationManual,
    pastStartPrompt,
    setPastStartPrompt,
    copiedLink,
    setCopiedLink,
    copiedRawPayload,
    setCopiedRawPayload,
    travelWindowExpanded,
    setTravelWindowExpanded,
    weatherTrendMetric,
    setWeatherTrendMetric,
    weatherHourPreviewTime,
    setWeatherHourPreviewTime,
    mapStyle,
    setMapStyle,
    mobileMapControlsExpanded,
    setMobileMapControlsExpanded,
    collapseMobilePlanControls,
    mapFocusNonce,
    setMapFocusNonce,
    locatingUser,
    setLocatingUser,
    hasInitializedHistoryRef,
    isApplyingPopStateRef,
    copyResetTimeout,
    rawCopyResetTimeout,
    activeBasemap,
    hasVisitedTripRef,
    tripHook,
    tripStartDate,
    setTripStartDate,
    tripStartTime,
    setTripStartTime,
    tripDurationDays,
    setTripDurationDays,
    tripForecastRows,
    setTripForecastRowsDirect,
    tripForecastLoading,
    tripForecastError,
    setTripForecastErrorDirect,
    tripForecastNote,
    setTripForecastNoteDirect,
    runTripForecast,
    initializeTripView,
    updateObjectivePosition,
    searchHook,
    searchQuery,
    setSearchInputValue,
    committedSearchQuery,
    setCommittedSearchQuery,
    suggestions,
    showSuggestions,
    setShowSuggestions,
    searchLoading,
    activeSuggestionIndex,
    setActiveSuggestionIndex,
    searchInputRef,
    searchWrapperRef,
    selectSuggestion,
    handleInputChange,
    handleSearchKeyDown,
    handleSearchSubmit,
    handleFocus,
    handleSearchClear,
    handleUseTypedCoordinates,
    recordRecentSuggestion,
    parsedTypedCoordinates,
    objectiveDraftDirty,
    handleImportGpxObjective,
    urlState,
    view,
    isViewPending,
    navigateToView,
    isAdminAccount,
    showAdminNotFound,
    requestAiAccess,
    requestReportEmailAccess,
    requestNewReportAccess,
    aiAccessContextValue,
    closeAccountAccessPrompt,
    reportPlan,
    reportSnapshot,
    handleRecenterMap,
    handleMapPositionChange,
    handleUseCurrentLocation,
    handleDateChange,
    handlePlannerTimeChange,
    handleWeatherHourSelect,
    handleTargetElevationChange,
    handleTargetElevationStep,
    handleCopyLink,
    handleRequestAiBriefAction,
    handleRequestSnowVisionAction,
    handleFetchRouteSuggestions,
    handleFetchRouteAnalysis,
    handleCopyRawPayload,
    handleRetryFetch,
    handleGenerateReport,
    pendingAutoGenerate,
    setPendingAutoGenerate,
    handleEditPlan,
    handleOpenSavedReport,
    retrySharedReport,
    openPlannerView,
    openBlankPlannerFromSharedReport,
    openTripToolView,
    handleUseTripDayInPlanner,
    handleSelectMultiDayForecastDay,
    handleOpenObjectiveWatch,
    appShellClassName,
    liveSearchQuery,
    trimmedSearchQuery,
    getScoreColor,
    getDangerText,
    getDangerGlyph,
    useHour12Clock,
    formatPubTime,
    formatForecastPeriodLabel,
    formatGeneratedAt,
    formatTempDisplay,
    formatWindDisplay,
    formatElevationDisplay,
    formatElevationDeltaDisplay,
    formatDistanceDisplay,
    localizeUnitText,
    cutoffMinutes,
    displayStartTime,
    displayDefaultStartTime,
    travelWindowHours,
    prefHandlers,
    updatePreferences,
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
    maxFeelsLikeDraft,
    heatCeilingMin,
    heatCeilingMax,
    handleHeatCeilingDisplayChange,
    handleHeatCeilingDisplayBlur,
    handleApplyTravelThresholdPreset,
    applyPreferencesToPlanner,
    resetPreferences,
    travelThresholdEditorOpen,
    setTravelThresholdEditorOpen,
    gpxEstimatedDurationHours,
    returnMinutes,
    returnExtendsPastMidnight,
    returnTimeFormatted,
    returnTimeDisplay,
    decision,
    dayOverDay,
    startTimeScenarios,
    decisionDisplay,
    orderedCriticalChecks,
    topCriticalAttentionChecks,
    criticalCheckFailCount,
    criticalCheckTotal,
    fieldBriefPrimaryReason,
    fieldBriefTopRisks,
    decisionFailingChecks,
    decisionPassingChecksCount,
    decisionActionLine,
    decisionKeyDrivers,
    startLabel,
    avalancheDisplay,
    avalancheRelevant,
    avalancheExpiredForSelectedStart,
    avalancheUnknown,
    overallAvalancheLevel,
    avalancheNotApplicableReason,
    avalancheElevationRows,
    elevationForecastBands,
    trendWindow,
    criticalWindow,
    travelWindowContext,
    travelWindowRows,
    travelWindowInsights,
    travelWindowSummary,
    peakCriticalWindowIndex,
    peakCriticalWindow,
    visibleCriticalWindowRows,
    parsedTargetElevation,
    targetElevationFt,
    hasTargetElevation,
    objectiveElevationFt,
    baseTargetElevationFeet,
    canDecreaseTargetElevation,
    windThresholdDisplay,
    feelsLikeThresholdDisplay,
    heatCeilingDisplay,
    formatPresetWindDisplay,
    activeTravelThresholdPreset,
    travelWindowHoursLabel,
    windUnitLabel,
    tempUnitLabel,
    elevationUnitLabel,
    weatherTrendMetricOptions,
    weatherTrendRows,
    weatherTrendChartData,
    weatherTrendHasData,
    weatherTrendMetricLabel,
    weatherTrendTickFormatter,
    formatWeatherTrendValue,
    weatherTrendYAxisDomain,
    weatherTrendLineColor,
    weatherPressureTrend,
    weatherPressureTrendSummary,
    pressureTrendDirection,
    pressureDeltaLabel,
    pressureRangeLabel,
    weatherTrendTempRange,
    targetElevationForecast,
    rainfallPayload,
    rawReportPayload,
    deepDiveShareLink,
    safeShareLink,
    safeWeatherLink,
    weatherLinkHostLabel,
    weatherLinkCta,
    safeAvalancheLink,
    safeRainfallLink,
    safeSnotelLink,
    safeNohrscLink,
    safeCdecLink,
    rainfallDisplay,
    rainfall12hIn,
    rainfall24hIn,
    rainfall48hIn,
    snowfall12hIn,
    snowfall24hIn,
    snowfall48hIn,
    rainfall24hSeverityClass,
    rainfallWindowSummary,
    snowfallWindowSummary,
    rainfall12hDisplay,
    rainfall24hDisplay,
    rainfall48hDisplay,
    snowfall12hDisplay,
    snowfall24hDisplay,
    snowfall48hDisplay,
    expectedTravelWindowHours,
    expectedRainWindowDisplay,
    expectedSnowWindowDisplay,
    expectedPrecipSummaryLine,
    rainfallModeLabel,
    rainfallNoteLine,
    expectedPrecipNoteLine,
    precipInsightLine,
    rainfallExpected,
    expectedSnowWindowIn,
    snowpackInterpretation,
    snowpackInsights,
    snowpackDisplay,
    snowpackBestDepthDisplay,
    snowpackBestDepthSource,
    snowpackDepthConflict,
    snowpackDepthRangeDisplay,
    snowpackDepthConflictCaption,
    snowpackBestSweDisplay,
    snowpackBestSweSource,
    snotelSweDisplay,
    snotelDepthDisplay,
    nohrscSweDisplay,
    nohrscDepthDisplay,
    cdecSweDisplay,
    cdecDepthDisplay,
    cdecDistanceDisplay,
    snotelDistanceDisplay,
    snowpackPillClass,
    snowpackStatusLabel,
    snowpackHistoricalPillClass,
    snowpackHistoricalStatusLabel,
    snowpackHistoricalComparisonLine,
    snowpackTakeaways,
    snowpackObservationContext,
    snowpackDepthSignalValues,
    snowpackSweSignalValues,
    hasSnowpackSignal,
    fireRisk,
    fireRiskLevel,
    fireRiskLabel,
    fireRiskPillClass,
    fireRiskAlerts,
    heatRisk,
    heatRiskLevel,
    heatRiskLabel,
    heatRiskPillClass,
    heatRiskGuidance,
    heatRiskReasons,
    heatRiskMetrics,
    lowerTerrainHeatLabel,
    mapWeatherEmoji,
    mapWeatherTempLabel,
    mapWeatherConditionLabel,
    mapWeatherChipTitle,
    mapObjectiveElevationFt,
    hasMapObjectiveElevation,
    mapElevationLabel,
    mapElevationChipTitle,
    weatherHourQuickOptions,
    activeWeatherHourValue,
    selectedWeatherHourIndex,
    selectedWeatherHour,
    weatherPreviewActive,
    weatherPreviewPoint,
    weatherForecastPeriodLabel,
    weatherCard,
    weatherCardTemp,
    weatherCardWind,
    weatherCardGust,
    weatherCardFeelsLike,
    weatherCardDescription,
    weatherCardWithEmoji,
    weatherCardPrecip,
    weatherCardHumidity,
    weatherCardDewPoint,
    weatherCardPressureLabel,
    weatherPressureContextLine,
    weatherCardWindDirection,
    weatherCardCloudCoverLabel,
    weatherCardDisplayTime,
    weatherCloudCover,
    visibilityDisplay,
    weatherVisibilityRisk,
    weatherVisibilityPill,
    weatherVisibilityScoreLabel,
    weatherVisibilityScoreMeaning,
    weatherVisibilityDetail,
    weatherVisibilityContextLine,
    weatherVisibilityActiveWindowText,
    handleWeatherTrendChartClick,
    forecastLeadHoursDisplay,
    startMinutesForPlan,
    sunriseMinutesForPlan,
    sunsetMinutesForPlan,
    daylightRemainingFromStartMinutes,
    daylightRemainingFromStartLabel,
    precipitationDisplayTimezone,
    deviceTimezone,
    timezoneMismatch,
    handleUseNowConditions,
    preparePastStartReplacement,
    handleUseNowAfterPastStart,
    handleUseTomorrowAfterPastStart,
    freshness,
    sourceFreshnessRows,
    hasFreshnessWarning,
    freshnessWarningSummary,
    reportGeneratedAt,
    airQualityFutureNotApplicable,
    nwsAlerts,
    nwsAlertCount,
    nwsTotalAlertCount,
    nwsTopAlerts,
    weatherFieldSources,
    weatherSourceLabel,
    weatherSourceDisplay,
    windLoading,
    resolvedWindDirection,
    resolvedWindDirectionSource,
    trendWindDirections,
    leewardAspectHints,
    secondaryWindAspects,
    aspectOverlapProblems,
    windGustMph,
    calmOrVariableSignal,
    lightWindSignal,
    trendAgreementRatio,
    windLoadingLevel,
    windLoadingConfidence,
    windLoadingPillClass,
    windLoadingActiveWindowLabel,
    windLoadingActiveHoursDetail,
    windLoadingElevationFocus,
    windLoadingActionLine,
    windLoadingSummary,
    windLoadingNotes,
    windLoadingHintsRelevant,
    terrainCondition,
    terrainConditionPillClass,
    terrainConditionDetails,
    gearRecommendations,
    reportCardOrder,
    shouldRenderRankedCard,
    navigateHomeToPlanner,
    airQualityPillClass,
    formatIsoDateLabel,
    formatClockForStyle,
    formatTravelWindowSpan,
    describeFailedCriticalCheck,
    formatAgeFromNow,
    getDangerLevelClass,
    normalizeDangerLevel,
    summarizeText,
    toPlainText,
    TARGET_ELEVATION_STEP_FEET,
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;
