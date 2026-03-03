import { AlertTriangle, Clock, XCircle, List, Sparkles, Loader2 } from 'lucide-react';

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
  aiNarrative?: string | null;
  aiLoading?: boolean;
  aiError?: string | null;
  onRequestAiBrief?: () => void;
}

export function FieldBriefCard({
  fieldBriefPrimaryReason,
  fieldBriefAtAGlance,
  fieldBriefExecutionSteps,
  fieldBriefTopRisks,
  fieldBriefImmediateActions,
  fieldBriefAbortTriggers,
  fieldBriefActions,
  localizeUnitText,
  aiNarrative,
  aiLoading,
  aiError,
  onRequestAiBrief,
}: FieldBriefCardProps) {
  // Merge top risks + immediate actions, dedup, cap at 4
  const seen = new Set<string>();
  const combinedActions = [...fieldBriefTopRisks, ...fieldBriefImmediateActions].filter((item) => {
    const key = item.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);

  const displayActions = combinedActions.length > 0
    ? combinedActions
    : fieldBriefActions.slice(0, 4);

  // Strip verbose "Step N - Label: " prefixes from execution steps
  const cleanSteps = fieldBriefExecutionSteps.map((s) =>
    s.replace(/^step\s+\d+\s*[-–]\s*[^:]+:\s*/i, '')
  ).slice(0, 3);

  return (
    <>
      {onRequestAiBrief && (
        <div className="field-brief-ai">
          {aiNarrative ? (
            <p className="field-brief-ai-narrative"><Sparkles size={12} /> {aiNarrative}</p>
          ) : aiError ? (
            <div className="field-brief-ai-error">
              <span>{aiError}</span>
              <button type="button" className="btn-ai-brief" onClick={onRequestAiBrief}>Retry</button>
            </div>
          ) : (
            <button
              type="button"
              className="btn-ai-brief"
              onClick={onRequestAiBrief}
              disabled={aiLoading}
            >
              {aiLoading ? (
                <><Loader2 size={12} className="spinner" /> Generating...</>
              ) : (
                <><Sparkles size={12} /> Generate AI Brief</>
              )}
            </button>
          )}
        </div>
      )}

      <div className="field-brief-primary">
        <p className="field-brief-primary-text">{fieldBriefPrimaryReason}</p>
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
          <h4><Clock size={12} /> Steps</h4>
          <ol className="field-brief-steps">
            {(cleanSteps.length > 0
              ? cleanSteps
              : ['Re-check conditions before departure.']
            ).map((item, idx) => (
              <li key={idx}>{localizeUnitText(item)}</li>
            ))}
          </ol>
        </div>

        <div className="field-brief-group">
          <h4><AlertTriangle size={12} /> Watchouts &amp; Actions</h4>
          <ul className="signal-list compact">
            {displayActions.map((item, idx) => (
              <li key={idx}>{localizeUnitText(item)}</li>
            ))}
          </ul>
        </div>
      </div>

      {fieldBriefAbortTriggers.length > 0 && (
        <div className="field-brief-group field-brief-abort">
          <h4><XCircle size={12} /> Abort Triggers</h4>
          <ul className="signal-list compact">
            {fieldBriefAbortTriggers.slice(0, 3).map((item, idx) => (
              <li key={idx}>{localizeUnitText(item)}</li>
            ))}
          </ul>
        </div>
      )}

      <details className="field-brief-details">
        <summary><List size={12} /> Full action list</summary>
        <ul className="signal-list compact">
          {fieldBriefActions.map((item, idx) => (
            <li key={idx}>{localizeUnitText(item)}</li>
          ))}
        </ul>
      </details>
    </>
  );
}
