import type { ObjectiveWatch, ObjectiveWatchChange, ObjectiveWatchCheck, ObjectiveWatchPolicy } from '../lib/objective-watches';
import {
  isObjectiveWatchCheckOverdue,
  objectiveWatchChangeDirection,
  objectiveWatchReasonDirection,
} from '../lib/objective-watches';

export const planDateHasEnded = (forecastDate: string, now = Date.now()) => {
  // Match the server's date expiry, including the latest possible local timezone.
  const end = Date.parse(`${forecastDate}T23:59:59.999Z`);
  return !Number.isFinite(end) || now > end + 14 * 60 * 60 * 1000;
};

export const watchHasEnded = (watch: ObjectiveWatch, now = Date.now()) => planDateHasEnded(watch.plan.forecastDate, now);

/** "in 3 hours", "in 20 minutes"; "soon" once the time has arrived. */
export const untilLabel = (iso: string | null | undefined, now = Date.now()) => {
  const time = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(time)) return '';
  const minutes = Math.ceil((time - now) / 60000);
  if (minutes <= 1) return 'soon';
  if (minutes < 60) return `in ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.round(hours / 24);
  return `in ${days} ${days === 1 ? 'day' : 'days'}`;
};

/** How the latest check's score compares with the report the watch started from. */
export const watchScoreTrend = (watch: ObjectiveWatch) => {
  const now = watch.latestCheck?.summary?.score;
  const baseline = watch.baselineReport?.safetyData.safety;
  if (typeof now !== 'number' || !baseline || baseline.assessmentStatus === 'insufficient_evidence'
    || typeof baseline.score !== 'number') return null;
  const delta = Math.round(now) - Math.round(baseline.score);
  return { delta, baseline: Math.round(baseline.score) };
};

/** Watches with a recorded change the account holder has not reviewed. */
export const watchesToReview = (watches: ObjectiveWatch[], now = Date.now()) =>
  watches.filter((watch) => !watchHasEnded(watch, now) && (watch.unreviewedChanges?.count || 0) > 0);

/** A risk increase was recorded that the account holder has not marked reviewed. */
export const watchHasUnreviewedRisk = (watch: ObjectiveWatch) => {
  if (watch.unreviewedChanges) return watch.unreviewedChanges.worsened;
  const direction = objectiveWatchChangeDirection(watch.lastChange);
  return direction === 'worse' || direction === 'mixed';
};

export const watchNeedsAttention = (watch: ObjectiveWatch, policy: ObjectiveWatchPolicy | null, now = Date.now()) =>
  !watchHasEnded(watch, now) && (
    watch.consecutiveFailures > 0 || watch.latestCheck?.status === 'failed'
    || watch.latestCheck?.status === 'partial' || watchHasUnreviewedRisk(watch)
    || isObjectiveWatchCheckOverdue(watch, policy, now)
  );

export const watchRefreshWait = (watch: ObjectiveWatch, policy: ObjectiveWatchPolicy | null, now = Date.now()) => {
  const attempted = watch.lastAttemptedAt || watch.lastCheckedAt;
  const timestamp = attempted ? Date.parse(attempted) : NaN;
  return policy && Number.isFinite(timestamp)
    ? Math.max(0, timestamp + policy.manualRefreshCooldownMinutes * 60000 - now)
    : 0;
};

export const watchCheckLabel = (check: Pick<ObjectiveWatchCheck, 'status' | 'change'>) => {
  if (check.status === 'changed') {
    return objectiveWatchChangeDirection(check.change) === 'better' ? 'Conditions improved' : 'Risk increased';
  }
  return {
    unchanged: 'No meaningful change',
    partial: 'Incomplete source data',
    failed: 'Check failed',
  }[check.status];
};

export const watchCheckDetail = (check: Pick<ObjectiveWatchCheck, 'status'>) => {
  if (check.status === 'failed') return 'Conditions could not be retrieved. Previous results may be out of date.';
  if (check.status === 'partial') return 'Some source data is missing. No change alert was generated.';
  return 'Nothing meaningful changed since the last reported conditions.';
};

/** What a change reported, risk increases first. */
export const watchChangeReasons = (change: ObjectiveWatchChange | null | undefined) => {
  const reasons = (change?.reasons || [])
    .filter((reason) => typeof reason.label === 'string' && reason.label.trim())
    .map((reason) => ({ key: reason.key || '', label: reason.label!.trim(), direction: objectiveWatchReasonDirection(reason) }));
  return [...reasons.filter((reason) => reason.direction === 'worse'), ...reasons.filter((reason) => reason.direction === 'better')];
};

// Older labels put the unit on the second reading only ("from 20 to 40 mph").
export const watchReasonText = (label: string, localize: (text: string) => string) =>
  localize(label.replace(/\bfrom (\d+(?:\.\d+)?) to (\d+(?:\.\d+)?) mph\b/g, 'from $1 mph to $2 mph'));
