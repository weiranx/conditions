import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BellRing,
  CalendarDays,
  Clock3,
  LoaderCircle,
  MailCheck,
  MailPlus,
  MapPinned,
  Timer,
  Trash2,
} from 'lucide-react';
import type { PersistedReportPlan } from '../../app/report-storage';
import type { AppView } from '../../hooks/useUrlState';
import { useAccount } from '../../hooks/useAccount';
import {
  deleteObjectiveWatch,
  listObjectiveWatches,
  setObjectiveWatchNotifications,
  type ObjectiveWatch,
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

const monitoringLabel = (watch: ObjectiveWatch) => {
  if (!watch.nextCheckAt) return 'Monitoring ended';
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
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [updatingAlertsId, setUpdatingAlertsId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountUserId) {
      setWatches([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void listObjectiveWatches(controller.signal)
      .then((nextWatches) => {
        if (!controller.signal.aborted) setWatches(nextWatches);
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
      const updated = await setObjectiveWatchNotifications(watch.id, !watch.notificationsEnabled);
      setWatches((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not update Objective Watch alerts.');
    } finally {
      setUpdatingAlertsId(null);
    }
  };

  return (
    <div className={`${appShellClassName} watches-page-shell`} aria-busy={isViewPending || loading || Boolean(deletingId) || Boolean(updatingAlertsId)}>
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
          <span>See automatic check status, important changes, and every saved comparison baseline.</span>
        </header>

        <aside className="watches-explainer" aria-label="How Objective Watch works">
          <strong>How it works</strong>
          <span>Checks run every three hours, then hourly during the final 48 hours. Duplicate plans share one refresh, expired objectives stop automatically, and alerts only cover meaningful risk increases.</span>
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
              <strong>{watches.length}</strong> active {watches.length === 1 ? 'watch' : 'watches'}
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
                            {watch.lastCheckedAt ? `Last checked ${formatTimestamp(watch.lastCheckedAt)}` : 'Automatic check queued'}
                          </span>
                          <h2>{watch.title}</h2>
                        </div>
                        <span className={`watch-status ${watch.nextCheckAt ? '' : 'is-ended'}`}><span aria-hidden /> {monitoringLabel(watch)}</span>
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
                        <p className="watch-retry">The latest check failed. A retry is scheduled automatically.</p>
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
                        className={`watch-alerts ${watch.notificationsEnabled ? 'is-enabled' : ''}`}
                        onClick={() => void toggleAlerts(watch)}
                        disabled={Boolean(updatingAlertsId) || Boolean(deletingId)}
                        title={!emailVerified ? 'Verify your email to enable alerts' : undefined}
                      >
                        {updatingAlertsId === watch.id
                          ? <LoaderCircle className="watches-spinner" aria-hidden />
                          : watch.notificationsEnabled ? <MailCheck aria-hidden /> : <MailPlus aria-hidden />}
                        {!emailVerified
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
