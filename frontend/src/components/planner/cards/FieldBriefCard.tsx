import { AlertTriangle, Clock, ShieldCheck, XCircle, List } from 'lucide-react';

interface FieldBriefItem {
  label: string;
  value: string;
}

interface FieldBriefCardProps {
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
    <>
      <p className="field-brief-headline">{fieldBriefHeadline}</p>

      <div className="field-brief-primary">
        <span className="field-brief-primary-label">Mission summary</span>
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
          <h4><Clock size={12} /> Execution Plan</h4>
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
          <h4><AlertTriangle size={12} /> Top Watchouts</h4>
          <ul className="signal-list compact">
            {(fieldBriefTopRisks.length > 0 ? fieldBriefTopRisks : ['No dominant risk trigger detected from current model signals.']).map((item, idx) => (
              <li key={idx}>{localizeUnitText(item)}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="field-brief-group">
        <h4><ShieldCheck size={12} /> Immediate Actions</h4>
        <ul className="signal-list compact">
          {(fieldBriefImmediateActions.length > 0 ? fieldBriefImmediateActions : fieldBriefActions).map((item, idx) => (
            <li key={idx}>{localizeUnitText(item)}</li>
          ))}
        </ul>
      </div>

      {fieldBriefAbortTriggers.length > 0 && (
        <div className="field-brief-group field-brief-abort">
          <h4><XCircle size={12} /> Abort Triggers</h4>
          <ul className="signal-list compact">
            {fieldBriefAbortTriggers.map((item, idx) => (
              <li key={idx}>{localizeUnitText(item)}</li>
            ))}
          </ul>
        </div>
      )}

      <details className="field-brief-details">
        <summary><List size={12} /> Show situation snapshot and full action list</summary>
        <div className="field-brief-group">
          <h4>Situation Snapshot</h4>
          <ul className="signal-list compact">
            {fieldBriefSnapshot.map((item, idx) => (
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
    </>
  );
}
