/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import {
  Mountain,
  Clock,
  Thermometer,
  Wind,
  CloudRain,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Layers,
  Snowflake,
  ShieldAlert,
  ShieldCheck,
  Radio,
  Sun,
  Sunrise,
  Sunset,
  Flame,
  Route,
  Eye,
  Package,
  ArrowRight,
  Compass,
  Sparkles,
  LoaderCircle,
  ExternalLink,
} from 'lucide-react';
import type { PlannerViewProps } from './PlannerView';
import type { ElevationForecastBand } from '../../app/types';
import type { AiFeatureAvailability } from '../../hooks/useAiAvailability';
import { formatSnowVisionSections } from '../../app/text-utils';
import { getTemperatureBand } from '../../app/weather-display';
import { AiInsightBriefing } from './AiInsightBriefing';
import { DashboardSummaryCard } from './DashboardSummaryCard';
import { WeatherHourPillStrip } from './WeatherHourPillStrip';
import { WeatherTrendMiniChart } from './WeatherTrendMiniChart';
import { WindDirectionArrow } from './WindDirectionArrow';
import { StartTimeScenarioCard } from './StartTimeScenarioCard';
import { HeatRiskSection } from './HeatRiskSection';
import { FireRiskSection } from './FireRiskSection';
import { CautionsAlertsSection } from './CautionsAlertsSection';
import { ObjectiveMonitoringCard } from './ObjectiveMonitoringCard';
import { TerrainWindowCard } from './TerrainWindowCard';
import { useProductFeatureFlags } from '../../contexts/feature-flags';
import '../../styles/planning-intelligence.css';

const DANGER_COLORS = [
  'var(--ssr-surface-3)',
  'var(--ssr-risk-1)',
  'var(--ssr-risk-2)',
  'var(--ssr-risk-3)',
  'var(--ssr-risk-4)',
  'var(--ssr-risk-5)',
];

function bandRisk(gustMph: number, maxGustMph: number): 'low' | 'watch' | 'high' {
  if (Number.isFinite(gustMph) && gustMph >= maxGustMph) return 'high';
  if (Number.isFinite(gustMph) && gustMph >= maxGustMph * 0.7) return 'watch';
  return 'low';
}

/* ── Elevation cross-section plot ── */
function ElevationCrossPlot({
  bands,
  maxGustMph,
  activeIndex,
  onActiveIndexChange,
  formatTempDisplay,
  formatWindDisplay,
  formatElevationDisplay,
}: {
  bands: ElevationForecastBand[];
  maxGustMph: number;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  formatTempDisplay: PlannerViewProps['formatTempDisplay'];
  formatWindDisplay: PlannerViewProps['formatWindDisplay'];
  formatElevationDisplay: PlannerViewProps['formatElevationDisplay'];
}) {
  const W = 900;
  const H = 260;
  const pad = { l: 76, r: 82, t: 38, b: 58 };
  const gradientId = React.useId().replace(/:/g, '');

  const fts = bands.map((b) => b.elevationFt);
  const minFt = Math.min(...fts);
  const maxFt = Math.max(...fts);
  const rg = Math.max(1, maxFt - minFt);

  const pts = bands.map((b, i) => ({
    x: pad.l + (i / Math.max(1, bands.length - 1)) * (W - pad.l - pad.r),
    y: H - pad.b - ((b.elevationFt - minFt) / rg) * (H - pad.t - pad.b),
    b,
    i,
  }));

  let profilePath = '';
  pts.forEach((p, i) => {
    if (i === 0) {
      profilePath = `M ${p.x} ${p.y}`;
    } else {
      const prev = pts[i - 1];
      const cx1 = prev.x + (p.x - prev.x) * 0.45;
      const cx2 = prev.x + (p.x - prev.x) * 0.55;
      profilePath += ` C ${cx1} ${prev.y}, ${cx2} ${p.y}, ${p.x} ${p.y}`;
    }
  });
  const areaPath = `${profilePath} L ${pts[pts.length - 1].x} ${H - pad.b} L ${pts[0].x} ${H - pad.b} Z`;

  const ticks: Array<{ ft: number; y: number }> = [];
  const step = rg > 6000 ? 2000 : rg > 2500 ? 1000 : 500;
  const first = Math.ceil(minFt / step) * step;
  for (let ft = first; ft <= maxFt; ft += step) {
    ticks.push({ ft, y: H - pad.b - ((ft - minFt) / rg) * (H - pad.t - pad.b) });
  }

  const riskCol: Record<string, string> = {
    low: 'var(--ssr-risk-1)',
    watch: 'var(--ssr-risk-3)',
    high: 'var(--ssr-risk-4)',
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-labelledby={`${gradientId}-title ${gradientId}-desc`}
    >
      <title id={`${gradientId}-title`}>Estimated conditions by elevation band</title>
      <desc id={`${gradientId}-desc`}>Select a point to compare temperature, wind, and gusts from lower terrain to the objective.</desc>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ssr-brand)" stopOpacity="0.24" />
          <stop offset="100%" stopColor="var(--ssr-brand)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t.ft}>
          <line x1={pad.l} x2={W - pad.r} y1={t.y} y2={t.y} stroke="var(--ssr-line)" strokeDasharray="2 3" />
          <text x={pad.l - 10} y={t.y + 4} textAnchor="end" fontSize="10" fill="var(--ssr-text-3)" fontFamily="var(--ssr-mono)">
            {formatElevationDisplay(t.ft, { precision: 0 })}
          </text>
        </g>
      ))}
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path d={profilePath} fill="none" stroke="var(--ssr-brand-dark)" strokeWidth="2.5" strokeLinecap="round" />
      {pts.map((p) => {
        const risk = bandRisk(p.b.windGust, maxGustMph);
        const isActive = p.i === activeIndex;
        const windLabel = formatWindDisplay(p.b.windGust, { includeUnit: false });
        return (
          <g
            key={p.i}
            role="button"
            tabIndex={0}
            aria-label={`${p.b.label}, ${formatElevationDisplay(p.b.elevationFt)}, ${formatTempDisplay(p.b.temp)}, gusts ${formatWindDisplay(p.b.windGust)}`}
            aria-pressed={isActive}
            onMouseEnter={() => onActiveIndexChange(p.i)}
            onFocus={() => onActiveIndexChange(p.i)}
            onClick={() => onActiveIndexChange(p.i)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onActiveIndexChange(p.i);
              }
            }}
            className={`ssr-elev-node ${isActive ? 'is-active' : ''}`}
          >
            {isActive && (
              <line x1={p.x} x2={p.x} y1={p.y + 8} y2={H - pad.b} stroke="var(--ssr-brand)" strokeDasharray="3 4" opacity="0.65" />
            )}
            <rect x={p.x - 23} y={p.y - 32} width="46" height="20" rx="10" fill={riskCol[risk]} />
            <text x={p.x} y={p.y - 18} textAnchor="middle" fontSize="9.5" fill="white" fontWeight="700" fontFamily="var(--ssr-mono)">
              G {windLabel}
            </text>
            <circle cx={p.x} cy={p.y} r={isActive ? 8 : 6} fill={riskCol[risk]} stroke="var(--ssr-surface)" strokeWidth="3" />
            <text x={p.x} y={H - pad.b + 20} textAnchor="middle" fontSize="10" fill="var(--ssr-text-2)" fontWeight="650">
              {p.b.label}
            </text>
            <text x={p.x} y={H - pad.b + 36} textAnchor="middle" fontSize="9.5" fill="var(--ssr-text-3)" fontFamily="var(--ssr-mono)">
              {formatElevationDisplay(p.b.elevationFt, { precision: 0 })}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ElevationProfileSection({
  bands,
  maxGustMph,
  note,
  forecastPeriodLabel,
  targetElevationInput,
  handleTargetElevationChange,
  elevationUnitLabel,
  targetElevationForecast,
  targetElevationFt,
  formatTempDisplay,
  formatWindDisplay,
  formatElevationDisplay,
  formatElevationDeltaDisplay,
}: {
  bands: ElevationForecastBand[];
  maxGustMph: number;
  note?: string | null;
  forecastPeriodLabel: string;
  targetElevationInput: string;
  handleTargetElevationChange: PlannerViewProps['handleTargetElevationChange'];
  elevationUnitLabel: string;
  targetElevationForecast: PlannerViewProps['targetElevationForecast'];
  targetElevationFt: number;
  formatTempDisplay: PlannerViewProps['formatTempDisplay'];
  formatWindDisplay: PlannerViewProps['formatWindDisplay'];
  formatElevationDisplay: PlannerViewProps['formatElevationDisplay'];
  formatElevationDeltaDisplay: PlannerViewProps['formatElevationDeltaDisplay'];
}) {
  const manualTarget = targetElevationForecast
    && Number.isFinite(targetElevationFt)
    && Math.abs(targetElevationForecast.deltaFt) >= 10
    ? {
        label: 'Your target',
        elevationFt: Math.round(targetElevationFt),
        deltaFromObjectiveFt: targetElevationForecast.deltaFt,
        temp: targetElevationForecast.temp,
        feelsLike: targetElevationForecast.feelsLike,
        windSpeed: targetElevationForecast.windSpeed,
        windGust: targetElevationForecast.windGust,
      }
    : null;

  let profileBands = bands;
  if (manualTarget) {
    const matchingBandIndex = bands.findIndex((band) => Math.abs(band.elevationFt - manualTarget.elevationFt) < 10);
    profileBands = matchingBandIndex >= 0
      ? bands.map((band, index) => (index === matchingBandIndex ? manualTarget : band))
      : [...bands, manualTarget].sort((a, b) => a.elevationFt - b.elevationFt);
  }

  const targetBandIndex = manualTarget
    ? profileBands.findIndex((band) => band.label === manualTarget.label && band.elevationFt === manualTarget.elevationFt)
    : -1;
  const defaultBandIndex = targetBandIndex >= 0 ? targetBandIndex : Math.max(0, profileBands.length - 1);
  const profileKey = profileBands.map((band) => `${band.label}:${band.elevationFt}`).join('|');
  const [selectedIndex, setSelectedIndex] = React.useState(defaultBandIndex);

  React.useEffect(() => {
    setSelectedIndex(defaultBandIndex);
  }, [profileKey, defaultBandIndex]);

  const activeIndex = Math.min(selectedIndex, profileBands.length - 1);
  const activeBand = profileBands[activeIndex];
  const lowerBand = profileBands[0];
  const highestBand = profileBands[profileBands.length - 1];
  const peakGustBand = profileBands.reduce((peak, band) => (band.windGust > peak.windGust ? band : peak), profileBands[0]);
  const spanFt = Math.max(0, highestBand.elevationFt - lowerBand.elevationFt);
  const activeRisk = bandRisk(activeBand.windGust, maxGustMph);
  const activeRiskLabel = activeRisk === 'high'
    ? 'Over gust limit'
    : activeRisk === 'watch'
      ? 'Near gust limit'
      : 'Below gust limit';

  return (
    <section className="ssr-card ssr-elev-card" id="planner-section-elevation">
      <div className="ssr-card-h">
        <h2>
          <span className="ssr-h-icon icon-amber"><Layers size={16} /></span>
          Elevation profile
        </h2>
        <span className="ssr-h-meta">
          {manualTarget ? `Target ${formatElevationDisplay(manualTarget.elevationFt)}` : `${formatElevationDisplay(spanFt)} vertical span`}
        </span>
      </div>

      <div className="ssr-elev-time-context">
        <Clock size={16} aria-hidden />
        <div>
          <span>Conditions at</span>
          <strong>{forecastPeriodLabel}</strong>
        </div>
        <p>Every elevation band uses this same forecast hour.</p>
      </div>

      <div className="ssr-elev-input-row">
        <label htmlFor="elevation-profile-target">
          <span>Objective elevation</span>
          <small>Adjust this when the mapped elevation does not match your route.</small>
        </label>
        <div className="ssr-elev-input-wrap">
          <input
            id="elevation-profile-target"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label={`Objective elevation in ${elevationUnitLabel}`}
            placeholder={elevationUnitLabel === 'm' ? 'e.g. 2600' : 'e.g. 8500'}
            value={targetElevationInput}
            onChange={handleTargetElevationChange}
          />
          <span>{elevationUnitLabel}</span>
        </div>
      </div>

      <div className="ssr-elev-summary" aria-label="Elevation profile summary">
        <div>
          <span>Terrain range</span>
          <strong>{formatElevationDisplay(lowerBand.elevationFt)} → {formatElevationDisplay(highestBand.elevationFt)}</strong>
        </div>
        <div>
          <span>Temperature change</span>
          <strong>{formatTempDisplay(lowerBand.temp)} → {formatTempDisplay(highestBand.temp)}</strong>
        </div>
        <div className={bandRisk(peakGustBand.windGust, maxGustMph)}>
          <span>Peak gust · {peakGustBand.label}</span>
          <strong>{formatWindDisplay(peakGustBand.windGust)}</strong>
        </div>
      </div>

      {manualTarget && (
        <div className="ssr-elev-target" role="status">
          <Mountain size={17} aria-hidden />
          <div>
            <span>Manual objective elevation</span>
            <strong>{formatElevationDisplay(manualTarget.elevationFt)} · {formatElevationDeltaDisplay(manualTarget.deltaFromObjectiveFt)} vs mapped elevation</strong>
          </div>
          <p>{formatTempDisplay(manualTarget.temp)} · feels {formatTempDisplay(manualTarget.feelsLike)} · gusts {formatWindDisplay(manualTarget.windGust)}</p>
        </div>
      )}

      <figure className="ssr-cross-wrap">
        <ElevationCrossPlot
          bands={profileBands}
          maxGustMph={maxGustMph}
          activeIndex={activeIndex}
          onActiveIndexChange={setSelectedIndex}
          formatTempDisplay={formatTempDisplay}
          formatWindDisplay={formatWindDisplay}
          formatElevationDisplay={formatElevationDisplay}
        />
        <figcaption className="sr-only">Estimated temperature and wind conditions across {profileBands.length} elevation bands.</figcaption>
      </figure>

      <div className="ssr-elev-band-tabs" aria-label="Choose an elevation band">
        {profileBands.map((band, index) => (
          <button
            key={`${band.label}-${band.elevationFt}`}
            type="button"
            className={`${index === activeIndex ? 'is-active' : ''} ${band.label === 'Your target' ? 'is-manual' : ''}`}
            aria-pressed={index === activeIndex}
            onClick={() => setSelectedIndex(index)}
          >
            <span className={`ssr-risk-pip ${bandRisk(band.windGust, maxGustMph)}`} />
            {band.label}
          </button>
        ))}
      </div>

      <div className={`ssr-elev-active ${activeRisk}`} aria-live="polite">
        <div className="ssr-elev-active-h">
          <div>
            <span>Selected band</span>
            <strong>{activeBand.label}</strong>
          </div>
          <span className={`ssr-pill ${activeRisk === 'high' ? 'nogo' : activeRisk === 'watch' ? 'caution' : 'go'}`}>{activeRiskLabel}</span>
        </div>
        <div className="ssr-elev-active-grid">
          <span><small>Elevation</small><b>{formatElevationDisplay(activeBand.elevationFt)}</b></span>
          <span><small>Temperature</small><b>{formatTempDisplay(activeBand.temp)}</b></span>
          <span><small>Feels like</small><b>{formatTempDisplay(activeBand.feelsLike)}</b></span>
          <span><small>Wind · gust</small><b>{formatWindDisplay(activeBand.windSpeed)} · {formatWindDisplay(activeBand.windGust)}</b></span>
        </div>
      </div>

      <div className="ssr-elev-table-wrap">
        <table className="ssr-bands-table">
          <caption className="sr-only">Comparison of estimated conditions by elevation band</caption>
          <thead>
            <tr>
              <th>Band</th>
              <th className="num">Elevation</th>
              <th className="num">Temp</th>
              <th className="num">Feels</th>
              <th className="num">Wind · gust</th>
            </tr>
          </thead>
          <tbody>
            {profileBands.map((band, index) => {
              const risk = bandRisk(band.windGust, maxGustMph);
              return (
                <tr key={`${band.label}-${band.elevationFt}`} className={`${index === activeIndex ? 'is-active' : ''} ${band.label === 'Your target' ? 'is-manual' : ''}`}>
                  <td>
                    <span className="ssr-band-name-cell">
                      <span className={`ssr-risk-pip ${risk}`} />
                      {band.label}
                    </span>
                  </td>
                  <td className="num">{formatElevationDisplay(band.elevationFt)}</td>
                  <td className="num">{formatTempDisplay(band.temp)}</td>
                  <td className="num">{formatTempDisplay(band.feelsLike)}</td>
                  <td className="num">{formatWindDisplay(band.windSpeed, { includeUnit: false })} · G{formatWindDisplay(band.windGust)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="ssr-cross-note">
        <strong>Planning estimate.</strong> {note || 'Conditions are adjusted from the objective forecast by elevation.'} Local terrain can change wind and temperature; use the colored gust markers to spot where exposure increases.
      </p>
    </section>
  );
}

interface ReportJumpSection {
  id: string;
  label: string;
}

function ReportJumpNav({
  sections,
  onJump,
}: {
  sections: ReportJumpSection[];
  onJump: (id: string, moveFocus: boolean) => void;
}) {
  const [activeId, setActiveId] = React.useState(sections[0]?.id || '');
  const sectionsRef = React.useRef(sections);
  const navRef = React.useRef<HTMLElement>(null);
  const buttonRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const sectionKey = sections.map((section) => section.id).join('|');

  React.useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);

  React.useEffect(() => {
    let frame = 0;
    const updateActiveSection = () => {
      frame = 0;
      const navOffset = 48;
      const lastSection = sectionsRef.current.at(-1);
      const isAtPageEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      if (isAtPageEnd && lastSection) {
        setActiveId((current) => current === lastSection.id ? current : lastSection.id);
        return;
      }
      let nextId = sectionsRef.current[0]?.id || '';
      let largestVisibleArea = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      sectionsRef.current.forEach((section) => {
        const element = document.getElementById(section.id);
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, navOffset));
        const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
        const visibleArea = visibleHeight * visibleWidth;
        const distance = Math.abs(rect.top - navOffset);
        if (visibleArea > largestVisibleArea || (visibleArea === largestVisibleArea && distance < nearestDistance)) {
          largestVisibleArea = visibleArea;
          nearestDistance = distance;
          nextId = section.id;
        }
      });
      setActiveId((current) => current === nextId ? current : nextId);
    };
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(updateActiveSection);
    };

    updateActiveSection();
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [sectionKey]);

  React.useEffect(() => {
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    const nav = navRef.current;
    const button = buttonRefs.current.get(activeId);
    if (!nav || !button) return;
    const left = button.offsetLeft - (nav.clientWidth - button.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior });
  }, [activeId]);

  return (
    <nav ref={navRef} className="ssr-jump-nav" aria-label="Jump to report section">
      {sections.map((section) => (
        <button
          key={section.id}
          ref={(node) => {
            if (node) buttonRefs.current.set(section.id, node);
            else buttonRefs.current.delete(section.id);
          }}
          type="button"
          className={`ssr-jump-chip ${activeId === section.id ? 'active' : ''}`}
          aria-current={activeId === section.id ? 'location' : undefined}
          onClick={(event) => onJump(section.id, event.detail === 0)}
        >
          {section.label}
        </button>
      ))}
    </nav>
  );
}

function RedesignViewComponent(props: PlannerViewProps & { aiAvailability: AiFeatureAvailability; routeAnalysisSlot?: React.ReactNode }) {
  const featureFlags = useProductFeatureFlags();
  const {
    safetyData,
    aiAvailability,
    decision,
    preferences,
    objectiveName,
    position,
    getScoreColor,
    displayStartTime,
    returnTimeFormatted,
    returnExtendsPastMidnight,
    formatClockForStyle,
    formatTempDisplay,
    formatWindDisplay,
    formatElevationDisplay,
    formatElevationDeltaDisplay,
    formatForecastPeriodLabel,
    alpineStartTime,
    setAlpineStartTime,
    setMobileMapControlsExpanded,
    onEditPlan,
    startTimeScenarioComparison,
    startTimeScenariosLoading,
    startTimeScenariosError,
    canGenerateMoreStartTimeScenarios,
    generateMoreStartTimeScenarios,
    decisionActionLine,
    travelWindowRows,
    travelWindowHoursLabel,
    travelWindowInsights,
    travelWindowSummary,
    formatTravelWindowSpan,
    elevationForecastBands,
    targetElevationInput,
    handleTargetElevationChange,
    elevationUnitLabel,
    targetElevationForecast,
    targetElevationFt,
    objectiveElevationFt,
    avalancheRelevant,
    avalancheUnknown,
    overallAvalancheLevel,
    avalancheElevationRows,
    avalancheNotApplicableReason,
    safeAvalancheLink,
    getDangerText,
    snotelDepthDisplay,
    snotelSweDisplay,
    snotelDistanceDisplay,
    nohrscDepthDisplay,
    nohrscSweDisplay,
    cdecDepthDisplay,
    cdecSweDisplay,
    snowpackBestDepthDisplay,
    snowpackBestDepthSource,
    snowpackDepthConflict,
    snowpackDepthRangeDisplay,
    snowpackDepthConflictCaption,
    snowpackBestSweDisplay,
    snowpackBestSweSource,
    snowpackStatusLabel,
    snowpackPillClass,
    snowpackHistoricalComparisonLine,
    nwsTopAlerts,
    sourceFreshnessRows,
    formatAgeFromNow,
    formatPubTime,
    localizeUnitText,
    toPlainText,
    summarizeText,
    aiBriefNarrative,
    aiBriefError,
    aiBriefLoading,
    handleRequestAiBriefAction,
    rawReportPayload,
    snowVisionAnalysis,
    snowVisionImage,
    snowVisionError,
    snowVisionLoading,
    handleRequestSnowVisionAction,
    setMapStyle,
    shouldRenderRankedCard,
    // Critical checks
    orderedCriticalChecks,
    describeFailedCriticalCheck,
    // Score breakdown
    dayOverDay,
    // Weather
    weatherCardWithEmoji,
    weatherCardTemp,
    weatherCardFeelsLike,
    formattedWind,
    formattedGust,
    weatherCardPrecip,
    weatherCardHumidity,
    weatherCardDewPoint,
    weatherCardPressureLabel,
    weatherPressureTrendSummary,
    weatherPressureContextLine,
    weatherCardCloudCoverLabel,
    weatherCardWindDirection,
    weatherVisibilityScoreLabel,
    weatherVisibilityActiveWindowText,
    weatherVisibilityScoreMeaning,
    weatherVisibilityContextLine,
    weatherVisibilityRisk,
    weatherForecastPeriodLabel,
    forecastLeadHoursDisplay,
    weatherHourQuickOptions,
    selectedWeatherHourIndex,
    handleWeatherHourSelect,
    weatherConditionEmojiValue,
    weatherPreviewActive,
    weatherCardDisplayTime,
    weatherTrendChartData,
    weatherTrendHasData,
    weatherTrendMetric,
    weatherTrendMetricLabel,
    weatherTrendMetricOptions,
    weatherTrendLineColor,
    weatherTrendTickFormatter,
    formatWeatherTrendValue,
    onTrendMetricChange,
    selectedWeatherHourValue,
    weatherSourceDisplay,
    // Heat risk
    heatRiskLabel,
    heatRiskPillClass,
    heatRiskGuidance,
    heatRiskReasons,
    lowerTerrainHeatLabel,
    // Terrain
    terrainConditionDetails,
    terrainConditionPillClass,
    // Rainfall / precipitation
    precipInsightLine,
    expectedPrecipSummaryLine,
    rainfall24hSeverityClass,
    rainfall12hDisplay,
    rainfall24hDisplay,
    rainfall48hDisplay,
    snowfall12hDisplay,
    snowfall24hDisplay,
    snowfall48hDisplay,
    snowfall24hIn,
    expectedRainWindowDisplay,
    expectedSnowWindowDisplay,
    // Wind loading
    windLoadingHintsRelevant,
    windLoadingLevel,
    windLoadingConfidence,
    windLoadingPillClass,
    windLoadingSummary,
    windLoadingActionLine,
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
    // Air quality
    airQualityFutureNotApplicable,
    airQualityPillClassFn,
    // Fire risk
    fireRiskLabel,
    fireRiskPillClass,
    fireRiskAlerts,
    // Daylight / plan snapshot
    sunriseMinutesForPlan,
    sunsetMinutesForPlan,
    startMinutesForPlan,
    returnMinutes,
    daylightRemainingFromStartLabel,
    // Gear
    gearRecommendations,
  } = props;

  if (!safetyData || !decision) return null;

  const maxGustMph = preferences.maxWindGustMph || 35;
  const weatherLinkLat = safetyData.location?.lat ?? position.lat;
  const weatherLinkLon = safetyData.location?.lon ?? position.lng;
  const weatherGovLink = `https://forecast.weather.gov/MapClick.php?lat=${weatherLinkLat.toFixed(5)}&lon=${weatherLinkLon.toFixed(5)}`;
  const windyLink = `https://www.windy.com/?${weatherLinkLat.toFixed(5)},${weatherLinkLon.toFixed(5)},12`;

  const region = safetyData.location
    ? `${safetyData.location.lat.toFixed(4)}°, ${safetyData.location.lon.toFixed(4)}°`
    : `${position.lat.toFixed(4)}°, ${position.lng.toFixed(4)}°`;
  const localConditions = safetyData.localConditions || null;
  const nearbyObservation = localConditions?.weatherObservation || null;
  const radarObservation = localConditions?.radar || null;
  const streamflowObservation = localConditions?.streamflow || null;
  const accessObservation = localConditions?.access || null;
  const wildfireObservation = localConditions?.wildfire || null;
  const hasLocalObservations = Boolean(
    nearbyObservation?.available
      || radarObservation?.available
      || streamflowObservation?.available
      || accessObservation?.available
      || wildfireObservation?.available,
  );

  // ── Avalanche ──
  const avyLevel = avalancheUnknown ? 0 : overallAvalancheLevel ?? 0;
  const avyColor = DANGER_COLORS[Math.max(0, Math.min(5, avyLevel))];
  const avyProblems = (safetyData.avalanche?.problems || []).slice(0, 3);
  const avyBottomLine = safetyData.avalanche?.bottomLine ? toPlainText(safetyData.avalanche.bottomLine) : '';
  const avalancheCoverageExplanation = (() => {
    switch (String(safetyData.avalanche?.coverageStatus || '')) {
      case 'no_active_forecast':
        return 'No bulletin is currently published for this zone; many centers stop issuing products outside winter. Treat avalanche terrain as unrated: use low-angle, low-consequence routes, avoid terrain traps, and increase spacing.';
      case 'no_center_coverage':
        return 'No avalanche center covers this location. Treat avalanche terrain as unrated: use low-angle, low-consequence routes, avoid terrain traps, and increase spacing.';
      case 'temporarily_unavailable':
        return 'The avalanche bulletin could not be retrieved. Open the center report below before departure; until a current product is available, treat the terrain as unrated and conditions as potentially worse.';
      default:
        return 'Avalanche danger is unknown for this objective. Use low-angle, low-consequence routes, avoid terrain traps, and increase spacing until current information is available.';
    }
  })();

  // ── Sources ──
  const sourceState = (row: (typeof sourceFreshnessRows)[number]): string => {
    if (row.stateOverride) return row.stateOverride;
    if (row.issued == null) return 'missing';
    if (row.staleHours <= 2) return 'fresh';
    if (row.staleHours <= 12) return 'aging';
    return 'stale';
  };
  const freshCount = sourceFreshnessRows.filter((r) => ['fresh', 'ok'].includes(sourceState(r))).length;
  const agingCount = sourceFreshnessRows.filter((r) => sourceState(r) === 'aging').length;
  const sourceIssueCount = Math.max(0, sourceFreshnessRows.length - freshCount - agingCount);

  const bands = elevationForecastBands || [];
  const visibilityElevated = ['Moderate', 'High', 'Extreme'].includes(weatherVisibilityRisk.level);
  const visibilityTone = weatherVisibilityRisk.level === 'High' || weatherVisibilityRisk.level === 'Extreme'
    ? 'danger'
    : visibilityElevated
      ? 'caution'
      : 'quiet';
  const precipTone = Number.isFinite(weatherCardPrecip) && weatherCardPrecip >= 60
    ? 'caution'
    : 'quiet';
  const temperatureBand = getTemperatureBand(weatherCardTemp);
  // 44px floor keeps hour columns tappable/readable on phones; the strip scrolls
  // horizontally instead of crushing 12 columns into the viewport.
  const stripCols = `repeat(${Math.max(1, travelWindowRows.length)}, minmax(44px, 1fr))`;
  const travelWindowTone = travelWindowInsights.passHours === travelWindowRows.length
    ? 'clear'
    : travelWindowInsights.passHours === 0
      ? 'blocked'
      : 'mixed';
  const travelWindowHeadline = travelWindowTone === 'clear'
    ? `All ${travelWindowRows.length} hours stay within your limits`
    : travelWindowTone === 'blocked'
      ? 'No hour stays within every limit'
      : `${travelWindowInsights.passHours} of ${travelWindowRows.length} hours stay within your limits`;
  const bestTravelWindowLabel = travelWindowInsights.bestWindow
    ? formatTravelWindowSpan(travelWindowInsights.bestWindow, preferences.timeStyle)
    : 'No clean stretch';
  const topTravelWindowLimits = travelWindowInsights.topFailureLabels
    .slice(0, 2)
    .map(localizeUnitText)
    .join(' · ');
  const travelWindowIssueGroups: Array<{
    start: string;
    end: string;
    count: number;
    labels: string[];
    key: string;
    endIndex: number;
    exposureClass?: 'brief' | 'short' | 'sustained';
  }> = [];
  travelWindowRows.forEach((row, index) => {
    if (row.pass) return;
    const labels = row.failedRuleLabels.length > 0
      ? Array.from(new Set(row.failedRuleLabels.map(localizeUnitText)))
      : [localizeUnitText(row.reasonSummary || 'Threshold needs attention')];
    const key = labels.join('|');
    const previous = travelWindowIssueGroups[travelWindowIssueGroups.length - 1];
    if (previous && previous.endIndex === index - 1 && previous.key === key) {
      previous.end = row.time;
      previous.count += 1;
      previous.endIndex = index;
      if (row.exposureClass === 'sustained' || previous.exposureClass !== 'sustained') {
        previous.exposureClass = row.exposureClass;
      }
      return;
    }
    travelWindowIssueGroups.push({
      start: row.time,
      end: row.time,
      count: 1,
      labels,
      key,
      endIndex: index,
      exposureClass: row.exposureClass,
    });
  });
  const formatTravelIssueSpan = (start: string, end: string, count: number) => {
    const startLabel = formatClockForStyle(start, preferences.timeStyle);
    return count === 1 ? startLabel : `${startLabel}–${formatClockForStyle(end, preferences.timeStyle)}`;
  };

  // ── ACTION PLAN: the plan levers the user can still change, ranked ──
  const fmtSpan = (s: { start: string; end: string }) =>
    `${formatClockForStyle(s.start, preferences.timeStyle)}–${formatClockForStyle(s.end, preferences.timeStyle)}`;

  type PlanTone = 'stop' | 'shift' | 'pick' | 'prep';
  const planActions: Array<{ tone: PlanTone; icon: React.ReactNode; title: string; detail?: string }> = [];

  // Hard stops — surface no-go blockers at the very top of the to-do list.
  (decision.blockers || []).forEach((b) =>
    planActions.push({
      tone: 'stop',
      icon: <ShieldAlert size={15} />,
      title: localizeUnitText(b),
      detail: 'No-go: change the objective, timing, or day; do not try to solve this hazard with gear alone.',
    }),
  );

  // Re-time around the clean travel window.
  const totalWindowHrs = travelWindowRows.length;
  const twi = travelWindowInsights;
  if (totalWindowHrs > 0 && twi) {
    const topFails = (twi.topFailureLabels || []).slice(0, 2).map(localizeUnitText).join(', ');
    if (twi.passHours === 0) {
      planActions.push({
        tone: 'shift',
        icon: <Clock size={15} />,
        title: 'No clean travel hours in your window',
        detail: twi.nextCleanWindow
          ? `Next clean break is ${fmtSpan(twi.nextCleanWindow)} — re-time your start or pick another day.`
          : `Every hour trips a threshold${topFails ? ` (${topFails})` : ''}. Choose another day or a lower-consequence objective.`,
      });
    } else if (twi.passHours < totalWindowHrs && twi.bestWindow) {
      planActions.push({
        tone: 'shift',
        icon: <Clock size={15} />,
        title: `Center your push on ${fmtSpan(twi.bestWindow)}`,
        detail: `${twi.passHours} of ${totalWindowHrs} hrs stay clean${topFails ? `; ${topFails} gate the rest` : ''}.`,
      });
    }
  }

  // Pick terrain away from wind-loaded aspects.
  if (windLoadingHintsRelevant && leewardAspectHints.length > 0) {
    planActions.push({
      tone: 'pick',
      icon: <Wind size={15} />,
      title: `Steer off wind-loaded lee aspects: ${leewardAspectHints.join(', ')}`,
      detail:
        aspectOverlapProblems.length > 0
          ? `These overlap active avalanche problem aspects (${aspectOverlapProblems.join(', ')}).`
          : windLoadingElevationFocus
            ? localizeUnitText(windLoadingElevationFocus)
            : undefined,
    });
  } else if (
    windLoadingHintsRelevant &&
    windLoadingActionLine &&
    String(windLoadingLevel || '').toLowerCase() !== 'low'
  ) {
    planActions.push({ tone: 'pick', icon: <Wind size={15} />, title: localizeUnitText(windLoadingActionLine) });
  }

  // Prep for finishing in the dark.
  if (returnExtendsPastMidnight) {
    planActions.push({
      tone: 'prep',
      icon: <Sun size={15} />,
      title: 'Your plan runs past midnight',
      detail: 'Pack a headlamp and night layers, or move your start earlier.',
    });
  }

  // Non-negotiable gear (safety-critical only). Situational entries like "Avalanche
  // coverage gap" are advice, not packable items — the caution list already covers them.
  const mustGear = gearRecommendations.filter((g) => g.tone === 'nogo' && !/coverage gap/i.test(g.title));
  if (mustGear.length > 0) {
    planActions.push({
      tone: 'prep',
      icon: <Package size={15} />,
      title: `Don't leave without: ${mustGear.map((g) => g.title).join(', ')}`,
    });
  }

  const TONE_PRIORITY: Record<PlanTone, number> = { stop: 0, shift: 1, pick: 2, prep: 3 };
  const TONE_TAG: Record<PlanTone, string> = { stop: 'Stop', shift: 'Re-time', pick: 'Route', prep: 'Prep' };
  const rankedActions = planActions
    .slice()
    .sort((a, b) => TONE_PRIORITY[a.tone] - TONE_PRIORITY[b.tone])
    .slice(0, 5);

  // In-page jump navigation: only sections that actually render get a chip. The id
  // list mirrors the `id` attributes on the sections below.
  const jumpSections = [
    { id: 'planner-section-decision', label: 'Verdict', present: true },
    { id: 'planner-section-monitor', label: 'Watch', present: featureFlags.objectiveWatch && Boolean(props.reportSnapshot) },
    { id: 'planner-section-route', label: 'Route', present: Boolean(props.routeAnalysisSlot) },
    { id: 'planner-section-actions', label: 'Plan', present: true },
    { id: 'planner-section-terrain-window', label: 'Terrain window', present: featureFlags.terrainWindow && travelWindowRows.length > 0 && bands.length > 0 },
    { id: 'planner-section-travel', label: 'Travel', present: travelWindowRows.length > 0 },
    { id: 'planner-section-checks', label: 'Checks', present: Boolean(shouldRenderRankedCard('criticalChecks') && orderedCriticalChecks.length > 0) },
    { id: 'planner-section-weather', label: 'Weather', present: true },
    { id: 'planner-section-wind', label: 'Wind', present: Boolean((shouldRenderRankedCard('windLoading') || shouldRenderRankedCard('windLoadingHints')) && windLoadingHintsRelevant) },
    { id: 'planner-section-avalanche', label: 'Avalanche', present: true },
    { id: 'planner-section-snowpack', label: 'Snowpack', present: Boolean(safetyData.snowpack && (safetyData.snowpack.snotel || safetyData.snowpack.nohrsc || safetyData.snowpack.cdec)) },
    { id: 'planner-section-observations', label: 'Observations', present: hasLocalObservations },
    { id: 'planner-section-alerts', label: 'Alerts', present: true },
    { id: 'planner-section-score', label: 'Score', present: Boolean(shouldRenderRankedCard('scoreTrace') && Array.isArray(safetyData.safety.factors) && safetyData.safety.factors.length > 0) },
    { id: 'planner-section-gear', label: 'Gear', present: Boolean(shouldRenderRankedCard('recommendedGear') && gearRecommendations.length > 0) },
  ].filter((s) => s.present);
  const jumpToSection = (id: string, moveFocus: boolean) => {
    const target = document.getElementById(id);
    if (!target) return;
    if (moveFocus) {
      const focusTarget = target.querySelector<HTMLElement>('h2') || target;
      if (!focusTarget.hasAttribute('tabindex')) focusTarget.setAttribute('tabindex', '-1');
      focusTarget.focus({ preventScroll: true });
    }
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    target.scrollIntoView({ behavior, block: 'start' });
  };
  const useStartTimeForNewReport = (startTime: string) => {
    onEditPlan();
    setAlpineStartTime(startTime);
    setMobileMapControlsExpanded(() => true);
    try { window.localStorage.setItem('summitsafe:mobile-controls-expanded', 'true'); } catch { /* ignore */ }
    window.requestAnimationFrame(() => {
      document.getElementById('planner-plan-workflow')?.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
  };

  return (
    <div className="ssr-report">
      {/* OBJECTIVE HEADER */}
      <header className="ssr-hdr">
        <div className="ssr-hdr-title">
          <span className="ssr-hdr-icon">
            <Mountain size={24} />
          </span>
          <h1>
            {objectiveName || 'Objective'}
            <span className="ssr-sub">
              {props.formatIsoDateLabel(props.forecastDate)} · {region} · {safetyData.weather.description || 'Backcountry'}
            </span>
          </h1>
        </div>
        <div className="ssr-hdr-stats">
          <div className="ssr-hdr-stat">
            <div className="ssr-k">Elevation</div>
            <div className="ssr-v">{formatElevationDisplay(objectiveElevationFt)}</div>
          </div>
          <div className="ssr-hdr-stat">
            <div className="ssr-k">Start</div>
            <div className="ssr-v">{displayStartTime}</div>
          </div>
          <div className="ssr-hdr-stat">
            <div className="ssr-k">Window</div>
            <div className="ssr-v">{travelWindowHoursLabel}</div>
          </div>
          <div className="ssr-hdr-stat">
            <div className="ssr-k">Return</div>
            <div className="ssr-v">
              {returnTimeFormatted ? formatClockForStyle(returnTimeFormatted, preferences.timeStyle) : '—'}
              {returnExtendsPastMidnight ? <small>+1</small> : null}
            </div>
          </div>
        </div>
      </header>

      {jumpSections.length > 1 && (
        <ReportJumpNav sections={jumpSections} onJump={jumpToSection} />
      )}

      <div className="ssr-main">
        {/* VERDICT */}
        <div id="planner-section-decision" className="ssr-jump-anchor">
        <DashboardSummaryCard
          readOnly={props.restoredFromHistory}
          aiAvailability={aiAvailability}
          safetyData={safetyData}
          previousSafetyData={props.previousSafetyData}
          decision={decision}
          preferences={preferences}
          objectiveName={objectiveName}
          forecastDate={props.forecastDate}
          travelWindowHours={props.travelWindowHours}
          importedGpxRoute={props.importedGpxRoute}
          planStartTime={alpineStartTime}
          displayStartTime={displayStartTime}
          returnTimeFormatted={returnTimeFormatted}
          returnExtendsPastMidnight={returnExtendsPastMidnight}
          formatClockForStyle={formatClockForStyle}
          getScoreColor={getScoreColor}
          formatTempDisplay={formatTempDisplay}
          formatWindDisplay={formatWindDisplay}
          decisionActionLine={decisionActionLine}
          localizeUnitText={localizeUnitText}
          travelWindowRows={travelWindowRows}
          travelWindowInsights={travelWindowInsights}
          aiBriefNarrative={aiBriefNarrative}
          aiBriefError={aiBriefError}
          aiBriefLoading={aiBriefLoading}
          onNewReport={onEditPlan}
          onRequestAiBrief={handleRequestAiBriefAction}
          rawReportPayload={rawReportPayload}
          reportChatMessages={props.reportChatMessages}
          reportChatSessionKey={props.reportChatSessionKey}
          onReportChatMessagesChange={props.onReportChatMessagesChange}
        />
        </div>

        {featureFlags.objectiveWatch && props.reportSnapshot && (
          <ObjectiveMonitoringCard
            report={props.reportSnapshot}
            activeSavedReportId={props.activeSavedReportId}
            readOnly={props.restoredFromHistory}
          />
        )}

        {props.routeAnalysisSlot}

        {featureFlags.startTimeComparisons && <StartTimeScenarioCard
          comparison={startTimeScenarioComparison}
          loading={startTimeScenariosLoading}
          error={startTimeScenariosError}
          preferences={preferences}
          currentStartTime={alpineStartTime}
          formatClockForStyle={formatClockForStyle}
          formatWindDisplay={formatWindDisplay}
          formatTempDisplay={formatTempDisplay}
          onUseForNewReport={useStartTimeForNewReport}
          canGenerateMore={canGenerateMoreStartTimeScenarios}
          onGenerateMore={generateMoreStartTimeScenarios}
        />}

        {featureFlags.terrainWindow && <TerrainWindowCard
          travelRows={travelWindowRows}
          elevationBands={bands}
          avalancheProblems={safetyData.avalanche?.problems || []}
          avalancheRelevant={avalancheRelevant}
          avalancheUnknown={avalancheUnknown}
          avalancheDanger={overallAvalancheLevel}
          leewardAspects={leewardAspectHints}
          secondaryAspects={secondaryWindAspects}
          preferences={preferences}
          formatClock={formatClockForStyle}
          formatElevation={formatElevationDisplay}
        />}

        {/* ACTION PLAN */}
        <section className="ssr-card ssr-actions" id="planner-section-actions">
          <div className="ssr-card-h">
            <h2>
              <span className="ssr-h-icon icon-neutral"><Compass size={16} /></span>
              What to adjust
            </h2>
            <span className="ssr-h-meta">
              {rankedActions.length > 0
                ? `${rankedActions.length} lever${rankedActions.length !== 1 ? 's' : ''}`
                : 'on track'}
            </span>
          </div>
          <div className="ssr-card-b">
            {rankedActions.length === 0 ? (
              <div className="ssr-cc-allclear">
                <CheckCircle2 size={16} /> No model threshold calls for an adjustment. Verify current official sources and reassess at field checkpoints.
              </div>
            ) : (
              <ol className="ssr-actions-list">
                {rankedActions.map((a, i) => (
                  <li className={`ssr-action ${a.tone}`} key={i}>
                    <span className="ssr-action-ic">{a.icon}</span>
                    <div className="ssr-action-body">
                      <span className="ssr-action-title">{a.title}</span>
                      {a.detail && <span className="ssr-action-detail">{a.detail}</span>}
                    </div>
                    <span className="ssr-action-tag">{TONE_TAG[a.tone]}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        {/* TRAVEL WINDOW */}
        {travelWindowRows.length > 0 && (
          <section className={`ssr-card ssr-tw-card ${travelWindowTone}`} id="planner-section-travel">
            <div className="ssr-card-h">
              <h2>
                <span className="ssr-h-icon icon-blue"><Clock size={16} /></span>
                Travel Window
              </h2>
              <span className="ssr-h-meta">
                {displayStartTime}
                {returnTimeFormatted ? ` → ${formatClockForStyle(returnTimeFormatted, preferences.timeStyle)}` : ` · ${travelWindowHoursLabel}`}
                {returnExtendsPastMidnight ? ' (+1 day)' : ''}
              </span>
            </div>
            <div className="ssr-card-b ssr-tight">
              <div className={`ssr-tw-overview ${travelWindowTone}`}>
                <div className="ssr-tw-verdict">
                  <span className="ssr-tw-verdict-icon" aria-hidden>
                    {travelWindowTone === 'clear'
                      ? <CheckCircle2 size={19} />
                      : travelWindowTone === 'blocked'
                        ? <XCircle size={19} />
                        : <AlertTriangle size={19} />}
                  </span>
                  <div>
                    <span className="ssr-tw-eyebrow">Window read</span>
                    <strong>{travelWindowHeadline}</strong>
                    <p>
                      {travelWindowTone === 'clear'
                        ? `${travelWindowInsights.conditionTrendLabel}. Keep normal field checkpoints in the plan.`
                        : topTravelWindowLimits
                          ? `Main limits: ${topTravelWindowLimits}.`
                          : 'Review the gated hours before committing to the plan.'}
                    </p>
                  </div>
                </div>
                <dl className="ssr-tw-stats">
                  <div>
                    <dt>Best stretch</dt>
                    <dd>{bestTravelWindowLabel}</dd>
                    <span>
                      {travelWindowInsights.bestWindow
                        ? `${travelWindowInsights.bestWindow.length} continuous hour${travelWindowInsights.bestWindow.length === 1 ? '' : 's'}`
                        : 'Re-time or change the plan'}
                    </span>
                  </div>
                  <div className={`trend-${travelWindowInsights.trendDirection}`}>
                    <dt>Window trend</dt>
                    <dd>{travelWindowInsights.trendLabel}</dd>
                    <span>{travelWindowInsights.conditionTrendLabel}</span>
                  </div>
                  <div>
                    <dt>Hours gated</dt>
                    <dd>{travelWindowInsights.failHours}</dd>
                    <span>of {travelWindowRows.length} forecast hours</span>
                  </div>
                </dl>
              </div>

              <div className="ssr-tw-detail-head">
                <div>
                  <strong>Hour-by-hour detail</strong>
                  <span>Compared with the thresholds in your settings</span>
                </div>
                <div className="ssr-keys" aria-label="Travel window legend">
                  <span className="ssr-key">Clean</span>
                  <span className="ssr-key gate">Gated</span>
                </div>
              </div>
              <div className="ssr-strip-scroll">
                <div className="ssr-strip-rows" tabIndex={0} aria-label="Scrollable hourly travel window forecast">
                  <div className="ssr-srow">
                    <div className="ssr-srow-lbl"><Clock size={14} /> Hour</div>
                    <div className="ssr-srow-cells" style={{ gridTemplateColumns: stripCols }}>
                      {travelWindowRows.map((r, i) => (
                        <div key={i} className="ssr-scell hour-header">
                          {formatClockForStyle(r.time, preferences.timeStyle)}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="ssr-srow">
                    <div className="ssr-srow-lbl"><Thermometer size={14} /> Temp · Feels</div>
                    <div className="ssr-srow-cells" style={{ gridTemplateColumns: stripCols }}>
                      {travelWindowRows.map((r, i) => (
                        <div key={i} className="ssr-scell">
                          <span className="ssr-cv">{formatTempDisplay(r.temp, { includeUnit: false })}</span>
                          <span className="ssr-cv-sub">F {formatTempDisplay(r.feelsLike, { includeUnit: false })}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="ssr-srow">
                    <div className="ssr-srow-lbl"><Wind size={14} /> Wind · Gust</div>
                    <div className="ssr-srow-cells" style={{ gridTemplateColumns: stripCols }}>
                      {travelWindowRows.map((r, i) => (
                        <div key={i} className="ssr-scell">
                          <span className="ssr-cv">{formatWindDisplay(r.wind, { includeUnit: false })}</span>
                          <span
                            className="ssr-cv-sub"
                            style={{
                              color: r.gust > maxGustMph ? 'var(--ssr-nogo-ink)' : 'var(--ssr-text-3)',
                              fontWeight: r.gust > maxGustMph ? 700 : 400,
                            }}
                          >
                            G {formatWindDisplay(r.gust, { includeUnit: false })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="ssr-srow">
                    <div className="ssr-srow-lbl"><CloudRain size={14} /> Precip</div>
                    <div className="ssr-srow-cells" style={{ gridTemplateColumns: stripCols }}>
                      {travelWindowRows.map((r, i) => (
                        <div key={i} className="ssr-scell">
                          <span
                            className="ssr-cv"
                            style={{
                              opacity: r.precipChance === 0 ? 0.35 : 1,
                              color: r.precipChance > preferences.maxPrecipChance ? 'var(--ssr-nogo-ink)' : undefined,
                            }}
                          >
                            {r.precipChance === 0 ? '—' : `${Math.round(r.precipChance)}%`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="ssr-srow">
                    <div className="ssr-srow-lbl ssr-srow-status">
                      <ShieldCheck size={14} /> Thresholds
                    </div>
                    <div className="ssr-srow-cells" style={{ gridTemplateColumns: stripCols }}>
                      {travelWindowRows.map((r, i) => {
                        const timeLabel = formatClockForStyle(r.time, preferences.timeStyle);
                        const reason = localizeUnitText(r.reasonSummary || (r.pass ? 'Meets thresholds' : 'Needs attention'));
                        return (
                          <div
                            key={i}
                            className={`ssr-scell move ${r.pass ? 'pass' : 'gate'}`}
                            title={`${timeLabel}: ${reason}`}
                            aria-label={`${timeLabel}: ${r.pass ? 'clean' : 'gated'}. ${reason}`}
                          >
                            <span className="ssr-cv" aria-hidden>
                              {r.pass ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {travelWindowIssueGroups.length > 0 && (
                <div className="ssr-tw-issues">
                  <div className="ssr-tw-issues-head">
                    <span><AlertTriangle size={14} /> Periods to plan around</span>
                    <small>{travelWindowIssueGroups.length} distinct period{travelWindowIssueGroups.length === 1 ? '' : 's'}</small>
                  </div>
                  <div className="ssr-tw-issue-list">
                    {travelWindowIssueGroups.map((group, index) => (
                      <div className={`ssr-tw-issue ${group.exposureClass || 'brief'}`} key={`${group.start}-${group.key}-${index}`}>
                        <time>{formatTravelIssueSpan(group.start, group.end, group.count)}</time>
                        <div>
                          <strong>{group.labels.join(' · ')}</strong>
                          <span>
                            {group.count} hour{group.count === 1 ? '' : 's'} of exposure
                            {group.exposureClass === 'sustained'
                              ? ' · sustained'
                              : group.exposureClass === 'short'
                                ? ' · short run'
                                : ' · brief'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="ssr-strip-foot">
                <ShieldCheck size={14} aria-hidden />
                <span>{localizeUnitText(travelWindowSummary)} Thresholds reflect your settings, not a guarantee of safe travel.</span>
              </div>
            </div>
          </section>
        )}

        {/* CRITICAL CHECKS */}
        {shouldRenderRankedCard('criticalChecks') && orderedCriticalChecks.length > 0 && (() => {
          const failing = orderedCriticalChecks.filter((c) => !c.ok);
          const passing = orderedCriticalChecks.filter((c) => c.ok);
          const total = orderedCriticalChecks.length;
          const hasFailures = failing.length > 0;
          const statusTone = hasFailures ? (decision.level === 'NO-GO' ? 'nogo' : 'caution') : 'go';
          const statusLabel = hasFailures
            ? `${failing.length} need${failing.length === 1 ? 's' : ''} action`
            : 'All clear';
          const statusGuidance = hasFailures
            ? decision.level === 'NO-GO'
              ? 'Do not commit to this plan until the failed thresholds change.'
              : 'Adjust timing, terrain, or limits before you commit.'
            : 'No configured threshold is currently tripped. Recheck official sources and conditions before departure.';
          const passingChecks = (
            <div className="ssr-cc-pass-grid">
              {passing.map((check, idx) => (
                <div className="ssr-cc-pass" key={`p-${idx}`} title={check.detail ? localizeUnitText(check.detail) : undefined}>
                  <CheckCircle2 size={13} />
                  <span>{localizeUnitText(check.label)}</span>
                </div>
              ))}
            </div>
          );
          return (
            <section className={`ssr-card ssr-cc-card ${statusTone}`} id="planner-section-checks">
              <div className="ssr-card-h">
                <h2>
                  <span className={`ssr-h-icon ssr-cc-h-icon ${statusTone}`}>
                    {hasFailures ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />}
                  </span>
                  Critical Checks
                </h2>
                <span className={`ssr-cc-head-status ${statusTone}`}>{statusLabel}</span>
              </div>
              <div className="ssr-card-b">
                <div className={`ssr-cc-overview ${statusTone}`}>
                  <span className="ssr-cc-overview-icon" aria-hidden>
                    {hasFailures ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
                  </span>
                  <div className="ssr-cc-overview-copy">
                    <strong>{hasFailures ? `${failing.length} of ${total} checks need attention` : `${total} of ${total} checks pass`}</strong>
                    <span>{statusGuidance}</span>
                  </div>
                  <div className="ssr-cc-meter" title={`${passing.length} of ${total} checks passing`} aria-label={`${passing.length} of ${total} checks passing`}>
                    <span className="ssr-cc-meter-bar" aria-hidden>
                      {orderedCriticalChecks.map((c, i) => <i key={i} className={c.ok ? 'ok' : 'fail'} />)}
                    </span>
                    <span className="ssr-cc-meter-num">{passing.length}/{total} pass</span>
                  </div>
                </div>

                {hasFailures && (
                  <div className="ssr-cc-group">
                    <div className={`ssr-cc-group-h ${statusTone}`}>
                      <AlertTriangle size={13} /> {decision.level === 'NO-GO' ? 'Resolve before committing' : 'Plan adjustments needed'} <span className="ssr-cc-count">{failing.length}</span>
                    </div>
                    <div className="ssr-cc-fails">
                      {failing.map((check, idx) => (
                        <div className={`ssr-cc-fail ${statusTone}`} key={`f-${idx}`}>
                          <span className="ssr-cc-fail-ic"><XCircle size={15} /></span>
                          <div className="ssr-cc-fail-body">
                            <span className="ssr-cc-fail-meta">{localizeUnitText(check.label)}</span>
                            <span className="ssr-cc-fail-lbl">{localizeUnitText(describeFailedCriticalCheck(check))}</span>
                            {check.detail && <span className="ssr-cc-fail-detail">{localizeUnitText(check.detail)}</span>}
                            {check.action && (
                              <span className="ssr-cc-fail-action">
                                <ArrowRight size={12} />
                                <span><strong>Next step:</strong> {localizeUnitText(check.action)}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {passing.length > 0 && (
                  hasFailures ? (
                    <details className="ssr-cc-passing-details">
                      <summary>
                        <span><CheckCircle2 size={13} /> Passing checks</span>
                        <span className="ssr-cc-count">{passing.length}</span>
                      </summary>
                      {passingChecks}
                    </details>
                  ) : (
                    <div className="ssr-cc-group ssr-cc-passing-group">
                      <div className="ssr-cc-group-h">
                        <CheckCircle2 size={13} /> Checks reviewed <span className="ssr-cc-count">{passing.length}</span>
                      </div>
                      {passingChecks}
                    </div>
                  )
                )}
              </div>
            </section>
          );
        })()}

        {/* WEATHER */}
        <section className="ssr-card ssr-weather-card" id="planner-section-weather">
          <div className="ssr-card-h">
            <h2>
              <span className="ssr-h-icon icon-blue"><Thermometer size={16} /></span>
              Weather
            </h2>
            <span className="ssr-h-meta">
              {weatherPreviewActive
                ? (weatherCardDisplayTime || 'Selected hour')
                : safetyData.forecast?.isFuture ? (forecastLeadHoursDisplay || weatherForecastPeriodLabel || 'Forecast') : 'Current'}
            </span>
          </div>
          <div className="ssr-card-b">
            <div className="ssr-wx-overview">
              <div className={`ssr-wx-hero${temperatureBand ? ` temp-${temperatureBand.key}` : ''}`}>
                <span className="ssr-wx-moment">
                  {weatherPreviewActive ? 'Previewing' : 'At planned start'}
                  {weatherCardDisplayTime ? ` · ${weatherCardDisplayTime}` : ''}
                </span>
                <div className="ssr-wx-hero-reading">
                  <span className="ssr-wx-temp">{formatTempDisplay(weatherCardTemp)}</span>
                  <div className="ssr-wx-hero-meta">
                    <span className="ssr-wx-cond">{weatherCardWithEmoji}</span>
                    <div className="ssr-wx-hero-tags">
                      {temperatureBand && <span className="ssr-wx-temp-band">{temperatureBand.label}</span>}
                      <span className="ssr-wx-feels">Feels {formatTempDisplay(weatherCardFeelsLike)}</span>
                    </div>
                  </div>
                </div>
                {weatherForecastPeriodLabel && <span className="ssr-wx-period">{weatherForecastPeriodLabel}</span>}
              </div>
              <div className="ssr-wx-priority" aria-label="Weather at a glance">
                <div className="ssr-wx-priority-item">
                  <span className="ssr-wx-priority-icon"><Wind size={15} /></span>
                  <span className="ssr-wx-priority-copy">
                    <span className="ssr-k">Wind · gust</span>
                    <span className="ssr-v">{formattedWind} · {formattedGust}</span>
                    <span className="ssr-wx-sub"><WindDirectionArrow direction={weatherCardWindDirection} size={11} />{weatherCardWindDirection || 'Direction unavailable'}</span>
                  </span>
                </div>
                <div className={`ssr-wx-priority-item ${precipTone}`}>
                  <span className="ssr-wx-priority-icon"><CloudRain size={15} /></span>
                  <span className="ssr-wx-priority-copy">
                    <span className="ssr-k">Precipitation</span>
                    <span className="ssr-v">{Number.isFinite(weatherCardPrecip) ? `${weatherCardPrecip}%` : 'N/A'}</span>
                    <span className="ssr-wx-sub">Chance at selected hour</span>
                  </span>
                </div>
                <div className={`ssr-wx-priority-item ${visibilityTone}`}>
                  <span className="ssr-wx-priority-icon"><Eye size={15} /></span>
                  <span className="ssr-wx-priority-copy">
                    <span className="ssr-k">Low-visibility risk</span>
                    <span className="ssr-v">{weatherVisibilityRisk.level || 'Unknown'}</span>
                    <span className="ssr-wx-sub">
                      {weatherVisibilityScoreLabel && weatherVisibilityScoreLabel !== 'N/A'
                        ? `Risk score ${weatherVisibilityScoreLabel}`
                        : 'Risk score unavailable'}
                    </span>
                  </span>
                </div>
              </div>
            </div>
            {weatherHourQuickOptions.length > 1 && (
              <div className="ssr-wx-hours">
                <div className="ssr-wx-section-head">
                  <div>
                    <span className="ssr-wx-eyebrow">Hourly forecast</span>
                    <strong>Select an hour to preview conditions</strong>
                  </div>
                  {weatherPreviewActive && <span className="ssr-wx-preview-badge">Preview active</span>}
                </div>
                <WeatherHourPillStrip
                  options={weatherHourQuickOptions}
                  selectedIndex={selectedWeatherHourIndex}
                  onSelect={handleWeatherHourSelect}
                  weatherConditionEmoji={weatherConditionEmojiValue}
                />
              </div>
            )}
            {weatherTrendHasData && (
              <WeatherTrendMiniChart
                data={weatherTrendChartData}
                metric={weatherTrendMetric}
                metricLabel={weatherTrendMetricLabel}
                metricOptions={weatherTrendMetricOptions}
                lineColor={weatherTrendLineColor}
                selectedHourValue={selectedWeatherHourValue}
                formatTick={weatherTrendTickFormatter}
                formatValue={formatWeatherTrendValue}
                onMetricChange={onTrendMetricChange}
              />
            )}
            <div className="ssr-wx-section-label">Supporting readings</div>
            <div className="ssr-wx-grid">
              <div className="ssr-wx-cell"><span className="ssr-k">Humidity</span><span className="ssr-v">{Number.isFinite(weatherCardHumidity) ? `${Math.round(weatherCardHumidity)}%` : 'N/A'}</span></div>
              <div className="ssr-wx-cell"><span className="ssr-k">Dew point</span><span className="ssr-v">{formatTempDisplay(weatherCardDewPoint)}</span></div>
              <div className="ssr-wx-cell"><span className="ssr-k">Pressure</span><span className="ssr-v">{weatherCardPressureLabel || '—'}</span></div>
              <div className="ssr-wx-cell"><span className="ssr-k">Cloud cover</span><span className="ssr-v">{weatherCardCloudCoverLabel || '—'}</span></div>
            </div>
            <div className="ssr-wx-context" aria-label="Forecast context">
              <div className="ssr-wx-context-item">
                <span className="ssr-wx-context-icon"><Thermometer size={14} /></span>
                <span>
                  <strong>Pressure context</strong>
                  <small>{localizeUnitText(weatherPressureTrendSummary || weatherPressureContextLine)}</small>
                </span>
              </div>
              <div className={`ssr-wx-context-item ${visibilityTone}`}>
                <span className="ssr-wx-context-icon"><Eye size={14} /></span>
                <span>
                  <strong>
                    Visibility · {weatherVisibilityRisk.level || 'Unknown'}
                    {weatherVisibilityScoreLabel && weatherVisibilityScoreLabel !== 'N/A' ? ` · ${weatherVisibilityScoreLabel}` : ''}
                  </strong>
                  <small>{weatherVisibilityContextLine || weatherVisibilityScoreMeaning}</small>
                  {weatherVisibilityActiveWindowText && <em>{weatherVisibilityActiveWindowText}</em>}
                </span>
              </div>
            </div>
            <div className="ssr-wx-source">
              <span>Forecast source · <strong>{weatherSourceDisplay}</strong></span>
              <a href={weatherGovLink} target="_blank" rel="noreferrer">
                Weather.gov forecast <ExternalLink size={12} aria-hidden />
              </a>
              <a href={windyLink} target="_blank" rel="noreferrer">
                Windy map <ExternalLink size={12} aria-hidden />
              </a>
            </div>
          </div>
        </section>

        {/* ELEVATION */}
        {bands.length >= 2 && (
          <ElevationProfileSection
            bands={bands}
            maxGustMph={maxGustMph}
            note={safetyData.weather.elevationForecastNote}
            forecastPeriodLabel={formatForecastPeriodLabel(
              safetyData.weather.forecastStartTime,
              safetyData.weather.timezone || null,
            )}
            targetElevationInput={targetElevationInput}
            handleTargetElevationChange={handleTargetElevationChange}
            elevationUnitLabel={elevationUnitLabel}
            targetElevationForecast={targetElevationForecast}
            targetElevationFt={targetElevationFt}
            formatTempDisplay={formatTempDisplay}
            formatWindDisplay={formatWindDisplay}
            formatElevationDisplay={formatElevationDisplay}
            formatElevationDeltaDisplay={formatElevationDeltaDisplay}
          />
        )}

        {/* WIND LOADING */}
        {(shouldRenderRankedCard('windLoading') || shouldRenderRankedCard('windLoadingHints')) && windLoadingHintsRelevant && (
          <section className={`ssr-card ssr-wl-card ssr-wl-${windLoadingPillClass}`} id="planner-section-wind">
            <div className="ssr-card-h">
              <h2>
                <span className="ssr-h-icon icon-cyan"><Wind size={16} /></span>
                Wind Loading
              </h2>
              <span className={`ssr-pill ${windLoadingPillClass}`}>{windLoadingLevel}</span>
            </div>
            <div className="ssr-card-b">
              {avalancheUnknown && (
                <div className="ssr-wl-note"><AlertTriangle size={15} aria-hidden /><span>No official forecast is available. Use wind loading as a primary terrain-selection signal.</span></div>
              )}

              <div className="ssr-wl-decision">
                <span className="ssr-wl-decision-icon"><Route size={18} aria-hidden /></span>
                <div>
                  <span className="ssr-wl-eyebrow">Terrain decision</span>
                  <p>{localizeUnitText(windLoadingActionLine)}</p>
                </div>
              </div>

              {windLoadingSummary && <p className="ssr-wl-summary">{localizeUnitText(windLoadingSummary)}</p>}

              <div className="ssr-wl-status" aria-label="Wind-loading status">
                <div>
                  <span className="ssr-wl-status-icon"><Wind size={15} aria-hidden /></span>
                  <span><small>Transport</small><strong>{windLoadingLevel}</strong></span>
                </div>
                <div>
                  <span className="ssr-wl-status-icon"><Clock size={15} aria-hidden /></span>
                  <span><small>Active window</small><strong>{windLoadingActiveWindowLabel}</strong></span>
                </div>
                <div>
                  <span className="ssr-wl-status-icon"><Radio size={15} aria-hidden /></span>
                  <span><small>Confidence</small><strong>{windLoadingConfidence}</strong></span>
                </div>
              </div>

              <div className="ssr-wl-terrain">
                <div className="ssr-wl-terrain-head">
                  <div>
                    <span className="ssr-wl-eyebrow">Where snow may collect</span>
                    <strong>Likely lee terrain</strong>
                  </div>
                  <span className="ssr-wl-direction"><Compass size={14} aria-hidden /> Wind basis: {resolvedWindDirectionSource}</span>
                </div>
                {leewardAspectHints.length > 0 && (
                  <div className="ssr-aspect-chips">
                    {leewardAspectHints.map((a) => <span key={a} className="ssr-aspect-chip">{a}</span>)}
                  </div>
                )}
                {secondaryWindAspects.length > 0 && Number.isFinite(windGustMph) && windGustMph >= 20 && (
                  <div className="ssr-wl-secondary">
                    <span>Also watch cross-loaded</span>
                    <div className="ssr-aspect-chips">
                      {secondaryWindAspects.map((a) => <span key={`s-${a}`} className="ssr-aspect-chip secondary">{a}</span>)}
                    </div>
                  </div>
                )}
                <p className="ssr-wl-elevation"><Mountain size={14} aria-hidden /><span>{localizeUnitText(windLoadingElevationFocus)}</span></p>
                {aspectOverlapProblems.length > 0 && (
                  <p className="ssr-wl-overlap"><AlertTriangle size={15} aria-hidden /><span><strong>Problem overlap:</strong> Wind loading aligns with {aspectOverlapProblems.join(', ')}.</span></p>
                )}
              </div>

              <div className="ssr-wl-evidence">
                <div><span>Active hours</span><strong>{windLoadingActiveHoursDetail}</strong></div>
                <div><span>Trend agreement</span><strong>{trendAgreementRatio !== null ? `${Math.round(trendAgreementRatio * 100)}%` : 'N/A'}</strong></div>
              </div>

              {windLoadingNotes.length > 0 && (
                <details className="ssr-wl-details">
                  <summary>How this assessment was built <span>{windLoadingNotes.length} signals</span></summary>
                  <ul className="ssr-bullets">
                    {windLoadingNotes.map((n, i) => <li key={`wln-${i}`}>{localizeUnitText(n)}</li>)}
                  </ul>
                </details>
              )}
            </div>
          </section>
        )}

      </div>

      {/* SIDEBAR */}
      <aside className="ssr-side">
        {/* AVALANCHE */}
        <section className="ssr-card" id="planner-section-avalanche">
          <div className="ssr-card-h">
            <h2>
              <span className="ssr-h-icon icon-orange"><AlertTriangle size={16} /></span>
              Avalanche
            </h2>
            {safetyData.avalanche?.center && <span className="ssr-h-meta">{safetyData.avalanche.center}</span>}
          </div>
          <div className="ssr-card-b">
            {avalancheRelevant && !avalancheUnknown ? (
              <>
                <div className="ssr-avy-head">
                  <div className="ssr-avy-max">
                    <span
                      className="ssr-lv-num"
                      style={{ background: avyColor, color: avyLevel >= 4 ? 'white' : 'oklch(25% 0.08 55)' }}
                    >
                      {avyLevel || '—'}
                    </span>
                    {getDangerText(avyLevel)}
                  </div>
                  {safetyData.avalanche?.zone && <div className="ssr-avy-sub">Zone · {safetyData.avalanche.zone}</div>}
                </div>
                {avalancheElevationRows.length > 0 && (
                  <div className="ssr-avy-bands">
                    {avalancheElevationRows.map((b) => {
                      const r = b.rating ?? 0;
                      return (
                        <div className="ssr-avy-b" key={b.key}>
                          <span className="ssr-avy-b-k">{b.label}</span>
                          <span className="ssr-avy-b-scale">
                            <i style={{ ['--ssr-w' as any]: `${r * 20}%`, ['--ssr-c' as any]: DANGER_COLORS[Math.max(0, Math.min(5, r))] }} />
                          </span>
                          <span className="ssr-avy-b-v">{r ? getDangerText(r) : '—'}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {avyProblems.length > 0 && (
                  <div className="ssr-problems">
                    {avyProblems.map((p, i) => {
                      const loc = Array.isArray(p.location) ? p.location.join(', ') : typeof p.location === 'string' ? p.location : '';
                      const size = Array.isArray(p.size) ? p.size.join('–') : p.size != null ? String(p.size) : '';
                      return (
                        <div className="ssr-problem-row" key={i}>
                          <span className="ssr-problem-name">
                            <span className="ssr-problem-dot" />
                            {p.name || 'Problem'}
                          </span>
                          {size && <span className="ssr-problem-size">{size}</span>}
                          {(p.likelihood || loc) && (
                            <span className="ssr-problem-meta">
                              {[p.likelihood, loc].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {avyBottomLine && (
                  <div className="ssr-bottom-line">
                    <b>Bottom line.</b> {summarizeText(avyBottomLine, 320)}
                  </div>
                )}
              </>
            ) : avalancheRelevant && avalancheUnknown ? (
              <div className="ssr-avy-unrated">
                <div className="ssr-avy-unrated-head">
                  <span className="ssr-avy-unrated-icon"><ShieldAlert size={20} /></span>
                  <div>
                    <span className="ssr-avy-unrated-k">Forecast status</span>
                    <strong>Unrated terrain</strong>
                  </div>
                  <span className="ssr-pill caution">Unknown</span>
                </div>
                <p>{avalancheCoverageExplanation}</p>
                <div className="ssr-avy-actions">
                  <span><CheckCircle2 size={13} /> Favor low-angle terrain</span>
                  <span><CheckCircle2 size={13} /> Avoid terrain traps</span>
                  <span><CheckCircle2 size={13} /> Verify conditions in the field</span>
                </div>
              </div>
            ) : (
              <div className="ssr-empty">{avalancheNotApplicableReason || 'No avalanche forecast applies to this objective.'}</div>
            )}
            {safeAvalancheLink && (
              <a className="ssr-obs-source-link" href={safeAvalancheLink} target="_blank" rel="noreferrer">
                Open avalanche center report <ExternalLink size={12} aria-hidden />
              </a>
            )}
          </div>
        </section>

        {/* SNOWPACK */}
        {safetyData.snowpack && (safetyData.snowpack.snotel || safetyData.snowpack.nohrsc || safetyData.snowpack.cdec) && (
          <section className="ssr-card" id="planner-section-snowpack">
            <div className="ssr-card-h">
              <h2>
                <span className="ssr-h-icon icon-cyan"><Snowflake size={16} /></span>
                Snowpack
              </h2>
              {snowpackDepthConflict ? (
                <span className="ssr-h-meta">sources differ</span>
              ) : snowpackBestDepthSource ? (
                <span className="ssr-h-meta">via {snowpackBestDepthSource}</span>
              ) : null}
            </div>
            <div className="ssr-card-b">
              <div className={`ssr-snow-summary ${snowpackDepthConflict ? 'conflict' : ''}`}>
                <div>
                  <span className="ssr-snow-depth-label">{snowpackDepthConflict ? 'Observed depth range' : 'Best available depth'}</span>
                  <span className={`ssr-snow-depth ${snowpackDepthConflict ? 'ssr-snow-depth-range' : ''}`}>
                    {snowpackDepthConflict && snowpackDepthRangeDisplay ? snowpackDepthRangeDisplay : snowpackBestDepthDisplay}
                  </span>
                </div>
                <div className="ssr-snow-confidence">
                  <span className={`ssr-snow-delta ${snowpackDepthConflict || snowpackPillClass?.includes('warn') ? 'warn' : ''}`}>
                    {snowpackDepthConflict ? 'Low confidence' : (snowpackStatusLabel || 'Best estimate')}
                  </span>
                  <small>{snowpackDepthConflict ? 'Compare sources below' : `Depth via ${snowpackBestDepthSource || 'best source'}`}</small>
                </div>
              </div>
              <p className="ssr-snow-station">
                {snowpackDepthConflict && snowpackDepthConflictCaption
                  ? snowpackDepthConflictCaption
                  : 'Best available observation across reporting sources.'}
              </p>

              <div className="ssr-snow-sources" aria-label="Snowpack source comparison">
                {safetyData.snowpack.nohrsc && (
                  <div className={`ssr-snow-source ${snowpackBestDepthSource?.includes('NOHRSC') ? 'best' : ''}`}>
                    <div className="ssr-snow-source-h"><strong>NOHRSC</strong><span>Terrain grid</span></div>
                    <div className="ssr-snow-source-metrics">
                      <span><small>Depth</small>{nohrscDepthDisplay}</span>
                      <span><small>SWE</small>{nohrscSweDisplay}</span>
                    </div>
                  </div>
                )}
                {safetyData.snowpack.snotel && (
                  <div className={`ssr-snow-source ${snowpackBestDepthSource?.includes('SNOTEL') ? 'best' : ''}`}>
                    <div className="ssr-snow-source-h">
                      <strong>SNOTEL</strong>
                      <span>{[
                        safetyData.snowpack.snotel.stationName,
                        snotelDistanceDisplay !== 'N/A' ? snotelDistanceDisplay : '',
                        Number(safetyData.snowpack.snotelConsensus?.stationCount || 0) > 1 ? `${safetyData.snowpack.snotelConsensus?.stationCount} stations sampled` : '',
                      ].filter(Boolean).join(' · ')}</span>
                    </div>
                    <div className="ssr-snow-source-metrics">
                      <span><small>Depth</small>{snotelDepthDisplay}</span>
                      <span><small>SWE</small>{snotelSweDisplay}</span>
                    </div>
                  </div>
                )}
                {safetyData.snowpack.cdec && (
                  <div className={`ssr-snow-source ${snowpackBestDepthSource?.includes('CDEC') ? 'best' : ''}`}>
                    <div className="ssr-snow-source-h"><strong>CDEC</strong><span>Station observation</span></div>
                    <div className="ssr-snow-source-metrics">
                      <span><small>Depth</small>{cdecDepthDisplay}</span>
                      <span><small>SWE</small>{cdecSweDisplay}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="ssr-snow-foot">
                <span><small>Best SWE{snowpackBestSweSource ? ` · ${snowpackBestSweSource}` : ''}</small>{snowpackBestSweDisplay}</span>
                {safetyData.snowpack.snotel?.obsTempF != null && <span><small>Station temp</small>{formatTempDisplay(safetyData.snowpack.snotel.obsTempF)}</span>}
                {safetyData.snowpack.snotel?.elevationFt != null && <span><small>Station elev.</small>{formatElevationDisplay(safetyData.snowpack.snotel.elevationFt)}</span>}
              </div>
              {snowpackHistoricalComparisonLine && <p className="ssr-snow-history">{snowpackHistoricalComparisonLine}</p>}
              {Number(safetyData.snowpack.nohrsc?.sampleCount || 0) > 1 && (
                <p className="ssr-muted">NOHRSC depth/SWE is the median of {safetyData.snowpack.nohrsc?.sampleCount} nearby terrain-grid samples; the spatial range remains available in the report data.</p>
              )}
              {safetyData.snowpack.viirs?.observedTime && (
                <p className="ssr-muted">Latest NASA VIIRS 375 m snow-cover granule: {formatPubTime(safetyData.snowpack.viirs.observedTime)}. Used as freshness/corroboration metadata; pixel-level NDSI is not treated as a depth measurement.</p>
              )}
              {(snowVisionAnalysis || (!props.restoredFromHistory && featureFlags.satelliteImagery && aiAvailability.snowVision)) && (
                <div style={{ marginTop: '14px' }}>
                  {snowVisionAnalysis ? (
                    <AiInsightBriefing
                      title="Satellite snow briefing"
                      subtitle="What the image and nearby measurements suggest."
                      sections={formatSnowVisionSections(snowVisionAnalysis)}
                      media={snowVisionImage ? (
                        <img
                          src={snowVisionImage}
                          alt="Satellite view of the terrain analyzed in this briefing"
                          className="ssr-snow-vision-img"
                        />
                      ) : undefined}
                      footer={(
                        <button
                          type="button"
                          className="ssr-snow-vision-map-btn"
                          onClick={() => {
                            setMapStyle('satellite');
                            document.getElementById('planner-main-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }}
                        >
                          <Layers size={12} aria-hidden /> View live on the map — toggle to Satellite above
                        </button>
                      )}
                    />
                  ) : !props.restoredFromHistory && snowVisionError ? (
                    <div className="ssr-dash-ai-error">
                    <span>{snowVisionError}</span>
                    <button type="button" className="ssr-dash-ai-btn" onClick={handleRequestSnowVisionAction}>
                      <Sparkles size={14} aria-hidden /> Retry AI analysis
                    </button>
                    </div>
                  ) : !props.restoredFromHistory ? (
                    <button type="button" className="ssr-dash-ai-btn" onClick={handleRequestSnowVisionAction} disabled={snowVisionLoading}>
                    {snowVisionLoading
                      ? <><LoaderCircle size={14} className="spin" aria-hidden /> Analyzing satellite view…</>
                      : <><Sparkles size={14} aria-hidden /> Analyze snow from satellite</>}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </section>
        )}

        {/* LIVE OBSERVATIONS & ACCESS */}
        {hasLocalObservations && (() => {
          const forestRoadCount = Number(accessObservation?.closedRoadCount || 0);
          const stateRoadCount = Number(accessObservation?.caltransClosureCount || 0);
          const accessIssueCount = forestRoadCount + stateRoadCount;
          const wildfireCount = Number(wildfireObservation?.nearbyIncidentCount || 0);
          const streamTrend = String(streamflowObservation?.trend || '').toLowerCase();
          const needsAttention = accessIssueCount > 0 || wildfireCount > 0 || radarObservation?.echoDetected === true || streamTrend === 'rising';
          const hasNumericValue = (value: unknown) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

          return (
            <section className="ssr-card" id="planner-section-observations">
              <div className="ssr-card-h">
                <h2>
                  <span className="ssr-h-icon icon-blue"><Radio size={16} /></span>
                  Observations &amp; Access
                </h2>
                <span className={`ssr-pill ${needsAttention ? 'caution' : 'go'}`}>
                  {needsAttention ? 'Review before travel' : 'No flagged signal'}
                </span>
              </div>
              <div className="ssr-card-b">
                <div className="ssr-obs-status-grid" aria-label="Current observations and access summary">
                  {accessObservation?.available && (
                    <div className={`ssr-obs-status ${accessIssueCount > 0 ? 'warn' : 'good'}`}>
                      <span className="ssr-k">Trailhead access</span>
                      <strong>{accessIssueCount > 0 ? `${accessIssueCount} mapped issue${accessIssueCount === 1 ? '' : 's'}` : 'No mapped issues'}</strong>
                      <small>{hasNumericValue(accessObservation.searchRadiusKm) ? `Checked within ${localizeUnitText(`${accessObservation.searchRadiusKm} km`)}` : 'Available road feeds checked'}</small>
                    </div>
                  )}
                  {radarObservation?.available && (
                    <div className={`ssr-obs-status ${radarObservation.echoDetected ? 'warn' : 'good'}`}>
                      <span className="ssr-k">Precipitation now</span>
                      <strong>{radarObservation.echoDetected ? 'Radar echo detected' : 'No radar echo'}</strong>
                      <small>{radarObservation.observedTime ? formatAgeFromNow(radarObservation.observedTime) : 'Latest available radar scan'}</small>
                    </div>
                  )}
                  {wildfireObservation?.available && (
                    <div className={`ssr-obs-status ${wildfireCount > 0 ? 'danger' : 'good'}`}>
                      <span className="ssr-k">Nearby fire activity</span>
                      <strong>{wildfireCount > 0 ? `${wildfireCount} incident${wildfireCount === 1 ? '' : 's'}` : 'None in feed'}</strong>
                      <small>{hasNumericValue(wildfireObservation.searchRadiusKm) ? `Checked within ${localizeUnitText(`${wildfireObservation.searchRadiusKm} km`)}` : 'Current perimeter feed'}</small>
                    </div>
                  )}
                </div>

                {nearbyObservation?.available && (
                  <div className="ssr-obs-section">
                    <div className="ssr-obs-section-h">
                      <div>
                        <span className="ssr-obs-eyebrow">Latest station observation</span>
                        <strong>{nearbyObservation.stationName || nearbyObservation.stationId || 'Nearby NWS station'}</strong>
                      </div>
                      <span>{[
                        nearbyObservation.observedTime ? formatAgeFromNow(nearbyObservation.observedTime) : null,
                        hasNumericValue(nearbyObservation.distanceKm) ? localizeUnitText(`${nearbyObservation.distanceKm} km away`) : null,
                      ].filter(Boolean).join(' · ')}</span>
                    </div>
                    <div className="ssr-meta-grid">
                      {nearbyObservation.textDescription && <div className="ssr-meta ssr-meta-wide"><span className="ssr-k">Observed conditions</span><span className="ssr-v">{nearbyObservation.textDescription}</span></div>}
                      {hasNumericValue(nearbyObservation.tempF) && <div className="ssr-meta"><span className="ssr-k">Temperature</span><span className="ssr-v">{formatTempDisplay(Number(nearbyObservation.tempF))}</span></div>}
                      {hasNumericValue(nearbyObservation.windMph) && <div className="ssr-meta"><span className="ssr-k">Sustained wind</span><span className="ssr-v">{formatWindDisplay(Number(nearbyObservation.windMph))}</span></div>}
                      {hasNumericValue(nearbyObservation.gustMph) && <div className="ssr-meta"><span className="ssr-k">Wind gust</span><span className="ssr-v">{formatWindDisplay(Number(nearbyObservation.gustMph))}</span></div>}
                      {hasNumericValue(nearbyObservation.visibilityMi) && <div className="ssr-meta"><span className="ssr-k">Visibility</span><span className="ssr-v">{localizeUnitText(`${nearbyObservation.visibilityMi} mi`)}</span></div>}
                      {hasNumericValue(nearbyObservation.humidityPct) && <div className="ssr-meta"><span className="ssr-k">Humidity</span><span className="ssr-v">{Math.round(Number(nearbyObservation.humidityPct))}%</span></div>}
                      {hasNumericValue(nearbyObservation.elevationFt) && <div className="ssr-meta"><span className="ssr-k">Station elevation</span><span className="ssr-v">{formatElevationDisplay(Number(nearbyObservation.elevationFt))}</span></div>}
                    </div>
                    {nearbyObservation.sourceLink && (
                      <a className="ssr-obs-source-link" href={nearbyObservation.sourceLink} target="_blank" rel="noreferrer">
                        Open latest station report <ExternalLink size={12} aria-hidden />
                      </a>
                    )}
                  </div>
                )}

                {radarObservation?.available && (
                  <div className={`ssr-callout ssr-obs-radar ${radarObservation.echoDetected ? 'warn' : ''}`}>
                    <span className="ssr-callout-k">Observed precipitation · NOAA radar/gauge analysis</span>
                    <p>{[
                      hasNumericValue(radarObservation.rain1hIn) ? `1h ${Number(radarObservation.rain1hIn).toFixed(2)} in` : null,
                      hasNumericValue(radarObservation.rain6hIn) ? `6h ${Number(radarObservation.rain6hIn).toFixed(2)} in` : null,
                      hasNumericValue(radarObservation.rain24hIn) ? `24h ${Number(radarObservation.rain24hIn).toFixed(2)} in` : null,
                    ].filter(Boolean).map(String).map(localizeUnitText).join(' · ') || 'Accumulation unavailable'}</p>
                    {radarObservation.note && <small>{radarObservation.note}</small>}
                    {radarObservation.sourceLink && (
                      <a className="ssr-obs-source-link" href={radarObservation.sourceLink} target="_blank" rel="noreferrer">
                        Open live NOAA radar <ExternalLink size={12} aria-hidden />
                      </a>
                    )}
                  </div>
                )}
                {radarObservation?.lightning?.available && (
                  <div className="ssr-snow-kv">
                    <span className="ssr-k">GOES lightning feed</span>
                    <span className="ssr-v">{radarObservation.lightning.satellite || 'GOES-R'}{radarObservation.lightning.productTime ? ` · ${formatPubTime(radarObservation.lightning.productTime)}` : ''}</span>
                  </div>
                )}

                {streamflowObservation?.available && (
                  <div className="ssr-obs-section">
                    <div className="ssr-obs-section-h">
                      <div><span className="ssr-obs-eyebrow">Water crossing context</span><strong>{streamflowObservation.siteName || streamflowObservation.siteId || 'Nearby USGS gauge'}</strong></div>
                      {streamTrend && <span className={`ssr-pill ${streamTrend === 'rising' ? 'caution' : 'neutral'}`}>{streamTrend}</span>}
                    </div>
                    <div className="ssr-snow-kv"><span className="ssr-k">Observed flow</span><span className="ssr-v">{hasNumericValue(streamflowObservation.dischargeCfs) ? `${Math.round(Number(streamflowObservation.dischargeCfs))} cfs` : 'Flow unavailable'}</span></div>
                    {streamflowObservation.forecast?.available && (
                      <div className="ssr-snow-kv"><span className="ssr-k">Forecast peak</span><span className="ssr-v">{hasNumericValue(streamflowObservation.forecast.peakFlowCfs) ? `${Math.round(Number(streamflowObservation.forecast.peakFlowCfs))} cfs` : hasNumericValue(streamflowObservation.forecast.peakStageFt) ? `${streamflowObservation.forecast.peakStageFt} ft stage` : 'Available'}</span></div>
                    )}
                    <p className="ssr-muted">A nearby gauge is context, not a crossing assessment. Recheck the actual crossing and keep a turnaround option.</p>
                  </div>
                )}

                {accessObservation?.available && (
                  <div className="ssr-obs-section">
                    <div className="ssr-obs-section-h">
                      <div><span className="ssr-obs-eyebrow">Trailhead access check</span><strong>{accessIssueCount > 0 ? 'Confirm the approach before departure' : 'No mapped closure found'}</strong></div>
                      <span className={`ssr-pill ${accessIssueCount > 0 ? 'caution' : 'go'}`}>{accessIssueCount > 0 ? `${accessIssueCount} issue${accessIssueCount === 1 ? '' : 's'}` : 'Feeds clear'}</span>
                    </div>
                    {accessIssueCount === 0 && (
                      <p className="ssr-obs-caveat">This is not an access guarantee. Seasonal gates, temporary orders, county roads, and trailhead parking restrictions may not appear in these feeds.</p>
                    )}
                    {forestRoadCount > 0 && (
                      <div className="ssr-cc-group">
                        <div className="ssr-cc-group-h warn"><Route size={13} /> Forest Service road status <span className="ssr-cc-count">{forestRoadCount}</span></div>
                        <ul className="ssr-bullets ssr-obs-list">
                          {(accessObservation.roads || []).slice(0, 4).map((road, index) => (
                            <li key={`${road.id || road.name}-${index}`}>
                              <strong>{road.name || road.id || 'Unnamed road'}</strong>
                              <span>{[road.routeStatus, road.operatingLevel, road.county].filter(Boolean).join(' · ') || 'Closure listed in Forest Service feed'}</span>
                            </li>
                          ))}
                        </ul>
                        {forestRoadCount > 4 && <p className="ssr-muted">Showing 4 of {forestRoadCount} mapped roads.</p>}
                      </div>
                    )}
                    {stateRoadCount > 0 && (
                      <div className="ssr-cc-group">
                        <div className="ssr-cc-group-h warn"><Route size={13} /> Caltrans closures <span className="ssr-cc-count">{stateRoadCount}</span></div>
                        <ul className="ssr-bullets ssr-obs-list">
                          {(accessObservation.caltransClosures || []).slice(0, 4).map((closure, index) => (
                            <li key={`${closure.name}-${index}`}>
                              <strong>{closure.name || 'Caltrans closure'}</strong>
                              {(closure.summary || closure.details) && <span>{summarizeText(toPlainText(closure.summary || closure.details || ''), 220)}</span>}
                            </li>
                          ))}
                        </ul>
                        {stateRoadCount > 4 && <p className="ssr-muted">Showing 4 of {stateRoadCount} mapped closures.</p>}
                      </div>
                    )}
                    {accessObservation.note && <p className="ssr-muted">{accessObservation.note}</p>}
                    {accessObservation.sourceLink && (
                      <a className="ssr-obs-source-link" href={accessObservation.sourceLink} target="_blank" rel="noreferrer">
                        Open official road-status source <ExternalLink size={12} aria-hidden />
                      </a>
                    )}
                  </div>
                )}

                {wildfireObservation?.available && wildfireCount > 0 && (
                  <div className="ssr-obs-section">
                    <div className="ssr-cc-group-h nogo"><Flame size={13} /> Current fire activity <span className="ssr-cc-count">{wildfireCount}</span></div>
                    <ul className="ssr-bullets ssr-obs-list">
                      {(wildfireObservation.incidents || []).slice(0, 4).map((incident, index) => (
                        <li key={`${incident.name}-${index}`}>
                          <strong>{incident.name || 'Unnamed incident'}</strong>
                          <span>{[
                            hasNumericValue(incident.distanceKm) ? localizeUnitText(`${incident.distanceKm} km away`) : null,
                            hasNumericValue(incident.acres) ? `${Math.round(Number(incident.acres)).toLocaleString()} acres` : null,
                            hasNumericValue(incident.percentContained) ? `${incident.percentContained}% contained` : null,
                          ].filter(Boolean).join(' · ')}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="ssr-obs-caveat">Check current evacuation, closure, and smoke information before committing to the approach.</p>
                  </div>
                )}
              </div>
            </section>
          );
        })()}

        {/* DAYLIGHT */}
        {shouldRenderRankedCard('planSnapshot') && sunriseMinutesForPlan !== null && sunsetMinutesForPlan !== null && (() => {
          const dayLen = sunsetMinutesForPlan - sunriseMinutesForPlan;
          const timelinePaddingMinutes = Math.max(45, Math.min(90, Math.round(dayLen * 0.08)));
          const timelineStart = sunriseMinutesForPlan - timelinePaddingMinutes;
          const timelineEnd = sunsetMinutesForPlan + timelinePaddingMinutes;
          const timelineLength = Math.max(1, timelineEnd - timelineStart);
          const clampPct = (minutes: number | null) => minutes === null
            ? null
            : Math.max(0, Math.min(100, ((minutes - timelineStart) / timelineLength) * 100));
          const sunrisePct = clampPct(sunriseMinutesForPlan) ?? 0;
          const sunsetPct = clampPct(sunsetMinutesForPlan) ?? 100;
          const startPct = clampPct(startMinutesForPlan);
          const returnPct = clampPct(returnMinutes);
          const routeWindowStartPct = startPct !== null && returnPct !== null ? Math.min(startPct, returnPct) : null;
          const routeWindowWidthPct = startPct !== null && returnPct !== null ? Math.max(1.25, Math.abs(returnPct - startPct)) : null;
          const daylightMarginMinutes = returnMinutes !== null ? sunsetMinutesForPlan - returnMinutes : null;
          const startsInDark = startMinutesForPlan !== null
            && (startMinutesForPlan < sunriseMinutesForPlan || startMinutesForPlan >= sunsetMinutesForPlan);
          const returnsInDark = daylightMarginMinutes !== null && daylightMarginMinutes < 0;
          const daylightStatus = (() => {
            if (returnMinutes === null) {
              return { tone: 'neutral', label: 'Return not set', title: daylightRemainingFromStartLabel, guidance: 'Set a travel window to check your return against sunset.' };
            }
            if (returnsInDark) {
              return { tone: 'nogo', label: 'Dark return', title: `${Math.abs(daylightMarginMinutes ?? 0)} min after sunset`, guidance: 'Move the start earlier, shorten the route, and carry a headlamp.' };
            }
            if ((daylightMarginMinutes ?? 0) < 30) {
              return { tone: 'caution', label: 'Thin margin', title: `${daylightMarginMinutes} min before sunset`, guidance: 'The plan misses the recommended 30-minute daylight buffer.' };
            }
            if ((daylightMarginMinutes ?? 0) < 60) {
              return { tone: 'watch', label: 'Limited buffer', title: `${daylightMarginMinutes} min before sunset`, guidance: 'Allow extra time for navigation, transitions, and delays.' };
            }
            const hours = Math.floor((daylightMarginMinutes ?? 0) / 60);
            const minutes = (daylightMarginMinutes ?? 0) % 60;
            return {
              tone: 'go',
              label: 'Daylight buffer',
              title: `${hours > 0 ? `${hours}h ` : ''}${minutes > 0 ? `${minutes}m ` : ''}before sunset`.trim(),
              guidance: startsInDark ? 'Your start is outside daylight; carry a headlamp and confirm the route is easy to follow.' : 'The estimated return preserves at least one hour of daylight.',
            };
          })();
          const startTimeLabel = displayStartTime;
          const returnTimeLabel = returnTimeFormatted
            ? `${formatClockForStyle(returnTimeFormatted, preferences.timeStyle)}${returnExtendsPastMidnight ? ' +1' : ''}`
            : 'Not set';
          const timelineLabel = `Sunrise ${formatClockForStyle(safetyData.solar.sunrise, preferences.timeStyle)}, start ${startTimeLabel}, estimated return ${returnTimeLabel}, sunset ${formatClockForStyle(safetyData.solar.sunset, preferences.timeStyle)}.`;
          return (
            <section className={`ssr-card ssr-daylight-card ${daylightStatus.tone}`}>
              <div className="ssr-card-h">
                <h2>
                  <span className="ssr-h-icon icon-yellow"><Sun size={16} /></span>
                  Daylight
                </h2>
                <span className={`ssr-pill ${daylightStatus.tone}`}>{daylightStatus.label}</span>
              </div>
              <div className="ssr-card-b">
                <div className={`ssr-day-summary ${daylightStatus.tone}`}>
                  <div className="ssr-day-summary-copy">
                    <span>Estimated return margin</span>
                    <strong>{daylightStatus.title}</strong>
                    <p>{daylightStatus.guidance}</p>
                  </div>
                  <div className="ssr-day-length">
                    <span>Available daylight</span>
                    <strong>{Math.floor(dayLen / 60)}h {dayLen % 60}m</strong>
                  </div>
                </div>

                <div className="ssr-day-timeline" role="img" aria-label={timelineLabel}>
                  <div className="ssr-day-track" aria-hidden="true">
                    <span className="ssr-day-night morning" style={{ width: `${sunrisePct}%` }} />
                    <span className="ssr-day-sun" style={{ left: `${sunrisePct}%`, width: `${sunsetPct - sunrisePct}%` }} />
                    <span className="ssr-day-night evening" style={{ left: `${sunsetPct}%`, width: `${100 - sunsetPct}%` }} />
                    <span
                      className="ssr-day-buffer"
                      style={{ left: `${clampPct(sunsetMinutesForPlan - 30) ?? sunsetPct}%`, width: `${sunsetPct - (clampPct(sunsetMinutesForPlan - 30) ?? sunsetPct)}%` }}
                    />
                    {routeWindowStartPct !== null && routeWindowWidthPct !== null && (
                      <span className={`ssr-day-window ${daylightStatus.tone}`} style={{ left: `${routeWindowStartPct}%`, width: `${routeWindowWidthPct}%` }} />
                    )}
                    {startPct !== null && <span className="ssr-day-mark start" style={{ left: `${startPct}%` }} />}
                    {returnPct !== null && <span className={`ssr-day-mark end ${returnsInDark ? 'after-dark' : ''}`} style={{ left: `${returnPct}%` }} />}
                  </div>
                  <div className="ssr-day-ends">
                    <span><Sunrise size={14} /> Sunrise <strong>{formatClockForStyle(safetyData.solar.sunrise, preferences.timeStyle)}</strong></span>
                    <span>Sunset <strong>{formatClockForStyle(safetyData.solar.sunset, preferences.timeStyle)}</strong> <Sunset size={14} /></span>
                  </div>
                </div>

                <dl className="ssr-day-plan-times">
                  <div>
                    <dt><span className="ssr-day-dot start" /> Start</dt>
                    <dd>{startTimeLabel}{startsInDark ? <small>Headlamp start</small> : null}</dd>
                  </div>
                  <div>
                    <dt><span className={`ssr-day-dot return ${returnsInDark ? 'after-dark' : ''}`} /> Est. return</dt>
                    <dd>{returnTimeLabel}{returnsInDark ? <small>After sunset</small> : null}</dd>
                  </div>
                </dl>
              </div>
            </section>
          );
        })()}

        {/* HEAT RISK */}
        {shouldRenderRankedCard('heatRisk') && (
          <HeatRiskSection
            level={safetyData.heatRisk?.level}
            label={heatRiskLabel}
            pillClass={heatRiskPillClass}
            guidance={heatRiskGuidance}
            reasons={heatRiskReasons}
            metrics={props.heatRiskMetrics}
            lowerTerrainLabel={lowerTerrainHeatLabel}
            formatTempDisplay={formatTempDisplay}
            localizeUnitText={localizeUnitText}
          />
        )}

        {/* FIRE RISK */}
        {shouldRenderRankedCard('fireRisk') && (
          <FireRiskSection
            level={safetyData.fireRisk?.level}
            label={fireRiskLabel}
            pillClass={fireRiskPillClass}
            guidance={safetyData.fireRisk?.guidance || 'Fire-risk guidance is unavailable. Check current closures, incident maps, and official fire-weather products before departure.'}
            reasons={Array.isArray(safetyData.fireRisk?.reasons) ? safetyData.fireRisk.reasons : []}
            alerts={fireRiskAlerts}
            weather={safetyData.weather}
            airQuality={safetyData.airQuality}
            wildfire={wildfireObservation}
            source={safetyData.fireRisk?.source || null}
            formatTempDisplay={props.formatTempDisplay}
            formatWindDisplay={props.formatWindDisplay}
            localizeUnitText={localizeUnitText}
          />
        )}

        {/* AIR QUALITY */}
        {shouldRenderRankedCard('airQuality') && (
          <section className="ssr-card">
            <div className="ssr-card-h">
              <h2>
                <span className="ssr-h-icon icon-purple"><Wind size={16} /></span>
                Air Quality
              </h2>
              <span className={`ssr-pill ${airQualityFutureNotApplicable ? 'go' : airQualityPillClassFn(safetyData.airQuality?.usAqi)}`}>
                {airQualityFutureNotApplicable ? 'Current-day only' : `AQI ${Number.isFinite(Number(safetyData.airQuality?.usAqi)) ? Math.round(Number(safetyData.airQuality?.usAqi)) : 'N/A'}`}
              </span>
            </div>
            <div className="ssr-card-b">
              {airQualityFutureNotApplicable ? (
                <p className="ssr-muted">Air quality readings are current-day only and don’t apply to this future window.</p>
              ) : (() => {
                const aqi = Number(safetyData.airQuality?.usAqi);
                const hasAqi = Number.isFinite(aqi);
                const pct = hasAqi ? Math.max(1, Math.min(100, (aqi / 300) * 100)) : 0;
                const pollutants = [
                  ['PM2.5', safetyData.airQuality?.pm25],
                  ['PM10', safetyData.airQuality?.pm10],
                  ['Ozone', safetyData.airQuality?.ozone],
                ].filter(([, v]) => Number.isFinite(Number(v)));
                return (
                  <>
                    <div className="ssr-aqi-hero">
                      <span className="ssr-aqi-num">{hasAqi ? Math.round(aqi) : 'N/A'}</span>
                      <div className="ssr-aqi-hero-meta">
                        <span className="ssr-aqi-cat">{safetyData.airQuality?.category || 'Unknown'}</span>
                        <span className="ssr-aqi-unit">US AQI</span>
                      </div>
                    </div>
                    {hasAqi && (
                      <div className="ssr-aqi-scale" title="0–300+ US AQI scale">
                        <span className="ssr-aqi-marker" style={{ left: `${pct}%` }} />
                      </div>
                    )}
                    {pollutants.length > 0 && (
                      <div className="ssr-aqi-pollutants">
                        {pollutants.map(([k, v]) => (
                          <div className="ssr-aqi-pollutant" key={k as string}>
                            <span className="ssr-k">{k}</span>
                            <span className="ssr-v">{Math.round(Number(v))}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="ssr-muted">{safetyData.airQuality?.dataType === 'observed_nowcast' ? 'Headline from nearby EPA AirNow observations.' : 'Headline modeled for the selected hour.'}</p>
                    {safetyData.airQuality?.observation?.dominant?.reportingArea && safetyData.airQuality?.dataType !== 'observed_nowcast' && (
                      <p className="ssr-muted">Current AirNow reporting area: {safetyData.airQuality.observation.dominant.reportingArea} · AQI {safetyData.airQuality.observation.dominant.aqi ?? 'N/A'}</p>
                    )}
                    {safetyData.airQuality?.note && <p className="ssr-muted">{safetyData.airQuality.note}</p>}
                  </>
                );
              })()}
            </div>
          </section>
        )}

        {/* TERRAIN */}
        {shouldRenderRankedCard('terrainTrailCondition') && (
          <section className={`ssr-card ssr-terrain-card ${terrainConditionPillClass}`}>
            <div className="ssr-card-h">
              <h2>
                <span className="ssr-h-icon icon-amber"><Route size={16} /></span>
                Terrain
              </h2>
              <span className={`ssr-pill ${terrainConditionPillClass}`}>{safetyData.terrainCondition?.label || safetyData.trail || 'Unknown'}</span>
            </div>
            <div className="ssr-card-b ssr-terrain-body">
              <div className={`ssr-terrain-overview ${terrainConditionPillClass}`}>
                <span className="ssr-terrain-overview-icon" aria-hidden>
                  {terrainConditionPillClass === 'go' ? <ShieldCheck size={20} /> : <AlertTriangle size={20} />}
                </span>
                <div className="ssr-terrain-overview-copy">
                  <span className="ssr-terrain-eyebrow">Surface outlook</span>
                  <strong>{safetyData.terrainCondition?.label || safetyData.trail || 'Unknown conditions'}</strong>
                  {terrainConditionDetails.summary && <p>{localizeUnitText(terrainConditionDetails.summary)}</p>}
                </div>
                {(terrainConditionDetails.impact || terrainConditionDetails.confidence) && (
                  <dl className="ssr-terrain-meta">
                    {terrainConditionDetails.impact && (
                      <div>
                        <dt>Travel impact</dt>
                        <dd className={terrainConditionDetails.impact === 'high' ? 'nogo' : terrainConditionDetails.impact === 'low' ? 'go' : 'caution'}>
                          {terrainConditionDetails.impact === 'high' ? 'High' : terrainConditionDetails.impact === 'low' ? 'Low' : 'Moderate'}
                        </dd>
                      </div>
                    )}
                    {terrainConditionDetails.confidence && (
                      <div>
                        <dt>Confidence</dt>
                        <dd>{terrainConditionDetails.confidence === 'high' ? 'High' : terrainConditionDetails.confidence === 'medium' ? 'Moderate' : 'Low'}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </div>

              {terrainConditionDetails.recommendedTravel && (
                <div className="ssr-terrain-action">
                  <span className="ssr-terrain-action-icon" aria-hidden><ArrowRight size={17} /></span>
                  <div>
                    <span className="ssr-terrain-eyebrow">Terrain decision</span>
                    <p>{localizeUnitText(terrainConditionDetails.recommendedTravel)}</p>
                  </div>
                </div>
              )}

              {(terrainConditionDetails.reasons.length > 0 || (terrainConditionDetails.snowProfile?.meltFreeze && (
                terrainConditionDetails.snowProfile.meltFreeze.cycleDetected ||
                !['mixed', 'no_snow'].includes(terrainConditionDetails.snowProfile.meltFreeze.phase)
              ))) && (
                <div className="ssr-terrain-detail-grid">
                  {terrainConditionDetails.reasons.length > 0 && (
                    <div className="ssr-terrain-panel">
                      <div className="ssr-terrain-panel-h">
                        <span><Layers size={15} aria-hidden /> Why this outlook</span>
                        <small>{terrainConditionDetails.reasons.length} signal{terrainConditionDetails.reasons.length === 1 ? '' : 's'}</small>
                      </div>
                      <ul className="ssr-terrain-signals">
                        {terrainConditionDetails.reasons.map((reason) => (
                          <li key={reason}><CheckCircle2 size={13} aria-hidden /><span>{localizeUnitText(reason)}</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {terrainConditionDetails.snowProfile?.meltFreeze && (
                    terrainConditionDetails.snowProfile.meltFreeze.cycleDetected ||
                    !['mixed', 'no_snow'].includes(terrainConditionDetails.snowProfile.meltFreeze.phase)
                  ) && (
                    <div className="ssr-terrain-panel snow-cycle">
                      <div className="ssr-terrain-panel-h">
                        <span><Snowflake size={15} aria-hidden /> Snow surface cycle</span>
                        <small>{terrainConditionDetails.snowProfile.meltFreeze.phaseLabel}</small>
                      </div>
                      <p>{localizeUnitText(terrainConditionDetails.snowProfile.meltFreeze.summary)}</p>
                      <div className="ssr-terrain-cycle-grid">
                        <span><small>Refreeze</small><strong>{terrainConditionDetails.snowProfile.meltFreeze.refreezeLabel}</strong></span>
                        <span><small>Solar input</small><strong>{terrainConditionDetails.snowProfile.meltFreeze.solarInputLabel}</strong></span>
                        <span><small>Melt potential</small><strong>{terrainConditionDetails.snowProfile.meltFreeze.meltPotentialLabel}</strong></span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="ssr-terrain-inputs" aria-label="Recent precipitation affecting terrain surfaces">
                <div>
                  <span className="ssr-terrain-input-icon rain" aria-hidden><CloudRain size={15} /></span>
                  <span><small>Rain · past 24h</small><strong>{rainfall24hDisplay}</strong></span>
                </div>
                {Number.isFinite(snowfall24hIn) && (
                  <div>
                    <span className="ssr-terrain-input-icon snow" aria-hidden><Snowflake size={15} /></span>
                    <span><small>Snow · past 24h</small><strong>{snowfall24hDisplay}</strong></span>
                  </div>
                )}
                <p>Recent moisture helps explain the surface outlook; local shade, drainage, use, and elevation can still change footing quickly.</p>
              </div>
            </div>
          </section>
        )}

        {/* PRECIPITATION */}
        {shouldRenderRankedCard('recentRainfall') && (
          <section className="ssr-card">
            <div className="ssr-card-h">
              <h2>
                <span className="ssr-h-icon icon-blue"><CloudRain size={16} /></span>
                Precipitation
              </h2>
              <span className={`ssr-pill ${rainfall24hSeverityClass}`}>24h {rainfall24hDisplay}{Number.isFinite(snowfall24hIn) ? ` · ${snowfall24hDisplay}` : ''}</span>
            </div>
            <div className="ssr-card-b">
              {precipInsightLine && <p className="ssr-body">{localizeUnitText(precipInsightLine)}</p>}
              <div className="ssr-precip-grid">
                <div className="ssr-precip-row head">
                  <span className="ssr-precip-k" />
                  <span>12h</span><span>24h</span><span>48h</span>
                </div>
                <div className="ssr-precip-row">
                  <span className="ssr-precip-k">Rain</span>
                  <span>{rainfall12hDisplay}</span><span>{rainfall24hDisplay}</span><span>{rainfall48hDisplay}</span>
                </div>
                {Number.isFinite(snowfall24hIn) && (
                  <div className="ssr-precip-row">
                    <span className="ssr-precip-k">Snow</span>
                    <span>{snowfall12hDisplay}</span><span>{snowfall24hDisplay}</span><span>{snowfall48hDisplay}</span>
                  </div>
                )}
              </div>
              {expectedPrecipSummaryLine && <p className="ssr-muted">{localizeUnitText(expectedPrecipSummaryLine)}</p>}
              {(expectedRainWindowDisplay || expectedSnowWindowDisplay) && (
                <div className="ssr-snow-kv"><span className="ssr-k">Expected in window</span><span className="ssr-v">{[expectedRainWindowDisplay, expectedSnowWindowDisplay].filter(Boolean).join(' · ') || '—'}</span></div>
              )}
            </div>
          </section>
        )}

        <CautionsAlertsSection
          blockers={decision.blockers || []}
          cautions={decision.cautions || []}
          alerts={nwsTopAlerts || []}
          formatPubTime={formatPubTime}
          localizeUnitText={localizeUnitText}
        />

        {/* SOURCES */}
        {sourceFreshnessRows.length > 0 && (
          <section className="ssr-card">
            <div className="ssr-card-h">
              <h2>
                <span className="ssr-h-icon icon-neutral"><Radio size={16} /></span>
                Sources
              </h2>
              <span className="ssr-h-meta">{freshCount}/{sourceFreshnessRows.length} fresh</span>
            </div>
            <div className="ssr-card-b">
              <div className="ssr-src-health">
                <div className="ssr-src-health-copy">
                  <div>
                    <span className="ssr-src-health-k">Data readiness</span>
                    <strong>{sourceIssueCount > 0 ? 'Verify before committing' : agingCount > 0 ? 'Mostly current' : 'All sources current'}</strong>
                  </div>
                  <span>{freshCount} fresh · {agingCount} aging · {sourceIssueCount} unavailable</span>
                </div>
                <div className="ssr-src-meter" aria-label={`${freshCount} fresh, ${agingCount} aging, ${sourceIssueCount} unavailable sources`}>
                  {sourceFreshnessRows.map((s, i) => <i className={sourceState(s)} key={`meter-${i}`} />)}
                </div>
              </div>
              <div className="ssr-src-list">
                {sourceFreshnessRows.map((s, i) => {
                  const state = sourceState(s);
                  const stateLabel = ['fresh', 'ok'].includes(state) ? 'Fresh' : state === 'aging' ? 'Aging' : state === 'stale' ? 'Stale' : 'Unavailable';
                  return (
                    <div className="ssr-src-item" key={i}>
                      <span className={`ssr-src-dot ${state}`} />
                      <span className="ssr-src-name">{s.label}</span>
                      <span className={`ssr-src-status ${state}`}>{stateLabel}</span>
                      <span className={`ssr-src-age ${state}`}>{s.issued ? formatAgeFromNow(s.issued) : (s.displayValue || 'No timestamp')}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}
      </aside>

      {/* Continue the primary column while the independent right rail spans alongside it. */}
      <div className="ssr-report-footer">
        {/* SCORE BREAKDOWN */}
        {shouldRenderRankedCard('scoreTrace') && Array.isArray(safetyData.safety.factors) && safetyData.safety.factors.length > 0 && (() => {
          const factors = safetyData.safety.factors
            .slice()
            .sort((a: any, b: any) => Math.abs(Number(b.impact || 0)) - Math.abs(Number(a.impact || 0)));
          const maxImpact = Math.max(1, ...factors.map((f: any) => Math.abs(Number(f.impact || 0))));
          const score = Math.round(safetyData.safety.score);
          const scoreColor = getScoreColor(score, safetyData.safety.tier);
          const tierLabel = safetyData.safety.tier ? `${safetyData.safety.tier} risk` : null;
          const confidence = Number.isFinite(Number(safetyData.safety.confidence))
            ? Math.round(Number(safetyData.safety.confidence))
            : null;
          const confidenceLabel = confidence === null
            ? 'Not rated'
            : confidence >= 85
              ? 'High confidence'
              : confidence >= 70
                ? 'Moderate confidence'
                : 'Lower confidence';
          const confidenceTone = confidence === null || confidence >= 85 ? 'good' : confidence >= 70 ? 'watch' : 'low';
          const totalDeduction = Math.max(0, 100 - score);
          const primary = factors.slice(0, 3);
          const others = factors.slice(3);
          const groupLabels: Record<string, string> = {
            avalanche: 'Avalanche', weather: 'Weather', alerts: 'Official alerts', airQuality: 'Air quality', fire: 'Fire',
          };
          const groups = safetyData.safety.groupImpacts
            ? Object.entries(safetyData.safety.groupImpacts)
                .map(([key, value]: [string, any]) => ({
                  key,
                  label: groupLabels[key] || key,
                  effective: Math.round(Number(value?.effective || 0)),
                  scale: Math.round(Number(value?.scale || 0)),
                }))
                .filter((g) => g.effective > 0 && g.scale > 0)
                .sort((a, b) => b.effective - a.effective)
            : [];
          return (
            <section className="ssr-card" id="planner-section-score">
              <div className="ssr-card-h">
                <h2>
                  <span className="ssr-h-icon"><ShieldCheck size={16} /></span>
                  Score Breakdown
                </h2>
                {dayOverDay && (
                  <span className={`ssr-pill ${dayOverDay.delta <= -1 ? 'nogo' : dayOverDay.delta >= 1 ? 'go' : 'caution'}`}>
                    {dayOverDay.delta > 0 ? '+' : ''}{dayOverDay.delta} vs {dayOverDay.previousDate}
                  </span>
                )}
              </div>
              <div className="ssr-card-b">
                <div className="ssr-sb-hero">
                  <div className="ssr-sb-score-block">
                    <span className="ssr-sb-eyebrow">Safety score</span>
                    <span className="ssr-sb-score" style={{ color: scoreColor }}>{score}<small>/ 100</small></span>
                    {tierLabel && <span className="ssr-sb-tier">{tierLabel}</span>}
                  </div>
                  <div className="ssr-sb-hero-copy">
                    <strong>{totalDeduction === 0 ? 'No scored hazard deductions' : `${totalDeduction} points deducted for active hazards`}</strong>
                    <p>Higher scores mean more planning margin. The score summarizes forecast signals; it does not replace current observations or field judgment.</p>
                  </div>
                  <div className={`ssr-sb-confidence ${confidenceTone}`}>
                    <span>Data confidence</span>
                    <strong>{confidenceLabel}</strong>
                    {confidence !== null && <small>{confidence}%</small>}
                  </div>
                </div>
                <div className="ssr-sb-score-track" aria-label={`Safety score ${score} out of 100`}>
                  <i style={{ width: `${Math.max(0, Math.min(100, score))}%`, backgroundColor: scoreColor }} />
                </div>
                <div className="ssr-sb-equation" aria-label={`100 starting points minus ${totalDeduction} hazard points equals a score of ${score}`}>
                  <div><span>Starting margin</span><strong>100</strong></div>
                  <b aria-hidden="true">−</b>
                  <div><span>Hazard deductions</span><strong>{totalDeduction}</strong></div>
                  <b aria-hidden="true">=</b>
                  <div className="result"><span>Final score</span><strong style={{ color: scoreColor }}>{score}</strong></div>
                </div>
                {groups.length > 0 && (
                  <div className="ssr-cc-group ssr-sb-deductions">
                    <div className="ssr-cc-group-h">Score deductions <span className="ssr-cc-count">{groups.length}</span></div>
                    <p className="ssr-sb-section-intro">These group totals are the points used in the score calculation.</p>
                    <div className="ssr-factors">
                      {groups.map((g) => (
                        <div className="ssr-factor" key={g.key}>
                          <div className="ssr-factor-top">
                            <span className="ssr-factor-name">{g.label}</span>
                            <span className="ssr-factor-impact neg">−{g.effective} <small>pts</small></span>
                          </div>
                          <span className="ssr-factor-bar" aria-hidden="true">
                            <i className="neg" style={{ width: `${Math.min(100, (g.effective / g.scale) * 100)}%` }} />
                          </span>
                          <small className="ssr-factor-msg">{g.effective} of {g.scale} available points used in this hazard group</small>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="ssr-cc-group">
                  <div className="ssr-cc-group-h">Primary drivers <span className="ssr-cc-count">{primary.length}</span></div>
                  <p className="ssr-sb-section-intro">The strongest individual signals behind the group deductions above.</p>
                  <div className="ssr-factors">
                    {primary.map((f: any, i: number) => {
                      const impact = Math.round(Number(f.impact || 0));
                      // Stored impact is positive-for-penalty (risk-increasing); negative = bonus.
                      const isPenalty = impact >= 0;
                      return (
                        <div className="ssr-factor ssr-sb-driver" key={`${f.hazard || 'factor'}-${i}`}>
                          <div className="ssr-factor-top">
                            <span className="ssr-factor-name"><i>{i + 1}</i>{f.hazard || 'Factor'}</span>
                            <span className={`ssr-factor-impact ${isPenalty ? 'neg' : 'pos'}`}>{isPenalty ? '−' : '+'}{Math.abs(impact)} <small>raw pts</small></span>
                          </div>
                          <span className="ssr-factor-bar" aria-hidden="true">
                            <i className={isPenalty ? 'neg' : 'pos'} style={{ width: `${(Math.abs(impact) / maxImpact) * 100}%` }} />
                          </span>
                          {f.message && <small className="ssr-factor-msg">{localizeUnitText(f.message)}</small>}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {others.length > 0 && (
                  <details className="ssr-sb-more">
                    <summary>
                      <span>Other scored factors</span>
                      <small>{others.length} more</small>
                    </summary>
                    <div className="ssr-sb-other">
                      {others.map((f: any, i: number) => {
                        const impact = Math.round(Number(f.impact || 0));
                        const isPenalty = impact >= 0;
                        const name = String(f.hazard || 'Factor');
                        const message = f.message ? localizeUnitText(String(f.message)) : '';
                        return (
                          <div className="ssr-sb-other-row" key={`${name}-${i}`}>
                            <span className="ssr-sb-other-name">
                              {name}
                              {message && <small className="ssr-sb-other-hint">{message}</small>}
                            </span>
                            <span className={`ssr-factor-impact ${isPenalty ? 'neg' : 'pos'}`}>{isPenalty ? '−' : '+'}{Math.abs(impact)} <small>raw pts</small></span>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                )}
                <p className="ssr-sb-footnote">Raw factor points explain each signal. Group deductions are adjusted for overlap and diminishing returns, so raw points do not add directly to the final score.</p>
              </div>
            </section>
          );
        })()}

        {/* GEAR */}
        {shouldRenderRankedCard('recommendedGear') && gearRecommendations.length > 0 && (() => {
          const GEAR_TONE_LABEL: Record<string, string> = {
            nogo: 'Essential',
            caution: 'Recommended',
            watch: 'Situational',
            go: 'Standard',
          };
          const GEAR_TONE_ORDER: Record<string, number> = {
            nogo: 0,
            caution: 1,
            watch: 2,
            go: 3,
          };
          const GEAR_CATEGORY_ORDER: Array<{ key: string; label: string; detail: string; icon: React.ReactNode }> = [
            { key: 'Safety', label: 'Safety essentials', detail: 'Rescue, communication, and emergency backup', icon: <ShieldAlert size={15} /> },
            { key: 'Conditions', label: 'Layers & traction', detail: 'Protection matched to weather and surface conditions', icon: <Layers size={15} /> },
            { key: 'Exposure', label: 'Sun, heat & air', detail: 'Manage environmental exposure through the day', icon: <Sun size={15} /> },
            { key: 'General', label: 'Navigation & other', detail: 'Useful additions for this objective', icon: <Compass size={15} /> },
          ];
          const gearGroups = GEAR_CATEGORY_ORDER
            .map((g) => ({
              ...g,
              items: gearRecommendations
                .filter((item) => item.category === g.key)
                .sort((a, b) => (GEAR_TONE_ORDER[a.tone] ?? 4) - (GEAR_TONE_ORDER[b.tone] ?? 4)),
            }))
            .filter((g) => g.items.length > 0);
          const essentialGearCount = gearRecommendations.filter((item) => item.tone === 'nogo').length;
          const recommendedGearCount = gearRecommendations.filter((item) => item.tone === 'caution').length;
          const priorityGearCount = essentialGearCount + recommendedGearCount;
          const overviewTone = essentialGearCount > 0 ? 'urgent' : recommendedGearCount > 0 ? 'attention' : 'standard';
          const overviewTitle = essentialGearCount > 0
            ? `${essentialGearCount} essential item${essentialGearCount === 1 ? '' : 's'} for this plan`
            : recommendedGearCount > 0
              ? `${recommendedGearCount} condition-driven priorit${recommendedGearCount === 1 ? 'y' : 'ies'}`
              : 'Standard additions for this window';
          const gearMarker = (tone: string) => {
            if (tone === 'nogo') return <ShieldAlert size={14} />;
            if (tone === 'caution') return <AlertTriangle size={14} />;
            if (tone === 'watch') return <Compass size={14} />;
            return <CheckCircle2 size={14} />;
          };
          const gearList = (items: typeof gearRecommendations) => (
            <div className="ssr-gear">
              {items.map((g, i) => (
                <div className={`ssr-gear-item ${g.tone}`} key={`${g.title}-${i}`}>
                  <span className="ssr-gear-marker" aria-hidden="true">{gearMarker(g.tone)}</span>
                  <div className="ssr-gear-copy">
                    <div className="ssr-gear-head">
                      <span className="ssr-gear-title">{g.title}</span>
                      <span className={`ssr-pill ${g.tone}`}>{GEAR_TONE_LABEL[g.tone] || g.tone}</span>
                    </div>
                    <p className="ssr-gear-detail">{localizeUnitText(g.detail)}</p>
                  </div>
                </div>
              ))}
            </div>
          );
          return (
            <section className="ssr-card" id="planner-section-gear">
              <div className="ssr-card-h">
                <h2>
                  <span className="ssr-h-icon icon-neutral"><Package size={16} /></span>
                  Gear
                </h2>
                <span className="ssr-h-meta">{gearRecommendations.length} item{gearRecommendations.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="ssr-card-b">
                <div className={`ssr-gear-overview ${overviewTone}`}>
                  <span className="ssr-gear-overview-icon" aria-hidden="true"><Package size={18} /></span>
                  <div className="ssr-gear-overview-copy">
                    <span>Conditions-matched packing plan</span>
                    <strong>{overviewTitle}</strong>
                    <p>Start with the highest-urgency items in each category. This supplements, rather than replaces, your normal trip checklist.</p>
                  </div>
                  <dl className="ssr-gear-stats">
                    <div><dt>Pack first</dt><dd>{priorityGearCount}</dd></div>
                    <div><dt>Categories</dt><dd>{gearGroups.length}</dd></div>
                  </dl>
                </div>
                <div className="ssr-gear-groups">
                  {gearGroups.map((g) => (
                    <section className="ssr-gear-group" key={g.key}>
                      <div className="ssr-gear-group-h">
                        <span className="ssr-gear-group-icon" aria-hidden="true">{g.icon}</span>
                        <div>
                          <h3>{g.label}</h3>
                          <p>{g.detail}</p>
                        </div>
                        <span className="ssr-cc-count">{g.items.length}</span>
                      </div>
                      {gearList(g.items)}
                    </section>
                  ))}
                </div>
              </div>
            </section>
          );
        })()}
      </div>

    </div>
  );
}

// Same large shared PlannerViewProps object as PlannerView; memoize so an
// unrelated prop-object rebuild elsewhere doesn't force a re-render of this
// 1400-line view.
export const RedesignView = React.memo(RedesignViewComponent);
