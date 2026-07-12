import { Clock3, LoaderCircle, Plus, Sparkles } from 'lucide-react';
import type { UserPreferences } from '../../app/types';
import type { StartTimeScenarioComparison } from '../../app/start-time-scenarios';

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

  return (
    <section className="ssr-card ssr-start-scenarios" aria-labelledby="start-scenario-title">
      <div className="ssr-card-h">
        <h2 id="start-scenario-title">
          <span className="ssr-h-icon icon-neutral"><Clock3 size={16} /></span>
          Start-time scenarios
        </h2>
        {comparison && <span className="ssr-h-meta">Best: {formatClockForStyle(comparison.bestStartTime, preferences.timeStyle)}</span>}
      </div>

      {loading && !comparison && (
        <div className="ssr-scenario-loading" role="status"><LoaderCircle size={16} className="spin" /> Comparing departures…</div>
      )}

      {comparison && best && (
        <>
          <div className="ssr-scenario-recommendation">
            <Sparkles size={16} aria-hidden />
            <div>
              <b>{formatClockForStyle(best.startTime, preferences.timeStyle)} is the best overall start.</b>
              <span>{comparison.recommendationReason}</span>
            </div>
          </div>
          <div className="ssr-scenario-grid">
            {comparison.scenarios.map((scenario, index) => {
              const isBest = scenario.startTime === comparison.bestStartTime;
              const isCurrent = scenario.startTime === currentStartTime;
              return (
                <article key={scenario.startTime} className={`ssr-scenario ${isBest ? 'is-best' : ''}`}>
                  <div className="ssr-scenario-head">
                    <div>
                      <span>Rank #{index + 1} · Score {Math.round(scenario.score)}</span>
                      <strong>{formatClockForStyle(scenario.startTime, preferences.timeStyle)}</strong>
                    </div>
                    <span className={`status-pill ${scenario.decision.level === 'GO' ? 'good' : scenario.decision.level === 'CAUTION' ? 'warn' : 'bad'}`}>
                      {scenario.decision.level}
                    </span>
                  </div>
                  <div className="ssr-scenario-times">
                    <span><small>Summit est.</small><b>{formatClockForStyle(scenario.summitTime, preferences.timeStyle)}</b></span>
                    <span><small>Return est.</small><b>{formatClockForStyle(scenario.returnTime, preferences.timeStyle)}{scenario.returnDayOffset > 0 ? ' +1' : ''}</b></span>
                    <span><small>Daylight at return</small><b>{formatDaylight(scenario.daylightRemainingMinutes)}</b></span>
                  </div>
                  <dl className="ssr-scenario-risks">
                    <div><dt>Wind</dt><dd>{formatWindDisplay(scenario.peakGustMph)} <small>{formatWindDelta(scenario.peakGustMph, best.peakGustMph, formatWindDisplay)}</small></dd></div>
                    <div><dt>Heat</dt><dd>{formatTempDisplay(scenario.peakFeelsLikeF)} <small>{scenario.peakFeelsLikeF === null || best.peakFeelsLikeF === null ? '—' : formatTemperatureDelta(scenario.peakFeelsLikeF, best.peakFeelsLikeF, preferences.temperatureUnit)}</small></dd></div>
                    <div><dt>Precip</dt><dd>{Math.round(scenario.peakPrecipChance)}% <small>{formatDelta(scenario.peakPrecipChance, best.peakPrecipChance, ' pp')}</small></dd></div>
                    <div><dt>Avalanche</dt><dd>{scenario.avalancheLabel} <small>{scenario.avalancheLevel === null || best.avalancheLevel === null ? '—' : formatDelta(scenario.avalancheLevel, best.avalancheLevel, '')}</small></dd></div>
                  </dl>
                  {!isCurrent && (
                    <button type="button" className="ssr-scenario-use" onClick={() => onUseForNewReport(scenario.startTime)}>
                      Use in new report
                    </button>
                  )}
                  {isCurrent && <span className="ssr-scenario-current">Current plan</span>}
                </article>
              );
            })}
          </div>
          <p className="ssr-scenario-note">Summit is estimated at the midpoint of your {preferences.travelWindowHours}h travel window. Deltas are relative to the recommended start.</p>
          {(canGenerateMore || loading) && (
            <div className="ssr-scenario-more">
              <button type="button" onClick={onGenerateMore} disabled={loading}>
                {loading ? <LoaderCircle size={14} className="spin" aria-hidden /> : <Plus size={14} aria-hidden />}
                {loading ? 'Generating more scenarios…' : 'Generate 5 more scenarios'}
              </button>
              <span>Add hourly departures from 3 AM through 10 AM, then re-rank every option.</span>
            </div>
          )}
        </>
      )}

      {error && <p className="ssr-scenario-error" role="status">{error}</p>}
    </section>
  );
}
