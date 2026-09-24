import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlanEvaluation, SafetyData } from '../app/types';
import { planParamsKey, readPlanEvaluation } from '../app/plan-evaluation';
import { fetchPlanEvaluation } from '../lib/api-client';

const REEVALUATE_DELAY_MS = 250;
// Source freshness and the decision are judged as of the evaluation; a report
// restored or reopened later is judged again, as of now.
const EVALUATION_MAX_AGE_MS = 15 * 60 * 1000;

export interface PlanEvaluationState {
  /** The evaluation for the current plan, or the report's own while a new one loads. */
  evaluation: PlanEvaluation | null;
  /** True while the shown evaluation is for a different plan than the current one. */
  pending: boolean;
  error: string | null;
  /** Ask again after a failed evaluation. */
  retry: () => void;
}

/**
 * The backend's evaluation of a report for the current plan. A report arrives
 * evaluated for the plan it was requested with; when the plan changes after
 * that (limits, units, approach), a saved report is opened under other
 * settings, or the evaluation is older than this session, the report is
 * re-evaluated by /api/evaluate.
 */
export function usePlanEvaluation(report: SafetyData | null, params: Record<string, string>): PlanEvaluationState {
  const key = planParamsKey(params);
  const own = useMemo(() => readPlanEvaluation(report?.evaluation), [report]);
  // Measured once, so a report fetched in this session keeps its own evaluation.
  const [openedAt] = useState(() => Date.now());
  const ownCurrent = Boolean(own && openedAt - Date.parse(own.evaluatedAt) <= EVALUATION_MAX_AGE_MS);
  const ownMatches = Boolean(own && ownCurrent && planParamsKey(own.params) === key);
  const [fetched, setFetched] = useState<{ report: SafetyData; key: string; evaluation: PlanEvaluation | null; error: string | null } | null>(null);
  const current = fetched && fetched.report === report && fetched.key === key ? fetched : null;
  // Keep showing the last evaluation of this report while the next one loads.
  const [shown, setShown] = useState<{ report: SafetyData; evaluation: PlanEvaluation } | null>(null);

  useEffect(() => {
    if (!report || ownMatches || current) return;
    const controller = new AbortController();
    const plan = Object.fromEntries(JSON.parse(key) as Array<[string, string]>);
    const timer = setTimeout(() => {
      fetchPlanEvaluation(report, plan, controller.signal)
        .then((value) => {
          const evaluation = readPlanEvaluation(value);
          setFetched({ report, key, evaluation, error: evaluation ? null : 'The plan could not be evaluated.' });
          if (evaluation) setShown({ report, evaluation });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setFetched({ report, key, evaluation: null, error: error instanceof Error ? error.message : 'The plan could not be evaluated.' });
        });
    }, REEVALUATE_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [report, key, ownMatches, current]);

  const retry = useCallback(() => setFetched(null), []);
  if (!report) return { evaluation: null, pending: false, error: null, retry };
  if (ownMatches) return { evaluation: own, pending: false, error: null, retry };
  if (current?.evaluation) return { evaluation: current.evaluation, pending: false, error: null, retry };
  const fallback = (shown?.report === report ? shown.evaluation : null) ?? own;
  return { evaluation: fallback, pending: !current, error: current?.error ?? null, retry };
}
