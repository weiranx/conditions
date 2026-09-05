import type { ObjectiveWatch, ObjectiveWatchCheck, ObjectiveWatchPolicy } from '../lib/objective-watches';
import { isObjectiveWatchCheckOverdue } from '../lib/objective-watches';

export const watchHasEnded = (watch: ObjectiveWatch, now = Date.now()) => {
  // Match the server's date expiry, including the latest possible local timezone.
  const end = Date.parse(`${watch.plan.forecastDate}T23:59:59.999Z`);
  return !Number.isFinite(end) || now > end + 14 * 60 * 60 * 1000;
};

export const watchNeedsAttention = (watch: ObjectiveWatch, policy: ObjectiveWatchPolicy | null, now = Date.now()) =>
  !watchHasEnded(watch, now) && (
    watch.consecutiveFailures > 0 || watch.latestCheck?.status === 'failed'
    || watch.latestCheck?.status === 'partial' || (watch.lastChange?.reasons?.length || 0) > 0
    || isObjectiveWatchCheckOverdue(watch, policy, now)
  );

export const watchRefreshWait = (watch: ObjectiveWatch, policy: ObjectiveWatchPolicy | null, now = Date.now()) => {
  const attempted = watch.lastAttemptedAt || watch.lastCheckedAt;
  const timestamp = attempted ? Date.parse(attempted) : NaN;
  return policy && Number.isFinite(timestamp)
    ? Math.max(0, timestamp + policy.manualRefreshCooldownMinutes * 60000 - now)
    : 0;
};

export const watchCheckLabel = (status: ObjectiveWatchCheck['status']) => ({
  changed: 'Risk increased',
  unchanged: 'No risk increase detected',
  partial: 'Incomplete source data',
  failed: 'Check failed',
}[status]);

export const watchCheckDetail = (check: ObjectiveWatchCheck) => {
  if (check.status === 'failed') return 'Conditions could not be retrieved. Previous results may be out of date.';
  if (check.status === 'partial') return 'Some source data is missing. No change alert was generated.';
  return check.change?.reasons?.map((reason) => reason.label).filter(Boolean).join(' · ')
    || 'No meaningful risk increase was detected in this check.';
};
