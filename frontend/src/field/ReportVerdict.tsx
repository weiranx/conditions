import { reportInsightItems } from '../app/report-insights';
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
  const insufficient = data.safety.assessmentStatus === 'insufficient_evidence';
  const tone = decision.level === 'GO' ? 'go' : decision.level === 'NO-GO' ? 'stop' : 'watch';
  const flags = resolveReportFeatureFlags(data.featureFlags);
  const insightIds = new Set(reportInsightItems(data).map(item => item.id));
  const covered: Record<string, string> = { roads: 'access', closures: 'access', lightning: 'lightning', radar: 'radar', water: 'water', smoke: 'air-outlook', fire: 'fire-access', detections: 'fire-access' };
  const signals = flags.fieldObservations ? fieldSignals(data.localConditions, preferences).filter(signal =>
    !insightIds.has(covered[signal.key]) && !(signal.tone === 'unavailable' && insightIds.has('evidence-gaps'))) : [];
  const attention = signals.filter((signal) => signal.tone === 'attention');
  // Put an observation at the objective before nearby access/area reports.
  const warnings = [...attention.filter((signal) => signal.key === 'lightning'), ...attention.filter((signal) => signal.key !== 'lightning')];
  const missing = signals.filter((signal) => signal.tone === 'unavailable');
  const review = reportInsightItems(data).find(item => item.decisionRelevant);
  // The score rates conditions overall, while the decision is set by the most
  // limiting check. Explain when the score looks better than the decision
  // (Low-risk score under Caution, or Caution-or-better score under No-go).
  const score = Number(data.safety.score);
  const scoreOutranksDecision = !insufficient && Number.isFinite(score)
    && ((decision.level === 'CAUTION' && score >= 85) || (decision.level === 'NO-GO' && score >= 70));
  const limiting = decision.level === 'NO-GO' ? decision.blockers.length : decision.cautions.length;
  const limitingLabel = decision.level === 'NO-GO'
    ? (limiting > 1 ? `${limiting} blocking checks` : 'a blocking check')
    : (limiting > 1 ? `${limiting} checks that need attention` : 'a check that needs attention');
  const bridge = scoreOutranksDecision
    ? `Score ${Number(score.toFixed(1))} rates conditions overall. This decision is set by ${limitingLabel}.`
    : '';
  const reason = decision.blockers[0] || (review ? `${review.title}. ${review.action}` : '') || primaryReason || decision.cautions[0] || 'No critical threshold failures in the available forecast. Reassess conditions in the field.';
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
