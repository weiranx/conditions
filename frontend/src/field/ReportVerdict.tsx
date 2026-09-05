import { ArrowRight, TriangleAlert } from 'lucide-react';
import type { SafetyData, SummitDecision, UserPreferences } from '../app/types';
import { resolveReportFeatureFlags } from '../contexts/feature-flags';
import { fieldSignals } from './field-signals';

export function ReportVerdict({ data, decision, primaryReason, freshnessWarning, preferences, onSources }: {
  data: SafetyData;
  decision: SummitDecision;
  primaryReason: string;
  freshnessWarning: string | null;
  preferences: UserPreferences;
  onSources: () => void;
}) {
  const tone = decision.level === 'GO' ? 'go' : decision.level === 'NO-GO' ? 'stop' : 'watch';
  const flags = resolveReportFeatureFlags(data.featureFlags);
  const signals = flags.fieldObservations ? fieldSignals(data.localConditions, preferences) : [];
  const attention = signals.filter((signal) => signal.tone === 'attention');
  // Put an observation at the objective before nearby access/area reports.
  const warnings = [...attention.filter((signal) => signal.key === 'lightning'), ...attention.filter((signal) => signal.key !== 'lightning')];
  const missing = signals.filter((signal) => signal.tone === 'unavailable');
  const reason = primaryReason || decision.blockers[0] || decision.cautions[0] || 'No critical threshold failures in the available forecast. Reassess conditions in the field.';
  return (
    <section className={`field-verdict is-${tone}`} aria-labelledby="field-verdict-title">
      <div className="field-verdict-number">
        <span className="field-kicker">Safety score</span>
        <strong>{Number.isFinite(data.safety.score) ? Math.round(data.safety.score) : '—'}<small>/100</small></strong>
        <span>{data.safety.tier || 'Forecast assessment'}</span>
      </div>
      <div className="field-verdict-story">
        <span className={`field-badge is-${tone}`}>{decision.level}</span>
        <h2 id="field-verdict-title">{decision.headline}</h2>
        <p className="report-decision-reason">{reason}</p>
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
      <div className="field-verdict-aside">
        <span className="field-kicker">Evidence confidence</span>
        <strong>{Number.isFinite(data.safety.confidence) ? `${Math.round(data.safety.confidence!)}%` : 'Unknown'}</strong>
        <button onClick={onSources}>Checks &amp; sources<ArrowRight size={14} /></button>
      </div>
    </section>
  );
}
