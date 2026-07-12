import type { SummitDecision } from './types';

export interface DecisionDisplayState {
  failedCriticalChecks: SummitDecision['checks'];
  passedCriticalChecks: SummitDecision['checks'];
  orderedCriticalChecks: SummitDecision['checks'];
  topCriticalAttentionChecks: SummitDecision['checks'];
  criticalCheckFailCount: number;
  criticalCheckTotal: number;
  fieldBriefPrimaryReason: string;
  fieldBriefTopRisks: string[];
  decisionFailingChecks: SummitDecision['checks'];
  decisionPassingChecksCount: number;
  decisionActionLine: string;
  decisionKeyDrivers: string[];
}

export function buildDecisionDisplayState(decision: SummitDecision | null): DecisionDisplayState {
  const failedCriticalChecks = decision ? decision.checks.filter((check) => !check.ok) : [];
  const passedCriticalChecks = decision ? decision.checks.filter((check) => check.ok) : [];
  const orderedCriticalChecks = [...failedCriticalChecks, ...passedCriticalChecks];
  const topCriticalAttentionChecks = failedCriticalChecks.slice(0, 3);
  const criticalCheckFailCount = failedCriticalChecks.length;
  const criticalCheckTotal = orderedCriticalChecks.length;

  const fieldBriefPrimaryReason = decision
    ? decision.level === 'NO-GO'
      ? decision.blockers[0] || 'A no-go threshold is tripped. Change the objective, timing, or day before committing.'
      : decision.level === 'CAUTION'
        ? decision.cautions[0] || 'Adjust terrain, timing, or pace, and define a clear turnaround trigger before committing.'
        : 'No current threshold is tripped. Verify official sources and reassess conditions at planned checkpoints.'
    : '';
  const fieldBriefTopRisks = decision
    ? (decision.blockers.length > 0 ? decision.blockers : decision.cautions).slice(0, 3)
    : [];
  const decisionFailingChecks = decision ? decision.checks.filter((check) => !check.ok) : [];
  const decisionPassingChecksCount = decision ? decision.checks.filter((check) => check.ok).length : 0;
  const decisionActionLine = decision
    ? decision.level === 'NO-GO'
      ? 'Do not commit to this objective window. Change the objective, timing, or day instead of trying to solve the hazard with gear alone.'
      : decision.level === 'CAUTION'
        ? 'Make the listed adjustments before leaving, then reassess at planned checkpoints and turn around when a trigger is met.'
        : 'Keep normal backcountry precautions, verify current official sources, and reassess at planned checkpoints.'
    : '';
  const decisionKeyDrivers = decision
    ? decision.blockers.length > 0
      ? decision.blockers.slice(0, 3)
      : decision.cautions.length > 0
        ? decision.cautions.slice(0, 3)
        : decision.checks
            .filter((check) => check.ok)
            .slice(0, 3)
            .map((check) => check.label)
    : [];

  return {
    failedCriticalChecks,
    passedCriticalChecks,
    orderedCriticalChecks,
    topCriticalAttentionChecks,
    criticalCheckFailCount,
    criticalCheckTotal,
    fieldBriefPrimaryReason,
    fieldBriefTopRisks,
    decisionFailingChecks,
    decisionPassingChecksCount,
    decisionActionLine,
    decisionKeyDrivers,
  };
}

export function describeFailedCriticalCheck(check: SummitDecision['checks'][number]): string {
  switch (check.key) {
    case 'avalanche':
      return /coverage unavailable/i.test(String(check.detail || ''))
        ? 'Avalanche bulletin is unavailable for selected objective/time'
        : 'Avalanche danger exceeds Moderate';
    case 'convective-signal':
      return 'Convective storm signal appears in forecast';
    case 'precipitation':
      return 'Precipitation chance exceeds threshold';
    case 'wind-gust':
      return 'Wind gust exceeds threshold';
    case 'daylight':
      return 'Start time misses the 30-minute daylight buffer';
    case 'feels-like':
      return 'Apparent temperature is below threshold';
    case 'nws-alerts':
      return 'Active NWS alert overlaps selected travel window';
    case 'air-quality':
      return 'Air quality exceeds 100 AQI';
    case 'fire-risk':
      return 'Fire risk is High or above';
    case 'heat-risk':
      return 'Heat risk is High or above';
    case 'terrain-signal':
      return 'Terrain/trail condition signal is unavailable';
    case 'source-freshness':
      return 'Core source freshness has stale or missing feeds';
    default:
      return check.label;
  }
}
