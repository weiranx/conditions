import { useEffect, useState } from 'react';
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
  RefreshCw,
  Timer,
  Trash2,
} from 'lucide-react';
import type { PersistedReportPlan } from '../../app/report-storage';
import type { AppView } from '../../hooks/useUrlState';
import { useAccount } from '../../hooks/useAccount';
import {
  deleteObjectiveWatch,
  getObjectiveWatchEvents,
  listObjectiveWatches,
  refreshObjectiveWatch,
  setObjectiveWatchNotifications,
  type ObjectiveWatch,
  type ObjectiveWatchEvent,
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

const monitoringLabel = (watch: ObjectiveWatch, automaticChecks: boolean) => {
  if (planHasEnded(watch)) return 'Plan ended';
  if (!automaticChecks) return 'Manual refresh';
  if (!watch.nextCheckAt) return 'Check queued';
  const plannedStart = new Date(`${watch.plan.forecastDate}T${watch.plan.alpineStartTime || '12:00'}:00Z`);
  const hoursUntilStart = (plannedStart.getTime() - Date.now()) / (60 * 60 * 1000);
  return Number.isFinite(hoursUntilStart) && hoursUntilStart > 48 ? 'Every 3 hours' : 'Hourly checks';
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
  const [eventsByWatch, setEventsByWatch] = useState<Record<string, ObjectiveWatchEvent[]>>({});
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
      setEventsByWatch({});
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setEventsByWatch({});
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

  const removeWatch = async (watch: ObjectiveWatch) => {
    if (deletingId) return;
    setDeletingId(watch.id);
    setError(null);
    try {
      await deleteObjectiveWatch(watch.id);
      setWatches((current) => current.filter((item) => item.id !== watch.id));
      setEventsByWatch((current) => {
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
    if (updatingAlertsId) return;
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
    if (refreshingId) return;
    setRefreshingId(watch.id);
    setError(null);
    try {
      const result = await refreshObjectiveWatch(watch.id);
      setWatches((current) => current.map((item) => item.id === result.watch.id ? result.watch : item));
      setPolicy(result.policy);
      setEventsByWatch((current) => {
        const next = { ...current };
        delete next[watch.id];
        return next;
      });
      setExpandedHistoryId((current) => current === watch.id ? null : current);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Could not refresh this objective watch.');
    } finally {
      setRefreshingId(null);
    }
  };

  const toggleHistory = async (watch: ObjectiveWatch) => {
    if (expandedHistoryId === watch.id) {
      setExpandedHistoryId(null);
      return;
    }
    setExpandedHistoryId(watch.id);
    if (eventsByWatch[watch.id] || historyLoadingId) return;
    setHistoryLoadingId(watch.id);
    setError(null);
    try {
      const result = await getObjectiveWatchEvents(watch.id);
      setEventsByWatch((current) => ({ ...current, [watch.id]: result.events }));
      setPolicy(result.policy);
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : 'Could not load Objective Watch history.');
    } finally {
      setHistoryLoadingId(null);
    }
  };

  const activeWatchCount = watches.filter((watch) => !planHasEnded(watch)).length;
  const automaticChecks = policy?.automaticChecks === true;

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
          <span>See watch status, refresh conditions, and review meaningful changes for every saved plan.</span>
        </header>

        <aside className="watches-explainer" aria-label="How Objective Watch works">
          <strong>How it works</strong>
          <span>
            {policy === null
              ? 'Loading your Objective Watch access…'
              : automaticChecks
              ? `Premium checks up to ${policy?.activeWatchLimit || 10} active watches every three hours, then hourly during the final 48 hours. Email alerts cover meaningful risk increases.`
              : `Free includes ${policy?.activeWatchLimit || 1} active watch with manual refresh, in-app updates, and ${policy?.historyDays || 14} days of change history. Current reports and official safety information remain available.`}
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
            <div className="watches-summary" role="status">
              <BellRing aria-hidden />
              <strong>{activeWatchCount}/{policy?.activeWatchLimit || 1}</strong> active {activeWatchCount === 1 ? 'watch' : 'watches'} · {automaticChecks ? 'Premium automatic checks' : 'Free manual checks'}
            </div>
            <section className="watches-list" aria-label="Watched objectives">
              {watches.map((watch) => {
                const isConfirming = confirmingId === watch.id;
                const isDeleting = deletingId === watch.id;
                return (
                  <article key={watch.id} className="watch-card">
                    <div className="watch-card-main">
                      <div className="watch-card-heading">
                        <div>
                          <span className="watch-card-kicker">
                            {watch.lastCheckedAt
                              ? `Last ${automaticChecks ? 'checked' : 'refreshed'} ${formatTimestamp(watch.lastCheckedAt)}`
                              : automaticChecks ? 'Automatic check queued' : 'Ready for manual refresh'}
                          </span>
                          <h2>{watch.title}</h2>
                        </div>
                        <span className={`watch-status ${planHasEnded(watch) ? 'is-ended' : ''}`}><span aria-hidden /> {monitoringLabel(watch, automaticChecks)}</span>
                      </div>
                      <div className="watch-card-meta">
                        <span><CalendarDays aria-hidden /> {formatPlanDate(watch.plan.forecastDate)}</span>
                        <span><Clock3 aria-hidden /> Start {watch.plan.alpineStartTime}</span>
                        <span><Timer aria-hidden /> {watch.plan.travelWindowHours}h window</span>
                        <span><MapPinned aria-hidden /> {watch.plan.lat.toFixed(4)}, {watch.plan.lon.toFixed(4)}</span>
                      </div>
                      {watch.lastChange?.reasons && watch.lastChange.reasons.length > 0 && (
                        <div className="watch-change" role="status">
                          <strong>Important change detected {watch.lastChange.checkedAt ? formatTimestamp(watch.lastChange.checkedAt) : ''}</strong>
                          <ul>
                            {watch.lastChange.reasons.map((reason) => (
                              <li key={`${reason.key || 'change'}:${reason.label || ''}`}>{reason.label || 'Conditions changed.'}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {watch.consecutiveFailures > 0 && (
                        <p className="watch-retry">The latest check failed. {automaticChecks ? 'A retry is scheduled automatically.' : 'Try a manual refresh again later.'}</p>
                      )}
                      {expandedHistoryId === watch.id && (
                        <section className="watch-history" id={`watch-history-${watch.id}`} aria-label={`${watch.title} change history`}>
                          <strong>Change history · last {policy?.historyDays || 14} days</strong>
                          {historyLoadingId === watch.id ? (
                            <p><LoaderCircle className="watches-spinner" aria-hidden /> Loading history…</p>
                          ) : (eventsByWatch[watch.id] || []).length === 0 ? (
                            <p>No meaningful risk increases recorded in this period.</p>
                          ) : (
                            <ol>
                              {(eventsByWatch[watch.id] || []).map((event) => (
                                <li key={event.id}>
                                  <time dateTime={event.checkedAt || undefined}>{event.checkedAt ? formatTimestamp(event.checkedAt) : 'Date unavailable'}</time>
                                  <ul>
                                    {(event.change?.reasons || []).map((reason) => (
                                      <li key={`${event.id}:${reason.key || reason.label}`}>{reason.label || 'Conditions changed.'}</li>
                                    ))}
                                  </ul>
                                </li>
                              ))}
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
                        className="watch-refresh"
                        onClick={() => void refreshWatch(watch)}
                        disabled={Boolean(refreshingId) || Boolean(deletingId) || planHasEnded(watch)}
                      >
                        {refreshingId === watch.id ? <LoaderCircle className="watches-spinner" aria-hidden /> : <RefreshCw aria-hidden />}
                        Refresh now
                      </button>
                      <button
                        type="button"
                        className="watch-history-toggle"
                        onClick={() => void toggleHistory(watch)}
                        disabled={Boolean(historyLoadingId) || Boolean(deletingId)}
                        aria-expanded={expandedHistoryId === watch.id}
                        aria-controls={`watch-history-${watch.id}`}
                      >
                        {historyLoadingId === watch.id ? <LoaderCircle className="watches-spinner" aria-hidden /> : <History aria-hidden />}
                        {expandedHistoryId === watch.id ? 'Hide history' : 'Change history'}
                      </button>
                      <button
                        type="button"
                        className={`watch-alerts ${watch.notificationsEnabled ? 'is-enabled' : ''}`}
                        onClick={() => policy?.emailAlerts ? void toggleAlerts(watch) : navigateToView('settings')}
                        disabled={Boolean(updatingAlertsId) || Boolean(deletingId)}
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
                          <button type="button" className="is-danger" onClick={() => void removeWatch(watch)} disabled={isDeleting}>
                            {isDeleting ? <LoaderCircle className="watches-spinner" aria-hidden /> : <Trash2 aria-hidden />}
                            Stop
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="watch-delete"
                          onClick={() => setConfirmingId(watch.id)}
                          disabled={Boolean(deletingId)}
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
