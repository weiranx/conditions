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
  const { insufficient, tone, reason, bridge, warnings, missing } = verdictCopy({ data, decision, primaryReason, preferences });
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
      </div>
      <div className="field-verdict-aside">
        <span className="field-kicker">Evidence quality</span>
        <strong className={data.safety.evidenceQuality ? undefined : 'is-unassessed'}>{data.safety.evidenceQuality || 'Not assessed'}</strong>
        {data.safety.coverage && <span>{data.safety.coverage.completeHours} of {data.safety.coverage.requestedHours} hours covered</span>}
        <button onClick={onSources}>Checks &amp; sources<ArrowRight size={14} /></button>
      </div>
      {(freshnessWarning || warnings.length > 0 || missing.length > 0) && (
        <div className="report-verdict-warnings" aria-label="Warnings and evidence gaps">
          {freshnessWarning && <p className="report-verdict-freshness"><TriangleAlert size={17} aria-hidden="true" /><span><strong>Source freshness needs review.</strong> {freshnessWarning}</span></p>}
          {warnings.length > 0 && <>
            <h3>Reported field warnings</h3>
            <ul>{warnings.map((signal) => <li key={signal.key}><strong>{signal.title}</strong><span>{signal.detail}</span></li>)}</ul>
            <p>Check observation times and route relevance. Nearby reports may not describe your exact route.</p>
          </>}
          {missing.length > 0 && <p>{missing.map((signal) => signal.title).join(' · ')}. Missing feeds cannot confirm clear conditions.</p>}
        </div>
      )}

    </section>
  );
}
