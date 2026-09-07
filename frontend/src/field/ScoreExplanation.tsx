import type { SafetyData } from "../app/types";

const groupLabels: Record<string, string> = {
  avalanche: "Avalanche",
  weather: "Weather & exposure",
  alerts: "Official alerts",
  airQuality: "Air quality",
  fire: "Fire danger",
  terrain: "Terrain",
};
const points = (value: number) => Number(value.toFixed(1)).toString();

export function ScoreExplanation({ safety, localize = (text) => text }: {
  safety: SafetyData["safety"];
  localize?: (text: string) => string;
}) {
  const groups = Object.entries(safety.groupImpacts || {})
    .map(([key, group]) => ({ key, ...group, deduction: group.effective ?? group.capped }))
    .filter((group) => typeof group.deduction === "number" && Number.isFinite(group.deduction) && group.deduction > 0)
    .sort((a, b) => b.deduction! - a.deduction!);
  const reasons = safety.confidenceReasons || [];
  return (
    <section className="field-panel report-score-explanation" aria-labelledby="report-score-heading">
      <header className="report-score-heading">
        <div>
          <span className="field-kicker">Understanding the assessment</span>
          <h2 id="report-score-heading">What drives this score</h2>
          <p>Higher scores mean fewer modeled hazards. Trip checks and field warnings still apply.</p>
        </div>
        <div className="report-score-total" aria-label={`Safety score ${Number.isFinite(safety.score) ? points(safety.score) : 'unavailable'} out of 100`}>
          <strong>{Number.isFinite(safety.score) ? points(safety.score) : "—"}</strong><span>/100</span>
          <small>{safety.tier || "Unrated"}</small>
        </div>
      </header>
      {groups.length > 0 ? (
        <ul className="report-score-groups" aria-label="Effective score deductions">
          {groups.map((group) => (
            <li key={group.key}>
              <div><strong>{groupLabels[group.key] || group.key}</strong><span>−{points(group.deduction!)} pts</span></div>
              <div className="report-deduction-track" aria-hidden="true"><span style={{ width: `${Math.min(100, group.deduction!)}%` }} /></div>
              {typeof group.floor === "number" && group.floor > 0 && group.deduction === group.floor && (
                <p><strong>Hazard safeguard:</strong> {localize(group.floorReason || "A decisive hazard sets a minimum deduction.")}</p>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="field-muted">No group deductions were supplied with this report.</p>}
      <p className="report-score-method">The score starts at 100. Related hazards are combined to limit double counting; severe hazards can enforce a minimum deduction. The result cannot fall below zero.</p>
      <div className="report-confidence-explanation">
        <div><h3>Evidence confidence</h3><strong>{typeof safety.confidence === "number" && Number.isFinite(safety.confidence) ? `${Math.round(safety.confidence)}%` : "Unknown"}</strong></div>
        <p>Describes the quality and coverage of the evidence, not the chance of a safe trip.</p>
        {reasons.length > 0 ? <ul>{reasons.map((reason, i) => <li key={i}>{localize(reason)}</li>)}</ul>
          : <p className="field-muted">No confidence reductions were supplied. Check source timestamps below.</p>}
      </div>
      <details className="field-detail-disclosure">
        <summary>All contributing factors</summary>
        {(safety.factors || []).length > 0 ? <ul className="report-factor-list">
          {safety.factors!.map((factor, i) => <li key={i}>
            <strong>{factor.hazard || "Condition"}</strong>
            <p>{localize(factor.message || "Included in the assessment.")}</p>
            {factor.source && <small>{factor.source}</small>}
          </li>)}
        </ul> : safety.explanations?.length ? <ul className="field-prose-list">
          {safety.explanations.map((explanation, i) => <li key={i}>{localize(explanation)}</li>)}
        </ul> : <p>No individual factor details were supplied.</p>}
      </details>
      {safety.scoreVersion && <p className="report-score-version">Scoring model {safety.scoreVersion} · Saved reports may use earlier rules.</p>}
    </section>
  );
}
