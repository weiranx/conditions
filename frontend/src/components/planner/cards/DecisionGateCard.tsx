import { AlertTriangle, CalendarDays, CheckCircle2, XCircle } from 'lucide-react';
import type { DecisionLevel, SummitDecision, TimeStyle } from '../../../app/types';
import { formatClockForStyle } from '../../../app/core';

type BetterDaySuggestion = {
  date: string;
  level: DecisionLevel;
  score: number | null;
  weather: string;
  gustMph: number | null;
  precipChance: number | null;
  summary: string;
  bestWindowStart: string | null;
};

export interface DecisionGateCardProps {
  decision: SummitDecision;
  decisionActionLine: string;
  fieldBriefPrimaryReason: string;
  fieldBriefTopRisks: string[];
  rainfall24hSeverityClass: string;
  rainfall24hDisplay: string;
  decisionPassingChecksCount: number;
  decisionFailingChecks: SummitDecision['checks'];
  decisionKeyDrivers: string[];
  orderedCriticalChecks: SummitDecision['checks'];
  betterDaySuggestions: BetterDaySuggestion[];
  betterDaySuggestionsLoading: boolean;
  betterDaySuggestionsNote: string | null;
  timeStyle: TimeStyle;
  localizeUnitText: (text: string) => string;
  formatIsoDateLabel: (isoDate: string) => string;
  formatWindDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  setForecastDate: (date: string) => void;
  setError: (error: string | null) => void;
}

export function DecisionGateCard({
  decision,
  decisionActionLine,
  rainfall24hSeverityClass,
  rainfall24hDisplay,
  decisionKeyDrivers,
  orderedCriticalChecks,
  betterDaySuggestions,
  betterDaySuggestionsLoading,
  betterDaySuggestionsNote,
  timeStyle,
  localizeUnitText,
  formatIsoDateLabel,
  formatWindDisplay,
  setForecastDate,
  setError,
}: DecisionGateCardProps) {
  return (
    <>
      <p className="decision-headline">{decision.headline}</p>
      <div className={`decision-action ${decision.level.toLowerCase().replace('-', '')}`}>
        <p>{decisionActionLine}</p>
      </div>
      {rainfall24hSeverityClass === 'nogo' && (
        <div className="decision-group decision-creek-warning nogo">
          <p>Creek crossing risk: {rainfall24hDisplay} recent rainfall. Scout before committing.</p>
        </div>
      )}
      {decisionKeyDrivers.length > 0 && (
        <div className="decision-driver-chips" role="list" aria-label="Key drivers">
          {decisionKeyDrivers.map((item, idx) => (
            <span key={`${item}-${idx}`} className="decision-driver-chip" role="listitem">
              {localizeUnitText(item)}
            </span>
          ))}
        </div>
      )}
      {(decision.level === 'NO-GO' || decision.level === 'CAUTION') && (
        <div className="decision-group decision-better-days">
          <h4>
            <CalendarDays size={14} /> Potential better days (next 7 days)
          </h4>
          {betterDaySuggestionsLoading ? (
            <p className="muted-note">Scanning upcoming forecast days for lower-risk alternatives...</p>
          ) : betterDaySuggestions.length > 0 ? (
            <>
              {betterDaySuggestionsNote && <p className="muted-note">{betterDaySuggestionsNote}</p>}
              <ul className="decision-better-days-list">
                {betterDaySuggestions.slice(0, 3).map((suggestion) => {
                  const levelClass = suggestion.level.toLowerCase().replace('-', '');
                  return (
                    <li key={suggestion.date} className="decision-better-day-item">
                      <div className="decision-better-day-head">
                        <div className="decision-better-day-title">
                          <strong>{formatIsoDateLabel(suggestion.date)}</strong>
                          <span className={`decision-pill ${levelClass}`}>{suggestion.level}</span>
                          {Number.isFinite(Number(suggestion.score)) && <span className="decision-better-day-score">{suggestion.score}%</span>}
                        </div>
                        <button
                          type="button"
                          className="settings-btn decision-better-day-btn"
                          onClick={() => {
                            setForecastDate(suggestion.date);
                            setError(null);
                          }}
                        >
                          Use day
                        </button>
                      </div>
                      <p className="decision-better-day-meta">
                        {localizeUnitText(suggestion.summary)}
                        {suggestion.bestWindowStart ? ` • best window ${formatClockForStyle(suggestion.bestWindowStart, timeStyle)}` : ''}
                        {suggestion.precipChance !== null ? ` • precip ${suggestion.precipChance}%` : ''}
                        {suggestion.gustMph !== null ? ` • gust ${formatWindDisplay(suggestion.gustMph)}` : ''}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="muted-note">{betterDaySuggestionsNote || 'No upcoming alternatives are available in the current forecast range.'}</p>
          )}
        </div>
      )}
      {decision.blockers.length > 0 && (
        <div className="decision-group decision-blockers-inline">
          <h4>
            <XCircle size={14} /> Blockers
          </h4>
          <ul className="signal-list compact">
            {decision.blockers.map((item, idx) => (
              <li key={idx}>{localizeUnitText(item)}</li>
            ))}
          </ul>
        </div>
      )}
      {decision.cautions.length > 0 && (
        <div className="decision-group decision-cautions-inline">
          <h4>
            <AlertTriangle size={14} /> Cautions
          </h4>
          <ul className="signal-list compact">
            {decision.cautions.map((item, idx) => (
              <li key={idx}>{localizeUnitText(item)}</li>
            ))}
          </ul>
        </div>
      )}
      <details className="decision-details">
        <summary>Show all check outcomes</summary>
        <div className="decision-group">
          <h4>
            <CheckCircle2 size={14} /> Check outcomes
          </h4>
          <ul className="signal-list compact">
            {orderedCriticalChecks.map((check, idx) => (
              <li key={`${check.label}-${idx}`}>
                <strong>{check.ok ? '\u2713' : '\u2717'}</strong> {localizeUnitText(check.label)}
                {check.detail ? ` \u2014 ${localizeUnitText(check.detail)}` : ''}
              </li>
            ))}
          </ul>
        </div>
      </details>
    </>
  );
}
