import { ArrowRight, Check, Clock3, LoaderCircle, Plus, Sparkles } from 'lucide-react';
import type { UserPreferences } from '../../app/types';
import type { StartTimeScenarioComparison } from '../../app/start-time-scenarios';
import './StartTimeScenarioCard.css';

interface StartTimeScenarioCardProps {
  comparison: StartTimeScenarioComparison | null;
  loading: boolean;
  error: string | null;
  preferences: UserPreferences;
  currentStartTime: string;
  formatClockForStyle: (time: string, style: UserPreferences['timeStyle']) => string;
  formatWindDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatTempDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  onUseForNewReport: (startTime: string) => void;
  canGenerateMore: boolean;
  onGenerateMore: () => void;
}

function formatDaylight(minutes: number | null): string {
  if (minutes === null) return 'Unknown';
  if (minutes < 0) return `${Math.ceil(Math.abs(minutes) / 60)}h after sunset`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${String(remainder).padStart(2, '0')}m`;
}

function daylightTone(minutes: number | null): 'unknown' | 'good' | 'caution' | 'late' {
  if (minutes === null) return 'unknown';
  if (minutes < 0) return 'late';
  if (minutes < 60) return 'caution';
  return 'good';
}

function formatDelta(value: number, bestValue: number, suffix: string, precision = 0): string {
  const delta = value - bestValue;
  if (Math.abs(delta) < 0.05) return 'baseline';
  return `${delta > 0 ? '+' : ''}${delta.toFixed(precision)}${suffix}`;
}

function formatWindDelta(
  value: number,
  bestValue: number,
  formatWindDisplay: StartTimeScenarioCardProps['formatWindDisplay'],
): string {
  const delta = value - bestValue;
  if (Math.abs(delta) < 0.05) return 'baseline';
  return `${delta > 0 ? '+' : '−'}${formatWindDisplay(Math.abs(delta), { precision: 0 })}`;
}

function formatTemperatureDelta(valueF: number, bestValueF: number, unit: UserPreferences['temperatureUnit']): string {
  const deltaF = valueF - bestValueF;
  if (Math.abs(deltaF) < 0.05) return 'baseline';
  const displayDelta = unit === 'c' ? deltaF * 5 / 9 : deltaF;
  return `${displayDelta > 0 ? '+' : '−'}${Math.abs(displayDelta).toFixed(0)}°`;
}

export function StartTimeScenarioCard({
  comparison,
  loading,
  error,
  preferences,
  currentStartTime,
  formatClockForStyle,
  formatWindDisplay,
  formatTempDisplay,
  onUseForNewReport,
  canGenerateMore,
  onGenerateMore,
}: StartTimeScenarioCardProps) {
  const best = comparison?.scenarios.find((scenario) => scenario.startTime === comparison.bestStartTime) ?? null;
  const current = comparison?.scenarios.find((scenario) => scenario.startTime === currentStartTime) ?? null;
  const currentIsBest = current?.startTime === comparison?.bestStartTime;
  const scenarioCount = comparison?.scenarios.length ?? 0;
  const recommendationReason = comparison && best
    ? comparison.recommendationReason.replace(
        best.startTime,
        formatClockForStyle(best.startTime, preferences.timeStyle),
      )
    : '';

  return (
    <section className="ssr-card ssr-start-scenarios start-scenarios" aria-labelledby="start-scenario-title">
      <div className="ssr-card-h">
        <div className="start-scenarios__heading">
          <h2 id="start-scenario-title">
            <span className="ssr-h-icon icon-neutral"><Clock3 size={16} /></span>
            Compare start times
          </h2>
          <p>See how departure time changes conditions, turnaround timing, and daylight.</p>
        </div>
        {comparison && <span className="ssr-h-meta">{scenarioCount} departures</span>}
      </div>

      {loading && !comparison && (
        <div className="start-scenarios__loading" role="status">
          <LoaderCircle size={17} className="spin" />
          <div><strong>Comparing departure windows</strong><span>Checking conditions and daylight for each start time…</span></div>
        </div>
      )}

      {comparison && best && (
        <>
          <div className="start-scenarios__recommendation">
            <span className="start-scenarios__recommendation-icon"><Sparkles size={17} aria-hidden /></span>
            <div className="start-scenarios__recommendation-copy">
              <span className="start-scenarios__eyebrow">{comparison.effectivelyTied ? 'Best margin among tied scores' : 'Recommended departure'}</span>
              <div className="start-scenarios__recommendation-title">
                <strong>{formatClockForStyle(best.startTime, preferences.timeStyle)}</strong>
                {currentIsBest && <span><Check size={12} aria-hidden /> Your input</span>}
              </div>
              <p>{recommendationReason}</p>
              <span className="start-scenarios__driver">{comparison.effectivelyTied ? 'Tie-breaker' : 'Biggest timing difference'}: <b>{comparison.drivingRisk}</b></span>
            </div>
            {!currentIsBest && (
              <button type="button" onClick={() => onUseForNewReport(best.startTime)}>
                Use {formatClockForStyle(best.startTime, preferences.timeStyle)}
                <ArrowRight size={14} aria-hidden />
              </button>
            )}
          </div>
          <div className={`start-scenarios__grid ${scenarioCount > 3 ? 'is-expanded' : ''}`}>
            {comparison.scenarios.map((scenario, index) => {
              const isBest = scenario.startTime === comparison.bestStartTime;
              const isCurrent = scenario.startTime === currentStartTime;
              const displayedStart = formatClockForStyle(scenario.startTime, preferences.timeStyle);
              return (
                <article
                  key={scenario.startTime}
                  className={`start-scenario ${isBest ? 'is-best' : ''} ${isCurrent ? 'is-current' : ''}`}
                  aria-label={`${displayedStart} departure, rank ${index + 1}, ${scenario.decision.level}`}
                >
                  <div className="start-scenario__head">
                    <div className="start-scenario__identity">
                      <span className="start-scenario__rank">{isBest ? 'Best overall' : `Option ${index + 1}`}</span>
                      <strong>{displayedStart}</strong>
                      <span className="start-scenario__score">Overall score {Math.round(scenario.score)}</span>
                    </div>
                    <div className="start-scenario__badges">
                      {isCurrent && <span className="start-scenario__current"><Check size={11} aria-hidden /> Your input</span>}
                      <span className={`status-pill ${scenario.decision.level === 'GO' ? 'good' : scenario.decision.level === 'CAUTION' ? 'warn' : 'bad'}`}>
                        {scenario.decision.level}
                      </span>
                    </div>
                  </div>
                  <div className="start-scenario__timeline" aria-label="Estimated trip timing">
                    <span><small>Start</small><b>{displayedStart}</b></span>
                    <i aria-hidden><ArrowRight size={12} /></i>
                    <span><small>Summit</small><b>{formatClockForStyle(scenario.summitTime, preferences.timeStyle)}</b></span>
                    <i aria-hidden><ArrowRight size={12} /></i>
                    <span><small>Return</small><b>{formatClockForStyle(scenario.returnTime, preferences.timeStyle)}{scenario.returnDayOffset > 0 ? ' +1' : ''}</b></span>
                  </div>
                  <div className={`start-scenario__daylight is-${daylightTone(scenario.daylightRemainingMinutes)}`}>
                    <span>Daylight at return</span>
                    <strong>{formatDaylight(scenario.daylightRemainingMinutes)}</strong>
                  </div>
                  <div className="start-scenario__conditions-head">
                    <span>Peak conditions</span>
                    <span>vs. recommended</span>
                  </div>
                  <dl className="start-scenario__conditions">
                    <div className={comparison.drivingRisk === 'Wind' ? 'is-driver' : ''}><dt>Wind gust</dt><dd><b>{formatWindDisplay(scenario.peakGustMph)}</b><small>{formatWindDelta(scenario.peakGustMph, best.peakGustMph, formatWindDisplay)}</small></dd></div>
                    <div className={comparison.drivingRisk === 'Heat' ? 'is-driver' : ''}><dt>Feels like</dt><dd><b>{formatTempDisplay(scenario.peakFeelsLikeF)}</b><small>{scenario.peakFeelsLikeF === null || best.peakFeelsLikeF === null ? '—' : formatTemperatureDelta(scenario.peakFeelsLikeF, best.peakFeelsLikeF, preferences.temperatureUnit)}</small></dd></div>
                    <div className={comparison.drivingRisk === 'Precipitation' ? 'is-driver' : ''}><dt>Precipitation</dt><dd><b>{Math.round(scenario.peakPrecipChance)}%</b><small>{formatDelta(scenario.peakPrecipChance, best.peakPrecipChance, ' pp')}</small></dd></div>
                    <div className={comparison.drivingRisk === 'Avalanche' ? 'is-driver' : ''}><dt>Avalanche danger</dt><dd><b>{scenario.avalancheLabel}</b><small>{scenario.avalancheLevel === null || best.avalancheLevel === null ? '—' : formatDelta(scenario.avalancheLevel, best.avalancheLevel, '')}</small></dd></div>
                    <div className={comparison.drivingRisk === 'Storm / lightning' ? 'is-driver' : ''}><dt>Storm-free hours</dt><dd><b>{scenario.cleanHours}h</b><small>{scenario.stormHours > 0 ? `${scenario.stormHours}h storm signal` : 'no storm signal'}</small></dd></div>
                  </dl>
                  {!isCurrent && (
                    <button type="button" className="start-scenario__use" onClick={() => onUseForNewReport(scenario.startTime)}>
                      Build report for {displayedStart}
                      <ArrowRight size={14} aria-hidden />
                    </button>
                  )}
                  {isCurrent && <span className="start-scenario__selected"><Check size={13} aria-hidden /> Your report uses {displayedStart}</span>}
                </article>
              );
            })}
          </div>
          <div className="start-scenarios__footer">
            <p>Summit time is estimated at the midpoint of your {preferences.travelWindowHours}h travel window. Condition deltas compare each option with the recommended departure.</p>
            {(canGenerateMore || loading) && (
              <div className="start-scenarios__more">
                <button type="button" onClick={onGenerateMore} disabled={loading}>
                  {loading ? <LoaderCircle size={14} className="spin" aria-hidden /> : <Plus size={14} aria-hidden />}
                  {loading ? 'Comparing more times…' : 'Compare hourly starts'}
                </button>
                <span>Expand to eight departures, including your selected start.</span>
              </div>
            )}
            {loading && comparison && (
              <div className="start-scenarios__refreshing" role="status">
                <LoaderCircle size={13} className="spin" aria-hidden /> Adding hourly departures…
              </div>
            )}
            {error && <p className="start-scenarios__error" role="status">{error}</p>}
          </div>
        </>
      )}

      {!comparison && !loading && error && (
        <div className="start-scenarios__empty" role="status">
          <strong>Start-time comparison is unavailable</strong>
          <span>{error}</span>
        </div>
      )}

      {!comparison && !loading && !error && (
        <div className="start-scenarios__empty">
          <strong>No departure comparison yet</strong>
          <span>Generate a report to compare early, standard, and later starts.</span>
        </div>
      )}
    </section>
  );
}
