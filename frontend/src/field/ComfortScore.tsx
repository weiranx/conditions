import { Smile } from "lucide-react";
import type { SafetyData } from "../app/types";
import { APPROACH_SOURCE_LABEL } from "./sky/sky-model";
import { ConditionScale } from "./ConditionCharts";
import "./comfort-score.css";

/** Mirrors the backend comfort labels (pleasantness-score.js). */
const COMFORT_BANDS = [
  { from: 0, label: "Harsh" },
  { from: 40, label: "Uncomfortable" },
  { from: 60, label: "Mixed" },
  { from: 75, label: "Pleasant" },
  { from: 90, label: "Excellent" },
];

const validScore = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

export function ComfortScore({ comfort, localize = (text) => text, elevation = (ft) => `${ft} ft` }: {
  comfort: NonNullable<SafetyData["pleasantness"]>;
  localize?: (text: string) => string;
  elevation?: (ft: number) => string;
}) {
  const scoredApproach = comfort.approach;
  const score = validScore(comfort.score) ? comfort.score : null;
  const factors = (comfort.factors || []).filter((factor) => validScore(factor.score));
  const coverage = comfort.coverage;
  const reasons = comfort.confidenceReasons || [];
  const adjustments = comfort.adjustments || [];
  return (
    <section className="sky-card sky-exposure condition-card is-comfort comfort-score" aria-label="Weather comfort">
      <span className="sky-card-head"><span className="sky-exposure-title"><Smile size={16} aria-hidden="true" />Weather comfort</span></span>
      <span className="sky-big">{score === null ? "Unknown" : comfort.label}</span>
      <ConditionScale label="Weather comfort score" value={score} maximum={100} format={(value) => `${Math.round(value)}/100`} bands={COMFORT_BANDS} />
      <p className="comfort-outlook sky-cap is-body">{localize(comfort.summary || "A weather-comfort outlook for this outing.")}</p>
      {scoredApproach && scoredApproach.adjustedHours > 0 && (
        <p className="sky-cap comfort-approach">
          {scoredApproach.adjustedHours} h scored at your estimated elevation on the approach, from{" "}
          {elevation(Math.round(scoredApproach.trailheadElevationFt / 100) * 100)} ({APPROACH_SOURCE_LABEL[scoredApproach.source]})
          {scoredApproach.inversionHours > 0 ? `; ${scoredApproach.inversionHours} h scored colder for a likely valley inversion` : ""}.
        </p>
      )}
      <div className="comfort-evidence">
        <div><strong>Evidence coverage</strong><span>{coverage ? `${coverage.completeHours}/${coverage.requestedHours} hours` : "Unknown"}</span></div>
        <p>{coverage
          ? `${coverage.completeHours} of ${coverage.requestedHours} planned hours have temperature, wind, and precipitation readings.`
          : "Hourly coverage was not recorded in this saved report."}</p>
        <small>Coverage describes available readings, not a probability of accurate forecasts or a safe trip.</small>
        {reasons.length > 0 && <details className="field-detail-disclosure">
          <summary>Missing forecast evidence</summary>
          <ul>{reasons.map((reason, index) => <li key={index}>{localize(reason)}</li>)}</ul>
        </details>}
      </div>
      <details className="field-detail-disclosure comfort-breakdown sky-evidence-details">
        <summary>What shapes this score</summary>
        {factors.length > 0 ? <ul className="comfort-factor-list">
          {factors.map((factor, index) => <li key={`${factor.factor}-${index}`}>
            <div><strong>{factor.factor}</strong><span>{Math.round(factor.score)}/100</span></div>
            <div className="comfort-factor-track" aria-hidden="true"><span style={{ width: `${factor.score}%` }} /></div>
            <p>{localize(factor.message)}</p>
          </li>)}
        </ul> : <p>No individual comfort factors were supplied.</p>}
        <p>Higher factor scores mean more comfortable conditions. The average across the outing gets 80% of each weather factor; its roughest forecast period gets 20%. Factor weights combine these into an overall estimate.</p>
        {validScore(comfort.weightedScore) && score !== null && comfort.weightedScore > score && (
          <p><strong>Why the final score is lower:</strong> The weighted estimate is {comfort.weightedScore}/100; the final rating is {score}/100.</p>
        )}
        {adjustments.length > 0 && <ul>{adjustments.map((adjustment, index) => <li key={index}>{localize(adjustment.reason)}</li>)}</ul>}
        {comfort.scoreVersion && <small>Comfort model {comfort.scoreVersion} · Saved reports retain their original assessment.</small>}
      </details>
      <p className="sky-cap comfort-disclaimer">{comfort.disclaimer || "Weather comfort only; this score does not change the safety score or go/no-go decision."}</p>
    </section>
  );
}
