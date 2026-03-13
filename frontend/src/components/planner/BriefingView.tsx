import React from 'react';
import {
  ShieldCheck,
  Thermometer,
  Wind,
  CloudRain,
  AlertTriangle,
  Mountain,
  Clock,
  Route,
  Flame,
  Sun,
  Zap,
  CheckCircle2,
} from 'lucide-react';
import { ScoreGauge } from './ScoreGauge';
import { DecisionGateCard } from './cards/DecisionGateCard';
import { WeatherCardContent } from './cards/WeatherCardContent';
import { TravelWindowPlannerCard } from './cards/TravelWindowPlannerCard';
import { CriticalChecksCard } from './cards/CriticalChecksCard';
import { ScoreTraceCard } from './cards/ScoreTraceCard';
import { HeatRiskCard } from './cards/HeatRiskCard';
import { TerrainCard } from './cards/TerrainCard';
import { RainfallCard } from './cards/RainfallCard';
import { WindLoadingCard } from './cards/WindLoadingCard';
import { SourceFreshnessCard } from './cards/SourceFreshnessCard';
import { NwsAlertsCard } from './cards/NwsAlertsCard';
import { AirQualityCard } from './cards/AirQualityCard';
import { SnowpackCard } from './cards/SnowpackCard';
import { FireRiskCard } from './cards/FireRiskCard';
import { PlanSnapshotCard } from './cards/PlanSnapshotCard';
import { GearCard } from './cards/GearCard';
import { AvalancheForecastCard } from './cards/AvalancheForecastCard';
import type { PlannerViewProps } from './PlannerView';
import { criticalRiskLevelText } from '../../app/critical-window';
import { TRAVEL_THRESHOLD_PRESETS } from '../../hooks/usePreferenceHandlers';

type BriefingViewProps = Omit<PlannerViewProps,
  | 'appShellClassName' | 'isViewPending'
  | 'navigateToView' | 'openTripToolView' | 'jumpToPlannerSection'
  | 'searchWrapperRef' | 'searchInputRef' | 'searchQuery' | 'trimmedSearchQuery'
  | 'showSuggestions' | 'searchLoading' | 'suggestions' | 'activeSuggestionIndex'
  | 'parsedTypedCoordinates' | 'handleInputChange' | 'handleFocus'
  | 'handleSearchKeyDown' | 'handleSearchSubmit' | 'handleSearchClear'
  | 'handleUseTypedCoordinates' | 'selectSuggestion' | 'setActiveSuggestionIndex'
  | 'hasObjective' | 'objectiveIsSaved' | 'handleToggleSaveObjective'
  | 'copiedLink' | 'handleCopyLink'
  | 'activeBasemap' | 'updateObjectivePosition' | 'mapFocusNonce'
  | 'mapStyle' | 'setMapStyle' | 'locatingUser' | 'handleUseCurrentLocation'
  | 'handleRecenterMap' | 'mapElevationChipTitle' | 'mapElevationLabel'
  | 'mapWeatherEmoji' | 'mapWeatherTempLabel' | 'mapWeatherConditionLabel'
  | 'mapWeatherChipTitle'
  | 'mobileMapControlsExpanded' | 'setMobileMapControlsExpanded'
  | 'handleDateChange' | 'handlePlannerTimeChange' | 'setAlpineStartTime'
  | 'handleTravelWindowHoursDraftChange' | 'handleTravelWindowHoursDraftBlur'
  | 'handleUseNowConditions' | 'loading' | 'handleRetryFetch'
  | 'satelliteConditionLine' | 'timezoneMismatch'
  | 'hasFreshnessWarning' | 'freshnessWarningSummary'
  | 'formatClockForStyle'
  | 'aiBriefNarrative' | 'aiBriefError' | 'aiBriefLoading' | 'handleRequestAiBriefAction'
  | 'routeSuggestions' | 'routeAnalysis' | 'routeLoading' | 'routeError'
  | 'fetchRouteSuggestions' | 'fetchRouteAnalysis' | 'customRouteName'
  | 'setCustomRouteName' | 'setRouteSuggestions' | 'setRouteError'
  | 'safeShareLink' | 'weatherFieldSources' | 'weatherBlended'
  | 'rawReportPayload' | 'copiedRawPayload' | 'handleCopyRawPayload'
  | 'formatGeneratedAt'
>;

function BriefingSection({
  icon,
  title,
  pill,
  pillClass,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  pill?: string;
  pillClass?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="briefing-section">
      <div className="briefing-section-header">
        <span className="briefing-section-title">{icon} {title}</span>
        {pill && <span className={`decision-pill ${pillClass || ''}`}>{pill}</span>}
      </div>
      <div className="briefing-section-body">
        {children}
      </div>
    </section>
  );
}

export function BriefingView(props: BriefingViewProps) {
  const {
    safetyData,
    decision,
    preferences,
    avalancheRelevant,
    getScoreColor,
    displayStartTime,
    returnTimeFormatted,
    travelWindowHours,
    formatTempDisplay,
    formatWindDisplay,
    formatElevationDisplay,
    formatElevationDeltaDisplay,
    weatherVisibilityRisk,
    weatherVisibilityPill,
    weatherVisibilityDetail,
    shouldRenderRankedCard,

    // Decision gate
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

    // Travel window
    peakCriticalWindow,
    travelWindowInsights,
    travelWindowRows,
    formatTravelWindowSpan,
    windThresholdDisplay,
    feelsLikeThresholdDisplay,
    heatCeilingDisplay,
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
    heatCeilingMin,
    heatCeilingMax,
    maxFeelsLikeDraft,
    handleHeatCeilingDisplayChange,
    handleHeatCeilingDisplayBlur,
    formatPresetWindDisplay,
    travelWindowSummary,
    criticalWindow,
    travelWindowExpanded,
    setTravelWindowExpanded,
    visibleCriticalWindowRows,
    travelWindowHoursLabel,

    // Critical checks
    topCriticalAttentionChecks,
    criticalCheckFailCount,
    describeFailedCriticalCheck,

    // Score trace
    dayOverDay,

    // Weather
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
    formatPubTime,
    weatherTrendTempRange,
    getDangerLevelClass,
    getDangerText,

    // Heat risk
    heatRiskGuidance,
    heatRiskReasons,
    heatRiskMetrics,
    heatRiskPillClass,
    heatRiskLabel,
    lowerTerrainHeatLabel,

    // Terrain
    terrainConditionDetails,
    terrainConditionPillClass,
    rainfall12hDisplay,
    rainfall48hDisplay,
    snowfall12hDisplay,
    snowfall24hDisplay,
    snowfall48hDisplay,

    // Rainfall
    precipInsightLine,
    expectedPrecipSummaryLine,
    expectedTravelWindowHours,
    expectedRainWindowDisplay,
    expectedSnowWindowDisplay,
    rainfallExpected,
    precipitationDisplayTimezone,
    expectedPrecipNoteLine,
    rainfallModeLabel,
    rainfallPayload,
    rainfallNoteLine,
    safeRainfallLink,
    formatForecastPeriodLabel,

    // Wind loading
    windLoadingHintsRelevant,
    windLoadingLevel,
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

    // Source freshness
    sourceFreshnessRows,
    reportGeneratedAt,
    avalancheExpiredForSelectedStart,
    formatAgeFromNow,

    // NWS alerts
    nwsAlertCount,
    nwsTotalAlertCount,
    nwsTopAlerts,

    // Air quality
    airQualityPillClassFn,
    airQualityFutureNotApplicable,

    // Snowpack
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

    // Fire risk
    fireRiskLabel,
    fireRiskPillClass,
    fireRiskAlerts,

    // Plan snapshot
    sunriseMinutesForPlan,
    sunsetMinutesForPlan,
    startMinutesForPlan,
    returnMinutes,
    startLabel,
    daylightRemainingFromStartLabel,

    // Gear
    gearRecommendations,

    // Avalanche
    overallAvalancheLevel,
    avalancheNotApplicableReason,
    avalancheElevationRows,
    safeAvalancheLink,
    normalizeDangerLevel,
    getDangerGlyph,
    summarizeText,
    toPlainText,

    // Misc
    objectiveTimezone,
    deviceTimezone,
  } = props;

  if (!safetyData || !decision) return null;

  const score = safetyData.safety.score;
  const criticalCheckPassCount = orderedCriticalChecks.filter((c) => c.ok).length;
  const criticalCheckTotal = orderedCriticalChecks.length;
  const decisionColorClass = decision.level.toLowerCase().replace('-', '');

  return (
    <div className="briefing-layout">
      {/* ── Decision Banner ── */}
      <div className={`briefing-banner briefing-banner-${decisionColorClass}`}>
        <div className="briefing-banner-decision">
          <div className="briefing-banner-level">{decision.level}</div>
          <div className="briefing-banner-headline">{decision.headline}</div>
        </div>
        <div className="briefing-banner-score">
          <ScoreGauge score={score} scoreColor={getScoreColor(score)} size={80} />
          <span className="briefing-banner-score-label">Safety {score}</span>
        </div>
      </div>

      {/* ── Quick Metrics Strip ── */}
      <div className="briefing-metrics">
        <div className="briefing-metric">
          <span className="briefing-metric-label">Temp</span>
          <span className="briefing-metric-value">{formatTempDisplay(weatherCardTemp)}</span>
          <span className="briefing-metric-sub">Feels {formatTempDisplay(weatherCardFeelsLike)}</span>
        </div>
        <div className="briefing-metric">
          <span className="briefing-metric-label">Wind</span>
          <span className="briefing-metric-value">{formatWindDisplay(weatherCardWind)}</span>
          <span className="briefing-metric-sub">{weatherCardWindDirection || 'Calm'} {formattedGust ? `G ${formattedGust}` : ''}</span>
        </div>
        <div className="briefing-metric">
          <span className="briefing-metric-label">Precip</span>
          <span className="briefing-metric-value">{Number.isFinite(weatherCardPrecip) ? `${weatherCardPrecip}%` : 'N/A'}</span>
          <span className="briefing-metric-sub">24h: {rainfall24hDisplay}</span>
        </div>
        <div className="briefing-metric">
          <span className="briefing-metric-label">Travel</span>
          <span className="briefing-metric-value">{travelWindowInsights.bestWindow ? formatTravelWindowSpan(travelWindowInsights.bestWindow, preferences.timeStyle) : 'None'}</span>
          <span className="briefing-metric-sub">{travelWindowInsights.bestWindow ? `${travelWindowInsights.bestWindow.length}h clear` : 'No safe window'}</span>
        </div>
        {avalancheRelevant && overallAvalancheLevel != null && (
          <div className="briefing-metric">
            <span className="briefing-metric-label">Avalanche</span>
            <span className={`briefing-metric-value ${getDangerLevelClass(overallAvalancheLevel)}`}>{getDangerText(overallAvalancheLevel)}</span>
          </div>
        )}
        {nwsAlertCount > 0 && (
          <div className="briefing-metric briefing-metric-alert">
            <span className="briefing-metric-label">Alerts</span>
            <span className="briefing-metric-value nogo">{nwsAlertCount}</span>
            <span className="briefing-metric-sub">{nwsTopAlerts[0]?.event || 'Active'}</span>
          </div>
        )}
      </div>

      {/* ── Visibility Warning ── */}
      {(weatherVisibilityRisk.level === 'Moderate' || weatherVisibilityRisk.level === 'High' || weatherVisibilityRisk.level === 'Extreme') && (
        <div className={`visibility-banner visibility-banner-${weatherVisibilityPill}`}>
          Visibility risk: <strong>{weatherVisibilityRisk.level}</strong>{weatherVisibilityDetail ? ` — ${weatherVisibilityDetail}` : ''}
        </div>
      )}

      {/* ── Sections ── */}
      <div className="briefing-sections">

        <BriefingSection icon={<ShieldCheck size={14} />} title="Decision" pill={decision.level} pillClass={decisionColorClass}>
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
        </BriefingSection>

        <BriefingSection icon={<Thermometer size={14} />} title="Weather" pill={safetyData.forecast?.isFuture ? 'Forecast' : 'Current'} pillClass={safetyData.forecast?.isFuture ? 'watch' : ''}>
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
            onTrendMetricChange={onTrendMetricChange}
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
        </BriefingSection>

        <BriefingSection icon={<Clock size={14} />} title={`Travel Window (${travelWindowHoursLabel})`} pill={travelWindowInsights.bestWindow ? `${travelWindowInsights.bestWindow.length}h clear` : 'No window'} pillClass={travelWindowInsights.bestWindow ? 'go' : 'nogo'}>
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
            heatCeilingDisplay={heatCeilingDisplay}
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
            heatCeilingMin={heatCeilingMin}
            heatCeilingMax={heatCeilingMax}
            heatCeilingStep={feelsLikeThresholdStep}
            maxFeelsLikeDraft={maxFeelsLikeDraft}
            handleHeatCeilingDisplayChange={handleHeatCeilingDisplayChange}
            handleHeatCeilingDisplayBlur={handleHeatCeilingDisplayBlur}
            formatPresetWindDisplay={formatPresetWindDisplay}
            travelWindowSummary={travelWindowSummary}
            criticalWindow={criticalWindow}
            travelWindowExpanded={travelWindowExpanded}
            setTravelWindowExpanded={setTravelWindowExpanded}
            visibleCriticalWindowRows={visibleCriticalWindowRows}
            formatTempDisplay={formatTempDisplay}
            formatWindDisplay={formatWindDisplay}
          />
        </BriefingSection>

        {avalancheRelevant && (
          <BriefingSection
            icon={<Zap size={14} />}
            title="Avalanche"
            pill={avalancheUnknown ? 'Unknown' : overallAvalancheLevel != null ? getDangerText(overallAvalancheLevel) : 'Unknown'}
            pillClass={avalancheUnknown ? 'watch' : getDangerLevelClass(overallAvalancheLevel ?? undefined)}
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
          </BriefingSection>
        )}

        {shouldRenderRankedCard('criticalChecks') && (
          <BriefingSection icon={<CheckCircle2 size={14} />} title="Critical Checks" pill={`${criticalCheckPassCount}/${criticalCheckTotal} passing`} pillClass={criticalCheckFailCount === 0 ? 'go' : 'caution'}>
            <CriticalChecksCard
              orderedCriticalChecks={orderedCriticalChecks}
              topCriticalAttentionChecks={topCriticalAttentionChecks}
              criticalCheckFailCount={criticalCheckFailCount}
              localizeUnitText={localizeUnitText}
              describeFailedCriticalCheck={describeFailedCriticalCheck}
            />
          </BriefingSection>
        )}

        {shouldRenderRankedCard('scoreTrace') && (
          <BriefingSection icon={<ShieldCheck size={14} />} title="Score Breakdown" pill={dayOverDay ? `${dayOverDay.delta > 0 ? '+' : ''}${dayOverDay.delta} vs ${dayOverDay.previousDate}` : undefined} pillClass={dayOverDay ? (dayOverDay.delta <= -1 ? 'nogo' : dayOverDay.delta >= 1 ? 'go' : 'caution') : undefined}>
            <ScoreTraceCard
              factors={safetyData.safety.factors}
              dayOverDay={dayOverDay}
            />
          </BriefingSection>
        )}

        {nwsAlertCount > 0 && (
          <BriefingSection icon={<AlertTriangle size={14} />} title="Alerts" pill={`${nwsAlertCount} active`} pillClass="nogo">
            <NwsAlertsCard
              alertsSource={safetyData.alerts?.source || 'NWS CAP feed'}
              highestSeverity={safetyData.alerts?.highestSeverity}
              alertsStatus={safetyData.alerts?.status}
              nwsTotalAlertCount={nwsTotalAlertCount}
              nwsTopAlerts={nwsTopAlerts}
              formatPubTime={formatPubTime}
            />
          </BriefingSection>
        )}

        {shouldRenderRankedCard('heatRisk') && (
          <BriefingSection icon={<Sun size={14} />} title="Heat Risk" pill={String(heatRiskLabel || 'Low').toUpperCase()} pillClass={heatRiskPillClass}>
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
          </BriefingSection>
        )}

        {shouldRenderRankedCard('terrainTrailCondition') && (
          <BriefingSection icon={<Route size={14} />} title="Terrain" pill={safetyData.terrainCondition?.label || safetyData.trail || 'Unknown'} pillClass={terrainConditionPillClass}>
            <TerrainCard
              terrainConditionDetails={terrainConditionDetails}
              rainfall12hDisplay={rainfall12hDisplay}
              rainfall24hDisplay={rainfall24hDisplay}
              rainfall48hDisplay={rainfall48hDisplay}
              snowfall12hDisplay={snowfall12hDisplay}
              snowfall24hDisplay={snowfall24hDisplay}
              snowfall48hDisplay={snowfall48hDisplay}
            />
          </BriefingSection>
        )}

        {shouldRenderRankedCard('recentRainfall') && (
          <BriefingSection icon={<CloudRain size={14} />} title="Precipitation" pill={`24h: ${rainfall24hDisplay}`} pillClass={rainfall24hSeverityClass}>
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
          </BriefingSection>
        )}

        {(shouldRenderRankedCard('windLoading') || shouldRenderRankedCard('windLoadingHints')) && windLoadingHintsRelevant && (
          <BriefingSection icon={<Wind size={14} />} title="Wind Loading" pill={windLoadingLevel} pillClass={windLoadingPillClass}>
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
                <strong>{trendAgreementRatio !== null ? `${Math.round(trendAgreementRatio * 100)}%` : 'N/A'}</strong>
              </div>
              <div className="wind-hint-meta-item wind-hint-meta-wide">
                <span className="stat-label">Elevation Focus</span>
                <strong>{windLoadingElevationFocus}</strong>
              </div>
            </div>
            {leewardAspectHints.length > 0 && (
              <div className="wind-aspect-block">
                <span className="stat-label">Likely Lee Aspects</span>
                <div className="wind-aspect-chips">{leewardAspectHints.map((a) => <span key={a} className="wind-aspect-chip">{a}</span>)}</div>
              </div>
            )}
            {secondaryWindAspects.length > 0 && Number.isFinite(windGustMph) && windGustMph >= 20 && (
              <div className="wind-aspect-block">
                <span className="stat-label">Secondary Cross-Loading</span>
                <div className="wind-aspect-chips">{secondaryWindAspects.map((a) => <span key={`s-${a}`} className="wind-aspect-chip secondary">{a}</span>)}</div>
              </div>
            )}
            {windLoadingNotes.length > 0 && (
              <ul className="signal-list compact">{windLoadingNotes.map((n, i) => <li key={`wn-${i}`}>{n}</li>)}</ul>
            )}
            {aspectOverlapProblems.length > 0 && (
              <p className="wind-aspect-overlap-alert">Wind loading aligns with active avalanche problem aspects: {aspectOverlapProblems.join(', ')}.</p>
            )}
          </BriefingSection>
        )}

        {shouldRenderRankedCard('airQuality') && (
          <BriefingSection
            icon={<Wind size={14} />}
            title="Air Quality"
            pill={`AQI ${Number.isFinite(Number(safetyData.airQuality?.usAqi)) ? Math.round(Number(safetyData.airQuality?.usAqi)) : 'N/A'}`}
            pillClass={airQualityFutureNotApplicable ? 'go' : airQualityPillClassFn(safetyData.airQuality?.usAqi)}
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
          </BriefingSection>
        )}

        {shouldRenderRankedCard('snowpackSnapshot') && (
          <BriefingSection icon={<Mountain size={14} />} title="Snowpack" pill={snowpackStatusLabel} pillClass={snowpackPillClass}>
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
          </BriefingSection>
        )}

        {shouldRenderRankedCard('fireRisk') && (
          <BriefingSection icon={<Flame size={14} />} title="Fire Risk" pill={fireRiskLabel.toUpperCase()} pillClass={fireRiskPillClass}>
            <FireRiskCard
              guidance={safetyData.fireRisk?.guidance || 'No fire-risk guidance available.'}
              reasons={safetyData.fireRisk?.reasons || []}
              fireRiskAlerts={fireRiskAlerts}
              source={safetyData.fireRisk?.source || 'Not provided'}
              formatPubTime={formatPubTime}
            />
          </BriefingSection>
        )}

        {shouldRenderRankedCard('planSnapshot') && (
          <BriefingSection icon={<Sun size={14} />} title="Daylight" pill={`${daylightRemainingFromStartLabel} daylight`}>
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
          </BriefingSection>
        )}

        {shouldRenderRankedCard('recommendedGear') && (
          <BriefingSection icon={<CheckCircle2 size={14} />} title="Gear" pill={`${gearRecommendations.length} items`}>
            <GearCard gearRecommendations={gearRecommendations} />
          </BriefingSection>
        )}

        {shouldRenderRankedCard('sourceFreshness') && (
          <BriefingSection icon={<Clock size={14} />} title="Source Freshness" pill={reportGeneratedAt ? formatAgeFromNow(reportGeneratedAt) : 'N/A'}>
            <SourceFreshnessCard
              sourceFreshnessRows={sourceFreshnessRows}
              reportGeneratedAt={reportGeneratedAt}
              avalancheExpiredForSelectedStart={avalancheExpiredForSelectedStart}
              objectiveTimezone={objectiveTimezone}
              deviceTimezone={deviceTimezone}
              formatPubTime={formatPubTime}
            />
          </BriefingSection>
        )}

      </div>
    </div>
  );
}
