import { reportInsightItems } from "../app/report-insights";
import type { SafetyData, SummitDecision, UserPreferences } from "../app/types";
import { resolveReportFeatureFlags } from "../contexts/feature-flags";
import { fieldSignals } from "./field-signals";

export type VerdictTone = "go" | "watch" | "stop";

/** The lead sentence of a check message, without its closing period. */
export function checkSummary(message: string): string {
  const text = message.trim();
  const lead = text.match(/^.*?[.!?](?=\s+[A-Z(]|$)/)?.[0] ?? text;
  return lead.replace(/\.$/, "");
}

/** Shared wording for the trip decision, used by the verdict and the Brief's sky. */
export function verdictCopy({ data, decision, primaryReason, preferences }: {
  data: SafetyData;
  decision: SummitDecision;
  primaryReason: string;
  preferences: UserPreferences;
}) {
  const insufficient = data.safety.assessmentStatus === "insufficient_evidence";
  const tone: VerdictTone = decision.level === "GO" ? "go" : decision.level === "NO-GO" ? "stop" : "watch";
  const flags = resolveReportFeatureFlags(data.featureFlags);
  const insights = reportInsightItems(data);
  const insightIds = new Set(insights.map((item) => item.id));
  const covered: Record<string, string> = { roads: "access", closures: "access", lightning: "lightning", radar: "radar", water: "water", smoke: "air-outlook", fire: "fire-access", detections: "fire-access" };
  const signals = flags.fieldObservations ? fieldSignals(data.localConditions, preferences).filter((signal) =>
    !insightIds.has(covered[signal.key]) && !(signal.tone === "unavailable" && insightIds.has("evidence-gaps"))) : [];
  const attention = signals.filter((signal) => signal.tone === "attention");
  // Put an observation at the objective before nearby access/area reports.
  const warnings = [...attention.filter((signal) => signal.key === "lightning"), ...attention.filter((signal) => signal.key !== "lightning")];
  const missing = signals.filter((signal) => signal.tone === "unavailable");
  const review = insights.find((item) => item.decisionRelevant);
  // The score rates conditions overall, while the decision is set by the most
  // limiting check. Explain when the score looks better than the decision
  // (Low-risk score under Caution, or Caution-or-better score under No-go).
  const score = Number(data.safety.score);
  const scoreOutranksDecision = !insufficient && Number.isFinite(score)
    && ((decision.level === "CAUTION" && score >= 85) || (decision.level === "NO-GO" && score >= 70));
  const limiting = decision.level === "NO-GO" ? decision.blockers.length : decision.cautions.length;
  const limitingLabel = decision.level === "NO-GO"
    ? (limiting > 1 ? `${limiting} blocking checks` : "a blocking check")
    : (limiting > 1 ? `${limiting} checks that need attention` : "a check that needs attention");
  const bridge = scoreOutranksDecision
    ? `The score of ${Number(score.toFixed(1))} rates conditions overall. The decision is set by ${limitingLabel}.`
    : "";
  const reason = decision.blockers[0] || (review ? `${review.title}. ${review.action}` : "") || primaryReason || decision.cautions[0] || "Nothing in the available forecast crosses your limits. Keep reassessing once you are in the field.";
  // Name the limiting checks when the count alone would leave them unclear;
  // a lone check the reason already states needs no list.
  const limitingSummaries = decision.level === "GO" ? [] : (decision.level === "NO-GO" ? decision.blockers : decision.cautions).map(checkSummary).filter(Boolean);
  // Leave out the check the reason already states so it isn't read twice.
  const unstated = limitingSummaries.filter((summary) => !reason.startsWith(summary));
  const limitingChecks = limitingSummaries.length > 1 || (bridge && unstated.length === 1) ? unstated : [];
  const scoreValue = !insufficient && Number.isFinite(data.safety.score) ? Number(data.safety.score.toFixed(1)) : null;
  return { insufficient, tone, reason, bridge, limitingChecks, warnings, missing, scoreValue };
}
