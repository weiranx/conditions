// Backend plan evaluations for UI tests. The frontend only presents these, so
// tests render screens from what the backend would send for a report and plan.
import planEvaluation from "../../backend/src/utils/plan-evaluation.js";
import planContext from "../../backend/src/utils/plan-context.js";
import reportInterpretation from "../../backend/src/utils/report-interpretation.js";
import { readPlanEvaluation } from "../src/app/plan-evaluation";

/** Plan params for a report, as the planner sends them. */
export function planParams(report, params = {}) {
  return {
    date: report?.forecast?.selectedDate || "",
    start: report?.forecast?.requestedStartTime || "07:00",
    travel_window_hours: String(report?.weather?.trend?.length || 12),
    approach: "off",
    ...params,
  };
}

/** The evaluation the backend would attach, as the frontend reads it (missing readings as NaN). */
export function evaluate(report, params = {}) {
  const wire = JSON.parse(JSON.stringify(planEvaluation.evaluatePlan(report, planContext.buildPlanContext(planParams(report, params), report))));
  return readPlanEvaluation(wire);
}

/** The report with its evaluation attached, as /api/safety returns it. */
export function withEvaluation(report, params = {}) {
  return JSON.parse(JSON.stringify(planEvaluation.attachPlanEvaluation(report, planParams(report, params))));
}

/** What the backend makes of a report's sources for a plan, as the screens receive it. */
export function interpret(report, params = {}) {
  const context = planContext.buildPlanContext(planParams(report, params), report);
  return JSON.parse(JSON.stringify(reportInterpretation.buildReportInterpretation(report, context)));
}
