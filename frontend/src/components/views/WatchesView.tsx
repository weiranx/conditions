import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BellRing,
  CalendarDays,
  Clock3,
  History,
  LoaderCircle,
  MailCheck,
  MailPlus,
  MapPinned,
  Pause,
  RefreshCw,
  Timer,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { PersistedReportPlan } from '../../app/report-storage';
import type { AppView } from '../../hooks/useUrlState';
import { useAccount } from '../../hooks/useAccount';
import { useVisibleRevalidation } from '../../hooks/useVisibleRevalidation';
import {
  deleteObjectiveWatch,
  formatObjectiveWatchCadence,
  getObjectiveWatchChecks,
  isObjectiveWatchCheckOverdue,
  listObjectiveWatches,
  refreshObjectiveWatch,
  setObjectiveWatchNotifications,
  type ObjectiveWatch,
  type ObjectiveWatchCheck,
  type ObjectiveWatchPolicy,
} from '../../lib/objective-watches';
import { ProductNav } from './ProductNav';
import '../../styles/watches.css';

interface WatchesViewProps {
  appShellClassName: string;
  isViewPending: boolean;
  navigateToView: (view: AppView) => void;
  openPlannerView: () => void;
  openTripToolView: () => void;
  onOpenWatch: (plan: PersistedReportPlan) => void;
}

const formatTimestamp = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'date unavailable'
    : parsed.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
};

const formatPlanDate = (value: string) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
};

const planHasEnded = (watch: ObjectiveWatch) => {
  const planEnd = new Date(`${watch.plan.forecastDate}T23:59:59.999Z`).getTime();
  return !Number.isFinite(planEnd) || Date.now() > planEnd + 14 * 60 * 60 * 1000;
};

const effectiveWatchIntervalMinutes = (watch: ObjectiveWatch, policy: ObjectiveWatchPolicy) => {
  const plannedStart = new Date(`${watch.plan.forecastDate}T${watch.plan.alpineStartTime || '12:00'}:00Z`);
  const hoursUntilStart = (plannedStart.getTime() - Date.now()) / (60 * 60 * 1000);
  return Number.isFinite(hoursUntilStart) && hoursUntilStart > 48
    ? policy.checkIntervalMinutes
    : Math.min(policy.checkIntervalMinutes, 60);
};

const monitoringLabel = (watch: ObjectiveWatch, policy: ObjectiveWatchPolicy) => {
  if (planHasEnded(watch)) return 'Plan ended';
  if (!policy.automaticChecks) return 'Manual refresh';
  if (!policy.schedulerEnabled) return 'Checks paused';
  if (!watch.nextCheckAt) return 'Check queued';
  if (isObjectiveWatchCheckOverdue(watch, policy)) return 'Check overdue';
  const cadence = formatObjectiveWatchCadence(effectiveWatchIntervalMinutes(watch, policy));
  return `${cadence.charAt(0).toUpperCase()}${cadence.slice(1)}`;
};

const monitoringDetail = (watch: ObjectiveWatch, policy: ObjectiveWatchPolicy) => {
  if (planHasEnded(watch)) return 'Monitoring complete · check history remains available';
  if (policy.automaticChecks && !policy.schedulerEnabled) {
    return `Automatic processing is paused · configured cadence is ${formatObjectiveWatchCadence(policy.checkIntervalMinutes)}`;
  }
  if (watch.consecutiveFailures > 0) {
    return policy.automaticChecks
      ? 'Latest check failed · an automatic retry is scheduled'
      : 'Latest refresh failed · try again when source data is available';
  }
  if (!policy.automaticChecks) {
    return watch.lastCheckedAt
      ? `Last refreshed ${formatTimestamp(watch.lastCheckedAt)} · refresh when you want a new comparison`
      : 'Ready for the first manual refresh';
  }
  if (isObjectiveWatchCheckOverdue(watch, policy)) {
    return `Automatic check overdue since ${formatTimestamp(watch.nextCheckAt!)} · configured cadence is ${formatObjectiveWatchCadence(policy.checkIntervalMinutes)}`;
  }
  return watch.nextCheckAt
    ? `Next automatic check ${formatTimestamp(watch.nextCheckAt)}`
    : 'Automatic check queued';
};

const getRefreshRetryAtMs = (watch: ObjectiveWatch, policy: ObjectiveWatchPolicy | null) => {
  const lastAttemptedAt = watch.lastAttemptedAt || watch.lastCheckedAt;
  if (!policy || !lastAttemptedAt) return null;
  const lastAttemptedAtMs = new Date(lastAttemptedAt).getTime();
  if (!Number.isFinite(lastAttemptedAtMs)) return null;
  return lastAttemptedAtMs + policy.manualRefreshCooldownMinutes * 60 * 1000;
};

const formatRefreshWait = (remainingMs: number) => {
  const totalSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
};

const checkStatusLabel = (status: ObjectiveWatchCheck['status']) => ({
  changed: 'Meaningful change',
  unchanged: 'No meaningful change',
  partial: 'Partial data',
  failed: 'Check failed',
}[status]);

const formatCheckSummary = (check: ObjectiveWatchCheck) => {
  if (!check.summary) return '';
  const parts: string[] = [];
  if (typeof check.summary.score === 'number') parts.push(`Score ${Math.round(check.summary.score)}`);
  if (check.summary.tier) parts.push(`${check.summary.tier} risk tier`);
  if (typeof check.summary.maxWindGust === 'number') parts.push(`Peak gust ${Math.round(check.summary.maxWindGust)} mph`);
  if (typeof check.summary.maxPrecipChance === 'number') parts.push(`Precipitation ${Math.round(check.summary.maxPrecipChance)}%`);
  return parts.join(' · ');
};

export function WatchesView({
  appShellClassName,
  isViewPending,
  navigateToView,
  openPlannerView,
  openTripToolView,
  onOpenWatch,
}: WatchesViewProps) {
  const account = useAccount();
  const accountUserId = account.user?.id;
  const emailVerified = account.user?.emailVerified === true;
  const [watches, setWatches] = useState<ObjectiveWatch[]>([]);
  const [policy, setPolicy] = useState<ObjectiveWatchPolicy | null>(null);
  const [checksByWatch, setChecksByWatch] = useState<Record<string, ObjectiveWatchCheck[]>>({});
  const [historyErrorsByWatch, setHistoryErrorsByWatch] = useState<Record<string, string>>({});
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [updatingAlertsId, setUpdatingAlertsId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [historyLoadingId, setHistoryLoadingId] = useState<string | null>(null);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountUserId) {
      setWatches([]);
      setPolicy(null);
      setChecksByWatch({});
      setHistoryErrorsByWatch({});
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setChecksByWatch({});
    setHistoryErrorsByWatch({});
    setExpandedHistoryId(null);
    setLoading(true);
    setError(null);
    void listObjectiveWatches(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setWatches(result.watches);
          setPolicy(result.policy);
        }
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load objective watches.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [accountUserId]);

  useVisibleRevalidation(async (signal) => {
    const result = await listObjectiveWatches(signal);
    if (signal.aborted) return;
    setWatches(result.watches);
    setPolicy(result.policy);
  }, Boolean(accountUserId) && !deletingId && !refreshingId && !updatingAlertsId);

  useEffect(() => {
    setCurrentTimeMs(Date.now());
    if (!policy || watches.length === 0) return;
    const timer = window.setInterval(() => setCurrentTimeMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [policy, watches.length]);

  const removeWatch = async (watch: ObjectiveWatch) => {
    if (deletingId || refreshingId === watch.id || updatingAlertsId === watch.id) return;
    setDeletingId(watch.id);
    setError(null);
    try {
      await deleteObjectiveWatch(watch.id);
      setWatches((current) => current.filter((item) => item.id !== watch.id));
      setChecksByWatch((current) => {
        const next = { ...current };
        delete next[watch.id];
        return next;
      });
      setHistoryErrorsByWatch((current) => {
        const next = { ...current };
        delete next[watch.id];
        return next;
      });
      setExpandedHistoryId((current) => current === watch.id ? null : current);
      setConfirmingId(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not stop watching this objective.');
    } finally {
      setDeletingId(null);
    }
  };

  const toggleAlerts = async (watch: ObjectiveWatch) => {
    if (!emailVerified) {
      navigateToView('settings');
      return;
    }
    if (updatingAlertsId || refreshingId === watch.id || deletingId === watch.id) return;
    setUpdatingAlertsId(watch.id);
    setError(null);
    try {
      const result = await setObjectiveWatchNotifications(watch.id, !watch.notificationsEnabled);
      setWatches((current) => current.map((item) => item.id === result.watch.id ? result.watch : item));
      setPolicy(result.policy);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not update Objective Watch alerts.');
    } finally {
      setUpdatingAlertsId(null);
    }
  };

  const refreshWatch = async (watch: ObjectiveWatch) => {
    const retryAtMs = getRefreshRetryAtMs(watch, policy);
    if (
      !policy
      || refreshingId
      || deletingId === watch.id
      || updatingAlertsId === watch.id
      || planHasEnded(watch)
      || (retryAtMs !== null && retryAtMs > Date.now())
    ) return;
    setRefreshingId(watch.id);
    setError(null);
    try {
      const result = await refreshObjectiveWatch(watch.id);
      setWatches((current) => current.map((item) => item.id === result.watch.id ? result.watch : item));
      setPolicy(result.policy);
      setChecksByWatch((current) => {
        const next = { ...current };
        delete next[watch.id];
        return next;
      });
      setHistoryErrorsByWatch((current) => {
        const next = { ...current };
        delete next[watch.id];
        return next;
      });
      setExpandedHistoryId((current) => current === watch.id ? null : current);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Could not refresh this objective watch.');
      try {
        const latest = await listObjectiveWatches();
        setWatches(latest.watches);
        setPolicy(latest.policy);
      } catch {
        // Keep the original refresh error visible; the server still enforces the cooldown.
      }
    } finally {
      setRefreshingId(null);
    }
  };

  const loadWatchHistory = async (watch: ObjectiveWatch) => {
    if (historyLoadingId) return;
    setHistoryLoadingId(watch.id);
    setHistoryErrorsByWatch((current) => {
      const next = { ...current };
      delete next[watch.id];
      return next;
    });
    setError(null);
    try {
      const result = await getObjectiveWatchChecks(watch.id);
      setChecksByWatch((current) => ({ ...current, [watch.id]: result.checks }));
      setPolicy(result.policy);
    } catch (historyError) {
      const message = historyError instanceof Error ? historyError.message : 'Could not load Objective Watch history.';
      setHistoryErrorsByWatch((current) => ({ ...current, [watch.id]: message }));
    } finally {
      setHistoryLoadingId(null);
    }
  };

  const toggleHistory = (watch: ObjectiveWatch) => {
    if (expandedHistoryId === watch.id) {
      setExpandedHistoryId(null);
      return;
    }
    setExpandedHistoryId(watch.id);
    if (Object.prototype.hasOwnProperty.call(checksByWatch, watch.id) || historyLoadingId) return;
    void loadWatchHistory(watch);
  };

  const activeWatchCount = watches.filter((watch) => !planHasEnded(watch)).length;
  const automaticChecks = policy?.automaticChecks === true;
  const schedulerEnabled = policy?.schedulerEnabled !== false;
  const automaticChecksActive = automaticChecks && schedulerEnabled;
  const watchesWithChanges = watches.filter((watch) => !planHasEnded(watch) && (watch.lastChange?.reasons?.length || 0) > 0).length;
  const watchesWithFailures = watches.filter((watch) => !planHasEnded(watch) && watch.consecutiveFailures > 0).length;
  const nextScheduledWatch = automaticChecksActive
    ? watches
      .filter((watch) => !planHasEnded(watch) && watch.nextCheckAt)
      .sort((left, right) => new Date(left.nextCheckAt || 0).getTime() - new Date(right.nextCheckAt || 0).getTime())[0]
    : null;
  const automaticCheckOverdue = isObjectiveWatchCheckOverdue(nextScheduledWatch || null, policy);
  const orderedWatches = useMemo(() => [...watches].sort((left, right) => {
    const leftEnded = planHasEnded(left) ? 1 : 0;
    const rightEnded = planHasEnded(right) ? 1 : 0;
    if (leftEnded !== rightEnded) return leftEnded - rightEnded;
    const leftAttention = left.consecutiveFailures > 0 || (left.lastChange?.reasons?.length || 0) > 0 ? 0 : 1;
    const rightAttention = right.consecutiveFailures > 0 || (right.lastChange?.reasons?.length || 0) > 0 ? 0 : 1;
    if (leftAttention !== rightAttention) return leftAttention - rightAttention;
    return left.plan.forecastDate.localeCompare(right.plan.forecastDate)
      || left.plan.alpineStartTime.localeCompare(right.plan.alpineStartTime)
      || left.title.localeCompare(right.title);
  }), [watches]);

  return (
    <div className={`${appShellClassName} watches-page-shell`} aria-busy={isViewPending || loading || Boolean(deletingId) || Boolean(updatingAlertsId) || Boolean(refreshingId) || Boolean(historyLoadingId)}>
      <ProductNav
        active="watches"
        navigateToView={navigateToView}
        openPlannerView={openPlannerView}
        openTripToolView={openTripToolView}
      />
      <main className="watches-page">
        <header className="watches-head">
          <div className="watches-head-icon" aria-hidden><BellRing /></div>
          <p>Objective monitoring</p>
          <h1>Your watched objectives</h1>
          <span>See watch status, refresh conditions, and review every automatic or manual check for each saved plan.</span>
        </header>

        <aside className="watches-explainer" aria-label="How Objective Watch works">
          <strong>How it works</strong>
          <span>
            {policy === null
              ? 'Loading your Objective Watch access…'
              : automaticChecks
              ? `Premium checks up to ${policy?.activeWatchLimit || 10} active watches ${formatObjectiveWatchCadence(policy.checkIntervalMinutes)}. Inside the final 48 hours, checks use the faster of hourly or that interval. ${schedulerEnabled ? 'Automatic processing is active.' : 'Automatic processing is currently paused.'} Every run appears in ${policy?.historyDays || 90}-day check history; email alerts cover meaningful risk increases.`
              : `Free includes ${policy?.activeWatchLimit || 1} active watch with manual refresh, in-app updates, and ${policy?.historyDays || 14} days of check history. Current reports and official safety information remain available.`}
          </span>
        </aside>

        {!account.user ? (
          <section className="watches-empty" aria-labelledby="watches-signin-title">
            <BellRing aria-hidden />
            <h2 id="watches-signin-title">Sign in to view objective watches</h2>
            <p>Objective Watch belongs to your account so your monitored plans stay available across devices.</p>
            <button type="button" onClick={() => navigateToView('settings')}>Open account settings</button>
          </section>
        ) : loading ? (
          <div className="watches-loading" role="status">
            <LoaderCircle className="watches-spinner" aria-hidden />
            Loading objective watches…
          </div>
        ) : watches.length === 0 ? (
          <section className="watches-empty" aria-labelledby="watches-empty-title">
            <MapPinned aria-hidden />
            <h2 id="watches-empty-title">No watched objectives yet</h2>
            <p>Generate a conditions report, then select <strong>Watch objective</strong> to save that plan as a comparison baseline.</p>
            <button type="button" onClick={openPlannerView}>Plan an objective</button>
          </section>
        ) : (
          <>
            <section className="watches-overview" aria-label="Objective monitoring overview">
              <div>
                <span className="watches-overview-icon"><BellRing aria-hidden /></span>
                <span>
                  <small>Active watches</small>
                  <strong>{activeWatchCount} <em>of {policy?.activeWatchLimit || 1}</em></strong>
                </span>
              </div>
              <div className={watchesWithChanges > 0 ? 'has-attention' : ''}>
                <span className="watches-overview-icon"><TriangleAlert aria-hidden /></span>
                <span>
                  <small>Changes recorded</small>
                  <strong>{watchesWithChanges} <em>{watchesWithChanges === 1 ? 'objective' : 'objectives'}</em></strong>
                </span>
              </div>
              <div className={watchesWithFailures > 0 || automaticCheckOverdue ? 'has-error' : !schedulerEnabled && automaticChecks ? 'has-attention' : ''}>
                <span className="watches-overview-icon">{automaticChecks ? schedulerEnabled ? <Clock3 aria-hidden /> : <Pause aria-hidden /> : <RefreshCw aria-hidden />}</span>
                <span>
                  <small>{automaticCheckOverdue ? 'Automatic check overdue' : automaticChecksActive ? 'Next automatic check' : automaticChecks ? 'Automatic checks' : 'Monitoring cadence'}</small>
                  <strong>
                    {automaticChecksActive
                      ? nextScheduledWatch?.nextCheckAt ? formatTimestamp(nextScheduledWatch.nextCheckAt) : 'Queued'
                      : automaticChecks ? 'Paused'
                      : 'Manual refresh'}
                  </strong>
                  {automaticChecks && watchesWithFailures === 0 && <em>Standard cadence {formatObjectiveWatchCadence(policy?.checkIntervalMinutes || 180)}</em>}
                  {watchesWithFailures > 0 && <em>{watchesWithFailures} {watchesWithFailures === 1 ? 'check needs' : 'checks need'} retry</em>}
                </span>
              </div>
            </section>
            <section className="watches-list" aria-label="Watched objectives">
              {orderedWatches.map((watch) => {
                const isConfirming = confirmingId === watch.id;
                const isDeleting = deletingId === watch.id;
                const hasEnded = planHasEnded(watch);
                const checkOverdue = isObjectiveWatchCheckOverdue(watch, policy);
                const historyChecks = checksByWatch[watch.id];
                const historyError = historyErrorsByWatch[watch.id];
                const historyLoaded = Object.prototype.hasOwnProperty.call(checksByWatch, watch.id);
                const refreshRetryAtMs = getRefreshRetryAtMs(watch, policy);
                const refreshWaitMs = refreshRetryAtMs === null ? 0 : Math.max(0, refreshRetryAtMs - currentTimeMs);
                const refreshOnCooldown = refreshWaitMs > 0;
                const isRefreshing = refreshingId === watch.id;
                return (
                  <article key={watch.id} className="watch-card">
                    <div className="watch-card-main">
                      <div className="watch-card-heading">
                        <div>
                          <span className="watch-card-kicker">
                            {watch.lastCheckedAt
                              ? `Last ${automaticChecks ? 'checked' : 'refreshed'} ${formatTimestamp(watch.lastCheckedAt)}`
                              : automaticChecks ? schedulerEnabled ? 'Automatic check queued' : 'Automatic checks paused' : 'Ready for manual refresh'}
                          </span>
                          <h2>{watch.title}</h2>
                        </div>
                        <span className={`watch-status ${hasEnded ? 'is-ended' : checkOverdue ? 'is-overdue' : !schedulerEnabled && automaticChecks ? 'is-paused' : ''}`}><span aria-hidden /> {monitoringLabel(watch, policy!)}</span>
                      </div>
                      <div className="watch-card-meta">
                        <span><CalendarDays aria-hidden /> {formatPlanDate(watch.plan.forecastDate)}</span>
                        <span><Clock3 aria-hidden /> Start {watch.plan.alpineStartTime}</span>
                        <span><Timer aria-hidden /> {watch.plan.travelWindowHours}h window</span>
                        <span><MapPinned aria-hidden /> {watch.plan.lat.toFixed(4)}, {watch.plan.lon.toFixed(4)}</span>
                      </div>
                      <p className={`watch-monitoring-detail ${watch.consecutiveFailures > 0 || checkOverdue ? 'has-error' : ''}`}>
                        {monitoringDetail(watch, policy!)}
                      </p>
                      {watch.lastChange?.reasons && watch.lastChange.reasons.length > 0 && (
                        <div className="watch-change" role="status">
                          <strong>Latest meaningful risk increase {watch.lastChange.checkedAt ? `· ${formatTimestamp(watch.lastChange.checkedAt)}` : ''}</strong>
                          <ul>
                            {watch.lastChange.reasons.map((reason) => (
                              <li key={`${reason.key || 'change'}:${reason.label || ''}`}>{reason.label || 'Conditions changed.'}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {expandedHistoryId === watch.id && (
                        <section className="watch-history" id={`watch-history-${watch.id}`} aria-label={`${watch.title} check history`}>
                          <strong>Check history · last {policy?.historyDays || 14} days</strong>
                          {historyLoadingId === watch.id ? (
                            <p><LoaderCircle className="watches-spinner" aria-hidden /> Loading history…</p>
                          ) : historyError ? (
                            <div className="watch-history-error" role="alert">
                              <p>{historyError}</p>
                              <button
                                type="button"
                                onClick={() => void loadWatchHistory(watch)}
                                disabled={Boolean(historyLoadingId) || Boolean(deletingId)}
                              >
                                <RefreshCw aria-hidden /> Retry history
                              </button>
                            </div>
                          ) : !historyLoaded ? (
                            <div className="watch-history-error">
                              <p>Check history has not loaded yet.</p>
                              <button
                                type="button"
                                onClick={() => void loadWatchHistory(watch)}
                                disabled={Boolean(historyLoadingId) || Boolean(deletingId)}
                              >
                                <RefreshCw aria-hidden /> Load history
                              </button>
                            </div>
                          ) : historyChecks.length === 0 ? (
                            <p>No checks recorded in this period yet.</p>
                          ) : (
                            <ol>
                              {historyChecks.map((check) => {
                                const summary = formatCheckSummary(check);
                                return (
                                  <li key={check.id} className={`watch-check is-${check.status}`}>
                                    <div className="watch-check-head">
                                      <time dateTime={check.checkedAt || undefined}>{check.checkedAt ? formatTimestamp(check.checkedAt) : 'Date unavailable'}</time>
                                      <span>{checkStatusLabel(check.status)}</span>
                                    </div>
                                    <p>{check.checkType === 'manual' ? 'Manual refresh' : 'Automatic check'}{summary ? ` · ${summary}` : ''}</p>
                                    {check.status === 'unchanged' && <p>No meaningful risk increase was detected.</p>}
                                    {check.status === 'partial' && <p>The check completed with incomplete source data, so no change alert was generated.</p>}
                                    {check.status === 'failed' && <p>{check.error || 'Conditions data was unavailable for this check.'}</p>}
                                    {(check.change?.reasons || []).length > 0 && (
                                      <ul>
                                        {(check.change?.reasons || []).map((reason) => (
                                          <li key={`${check.id}:${reason.key || reason.label}`}>{reason.label || 'Conditions changed.'}</li>
                                        ))}
                                      </ul>
                                    )}
                                  </li>
                                );
                              })}
                            </ol>
                          )}
                        </section>
                      )}
                    </div>
                    <div className="watch-card-actions">
                      <button
                        type="button"
                        className="watch-open"
                        onClick={() => onOpenWatch(watch.plan)}
                        disabled={Boolean(deletingId)}
                      >
                        Open plan <ArrowRight aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={`watch-refresh ${refreshOnCooldown ? 'is-cooling-down' : ''}`}
                        onClick={() => void refreshWatch(watch)}
                        disabled={!policy || Boolean(refreshingId) || Boolean(deletingId) || updatingAlertsId === watch.id || hasEnded || refreshOnCooldown}
                        title={refreshOnCooldown && refreshRetryAtMs !== null
                          ? `Refresh available ${formatTimestamp(new Date(refreshRetryAtMs).toISOString())}`
                          : hasEnded ? 'This plan date has ended' : undefined}
                      >
                        {isRefreshing ? <LoaderCircle className="watches-spinner" aria-hidden /> : <RefreshCw aria-hidden />}
                        {isRefreshing ? 'Refreshing…' : refreshOnCooldown ? `Refresh in ${formatRefreshWait(refreshWaitMs)}` : 'Refresh now'}
                      </button>
                      <button
                        type="button"
                        className="watch-history-toggle"
                        onClick={() => toggleHistory(watch)}
                        disabled={Boolean(historyLoadingId) || Boolean(deletingId)}
                        aria-expanded={expandedHistoryId === watch.id}
                        aria-controls={`watch-history-${watch.id}`}
                      >
                        {historyLoadingId === watch.id ? <LoaderCircle className="watches-spinner" aria-hidden /> : <History aria-hidden />}
                        {expandedHistoryId === watch.id ? 'Hide history' : 'Check history'}
                      </button>
                      <button
                        type="button"
                        className={`watch-alerts ${watch.notificationsEnabled ? 'is-enabled' : ''}`}
                        onClick={() => policy?.emailAlerts ? void toggleAlerts(watch) : navigateToView('settings')}
                        disabled={Boolean(updatingAlertsId) || Boolean(deletingId) || isRefreshing}
                        title={!policy?.emailAlerts ? 'Premium includes email alerts' : !emailVerified ? 'Verify your email to enable alerts' : undefined}
                      >
                        {updatingAlertsId === watch.id
                          ? <LoaderCircle className="watches-spinner" aria-hidden />
                          : watch.notificationsEnabled ? <MailCheck aria-hidden /> : <MailPlus aria-hidden />}
                        {!policy?.emailAlerts
                          ? 'Upgrade for email alerts'
                          : !emailVerified
                          ? 'Verify email for alerts'
                          : watch.notificationsEnabled ? 'Email alerts on' : 'Enable email alerts'}
                      </button>
                      {isConfirming ? (
                        <div className="watch-delete-confirm" role="group" aria-label={`Stop watching ${watch.title}?`}>
                          <span>Stop watching?</span>
                          <button type="button" onClick={() => setConfirmingId(null)} disabled={isDeleting}>Keep</button>
                          <button type="button" className="is-danger" onClick={() => void removeWatch(watch)} disabled={isDeleting || isRefreshing || updatingAlertsId === watch.id}>
                            {isDeleting ? <LoaderCircle className="watches-spinner" aria-hidden /> : <Trash2 aria-hidden />}
                            Stop
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="watch-delete"
                          onClick={() => setConfirmingId(watch.id)}
                          disabled={Boolean(deletingId) || isRefreshing || updatingAlertsId === watch.id}
                        >
                          <Trash2 aria-hidden /> Stop watching
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          </>
        )}

        {error && <p className="watches-error" role="alert">{error}</p>}
      </main>
    </div>
  );
}
