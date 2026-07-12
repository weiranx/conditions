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
  Flame,
  Route,
  Eye,
  Package,
  ArrowRight,
  Compass,
  Satellite,
  LoaderCircle,
} from 'lucide-react';
import type { PlannerViewProps } from './PlannerView';
import type { ElevationForecastBand, FireRiskAlertItem } from '../../app/types';
import { formatAiNarrativeParagraphs } from '../../app/text-utils';
import { getTemperatureBand } from '../../app/weather-display';
import { DashboardSummaryCard } from './DashboardSummaryCard';
import { WeatherHourPillStrip } from './WeatherHourPillStrip';
import { WindDirectionArrow } from './WindDirectionArrow';
import { StartTimeScenarioCard } from './StartTimeScenarioCard';

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
  formatTempDisplay,
  formatWindDisplay,
}: {
  bands: ElevationForecastBand[];
  maxGustMph: number;
  formatTempDisplay: PlannerViewProps['formatTempDisplay'];
  formatWindDisplay: PlannerViewProps['formatWindDisplay'];
}) {
  const W = 900;
  const H = 230;
  const pad = { l: 50, r: 16, t: 26, b: 40 };
  const [hover, setHover] = React.useState<number | null>(null);

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

  let d = `M ${pad.l} ${H - pad.b}`;
  pts.forEach((p, i) => {
    if (i === 0) {
      d += ` L ${p.x} ${p.y}`;
    } else {
      const prev = pts[i - 1];
      const cx1 = prev.x + (p.x - prev.x) * 0.45;
      const cx2 = prev.x + (p.x - prev.x) * 0.55;
      d += ` C ${cx1} ${prev.y}, ${cx2} ${p.y}, ${p.x} ${p.y}`;
    }
  });
  d += ` L ${W - pad.r} ${H - pad.b} Z`;

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
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {ticks.map((t) => (
        <g key={t.ft}>
          <line x1={pad.l} x2={W - pad.r} y1={t.y} y2={t.y} stroke="var(--ssr-line)" strokeDasharray="2 3" />
          <text x={pad.l - 8} y={t.y + 3} textAnchor="end" fontSize="10" fill="var(--ssr-text-3)" fontFamily="var(--ssr-mono)">
            {(t.ft / 1000).toFixed(t.ft % 1000 === 0 ? 0 : 1)}k
          </text>
        </g>
      ))}
      <path d={d} fill="var(--ssr-surface-3)" stroke="var(--ssr-line-strong)" strokeWidth="1" />
      {pts.map((p) => {
        const risk = bandRisk(p.b.windGust, maxGustMph);
        return (
          <g key={p.i} onMouseEnter={() => setHover(p.i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
            <circle cx={p.x} cy={p.y} r="5" fill={riskCol[risk]} stroke="var(--ssr-surface)" strokeWidth="2" />
            <text x={p.x} y={H - pad.b + 14} textAnchor="middle" fontSize="9.5" fill="var(--ssr-text-3)" fontFamily="var(--ssr-mono)">
              {Math.round(p.b.elevationFt).toLocaleString()}
            </text>
            <text x={p.x} y={H - pad.b + 28} textAnchor="middle" fontSize="10" fill="var(--ssr-text-2)" fontWeight="500">
              {p.b.label}
            </text>
          </g>
        );
      })}
      {hover !== null &&
        (() => {
          const p = pts[hover];
          const tx = Math.min(W - 160, Math.max(pad.l, p.x - 75));
          const ty = Math.max(4, p.y - 52);
          return (
            <g>
              <rect x={tx} y={ty} width="150" height="40" rx="4" fill="var(--ssr-surface)" stroke="var(--ssr-line-strong)" />
              <text x={tx + 10} y={ty + 15} fontSize="11" fontWeight="600" fill="var(--ssr-text)">
                {p.b.label} · {Math.round(p.b.elevationFt).toLocaleString()} ft
              </text>
              <text x={tx + 10} y={ty + 30} fontSize="10" fill="var(--ssr-text-3)" fontFamily="var(--ssr-mono)">
                {formatTempDisplay(p.b.temp)} · {formatWindDisplay(p.b.windSpeed, { includeUnit: false })}G
                {formatWindDisplay(p.b.windGust, { includeUnit: false })}
              </text>
            </g>
          );
        })()}
    </svg>
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

function RedesignViewComponent(props: PlannerViewProps & { aiAvailable: boolean }) {
  const {
    safetyData,
    aiAvailable,
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
    elevationForecastBands,
    objectiveElevationFt,
    avalancheRelevant,
    avalancheUnknown,
    overallAvalancheLevel,
    avalancheElevationRows,
    avalancheNotApplicableReason,
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
    copiedAiPrompt,
    handleCopyAiPrompt,
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
    weatherCardCloudCoverLabel,
    weatherCardWindDirection,
    weatherVisibilityScoreLabel,
    weatherVisibilityRisk,
    weatherForecastPeriodLabel,
    forecastLeadHoursDisplay,
    weatherHourQuickOptions,
    selectedWeatherHourIndex,
    handleWeatherHourSelect,
    weatherConditionEmojiValue,
    weatherPreviewActive,
    weatherCardDisplayTime,
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
        return 'No bulletin is currently published for this zone — many centers stop publishing outside winter. Treat avalanche terrain as unrated: choose conservative lines and avoid terrain traps.';
      case 'no_center_coverage':
        return 'No avalanche center covers this location, so there is no bulletin to check. Treat avalanche terrain as unrated: choose conservative lines and avoid terrain traps.';
      case 'temporarily_unavailable':
        return 'The avalanche bulletin could not be retrieved right now. Treat conditions as unknown until you can review the current bulletin at the center linked above.';
      default:
        return 'Avalanche danger is unknown for this objective. Treat avalanche terrain as unrated: choose conservative lines and avoid terrain traps.';
    }
  })();

  // ── Alerts/cautions ──
  const cautionItems = decision.cautions || [];
  const blockerItems = decision.blockers || [];
  const alertItems = nwsTopAlerts || [];
  const openCount = cautionItems.length + blockerItems.length + alertItems.length;
  const alertSeverityClass = (severity?: string | null): 'nogo' | 'warn' | 'neutral' => {
    const s = (severity || '').toLowerCase();
    if (s === 'extreme' || s === 'severe') return 'nogo';
    if (s === 'moderate') return 'warn';
    return 'neutral';
  };
  const alertExpiryLabel = (alert: { ends?: string | null; expires?: string | null }) => {
    const iso = alert.ends || alert.expires;
    return iso ? `Until ${formatPubTime(iso)}` : '';
  };

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

  // ── ACTION PLAN: the plan levers the user can still change, ranked ──
  const fmtSpan = (s: { start: string; end: string }) =>
    `${formatClockForStyle(s.start, preferences.timeStyle)}–${formatClockForStyle(s.end, preferences.timeStyle)}`;

  type PlanTone = 'stop' | 'shift' | 'pick' | 'prep';
  const planActions: Array<{ tone: PlanTone; icon: React.ReactNode; title: string; detail?: string }> = [];

  // Hard stops — surface no-go blockers at the very top of the to-do list.
  blockerItems.forEach((b) =>
    planActions.push({
      tone: 'stop',
      icon: <ShieldAlert size={15} />,
      title: localizeUnitText(b),
      detail: 'Hard no-go — resolve before you commit.',
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
          : `Every hour trips a threshold${topFails ? ` (${topFails})` : ''}. Consider another day.`,
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
    { id: 'planner-section-actions', label: 'Plan', present: true },
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
          aiAvailable={aiAvailable}
          safetyData={safetyData}
          decision={decision}
          preferences={preferences}
          objectiveName={objectiveName}
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
          onRequestAiBrief={handleRequestAiBriefAction}
          copiedAiPrompt={copiedAiPrompt}
          onCopyAiPrompt={handleCopyAiPrompt}
          rawReportPayload={rawReportPayload}
        />
        </div>

        <StartTimeScenarioCard
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
        />

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
                <CheckCircle2 size={16} /> Conditions line up with your plan — no adjustments needed.
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

        {/* TRAVEL WINDOW STRIP */}
        {travelWindowRows.length > 0 && (
          <section className="ssr-card" id="planner-section-travel">
            <div className="ssr-card-h">
              <h2>
                <span className="ssr-h-icon icon-blue"><Clock size={16} /></span>
                Travel Window
              </h2>
              <span className="ssr-h-meta">
                Start {displayStartTime} · {travelWindowHoursLabel}
              </span>
            </div>
            <div className="ssr-card-b ssr-tight">
              <div className="ssr-strip-scroll">
              <div className="ssr-strip-rows">
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
                  <div className="ssr-srow-lbl"><Thermometer size={14} /> Temp</div>
                  <div className="ssr-srow-cells" style={{ gridTemplateColumns: stripCols }}>
                    {travelWindowRows.map((r, i) => (
                      <div key={i} className="ssr-scell">
                        <span className="ssr-cv">{formatTempDisplay(r.temp, { includeUnit: false })}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="ssr-srow">
                  <div className="ssr-srow-lbl"><Wind size={14} /> Wind·Gust</div>
                  <div className="ssr-srow-cells" style={{ gridTemplateColumns: stripCols }}>
                    {travelWindowRows.map((r, i) => (
                      <div key={i} className="ssr-scell">
                        <span className="ssr-cv">{formatWindDisplay(r.wind, { includeUnit: false })}</span>
                        <span
                          className="ssr-cv-sub"
                          style={{
                            color: r.gust >= maxGustMph ? 'var(--ssr-nogo-ink)' : 'var(--ssr-text-3)',
                            fontWeight: r.gust >= maxGustMph ? 600 : 400,
                          }}
                        >
                          G{formatWindDisplay(r.gust, { includeUnit: false })}
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
                        <span className="ssr-cv" style={{ opacity: r.precipChance === 0 ? 0.35 : 1 }}>
                          {r.precipChance === 0 ? '—' : `${Math.round(r.precipChance)}%`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="ssr-srow">
                  <div className="ssr-srow-lbl" style={{ fontWeight: 700, color: 'var(--ssr-text)' }}>
                    <CheckCircle2 size={14} /> Move OK
                  </div>
                  <div className="ssr-srow-cells" style={{ gridTemplateColumns: stripCols }}>
                    {travelWindowRows.map((r, i) => (
                      <div
                        key={i}
                        className={`ssr-scell move ${r.pass ? 'pass' : 'gate'}`}
                        title={r.reasonSummary ? localizeUnitText(r.reasonSummary) : undefined}
                      >
                        <span
                          className="ssr-cv"
                          style={{ color: r.pass ? 'var(--ssr-go-ink)' : 'var(--ssr-nogo-ink)', fontSize: 11 }}
                        >
                          {r.pass ? '✓' : '✕'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              </div>
              <div className="ssr-strip-foot">
                <div className="ssr-keys">
                  <span className="ssr-key">✓ Clean</span>
                  <span className="ssr-key gate">✕ Gated</span>
                </div>
                <span>{localizeUnitText(travelWindowSummary)}</span>
              </div>
            </div>
          </section>
        )}

        {/* CRITICAL CHECKS */}
        {shouldRenderRankedCard('criticalChecks') && orderedCriticalChecks.length > 0 && (() => {
          const failing = orderedCriticalChecks.filter((c) => !c.ok);
          const passing = orderedCriticalChecks.filter((c) => c.ok);
          const total = orderedCriticalChecks.length;
          return (
            <section className="ssr-card" id="planner-section-checks">
              <div className="ssr-card-h">
                <h2>
                  <span className="ssr-h-icon icon-neutral"><CheckCircle2 size={16} /></span>
                  Critical Checks
                </h2>
                <div className="ssr-cc-meter" title={`${passing.length} of ${total} checks passing`}>
                  <span className="ssr-cc-meter-bar">
                    {orderedCriticalChecks.map((c, i) => <i key={i} className={c.ok ? 'ok' : 'fail'} />)}
                  </span>
                  <span className="ssr-cc-meter-num">{passing.length}/{total}</span>
                </div>
              </div>
              <div className="ssr-card-b">
                {failing.length > 0 ? (
                  <div className="ssr-cc-group">
                    <div className="ssr-cc-group-h warn">
                      <AlertTriangle size={13} /> Needs attention <span className="ssr-cc-count">{failing.length}</span>
                    </div>
                    <div className="ssr-cc-fails">
                      {failing.map((check, idx) => (
                        <div className="ssr-cc-fail" key={`f-${idx}`}>
                          <span className="ssr-cc-fail-ic"><XCircle size={15} /></span>
                          <div className="ssr-cc-fail-body">
                            <span className="ssr-cc-fail-lbl">{localizeUnitText(describeFailedCriticalCheck(check))}</span>
                            {check.detail && <span className="ssr-cc-fail-detail">{localizeUnitText(check.detail)}</span>}
                            {check.action && (
                              <span className="ssr-cc-fail-action"><ArrowRight size={12} /> {localizeUnitText(check.action)}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="ssr-cc-allclear"><CheckCircle2 size={16} /> All critical checks pass.</div>
                )}
                {passing.length > 0 && (
                  <div className="ssr-cc-group">
                    <div className="ssr-cc-group-h">
                      <CheckCircle2 size={13} /> Passing <span className="ssr-cc-count">{passing.length}</span>
                    </div>
                    <div className="ssr-cc-pass-grid">
                      {passing.map((check, idx) => (
                        <div className="ssr-cc-pass" key={`p-${idx}`} title={check.detail ? localizeUnitText(check.detail) : undefined}>
                          <CheckCircle2 size={13} />
                          <span>{check.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          );
        })()}

        {/* WEATHER */}
        <section className="ssr-card" id="planner-section-weather">
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
                <span className="ssr-wx-temp">{formatTempDisplay(weatherCardTemp)}</span>
                <div className="ssr-wx-hero-meta">
                  <span className="ssr-wx-cond">{weatherCardWithEmoji}</span>
                  {temperatureBand && <span className="ssr-wx-temp-band">{temperatureBand.label}</span>}
                  <span className="ssr-wx-feels">Feels like {formatTempDisplay(weatherCardFeelsLike)}</span>
                  {weatherForecastPeriodLabel && <span className="ssr-wx-period">{weatherForecastPeriodLabel}</span>}
                </div>
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
                <WeatherHourPillStrip
                  options={weatherHourQuickOptions}
                  selectedIndex={selectedWeatherHourIndex}
                  onSelect={handleWeatherHourSelect}
                  weatherConditionEmoji={weatherConditionEmojiValue}
                />
              </div>
            )}
            <div className="ssr-wx-section-label">Supporting readings</div>
            <div className="ssr-wx-grid">
              <div className="ssr-wx-cell"><span className="ssr-k">Humidity</span><span className="ssr-v">{Number.isFinite(weatherCardHumidity) ? `${Math.round(weatherCardHumidity)}%` : 'N/A'}</span></div>
              <div className="ssr-wx-cell"><span className="ssr-k">Dew point</span><span className="ssr-v">{formatTempDisplay(weatherCardDewPoint)}</span></div>
              <div className="ssr-wx-cell"><span className="ssr-k">Pressure</span><span className="ssr-v">{weatherCardPressureLabel || '—'}</span></div>
              <div className="ssr-wx-cell"><span className="ssr-k">Cloud cover</span><span className="ssr-v">{weatherCardCloudCoverLabel || '—'}</span></div>
            </div>
            {weatherPressureTrendSummary && (
              <p className="ssr-wx-note">{localizeUnitText(weatherPressureTrendSummary)}</p>
            )}
            {visibilityElevated && (
              <p className="ssr-wx-vis"><Eye size={13} /> Visibility risk: <b>{weatherVisibilityRisk.level}</b>{weatherVisibilityScoreLabel ? ` · ${weatherVisibilityScoreLabel}` : ''}</p>
            )}
          </div>
        </section>

        {/* ELEVATION */}
        {bands.length >= 2 && (
          <section className="ssr-card">
            <div className="ssr-card-h">
              <h2>
                <span className="ssr-h-icon icon-amber"><Layers size={16} /></span>
                Elevation profile
              </h2>
              <span className="ssr-h-meta">{bands.length} bands</span>
            </div>
            <div className="ssr-cross-wrap">
              <ElevationCrossPlot
                bands={bands}
                maxGustMph={maxGustMph}
                formatTempDisplay={formatTempDisplay}
                formatWindDisplay={formatWindDisplay}
              />
            </div>
            <div className="ssr-card-b ssr-tight">
              <table className="ssr-bands-table">
                <thead>
                  <tr>
                    <th>Band</th>
                    <th className="num">Elev</th>
                    <th className="num">Temp</th>
                    <th className="num">Feels</th>
                    <th className="num">Wind·Gust</th>
                  </tr>
                </thead>
                <tbody>
                  {bands.map((b, i) => {
                    const risk = bandRisk(b.windGust, maxGustMph);
                    return (
                      <tr key={i}>
                        <td>
                          <span className="ssr-band-name-cell">
                            <span className={`ssr-risk-pip ${risk}`} />
                            {b.label}
                          </span>
                        </td>
                        <td className="num">{formatElevationDisplay(b.elevationFt)}</td>
                        <td className="num">{formatTempDisplay(b.temp)}</td>
                        <td className="num">{formatTempDisplay(b.feelsLike)}</td>
                        <td className="num">
                          {formatWindDisplay(b.windSpeed, { includeUnit: false })}G
                          {formatWindDisplay(b.windGust, { includeUnit: false })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="ssr-cross-note" style={{ padding: '0 24px 20px' }}>
              Colored pips mark relative wind hazard along the ascent. Hover any node for temp and wind.
            </p>
          </section>
        )}

        {/* WIND LOADING */}
        {(shouldRenderRankedCard('windLoading') || shouldRenderRankedCard('windLoadingHints')) && windLoadingHintsRelevant && (
          <section className="ssr-card" id="planner-section-wind">
            <div className="ssr-card-h">
              <h2>
                <span className="ssr-h-icon icon-cyan"><Wind size={16} /></span>
                Wind Loading
              </h2>
              <span className={`ssr-pill ${windLoadingPillClass}`}>{windLoadingLevel}</span>
            </div>
            <div className="ssr-card-b">
              {avalancheUnknown && (
                <p className="ssr-wl-note">No official forecast available — use wind loading as your primary terrain-selection signal.</p>
              )}
              {windLoadingSummary && <p className="ssr-body">{localizeUnitText(windLoadingSummary)}</p>}
              {windLoadingActionLine && <p className="ssr-action-line">{localizeUnitText(windLoadingActionLine)}</p>}
              <div className="ssr-meta-grid">
                <div className="ssr-meta"><span className="ssr-k">Transport level</span><span className="ssr-v">{windLoadingLevel}</span></div>
                <div className="ssr-meta"><span className="ssr-k">Active window</span><span className="ssr-v">{windLoadingActiveWindowLabel}</span></div>
                <div className="ssr-meta"><span className="ssr-k">Direction source</span><span className="ssr-v">{resolvedWindDirectionSource}</span></div>
                <div className="ssr-meta"><span className="ssr-k">Trend agreement</span><span className="ssr-v">{trendAgreementRatio !== null ? `${Math.round(trendAgreementRatio * 100)}%` : 'N/A'}</span></div>
                <div className="ssr-meta ssr-meta-wide"><span className="ssr-k">Active hours</span><span className="ssr-v">{windLoadingActiveHoursDetail}</span></div>
                <div className="ssr-meta ssr-meta-wide"><span className="ssr-k">Elevation focus</span><span className="ssr-v">{windLoadingElevationFocus}</span></div>
              </div>
              {leewardAspectHints.length > 0 && (
                <div className="ssr-aspect-block">
                  <span className="ssr-k">Likely lee aspects</span>
                  <div className="ssr-aspect-chips">
                    {leewardAspectHints.map((a) => <span key={a} className="ssr-aspect-chip">{a}</span>)}
                  </div>
                </div>
              )}
              {secondaryWindAspects.length > 0 && Number.isFinite(windGustMph) && windGustMph >= 20 && (
                <div className="ssr-aspect-block">
                  <span className="ssr-k">Secondary cross-loading</span>
                  <div className="ssr-aspect-chips">
                    {secondaryWindAspects.map((a) => <span key={`s-${a}`} className="ssr-aspect-chip secondary">{a}</span>)}
                  </div>
                </div>
              )}
              {windLoadingNotes.length > 0 && (
                <ul className="ssr-bullets">
                  {windLoadingNotes.map((n, i) => <li key={`wln-${i}`}>{localizeUnitText(n)}</li>)}
                </ul>
              )}
              {aspectOverlapProblems.length > 0 && (
                <p className="ssr-wl-overlap">Wind loading aligns with active avalanche problem aspects: {aspectOverlapProblems.join(', ')}.</p>
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
              {aiAvailable && (
                <div style={{ marginTop: '14px' }}>
                  {snowVisionAnalysis ? (
                    <div className="ssr-dash-ai-text">
                    <div className="ssr-dash-ai-label"><Satellite size={14} aria-hidden /> Satellite snow analysis</div>
                    {snowVisionImage && (
                      <img
                        src={snowVisionImage}
                        alt="Satellite view of the terrain analyzed above"
                        className="ssr-snow-vision-img"
                      />
                    )}
                    {formatAiNarrativeParagraphs(snowVisionAnalysis).map((para, idx) => (
                      <p key={idx}>{para}</p>
                    ))}
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
                    </div>
                  ) : snowVisionError ? (
                    <div className="ssr-dash-ai-error">
                    <span>{snowVisionError}</span>
                    <button type="button" className="ssr-dash-ai-btn" onClick={handleRequestSnowVisionAction}>Retry</button>
                    </div>
                  ) : (
                    <button type="button" className="ssr-dash-ai-btn" onClick={handleRequestSnowVisionAction} disabled={snowVisionLoading}>
                    {snowVisionLoading
                      ? <><LoaderCircle size={14} className="spin" aria-hidden /> Analyzing satellite view…</>
                      : <><Satellite size={14} aria-hidden /> Analyze snow from satellite</>}
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* LIVE OBSERVATIONS & ACCESS */}
        {hasLocalObservations && (
          <section className="ssr-card" id="planner-section-observations">
            <div className="ssr-card-h">
              <h2>
                <span className="ssr-h-icon icon-blue"><Radio size={16} /></span>
                Observations &amp; Access
              </h2>
              {radarObservation?.available && (
                <span className={`ssr-pill ${radarObservation.echoDetected ? 'caution' : 'go'}`}>
                  {radarObservation.echoDetected ? 'Radar echo' : 'No radar echo'}
                </span>
              )}
            </div>
            <div className="ssr-card-b">
              {nearbyObservation?.available && (
                <>
                  <p className="ssr-muted">
                    {[nearbyObservation.stationName, Number.isFinite(Number(nearbyObservation.distanceKm)) ? `${nearbyObservation.distanceKm} km away` : null].filter(Boolean).join(' · ')}
                  </p>
                  <div className="ssr-meta-grid">
                    {Number.isFinite(Number(nearbyObservation.tempF)) && <div className="ssr-meta"><span className="ssr-k">Observed temp</span><span className="ssr-v">{formatTempDisplay(Number(nearbyObservation.tempF))}</span></div>}
                    {Number.isFinite(Number(nearbyObservation.windMph)) && <div className="ssr-meta"><span className="ssr-k">Observed wind</span><span className="ssr-v">{formatWindDisplay(Number(nearbyObservation.windMph))}</span></div>}
                    {Number.isFinite(Number(nearbyObservation.gustMph)) && <div className="ssr-meta"><span className="ssr-k">Observed gust</span><span className="ssr-v">{formatWindDisplay(Number(nearbyObservation.gustMph))}</span></div>}
                    {Number.isFinite(Number(nearbyObservation.visibilityMi)) && <div className="ssr-meta"><span className="ssr-k">Visibility</span><span className="ssr-v">{localizeUnitText(`${nearbyObservation.visibilityMi} mi`)}</span></div>}
                  </div>
                </>
              )}

              {radarObservation?.available && (
                <div className="ssr-callout">
                  <span className="ssr-callout-k">Observed precipitation · NOAA radar/gauge analysis</span>
                  <p>{[
                    Number.isFinite(Number(radarObservation.rain1hIn)) ? `1h ${Number(radarObservation.rain1hIn).toFixed(2)} in` : null,
                    Number.isFinite(Number(radarObservation.rain6hIn)) ? `6h ${Number(radarObservation.rain6hIn).toFixed(2)} in` : null,
                    Number.isFinite(Number(radarObservation.rain24hIn)) ? `24h ${Number(radarObservation.rain24hIn).toFixed(2)} in` : null,
                  ].filter(Boolean).map(String).map(localizeUnitText).join(' · ') || 'Accumulation unavailable'}</p>
                </div>
              )}
              {radarObservation?.lightning?.available && (
                <div className="ssr-snow-kv">
                  <span className="ssr-k">GOES lightning feed</span>
                  <span className="ssr-v">{radarObservation.lightning.satellite || 'GOES-R'}{radarObservation.lightning.productTime ? ` · ${formatPubTime(radarObservation.lightning.productTime)}` : ''}</span>
                </div>
              )}

              {streamflowObservation?.available && (
                <>
                  <div className="ssr-snow-kv"><span className="ssr-k">Nearby stream gauge</span><span className="ssr-v">{streamflowObservation.siteName || streamflowObservation.siteId || 'USGS gauge'}</span></div>
                  <div className="ssr-snow-kv"><span className="ssr-k">Observed flow</span><span className="ssr-v">{Number.isFinite(Number(streamflowObservation.dischargeCfs)) ? `${Math.round(Number(streamflowObservation.dischargeCfs))} cfs · ${streamflowObservation.trend || 'trend unknown'}` : streamflowObservation.trend || 'N/A'}</span></div>
                  {streamflowObservation.forecast?.available && (
                    <div className="ssr-snow-kv"><span className="ssr-k">Forecast peak</span><span className="ssr-v">{Number.isFinite(Number(streamflowObservation.forecast.peakFlowCfs)) ? `${Math.round(Number(streamflowObservation.forecast.peakFlowCfs))} cfs` : Number.isFinite(Number(streamflowObservation.forecast.peakStageFt)) ? `${streamflowObservation.forecast.peakStageFt} ft stage` : 'Available'}</span></div>
                  )}
                </>
              )}

              {accessObservation?.available && Number(accessObservation.closedRoadCount || 0) > 0 && (
                <div className="ssr-cc-group">
                  <div className="ssr-cc-group-h warn"><Route size={13} /> Forest Service road status <span className="ssr-cc-count">{accessObservation.closedRoadCount}</span></div>
                  <ul className="ssr-bullets">
                    {(accessObservation.roads || []).slice(0, 4).map((road, index) => (
                      <li key={`${road.id || road.name}-${index}`}>{road.name || road.id || 'Unnamed road'}{road.operatingLevel ? ` — ${road.operatingLevel}` : ''}</li>
                    ))}
                  </ul>
                  {accessObservation.note && <p className="ssr-muted">{accessObservation.note}</p>}
                </div>
              )}
              {accessObservation?.available && Number(accessObservation.caltransClosureCount || 0) > 0 && (
                <div className="ssr-cc-group">
                  <div className="ssr-cc-group-h warn"><Route size={13} /> Caltrans closures <span className="ssr-cc-count">{accessObservation.caltransClosureCount}</span></div>
                  <ul className="ssr-bullets">
                    {(accessObservation.caltransClosures || []).slice(0, 4).map((closure, index) => (
                      <li key={`${closure.name}-${index}`}>{closure.name || 'Caltrans closure'}{closure.summary ? ` — ${closure.summary}` : ''}</li>
                    ))}
                  </ul>
                </div>
              )}

              {wildfireObservation?.available && Number(wildfireObservation.nearbyIncidentCount || 0) > 0 && (
                <div className="ssr-cc-group">
                  <div className="ssr-cc-group-h nogo"><Flame size={13} /> Current fire activity <span className="ssr-cc-count">{wildfireObservation.nearbyIncidentCount}</span></div>
                  <ul className="ssr-bullets">
                    {(wildfireObservation.incidents || []).slice(0, 4).map((incident, index) => (
                      <li key={`${incident.name}-${index}`}>{incident.name || 'Unnamed incident'}{Number.isFinite(Number(incident.distanceKm)) ? ` · ${localizeUnitText(`${incident.distanceKm} km away`)}` : ''}{Number.isFinite(Number(incident.percentContained)) ? ` · ${incident.percentContained}% contained` : ''}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}

        {/* DAYLIGHT */}
        {shouldRenderRankedCard('planSnapshot') && sunriseMinutesForPlan !== null && sunsetMinutesForPlan !== null && (() => {
          const dayLen = sunsetMinutesForPlan - sunriseMinutesForPlan;
          const clampPct = (m: number | null) => m === null ? null : Math.max(0, Math.min(100, ((m - sunriseMinutesForPlan) / Math.max(1, dayLen)) * 100));
          const startPct = clampPct(startMinutesForPlan);
          const returnPct = clampPct(returnMinutes);
          return (
            <section className="ssr-card">
              <div className="ssr-card-h">
                <h2>
                  <span className="ssr-h-icon icon-yellow"><Sun size={16} /></span>
                  Daylight
                </h2>
                <span className="ssr-h-meta">{Math.floor(dayLen / 60)}h {dayLen % 60}m</span>
              </div>
              <div className="ssr-card-b">
                <div className="ssr-day-bar">
                  {startPct !== null && returnPct !== null && (
                    <span className="ssr-day-window" style={{ left: `${Math.min(startPct, returnPct)}%`, width: `${Math.abs(returnPct - startPct)}%` }} />
                  )}
                  {startPct !== null && <span className="ssr-day-mark start" style={{ left: `${startPct}%` }} title="Start" />}
                  {returnPct !== null && <span className="ssr-day-mark end" style={{ left: `${returnPct}%` }} title="Return" />}
                </div>
                <div className="ssr-day-ends">
                  <span>↑ {safetyData.solar.sunrise ? formatClockForStyle(safetyData.solar.sunrise, preferences.timeStyle) : '—'}</span>
                  <span>↓ {safetyData.solar.sunset ? formatClockForStyle(safetyData.solar.sunset, preferences.timeStyle) : '—'}</span>
                </div>
                <div className="ssr-snow-kv"><span className="ssr-k">Start</span><span className="ssr-v">{displayStartTime}</span></div>
                <div className="ssr-snow-kv"><span className="ssr-k">Est. return</span><span className="ssr-v">{returnTimeFormatted ? formatClockForStyle(returnTimeFormatted, preferences.timeStyle) : '—'}{returnExtendsPastMidnight ? ' +1' : ''}</span></div>
                <div className="ssr-snow-kv"><span className="ssr-k">Daylight from start</span><span className="ssr-v">{daylightRemainingFromStartLabel}</span></div>
              </div>
            </section>
          );
        })()}

        {/* HEAT RISK */}
        {shouldRenderRankedCard('heatRisk') && (
          <section className="ssr-card">
            <div className="ssr-card-h">
              <h2>
                <span className="ssr-h-icon icon-orange"><Sun size={16} /></span>
                Heat Risk
              </h2>
              <span className={`ssr-pill ${heatRiskPillClass}`}>{String(heatRiskLabel || 'Low').toUpperCase()}</span>
            </div>
            <div className="ssr-card-b">
              {heatRiskGuidance && <p className="ssr-body">{localizeUnitText(heatRiskGuidance)}</p>}
              {lowerTerrainHeatLabel && <p className="ssr-muted">{localizeUnitText(lowerTerrainHeatLabel)}</p>}
              {(() => {
                const g = (heatRiskGuidance || '').trim().toLowerCase();
                const reasons = (Array.isArray(heatRiskReasons) ? heatRiskReasons : []).filter((r) => r && r.trim().toLowerCase() !== g);
                return reasons.length > 0 ? (
                  <ul className="ssr-bullets">
                    {reasons.map((r, i) => <li key={`hr-${i}`}>{localizeUnitText(r)}</li>)}
                  </ul>
                ) : null;
              })()}
            </div>
          </section>
        )}

        {/* FIRE RISK */}
        {shouldRenderRankedCard('fireRisk') && (
          <section className="ssr-card">
            <div className="ssr-card-h">
              <h2>
                <span className="ssr-h-icon icon-orange"><Flame size={16} /></span>
                Fire Risk
              </h2>
              <span className={`ssr-pill ${fireRiskPillClass}`}>{String(fireRiskLabel || 'Low').toUpperCase()}</span>
            </div>
            <div className="ssr-card-b">
              {(() => {
                const guidance = safetyData.fireRisk?.guidance || 'No fire-risk guidance available.';
                const g = guidance.trim().toLowerCase();
                const reasons = (Array.isArray(safetyData.fireRisk?.reasons) ? safetyData.fireRisk.reasons : []).filter((r: string) => r && r.trim().toLowerCase() !== g);
                return (
                  <>
                    <p className="ssr-body">{localizeUnitText(guidance)}</p>
                    {reasons.length > 0 && (
                      <ul className="ssr-bullets">
                        {reasons.map((r: string, i: number) => <li key={`fr-${i}`}>{localizeUnitText(r)}</li>)}
                      </ul>
                    )}
                  </>
                );
              })()}
              {Array.isArray(fireRiskAlerts) && fireRiskAlerts.length > 0 && (
                <div className="ssr-mini-alerts">
                  {fireRiskAlerts.map((a: FireRiskAlertItem, i: number) => (
                    <div className="ssr-ac-item" key={`fra-${i}`}>
                      <span className="ssr-ac-icon"><Flame size={12} /></span>
                      <div><div className="ssr-ac-text">{a.event || 'Fire alert'}</div></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
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
          <section className="ssr-card">
            <div className="ssr-card-h">
              <h2>
                <span className="ssr-h-icon icon-amber"><Route size={16} /></span>
                Terrain
              </h2>
              <span className={`ssr-pill ${terrainConditionPillClass}`}>{safetyData.terrainCondition?.label || safetyData.trail || 'Unknown'}</span>
            </div>
            <div className="ssr-card-b">
              {(terrainConditionDetails.impact || terrainConditionDetails.confidence) && (
                <div className="ssr-chip-row">
                  {terrainConditionDetails.impact && (
                    <span className={`ssr-pill ${terrainConditionDetails.impact === 'high' ? 'nogo' : terrainConditionDetails.impact === 'low' ? 'go' : 'caution'}`}>
                      {terrainConditionDetails.impact === 'high' ? 'High' : terrainConditionDetails.impact === 'low' ? 'Low' : 'Moderate'} impact
                    </span>
                  )}
                  {terrainConditionDetails.confidence && (
                    <span className="ssr-chip">{terrainConditionDetails.confidence === 'high' ? 'High' : terrainConditionDetails.confidence === 'medium' ? 'Moderate' : 'Low'} confidence</span>
                  )}
                </div>
              )}
              {terrainConditionDetails.summary && <p className="ssr-body">{localizeUnitText(terrainConditionDetails.summary)}</p>}
              {terrainConditionDetails.recommendedTravel && (
                <div className="ssr-callout">
                  <span className="ssr-callout-k">Recommended travel</span>
                  <p>{localizeUnitText(terrainConditionDetails.recommendedTravel)}</p>
                </div>
              )}
              <div className="ssr-snow-kv"><span className="ssr-k">Rain 24h</span><span className="ssr-v">{rainfall24hDisplay}</span></div>
              {Number.isFinite(snowfall24hIn) && <div className="ssr-snow-kv"><span className="ssr-k">Snow 24h</span><span className="ssr-v">{snowfall24hDisplay}</span></div>}
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

        {/* CAUTIONS & ALERTS */}
        <section className="ssr-card" id="planner-section-alerts">
          <div className="ssr-card-h">
            <h2>
              <span className="ssr-h-icon icon-orange"><ShieldAlert size={16} /></span>
              Cautions &amp; Alerts
            </h2>
            <span className="ssr-h-meta">{openCount} open</span>
          </div>
          <div className="ssr-card-b">
            {openCount === 0 && <div className="ssr-cc-allclear"><CheckCircle2 size={16} /> No open cautions or active alerts.</div>}
            {blockerItems.length > 0 && (
              <div className="ssr-cc-group">
                <div className="ssr-cc-group-h nogo"><ShieldAlert size={13} /> Blockers <span className="ssr-cc-count">{blockerItems.length}</span></div>
                <div className="ssr-cc-fails">
                  {blockerItems.map((c, i) => (
                    <div className="ssr-cc-fail nogo" key={`b${i}`}>
                      <span className="ssr-cc-fail-ic"><AlertTriangle size={15} /></span>
                      <div className="ssr-cc-fail-body">
                        <span className="ssr-cc-fail-lbl">{localizeUnitText(c)}</span>
                        <span className="ssr-cc-fail-meta">No-go condition</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {cautionItems.length > 0 && (
              <div className="ssr-cc-group">
                <div className="ssr-cc-group-h warn"><AlertTriangle size={13} /> Cautions <span className="ssr-cc-count">{cautionItems.length}</span></div>
                <div className="ssr-cc-fails">
                  {cautionItems.map((c, i) => (
                    <div className="ssr-cc-fail" key={`c${i}`}>
                      <span className="ssr-cc-fail-ic"><AlertTriangle size={15} /></span>
                      <div className="ssr-cc-fail-body">
                        <span className="ssr-cc-fail-lbl">{localizeUnitText(c)}</span>
                        <span className="ssr-cc-fail-meta">Caution</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {alertItems.length > 0 && (
              <div className="ssr-cc-group">
                <div className="ssr-cc-group-h"><Radio size={13} /> Weather alerts <span className="ssr-cc-count">{alertItems.length}</span></div>
                <div className="ssr-ac-list">
                  {alertItems.map((a: any, i: number) => {
                    const sevClass = alertSeverityClass(a.severity);
                    const expiry = alertExpiryLabel(a);
                    return (
                      <div className={`ssr-ac-item ${sevClass === 'nogo' ? 'nogo' : ''}`} key={`a${i}`}>
                        <span className="ssr-ac-icon"><AlertTriangle size={12} /></span>
                        <div>
                          <div className="ssr-ac-headrow">
                            <span className="ssr-ac-text">{a.headline || a.event || 'Weather alert'}</span>
                            <span className={`ssr-ac-severity ${sevClass}`}>{a.severity || 'Unknown'}</span>
                          </div>
                          {[a.event, a.senderName || a.source].filter(Boolean).length > 0 && (
                            <div className="ssr-ac-meta">{[a.event, a.senderName || a.source].filter(Boolean).join(' · ')}</div>
                          )}
                          {expiry && <div className="ssr-ac-expiry">{expiry}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

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
          const primary = factors.slice(0, 3);
          const others = factors.slice(3);
          // The backend can emit several distinct sub-factors under one hazard name
          // (e.g. two "Wind" entries with different messages); without a hint the
          // repeats read as double counting.
          const hazardNameCounts = factors.reduce((acc: Record<string, number>, f: any) => {
            const name = String(f.hazard || 'Factor');
            acc[name] = (acc[name] || 0) + 1;
            return acc;
          }, {});
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
                <div className="ssr-sb-summary">
                  <span className="ssr-sb-score" style={{ color: scoreColor }}>{score}<small>/ 100</small></span>
                  <div className="ssr-sb-summary-meta">
                    {tierLabel && <span className="ssr-sb-tier">{tierLabel}</span>}
                    <span className="ssr-sb-sub">{factors.length} factor{factors.length !== 1 ? 's' : ''} weighed against a 100 baseline</span>
                  </div>
                </div>
                {(() => {
                  const groupLabels: Record<string, string> = {
                    avalanche: 'Avalanche', weather: 'Weather', alerts: 'Alerts', airQuality: 'Air Quality', fire: 'Fire',
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
                  if (groups.length === 0) return null;
                  return (
                    <div className="ssr-cc-group">
                      <div className="ssr-cc-group-h">Hazard groups <span className="ssr-cc-count">{groups.length}</span></div>
                      <div className="ssr-factors">
                        {groups.map((g) => (
                          <div className="ssr-factor" key={g.key}>
                            <div className="ssr-factor-top">
                              <span className="ssr-factor-name">{g.label}</span>
                              <span className="ssr-factor-impact neg">−{g.effective} <small>/ {g.scale}</small></span>
                            </div>
                            <span className="ssr-factor-bar">
                              <i className="neg" style={{ width: `${(g.effective / g.scale) * 100}%` }} />
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                <div className="ssr-cc-group">
                  <div className="ssr-cc-group-h">Primary drivers <span className="ssr-cc-count">{primary.length}</span></div>
                  <div className="ssr-factors">
                    {primary.map((f: any, i: number) => {
                      const impact = Math.round(Number(f.impact || 0));
                      // Stored impact is positive-for-penalty (risk-increasing); negative = bonus.
                      const isPenalty = impact >= 0;
                      return (
                        <div className="ssr-factor" key={i}>
                          <div className="ssr-factor-top">
                            <span className="ssr-factor-name">{f.hazard || 'Factor'}</span>
                            <span className={`ssr-factor-impact ${isPenalty ? 'neg' : 'pos'}`}>{isPenalty ? '−' : '+'}{Math.abs(impact)}</span>
                          </div>
                          <span className="ssr-factor-bar">
                            <i className={isPenalty ? 'neg' : 'pos'} style={{ width: `${(Math.abs(impact) / maxImpact) * 100}%` }} />
                          </span>
                          {f.message && <small className="ssr-factor-msg">{localizeUnitText(f.message)}</small>}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {others.length > 0 && (
                  <div className="ssr-cc-group">
                    <div className="ssr-cc-group-h">Other factors <span className="ssr-cc-count">{others.length}</span></div>
                    <div className="ssr-sb-other">
                      {others.map((f: any, i: number) => {
                        const impact = Math.round(Number(f.impact || 0));
                        const isPenalty = impact >= 0;
                        const name = String(f.hazard || 'Factor');
                        const message = f.message ? localizeUnitText(String(f.message)) : '';
                        const hint = hazardNameCounts[name] > 1 && message
                          ? message.split(/[.(]/)[0].trim().slice(0, 48)
                          : '';
                        return (
                          <div className="ssr-sb-other-row" key={i} title={message || undefined}>
                            <span className="ssr-sb-other-name">
                              {name}
                              {hint && <small className="ssr-sb-other-hint">{hint}</small>}
                            </span>
                            <span className={`ssr-factor-impact ${isPenalty ? 'neg' : 'pos'}`}>{isPenalty ? '−' : '+'}{Math.abs(impact)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
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
          const GEAR_CATEGORY_ORDER: Array<{ key: string; label: string; icon: React.ReactNode; warn?: boolean }> = [
            { key: 'Safety', label: 'Safety essentials', icon: <ShieldAlert size={13} />, warn: true },
            { key: 'Conditions', label: 'Layering & traction', icon: <Layers size={13} /> },
            { key: 'Exposure', label: 'Sun & heat', icon: <Sun size={13} /> },
            { key: 'General', label: 'Other', icon: <Compass size={13} /> },
          ];
          const gearGroups = GEAR_CATEGORY_ORDER
            .map((g) => ({ ...g, items: gearRecommendations.filter((item) => item.category === g.key) }))
            .filter((g) => g.items.length > 0);
          const gearList = (items: typeof gearRecommendations) => (
            <div className="ssr-gear">
              {items.map((g, i) => (
                <div className="ssr-gear-item" key={`${g.title}-${i}`}>
                  <div className="ssr-gear-head">
                    <span className="ssr-gear-title">{g.title}</span>
                    <span className={`ssr-pill ${g.tone}`}>{GEAR_TONE_LABEL[g.tone] || g.tone}</span>
                  </div>
                  <p className="ssr-gear-detail">{localizeUnitText(g.detail)}</p>
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
                {gearGroups.length > 1 ? (
                  gearGroups.map((g) => (
                    <div className="ssr-cc-group" key={g.key}>
                      <div className={`ssr-cc-group-h${g.warn ? ' warn' : ''}`}>{g.icon} {g.label} <span className="ssr-cc-count">{g.items.length}</span></div>
                      {gearList(g.items)}
                    </div>
                  ))
                ) : gearList(gearRecommendations)}
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
