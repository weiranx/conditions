import React from 'react';
import {
  RefreshCw,
  CloudRain,
  Route,
  Info,
  ArrowRight,
  CalendarDays,
  Clock3,
} from 'lucide-react';
import type { DecisionLevel, TimeStyle } from '../../app/types';
import { formatClockForStyle } from '../../app/core';
import { weatherConditionEmoji } from '../../app/weather-display';
import type { Suggestion } from '../../lib/search';
import { SearchBox } from '../planner/SearchBox';
import '../../styles/trip-redesign.css';
import { ProductNav } from './ProductNav';

export type MultiDayTripForecastDay = {
  date: string;
  decisionLevel: DecisionLevel;
  decisionHeadline: string;
  score: number | null;
  weatherDescription: string;
  tempF: number | null;
  feelsLikeF: number | null;
  windGustMph: number | null;
  precipChance: number | null;
  isDaytime: boolean | null;
  travelSummary: string;
  sourceIssuedTime: string | null;
  deltas?: {
    score: number | null;
    tempF: number | null;
    windGustMph: number | null;
    precipChance: number | null;
  } | null;
};

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
  navigateToView: (view: 'home' | 'planner' | 'settings' | 'status' | 'trip' | 'logs') => void;
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

function levelClass(level: DecisionLevel): string {
  return level.toLowerCase().replace('-', '');
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
  const scoreOf = (d: MultiDayTripForecastDay) => (typeof d.score === 'number' ? d.score : 0);

  const linePts = days.map((d, i) => `${x(i)},${y(scoreOf(d))}`);
  const areaD = `M ${x(0)} ${H - pad.b} L ${linePts.join(' L ')} L ${x(n - 1)} ${H - pad.b} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Conditions score trend by trip day">
      {[0, 25, 50, 75, 100].map((g) => (
        <g key={g}>
          <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} stroke="var(--ssr-line)" strokeDasharray="2 4" />
          <text x={pad.l - 6} y={y(g) + 3} textAnchor="end" fontSize="9" fill="var(--ssr-text-4)" fontFamily="var(--ssr-mono)">{g}</text>
        </g>
      ))}
      {n > 1 && <path d={areaD} fill="var(--ssr-brand)" opacity="0.06" />}
      {n > 1 && <polyline points={linePts.join(' ')} fill="none" stroke="var(--ssr-brand)" strokeWidth="2" />}
      {days.map((d, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(scoreOf(d))} r="6" fill={getScoreColor(scoreOf(d))} stroke="var(--ssr-surface)" strokeWidth="2.5" />
          <text x={x(i)} y={y(scoreOf(d)) - 13} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--ssr-text)" fontFamily="var(--ssr-sans)">
            {typeof d.score === 'number' ? d.score : '—'}
          </text>
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
  const [sel, setSel] = React.useState(0);
  const dayRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const detailRef = React.useRef<HTMLDivElement | null>(null);

  // Re-anchor selection to the best day whenever a fresh forecast lands.
  React.useEffect(() => {
    if (tripForecastRows.length === 0) {
      setSel(0);
      return;
    }
    let bestIdx = 0;
    let bestScore = -Infinity;
    tripForecastRows.forEach((row, i) => {
      const s = typeof row.score === 'number' ? row.score : -Infinity;
      if (s > bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    });
    setSel(bestIdx);
  }, [tripForecastRows]);

  const tripStartDisplay = formatClockForStyle(tripStartTime, timeStyle);
  const goCount = tripForecastRows.filter((row) => row.decisionLevel === 'GO').length;
  const cautionCount = tripForecastRows.filter((row) => row.decisionLevel === 'CAUTION').length;
  const noGoCount = tripForecastRows.filter((row) => row.decisionLevel === 'NO-GO').length;
  const worst = noGoCount > 0 ? 'NO-GO' : cautionCount > 0 ? 'CAUTION' : tripForecastRows.length > 0 ? 'GO' : 'N/A';
  const objectiveSummary = hasObjective
    ? objectiveName || `${position.lat.toFixed(4)}°, ${position.lng.toFixed(4)}°`
    : 'No objective selected';
  const objectiveReady = hasObjective && !objectiveDraftDirty;

  const best = tripForecastRows.reduce<MultiDayTripForecastDay | null>((acc, row) => {
    if (!acc) return row;
    return (row.score ?? -Infinity) > (acc.score ?? -Infinity) ? row : acc;
  }, null);
  const bestIndex = best ? tripForecastRows.findIndex((row) => row.date === best.date) : -1;
  const hasClearGoDay = goCount > 0;

  const clearForecastState = () => {
    setTripForecastRows([]);
    setTripForecastError(null);
    setTripForecastNote(null);
  };

  const selected = tripForecastRows[sel] ?? null;

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

  return (
    <div key="view-trip" className={appShellClassName} aria-busy={isViewPending || tripForecastLoading}>
      <div className="ssr-trip">
        <ProductNav active="trip" navigateToView={navigateToView} openPlannerView={openPlannerView} />
        {/* HEADER + SETUP */}
        <div className="ssr-trip-head">
          <div className="ssr-trip-intro">
            <div className="ssr-trip-kicker">Expedition tool</div>
            <h1>Plan the right day, not just the route.</h1>
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
                  setTripDurationDays(Math.max(2, Math.min(7, Math.round(Number(e.target.value) || 3))));
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

        {!hasObjective && (
          <div className="ssr-trip-banner">
            <div>
              <h3>Objective required</h3>
              <p>Select an objective in Planner first, then use this tool for multi-day forecasting.</p>
            </div>
            <button type="button" className="ssr-trip-banner-action" onClick={openPlannerView}>
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
              <section className={`ssr-trip-recommendation ${levelClass(best.decisionLevel)}`} aria-labelledby="trip-recommendation-title">
                <div className="ssr-trip-recommendation-icon" aria-hidden>
                  <CalendarDays />
                </div>
                <div className="ssr-trip-recommendation-copy">
                  <span className="ssr-trip-recommendation-eyebrow">
                    {hasClearGoDay ? 'Most favorable go day' : 'Most favorable — still use caution'}
                  </span>
                  <h2 id="trip-recommendation-title">{weekdayLabel(best.date)}, {monthDayLabel(best.date)}</h2>
                  <p>{localizeUnitText(best.decisionHeadline)}</p>
                </div>
                <div className="ssr-trip-recommendation-facts" aria-label="Recommended day summary">
                  <span><strong>{best.score ?? '—'}</strong> conditions score</span>
                  <span><strong>{formatWindDisplay(best.windGustMph, { includeUnit: false })}</strong> peak gust</span>
                  <span><strong>{best.precipChance !== null ? `${best.precipChance}%` : '—'}</strong> precip</span>
                </div>
                <button type="button" className="ssr-trip-recommendation-action" onClick={reviewBestDay}>
                  Review this day <ArrowRight size={15} aria-hidden />
                </button>
              </section>
            )}

            {/* OVERVIEW */}
            <div className="ssr-trip-overview">
              <div className="ssr-trip-ov">
                <div className="ssr-trip-ov-k">Objective</div>
                <div className="ssr-trip-ov-obj">{objectiveSummary}</div>
                <div className="ssr-trip-ov-sub">
                  {position.lat.toFixed(4)}°, {position.lng.toFixed(4)}° · {travelWindowHoursLabel} window · start {tripStartDisplay}
                </div>
              </div>
              <div className="ssr-trip-ov">
                <div className="ssr-trip-ov-count go">{goCount}</div>
                <div className="ssr-trip-ov-count-k">Go days</div>
              </div>
              <div className="ssr-trip-ov">
                <div className="ssr-trip-ov-count caution">{cautionCount}</div>
                <div className="ssr-trip-ov-count-k">Caution</div>
              </div>
              <div className="ssr-trip-ov">
                <div className="ssr-trip-ov-count nogo">{noGoCount}</div>
                <div className="ssr-trip-ov-count-k">No-go</div>
              </div>
              <div className="ssr-trip-ov">
                <div className="ssr-trip-ov-k">Best day</div>
                {best && (
                  <div className="ssr-trip-ov-best">
                    <span className="ssr-trip-ov-best-day">
                      {weekdayLabel(best.date)} {monthDayLabel(best.date)}{best.score !== null ? ` · ${best.score}/100` : ''}
                    </span>
                    <span className="ssr-trip-ov-best-note">{localizeUnitText(best.decisionHeadline)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* TREND ARC */}
            <div className="ssr-trip-trend">
              <div className="ssr-trip-trend-h">
                <h2>Conditions score across the trip</h2>
                <span>Worst day · {worst}{tripForecastNote ? ` · ${tripForecastNote}` : ''}</span>
              </div>
              <TrendArc days={tripForecastRows} getScoreColor={getScoreColor} />
            </div>

            {/* DAY STRIP */}
            <div className="ssr-trip-section-head">
              <div>
                <span>Day-by-day comparison</span>
                <h2>Choose a day to inspect</h2>
              </div>
              <p><Clock3 aria-hidden /> All days use a {tripStartDisplay} start and {travelWindowHoursLabel} window.</p>
            </div>
            <div className="ssr-trip-days" role="group" aria-label="Trip forecast days">
              {tripForecastRows.map((day, i) => {
                const dlv = levelClass(day.decisionLevel);
                const gustWarn = typeof day.windGustMph === 'number' && day.windGustMph >= 35;
                const precipWarn = typeof day.precipChance === 'number' && day.precipChance >= 30;
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
                    <div className="ssr-trip-day-top">
                      <div className="ssr-trip-day-date">
                        <span className="ssr-trip-day-wd">{weekdayLabel(day.date)}<b>{monthDayLabel(day.date)}</b></span>
                        <span className="ssr-trip-day-sky">{weatherConditionEmoji(day.weatherDescription, day.isDaytime)}</span>
                      </div>
                      <div className="ssr-trip-day-verdict">
                        <span className={`ssr-trip-day-pill ${dlv}`}>{day.decisionLevel}</span>
                        {day.score !== null && (
                          <span className="ssr-trip-day-score">{day.score}<small>/100</small></span>
                        )}
                        {typeof day.deltas?.score === 'number' && day.deltas.score !== 0 && (
                          <span
                            className={`ssr-trip-day-delta ${day.deltas.score > 0 ? 'up' : 'down'}`}
                            title={`Conditions score ${day.deltas.score > 0 ? 'up' : 'down'} ${Math.abs(day.deltas.score)} vs. previous day`}
                          >
                            {day.deltas.score > 0 ? '▲' : '▼'}{Math.abs(day.deltas.score)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="ssr-trip-day-body">
                      <div className="ssr-trip-day-metrics">
                        <div className="ssr-trip-day-metric">
                          <span className="mk">Temp</span>
                          <span className="mv">{formatTempDisplay(day.tempF, { includeUnit: false })}{renderMetricDelta(day.deltas?.tempF, '°')}</span>
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

            {/* SELECTED DAY DETAIL */}
            {selected && (
              <div className="ssr-trip-detail" ref={detailRef} aria-live="polite">
                <div className="ssr-trip-detail-h">
                  <div className="ssr-trip-detail-title">
                    <span className={`ssr-trip-day-pill ${levelClass(selected.decisionLevel)}`}>{selected.decisionLevel}</span>
                    <h2>
                      {weekdayLabel(selected.date)}, {monthDayLabel(selected.date)}
                      {selected.score !== null ? ` · ${selected.score}/100` : ''}
                    </h2>
                  </div>
                  <button type="button" className="ssr-btn primary" onClick={() => onUseDayInPlanner(selected.date, tripStartTime)}>
                    Use this day in Planner
                  </button>
                </div>
                <div className="ssr-trip-detail-body">
                  <div className="ssr-trip-detail-cell">
                    <h3><CloudRain /> Weather</h3>
                    <p>
                      {localizeUnitText(selected.weatherDescription)}. Temp {formatTempDisplay(selected.tempF)} (feels{' '}
                      {formatTempDisplay(selected.feelsLikeF)}), gusts to {formatWindDisplay(selected.windGustMph)}, precip{' '}
                      {selected.precipChance !== null ? `${selected.precipChance}%` : 'N/A'}.
                    </p>
                  </div>
                  <div className="ssr-trip-detail-cell">
                    <h3><Route /> Travel window</h3>
                    <p>{localizeUnitText(selected.travelSummary)}</p>
                  </div>
                  <div className="ssr-trip-detail-cell">
                    <h3><Info /> Decision</h3>
                    <p>{localizeUnitText(selected.decisionHeadline)}</p>
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

        <div className="ssr-trip-disclaimer">
          <Info />
          <span>
            This view compares forecast weather and travel windows only; it does not project avalanche danger.
            Check the current official bulletin within 24h of departure and use Planner for the final day-specific assessment.
          </span>
        </div>
      </div>
    </div>
  );
}
