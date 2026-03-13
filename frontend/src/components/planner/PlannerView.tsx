/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { MapContainer, TileLayer, ScaleControl } from 'react-leaflet';
import L from 'leaflet';
import {
  Wind,
  CloudRain,
  Thermometer,
  AlertTriangle,
  Mountain,
  Compass,
  Map as MapIcon,
  LocateFixed,
  Layers,
  Navigation,
  Clock,
  Link2,
  CalendarDays,
  CheckCircle2,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Flame,
  Sun,
  RefreshCw,
  BookmarkPlus,
  BookmarkCheck,
  Zap,
  Check,
  ExternalLink,
  Sparkles,
  Loader2,
  Eye,
} from 'lucide-react';
import { SearchBox } from './SearchBox';
import { ForecastLoading } from './ForecastLoading';
// HelpHint available but removed from card titles for cleaner UI
import { AvalancheForecastCard } from './cards/AvalancheForecastCard';
import { TravelWindowPlannerCard } from './cards/TravelWindowPlannerCard';
import { WindLoadingCard } from './cards/WindLoadingCard';
import { RouteConditionsProfile } from './cards/RouteConditionsProfile';
import { CollapsibleCard } from './CollapsibleCard';
import { ScoreGauge } from './ScoreGauge';
import { WeatherCardContent } from './cards/WeatherCardContent';
import { DecisionGateCard } from './cards/DecisionGateCard';
import { CriticalChecksCard } from './cards/CriticalChecksCard';
import { ScoreTraceCard } from './cards/ScoreTraceCard';
import { HeatRiskCard } from './cards/HeatRiskCard';
import { TerrainCard } from './cards/TerrainCard';
import { RainfallCard } from './cards/RainfallCard';
import { SourceFreshnessCard } from './cards/SourceFreshnessCard';
import { NwsAlertsCard } from './cards/NwsAlertsCard';
import { AirQualityCard } from './cards/AirQualityCard';
import { SnowpackCard } from './cards/SnowpackCard';
import { FireRiskCard } from './cards/FireRiskCard';
import { PlanSnapshotCard } from './cards/PlanSnapshotCard';
import { GearCard } from './cards/GearCard';
import { DeepDiveReportCard } from './cards/DeepDiveReportCard';
import { AppDisclaimer, LocationMarker, MapUpdater } from '../../app/map-components';
import { renderSimpleMarkdown } from '../../app/markdown';
import {
  APP_CREDIT_TEXT,
  MAX_TRAVEL_WINDOW_HOURS,
  MIN_TRAVEL_WINDOW_HOURS,
} from '../../app/constants';
import type {
  DayOverDayComparison,
  ElevationForecastBand,
  MapStyle,
  SafetyData,
  SnowpackInterpretation,
  SnowpackSnapshotInsights,
  SummitDecision,
  UserPreferences,
  TravelWindowInsights,
  TravelWindowRow,
  TravelWindowSpan,
  WeatherTrendPoint,
} from '../../app/types';
import type { TravelThresholdPresetKey } from '../../hooks/usePreferenceHandlers';
import { TRAVEL_THRESHOLD_PRESETS } from '../../hooks/usePreferenceHandlers';
import type { RouteOption, RouteAnalysisResult } from '../../hooks/useRouteAnalysis';
import type { AppView } from '../../hooks/useUrlState';
import type { Suggestion } from '../../lib/search';
import type { VisibilityRiskEstimate } from '../../app/visibility';
import type { CriticalWindowRow } from './cards/TravelWindowPlannerCard';
import type { TerrainConditionDetails } from './cards/TerrainCard';
import type { TargetElevationForecast } from './cards/WeatherCardContent';
import type { SourceFreshnessRow } from './cards/SourceFreshnessCard';
import type { BetterDaySuggestion } from '../../hooks/useDayComparisons';
// formatClockShort available if needed
import { criticalRiskLevelText } from '../../app/critical-window';

// ─── Props interface ────────────────────────────────────────────────────────

export interface PlannerViewProps {
  // Shell / layout
  appShellClassName: string;
  isViewPending: boolean;

  // Navigation
  navigateToView: (view: AppView) => void;
  openTripToolView: () => void;
  jumpToPlannerSection: (sectionId: string) => void;

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
  handleSearchSubmit: () => void;
  handleSearchClear: () => void;
  handleUseTypedCoordinates: (value: string) => void;
  selectSuggestion: (suggestion: Suggestion) => void;
  setActiveSuggestionIndex: (index: number) => void;

  // Header controls
  hasObjective: boolean;
  objectiveIsSaved: boolean;
  handleToggleSaveObjective: () => void;
  copiedLink: boolean;
  handleCopyLink: () => void;

  // Map
  position: L.LatLng;
  activeBasemap: { url: string; attribution: string };
  preferences: UserPreferences;
  updateObjectivePosition: (pos: L.LatLng, label?: string) => void;
  mapFocusNonce: number;
  mapStyle: string;
  setMapStyle: React.Dispatch<React.SetStateAction<MapStyle>>;
  locatingUser: boolean;
  handleUseCurrentLocation: () => void;
  handleRecenterMap: () => void;
  safetyData: SafetyData | null;
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
  satelliteConditionLine: string;
  timezoneMismatch: boolean;
  deviceTimezone: string | null;

  // Decision / safety
  decision: SummitDecision | null;
  avalancheRelevant: boolean;

  // Freshness warning
  hasFreshnessWarning: boolean;
  freshnessWarningSummary: string;

  // Score card
  getScoreColor: (score: number) => string;
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

  // Route analysis
  routeSuggestions: RouteOption[] | null;
  routeAnalysis: RouteAnalysisResult | null;
  routeLoading: boolean;
  routeError: string | null;
  fetchRouteSuggestions: (name: string, lat: number, lng: number) => void;
  fetchRouteAnalysis: (objectiveName: string, routeName: string, lat: number, lng: number, date: string, startTime: string, hours: number) => void;
  customRouteName: string;
  setCustomRouteName: (name: string) => void;
  setRouteSuggestions: (routes: RouteOption[] | null) => void;
  setRouteError: (err: string | null) => void;
  reportCardOrder: Record<string, any>;
  travelWindowHours: number;
  formatTempDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatWindDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatElevationDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatElevationDeltaDisplay: (value: number | null | undefined) => string;

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
  betterDaySuggestions: BetterDaySuggestion[] | null;
  betterDaySuggestionsLoading: boolean;
  betterDaySuggestionsNote: string | null;
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
  weatherHourQuickOptions: Array<{ value: string; label: string; tempLabel: string | null; point: WeatherTrendPoint }>;
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
  heatRiskMetrics: Record<string, any>;
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
  rainfallExpected: Record<string, any> | null;
  precipitationDisplayTimezone: string | null;
  expectedPrecipNoteLine: string;
  rainfallModeLabel: string;
  rainfallPayload: Record<string, any> | null;
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
  nwsTopAlerts: Record<string, any>[];

  // Air Quality card
  airQualityPillClassFn: (aqi: number | null | undefined) => string;
  airQualityFutureNotApplicable: boolean;

  // Snowpack card
  snowpackInsights: SnowpackSnapshotInsights | null;
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
  fireRiskAlerts: Record<string, any>[];

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
  weatherFieldSources: Record<string, any>;
  weatherCloudCover: number | null;
  weatherBlended: boolean;
  rawReportPayload: string;
  copiedRawPayload: boolean;
  handleCopyRawPayload: () => void;

  // Footer
  formatGeneratedAt: () => string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PlannerView(props: PlannerViewProps) {
  const {
    // Shell
    appShellClassName,
    isViewPending,

    // Navigation
    navigateToView,
    openTripToolView,
    jumpToPlannerSection,

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

    // Header
    hasObjective,
    objectiveIsSaved,
    handleToggleSaveObjective,
    copiedLink,
    handleCopyLink,

    // Map
    position,
    activeBasemap,
    preferences,
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
    satelliteConditionLine,
    timezoneMismatch,
    deviceTimezone,

    // Decision / safety
    decision,
    avalancheRelevant,

    // Freshness warning
    hasFreshnessWarning,
    freshnessWarningSummary,

    // Score card
    getScoreColor,
    forecastLeadHoursDisplay: _forecastLeadHoursDisplay,
    objectiveName,
    displayStartTime,
    returnTimeFormatted,
    returnExtendsPastMidnight: _returnExtendsPastMidnight,
    formatClockForStyle,
    error,
    aiBriefNarrative,
    aiBriefError,
    aiBriefLoading,
    handleRequestAiBriefAction,

    // Route analysis
    routeSuggestions,
    routeAnalysis,
    routeLoading,
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
    formatElevationDeltaDisplay,
    // Visibility banner
    weatherVisibilityRisk,
    weatherVisibilityPill,
    weatherVisibilityDetail,

    // Decision Gate card
    decisionActionLine,
    fieldBriefPrimaryReason,
    fieldBriefTopRisks,
    rainfall24hSeverityClass,
    rainfall24hDisplay,
    decisionPassingChecksCount,
    decisionFailingChecks,
    decisionKeyDrivers,
    orderedCriticalChecks,
    betterDaySuggestions,
    betterDaySuggestionsLoading,
    betterDaySuggestionsNote,
    localizeUnitText,
    formatIsoDateLabel,
    setForecastDate,
    setError,

    // Travel Window card
    peakCriticalWindow,
    travelWindowInsights,
    travelWindowRows,
    formatTravelWindowSpan,
    windThresholdDisplay,
    feelsLikeThresholdDisplay,
    activeTravelThresholdPreset,
    onApplyTravelThresholdPreset,
    travelThresholdEditorOpen,
    setTravelThresholdEditorOpen,
    windUnitLabel,
    windThresholdMin,
    windThresholdMax,
    windThresholdStep,
    maxWindGustDraft,
    handleWindThresholdDisplayChange,
    handleWindThresholdDisplayBlur,
    maxPrecipChanceDraft,
    handleMaxPrecipChanceDraftChange,
    handleMaxPrecipChanceDraftBlur,
    tempUnitLabel,
    feelsLikeThresholdMin,
    feelsLikeThresholdMax,
    feelsLikeThresholdStep,
    minFeelsLikeDraft,
    handleFeelsLikeThresholdDisplayChange,
    handleFeelsLikeThresholdDisplayBlur,
    travelWindowSummary,
    criticalWindow,
    travelWindowExpanded,
    setTravelWindowExpanded,
    visibleCriticalWindowRows,
    travelWindowHoursLabel,

    // Critical Checks card
    topCriticalAttentionChecks,
    criticalCheckFailCount,
    describeFailedCriticalCheck,

    // Score Trace card
    dayOverDay,
    shouldRenderRankedCard,

    // Weather card
    weatherCardTemp,
    weatherCardWind,
    weatherCardFeelsLike,
    weatherCardWithEmoji,
    weatherCardPrecip,
    weatherCardHumidity,
    weatherCardDewPoint,
    weatherCardDescription,
    weatherCardDisplayTime,
    weatherForecastPeriodLabel,
    weatherPreviewActive,
    weatherPressureTrendSummary,
    pressureTrendDirection,
    pressureDeltaLabel,
    pressureRangeLabel,
    weatherHourQuickOptions,
    selectedWeatherHourIndex,
    handleWeatherHourSelect,
    weatherConditionEmojiValue,
    weatherTrendChartData,
    weatherTrendHasData,
    weatherTrendMetric,
    weatherTrendMetricLabel,
    weatherTrendMetricOptions,
    weatherTrendLineColor,
    weatherTrendYAxisDomain,
    weatherTrendTickFormatter,
    formatWeatherTrendValue,
    onTrendMetricChange,
    handleWeatherTrendChartClick,
    selectedWeatherHourValue,
    formattedWind,
    formattedGust,
    weatherCardPressureLabel,
    weatherPressureContextLine,
    weatherCardWindDirection,
    weatherCardCloudCoverLabel,
    weatherVisibilityScoreLabel,
    weatherVisibilityActiveWindowText,
    weatherVisibilityScoreMeaning,
    weatherVisibilityContextLine,
    targetElevationInput,
    handleTargetElevationChange,
    handleTargetElevationStep,
    canDecreaseTargetElevation,
    hasTargetElevation,
    targetElevationForecast,
    targetElevationFt,
    TARGET_ELEVATION_STEP_FEET,
    elevationUnitLabel,
    elevationForecastBands,
    objectiveElevationFt,
    safeWeatherLink,
    weatherLinkCta,
    weatherSourceDisplay,
    formatPubTime,
    weatherTrendTempRange,
    getDangerLevelClass,
    getDangerText,

    // Heat Risk card
    heatRiskGuidance,
    heatRiskReasons,
    heatRiskMetrics,
    heatRiskPillClass,
    heatRiskLabel,
    lowerTerrainHeatLabel,

    // Terrain card
    terrainConditionDetails,
    terrainConditionPillClass,
    rainfall12hDisplay,
    rainfall48hDisplay,
    snowfall12hDisplay,
    snowfall24hDisplay,
    snowfall48hDisplay,
    snowfall12hIn: _snowfall12hIn,
    snowfall24hIn,
    snowfall48hIn: _snowfall48hIn,

    // Rainfall card
    precipInsightLine,
    expectedPrecipSummaryLine,
    expectedTravelWindowHours,
    expectedRainWindowDisplay,
    expectedSnowWindowIn: _expectedSnowWindowIn,
    expectedSnowWindowDisplay,
    rainfallExpected,
    precipitationDisplayTimezone,
    expectedPrecipNoteLine,
    rainfallModeLabel,
    rainfallPayload,
    rainfallNoteLine,
    safeRainfallLink,
    formatForecastPeriodLabel,

    // Wind Loading card
    windLoadingHintsRelevant,
    windLoadingLevel,
    windLoadingConfidence: _windLoadingConfidence,
    windLoadingPillClass,
    windLoadingActiveWindowLabel,
    windLoadingActiveHoursDetail,
    resolvedWindDirectionSource,
    trendAgreementRatio,
    windLoadingElevationFocus,
    leewardAspectHints,
    secondaryWindAspects,
    windGustMph,
    windLoadingNotes,
    aspectOverlapProblems,
    windLoadingSummary,
    windLoadingActionLine,
    avalancheUnknown,

    // Source Freshness card
    sourceFreshnessRows,
    reportGeneratedAt,
    avalancheExpiredForSelectedStart,
    formatAgeFromNow,

    // NWS Alerts card
    nwsAlertCount,
    nwsTotalAlertCount,
    nwsTopAlerts,

    // Air Quality card
    airQualityPillClassFn,
    airQualityFutureNotApplicable,

    // Snowpack card
    snowpackInsights,
    snotelDistanceDisplay,
    snotelDepthDisplay,
    snotelSweDisplay,
    nohrscDepthDisplay,
    nohrscSweDisplay,
    cdecDepthDisplay,
    cdecSweDisplay,
    cdecDistanceDisplay,
    snowpackPillClass,
    snowpackStatusLabel,
    snowpackHistoricalStatusLabel,
    snowpackHistoricalPillClass,
    snowpackHistoricalComparisonLine,
    snowpackInterpretation,
    snowpackTakeaways,
    snowfallWindowSummary,
    rainfallWindowSummary,
    snowpackObservationContext,
    safeSnotelLink,
    safeNohrscLink,
    safeCdecLink,

    // Fire Risk card
    fireRiskLabel,
    fireRiskPillClass,
    fireRiskAlerts,

    // Plan Snapshot card
    sunriseMinutesForPlan,
    sunsetMinutesForPlan,
    startMinutesForPlan,
    returnMinutes,
    daylightRemainingFromStartLabel,

    // Gear card
    gearRecommendations,

    // Avalanche forecast card
    overallAvalancheLevel,
    avalancheNotApplicableReason,
    avalancheElevationRows,
    safeAvalancheLink,
    normalizeDangerLevel,
    getDangerGlyph,
    summarizeText,
    toPlainText,

    // Deep Dive card
    safeShareLink,
    weatherFieldSources,
    weatherCloudCover,
    weatherBlended,
    rawReportPayload,
    copiedRawPayload,
    handleCopyRawPayload,

    // Footer
    formatGeneratedAt,
  } = props;

  // Derived values used inline
  const criticalCheckTotal = orderedCriticalChecks.length;
  const criticalCheckPassCount = criticalCheckTotal - criticalCheckFailCount;

  return (
    <div key="view-planner" className={appShellClassName} aria-busy={isViewPending}>
      <a href="#planner-main-content" className="skip-nav">Skip to main content</a>
      <header className="header-section">
        <div className="brand">
          <button
            type="button"
            className="brand-mark brand-home-btn"
            onClick={() => navigateToView('home')}
            aria-label="Go to homepage"
            title="Homepage"
          >
            <img src="/summitsafe-icon.svg" alt="Backcountry Conditions" className="brand-mark-icon" />
          </button>
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

          <nav className="header-nav" aria-label="Planner controls">
            <button type="button" className="secondary-btn header-nav-btn" onClick={() => navigateToView('settings')}>
              <SlidersHorizontal size={14} /> <span className="nav-btn-label">Settings</span>
            </button>
            {hasObjective && (
              <button type="button" className="secondary-btn header-nav-btn" onClick={handleToggleSaveObjective}>
                {objectiveIsSaved ? <BookmarkCheck size={14} /> : <BookmarkPlus size={14} />}{' '}
                <span className="nav-btn-label">{objectiveIsSaved ? 'Saved' : 'Save'}</span>
              </button>
            )}
            <button type="button" className="secondary-btn header-nav-btn" onClick={handleCopyLink}>
              {copiedLink ? <Check size={14} /> : <Link2 size={14} />} <span className="nav-btn-label">{copiedLink ? 'Copied' : 'Share'}</span>
            </button>
          </nav>
        </div>
      </header>

      <section className="map-shell" id="planner-main-content">
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

          {/* ── Map overlays ── */}
          <div className="map-overlay map-overlay-tr">
            <button
              type="button"
              className={`map-overlay-btn ${mapStyle === 'street' ? 'is-active' : ''}`}
              onClick={() => setMapStyle(mapStyle === 'topo' ? 'street' : 'topo')}
              title={`Switch to ${mapStyle === 'topo' ? 'street' : 'terrain'} basemap`}
              aria-label={`Switch to ${mapStyle === 'topo' ? 'street' : 'terrain'} basemap`}
            >
              <Layers size={16} />
            </button>
            <button
              type="button"
              className="map-overlay-btn"
              onClick={handleUseCurrentLocation}
              disabled={locatingUser}
              title={locatingUser ? 'Locating...' : 'Use my location'}
              aria-label="Use my location"
            >
              <LocateFixed size={16} />
            </button>
            <button
              type="button"
              className="map-overlay-btn"
              onClick={handleRecenterMap}
              title="Recenter map"
              aria-label="Recenter map"
            >
              <Navigation size={16} />
            </button>
          </div>

          <div className="map-overlay map-overlay-bl">
            <span className="map-overlay-coords">
              {position.lat.toFixed(4)}, {position.lng.toFixed(4)}
            </span>
          </div>

          {hasObjective && (
            <div className="map-overlay map-overlay-br">
              <span className={`map-overlay-info ${safetyData ? '' : 'is-pending'}`} title={mapElevationChipTitle}>
                <Mountain size={12} aria-hidden="true" />
                <span className="map-elevation-value">{mapElevationLabel}</span>
              </span>
              <span className={`map-overlay-info ${safetyData ? '' : 'is-pending'}`} title={mapWeatherChipTitle}>
                <span className="map-weather-chip-emoji" aria-hidden="true">{mapWeatherEmoji}</span>
                <span className="map-weather-chip-temp">{mapWeatherTempLabel}</span>
                <span className="map-weather-chip-condition">{mapWeatherConditionLabel}</span>
              </span>
            </div>
          )}
        </div>

        {/* ── Flat below-map controls ── */}
        <div className={`map-actions ${mobileMapControlsExpanded ? '' : 'is-collapsed'}`}>
          <button
            type="button"
            className="mobile-map-controls-btn"
            onClick={() => setMobileMapControlsExpanded((prev) => {
              const next = !prev;
              try { window.localStorage.setItem('summitsafe:mobile-controls-expanded', String(next)); } catch { /* ignore */ }
              return next;
            })}
            aria-expanded={mobileMapControlsExpanded}
            aria-controls="map-actions-flat"
          >
            <SlidersHorizontal size={14} />
            {mobileMapControlsExpanded ? 'Hide plan controls' : 'Show plan controls'}
          </button>

          <div id="map-actions-flat" className="map-actions-flat">
            <label className="date-control">
              <span>Date</span>
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

            <label className="date-control compact travel-window-control">
              <span>Trip hours</span>
              <input
                type="number"
                inputMode="numeric"
                aria-label="Trip duration in hours"
                title="How many hours to evaluate from the selected start time."
                min={MIN_TRAVEL_WINDOW_HOURS}
                max={MAX_TRAVEL_WINDOW_HOURS}
                step={1}
                value={travelWindowHoursDraft}
                onChange={handleTravelWindowHoursDraftChange}
                onBlur={handleTravelWindowHoursDraftBlur}
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
          </div>

          <div className="map-actions-utils">
            <button type="button" className="action-btn" onClick={handleRetryFetch} disabled={!hasObjective || loading}>
              <RefreshCw size={14} className={loading ? 'spin' : ''} /> {loading ? 'Refreshing...' : 'Refresh'}
            </button>
            <button type="button" className="settings-btn" onClick={openTripToolView}>
              <CalendarDays size={14} /> Multi-day
            </button>
            <button type="button" className="settings-btn" onClick={() => { if (satelliteConditionLine) { navigator.clipboard.writeText(satelliteConditionLine); } }} disabled={!satelliteConditionLine} title={satelliteConditionLine || 'SAT one-liner (load a report first)'}>
              <Zap size={14} /> SAT Msg
            </button>

            <div className="map-ext-links">
              <a href={`https://caltopo.com/map.html#ll=${position.lat},${position.lng}&z=14&b=mbt`} target="_blank" rel="noreferrer" className="map-ext-link-btn" title="CalTopo">
                <MapIcon size={15} />
              </a>
              <a href={`https://www.gaiagps.com/map/?lat=${position.lat}&lon=${position.lng}&zoom=14`} target="_blank" rel="noreferrer" className="map-ext-link-btn" title="Gaia GPS">
                <Compass size={15} />
              </a>
              <a href={`https://www.windy.com/?${position.lat},${position.lng},12`} target="_blank" rel="noreferrer" className="map-ext-link-btn" title="Windy">
                <Wind size={15} />
              </a>
            </div>
          </div>

          {timezoneMismatch && (
            <p className="map-time-help is-warning">
              Objective timezone: <strong>{objectiveTimezone}</strong>. Your device timezone is <strong>{deviceTimezone}</strong>. Times in this report are objective-local.
            </p>
          )}
        </div>
      </section>

      {!hasObjective && (
        <div className="empty-state">
          <h3>Select a location to start planning</h3>
          <p>Search for a peak, trail area, zone, or click the map to place a pin.</p>
        </div>
      )}

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
              <button className="settings-btn" onClick={handleRetryFetch}>
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
        <section className="top-freshness-alert coverage-warning" role="status">
          <strong>Limited coverage</strong>
          <span>Primary data sources (NOAA, NWS, SNOTEL, avalanche centers) are US-focused. Forecasts, alerts, and snowpack data outside the US may be degraded or unavailable.</span>
        </section>
      )}

      {hasObjective && safetyData && safetyData.partialData && (
        <section className="top-freshness-alert coverage-warning" role="status" aria-live="assertive">
          <strong>Incomplete data</strong>
          <span>{safetyData.apiWarning || 'One or more upstream data providers failed. Some report sections may be missing or degraded.'}</span>
        </section>
      )}

      {hasObjective && safetyData && decision && (
        <nav className="planner-jump-nav" aria-label="Quick report navigation">
          <button type="button" className="planner-jump-btn" onClick={() => jumpToPlannerSection('planner-section-decision')}>
            Decision
          </button>
          <button type="button" className="planner-jump-btn" onClick={() => jumpToPlannerSection('planner-section-travel')}>
            Travel
          </button>
          <button type="button" className="planner-jump-btn" onClick={() => jumpToPlannerSection('planner-section-weather')}>
            Weather
          </button>
          {avalancheRelevant && (
            <button type="button" className="planner-jump-btn" onClick={() => jumpToPlannerSection('planner-section-avalanche')}>
              Avalanche
            </button>
          )}
          <button type="button" className="planner-jump-btn" onClick={() => jumpToPlannerSection('planner-section-alerts')}>
            Alerts
          </button>
          <button type="button" className="planner-jump-btn" onClick={() => jumpToPlannerSection('planner-section-gear')}>
            Gear
          </button>
        </nav>
      )}

      {hasObjective && safetyData && decision && (
        <div className="data-grid" role="main" aria-label="Conditions report">
          <h2 className="sr-only">Conditions Report</h2>
          <div className="score-card" role="region" aria-label={`Safety score: ${safetyData.safety.score}%, ${safetyData.safety.score >= 80 ? 'Low Risk' : safetyData.safety.score >= 50 ? 'Elevated Risk' : 'High Risk'}`} style={{ borderColor: getScoreColor(safetyData.safety.score), order: reportCardOrder.scoreCard }}>
            <div className="score-left">
              <ScoreGauge score={safetyData.safety.score} scoreColor={getScoreColor(safetyData.safety.score)} />
              {Array.isArray(safetyData.safety.factors) && safetyData.safety.factors.length > 0 && (
                <div className="score-top-factors">
                  {safetyData.safety.factors
                    .slice()
                    .sort((a, b) => Math.abs(Number(b.impact || 0)) - Math.abs(Number(a.impact || 0)))
                    .slice(0, 2)
                    .map((f, idx) => (
                      <div key={idx} className="score-top-factor-row">
                        <span className="score-top-factor-impact">−{Math.abs(Math.round(Number(f.impact || 0)))}</span>
                        <span className="score-top-factor-label">{f.hazard || 'Factor'}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
            <div className="score-meta">
              <span className={`status-badge ${safetyData.safety.score >= 80 ? 'is-low-risk' : safetyData.safety.score >= 50 ? 'is-elevated-risk' : 'is-high-risk'}`}>
                {safetyData.safety.score >= 80 ? 'Low Risk' : safetyData.safety.score >= 50 ? 'Elevated Risk' : 'High Risk'}
              </span>
              <div className="hazard-badge">
                <AlertTriangle size={12} /> {safetyData.safety.primaryHazard}
              </div>
              <div className="objective-line">
                {objectiveName || 'Objective'} · {displayStartTime}{returnTimeFormatted ? ` – ${formatClockForStyle(returnTimeFormatted, preferences.timeStyle)}` : ''}
              </div>
              {(loading || error) && (
                <div className="source-line">
                  {loading ? 'Loading new data…' : 'Using last successful report.'}
                </div>
              )}
              <div className="score-ai-brief">
                {aiBriefNarrative ? (
                  <p className="score-ai-narrative"><Sparkles size={12} /> {aiBriefNarrative}</p>
                ) : aiBriefError ? (
                  <div className="score-ai-error">
                    <span>{aiBriefError}</span>
                    <button type="button" className="btn-ai-brief" onClick={handleRequestAiBriefAction}>Retry</button>
                  </div>
                ) : (
                  <button type="button" className="btn-ai-brief" onClick={handleRequestAiBriefAction} disabled={aiBriefLoading}>
                    {aiBriefLoading
                      ? <><Loader2 size={12} className="spinner" /> Generating...</>
                      : <><Sparkles size={12} /> AI Analysis</>}
                  </button>
                )}
              </div>
            </div>
          </div>

          {objectiveName && (
            <div className="route-analysis-section" style={{ order: reportCardOrder.reportColumns - 1 }}>
              {!routeSuggestions && !routeAnalysis && !routeLoading && (
                <button
                  type="button"
                  className="route-analyze-btn"
                  onClick={() => fetchRouteSuggestions(objectiveName, position.lat, position.lng)}
                >
                  Analyze Full Route
                </button>
              )}

              {routeLoading && (
                <div className="route-loading">
                  <div className="route-loading-dots">
                    <span /><span /><span />
                  </div>
                  <div className="route-loading-label">
                    {routeAnalysis === null && routeSuggestions ? 'Running safety checks along route...' : 'Fetching routes...'}
                  </div>
                </div>
              )}

              {routeError && (
                <div className="route-error">{routeError}</div>
              )}

              {routeSuggestions && !routeAnalysis && !routeLoading && (
                <div className="route-picker-card">
                  <div className="route-picker-header">Choose a route to analyze</div>
                  <ul className="route-picker-list">
                    {routeSuggestions.map((r) => (
                      <li key={r.name} className="route-picker-item">
                        <button
                          type="button"
                          className="route-picker-option"
                          onClick={() => fetchRouteAnalysis(objectiveName, r.name, position.lat, position.lng, forecastDate, alpineStartTime, travelWindowHours)}
                        >
                          <span className="route-option-name">{r.name}</span>
                          <span className="route-option-meta">{r.distance_rt_miles}mi RT &middot; {r.elev_gain_ft.toLocaleString()}ft &middot; {r.class}</span>
                          <span className="route-option-desc">{r.description}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="route-picker-custom">
                    <input
                      type="text"
                      placeholder="Or type a route name…"
                      value={customRouteName}
                      onChange={(e) => setCustomRouteName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && customRouteName.trim()) {
                          fetchRouteAnalysis(objectiveName, customRouteName.trim(), position.lat, position.lng, forecastDate, alpineStartTime, travelWindowHours);
                          setCustomRouteName('');
                        }
                      }}
                    />
                    <button
                      type="button"
                      disabled={!customRouteName.trim()}
                      onClick={() => {
                        fetchRouteAnalysis(objectiveName, customRouteName.trim(), position.lat, position.lng, forecastDate, alpineStartTime, travelWindowHours);
                        setCustomRouteName('');
                      }}
                    >
                      Go
                    </button>
                  </div>
                  <button
                    type="button"
                    className="route-picker-cancel"
                    onClick={() => { setRouteSuggestions(null); setRouteError(null); setCustomRouteName(''); }}
                  >
                    Cancel
                  </button>
                </div>
              )}

              {routeAnalysis && (
                <div className="route-analysis-card">
                  <div className="route-analysis-header">Route Analysis <span className="route-ai-badge">AI Advisory</span></div>
                  <p className="route-analysis-disclaimer">Waypoint locations and recommendations are AI-estimated. Cross-reference against CalTopo or Gaia GPS before committing.</p>
                  <div className="route-waypoints">
                    {routeAnalysis.summaries.map((wp, i) => {
                      const wpCoords = routeAnalysis.waypoints[i];
                      const wpReportParams = new URLSearchParams({
                        lat: String(wpCoords?.lat ?? ''),
                        lon: String(wpCoords?.lon ?? ''),
                        name: wp.name,
                        date: forecastDate,
                        start: alpineStartTime,
                        travel_window_hours: String(travelWindowHours),
                      });
                      return (
                        <div key={wp.name} className="route-waypoint-row">
                          <span className="route-wp-name">{wp.name}</span>
                          <span className="route-wp-elev">{wp.elev_ft.toLocaleString()}ft</span>
                          {wp.weather.temp != null && (
                            <span className="route-wp-temp">{formatTempDisplay(wp.weather.temp)}</span>
                          )}
                          {wp.score !== null && (
                            <span className="route-wp-score" style={{ color: getScoreColor(wp.score) }}>{wp.score}%</span>
                          )}
                          {wp.avalanche?.risk && (
                            <span className="route-wp-avy">{wp.avalanche.risk}</span>
                          )}
                          {wpCoords && (
                            <a
                              href={`/?${wpReportParams.toString()}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="route-wp-link"
                              title={`Open full report for ${wp.name}`}
                            >
                              <ExternalLink size={13} />
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <RouteConditionsProfile
                    waypoints={routeAnalysis.summaries}
                    getScoreColor={getScoreColor}
                    formatTempDisplay={formatTempDisplay}
                    formatWindDisplay={formatWindDisplay}
                    formatElevationDisplay={formatElevationDisplay}
                  />
                  <div className="route-analysis-text">
                    {renderSimpleMarkdown(routeAnalysis.analysis)}
                  </div>
                </div>
              )}
            </div>
          )}

          {(weatherVisibilityRisk.level === 'Moderate' || weatherVisibilityRisk.level === 'High' || weatherVisibilityRisk.level === 'Extreme') && (
            <div className={`visibility-banner visibility-banner-${weatherVisibilityPill}`} style={{ order: reportCardOrder.reportColumns }}>
              <Eye size={14} /> Visibility risk: <strong>{weatherVisibilityRisk.level}</strong>{weatherVisibilityDetail ? ` — ${weatherVisibilityDetail}` : ''}
            </div>
          )}

          <div className="report-columns" style={{ order: reportCardOrder.reportColumns }}>
            <div className="report-column">
              <CollapsibleCard
                cardKey="decisionGate"
                domId="planner-section-decision"
                defaultExpanded={false}
                order={reportCardOrder.decisionGate}
                className="decision-card"
                title={<span className="card-title"><ShieldCheck size={14} /> Decision</span>}
                headerMeta={<span className={`decision-pill ${decision.level.toLowerCase().replace('-', '')}`}>{decision.level}</span>}
                summary={<>{decision.level}{decision.blockers.length > 0 ? ` · ${decision.blockers[0]}` : decision.cautions.length > 0 ? ` · ${decision.cautions[0]}` : ''}</>}
                preview={<>
                  <div className={`card-preview-hero ${decision.level.toLowerCase().replace('-', '')}`}>{decision.level}</div>
                  <div className="card-preview-caption">{decision.headline}</div>
                </>}
              >
                <DecisionGateCard
                  decision={decision}
                  decisionActionLine={decisionActionLine}
                  fieldBriefPrimaryReason={fieldBriefPrimaryReason}
                  fieldBriefTopRisks={fieldBriefTopRisks}
                  rainfall24hSeverityClass={rainfall24hSeverityClass}
                  rainfall24hDisplay={rainfall24hDisplay}
                  decisionPassingChecksCount={decisionPassingChecksCount}
                  decisionFailingChecks={decisionFailingChecks}
                  decisionKeyDrivers={decisionKeyDrivers}
                  orderedCriticalChecks={orderedCriticalChecks}
                  betterDaySuggestions={betterDaySuggestions ?? []}
                  betterDaySuggestionsLoading={betterDaySuggestionsLoading}
                  betterDaySuggestionsNote={betterDaySuggestionsNote}
                  timeStyle={preferences.timeStyle}
                  localizeUnitText={localizeUnitText}
                  formatIsoDateLabel={formatIsoDateLabel}
                  formatWindDisplay={formatWindDisplay}
                  setForecastDate={setForecastDate}
                  setError={setError}
                />
              </CollapsibleCard>

              <CollapsibleCard
                cardKey="travelWindowPlanner"
                domId="planner-section-travel"
                defaultExpanded={false}
                order={reportCardOrder.travelWindowPlanner}
                className="projection-card"
                title={<span className="card-title">Travel Window ({travelWindowHoursLabel})</span>}
                summary={travelWindowInsights.bestWindow ? `Best: ${formatTravelWindowSpan(travelWindowInsights.bestWindow, preferences.timeStyle)} (${travelWindowInsights.bestWindow.length}h)` : 'No safe window'}
                preview={<>
                  <div className="card-preview-hero mono">{travelWindowInsights.bestWindow ? formatTravelWindowSpan(travelWindowInsights.bestWindow, preferences.timeStyle) : 'No safe window'}</div>
                  <div className="card-preview-caption">{travelWindowInsights.bestWindow ? `${travelWindowInsights.bestWindow.length}h clear` : 'All hours have violations'}</div>
                </>}
              >
              <TravelWindowPlannerCard
                peakCriticalWindow={peakCriticalWindow}
                timeStyle={preferences.timeStyle}
                criticalRiskLevelText={criticalRiskLevelText}
                localizeUnitText={localizeUnitText}
                travelWindowInsights={travelWindowInsights}
                travelWindowRows={travelWindowRows}
                travelWindowHours={travelWindowHours}
                formatTravelWindowSpan={formatTravelWindowSpan}
                windThresholdDisplay={windThresholdDisplay}
                maxPrecipChance={preferences.maxPrecipChance}
                feelsLikeThresholdDisplay={feelsLikeThresholdDisplay}
                activeTravelThresholdPreset={activeTravelThresholdPreset}
                travelThresholdPresets={TRAVEL_THRESHOLD_PRESETS}
                onApplyTravelThresholdPreset={onApplyTravelThresholdPreset}
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
                formatTempDisplay={formatTempDisplay}
                formatWindDisplay={formatWindDisplay}
              />
              </CollapsibleCard>

              {shouldRenderRankedCard('criticalChecks') && (
                <CollapsibleCard
                  cardKey="criticalChecks"
                  defaultExpanded={false}
                  order={reportCardOrder.criticalChecks}
                  className="checks-card"
                  title={<span className="card-title"><CheckCircle2 size={14} /> Critical Checks</span>}
                  headerMeta={<span className={`decision-pill ${criticalCheckFailCount === 0 ? 'go' : 'caution'}`}>{criticalCheckPassCount}/{criticalCheckTotal} passing</span>}
                  summary={`${criticalCheckPassCount} passed · ${criticalCheckFailCount} attention`}
                  preview={<>
                    <div className={`card-preview-hero mono ${criticalCheckFailCount === 0 ? 'go' : 'caution'}`}>{criticalCheckPassCount}/{criticalCheckTotal}</div>
                    <div className="card-preview-caption">{criticalCheckFailCount === 0 ? 'All passing' : `${criticalCheckFailCount} need attention`}</div>
                  </>}
                >
                <CriticalChecksCard
                  orderedCriticalChecks={orderedCriticalChecks}
                  topCriticalAttentionChecks={topCriticalAttentionChecks}
                  criticalCheckFailCount={criticalCheckFailCount}
                  localizeUnitText={localizeUnitText}
                  describeFailedCriticalCheck={describeFailedCriticalCheck}
                />
                </CollapsibleCard>
              )}

              {shouldRenderRankedCard('scoreTrace') && (
                <CollapsibleCard
                  cardKey="scoreTrace"
                  defaultExpanded={false}
                  order={reportCardOrder.scoreTrace}
                  className="score-trace-card"
                  title={<span className="card-title"><ShieldCheck size={14} /> Score Breakdown</span>}
                  headerMeta={dayOverDay ? <span className={`decision-pill ${dayOverDay.delta <= -1 ? 'nogo' : dayOverDay.delta >= 1 ? 'go' : 'caution'}`}>{dayOverDay.delta > 0 ? '+' : ''}{dayOverDay.delta} vs {dayOverDay.previousDate}</span> : undefined}
                  summary={`${Array.isArray(safetyData.safety.factors) ? safetyData.safety.factors.length : 0} factors`}
                  preview={(() => {
                    const factors = Array.isArray(safetyData.safety.factors) ? safetyData.safety.factors : [];
                    const topFactor = factors.slice().sort((a, b) => Math.abs(Number(b.impact || 0)) - Math.abs(Number(a.impact || 0)))[0];
                    return <>
                      <div className="card-preview-hero">{topFactor?.hazard || 'No factors'}</div>
                      <div className="card-preview-caption">{topFactor ? `${(topFactor.impact || 0) >= 0 ? '-' : '+'}${Math.abs(Math.round(Number(topFactor.impact || 0)))} · ${topFactor.message || 'No detail'}` : 'No factor-level trace available'}</div>
                      {dayOverDay && <div className="card-preview-row"><span className="card-preview-chip">{dayOverDay.delta > 0 ? '+' : ''}{dayOverDay.delta} vs {dayOverDay.previousDate}</span></div>}
                    </>;
                  })()}
                >
                <ScoreTraceCard
                  factors={safetyData.safety.factors}
                  dayOverDay={dayOverDay}
                />
                </CollapsibleCard>
              )}
            </div>

            <div className="report-column">
              <CollapsibleCard
                cardKey="atmosphericData"
                domId="planner-section-weather"
                defaultExpanded={false}
                order={reportCardOrder.atmosphericData}
                className="weather-card"
                title={<span className="card-title"><Thermometer size={14} /> Weather</span>}
                headerMeta={<span className={`forecast-badge ${safetyData.forecast?.isFuture ? 'future' : ''}`}>{safetyData.forecast?.isFuture ? 'Forecast' : 'Current'}</span>}
                summary={`${formatTempDisplay(weatherCardTemp)} · Wind ${formatWindDisplay(weatherCardWind)}`}
                preview={<>
                  <div className="card-preview-hero mono">{formatTempDisplay(weatherCardTemp)}</div>
                  <div className="card-preview-caption">{weatherCardWithEmoji} · Wind {formatWindDisplay(weatherCardWind)}</div>
                </>}
              >
                <WeatherCardContent
                  formattedTemp={formatTempDisplay(weatherCardTemp)}
                  formattedFeelsLike={formatTempDisplay(weatherCardFeelsLike)}
                  trendTempRange={weatherTrendTempRange}
                  conditionText={weatherCardWithEmoji}
                  conditionIsCold={/snow|blizzard|sleet|freezing|ice pellet|wintry/i.test(weatherCardDescription)}
                  displayTime={weatherCardDisplayTime}
                  forecastPeriodLabel={weatherForecastPeriodLabel}
                  previewActive={weatherPreviewActive}
                  pressureTrendSummary={weatherPressureTrendSummary}
                  pressureTrendDirection={pressureTrendDirection}
                  pressureDeltaLabel={pressureDeltaLabel}
                  pressureRangeLabel={pressureRangeLabel}
                  hourOptions={weatherHourQuickOptions}
                  selectedHourIndex={selectedWeatherHourIndex}
                  onHourSelect={handleWeatherHourSelect}
                  weatherConditionEmoji={weatherConditionEmojiValue}
                  trendChartData={weatherTrendChartData}
                  trendHasData={weatherTrendHasData}
                  trendMetric={weatherTrendMetric}
                  trendMetricLabel={weatherTrendMetricLabel}
                  trendMetricOptions={weatherTrendMetricOptions}
                  trendLineColor={weatherTrendLineColor}
                  trendYAxisDomain={weatherTrendYAxisDomain}
                  trendTickFormatter={weatherTrendTickFormatter}
                  formatWeatherTrendValue={formatWeatherTrendValue}
                  onTrendMetricChange={(key) => onTrendMetricChange(key)}
                  onTrendChartClick={handleWeatherTrendChartClick}
                  selectedHourValue={selectedWeatherHourValue}
                  travelWindowHoursLabel={travelWindowHoursLabel}
                  formattedWind={formattedWind}
                  formattedGust={formattedGust}
                  precipLabel={Number.isFinite(weatherCardPrecip) ? `${weatherCardPrecip}%` : 'N/A'}
                  humidityLabel={Number.isFinite(weatherCardHumidity) ? `${Math.round(weatherCardHumidity)}%` : 'N/A'}
                  dewPointLabel={formatTempDisplay(weatherCardDewPoint)}
                  pressureLabel={weatherCardPressureLabel}
                  pressureContextLine={weatherPressureContextLine}
                  windDirection={weatherCardWindDirection}
                  cloudCoverLabel={weatherCardCloudCoverLabel}
                  visibilityScoreLabel={weatherVisibilityScoreLabel}
                  visibilityPill={weatherVisibilityPill}
                  visibilityRiskLevel={weatherVisibilityRisk.level}
                  visibilityActiveWindowText={weatherVisibilityActiveWindowText}
                  visibilityScoreMeaning={weatherVisibilityScoreMeaning}
                  visibilityDetail={weatherVisibilityDetail}
                  visibilityContextLine={weatherVisibilityContextLine}
                  targetElevationInput={targetElevationInput}
                  onTargetElevationChange={handleTargetElevationChange}
                  onTargetElevationStep={handleTargetElevationStep}
                  canDecreaseTargetElevation={canDecreaseTargetElevation}
                  hasTargetElevation={hasTargetElevation}
                  targetElevationForecast={targetElevationForecast}
                  targetElevationFt={targetElevationFt}
                  targetElevationStepFeet={TARGET_ELEVATION_STEP_FEET}
                  elevationUnitLabel={elevationUnitLabel}
                  elevationForecastBands={elevationForecastBands}
                  objectiveElevationFt={objectiveElevationFt}
                  objectiveElevationLabel={formatElevationDisplay(safetyData.weather.elevation != null ? safetyData.weather.elevation : null)}
                  avalancheElevations={safetyData.avalanche.elevations}
                  elevationForecastNote={safetyData.weather.elevationForecastNote}
                  isBlended={!!safetyData.weather.sourceDetails?.blended}
                  safeWeatherLink={safeWeatherLink}
                  weatherLinkCta={weatherLinkCta}
                  formatTempDisplay={formatTempDisplay}
                  formatWindDisplay={formatWindDisplay}
                  formatElevationDisplay={formatElevationDisplay}
                  formatElevationDeltaDisplay={formatElevationDeltaDisplay}
                  localizeUnitText={localizeUnitText}
                  getDangerLevelClass={getDangerLevelClass}
                  getDangerText={getDangerText}
                />
              </CollapsibleCard>

              {shouldRenderRankedCard('heatRisk') && (
                <CollapsibleCard
                  cardKey="heatRisk"
                  defaultExpanded={false}
                  order={reportCardOrder.heatRisk}
                  className="heat-risk-card"
                  title={<span className="card-title"><Sun size={14} /> Heat Risk</span>}
                  headerMeta={<span className={`decision-pill ${heatRiskPillClass}`}>{String(heatRiskLabel || 'Low').toUpperCase()}</span>}
                  summary={String(heatRiskLabel || 'Low').toUpperCase()}
                  preview={<>
                    <div className={`card-preview-hero ${heatRiskPillClass}`}>{String(heatRiskLabel || 'Low').toUpperCase()}</div>
                    <div className="card-preview-caption">Feels {formatTempDisplay(heatRiskMetrics.feelsLikeF ?? safetyData.weather.feelsLike ?? safetyData.weather.temp)} · Humidity {Number.isFinite(Number(heatRiskMetrics.humidity ?? safetyData.weather.humidity)) ? `${Math.round(Number(heatRiskMetrics.humidity ?? safetyData.weather.humidity))}%` : 'N/A'}</div>
                  </>}
                >
                <HeatRiskCard
                  heatRiskGuidance={heatRiskGuidance}
                  heatRiskReasons={heatRiskReasons}
                  heatRiskMetrics={heatRiskMetrics}
                  safetyWeatherTemp={safetyData.weather.temp}
                  safetyWeatherFeelsLike={safetyData.weather.feelsLike}
                  safetyWeatherHumidity={safetyData.weather.humidity}
                  heatRiskSource={safetyData.heatRisk?.source || 'Derived from forecast temperature and humidity signals'}
                  travelWindowHours={travelWindowHours}
                  lowerTerrainHeatLabel={lowerTerrainHeatLabel}
                  localizeUnitText={localizeUnitText}
                  formatTempDisplay={formatTempDisplay}
                />
                </CollapsibleCard>
              )}

              {shouldRenderRankedCard('terrainTrailCondition') && (
                <CollapsibleCard
                  cardKey="terrainTrailCondition"
                  defaultExpanded={false}
                  order={reportCardOrder.terrainTrailCondition}
                  className="terrain-condition-card"
                  title={<span className="card-title"><Route size={14} /> Terrain</span>}
                  headerMeta={<span className={`decision-pill ${terrainConditionPillClass}`}>{safetyData.terrainCondition?.label || safetyData.trail || 'Unknown'}</span>}
                  summary={safetyData.terrainCondition?.label || safetyData.trail || 'Unknown'}
                  preview={<>
                    <div className="card-preview-hero">{safetyData.terrainCondition?.label || safetyData.trail || 'Unknown'}</div>
                    <div className="card-preview-caption">{terrainConditionDetails.summary}</div>
                  </>}
                >
                <TerrainCard
                  terrainConditionDetails={terrainConditionDetails}
                  rainfall12hDisplay={rainfall12hDisplay}
                  rainfall24hDisplay={rainfall24hDisplay}
                  rainfall48hDisplay={rainfall48hDisplay}
                  snowfall12hDisplay={snowfall12hDisplay}
                  snowfall24hDisplay={snowfall24hDisplay}
                  snowfall48hDisplay={snowfall48hDisplay}
                />
                </CollapsibleCard>
              )}

              {shouldRenderRankedCard('recentRainfall') && (
                <CollapsibleCard
                  cardKey="recentRainfall"
                  defaultExpanded={false}
                  order={reportCardOrder.recentRainfall}
                  className="rainfall-card"
                  title={<span className="card-title"><CloudRain size={14} /> Precipitation</span>}
                  headerMeta={<span className={`decision-pill ${rainfall24hSeverityClass}`}>24h rain {rainfall24hDisplay}{Number.isFinite(snowfall24hIn) ? ` · snow ${snowfall24hDisplay}` : ''}</span>}
                  summary={`${rainfall24hDisplay}/24h${Number.isFinite(snowfall24hIn) ? ` · snow ${snowfall24hDisplay}` : ''}`}
                  preview={<>
                    <div className="card-preview-hero mono">{rainfall24hDisplay}{Number.isFinite(snowfall24hIn) ? ` · ${snowfall24hDisplay}` : ''}</div>
                    <div className="card-preview-caption">Past 24h</div>
                  </>}
                >
                <RainfallCard
                  precipInsightLine={precipInsightLine}
                  expectedPrecipSummaryLine={expectedPrecipSummaryLine}
                  rainfall12hDisplay={rainfall12hDisplay}
                  rainfall24hDisplay={rainfall24hDisplay}
                  rainfall48hDisplay={rainfall48hDisplay}
                  snowfall12hDisplay={snowfall12hDisplay}
                  snowfall24hDisplay={snowfall24hDisplay}
                  snowfall48hDisplay={snowfall48hDisplay}
                  expectedTravelWindowHours={expectedTravelWindowHours}
                  expectedRainWindowDisplay={expectedRainWindowDisplay}
                  expectedSnowWindowDisplay={expectedSnowWindowDisplay}
                  rainfallExpectedStartTime={rainfallExpected?.startTime}
                  rainfallExpectedEndTime={rainfallExpected?.endTime}
                  precipitationDisplayTimezone={precipitationDisplayTimezone}
                  expectedPrecipNoteLine={expectedPrecipNoteLine}
                  rainfallModeLabel={rainfallModeLabel}
                  rainfallAnchorTime={rainfallPayload?.anchorTime}
                  rainfallNoteLine={rainfallNoteLine}
                  safeRainfallLink={safeRainfallLink}
                  rainfallSourceLabel={rainfallPayload?.source || 'Open-Meteo precipitation history (rain + snowfall)'}
                  formatForecastPeriodLabel={formatForecastPeriodLabel}
                />
                </CollapsibleCard>
              )}

              {(shouldRenderRankedCard('windLoading') || shouldRenderRankedCard('windLoadingHints')) && windLoadingHintsRelevant && (
                <CollapsibleCard
                  cardKey="windLoading"
                  defaultExpanded={false}
                  order={reportCardOrder.windLoading}
                  className="wind-loading-card"
                  title={<span className="card-title"><Wind size={14} /> Wind Loading</span>}
                  headerMeta={<span className={`decision-pill ${windLoadingPillClass}`}>{windLoadingLevel}</span>}
                  summary={`${windLoadingLevel} · ${formatWindDisplay(safetyData.weather.windSpeed)} ${safetyData.weather.windDirection || 'Calm'}`}
                  preview={<>
                    <div className="card-preview-hero">{windLoadingLevel}</div>
                    <div className="card-preview-caption">{formatWindDisplay(safetyData.weather.windSpeed)} {safetyData.weather.windDirection || 'Calm'}</div>
                  </>}
                >
                  <WindLoadingCard
                    windDirection={safetyData.weather.windDirection}
                    windGust={safetyData.weather.windGust}
                    avalancheProblems={safetyData.avalanche?.problems}
                  />
                  {avalancheUnknown && (
                    <p className="wind-coverage-note">No official forecast available — use wind loading as your primary terrain-selection signal.</p>
                  )}
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
                    <div className="wind-hint-meta-item wind-hint-meta-wide">
                      <span className="stat-label">Active Hours</span>
                      <strong>{windLoadingActiveHoursDetail}</strong>
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
                  {aspectOverlapProblems.length > 0 && (
                    <p className="wind-aspect-overlap-alert">
                      Wind loading aligns with active avalanche problem aspects: {aspectOverlapProblems.join(', ')}.
                    </p>
                  )}
                </CollapsibleCard>
              )}

              {shouldRenderRankedCard('sourceFreshness') && (
                <CollapsibleCard
                  cardKey="sourceFreshness"
                  defaultExpanded={false}
                  order={reportCardOrder.sourceFreshness}
                  className="source-freshness-card"
                  title={<span className="card-title"><Clock size={14} /> Source Freshness</span>}
                  summary={reportGeneratedAt ? `Updated ${formatAgeFromNow(reportGeneratedAt)}` : 'Freshness data unavailable'}
                  preview={<>
                    <div className="card-preview-hero mono">{reportGeneratedAt ? formatAgeFromNow(reportGeneratedAt) : 'N/A'}</div>
                    <div className="card-preview-caption">{reportGeneratedAt ? `Generated ${formatPubTime(reportGeneratedAt)}` : 'Freshness data unavailable'}</div>
                  </>}
                >
                <SourceFreshnessCard
                  sourceFreshnessRows={sourceFreshnessRows}
                  reportGeneratedAt={reportGeneratedAt}
                  avalancheExpiredForSelectedStart={avalancheExpiredForSelectedStart}
                  objectiveTimezone={objectiveTimezone}
                  deviceTimezone={deviceTimezone}
                  formatPubTime={formatPubTime}
                />
                </CollapsibleCard>
              )}

              <CollapsibleCard
                cardKey="nwsAlerts"
                domId="planner-section-alerts"
                defaultExpanded={false}
                order={reportCardOrder.nwsAlerts}
                className="nws-alerts-card"
                title={<span className="card-title"><AlertTriangle size={14} /> Alerts</span>}
                headerMeta={<span className={`decision-pill ${nwsAlertCount > 0 ? 'nogo' : 'go'}`}>{nwsAlertCount} active</span>}
                summary={nwsAlertCount > 0 ? `${nwsAlertCount} active` : 'None active'}
                preview={<>
                  <div className={`card-preview-hero ${nwsAlertCount > 0 ? 'nogo' : 'go'}`}>{nwsAlertCount > 0 ? `${nwsAlertCount} Active` : 'None'}</div>
                  <div className="card-preview-caption">{nwsTopAlerts.length > 0 ? nwsTopAlerts[0].event || 'Alert' : 'No active NWS alerts'}</div>
                </>}
              >
                <NwsAlertsCard
                  alertsSource={safetyData.alerts?.source || 'NWS CAP feed'}
                  highestSeverity={safetyData.alerts?.highestSeverity}
                  alertsStatus={safetyData.alerts?.status}
                  nwsTotalAlertCount={nwsTotalAlertCount}
                  nwsTopAlerts={nwsTopAlerts}
                  formatPubTime={formatPubTime}
                />
              </CollapsibleCard>

              {shouldRenderRankedCard('airQuality') && (
                <CollapsibleCard
                  cardKey="airQuality"
                  defaultExpanded={false}
                  order={reportCardOrder.airQuality}
                  className="air-quality-card"
                  title={<span className="card-title"><Wind size={14} /> Air Quality</span>}
                  headerMeta={<span className={`decision-pill ${airQualityFutureNotApplicable ? 'go' : airQualityPillClassFn(safetyData.airQuality?.usAqi)}`}>{airQualityFutureNotApplicable ? 'Current-day only' : `AQI ${Number.isFinite(Number(safetyData.airQuality?.usAqi)) ? Math.round(Number(safetyData.airQuality?.usAqi)) : 'N/A'}`}</span>}
                  summary={`AQI: ${Number.isFinite(Number(safetyData.airQuality?.usAqi)) ? Math.round(Number(safetyData.airQuality?.usAqi)) : 'N/A'} (${safetyData.airQuality?.category || 'Unknown'})`}
                  preview={<>
                    <div className={`card-preview-hero mono ${airQualityFutureNotApplicable ? '' : airQualityPillClassFn(safetyData.airQuality?.usAqi)}`}>AQI {Number.isFinite(Number(safetyData.airQuality?.usAqi)) ? Math.round(Number(safetyData.airQuality?.usAqi)) : 'N/A'}</div>
                    <div className="card-preview-caption">{safetyData.airQuality?.category || 'Unknown'}</div>
                  </>}
                >
                <AirQualityCard
                  category={safetyData.airQuality?.category || 'Unknown'}
                  pm25={safetyData.airQuality?.pm25}
                  pm10={safetyData.airQuality?.pm10}
                  ozone={safetyData.airQuality?.ozone}
                  airQualityFutureNotApplicable={airQualityFutureNotApplicable}
                  note={safetyData.airQuality?.note}
                  source={safetyData.airQuality?.source}
                  measuredTime={safetyData.airQuality?.measuredTime}
                  formatPubTime={formatPubTime}
                />
                </CollapsibleCard>
              )}

              {shouldRenderRankedCard('snowpackSnapshot') && (
                <CollapsibleCard
                  cardKey="snowpackSnapshot"
                  defaultExpanded={false}
                  order={reportCardOrder.snowpackSnapshot}
                  className="snowpack-card"
                  title={<span className="card-title"><Mountain size={14} /> Snowpack</span>}
                  headerMeta={<span className={`decision-pill ${snowpackPillClass}`}>{snowpackStatusLabel}</span>}
                  summary={snowpackStatusLabel}
                  preview={<>
                    <div className="card-preview-hero mono">{snotelDepthDisplay}</div>
                    <div className="card-preview-caption">{snowpackStatusLabel}</div>
                  </>}
                >
                <SnowpackCard
                  snowpackInsights={snowpackInsights}
                  snotelStationName={safetyData.snowpack?.snotel?.stationName}
                  snotelDistanceDisplay={snotelDistanceDisplay}
                  snotelDepthDisplay={snotelDepthDisplay}
                  snotelSweDisplay={snotelSweDisplay}
                  snotelObservedDate={safetyData.snowpack?.snotel?.observedDate}
                  nohrscDepthDisplay={nohrscDepthDisplay}
                  nohrscSweDisplay={nohrscSweDisplay}
                  nohrscSampledTime={safetyData.snowpack?.nohrsc?.sampledTime}
                  cdec={safetyData.snowpack?.cdec ? { stationName: safetyData.snowpack.cdec.stationName, stationCode: safetyData.snowpack.cdec.stationCode, observedDate: safetyData.snowpack.cdec.observedDate } : null}
                  cdecDepthDisplay={cdecDepthDisplay}
                  cdecSweDisplay={cdecSweDisplay}
                  cdecDistanceDisplay={cdecDistanceDisplay}
                  rainfall24hDisplay={rainfall24hDisplay}
                  snowfall24hDisplay={snowfall24hDisplay}
                  snowpackHistoricalStatusLabel={snowpackHistoricalStatusLabel}
                  snowpackHistoricalPillClass={snowpackHistoricalPillClass}
                  snowpackHistoricalComparisonLine={snowpackHistoricalComparisonLine}
                  snowpackInterpretation={snowpackInterpretation}
                  snowpackSummary={safetyData.snowpack?.summary}
                  snowpackTakeaways={snowpackTakeaways}
                  snowfallWindowSummary={snowfallWindowSummary}
                  rainfallWindowSummary={rainfallWindowSummary}
                  snowpackObservationContext={snowpackObservationContext}
                  safeSnotelLink={safeSnotelLink}
                  safeNohrscLink={safeNohrscLink}
                  safeCdecLink={safeCdecLink}
                  weatherTimezone={safetyData.weather?.timezone || null}
                  localizeUnitText={localizeUnitText}
                  formatForecastPeriodLabel={formatForecastPeriodLabel}
                />
                </CollapsibleCard>
              )}

              {shouldRenderRankedCard('fireRisk') && (
                <CollapsibleCard
                  cardKey="fireRisk"
                  defaultExpanded={false}
                  order={reportCardOrder.fireRisk}
                  className="fire-risk-card"
                  title={<span className="card-title"><Flame size={14} /> Fire Risk</span>}
                  headerMeta={<span className={`decision-pill ${fireRiskPillClass}`}>{fireRiskLabel.toUpperCase()}</span>}
                  summary={fireRiskLabel.toUpperCase()}
                  preview={<>
                    <div className={`card-preview-hero ${fireRiskPillClass}`}>{fireRiskLabel.toUpperCase()}</div>
                    <div className="card-preview-caption">{(safetyData.fireRisk?.guidance || 'No fire-risk guidance available.').slice(0, 100)}{(safetyData.fireRisk?.guidance || '').length > 100 ? '…' : ''}</div>
                  </>}
                >
                <FireRiskCard
                  guidance={safetyData.fireRisk?.guidance || 'No fire-risk guidance available.'}
                  reasons={safetyData.fireRisk?.reasons || []}
                  fireRiskAlerts={fireRiskAlerts}
                  source={safetyData.fireRisk?.source || 'Not provided'}
                  formatPubTime={formatPubTime}
                />
                </CollapsibleCard>
              )}

              {shouldRenderRankedCard('planSnapshot') && (
                <CollapsibleCard
                  cardKey="planSnapshot"
                  defaultExpanded={false}
                  order={reportCardOrder.planSnapshot}
                  className="plan-card"
                  title={<span className="card-title"><Sun size={14} /> Daylight</span>}
                  headerMeta={sunriseMinutesForPlan !== null && sunsetMinutesForPlan !== null ? <span className="plan-daylight-badge">{Math.floor((sunsetMinutesForPlan - sunriseMinutesForPlan) / 60)}h {(sunsetMinutesForPlan - sunriseMinutesForPlan) % 60}m daylight</span> : undefined}
                  summary={`Start ${displayStartTime} · ${daylightRemainingFromStartLabel} daylight`}
                  preview={<>
                    <div className="card-preview-hero mono">{displayStartTime}</div>
                    <div className="card-preview-caption">{daylightRemainingFromStartLabel} daylight</div>
                  </>}
                >
                <PlanSnapshotCard
                  sunriseMinutesForPlan={sunriseMinutesForPlan}
                  sunsetMinutesForPlan={sunsetMinutesForPlan}
                  startMinutesForPlan={startMinutesForPlan}
                  returnMinutes={returnMinutes}
                  displayStartTime={displayStartTime}
                  startLabel={startLabel}
                  daylightRemainingFromStartLabel={daylightRemainingFromStartLabel}
                  returnTimeFormatted={returnTimeFormatted}
                  sunriseValue={safetyData.solar.sunrise}
                  sunsetValue={safetyData.solar.sunset}
                  timeStyle={preferences.timeStyle}
                />
                </CollapsibleCard>
              )}

              {shouldRenderRankedCard('recommendedGear') && (
                <CollapsibleCard
                  cardKey="recommendedGear"
                  domId="planner-section-gear"
                  defaultExpanded={false}
                  order={reportCardOrder.recommendedGear}
                  className="gear-card"
                  title={<span className="card-title">Gear</span>}
                  summary={`${gearRecommendations.length} item${gearRecommendations.length !== 1 ? 's' : ''}`}
                  preview={<>
                    <div className="card-preview-hero mono">{gearRecommendations.length} item{gearRecommendations.length !== 1 ? 's' : ''}</div>
                    <div className="card-preview-caption">{gearRecommendations.slice(0, 2).map(g => g.title).join(', ') || 'Standard backcountry kit'}</div>
                  </>}
                >
                <GearCard gearRecommendations={gearRecommendations} />
                </CollapsibleCard>
              )}
            </div>
          </div>

          {avalancheRelevant && (() => {
            const avyHeaderMeta = (
              <span className={`decision-pill ${avalancheUnknown ? 'watch' : getDangerLevelClass(overallAvalancheLevel ?? undefined)}`}>
                {avalancheUnknown ? 'Unknown' : `L${overallAvalancheLevel} ${getDangerText(overallAvalancheLevel ?? 0)}`}
              </span>
            );
            return (
            <CollapsibleCard
              cardKey="avalancheForecast"
              domId="planner-section-avalanche"
              defaultExpanded={false}
              order={reportCardOrder.avalancheForecast}
              className="avy-card"
              title={<span className="card-title"><Zap size={14} /> Avalanche</span>}
              headerMeta={avyHeaderMeta}
              summary={avalancheRelevant ? (overallAvalancheLevel != null ? `L${overallAvalancheLevel}: ${getDangerText(overallAvalancheLevel)}` : 'Unknown danger level') : 'Not applicable'}
              preview={<>
                <div className={`card-preview-hero ${avalancheRelevant && overallAvalancheLevel != null ? (overallAvalancheLevel >= 4 ? 'avy-nogo' : overallAvalancheLevel >= 3 ? 'avy-caution' : 'avy-go') : ''}`}>{avalancheRelevant ? (overallAvalancheLevel != null ? `${getDangerGlyph(overallAvalancheLevel)} ${getDangerText(overallAvalancheLevel)}` : 'Unknown') : 'N/A'}</div>
                <div className="card-preview-caption">{safetyData.avalanche.zone || 'Unknown zone'}</div>
              </>}
            >
            <AvalancheForecastCard
            avalanche={safetyData.avalanche}
            avalancheExpiredForSelectedStart={avalancheExpiredForSelectedStart}
            avalancheRelevant={avalancheRelevant}
            avalancheNotApplicableReason={avalancheNotApplicableReason}
            avalancheUnknown={avalancheUnknown}
            overallAvalancheLevel={overallAvalancheLevel}
            avalancheElevationRows={avalancheElevationRows}
            safeAvalancheLink={safeAvalancheLink}
            getDangerLevelClass={getDangerLevelClass}
            getDangerText={getDangerText}
            normalizeDangerLevel={normalizeDangerLevel}
            getDangerGlyph={getDangerGlyph}
            summarizeText={summarizeText}
            toPlainText={toPlainText}
            objectiveElevationFt={safetyData.weather.elevation ?? null}
            formatElevationDisplay={formatElevationDisplay}
            />
            </CollapsibleCard>
            );
          })()}

          <DeepDiveReportCard
            order={reportCardOrder.deepDiveData}
            objectiveName={objectiveName}
            positionLat={position.lat}
            positionLng={position.lng}
            forecastDate={forecastDate}
            selectedDate={safetyData.forecast?.selectedDate}
            displayStartTime={displayStartTime}
            safeShareLink={safeShareLink}
            weatherIssuedTime={safetyData.weather.issuedTime}
            weatherForecastStartTime={safetyData.weather.forecastStartTime}
            weatherForecastEndTime={safetyData.weather.forecastEndTime}
            weatherTimezone={safetyData.weather.timezone || null}
            weatherHumidity={safetyData.weather.humidity}
            weatherDewPoint={safetyData.weather.dewPoint}
            weatherCloudCover={weatherCloudCover}
            rainfall12hDisplay={rainfall12hDisplay}
            rainfall24hDisplay={rainfall24hDisplay}
            rainfall48hDisplay={rainfall48hDisplay}
            snowfall12hDisplay={snowfall12hDisplay}
            snowfall24hDisplay={snowfall24hDisplay}
            snowfall48hDisplay={snowfall48hDisplay}
            safeWeatherLink={safeWeatherLink}
            weatherSourceDisplay={weatherSourceDisplay}
            weatherBlended={weatherBlended}
            weatherFieldSources={weatherFieldSources}
            weatherElevation={safetyData.weather.elevation}
            weatherElevationSource={safetyData.weather.elevationSource}
            weatherElevationForecastNote={safetyData.weather.elevationForecastNote}
            elevationForecastBands={elevationForecastBands}
            avalancheCenter={safetyData.avalanche.center}
            avalancheZone={safetyData.avalanche.zone}
            avalanchePublishedTime={safetyData.avalanche.publishedTime}
            avalancheExpiresTime={safetyData.avalanche.expiresTime}
            avalancheUnknown={avalancheUnknown}
            avalancheDangerLevel={safetyData.avalanche.dangerLevel}
            avalancheCoverageStatus={safetyData.avalanche.coverageStatus}
            avalancheDangerUnknown={safetyData.avalanche.dangerUnknown}
            avalancheProblemsCount={safetyData.avalanche.problems?.length || 0}
            safeAvalancheLink={safeAvalancheLink}
            alertsActiveCount={safetyData.alerts?.activeCount ?? 0}
            alertsHighestSeverity={safetyData.alerts?.highestSeverity}
            alerts={safetyData.alerts?.alerts || []}
            usAqi={safetyData.airQuality?.usAqi}
            aqiCategory={safetyData.airQuality?.category}
            heatRiskLabel={safetyData.heatRisk?.label || heatRiskLabel || 'N/A'}
            heatRiskLevel={safetyData.heatRisk?.level}
            heatRiskGuidance={safetyData.heatRisk?.guidance || heatRiskGuidance || 'N/A'}
            fireRiskLabel={safetyData.fireRisk?.label}
            fireRiskLevel={safetyData.fireRisk?.level}
            fireRiskGuidance={safetyData.fireRisk?.guidance}
            fireRiskAlerts={fireRiskAlerts}
            pm25={safetyData.airQuality?.pm25}
            aqiMeasuredTime={safetyData.airQuality?.measuredTime}
            snowpackSummary={safetyData.snowpack?.summary}
            snotelStationName={safetyData.snowpack?.snotel?.stationName}
            snotelDistanceDisplay={snotelDistanceDisplay}
            snotelSweDisplay={snotelSweDisplay}
            snotelDepthDisplay={snotelDepthDisplay}
            nohrscSweDisplay={nohrscSweDisplay}
            nohrscDepthDisplay={nohrscDepthDisplay}
            cdec={safetyData.snowpack?.cdec || null}
            cdecSweDisplay={cdecSweDisplay}
            cdecDepthDisplay={cdecDepthDisplay}
            safeSnotelLink={safeSnotelLink}
            safeNohrscLink={safeNohrscLink}
            safeCdecLink={safeCdecLink}
            safetyScore={safetyData.safety.score}
            safetyConfidence={safetyData.safety.confidence}
            primaryHazard={safetyData.safety.primaryHazard}
            decision={decision}
            factorsCount={safetyData.safety.factors?.length || 0}
            groupImpactsCount={Object.keys(safetyData.safety.groupImpacts || {}).length}
            sourcesUsed={safetyData.safety.sourcesUsed || []}
            satelliteConditionLineLength={satelliteConditionLine.length || 0}
            rawReportPayload={rawReportPayload}
            copiedRawPayload={copiedRawPayload}
            handleCopyRawPayload={handleCopyRawPayload}
            formatPubTime={formatPubTime}
            formatForecastPeriodLabel={formatForecastPeriodLabel}
            formatTempDisplay={formatTempDisplay}
            formatWindDisplay={formatWindDisplay}
            formatElevationDisplay={formatElevationDisplay}
            formatElevationDeltaDisplay={formatElevationDeltaDisplay}
            localizeUnitText={localizeUnitText}
            normalizeDangerLevel={normalizeDangerLevel}
          />

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
