import { ArrowRight, TriangleAlert } from 'lucide-react';
import type { SafetyData, SummitDecision, UserPreferences } from '../app/types';
import { verdictCopy } from './verdict-copy';

export function ReportVerdict({ data, decision, primaryReason, freshnessWarning, preferences, onSources }: {
  data: SafetyData;
  decision: SummitDecision;
  primaryReason: string;
  freshnessWarning: string | null;
  preferences: UserPreferences;
  onSources: () => void;
}) {
  const { insufficient, tone, reason, bridge, limitingChecks, warnings, missing } = verdictCopy({ data, decision, primaryReason, preferences });
  return (
    <section className={`field-verdict is-${tone}`} aria-labelledby="field-verdict-title">
      <div className="field-verdict-number">
        <span className="field-kicker">Safety score</span>
        <strong>{!insufficient && Number.isFinite(data.safety.score) ? Number(data.safety.score.toFixed(1)) : '—'}<small>/100</small></strong>
        <span>{insufficient ? 'Insufficient evidence' : data.safety.tier || 'Forecast assessment'}</span>
      </div>
      <div className="field-verdict-story">
        <span className="report-decision-label">Trip decision</span><span className={`field-badge is-${tone}`}>{decision.level}</span>
        <h2 id="field-verdict-title">{decision.headline}</h2>
        <p className="report-decision-reason">{reason}</p>
        {bridge && <p className="report-decision-bridge">{bridge}</p>}
        {limitingChecks.length > 0 && <ul className="report-decision-limiting" aria-label="Checks setting the decision">{limitingChecks.map((check) => <li key={check}>{check}</li>)}</ul>}
      </div>
      <div className="field-verdict-aside">
        <span className="field-kicker">Evidence quality</span>
        <strong className={data.safety.evidenceQuality ? undefined : 'is-unassessed'}>{data.safety.evidenceQuality || 'Not assessed'}</strong>
        {data.safety.coverage && <span>{data.safety.coverage.completeHours} of {data.safety.coverage.requestedHours} hours covered</span>}
        <button onClick={onSources}>Checks &amp; sources<ArrowRight size={14} /></button>
      </div>
      {(freshnessWarning || warnings.length > 0 || missing.length > 0) && (
        <div className="report-verdict-warnings" aria-label="Warnings and evidence gaps">
          {freshnessWarning && <p className="report-verdict-freshness"><TriangleAlert size={17} aria-hidden="true" /><span><strong>Some sources may be out of date.</strong> {freshnessWarning}</span></p>}
          {warnings.length > 0 && <>
            <h3>Field reports to check</h3>
            <ul>{warnings.map((signal) => <li key={signal.key}><strong>{signal.title}</strong><span>{signal.detail}</span></li>)}</ul>
            <p>Check when each report was made and whether it applies to your route. Nearby reports may not match conditions on it.</p>
          </>}
          {missing.length > 0 && <p>{missing.map((signal) => signal.title).join(' · ')}. Missing data does not mean conditions are clear.</p>}
        </div>
      )}

    </section>
  );
}
