import React from 'react';
import {
  RefreshCw,
  CloudRain,
  Route,
  Info,
  ArrowRight,
  CalendarDays,
  Clock3,
  Check,
  Copy,
  Droplets,
  Eye,
  Gauge,
  Minus,
  Printer,
  ShieldAlert,
  Sunrise,
  Table2,
  TrendingDown,
  TrendingUp,
  Wind,
  X,
} from 'lucide-react';
import type { DecisionLevel, TimeStyle } from '../../app/types';
import { formatClockForStyle } from '../../app/core';
import { weatherConditionEmoji } from '../../app/weather-display';
import type { MultiDayTripForecastDay } from '../../hooks/useTripForecast';
import { useAiAvailability } from '../../hooks/useAiAvailability';
import type { Suggestion } from '../../lib/search';
import { ReportChat } from '../planner/ReportChat';
import { SearchBox } from '../planner/SearchBox';
import '../../styles/trip-redesign.css';
import { ProductNav } from './ProductNav';
import { TripHourlyWeatherChart } from './TripHourlyWeatherChart';
import type { AppView } from '../../hooks/useUrlState';

export interface TripViewProps {
  appShellClassName: string;
  isViewPending: boolean;

  // Trip state
  hasObjective: boolean;
  objectiveName: string;
  position: { lat: number; lng: number };
  tripStartDate: string;
  tripStartTime: string;
  tripDurationDays: number;
  tripForecastRows: MultiDayTripForecastDay[];
  tripForecastLoading: boolean;
  tripForecastError: string | null;
  tripForecastNote: string | null;
  travelWindowHoursLabel: string;
  todayDate: string;
  maxForecastDate: string;
  timeStyle: TimeStyle;

  // Location search
  searchWrapperRef: React.RefObject<HTMLDivElement | null>;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchQuery: string;
  trimmedSearchQuery: string;
  showSuggestions: boolean;
  searchLoading: boolean;
  suggestions: Suggestion[];
  activeSuggestionIndex: number;
  canUseCoordinates: boolean;
  objectiveDraftDirty: boolean;
  handleInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleFocus: () => void;
  handleSearchKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  handleSearchClear: () => void;
  handleUseTypedCoordinates: (value: string) => void;
  selectSuggestion: (suggestion: Suggestion) => void;
  setActiveSuggestionIndex: (index: number) => void;

  // Formatting functions
  formatIsoDateLabel: (isoDate: string) => string;
  formatTempDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatWindDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatPubTime: (isoString?: string) => string;
  localizeUnitText: (text: string) => string;
  getScoreColor: (score: number) => string;

  // Actions
  setTripStartDate: (date: string) => void;
  setTripStartTime: (time: string) => void;
  setTripDurationDays: (days: number) => void;
  setTripForecastRows: (rows: MultiDayTripForecastDay[]) => void;
  setTripForecastError: (error: string | null) => void;
  setTripForecastNote: (note: string | null) => void;
  runTripForecast: () => Promise<void>;
  navigateToView: (view: AppView) => void;
  openPlannerView: () => void;
  onUseDayInPlanner: (date: string, startTime: string) => void;
}

function dayFromIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function weekdayLabel(iso: string): string {
  const d = dayFromIso(iso);
  return d ? d.toLocaleDateString('en-US', { weekday: 'short' }) : '';
}
function monthDayLabel(iso: string): string {
  const d = dayFromIso(iso);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : iso;
}

function dayLengthLabel(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return value;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`;
}

function levelClass(level: DecisionLevel): string {
  return level.toLowerCase().replace('-', '');
}

function weatherWindowLabel(level: DecisionLevel): string {
  if (level === 'GO') return 'WEATHER CLEAR';
  if (level === 'NO-GO') return 'WEATHER BLOCKED';
  return 'WEATHER CAUTION';
}

const DECISION_PRIORITY: Record<DecisionLevel, number> = {
  GO: 2,
  CAUTION: 1,
  'NO-GO': 0,
};

function compareForecastDays(
  left: MultiDayTripForecastDay,
  right: MultiDayTripForecastDay,
): number {
  const decisionDifference = DECISION_PRIORITY[left.decisionLevel] - DECISION_PRIORITY[right.decisionLevel];
  if (decisionDifference !== 0) return decisionDifference;
  return (left.score ?? -Infinity) - (right.score ?? -Infinity);
}

function extremeDayIndex(
  days: MultiDayTripForecastDay[],
  getValue: (day: MultiDayTripForecastDay) => number | null,
  mode: 'min' | 'max',
): number {
  let selectedIndex = -1;
  let selectedValue = mode === 'min' ? Infinity : -Infinity;
  days.forEach((day, index) => {
    const value = getValue(day);
    if (value === null || !Number.isFinite(value)) return;
    const isBetter = mode === 'min' ? value < selectedValue : value > selectedValue;
    if (isBetter) {
      selectedIndex = index;
      selectedValue = value;
    }
  });
  return selectedIndex;
}

async function copyTextWithFallback(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea copy path for restricted browser contexts.
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  return copied;
}

/* Inline day-over-day delta marker for a trip metric. */
function renderMetricDelta(delta: number | null | undefined, unit = '') {
  if (typeof delta !== 'number' || delta === 0) return null;
  const rounded = Math.round(delta * 10) / 10;
  return (
    <small className={`ssr-trip-metric-delta ${rounded > 0 ? 'up' : 'down'}`}>
      {' '}{rounded > 0 ? '▲' : '▼'}{Math.abs(rounded)}{unit}
    </small>
  );
}

function formatTemperatureRange(
  highF: number | null,
  lowF: number | null,
  formatTempDisplay: TripViewProps['formatTempDisplay'],
  options?: { includeUnit?: boolean },
): string {
  const high = formatTempDisplay(highF, options);
  const low = formatTempDisplay(lowF, options);
  return `H ${high} / L ${low}`;
}

/* ── Safety-score trend arc across the trip ── */
function TrendArc({
  days,
  getScoreColor,
}: {
  days: MultiDayTripForecastDay[];
  getScoreColor: (score: number) => string;
}) {
  const W = 1000;
  const H = 150;
  const pad = { l: 48, r: 48, t: 22, b: 28 };
  const n = days.length;
  const x = (i: number) => (n <= 1 ? W / 2 : pad.l + (i / (n - 1)) * (W - pad.l - pad.r));
  const y = (s: number) => H - pad.b - (Math.max(0, Math.min(100, s)) / 100) * (H - pad.t - pad.b);
  const scoreSegments: string[][] = [];
  let currentSegment: string[] = [];
  days.forEach((day, index) => {
    if (typeof day.score === 'number') {
      currentSegment.push(`${x(index)},${y(day.score)}`);
      return;
    }
    if (currentSegment.length > 1) scoreSegments.push(currentSegment);
    currentSegment = [];
  });
  if (currentSegment.length > 1) scoreSegments.push(currentSegment);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Weather-window score trend by trip day">
      {[0, 25, 50, 75, 100].map((g) => (
        <g key={g}>
          <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} stroke="var(--ssr-line)" strokeDasharray="2 4" />
          <text x={pad.l - 6} y={y(g) + 3} textAnchor="end" fontSize="9" fill="var(--ssr-text-4)" fontFamily="var(--ssr-mono)">{g}</text>
        </g>
      ))}
      {scoreSegments.map((points) => (
        <polyline key={points[0]} points={points.join(' ')} fill="none" stroke="var(--ssr-brand)" strokeWidth="2" />
      ))}
      {days.map((d, i) => (
        <g key={i}>
          {typeof d.score === 'number' ? (
            <>
              <circle cx={x(i)} cy={y(d.score)} r="6" fill={getScoreColor(d.score)} stroke="var(--ssr-surface)" strokeWidth="2.5" />
              <text x={x(i)} y={y(d.score) - 13} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--ssr-text)" fontFamily="var(--ssr-sans)">
                {d.score}
              </text>
            </>
          ) : (
            <text x={x(i)} y={H / 2} textAnchor="middle" fontSize="11" fill="var(--ssr-text-4)" fontFamily="var(--ssr-sans)">No score</text>
          )}
          <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--ssr-text-3)" fontFamily="var(--ssr-sans)">
            {weekdayLabel(d.date)} {monthDayLabel(d.date).replace(/^\w+\s/, '')}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function TripView({
  appShellClassName,
  isViewPending,
  hasObjective,
  objectiveName,
  position,
  tripStartDate,
  tripStartTime,
  tripDurationDays,
  tripForecastRows,
  tripForecastLoading,
  tripForecastError,
  tripForecastNote,
  travelWindowHoursLabel,
  todayDate,
  maxForecastDate,
  timeStyle,
  searchWrapperRef,
  searchInputRef,
  searchQuery,
  trimmedSearchQuery,
  showSuggestions,
  searchLoading,
  suggestions,
  activeSuggestionIndex,
  canUseCoordinates,
  objectiveDraftDirty,
  handleInputChange,
  handleFocus,
  handleSearchKeyDown,
  handleSearchClear,
  handleUseTypedCoordinates,
  selectSuggestion,
  setActiveSuggestionIndex,
  formatTempDisplay,
  formatWindDisplay,
  formatPubTime,
  localizeUnitText,
  getScoreColor,
  setTripStartDate,
  setTripStartTime,
  setTripDurationDays,
  setTripForecastRows,
  setTripForecastError,
  setTripForecastNote,
  runTripForecast,
  navigateToView,
  openPlannerView,
  onUseDayInPlanner,
}: TripViewProps) {
  const aiAvailability = useAiAvailability();
  const [sel, setSel] = React.useState(0);
  const [briefCopied, setBriefCopied] = React.useState(false);
  const [plannerDayPickerOpen, setPlannerDayPickerOpen] = React.useState(false);
  const [plannerDayPickerIndex, setPlannerDayPickerIndex] = React.useState(0);
  const dayRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const plannerDayOptionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const plannerDayDialogRef = React.useRef<HTMLElement | null>(null);
  const detailRef = React.useRef<HTMLDivElement | null>(null);
  const anchoredRowsRef = React.useRef<MultiDayTripForecastDay[] | null>(null);
  const copyResetTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => () => {
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
  }, []);

  React.useEffect(() => {
    if (!plannerDayPickerOpen) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => {
      plannerDayDialogRef.current
        ?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
        ?.focus();
    }, 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPlannerDayPickerOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = plannerDayDialogRef.current;
      const focusable = dialog
        ? Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
        : [];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [plannerDayPickerOpen]);

  // Re-anchor selection to the best day whenever a fresh forecast lands.
  React.useEffect(() => {
    if (anchoredRowsRef.current === tripForecastRows) {
      return;
    }
    anchoredRowsRef.current = tripForecastRows;
    if (tripForecastRows.length === 0) {
      setSel(0);
      setPlannerDayPickerOpen(false);
      return;
    }
    let bestIdx = 0;
    tripForecastRows.forEach((row, i) => {
      if (compareForecastDays(row, tripForecastRows[bestIdx]) > 0) {
        bestIdx = i;
      }
    });
    setSel(bestIdx);
  }, [tripForecastRows]);

  const tripStartDisplay = formatClockForStyle(tripStartTime, timeStyle);
  const goCount = tripForecastRows.filter((row) => row.decisionLevel === 'GO').length;
  const cautionCount = tripForecastRows.filter((row) => row.decisionLevel === 'CAUTION').length;
  const noGoCount = tripForecastRows.filter((row) => row.decisionLevel === 'NO-GO').length;
  const objectiveSummary = hasObjective
    ? objectiveName || `${position.lat.toFixed(4)}°, ${position.lng.toFixed(4)}°`
    : 'No objective selected';
  const objectiveReady = hasObjective && !objectiveDraftDirty;

  const best = tripForecastRows.reduce<MultiDayTripForecastDay | null>((acc, row) => {
    if (!acc) return row;
    return compareForecastDays(row, acc) > 0 ? row : acc;
  }, null);
  const watchDay = tripForecastRows.reduce<MultiDayTripForecastDay | null>((acc, row) => {
    if (!acc) return row;
    return compareForecastDays(row, acc) < 0 ? row : acc;
  }, null);
  const bestIndex = best ? tripForecastRows.findIndex((row) => row.date === best.date) : -1;
  const watchDayIndex = watchDay ? tripForecastRows.findIndex((row) => row.date === watchDay.date) : -1;
  const scoredValues = tripForecastRows.flatMap((row) => (typeof row.score === 'number' ? [row.score] : []));
  const scoreRange = scoredValues.length > 1
    ? `${Math.min(...scoredValues)}–${Math.max(...scoredValues)} / 100 · ${Math.max(...scoredValues) - Math.min(...scoredValues)} point swing`
    : scoredValues.length === 1
      ? `${scoredValues[0]} / 100`
      : 'Scores unavailable';
  const recommendationEyebrow = best?.decisionLevel === 'GO'
    ? 'Most favorable weather window'
    : best?.decisionLevel === 'CAUTION'
      ? 'Most favorable weather window — use caution'
      : 'Least unfavorable weather window — still blocked';
  const calmestDayIndex = extremeDayIndex(tripForecastRows, (day) => day.windGustMph, 'min');
  const driestDayIndex = extremeDayIndex(tripForecastRows, (day) => day.precipChance, 'min');
  const bestTravelDayIndex = extremeDayIndex(
    tripForecastRows,
    (day) => day.travelTotalHours > 0 ? day.travelPassHours / day.travelTotalHours : null,
    'max',
  );
  const calmestDay = tripForecastRows[calmestDayIndex] ?? null;
  const driestDay = tripForecastRows[driestDayIndex] ?? null;
  const bestTravelDay = tripForecastRows[bestTravelDayIndex] ?? null;
  const firstScoredDay = tripForecastRows.find((day) => day.score !== null) ?? null;
  const lastScoredDay = [...tripForecastRows].reverse().find((day) => day.score !== null) ?? null;
  const tripScoreChange = typeof firstScoredDay?.score === 'number' && typeof lastScoredDay?.score === 'number'
    ? lastScoredDay.score - firstScoredDay.score
    : null;
  const tripTrend = tripScoreChange === null || Math.abs(tripScoreChange) < 3
    ? 'steady'
    : tripScoreChange > 0
      ? 'improving'
      : 'declining';
  const partialDayCount = tripForecastRows.filter((day) => day.partialData).length;
  const averageScore = scoredValues.length > 0
    ? Math.round(scoredValues.reduce((sum, score) => sum + score, 0) / scoredValues.length)
    : null;
  const tripChatPayload = JSON.stringify({
    contextType: 'multi-day-trip-plan',
    objective: {
      name: objectiveSummary,
      latitude: position.lat,
      longitude: position.lng,
    },
    plan: {
      startDate: tripStartDate,
      dailyStartTime: tripStartTime,
      durationDays: tripDurationDays,
      travelWindow: travelWindowHoursLabel,
      scope: 'Weather-window comparison only; avalanche danger is not projected here.',
    },
    summary: {
      bestWeatherWindowDate: best?.date ?? null,
      weakestWeatherWindowDate: watchDay?.date ?? null,
      weatherClearDays: goCount,
      weatherCautionDays: cautionCount,
      weatherBlockedDays: noGoCount,
      averageWeatherWindowScore: averageScore,
      scoreChangeFirstToLastDay: tripScoreChange,
      trend: tripTrend,
      partialDataDays: partialDayCount,
      forecastNote: tripForecastNote,
    },
    days: tripForecastRows.map((day) => ({
      date: day.date,
      weatherWindowLabel: weatherWindowLabel(day.decisionLevel),
      decisionLevel: day.decisionLevel,
      decisionHeadline: day.decisionHeadline,
      weatherWindowScore: day.score,
      weatherDescription: day.weatherDescription,
      temperatureHighF: day.tempHighF,
      temperatureLowF: day.tempLowF,
      peakWindGustMph: day.windGustMph,
      windDirection: day.windDirection,
      precipitationChancePct: day.precipChance,
      expectedRainIn: day.expectedRainIn,
      expectedSnowIn: day.expectedSnowIn,
      travelHoursPassingThresholds: day.travelPassHours,
      travelHoursEvaluated: day.travelTotalHours,
      sunrise: day.sunrise,
      sunset: day.sunset,
      daylightLength: day.dayLength,
      visibilityRisk: day.visibilityLevel,
      visibilitySummary: day.visibilitySummary,
      activeWeatherAlerts: day.alertCount,
      airQualityAqi: day.airQualityAqi,
      airQualityCategory: day.airQualityCategory,
      partialData: day.partialData,
      dataWarning: day.apiWarning,
      forecastIssuedTime: day.sourceIssuedTime,
      hourlyTravelWindow: day.hourlyWeather.map((hour) => ({
        time: hour.time,
        temperatureF: hour.temp,
        windMph: hour.wind,
        gustMph: hour.gust,
        precipitationChancePct: hour.precipChance,
        condition: hour.condition,
      })),
    })),
  });

  const clearForecastState = () => {
    setTripForecastRows([]);
    setTripForecastError(null);
    setTripForecastNote(null);
  };

  const selected = tripForecastRows[sel] ?? null;
  const plannerDay = tripForecastRows[plannerDayPickerIndex] ?? null;
  const plannerDayPickerVisible = plannerDayPickerOpen && plannerDay !== null;

  const selectDay = (index: number, moveFocus = false) => {
    const boundedIndex = Math.max(0, Math.min(tripForecastRows.length - 1, index));
    setSel(boundedIndex);
    if (moveFocus) {
      dayRefs.current[boundedIndex]?.focus();
      dayRefs.current[boundedIndex]?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  };

  const reviewBestDay = () => {
    if (bestIndex < 0) return;
    setSel(bestIndex);
    window.requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const inspectDay = (index: number) => {
    if (index < 0) return;
    selectDay(index);
    window.requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const requestPlannerView = () => {
    if (tripForecastRows.length === 0) {
      openPlannerView();
      return;
    }
    const nextIndex = Math.min(Math.max(sel, 0), tripForecastRows.length - 1);
    setPlannerDayPickerIndex(nextIndex);
    setPlannerDayPickerOpen(true);
  };

  const choosePlannerDay = (index: number, moveFocus = false) => {
    setPlannerDayPickerIndex(index);
    if (moveFocus) plannerDayOptionRefs.current[index]?.focus();
  };

  const openPlannerForSelectedDay = () => {
    if (!plannerDay) return;
    setPlannerDayPickerOpen(false);
    onUseDayInPlanner(plannerDay.date, tripStartTime);
  };

  const buildTripBrief = () => {
    const dateRange = tripForecastRows.length > 1
      ? `${monthDayLabel(tripForecastRows[0].date)}–${monthDayLabel(tripForecastRows[tripForecastRows.length - 1].date)}`
      : tripForecastRows[0] ? monthDayLabel(tripForecastRows[0].date) : tripStartDate;
    const lines = [
      `${objectiveSummary} · Multi-day trip brief`,
      `${dateRange} · ${tripStartDisplay} daily start · ${travelWindowHoursLabel} travel window`,
      best ? `Best weather window: ${weekdayLabel(best.date)}, ${monthDayLabel(best.date)} · ${weatherWindowLabel(best.decisionLevel)} · ${best.score ?? 'N/A'}/100` : '',
      '',
      ...tripForecastRows.map((day) => [
        `${weekdayLabel(day.date)}, ${monthDayLabel(day.date)} — ${weatherWindowLabel(day.decisionLevel)}${day.score !== null ? ` · ${day.score}/100 weather-window score` : ''}`,
        `${day.weatherDescription}; ${formatTemperatureRange(day.tempHighF, day.tempLowF, formatTempDisplay)}; gusts ${formatWindDisplay(day.windGustMph)}; precip ${day.precipChance !== null ? `${day.precipChance}%` : 'N/A'}; travel ${day.travelPassHours}/${day.travelTotalHours}h passing.`,
        day.decisionHeadline,
      ].join('\n')),
      '',
      'Weather and travel-window comparison only. Check the current official avalanche bulletin within 24h of departure.',
    ];
    return lines.filter((line, index) => line !== '' || lines[index - 1] !== '').join('\n');
  };

  const copyTripBrief = async () => {
    const copied = await copyTextWithFallback(buildTripBrief());
    if (!copied) return;
    setBriefCopied(true);
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
    copyResetTimerRef.current = window.setTimeout(() => setBriefCopied(false), 2200);
  };

  return (
    <div key="view-trip" className={appShellClassName} aria-busy={isViewPending || tripForecastLoading}>
      <div className="ssr-trip" aria-hidden={plannerDayPickerVisible ? true : undefined}>
        <ProductNav active="trip" navigateToView={navigateToView} openPlannerView={requestPlannerView} />
        {/* HEADER + SETUP */}
        <div className="ssr-trip-head">
          <div className="ssr-trip-intro">
            <div className="ssr-trip-kicker">Weather window comparison</div>
            <h1>Compare days before choosing the trip.</h1>
            <p>Compare daily decision gates for one objective and find the most favorable weather and travel window.</p>
          </div>
          <div className="ssr-trip-setup" aria-label="Multi-day forecast setup">
            <div className="ssr-trip-setup-location">
              <span>Location</span>
              <SearchBox
                searchWrapperRef={searchWrapperRef}
                searchInputRef={searchInputRef}
                searchQuery={searchQuery}
                trimmedSearchQuery={trimmedSearchQuery}
                showSuggestions={showSuggestions}
                searchLoading={searchLoading}
                suggestions={suggestions}
                activeSuggestionIndex={activeSuggestionIndex}
                canUseCoordinates={canUseCoordinates}
                disabled={tripForecastLoading}
                onInputChange={handleInputChange}
                onFocus={handleFocus}
                onKeyDown={handleSearchKeyDown}
                onClear={handleSearchClear}
                onUseCoordinates={handleUseTypedCoordinates}
                onSelectSuggestion={selectSuggestion}
                onHoverSuggestion={setActiveSuggestionIndex}
              />
              <small>
                {objectiveDraftDirty
                  ? 'Select a result to change the objective'
                  : hasObjective
                    ? `${objectiveSummary} · ${travelWindowHoursLabel} travel window`
                    : 'Search for an objective'}
              </small>
            </div>
            <label className="ssr-trip-setup-field">
              <span>Start date</span>
              <input
                type="date"
                value={tripStartDate}
                min={todayDate}
                max={maxForecastDate}
                onChange={(e) => {
                  setTripStartDate(e.target.value);
                  clearForecastState();
                }}
              />
            </label>
            <label className="ssr-trip-setup-field">
              <span>Daily start</span>
              <input
                type="time"
                value={tripStartTime}
                onChange={(e) => {
                  setTripStartTime(e.target.value);
                  clearForecastState();
                }}
              />
            </label>
            <label className="ssr-trip-setup-field">
              <span>Duration</span>
              <select
                value={tripDurationDays}
                onChange={(e) => {
                  setTripDurationDays(Math.max(2, Math.min(7, Math.round(Number(e.target.value) || 7))));
                  clearForecastState();
                }}
              >
                {[2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>{n} days</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="ssr-trip-setup-run"
              onClick={() => void runTripForecast()}
              disabled={tripForecastLoading || !objectiveReady}
            >
              <RefreshCw size={15} /> {tripForecastLoading ? 'Loading…' : 'Run forecast'}
            </button>
          </div>
        </div>

        <div className="ssr-trip-disclaimer" role="note">
          <Info />
          <span>
            <strong>Weather-window comparison only.</strong> Avalanche danger is not projected here, so “weather clear” is not a trip GO.
            Review the selected day in Planner and check the current official avalanche bulletin within 24h of departure.
          </span>
        </div>

        {!hasObjective && (
          <div className="ssr-trip-banner">
            <div>
              <h3>Objective required</h3>
              <p>Select an objective in Planner first, then use this tool for multi-day forecasting.</p>
            </div>
            <button type="button" className="ssr-trip-banner-action" onClick={requestPlannerView}>
              <Route size={15} aria-hidden /> Open planner
            </button>
          </div>
        )}

        {tripForecastError && (
          <div className="ssr-trip-banner error">
            <div>
              <h3>Multi-day forecast unavailable</h3>
              <p>{tripForecastError}</p>
            </div>
            {objectiveReady && (
              <button type="button" className="ssr-trip-banner-action" onClick={() => void runTripForecast()}>
                <RefreshCw size={15} aria-hidden /> Try again
              </button>
            )}
          </div>
        )}

        {tripForecastLoading && tripForecastRows.length === 0 && (
          <div className="ssr-trip-loading" role="status" aria-live="polite">
            <RefreshCw className="ssr-trip-loading-icon" aria-hidden />
            <div>
              <strong>Comparing {tripDurationDays} daily windows</strong>
              <span>Checking weather and travel-hour thresholds for each day.</span>
            </div>
          </div>
        )}

        {tripForecastRows.length > 0 && (
          <>
            {/* DECISION SPOTLIGHT */}
            {best && (
              <section className={`ssr-trip-panel ssr-trip-recommendation ${levelClass(best.decisionLevel)}`} aria-labelledby="trip-recommendation-title">
                <div className="ssr-trip-recommendation-icon" aria-hidden>
                  <CalendarDays />
                </div>
                <div className="ssr-trip-recommendation-copy">
                  <span className="ssr-trip-recommendation-eyebrow">
                    {recommendationEyebrow}
                  </span>
                  <h2 id="trip-recommendation-title">{weekdayLabel(best.date)}, {monthDayLabel(best.date)}</h2>
                  <p>{localizeUnitText(best.decisionHeadline)}</p>
                </div>
                <div className="ssr-trip-recommendation-facts" aria-label="Recommended day summary">
                  <span><strong>{best.score ?? '—'}</strong> weather-window score</span>
                  <span><strong>{formatWindDisplay(best.windGustMph, { includeUnit: false })}</strong> peak gust</span>
                  <span><strong>{best.precipChance !== null ? `${best.precipChance}%` : '—'}</strong> precip</span>
                </div>
                <button type="button" className="ssr-trip-recommendation-action" onClick={reviewBestDay}>
                  Review this day <ArrowRight size={15} aria-hidden />
                </button>
              </section>
            )}

            {/* OVERVIEW */}
            <div className="ssr-trip-panel ssr-trip-overview">
              <div className="ssr-trip-ov">
                <div className="ssr-trip-ov-k">Objective</div>
                <div className="ssr-trip-ov-obj">{objectiveSummary}</div>
                <div className="ssr-trip-ov-sub">
                  {position.lat.toFixed(4)}°, {position.lng.toFixed(4)}° · {travelWindowHoursLabel} window · start {tripStartDisplay}
                </div>
              </div>
              <div className="ssr-trip-ov">
                <div className="ssr-trip-ov-count go">{goCount}</div>
                <div className="ssr-trip-ov-count-k">Weather clear</div>
              </div>
              <div className="ssr-trip-ov">
                <div className="ssr-trip-ov-count caution">{cautionCount}</div>
                <div className="ssr-trip-ov-count-k">Weather caution</div>
              </div>
              <div className="ssr-trip-ov">
                <div className="ssr-trip-ov-count nogo">{noGoCount}</div>
                <div className="ssr-trip-ov-count-k">Weather blocked</div>
              </div>
              <div className="ssr-trip-ov">
                <div className="ssr-trip-ov-k">Watch day</div>
                {watchDay && (
                  <div className="ssr-trip-ov-best">
                    <span className={`ssr-trip-ov-watch-day ${levelClass(watchDay.decisionLevel)}`}>
                      {weekdayLabel(watchDay.date)} {monthDayLabel(watchDay.date)} · {weatherWindowLabel(watchDay.decisionLevel)}
                    </span>
                    <span className="ssr-trip-ov-best-note">{localizeUnitText(watchDay.decisionHeadline)}</span>
                  </div>
                )}
              </div>
            </div>

            {aiAvailability.reportChat && (
              <section className="ssr-trip-panel ssr-trip-chat" aria-label="Multi-day planning assistant">
                <ReportChat
                  readOnly={false}
                  contextType="trip"
                  reportPayload={tripChatPayload}
                />
              </section>
            )}

            {/* PLANNING SIGNALS */}
            <section className="ssr-trip-panel ssr-trip-insights" aria-labelledby="trip-insights-title">
              <div className="ssr-trip-panel-head">
                <div>
                  <span>Planning signals</span>
                  <h2 id="trip-insights-title"><Gauge aria-hidden /> What changes across the window</h2>
                  <p>
                    Fast comparisons from the same daily start and travel thresholds.
                    {partialDayCount > 0 ? ` ${partialDayCount} day${partialDayCount === 1 ? '' : 's'} include partial data.` : ''}
                  </p>
                </div>
                <div className="ssr-trip-panel-actions">
                  <button type="button" onClick={() => void copyTripBrief()}>
                    {briefCopied ? <Check aria-hidden /> : <Copy aria-hidden />}
                    {briefCopied ? 'Copied' : 'Copy trip brief'}
                  </button>
                  <button type="button" onClick={() => window.print()}>
                    <Printer aria-hidden /> Print
                  </button>
                </div>
              </div>
              <div className="ssr-trip-insight-grid">
                <button type="button" className="ssr-trip-insight" onClick={() => inspectDay(calmestDayIndex)} disabled={!calmestDay}>
                  <Wind aria-hidden />
                  <span>Calmest day</span>
                  <strong>{calmestDay ? `${weekdayLabel(calmestDay.date)}, ${monthDayLabel(calmestDay.date)}` : 'Unavailable'}</strong>
                  <small>{calmestDay ? `${formatWindDisplay(calmestDay.windGustMph)} peak gust` : 'No wind forecast'}</small>
                </button>
                <button type="button" className="ssr-trip-insight" onClick={() => inspectDay(driestDayIndex)} disabled={!driestDay}>
                  <Droplets aria-hidden />
                  <span>Driest day</span>
                  <strong>{driestDay ? `${weekdayLabel(driestDay.date)}, ${monthDayLabel(driestDay.date)}` : 'Unavailable'}</strong>
                  <small>{driestDay?.precipChance !== null && driestDay ? `${driestDay.precipChance}% precipitation chance` : 'No precipitation forecast'}</small>
                </button>
                <button type="button" className="ssr-trip-insight" onClick={() => inspectDay(bestTravelDayIndex)} disabled={!bestTravelDay}>
                  <Gauge aria-hidden />
                  <span>Cleanest travel window</span>
                  <strong>{bestTravelDay ? `${weekdayLabel(bestTravelDay.date)}, ${monthDayLabel(bestTravelDay.date)}` : 'Unavailable'}</strong>
                  <small>{bestTravelDay ? `${bestTravelDay.travelPassHours}/${bestTravelDay.travelTotalHours}h meet every threshold` : 'No hourly travel data'}</small>
                </button>
                <div className={`ssr-trip-insight trend ${tripTrend}`}>
                  {tripTrend === 'improving' ? <TrendingUp aria-hidden /> : tripTrend === 'declining' ? <TrendingDown aria-hidden /> : <Minus aria-hidden />}
                  <span>Trip trend</span>
                  <strong>{tripTrend === 'improving' ? 'Conditions improve' : tripTrend === 'declining' ? 'Conditions deteriorate' : 'Conditions stay steady'}</strong>
                  <small>{tripScoreChange === null ? 'Not enough scores to compare' : `${tripScoreChange > 0 ? '+' : ''}${tripScoreChange} points from first to last day`}</small>
                </div>
              </div>
            </section>

            {/* TREND ARC */}
            <section className="ssr-trip-panel ssr-trip-trend" aria-labelledby="trip-trend-title">
              <div className="ssr-trip-panel-head compact">
                <div>
                  <span>Score trend</span>
                  <h2 id="trip-trend-title"><TrendingUp aria-hidden /> Weather-window score across the trip</h2>
                  <p>{scoreRange}{tripForecastNote ? ` · ${tripForecastNote}` : ''}</p>
                </div>
              </div>
              <div className="ssr-trip-trend-chart">
                <TrendArc days={tripForecastRows} getScoreColor={getScoreColor} />
              </div>
            </section>

            {/* COMPARISON MATRIX */}
            <section className="ssr-trip-panel ssr-trip-matrix" aria-labelledby="trip-matrix-title">
              <div className="ssr-trip-panel-head compact">
                <div>
                  <span>All-day matrix</span>
                  <h2 id="trip-matrix-title"><Table2 aria-hidden /> Compare every signal</h2>
                  <p>Scan the full window without opening each day.</p>
                </div>
              </div>
              <div className="ssr-trip-matrix-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Day</th>
                      <th scope="col">Weather gate</th>
                      <th scope="col">Weather score</th>
                      <th scope="col">Travel</th>
                      <th scope="col">High / low</th>
                      <th scope="col">Peak gust</th>
                      <th scope="col">Precip</th>
                      <th scope="col">Daylight</th>
                      <th scope="col">Visibility</th>
                      <th scope="col">Alerts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tripForecastRows.map((day, index) => (
                      <tr key={day.date} className={sel === index ? 'selected' : ''}>
                        <th scope="row">
                          <button type="button" onClick={() => inspectDay(index)} aria-label={`Inspect ${weekdayLabel(day.date)}, ${monthDayLabel(day.date)}`}>
                            <strong>{weekdayLabel(day.date)}</strong>
                            <span>{monthDayLabel(day.date)}</span>
                          </button>
                        </th>
                        <td><span className={`ssr-trip-day-pill ${levelClass(day.decisionLevel)}`}>{weatherWindowLabel(day.decisionLevel)}</span></td>
                        <td className="numeric"><strong>{day.score ?? '—'}</strong>{day.score !== null ? '/100' : ''}</td>
                        <td className="numeric"><strong>{day.travelPassHours}</strong>/{day.travelTotalHours}h</td>
                        <td>{formatTemperatureRange(day.tempHighF, day.tempLowF, formatTempDisplay)}</td>
                        <td>{formatWindDisplay(day.windGustMph)}</td>
                        <td>{day.precipChance !== null ? `${day.precipChance}%` : '—'}</td>
                        <td>
                          {day.sunrise && day.sunset
                            ? `${formatClockForStyle(day.sunrise, timeStyle)}–${formatClockForStyle(day.sunset, timeStyle)}`
                            : '—'}
                        </td>
                        <td>{day.visibilityLevel || '—'}</td>
                        <td className={day.alertCount > 0 ? 'warn' : ''}>{day.alertCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* DAY STRIP */}
            <section className="ssr-trip-panel ssr-trip-days-panel" aria-labelledby="trip-days-title">
              <div className="ssr-trip-section-head">
                <div>
                  <span>Day-by-day comparison</span>
                  <h2 id="trip-days-title"><CalendarDays aria-hidden /> Choose a day to inspect</h2>
                </div>
                <p><Clock3 aria-hidden /> All days use a {tripStartDisplay} start and {travelWindowHoursLabel} window.</p>
              </div>
              <div className="ssr-trip-days" role="group" aria-label="Trip forecast days">
                {tripForecastRows.map((day, i) => {
                  const dlv = levelClass(day.decisionLevel);
                  const gustWarn = typeof day.windGustMph === 'number' && day.windGustMph >= 35;
                  const precipWarn = typeof day.precipChance === 'number' && day.precipChance >= 30;
                  const isBestDay = i === bestIndex;
                  const isWatchDay = i === watchDayIndex && watchDayIndex !== bestIndex;
                  return (
                    <button
                      type="button"
                      key={day.date}
                      ref={(node) => { dayRefs.current[i] = node; }}
                      className={`ssr-trip-day ${sel === i ? 'sel' : ''}`}
                      onClick={() => selectDay(i)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                          event.preventDefault();
                          selectDay((i + 1) % tripForecastRows.length, true);
                        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                          event.preventDefault();
                          selectDay((i - 1 + tripForecastRows.length) % tripForecastRows.length, true);
                        } else if (event.key === 'Home') {
                          event.preventDefault();
                          selectDay(0, true);
                        } else if (event.key === 'End') {
                          event.preventDefault();
                          selectDay(tripForecastRows.length - 1, true);
                        }
                      }}
                      aria-pressed={sel === i}
                    >
                      <div className={`ssr-trip-day-band ${dlv}`} />
                      {(isBestDay || isWatchDay) && (
                        <div className="ssr-trip-day-flags" aria-label={isBestDay ? 'Best weather option in this forecast' : 'Day needing the most scrutiny'}>
                          <span className={isBestDay ? 'best' : 'watch'}>{isBestDay ? 'Best weather' : 'Watch closely'}</span>
                        </div>
                      )}
                      <div className="ssr-trip-day-top">
                        <div className="ssr-trip-day-date">
                          <span className="ssr-trip-day-wd">{weekdayLabel(day.date)}<b>{monthDayLabel(day.date)}</b></span>
                          <span className="ssr-trip-day-sky">{weatherConditionEmoji(day.weatherDescription, day.isDaytime)}</span>
                        </div>
                        <div className="ssr-trip-day-verdict">
                          <span className={`ssr-trip-day-pill ${dlv}`}>{weatherWindowLabel(day.decisionLevel)}</span>
                          {day.score !== null && (
                            <span className="ssr-trip-day-score">{day.score}<small>/100</small></span>
                          )}
                          {typeof day.deltas?.score === 'number' && day.deltas.score !== 0 && (
                            <span
                              className={`ssr-trip-day-delta ${day.deltas.score > 0 ? 'up' : 'down'}`}
                              title={`Weather-window score ${day.deltas.score > 0 ? 'up' : 'down'} ${Math.abs(day.deltas.score)} vs. previous day`}
                            >
                              {day.deltas.score > 0 ? '▲' : '▼'}{Math.abs(day.deltas.score)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="ssr-trip-day-body">
                        <div className="ssr-trip-day-metrics">
                          <div className="ssr-trip-day-metric">
                            <span className="mk">High / low</span>
                            <span className="mv ssr-trip-temp-range">
                              <span>H {formatTempDisplay(day.tempHighF, { includeUnit: false })}{renderMetricDelta(day.deltas?.tempHighF, '°')}</span>
                              <span>L {formatTempDisplay(day.tempLowF, { includeUnit: false })}{renderMetricDelta(day.deltas?.tempLowF, '°')}</span>
                            </span>
                          </div>
                          <div className="ssr-trip-day-metric">
                            <span className="mk">Gust</span>
                            <span className={`mv ${gustWarn ? 'warn' : ''}`}>{formatWindDisplay(day.windGustMph, { includeUnit: false })}{renderMetricDelta(day.deltas?.windGustMph)}</span>
                          </div>
                          <div className="ssr-trip-day-metric">
                            <span className="mk">Precip</span>
                            <span className={`mv ${precipWarn ? 'warn' : ''}`}>{day.precipChance !== null ? `${day.precipChance}%` : '—'}{renderMetricDelta(day.deltas?.precipChance, '%')}</span>
                          </div>
                        </div>
                        <div className="ssr-trip-day-headline">{localizeUnitText(day.decisionHeadline)}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {selected && (
              <TripHourlyWeatherChart
                points={selected.hourlyWeather}
                dayLabel={`${weekdayLabel(selected.date)}, ${monthDayLabel(selected.date)}`}
                windowLabel={`${tripStartDisplay} start · ${travelWindowHoursLabel} travel window`}
                timeStyle={timeStyle}
                formatTempDisplay={formatTempDisplay}
                formatWindDisplay={formatWindDisplay}
              />
            )}

            {/* SELECTED DAY DETAIL */}
            {selected && (
              <div className="ssr-trip-panel ssr-trip-detail" ref={detailRef} aria-live="polite">
                <div className="ssr-trip-detail-h">
                  <div className="ssr-trip-detail-title">
                    <div>
                      <span className={`ssr-trip-day-pill ${levelClass(selected.decisionLevel)}`}>{weatherWindowLabel(selected.decisionLevel)}</span>
                      <h2>
                        {weekdayLabel(selected.date)}, {monthDayLabel(selected.date)}
                        {selected.score !== null ? ` · ${selected.score}/100` : ''}
                      </h2>
                    </div>
                    <p>{localizeUnitText(selected.decisionHeadline)}</p>
                  </div>
                  <button type="button" className="ssr-btn primary" onClick={requestPlannerView}>
                    Review full Planner assessment
                  </button>
                </div>
                <div className="ssr-trip-detail-body">
                  <div className="ssr-trip-detail-cell">
                    <h3><CloudRain /> Weather</h3>
                    <p>
                      {localizeUnitText(selected.weatherDescription)}. High {formatTempDisplay(selected.tempHighF)}, low{' '}
                      {formatTempDisplay(selected.tempLowF)}; precip {selected.precipChance !== null ? `${selected.precipChance}%` : 'N/A'}.
                    </p>
                    <small>{selected.humidityPct !== null ? `${selected.humidityPct}% humidity` : 'Humidity unavailable'} · {selected.cloudCoverPct !== null ? `${selected.cloudCoverPct}% cloud cover` : 'Cloud cover unavailable'}</small>
                  </div>
                  <div className="ssr-trip-detail-cell">
                    <h3><Wind /> Wind & visibility</h3>
                    <p>Peak gust {formatWindDisplay(selected.windGustMph)}{selected.windDirection ? ` from ${selected.windDirection}` : ''}.</p>
                    <small>{selected.visibilitySummary ? localizeUnitText(selected.visibilitySummary) : selected.visibilityLevel ? `${selected.visibilityLevel} visibility risk` : 'Visibility risk unavailable'}</small>
                  </div>
                  <div className="ssr-trip-detail-cell">
                    <h3><Route /> Travel window</h3>
                    <p><strong>{selected.travelPassHours}/{selected.travelTotalHours} hours</strong> meet every travel threshold.</p>
                    <small>
                      {(selected.expectedRainIn !== null || selected.expectedSnowIn !== null)
                        && (selected.expectedRainIn ?? 0) === 0
                        && (selected.expectedSnowIn ?? 0) === 0
                        ? 'No rain or snow accumulation expected'
                        : selected.expectedRainIn !== null || selected.expectedSnowIn !== null
                        ? localizeUnitText(`${selected.expectedRainIn !== null ? `${selected.expectedRainIn.toFixed(2)} in rain` : 'No rain estimate'} · ${selected.expectedSnowIn !== null ? `${selected.expectedSnowIn.toFixed(1)} in snow` : 'No snow estimate'}`)
                        : 'No accumulation estimate'}
                    </small>
                  </div>
                  <div className="ssr-trip-detail-cell">
                    <h3><Sunrise /> Daylight</h3>
                    <p>
                      {selected.sunrise && selected.sunset
                        ? `${formatClockForStyle(selected.sunrise, timeStyle)} sunrise · ${formatClockForStyle(selected.sunset, timeStyle)} sunset`
                        : 'Daylight times unavailable'}
                    </p>
                    <small>{dayLengthLabel(selected.dayLength) ? `${dayLengthLabel(selected.dayLength)} total daylight` : `Daily start ${tripStartDisplay}`}</small>
                  </div>
                  <div className="ssr-trip-detail-cell">
                    <h3><ShieldAlert /> Alerts & air</h3>
                    <p>{selected.alertCount > 0 ? `${selected.alertCount} active weather alert${selected.alertCount === 1 ? '' : 's'}` : 'No active weather alerts'}</p>
                    <small>
                      {selected.airQualityAqi !== null
                        ? `AQI ${selected.airQualityAqi}${selected.airQualityCategory ? ` · ${selected.airQualityCategory}` : ''}`
                        : selected.airQualityCategory || 'Air quality unavailable'}
                    </small>
                  </div>
                  <div className="ssr-trip-detail-cell">
                    <h3><Eye /> Decision context</h3>
                    <p>
                      {selected.score !== null && averageScore !== null
                        ? `${selected.score - averageScore >= 0 ? '+' : ''}${selected.score - averageScore} points versus the trip average.`
                        : 'No trip-average score comparison.'}
                    </p>
                    <small className={selected.partialData ? 'warn' : ''}>
                      {selected.partialData ? selected.apiWarning || 'Some forecast inputs are missing.' : 'All primary trip inputs loaded.'}
                    </small>
                  </div>
                </div>
                <div className="ssr-trip-detail-foot">
                  <span>{selected.sourceIssuedTime ? `Issued ${formatPubTime(selected.sourceIssuedTime)}` : 'Forecast'}</span>
                  <span>Day {sel + 1} of {tripForecastRows.length}</span>
                </div>
              </div>
            )}
          </>
        )}

      </div>
      {plannerDayPickerVisible && plannerDay && (
        <div
          className="ssr-trip-day-picker-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPlannerDayPickerOpen(false);
          }}
        >
          <section
            ref={plannerDayDialogRef}
            className="ssr-trip-day-picker"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trip-day-picker-title"
            aria-describedby="trip-day-picker-description"
            tabIndex={-1}
          >
            <header className="ssr-trip-day-picker-head">
              <div>
                <span>Open Planner</span>
                <h2 id="trip-day-picker-title">Choose the report day</h2>
                <p id="trip-day-picker-description">
                  Select which multi-day forecast should become the active Planner date for {objectiveSummary}.
                </p>
              </div>
              <button
                type="button"
                className="ssr-trip-day-picker-close"
                onClick={() => setPlannerDayPickerOpen(false)}
                aria-label="Close day picker"
              >
                <X aria-hidden />
              </button>
            </header>
            <div className="ssr-trip-day-picker-options" role="radiogroup" aria-label="Planner report day">
              {tripForecastRows.map((day, index) => {
                const active = plannerDayPickerIndex === index;
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    tabIndex={active ? 0 : -1}
                    key={day.date}
                    ref={(node) => { plannerDayOptionRefs.current[index] = node; }}
                    className={`ssr-trip-day-picker-option ${active ? 'is-selected' : ''}`}
                    onClick={() => choosePlannerDay(index)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                        event.preventDefault();
                        choosePlannerDay((index + 1) % tripForecastRows.length, true);
                      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        choosePlannerDay((index - 1 + tripForecastRows.length) % tripForecastRows.length, true);
                      } else if (event.key === 'Home') {
                        event.preventDefault();
                        choosePlannerDay(0, true);
                      } else if (event.key === 'End') {
                        event.preventDefault();
                        choosePlannerDay(tripForecastRows.length - 1, true);
                      }
                    }}
                  >
                    <span className={`ssr-trip-day-picker-band ${levelClass(day.decisionLevel)}`} />
                    <span className="ssr-trip-day-picker-date">
                      <strong>{weekdayLabel(day.date)}</strong>
                      <span>{monthDayLabel(day.date)}</span>
                    </span>
                    <span className={`ssr-trip-day-pill ${levelClass(day.decisionLevel)}`}>
                      {weatherWindowLabel(day.decisionLevel)}
                    </span>
                    <span className="ssr-trip-day-picker-weather">
                      {formatTemperatureRange(day.tempHighF, day.tempLowF, formatTempDisplay)} · {formatWindDisplay(day.windGustMph)} gust
                    </span>
                    <span className="ssr-trip-day-picker-score">
                      {day.score !== null ? `${day.score}/100` : 'No score'}
                    </span>
                    {active && <Check className="ssr-trip-day-picker-check" aria-hidden />}
                  </button>
                );
              })}
            </div>
            <footer className="ssr-trip-day-picker-actions">
              <div>
                <strong>{weekdayLabel(plannerDay.date)}, {monthDayLabel(plannerDay.date)}</strong>
                <span>{tripStartDisplay} start · {travelWindowHoursLabel} travel window</span>
              </div>
              <button type="button" className="ssr-btn" onClick={() => setPlannerDayPickerOpen(false)}>Cancel</button>
              <button type="button" className="ssr-btn primary" onClick={openPlannerForSelectedDay}>
                Open selected day <ArrowRight aria-hidden />
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
