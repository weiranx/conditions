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
        : 'Conditions are within your limits. Check official sources and reassess at your planned checkpoints.'
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
      return /no avalanche forecast covers|coverage unavailable/i.test(String(check.detail || ''))
        ? 'No avalanche bulletin covers this objective and time'
        : 'Avalanche danger exceeds Moderate';
    case 'convective-signal':
      return 'Forecast mentions thunderstorms';
    case 'precipitation':
      return 'Precipitation chance is above your limit';
    case 'wind-gust':
      return 'Wind gusts are above your limit';
    case 'daylight':
      return 'Plan leaves less than 30 minutes of daylight margin';
    case 'feels-like':
      return 'Feels-like temperature is below your limit';
    case 'nws-alerts':
      return 'An active NWS alert overlaps your travel window';
    case 'air-quality':
      return 'Air quality is worse than AQI 100';
    case 'fire-risk':
      return 'Fire risk is High or above';
    case 'heat-risk':
      return 'Heat risk is High or above';
    case 'terrain-signal':
      return 'Trail surface assessment is unavailable';
    case 'source-freshness':
      return 'Some core sources are out of date';
    default:
      return check.label;
  }
}
