// The established planning controller, separated from its previous presentation.
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useLayoutEffect,
} from "react";
import type { LatLngLiteral } from "leaflet";
import {
  DATE_FMT,
  KM_PER_MILE,
  MAX_TRAVEL_WINDOW_HOURS,
  MIN_TRAVEL_WINDOW_HOURS,
} from "../../app/constants";
import {
  type ActivityType,
  type MapStyle,
  type SafetyData,
  type TravelWindowRow,
  type UserPreferences,
} from "../../app/types";
import {
  addDaysToIsoDate,
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
  localizeDistanceText,
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
  getDangerLevelClass,
  normalizeDangerLevel,
  parseOptionalElevationInput,
} from "../../app/planner-helpers";
import { applyPreferencePatch } from "../../app/activity-limits";
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
} from "../../app/text-utils";
import { inferWeatherSourceLabel } from "../../app/weather-display";
import { sanitizeExternalUrl, parseLinkState } from "../../app/url-state";
import { readAccountLinkAction } from "../../app/account-links";
import type { MultiDayUsage } from "../../app/multi-day-usage";
import { buildApproachRequestParams } from "../../app/approach-elevation";
import { buildPlanParams, planParamsQuery, planSettingsParams } from "../../app/plan-evaluation";
import { usePlanEvaluation } from "../../hooks/usePlanEvaluation";
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
import { followThemePreference } from "../../app/theme";
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
  getSharedReport,
} from "../../lib/saved-reports";
type AccountAccessReason =
  | "ai"
  | "report-email"
  | "guest-report-limit"
  | "account-report-limit"
  | "guest-multi-day-limit"
  | "account-multi-day-limit";
const ADMIN_ACCOUNT_EMAIL = "weiranxiong@gmail.com";
// Stable while no evaluation is loaded, so memoized views keep their inputs.
const EMPTY_ROWS: TravelWindowRow[] = [];
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
  const maxForecastDate = addDaysToIsoDate(todayDate, 7);
  const initialPreferences = React.useMemo(() => loadUserPreferences(), []);
  const initialPersistedReport = React.useMemo(() => loadPersistedReport(), []);
  const parsedInitialLinkState = React.useMemo(
    () => parseLinkState(todayDate, maxForecastDate, initialPreferences),
    [todayDate, maxForecastDate, initialPreferences],
  );
  // Capture account-action tokens before URL synchronization removes query parameters.
  // The account panel is lazy-loaded through SettingsView and may render after cleanup.
  const initialAccountLinkAction = React.useMemo(() => readAccountLinkAction(), []);
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
      position: { lat: plan.lat, lng: plan.lon },
      hasObjective: true,
      objectiveName: plan.objectiveName,
      searchQuery: plan.searchQuery,
      forecastDate: plan.forecastDate,
      alpineStartTime: plan.alpineStartTime,
      targetElevationInput: plan.targetElevationInput,
      trailheadElevationInput: plan.trailheadElevationInput,
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
    return applyPreferencePatch(initialPreferences, {
      defaultActivity: initialLinkState.activity,
      ...(initialLinkState.travelWindowHours
        ? { travelWindowHours: initialLinkState.travelWindowHours }
        : {}),
    });
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
        { adoptActivityDefaults: true },
      );
      // Adopt the signed-in account's saved preferences once per account.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreferences(
        initialLinkState.hasObjective
          ? applyPreferencePatch(accountPreferences, {
              defaultActivity: preferencesRef.current.defaultActivity,
              travelWindowHours: preferencesRef.current.travelWindowHours,
            })
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
  const [position, setPosition] = useState<LatLngLiteral>(initialLinkState.position);
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
      activity: initialLinkState.activity,
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
    clearRouteAnalysis,
    restoreRouteState,
  } = useRouteAnalysis(initialRestoredReport?.route);
  // Set once the planned-route handler exists below; a new report starts it.
  const reportGeneratedRef = useRef<() => void>(() => {});
  const handleReportGenerated = useCallback(() => reportGeneratedRef.current(), []);

  // Limits, units and approach sent with each report, so it comes back
  // evaluated for this plan. Kept current below.
  const planQueryRef = useRef("");
  const safetyHook = useSafetyData({
    todayDate,
    preferences,
    isProductionBuild,
    objectiveNameRef,
    extraQueryRef: planQueryRef,
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
  const [, setPreviousSafetyData] =
    useState<SafetyData | null>(null);
  const [reportChatMessages, setReportChatMessages] = useState<
    PersistedReportChatMessage[]
  >(initialRestoredReport?.ai.reportChatMessages ?? []);
  const [reportChatSessionKey, setReportChatSessionKey] = useState(0);
  const [viewingHistoryReport, setViewingHistoryReport] = useState(false);
  const [restoredReportSnapshot, setRestoredReportSnapshot] = useState<PersistedReport | null>(null);
  const [, setRestoredReportSource] = useState<
    "saved" | "shared" | null
  >(null);
  const savedReportSession = useSavedReportSession({ safetyData, accountLoading, accountUserId });
  const {
    activeSavedReportId, activeSavedReportShareToken, reportGenerationPending,
    setActiveSavedReportId, setActiveSavedReportShareToken, reportSaveIntentRef,
    resetSavedReportTracking, beginSavedReportGeneration, saveReportSnapshot,
  } = savedReportSession;
  const beginReportGeneration = useCallback(() => {
    beginSavedReportGeneration();
    setViewingHistoryReport(false);
    setRestoredReportSource(null);
  }, [beginSavedReportGeneration]);

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
  const [trailheadElevationInput, setTrailheadElevationInput] = useState(
    initialLinkState.trailheadElevationInput ?? "",
  );
  const [pastStartPrompt, setPastStartPrompt] =
    useState<PastPlannedStart | null>(null);
  const [copiedLink] = useState(false);
  const [copiedRawPayload, setCopiedRawPayload] = useState(false);
  const [mapStyle, setMapStyle] = useState<MapStyle>("topo");
  const [, setMobileMapControlsExpanded] = useState(
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
  const rawCopyResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
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
    tripRanking,
    tripHighlights,
    tripChatContext,
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
    (nextPosition: LatLngLiteral, label?: string) => {
      clearWakeRetry();
      resetSavedReportTracking();
      setViewingHistoryReport(false);
      setRestoredReportSource(null);
      setReportChatMessages([]);
      setReportChatSessionKey((value) => value + 1);
      setPosition(nextPosition);
      setMapFocusNonce((prev) => prev + 1);
      setHasObjective(true);
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
      setTrailheadElevationInput("");
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

      updateObjectivePosition({ lat: anchor.lat, lng: anchor.lon }, label);
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
          (linkState.trailheadElevationInput ?? "") === trailheadElevationInput &&
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
        setTrailheadElevationInput(linkState.trailheadElevationInput ?? "");
        setPreferences((prev) =>
          applyPreferencePatch(prev, {
            defaultActivity: linkState.activity,
            ...(linkState.travelWindowHours
              ? { travelWindowHours: linkState.travelWindowHours }
              : {}),
          }),
        );
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
        trailheadElevationInput,
        preferences.defaultActivity,
        preferences.travelWindowHours,
      ],
    ),
  });
  const { view, isViewPending, navigateToView } = urlState;

  useEffect(() => {
    if (view === "planner") return;
    sharedReportResolvedTokenRef.current = null;
    // Leaving the planner drops the shared report it was showing.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      // Follow the loaded objective's elevation until the user types a target.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
    // Named as in the navigation, so a tab or bookmark reads like the page it opens.
    const pageTitles: Partial<Record<typeof view, string>> = {
      settings: "Preferences",
      account: "Account",
      history: "Saved reports",
      watches: "Watchlist",
      status: "Status",
      trip: "Compare",
      privacy: "Privacy Policy",
      terms: "Terms of Use",
      "not-found": "Page Not Found",
      admin: "Administration",
    };
    if (view === "home") {
      document.title = "Backcountry Conditions";
      return;
    }

    const pageTitle = showAdminNotFound ? pageTitles["not-found"] : pageTitles[view];
    if (pageTitle) {
      document.title = `${pageTitle} - Backcountry Conditions`;
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
    trailheadElevationInput,
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
    return followThemePreference(preferences.themeMode);
  }, [preferences.themeMode]);

  useEffect(() => {
    return () => {
      if (rawCopyResetTimeout.current) {
        clearTimeout(rawCopyResetTimeout.current);
      }
    };
  }, []);

  const reportPlan = useMemo(
    () => ({
      lat: position.lat,
      lon: position.lng,
      objectiveName,
      searchQuery: committedSearchQuery,
      forecastDate,
      alpineStartTime,
      targetElevationInput,
      ...(trailheadElevationInput ? { trailheadElevationInput } : {}),
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
      trailheadElevationInput,
      preferences.travelWindowHours,
    ],
  );

  const reportSnapshot = useMemo(
    () =>
      viewingHistoryReport && restoredReportSnapshot
        ? restoredReportSnapshot
        : safetyData
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
      viewingHistoryReport,
      restoredReportSnapshot,
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
    accountLoading, accountUserId, syncGeneratedReportUsage,
    setReportChatMessages, onReportGenerated: handleReportGenerated, setReportChatSessionKey,
  });


  // Direct map interaction (click-to-drop-pin or marker drag) bypasses the search flow, so
  // without this the search box keeps showing the previous query (e.g. "Mount Rainier") while
  // the report silently reloads for a completely different, unrelated location. Mirror the
  // same label + search-box sync that handleUseCurrentLocation already does below, so the
  // change is obvious rather than silent.
  const handleMapPositionChange = useCallback(
    (nextPosition: LatLngLiteral) => {
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

        const nextPosition = { lat, lng: lon };
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


  const handleTargetElevationChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const digitsOnly = e.target.value.replace(/[^\d]/g, "").slice(0, 5);
    setTargetElevationInput(digitsOnly);
    setTargetElevationManual(true);
  };
  const handleTrailheadElevationChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setTrailheadElevationInput(e.target.value.replace(/[^\d]/g, "").slice(0, 5));
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
        {
          ...options,
          pace: {
            minutesPerMile: preferences.runnerPaceMinutesPerMile,
            ascentMinutesPer1000Ft: preferences.runnerAscentMinutesPer1000Ft,
          },
        },
      );
    },
    [
      fetchRouteAnalysis,
      preferences.temperatureUnit,
      preferences.windSpeedUnit,
      preferences.elevationUnit,
      preferences.runnerPaceMinutesPerMile,
      preferences.runnerAscentMinutesPer1000Ft,
      requestAiAccess,
    ],
  );


  const parsedTrailheadElevation =
    parseOptionalElevationInput(trailheadElevationInput);
  // Whole feet, as sent to the backend, so both build the same timeline.
  const trailheadElevationFt =
    parsedTrailheadElevation === null
      ? null
      : Math.round(
          convertDisplayElevationToFeet(
            parsedTrailheadElevation,
            preferences.elevationUnit,
          ),
        );
  // Where the party starts, so the backend checks approach hours at the
  // elevation the party is expected to be at.
  const approachParams = useMemo(
    () =>
      buildApproachRequestParams({
        enabled: preferences.approachElevationAdjustment,
        trailheadElevationFt,
        gpxRoute: importedGpxRoute,
        timing: {
          paceMinutesPerMile: preferences.runnerPaceMinutesPerMile,
          ascentMinutesPer1000Ft: preferences.runnerAscentMinutesPer1000Ft,
          stopBufferMinutes: preferences.runnerStopBufferMinutes,
        },
      }),
    [
      trailheadElevationFt,
      importedGpxRoute,
      preferences.approachElevationAdjustment,
      preferences.runnerPaceMinutesPerMile,
      preferences.runnerAscentMinutesPer1000Ft,
      preferences.runnerStopBufferMinutes,
    ],
  );
  // The traveler's settings for every report and comparison of this plan.
  const planSettingsQuery = useMemo(
    () => planParamsQuery({ ...planSettingsParams(preferences), ...approachParams }),
    [preferences, approachParams],
  );
  useEffect(() => {
    planQueryRef.current = planSettingsQuery;
  }, [planSettingsQuery]);
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
    // The planned route stays with the plan; only its analysis was for this report.
    clearRouteAnalysis();
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
    clearRouteAnalysis,
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
      // Navigation may restore the user's preferences for other pages, but
      // the saved snapshot must retain its own plan and settings.
      setRestoredReportSnapshot({ ...report, preferences: reportPreferences });
      historyReportPreferencesRef.current = reportPreferences;
      setPreferences(reportPreferences);

      setPosition({ lat: report.plan.lat, lng: report.plan.lon });
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
      setTrailheadElevationInput(report.plan.trailheadElevationInput ?? "");
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
    // Show loading while a shared report link is resolved.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      const lat = Number(plan.lat);
      const lon = Number(plan.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        setError("This watched objective has invalid coordinates.");
        return;
      }
      sharedReportResolvedTokenRef.current = null;
      setSharedReportToken(null);
      setSharedReportLoading(false);
      setSharedReportError(null);
      clearLastLoadedKey();
      setPendingAutoGenerate(false);
      setPreviousSafetyData(null);
      setPastStartPrompt(null);
      updateObjectivePosition(
        { lat, lng: lon },
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
      setTrailheadElevationInput(plan.trailheadElevationInput ?? "");
      setPreferences((current) => ({
        ...current,
        travelWindowHours: plan.travelWindowHours,
      }));
      navigateToView("planner");
    },
    [
      setError,
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
  const liveSearchQuery = searchQuery;
  const trimmedSearchQuery = liveSearchQuery.trim();


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
    localizeDistanceText(text, preferences.elevationUnit)
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
      .replace(
        /(\d+(?:\.\d+)?)\s?in of new snow\b/gi,
        (_, value) =>
          `${formatSnowDepthForElevationUnit(Number(value), preferences.elevationUnit)} of new snow`,
      )
      .replace(/(\d+(?:\.\d+)?)\s?in of rain\b/gi, (match, value) =>
        preferences.elevationUnit === "m"
          ? `${Math.round(Number(value) * 25.4)} mm of rain`
          : match,
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

  // The route chosen in the plan: an imported GPX track wins over a typed name.
  const plannedRouteName = importedGpxRoute
    ? importedGpxRoute.name ||
      importedGpxRoute.fileName.replace(/\.gpx$/i, "") ||
      "Imported GPX route"
    : customRouteName.trim();
  const handleAnalyzePlannedRoute = useCallback(() => {
    if (!plannedRouteName || viewingHistoryReport) return;
    const gpx = importedGpxRoute;
    handleFetchRouteAnalysis(
      objectiveName,
      plannedRouteName,
      position.lat,
      position.lng,
      forecastDate,
      alpineStartTime,
      travelWindowHours,
      gpx
        ? {
            waypoints: gpx.checkpoints,
            routeMetadata: {
              fileName: gpx.fileName,
              pointCount: gpx.pointCount,
              distanceMiles: gpx.distanceMiles,
              elevationGainFt: gpx.elevationGainFt,
              minElevationFt: gpx.minElevationFt,
              maxElevationFt: gpx.maxElevationFt,
              routeShape: gpx.routeShape,
            },
          }
        : undefined,
    );
  }, [
    plannedRouteName,
    viewingHistoryReport,
    importedGpxRoute,
    handleFetchRouteAnalysis,
    objectiveName,
    position.lat,
    position.lng,
    forecastDate,
    alpineStartTime,
    travelWindowHours,
  ]);
  // A new report analyzes the planned route alongside it. Guests and servers
  // without route analysis skip it quietly; the Route chapter offers it instead.
  // While the session is still loading, the decision waits for the account.
  const [routeAwaitingAccount, setRouteAwaitingAccount] =
    useState<typeof safetyData>(null);
  useLayoutEffect(() => {
    reportGeneratedRef.current = () => {
      clearRouteAnalysis();
      setRouteAwaitingAccount(null);
      const capabilities = safetyData?.capabilities;
      if (
        !featureFlags.routeAnalysis ||
        capabilities?.ai === false ||
        capabilities?.routeAnalysis === false
      )
        return;
      if (accountLoading) setRouteAwaitingAccount(safetyData);
      else if (accountUser) handleAnalyzePlannedRoute();
    };
  });
  useEffect(() => {
    if (!routeAwaitingAccount || accountLoading) return;
    // Clear the deferral once the account has loaded.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRouteAwaitingAccount(null);
    // Only for the report it was deferred for, and not if one already started.
    if (
      accountUser &&
      routeAwaitingAccount === safetyData &&
      !routeAnalysis &&
      !routeLoading
    )
      handleAnalyzePlannedRoute();
  }, [
    routeAwaitingAccount,
    accountLoading,
    accountUser,
    safetyData,
    routeAnalysis,
    routeLoading,
    handleAnalyzePlannedRoute,
  ]);

  const prefHandlers = usePreferenceHandlers({
    preferences,
    setPreferences,
    travelWindowHours,
    targetElevationInput,
    setTargetElevationInput,
    trailheadElevationInput,
    setTrailheadElevationInput,
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
  // The plan the report is checked against; the backend evaluates it. A
  // target elevation the user typed is estimated too; one that only follows
  // the objective adds nothing.
  const evaluatedTargetElevationFt =
    targetElevationManual && hasTargetElevation ? targetElevationFt : null;
  const planParams = useMemo(
    () => buildPlanParams({
      preferences,
      date: forecastDate,
      start: alpineStartTime,
      travelWindowHours,
      approach: approachParams,
      targetElevationFt: evaluatedTargetElevationFt,
    }),
    [preferences, forecastDate, alpineStartTime, travelWindowHours, approachParams, evaluatedTargetElevationFt],
  );
  const {
    evaluation,
    pending: evaluationPending,
    error: evaluationError,
    retry: retryEvaluation,
  } = usePlanEvaluation(safetyData, planParams);
  const decision = evaluation?.decision ?? null;
  // Where the backend modeled the party's start; null scores every hour at the objective.
  const planApproach = evaluation?.plan.approach ?? null;

  const handleRequestAiBriefAction = async () => {
    if (!safetyData || !decision || aiBriefLoading) return;
    if (!requestAiAccess()) return;
    void handleRequestAiBrief({
      safetyData,
      decisionLevel: decision.level,
    });
  };

  const { dayOverDay, startTimeScenarios } = useReportComparisons({
    hasObjective, view, safetyData, forecastDate, currentStartTime: alpineStartTime,
    position: { lat: position.lat, lng: position.lng }, preferences, planSettingsQuery,
    viewingHistoryReport, loading: loading || reportGenerationPending,
    startTimeComparisonsEnabled: featureFlags.startTimeComparisons,
  });

  const decisionSummary = evaluation?.decisionSummary ?? null;
  const orderedCriticalChecks = decisionSummary?.orderedChecks ?? [];
  const decisionFailingChecks = orderedCriticalChecks.filter((check) => !check.ok);
  const topCriticalAttentionChecks = decisionFailingChecks.slice(0, 3);
  const criticalCheckFailCount = decisionFailingChecks.length;
  const criticalCheckTotal = orderedCriticalChecks.length;
  const decisionPassingChecksCount = decisionSummary?.passedCount ?? 0;
  const fieldBriefPrimaryReason = decisionSummary?.primaryReason ?? "";
  const fieldBriefTopRisks = decisionSummary?.topRisks ?? [];
  const decisionActionLine = decisionSummary?.actionLine ?? "";
  const decisionKeyDrivers = decisionSummary?.keyDrivers ?? [];
  const startLabel = "Start time";
  // What each source means for the plan, from the backend's evaluation.
  const interpretation = evaluation?.interpretation ?? null;
  const elevationForecastBands = safetyData?.weather.elevationForecast || [];
  // Hour-by-hour checks at the planned times, from the backend's evaluation.
  const travelWindowRows = evaluation?.travelWindow.planned.rows ?? EMPTY_ROWS;
  const travelWindowSummary = evaluation?.travelWindow.planned.insights.summary ?? "";
  const peakCriticalWindow = evaluation?.criticalWindow.peak ?? null;
  const objectiveElevationFt = Number(safetyData?.weather.elevation);
  const baseTargetElevationFeet = hasTargetElevation
    ? targetElevationFt
    : Number.isFinite(objectiveElevationFt) && objectiveElevationFt >= 0
      ? objectiveElevationFt
      : 0;
  const canDecreaseTargetElevation = baseTargetElevationFeet > 0;
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
            decision: evaluation?.decision ?? null,
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
      evaluation,
      rainfallPayload,
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
  const safeWeatherLink = sanitizeExternalUrl(safetyData?.weather.forecastLink);
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
  const startMinutesForPlan = parseTimeInputMinutes(alpineStartTime);
  const sunriseMinutesForPlan = safetyData?.solar
    ? parseSolarClockMinutes(safetyData.solar.sunrise)
    : null;
  const sunsetMinutesForPlan = safetyData?.solar
    ? parseSolarClockMinutes(safetyData.solar.sunset)
    : null;
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
  const nwsAlerts = safetyData?.alerts?.alerts || [];
  const nwsAlertCount = safetyData?.alerts?.activeCount ?? nwsAlerts.length;
  const nwsTotalAlertCount =
    safetyData?.alerts?.totalActiveCount ?? nwsAlertCount;
  const nwsTopAlerts = nwsAlerts.slice(0, 3);
  const weatherSourceLabel = inferWeatherSourceLabel(safetyData?.weather);
  const weatherSourceDisplay =
    safetyData?.weather.sourceDetails?.blended &&
    weatherSourceLabel === "NOAA / Weather.gov"
      ? "NOAA / Weather.gov + Open-Meteo"
      : weatherSourceLabel;
  const windLoading = evaluation?.windLoading ?? null;
  const resolvedWindDirection = windLoading?.resolvedWindDirection ?? null;
  const resolvedWindDirectionSource = windLoading?.directionSource ?? "Unavailable";
  const leewardAspectHints = windLoading?.leewardAspects ?? [];
  const secondaryWindAspects = windLoading?.secondaryAspects ?? [];
  const aspectOverlapProblems = windLoading?.aspectOverlapProblems ?? [];
  const windGustMph = parseOptionalFiniteNumber(safetyData?.weather.windGust);
  const windLoadingLevel = windLoading?.level ?? "Minimal";
  const windLoadingConfidence = windLoading?.confidence ?? "Low";
  const windLoadingPillClass = windLoading?.tone ?? "caution";
  const windLoadingActiveWindowLabel = windLoading?.activeWindowLabel ?? "N/A";
  const windLoadingActiveHoursDetail = windLoading?.activeHoursDetail ?? "";
  const windLoadingElevationFocus = windLoading?.elevationFocus ?? "";
  const windLoadingActionLine = windLoading?.actionLine ?? "";
  const windLoadingSummary = windLoading?.summary ?? "Wind loading hints unavailable until a forecast is loaded.";
  const windLoadingNotes = windLoading?.notes ?? [];
  const windLoadingApplies = windLoading?.applies ?? false;
  const windLoadingHintsRelevant = windLoading?.hintsRelevant ?? false;
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
            const detailText = String(detail || "").trim();
            let reasonText = String(rawItem.reason || "").trim();
            // Gear reasons can quote a single snow depth; when the snow sources
            // disagree that number is misleading on its own.
            if (interpretation?.snowpack.depthConflict && /snow depth/i.test(reasonText)) {
              reasonText = `${reasonText} (snow sources disagree; see Snowpack)`;
            }
            return {
              title: String(title || "").trim(),
              detail: detailText,
              reason: reasonText,
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
          return { title, detail, reason: "", category, tone };
        })
        .filter(
          (
            item,
          ): item is {
            title: string;
            detail: string;
            reason: string;
            category: string;
            tone: string;
          } => item !== null,
        )
    : [];


  return {
    setActiveSavedReportId, setActiveSavedReportShareToken, reportSaveIntentRef,
    featureFlags,
    accountLoading,
    refreshAccount,
    syncMultiDayUsage,
    syncGeneratedReportUsage,
    accountUser,
    accountUserId,
    accountAccessReason,
    setAccountAccessReason,
    handleMultiDayUsageUpdated,
    handleMultiDayUsageLimitReached,
    guestReportCount,
    isProductionBuild,
    todayDate,
    maxForecastDate,
    initialAccountLinkAction,
    sharedReportToken,
    sharedReportLoading,
    sharedReportError,
    preferences,
    setPreferences,
    activity,
    position,
    hasObjective,
    objectiveName,
    objectiveNameRef,
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
    plannedRouteName,
    handleAnalyzePlannedRoute,
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
    setPreviousSafetyData,
    reportChatMessages,
    setReportChatMessages,
    reportChatSessionKey,
    setReportChatSessionKey,
    viewingHistoryReport,
    activeSavedReportId,
    activeSavedReportShareToken,
    saveReportSnapshot,
    reportGenerationPending,
    resetSavedReportTracking,
    beginReportGeneration,
    objectiveTimezone,
    forecastDate,
    setForecastDate,
    alpineStartTime,
    setAlpineStartTime,
    targetElevationInput,
    setTargetElevationInput,
    pastStartPrompt,
    setPastStartPrompt,
    copiedLink,
    copiedRawPayload,
    mapStyle,
    setMapStyle,
    collapseMobilePlanControls,
    mapFocusNonce,
    locatingUser,
    hasInitializedHistoryRef,
    isApplyingPopStateRef,
    tripStartDate,
    setTripStartDate,
    tripStartTime,
    setTripStartTime,
    tripDurationDays,
    setTripDurationDays,
    tripForecastRows,
    tripRanking,
    tripHighlights,
    tripChatContext,
    setTripForecastRowsDirect,
    tripForecastLoading,
    tripForecastError,
    tripForecastNote,
    runTripForecast,
    updateObjectivePosition,
    searchQuery,
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
    view,
    isViewPending,
    navigateToView,
    isAdminAccount,
    showAdminNotFound,
    requestAiAccess,
    requestNewReportAccess,
    aiAccessContextValue,
    closeAccountAccessPrompt,
    reportSnapshot,
    handleMapPositionChange,
    handleUseCurrentLocation,
    handleDateChange,
    handlePlannerTimeChange,
    handleTargetElevationChange,
    trailheadElevationInput,
    handleTrailheadElevationChange,
    planApproach,
    evaluation,
    evaluationPending,
    evaluationError,
    retryEvaluation,
    handleTargetElevationStep,
    handleRequestAiBriefAction,
    handleRequestSnowVisionAction,
    handleFetchRouteSuggestions,
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
    handleOpenComparisonPlan: handleOpenObjectiveWatch,
    trimmedSearchQuery,
    getDangerText,
    formatPubTime,
    formatForecastPeriodLabel,
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
    returnTimeDisplay,
    decision,
    dayOverDay,
    startTimeScenarios,
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
    elevationForecastBands,
    travelWindowRows,
    travelWindowSummary,
    peakCriticalWindow,
    interpretation,
    targetElevationFt,
    hasTargetElevation,
    objectiveElevationFt,
    canDecreaseTargetElevation,
    activeTravelThresholdPreset,
    travelWindowHoursLabel,
    windUnitLabel,
    tempUnitLabel,
    elevationUnitLabel,
    rainfallPayload,
    rawReportPayload,
    safeWeatherLink,
    safeAvalancheLink,
    safeRainfallLink,
    safeSnotelLink,
    safeNohrscLink,
    safeCdecLink,
    startMinutesForPlan,
    sunriseMinutesForPlan,
    sunsetMinutesForPlan,
    handleUseNowConditions,
    handleUseNowAfterPastStart,
    handleUseTomorrowAfterPastStart,
    nwsAlerts,
    nwsAlertCount,
    nwsTotalAlertCount,
    nwsTopAlerts,
    weatherSourceDisplay,
    resolvedWindDirection,
    resolvedWindDirectionSource,
    leewardAspectHints,
    secondaryWindAspects,
    aspectOverlapProblems,
    windGustMph,
    windLoadingLevel,
    windLoadingConfidence,
    windLoadingPillClass,
    windLoadingActiveWindowLabel,
    windLoadingActiveHoursDetail,
    windLoadingElevationFocus,
    windLoadingActionLine,
    windLoadingSummary,
    windLoadingNotes,
    windLoadingApplies,
    windLoadingHintsRelevant,
    gearRecommendations,
    formatIsoDateLabel,
    formatClockForStyle,

    formatAgeFromNow,
    getDangerLevelClass,
    normalizeDangerLevel,
    summarizeText,
    toPlainText,
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;
