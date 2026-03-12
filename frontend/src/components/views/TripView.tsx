import {
  House,
  RefreshCw,
  Route,
  SlidersHorizontal,
} from 'lucide-react';
import { AppDisclaimer } from '../../app/map-components';
import type { DecisionLevel, TimeStyle } from '../../app/types';
import { formatClockForStyle } from '../../app/core';
import { weatherConditionEmoji } from '../../app/weather-display';
import { MultiDayRiskArc } from '../planner/cards/MultiDayRiskArc';

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
  avalancheSummary: string;
  travelSummary: string;
  sourceIssuedTime: string | null;
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
  formatIsoDateLabel,
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
  const objectiveSummary = hasObjective ? objectiveName || `${position.lat.toFixed(4)}, ${position.lng.toFixed(4)}` : 'No objective selected';
  const tripStartDisplay = formatClockForStyle(tripStartTime, timeStyle);
  const goCount = tripForecastRows.filter((row) => row.decisionLevel === 'GO').length;
  const cautionCount = tripForecastRows.filter((row) => row.decisionLevel === 'CAUTION').length;
  const noGoCount = tripForecastRows.filter((row) => row.decisionLevel === 'NO-GO').length;
  const tripWorstLevel = noGoCount > 0 ? 'NO-GO' : cautionCount > 0 ? 'CAUTION' : tripForecastRows.length > 0 ? 'GO' : 'N/A';
  const tripWorstLevelClass = tripWorstLevel === 'NO-GO' ? 'nogo' : tripWorstLevel === 'CAUTION' ? 'caution' : tripWorstLevel === 'GO' ? 'go' : 'watch';

  const clearForecastState = () => {
    setTripForecastRows([]);
    setTripForecastError(null);
    setTripForecastNote(null);
  };

  return (
    <div key="view-trip" className={appShellClassName} aria-busy={isViewPending || tripForecastLoading}>
      <section className="settings-shell trip-shell">
        <div className="settings-head">
          <div>
            <div className="home-kicker">Backcountry Conditions Expedition Tool</div>
            <h2>Multi-Day Trip Forecast</h2>
            <p>Evaluate daily decision gates for backpacking or expedition plans across consecutive days.</p>
          </div>
          <div className="settings-nav">
            <button className="settings-btn" onClick={() => navigateToView('home')}>
              <House size={14} /> Homepage
            </button>
            <button className="settings-btn" onClick={openPlannerView}>
              <Route size={14} /> Planner
            </button>
            <button className="settings-btn" onClick={() => navigateToView('settings')}>
              <SlidersHorizontal size={14} /> Settings
            </button>
            <button className="primary-btn" onClick={() => void runTripForecast()} disabled={tripForecastLoading || !hasObjective}>
              <RefreshCw size={14} /> {tripForecastLoading ? 'Loading\u2026' : 'Run Multi-Day Forecast'}
            </button>
          </div>
        </div>

        {!hasObjective && (
          <article className="settings-card error-banner">
            <h3>Objective required</h3>
            <p>Select an objective in Planner first, then use this tool for multi-day forecasting.</p>
          </article>
        )}

        <div className="settings-grid trip-settings-grid">
          <article className="settings-card">
            <h3>Trip setup</h3>
            <p>Start date/time and duration apply to every day in this sequence.</p>
            <div className="settings-time-row">
              <label className="date-control">
                <span>Trip start date</span>
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
              <label className="date-control">
                <span>Daily start time</span>
                <input
                  type="time"
                  value={tripStartTime}
                  onChange={(e) => {
                    setTripStartTime(e.target.value);
                    clearForecastState();
                  }}
                />
              </label>
              <label className="date-control">
                <span>Trip duration</span>
                <select
                  value={tripDurationDays}
                  onChange={(e) => {
                    setTripDurationDays(Math.max(2, Math.min(7, Math.round(Number(e.target.value) || 3))));
                    clearForecastState();
                  }}
                >
                  <option value={2}>2 days</option>
                  <option value={3}>3 days</option>
                  <option value={4}>4 days</option>
                  <option value={5}>5 days</option>
                  <option value={6}>6 days</option>
                  <option value={7}>7 days</option>
                </select>
              </label>
            </div>
          </article>

          <article className="settings-card">
            <h3>Current context</h3>
            <p>Objective: {objectiveSummary}</p>
            <p>Daily start time: {tripStartDisplay}</p>
            <p>Travel window: {travelWindowHoursLabel}</p>
            <p>Forecast range limit: through {maxForecastDate}</p>
          </article>
        </div>

        {tripForecastError && (
          <article className="settings-card error-banner">
            <h3>Multi-day forecast unavailable</h3>
            <p>{tripForecastError}</p>
          </article>
        )}

        {tripForecastRows.length > 0 && (
          <>
            <article className="settings-card trip-overview-card">
              <div className="trip-overview-head">
                <h3>Trip risk overview</h3>
                <span className={`decision-pill ${tripWorstLevelClass}`}>Worst day {tripWorstLevel}</span>
              </div>
              <div className="trip-overview-grid">
                <div className="trip-overview-item">
                  <span>GO</span>
                  <strong>{goCount}</strong>
                </div>
                <div className="trip-overview-item">
                  <span>CAUTION</span>
                  <strong>{cautionCount}</strong>
                </div>
                <div className="trip-overview-item">
                  <span>NO-GO</span>
                  <strong>{noGoCount}</strong>
                </div>
              </div>
              {tripForecastNote && <p className="muted-note">{tripForecastNote}</p>}
            </article>

            <MultiDayRiskArc
              tripDays={tripForecastRows.map((row) => ({
                date: row.date,
                dateLabel: formatIsoDateLabel(row.date),
                score: row.score,
                decisionLevel: row.decisionLevel,
                precipChance: row.precipChance,
                windGustMph: row.windGustMph,
              }))}
              getScoreColor={getScoreColor}
            />

            <div className="trip-day-grid">
              {tripForecastRows.map((row) => {
                const rowClass = row.decisionLevel.toLowerCase().replace('-', '');
                const weatherEmoji = weatherConditionEmoji(row.weatherDescription, null);
                return (
                  <article key={row.date} className="settings-card trip-day-card">
                    <div className="trip-day-head">
                      <div className="trip-day-title">
                        <h3>{formatIsoDateLabel(row.date)}</h3>
                        <span className={`decision-pill ${rowClass}`}>{row.decisionLevel}</span>
                        {row.score !== null && <span className="trip-day-score">{row.score}%</span>}
                      </div>
                      <button
                        type="button"
                        className="settings-btn"
                        onClick={() => onUseDayInPlanner(row.date, tripStartTime)}
                      >
                        Use in Planner
                      </button>
                    </div>
                    <p className="trip-day-weather">
                      {weatherEmoji} {localizeUnitText(row.weatherDescription)}
                    </p>
                    <p className="trip-day-metrics">
                      Temp {formatTempDisplay(row.tempF)} (feels {formatTempDisplay(row.feelsLikeF)}) • Gust {formatWindDisplay(row.windGustMph)} • Precip{' '}
                      {row.precipChance !== null ? `${row.precipChance}%` : 'N/A'}
                    </p>
                    <p className="trip-day-metrics">Avalanche: {row.avalancheSummary} • Travel: {row.travelSummary}</p>
                    <p className="muted-note">{localizeUnitText(row.decisionHeadline)}</p>
                    {row.sourceIssuedTime && <p className="muted-note">Issued {formatPubTime(row.sourceIssuedTime)}</p>}
                  </article>
                );
              })}
            </div>
          </>
        )}
        <AppDisclaimer compact />
      </section>
    </div>
  );
}
