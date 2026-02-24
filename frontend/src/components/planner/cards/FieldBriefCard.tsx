import { ShieldCheck } from 'lucide-react';
import { HelpHint } from '../CardHelpHint';

interface FieldBriefItem {
  label: string;
  value: string;
}

interface FieldBriefCardProps {
  order: number;
  decisionLevelClass: string;
  decisionLevelLabel: string;
  fieldBriefHeadline: string;
  fieldBriefPrimaryReason: string;
  decisionActionLine: string;
  fieldBriefAtAGlance: FieldBriefItem[];
  fieldBriefExecutionSteps: string[];
  fieldBriefTopRisks: string[];
  fieldBriefImmediateActions: string[];
  fieldBriefSnapshot: string[];
  fieldBriefAbortTriggers: string[];
  fieldBriefActions: string[];
  localizeUnitText: (value: string) => string;
}

export function FieldBriefCard({
  order,
  decisionLevelClass,
  decisionLevelLabel,
  fieldBriefHeadline,
  fieldBriefPrimaryReason,
  decisionActionLine,
  fieldBriefAtAGlance,
  fieldBriefExecutionSteps,
  fieldBriefTopRisks,
  fieldBriefImmediateActions,
  fieldBriefSnapshot,
  fieldBriefAbortTriggers,
  fieldBriefActions,
  localizeUnitText,
}: FieldBriefCardProps) {
  return (
    <div className="ai-box field-brief-card" style={{ order }}>
      <div className="card-header">
        <span className="card-title">
          <ShieldCheck size={14} /> Field Brief
          <HelpHint text="Action-first field brief with primary call, top risks, immediate actions, and optional details." />
        </span>
        <span className={`decision-pill ${decisionLevelClass}`}>{decisionLevelLabel}</span>
      </div>
      <p className="field-brief-headline">{fieldBriefHeadline}</p>

      <div className="field-brief-primary">
        <span className="field-brief-primary-label">Command intent</span>
        <p className="field-brief-primary-text">{fieldBriefPrimaryReason}</p>
        <p className="field-brief-primary-action">{decisionActionLine}</p>
      </div>

      <div className="field-brief-glance-grid" role="list" aria-label="Field brief at a glance">
        {fieldBriefAtAGlance.map((item) => (
          <article key={item.label} className="field-brief-glance-item" role="listitem">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </article>
        ))}
      </div>

      <div className="field-brief-split">
        <div className="field-brief-group">
          <h4>Execution Plan (Time + Route)</h4>
          <ol className="field-brief-steps">
            {(fieldBriefExecutionSteps.length > 0
              ? fieldBriefExecutionSteps
              : ['Re-check conditions at departure and continue only if field observations match forecast assumptions.']
            ).map((item, idx) => (
              <li key={idx}>{localizeUnitText(item)}</li>
            ))}
          </ol>
        </div>

        <div className="field-brief-group">
          <h4>Top Watchouts</h4>
          <ul className="signal-list compact">
            {(fieldBriefTopRisks.length > 0 ? fieldBriefTopRisks : ['No dominant risk trigger detected from current model signals.']).map((item, idx) => (
              <li key={idx}>{localizeUnitText(item)}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="field-brief-group">
        <h4>Immediate Actions (Before Commit)</h4>
        <ul className="signal-list compact">
          {(fieldBriefImmediateActions.length > 0 ? fieldBriefImmediateActions : fieldBriefActions).map((item, idx) => (
            <li key={idx}>{localizeUnitText(item)}</li>
          ))}
        </ul>
      </div>

      <details className="field-brief-details">
        <summary>Show full snapshot, abort triggers, and all actions</summary>
        <div className="field-brief-group">
          <h4>Situation Snapshot</h4>
          <ul className="signal-list compact">
            {fieldBriefSnapshot.map((item, idx) => (
              <li key={idx}>{localizeUnitText(item)}</li>
            ))}
          </ul>
        </div>
        <div className="field-brief-group">
          <h4>Abort Triggers</h4>
          <ul className="signal-list compact">
            {fieldBriefAbortTriggers.map((item, idx) => (
              <li key={idx}>{localizeUnitText(item)}</li>
            ))}
          </ul>
        </div>
        <div className="field-brief-group">
          <h4>Full Action List</h4>
          <ul className="signal-list compact">
            {fieldBriefActions.map((item, idx) => (
              <li key={idx}>{localizeUnitText(item)}</li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}
