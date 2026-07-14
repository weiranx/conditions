import React from 'react';
import L from 'leaflet';
import {
  Eye,
} from 'lucide-react';
import { ForecastLoading } from './ForecastLoading';
import { PlannerHeader } from './PlannerHeader';
import { PlannerDaySwitcher } from './PlannerDaySwitcher';
import { ProductNav } from '../views/ProductNav';
import { PlannerMapSection } from './PlannerMapSection';
import { AppDisclaimer } from '../../app/map-components';
import '../../styles/planner-redesign.css';
import '../../styles/planner-shell-redesign.css';
import type {
  DayOverDayComparison,
  ElevationForecastBand,
  FireRiskAlertItem,
  HeatRiskMetrics,
  MapStyle,
  NwsAlertItem,
  RainfallExpected,
  SafetyData,
  SnowpackInterpretation,
  SnowpackSnapshotInsights,
  SummitDecision,
  UserPreferences,
  TravelWindowInsights,
  TravelWindowRow,
  TravelWindowSpan,
} from '../../app/types';
import type { ReportCardOrder } from '../../app/card-ordering';
import type { WeatherHourOption } from '../../app/weather-card-state';
import type { TravelThresholdPresetKey } from '../../hooks/usePreferenceHandlers';
import type { RouteAnalysisOptions, RouteOption, RouteAnalysisResult, RouteLoadingState } from '../../hooks/useRouteAnalysis';
import type { AppView } from '../../hooks/useUrlState';
import { parseReportSectionHash } from '../../app/report-sections';
import { ACTIVITY_PROFILES } from '../../app/activity-profiles';
import { useAiAvailability } from '../../hooks/useAiAvailability';
import { useProductFeatureFlags } from '../../contexts/feature-flags';
import type { Suggestion } from '../../lib/search';
import type { ParsedGpxRoute } from '../../lib/gpx';
import type { VisibilityRiskEstimate } from '../../app/visibility';
import type { CriticalWindowRow, TerrainConditionDetails, TargetElevationForecast } from '../../app/types';
import type { FreshnessRow as SourceFreshnessRow } from '../../app/source-freshness-display';
import type { StartTimeScenarioComparison } from '../../app/start-time-scenarios';
import type { PersistedReport, PersistedReportChatMessage } from '../../app/report-storage';
import type { MultiDayTripForecastDay } from '../../hooks/useTripForecast';

const RouteAnalysisSection = React.lazy(() =>
  import('./RouteAnalysisSection').then((module) => ({ default: module.RouteAnalysisSection })),
);
const RedesignView = React.lazy(() =>
  import('./RedesignView').then((module) => ({ default: module.RedesignView })),
);

// ─── Props interface ────────────────────────────────────────────────────────

export interface PlannerViewProps {
  // Shell / layout
  appShellClassName: string;
  isViewPending: boolean;
  restoredFromHistory: boolean;
  restoredReportSource: 'saved' | 'shared' | null;
  reportSnapshot: PersistedReport | null;
  activeSavedReportId: string | null;
  requestReportEmailAccess: () => boolean;

  // Navigation
  navigateToView: (view: AppView) => void;
  openTripToolView: () => void;
  multiDayForecastRows: MultiDayTripForecastDay[];
  multiDayStartTimeLabel: string;
  onSelectMultiDayForecastDay: (date: string) => void;

  // Search box
  searchWrapperRef: React.RefObject<HTMLDivElement | null>;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchQuery: string;
  trimmedSearchQuery: string;
  showSuggestions: boolean;
  searchLoading: boolean;
  suggestions: Suggestion[];
  activeSuggestionIndex: number;
  parsedTypedCoordinates: { lat: number; lon: number } | null;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleFocus: () => void;
  handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  handleSearchSubmit: () => Promise<boolean>;
  handleSearchClear: () => void;
  handleUseTypedCoordinates: (value: string) => void;
  selectSuggestion: (suggestion: Suggestion) => void;
  setActiveSuggestionIndex: (index: number) => void;
  importedGpxRoute: ParsedGpxRoute | null;
  handleImportGpxObjective: (route: ParsedGpxRoute) => void;
  gpxEstimatedDurationHours: number | null;

  // Header controls
  hasObjective: boolean;
  objectiveDraftDirty: boolean;
  copiedLink: boolean;
  handleCopyLink: () => void;

  // Map
  position: L.LatLng;
  activeBasemap: { url: string; attribution: string };
  preferences: UserPreferences;
  updatePreferences: (patch: Partial<UserPreferences>) => void;
  updateObjectivePosition: (pos: L.LatLng, label?: string) => void;
  mapFocusNonce: number;
  mapStyle: string;
  setMapStyle: React.Dispatch<React.SetStateAction<MapStyle>>;
  locatingUser: boolean;
  handleUseCurrentLocation: () => void;
  handleRecenterMap: () => void;
  safetyData: SafetyData | null;
  previousSafetyData: SafetyData | null;
  mapElevationChipTitle: string;
  mapElevationLabel: string;
  mapWeatherEmoji: string;
  mapWeatherTempLabel: string;
  mapWeatherConditionLabel: string;
  mapWeatherChipTitle: string;

  // Map actions / plan controls
  mobileMapControlsExpanded: boolean;
  setMobileMapControlsExpanded: (fn: (prev: boolean) => boolean) => void;
  forecastDate: string;
  todayDate: string;
  maxForecastDate: string;
  handleDateChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  startLabel: string;
  alpineStartTime: string;
  handlePlannerTimeChange: (setter: React.Dispatch<React.SetStateAction<string>>) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  setAlpineStartTime: React.Dispatch<React.SetStateAction<string>>;
  travelWindowHoursDraft: string | number;
  handleTravelWindowHoursDraftChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleTravelWindowHoursDraftBlur: () => void;
  objectiveTimezone: string | null;
  handleUseNowConditions: () => void;
  loading: boolean;
  handleRetryFetch: () => void;
  timezoneMismatch: boolean;
  deviceTimezone: string | null;
  onEditPlan: () => void;
  onGenerateReport: () => void;

  // Decision / safety
  decision: SummitDecision | null;
  avalancheRelevant: boolean;

  // Freshness warning
  hasFreshnessWarning: boolean;
  freshnessWarningSummary: string;

  // Score card
  getScoreColor: (score: number, tier?: string) => string;
  forecastLeadHoursDisplay: string | null;
  objectiveName: string;
  displayStartTime: string;
  returnTimeFormatted: string | null;
  returnExtendsPastMidnight: boolean;
  formatClockForStyle: (time: string, style: UserPreferences['timeStyle']) => string;
  error: string | null;
  aiBriefNarrative: string | null;
  aiBriefError: string | null;
  aiBriefLoading: boolean;
  handleRequestAiBriefAction: () => void;
  reportChatMessages: PersistedReportChatMessage[];
  reportChatSessionKey: number;
  onReportChatMessagesChange: (messages: PersistedReportChatMessage[]) => void;
  snowVisionAnalysis: string | null;
  snowVisionImage: string | null;
  snowVisionError: string | null;
  snowVisionLoading: boolean;
  handleRequestSnowVisionAction: () => void;

  // Route analysis
  routeSuggestions: RouteOption[] | null;
  routeAnalysis: RouteAnalysisResult | null;
  routeLoading: boolean;
  routeLoadingState: RouteLoadingState | null;
  routeError: string | null;
  fetchRouteSuggestions: (name: string, lat: number, lng: number) => void;
  fetchRouteAnalysis: (objectiveName: string, routeName: string, lat: number, lng: number, date: string, startTime: string, hours: number, options?: RouteAnalysisOptions) => void;
  customRouteName: string;
  setCustomRouteName: (name: string) => void;
  setRouteSuggestions: (routes: RouteOption[] | null) => void;
  setRouteError: (err: string | null) => void;
  reportCardOrder: ReportCardOrder;
  travelWindowHours: number;
  formatTempDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatWindDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatElevationDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatElevationDeltaDisplay: (value: number | null | undefined) => string;
  formatDistanceDisplay: (miles: number | null | undefined) => string;

  // Visibility banner
  weatherVisibilityRisk: VisibilityRiskEstimate;
  weatherVisibilityPill: string;
  weatherVisibilityDetail: string;

  // Decision Gate card
  decisionActionLine: string;
  fieldBriefPrimaryReason: string;
  fieldBriefTopRisks: string[];
  rainfall24hSeverityClass: string;
  rainfall24hDisplay: string;
  decisionPassingChecksCount: number;
  decisionFailingChecks: SummitDecision['checks'];
  decisionKeyDrivers: string[];
  orderedCriticalChecks: SummitDecision['checks'];
  startTimeScenarioComparison: StartTimeScenarioComparison | null;
  startTimeScenariosLoading: boolean;
  startTimeScenariosError: string | null;
  canGenerateMoreStartTimeScenarios: boolean;
  generateMoreStartTimeScenarios: () => void;
  localizeUnitText: (text: string) => string;
  formatIsoDateLabel: (isoDate: string) => string;
  setForecastDate: React.Dispatch<React.SetStateAction<string>>;
  setError: (err: string | null) => void;

  // Travel Window card
  peakCriticalWindow: CriticalWindowRow | null;
  travelWindowInsights: TravelWindowInsights;
  travelWindowRows: TravelWindowRow[];
  formatTravelWindowSpan: (span: TravelWindowSpan, timeStyle: UserPreferences['timeStyle']) => string;
  windThresholdDisplay: string;
  feelsLikeThresholdDisplay: string;
  heatCeilingDisplay: string;
  activeTravelThresholdPreset: TravelThresholdPresetKey | null;
  onApplyTravelThresholdPreset: (key: TravelThresholdPresetKey) => void;
  travelThresholdEditorOpen: boolean;
  setTravelThresholdEditorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  windUnitLabel: string;
  windThresholdMin: number;
  windThresholdMax: number;
  windThresholdStep: number;
  maxWindGustDraft: string;
  handleWindThresholdDisplayChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleWindThresholdDisplayBlur: () => void;
  maxPrecipChanceDraft: string;
  handleMaxPrecipChanceDraftChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleMaxPrecipChanceDraftBlur: () => void;
  tempUnitLabel: string;
  feelsLikeThresholdMin: number;
  feelsLikeThresholdMax: number;
  feelsLikeThresholdStep: number;
  minFeelsLikeDraft: string;
  handleFeelsLikeThresholdDisplayChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleFeelsLikeThresholdDisplayBlur: () => void;
  heatCeilingMin: number;
  heatCeilingMax: number;
  maxFeelsLikeDraft: string;
  handleHeatCeilingDisplayChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleHeatCeilingDisplayBlur: () => void;
  formatPresetWindDisplay: (valueMph: number) => string;
  travelWindowSummary: string;
  criticalWindow: CriticalWindowRow[];
  travelWindowExpanded: boolean;
  setTravelWindowExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  visibleCriticalWindowRows: CriticalWindowRow[];
  travelWindowHoursLabel: string;

  // Critical Checks card
  topCriticalAttentionChecks: SummitDecision['checks'];
  criticalCheckFailCount: number;
  describeFailedCriticalCheck: (check: SummitDecision['checks'][number]) => string;

  // Score Trace card
  dayOverDay: DayOverDayComparison | null;
  shouldRenderRankedCard: (key: string) => boolean;

  // Weather card
  weatherCardTemp: number;
  weatherCardWind: number;
  weatherCardFeelsLike: number;
  weatherCardWithEmoji: string;
  weatherCardPrecip: number;
  weatherCardHumidity: number;
  weatherCardDewPoint: number;
  weatherCardDescription: string;
  weatherCardDisplayTime: string;
  weatherForecastPeriodLabel: string;
  weatherPreviewActive: boolean;
  weatherPressureTrendSummary: string | null;
  pressureTrendDirection: string | null;
  pressureDeltaLabel: string | null;
  pressureRangeLabel: string | null;
  weatherHourQuickOptions: WeatherHourOption[];
  selectedWeatherHourIndex: number;
  handleWeatherHourSelect: (time: string) => void;
  weatherConditionEmojiValue: (desc: string, isDaytime?: boolean | null) => string;
  weatherTrendChartData: Array<{ label: string; hourValue: string | null; value: number | null; windDirectionLabel: string | null }>;
  weatherTrendHasData: boolean;
  weatherTrendMetric: string;
  weatherTrendMetricLabel: string;
  weatherTrendMetricOptions: Array<{ key: string; label: string }>;
  weatherTrendLineColor: string;
  weatherTrendYAxisDomain: [number, number] | ['auto', 'auto'];
  weatherTrendTickFormatter: (value: number) => string;
  formatWeatherTrendValue: (value: number | null | undefined, directionLabel?: string | null) => string;
  onTrendMetricChange: (key: string) => void;
  handleWeatherTrendChartClick: (chartState: unknown) => void;
  selectedWeatherHourValue: string | null;
  formattedWind: string;
  formattedGust: string;
  weatherCardPressureLabel: string;
  weatherPressureContextLine: string;
  weatherCardWindDirection: string;
  weatherCardCloudCoverLabel: string;
  weatherVisibilityScoreLabel: string;
  weatherVisibilityActiveWindowText: string | null;
  weatherVisibilityScoreMeaning: string;
  weatherVisibilityContextLine: string | null;
  targetElevationInput: string;
  handleTargetElevationChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleTargetElevationStep: (deltaFeet: number) => void;
  canDecreaseTargetElevation: boolean;
  hasTargetElevation: boolean;
  targetElevationForecast: TargetElevationForecast | null;
  targetElevationFt: number;
  TARGET_ELEVATION_STEP_FEET: number;
  elevationUnitLabel: string;
  elevationForecastBands: ElevationForecastBand[];
  objectiveElevationFt: number;
  safeWeatherLink: string | null;
  weatherLinkCta: string;
  weatherSourceDisplay: string;
  formatPubTime: (isoString?: string) => string;
  weatherTrendTempRange: { low: number; high: number } | null;
  getDangerLevelClass: (lvl?: number) => string;
  getDangerText: (lvl: number) => string;

  // Heat Risk card
  heatRiskGuidance: string;
  heatRiskReasons: string[];
  heatRiskMetrics: HeatRiskMetrics;
  heatRiskPillClass: string;
  heatRiskLabel: string;
  lowerTerrainHeatLabel: string | null;

  // Terrain card
  terrainConditionDetails: TerrainConditionDetails;
  terrainConditionPillClass: string;
  rainfall12hDisplay: string;
  rainfall48hDisplay: string;
  snowfall12hDisplay: string;
  snowfall24hDisplay: string;
  snowfall48hDisplay: string;
  snowfall12hIn: number;
  snowfall24hIn: number;
  snowfall48hIn: number;

  // Rainfall card
  precipInsightLine: string;
  expectedPrecipSummaryLine: string;
  expectedTravelWindowHours: number;
  expectedRainWindowDisplay: string;
  expectedSnowWindowIn: number;
  expectedSnowWindowDisplay: string;
  rainfallExpected: RainfallExpected | null;
  precipitationDisplayTimezone: string | null;
  expectedPrecipNoteLine: string;
  rainfallModeLabel: string;
  rainfallPayload: SafetyData['rainfall'] | null;
  rainfallNoteLine: string;
  safeRainfallLink: string | null;
  formatForecastPeriodLabel: (isoString?: string | null, timeZone?: string | null) => string;

  // Wind Loading card
  windLoadingHintsRelevant: boolean;
  windLoadingLevel: string;
  windLoadingConfidence: string;
  windLoadingPillClass: string;
  windLoadingActiveWindowLabel: string;
  windLoadingActiveHoursDetail: string;
  resolvedWindDirectionSource: string;
  trendAgreementRatio: number | null;
  windLoadingElevationFocus: string;
  leewardAspectHints: string[];
  secondaryWindAspects: string[];
  windGustMph: number;
  windLoadingNotes: string[];
  aspectOverlapProblems: string[];
  windLoadingSummary: string;
  windLoadingActionLine: string;
  avalancheUnknown: boolean;

  // Source Freshness card
  sourceFreshnessRows: SourceFreshnessRow[];
  reportGeneratedAt: string | null;
  avalancheExpiredForSelectedStart: boolean;
  formatAgeFromNow: (isoString: string | null) => string;

  // NWS Alerts card
  nwsAlertCount: number;
  nwsTotalAlertCount: number;
  nwsTopAlerts: NwsAlertItem[];

  // Air Quality card
  airQualityPillClassFn: (aqi: number | null | undefined) => string;
  airQualityFutureNotApplicable: boolean;

  // Snowpack card
  snowpackInsights: SnowpackSnapshotInsights | null;
  snowpackBestDepthDisplay: string;
  snowpackBestDepthSource: string | null;
  snowpackDepthConflict: boolean;
  snowpackDepthRangeDisplay: string | null;
  snowpackDepthConflictCaption: string | null;
  snowpackBestSweDisplay: string;
  snowpackBestSweSource: string | null;
  snotelDistanceDisplay: string;
  snotelDepthDisplay: string;
  snotelSweDisplay: string;
  nohrscDepthDisplay: string;
  nohrscSweDisplay: string;
  cdecDepthDisplay: string;
  cdecSweDisplay: string;
  cdecDistanceDisplay: string;
  snowpackPillClass: string;
  snowpackStatusLabel: string;
  snowpackHistoricalStatusLabel: string;
  snowpackHistoricalPillClass: string;
  snowpackHistoricalComparisonLine: string;
  snowpackInterpretation: SnowpackInterpretation | null;
  snowpackTakeaways: string[];
  snowfallWindowSummary: string;
  rainfallWindowSummary: string;
  snowpackObservationContext: string;
  safeSnotelLink: string | null;
  safeNohrscLink: string | null;
  safeCdecLink: string | null;

  // Fire Risk card
  fireRiskLabel: string;
  fireRiskPillClass: string;
  fireRiskAlerts: FireRiskAlertItem[];

  // Plan Snapshot card
  sunriseMinutesForPlan: number | null;
  sunsetMinutesForPlan: number | null;
  startMinutesForPlan: number | null;
  returnMinutes: number | null;
  daylightRemainingFromStartLabel: string;

  // Gear card
  gearRecommendations: Array<{ title: string; detail: string; category: string; tone: string }>;

  // Avalanche forecast card
  overallAvalancheLevel: number | null;
  avalancheNotApplicableReason: string;
  avalancheElevationRows: Array<{ key: string; label: string; rating: number | null | undefined }>;
  safeAvalancheLink: string | null;
  normalizeDangerLevel: (lvl: number | undefined) => number;
  getDangerGlyph: (lvl: number) => string;
  summarizeText: (text: string | undefined, maxLength?: number) => string;
  toPlainText: (html: string) => string;

  // Deep Dive Report card
  safeShareLink: string | null;
  weatherFieldSources: Record<string, string>;
  weatherCloudCover: number | null;
  weatherBlended: boolean;
  rawReportPayload: string;
  copiedRawPayload: boolean;
  handleCopyRawPayload: () => void;

  // Footer
  formatGeneratedAt: (isoString: string | null) => string;
}

// ─── Component ───────────────────────────────────────────────────────────────

function PlannerViewComponent(props: PlannerViewProps) {
  const aiAvailability = useAiAvailability(props.safetyData?.capabilities);
  const featureFlags = useProductFeatureFlags();
  const {
    // Shell
    appShellClassName,
    isViewPending,
    restoredFromHistory,

    // Navigation
    navigateToView,
    openTripToolView,
    multiDayForecastRows,
    multiDayStartTimeLabel,
    onSelectMultiDayForecastDay,

    // Search
    searchWrapperRef,
    searchInputRef,
    searchQuery,
    trimmedSearchQuery,
    showSuggestions,
    searchLoading,
    suggestions,
    activeSuggestionIndex,
    parsedTypedCoordinates,
    handleInputChange,
    handleFocus,
    handleSearchKeyDown,
    handleSearchSubmit,
    handleSearchClear,
    handleUseTypedCoordinates,
    selectSuggestion,
    setActiveSuggestionIndex,
    importedGpxRoute,
    handleImportGpxObjective,
    gpxEstimatedDurationHours,

    // Header
    hasObjective,
    objectiveDraftDirty,
    copiedLink,
    handleCopyLink,

    // Map
    position,
    activeBasemap,
    preferences,
    updatePreferences,
    updateObjectivePosition,
    mapFocusNonce,
    mapStyle,
    setMapStyle,
    locatingUser,
    handleUseCurrentLocation,
    handleRecenterMap,
    safetyData,
    mapElevationChipTitle,
    mapElevationLabel,
    mapWeatherEmoji,
    mapWeatherTempLabel,
    mapWeatherConditionLabel,
    mapWeatherChipTitle,

    // Map actions
    mobileMapControlsExpanded,
    setMobileMapControlsExpanded,
    forecastDate,
    todayDate,
    maxForecastDate,
    handleDateChange,
    startLabel,
    alpineStartTime,
    handlePlannerTimeChange,
    setAlpineStartTime,
    travelWindowHoursDraft,
    handleTravelWindowHoursDraftChange,
    handleTravelWindowHoursDraftBlur,
    objectiveTimezone,
    handleUseNowConditions,
    loading,
    handleRetryFetch,
    timezoneMismatch,
    deviceTimezone,
    onEditPlan,
    onGenerateReport,

    // Decision / safety
    decision,

    // Freshness warning
    hasFreshnessWarning,
    freshnessWarningSummary,

    // Score card
    getScoreColor,
    objectiveName,
    error,

    // Route analysis
    routeSuggestions,
    routeAnalysis,
    routeLoading, routeLoadingState,
    routeError,
    fetchRouteSuggestions,
    fetchRouteAnalysis,
    customRouteName,
    setCustomRouteName,
    setRouteSuggestions,
    setRouteError,
    reportCardOrder,
    travelWindowHours,
    formatTempDisplay,
    formatWindDisplay,
    formatElevationDisplay,
    formatDistanceDisplay,
    // Visibility banner
    weatherVisibilityRisk,
    weatherVisibilityPill,
    weatherVisibilityDetail,

    // Travel Window card

    // Score Trace card

    // Weather card

    // Heat Risk card

    // Terrain card

    // Rainfall card

    // Wind Loading card

    // Source Freshness card
    reportGeneratedAt,

    // NWS Alerts card

    // Air Quality card

    // Snowpack card

    // Fire Risk card

    // Plan Snapshot card

    // Gear card

    // Avalanche forecast card

    // Deep Dive card

    // Footer
    formatGeneratedAt,
  } = props;

  // Once a report is showing, its timing inputs stay locked. Location controls
  // remain available because selecting a new objective clears the old report
  // and returns the planner to its explicit pre-generation state.
  const reportLocked = Boolean(safetyData);
  const objectiveReady = hasObjective && !objectiveDraftDirty;
  const showMultiDaySwitcher = !restoredFromHistory
    && featureFlags.tripPlanning
    && multiDayForecastRows.length >= 2;
  const reportGeneratedAtLabel = formatGeneratedAt(reportGeneratedAt);
  const reportResumeHandledRef = React.useRef(false);

  React.useEffect(() => {
    if (!safetyData) {
      reportResumeHandledRef.current = false;
      return;
    }
    if (loading || reportResumeHandledRef.current) return;
    const requestedSectionId = parseReportSectionHash(window.location.hash);
    const defaultSectionId = 'planner-section-decision';
    const scrollToSection = (sectionId: string) => {
      const report = document.getElementById(sectionId);
      if (!report) return false;
      reportResumeHandledRef.current = true;
      report.scrollIntoView({ behavior: 'auto', block: 'start' });
      return true;
    };
    if (scrollToSection(requestedSectionId || defaultSectionId)) return;
    const root = document.getElementById('planner-main-content');
    if (!root) return;
    const observer = new MutationObserver(() => {
      if (scrollToSection(requestedSectionId || defaultSectionId)) observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true });
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      if (requestedSectionId) scrollToSection(defaultSectionId);
    }, 2500);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [loading, safetyData]);

  return (
    <div
      key="view-planner"
      className={`${appShellClassName} ssr-shell${showMultiDaySwitcher ? ' has-planner-day-switcher' : ''}`}
      aria-busy={isViewPending}
    >
      <a href="#planner-main-content" className="skip-nav">Skip to main content</a>
      <ProductNav
        active="planner"
        navigateToView={navigateToView}
        openTripToolView={openTripToolView}
      />
      <main id="planner-main-content" className="planner-page-main" tabIndex={-1}>
      {restoredFromHistory && (
        <div className="planner-history-notice" role="status">
          <strong>{props.restoredReportSource === 'shared' ? 'Read-only shared report' : 'Read-only saved report'}</strong>
          <span>This snapshot stays unchanged. You can watch its plan privately or select New report to check current data.</span>
        </div>
      )}
      <PlannerHeader
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
        importedGpxRoute={importedGpxRoute}
        handleImportGpxObjective={handleImportGpxObjective}
        gpxEstimatedDurationHours={gpxEstimatedDurationHours}
        activityLabel={`${ACTIVITY_PROFILES[preferences.defaultActivity].shortLabel} profile`}
        disabled={reportLocked}
        readOnly={restoredFromHistory}
        reportGeneratedAt={reportGeneratedAt}
        reportGeneratedAtLabel={reportGeneratedAtLabel}
        hasObjective={objectiveReady}
        copiedLink={copiedLink}
        handleCopyLink={handleCopyLink}
      />

      {showMultiDaySwitcher && (
        <PlannerDaySwitcher
          days={multiDayForecastRows}
          activeDate={forecastDate}
          startTimeLabel={multiDayStartTimeLabel}
          formatTempDisplay={formatTempDisplay}
          onSelectDay={onSelectMultiDayForecastDay}
        />
      )}

      <PlannerMapSection
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
        hasObjective={hasObjective}
        objectiveDraftDirty={objectiveDraftDirty}
        objectiveName={objectiveName}
        safetyData={safetyData}
        mapElevationChipTitle={mapElevationChipTitle}
        mapElevationLabel={mapElevationLabel}
        mapWeatherEmoji={mapWeatherEmoji}
        mapWeatherTempLabel={mapWeatherTempLabel}
        mapWeatherConditionLabel={mapWeatherConditionLabel}
        mapWeatherChipTitle={mapWeatherChipTitle}
        mobileMapControlsExpanded={mobileMapControlsExpanded}
        setMobileMapControlsExpanded={setMobileMapControlsExpanded}
        forecastDate={forecastDate}
        dateLabel={props.formatIsoDateLabel(forecastDate)}
        displayStartTime={props.displayStartTime}
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
        onObjectiveProfileChange={(profileKey) => updatePreferences(ACTIVITY_PROFILES[profileKey].preferencePatch)}
        objectiveTimezone={objectiveTimezone}
        handleUseNowConditions={handleUseNowConditions}
        loading={loading}
        handleRetryFetch={handleRetryFetch}
        openTripToolView={openTripToolView}
        timezoneMismatch={timezoneMismatch}
        deviceTimezone={deviceTimezone}
        locked={reportLocked}
        readOnly={restoredFromHistory}
        onEditPlan={onEditPlan}
        onGenerateReport={onGenerateReport}
        importedGpxRoute={importedGpxRoute}
        routeAnalysis={routeAnalysis}
      />

      {loading && !safetyData && <ForecastLoading />}

      {loading && safetyData && (
        <div className="loading-state inline-loading-state" role="status" aria-live="polite">
          <strong>Refreshing conditions…</strong>
          <span>Existing report remains visible until fresh data arrives.</span>
        </div>
      )}

      {error && (
        <div className="error-banner" role="alert" aria-live="assertive">
          <h3>System Alert</h3>
          <p>{error}</p>
          {hasObjective && (
            <div className="error-banner-actions">
              <button type="button" className="settings-btn" onClick={handleRetryFetch}>
                Retry Data Fetch
              </button>
            </div>
          )}
        </div>
      )}


      {hasObjective && safetyData && decision && hasFreshnessWarning && (
        <section className="top-freshness-alert" role="status" aria-live="polite">
          <strong>Data freshness warning</strong>
          <span>{freshnessWarningSummary}</span>
        </section>
      )}

      {hasObjective && safetyData && (position.lat < 24.5 || position.lat > 49.5 || position.lng < -125 || position.lng > -66.5) && (
        <section className="top-freshness-alert coverage-warning" role="status" aria-live="polite">
          <strong>Limited coverage</strong>
          <span>Primary data sources (NOAA, NWS, SNOTEL, avalanche centers) are US-focused. Forecasts, alerts, and snowpack data outside the US may be degraded or unavailable.</span>
        </section>
      )}

      {hasObjective && safetyData && safetyData.partialData && (
        <section className="top-freshness-alert data-integrity-alert" role="alert" aria-live="assertive">
          <strong>Incomplete data</strong>
          <span>
            {safetyData.apiWarning || 'One or more upstream data providers failed. Some report sections may be missing or degraded.'}
            {' '}Treat the safety score and recommendations as lower-confidence until data recovers.
          </span>
        </section>
      )}

      {hasObjective && safetyData && decision && (
        <section className="data-grid" aria-label="Conditions report">
          <h2 className="sr-only">Conditions Report</h2>

          {(weatherVisibilityRisk.level === 'Moderate' || weatherVisibilityRisk.level === 'High' || weatherVisibilityRisk.level === 'Extreme') && (
            <div className={`visibility-banner visibility-banner-${weatherVisibilityPill}`} style={{ order: reportCardOrder.reportColumns }}>
              <Eye size={14} /> Visibility risk: <strong>{weatherVisibilityRisk.level}</strong>{weatherVisibilityDetail ? ` — ${weatherVisibilityDetail}` : ''}
            </div>
          )}

          <div style={{ order: reportCardOrder.scoreCard }}>
            <React.Suspense
              fallback={(
                <div className="loading-state inline-loading-state" role="status" aria-live="polite" aria-busy="true">
                  Loading report details…
                </div>
              )}
            >
              <RedesignView
                {...props}
                aiAvailability={aiAvailability}
                routeAnalysisSlot={objectiveName && (routeAnalysis || (!restoredFromHistory && featureFlags.routeAnalysis)) ? (
                  <React.Suspense
                    fallback={<div className="route-analysis-section loading-state inline-loading-state" role="status" aria-live="polite" aria-busy="true">Loading route analysis tools…</div>}
                  >
                    <RouteAnalysisSection
                      objectiveName={objectiveName}
                      positionLat={position.lat}
                      positionLng={position.lng}
                      forecastDate={forecastDate}
                      alpineStartTime={alpineStartTime}
                      travelWindowHours={travelWindowHours}
                      order={1}
                      routeSuggestions={routeSuggestions}
                      routeAnalysis={routeAnalysis}
                      routeLoading={routeLoading}
                      routeLoadingState={routeLoadingState}
                      routeError={routeError}
                      fetchRouteSuggestions={fetchRouteSuggestions}
                      fetchRouteAnalysis={fetchRouteAnalysis}
                      customRouteName={customRouteName}
                      setCustomRouteName={setCustomRouteName}
                      setRouteSuggestions={setRouteSuggestions}
                      setRouteError={setRouteError}
                      getScoreColor={getScoreColor}
                      formatTempDisplay={formatTempDisplay}
                      formatWindDisplay={formatWindDisplay}
                      formatElevationDisplay={formatElevationDisplay}
                      formatDistanceDisplay={formatDistanceDisplay}
                      initialGpxRoute={importedGpxRoute}
                      aiAvailable={aiAvailability.routeAnalysis}
                    />
                  </React.Suspense>
                ) : null}
              />
            </React.Suspense>
          </div>

        </section>
      )}

      <div className="planner-footer-stack">
        <AppDisclaimer compact navigateToView={navigateToView} />
        {hasObjective && safetyData && !loading && !error && decision && (
          <div className="footer">
            Generated by Backcountry Conditions • Report generated {reportGeneratedAtLabel}
          </div>
        )}
      </div>
      </main>
    </div>
  );
}

// PlannerView receives a very large (~390-field) props object rebuilt every
// render in App.tsx. React.memo's shallow-prop comparator skips re-rendering
// this 2000-line component when none of those references actually changed
// (e.g. an unrelated state update elsewhere in App.tsx).
export const PlannerView = React.memo(PlannerViewComponent);
