import { useEffect, useId, useState } from "react";
import {
  ArrowUpRight,
  Bell,
  Check,
  Info,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  listObjectiveWatches,
  refreshObjectiveWatch,
  reviewObjectiveWatch,
  deleteObjectiveWatch,
  setObjectiveWatchNotifications,
  getObjectiveWatchChecks,
  getObjectiveWatchEvents,
  formatObjectiveWatchCadence,
  isObjectiveWatchCheckOverdue,
  objectiveWatchChangeDirection,
  type ObjectiveWatch,
  type ObjectiveWatchChange,
  type ObjectiveWatchPolicy,
  type ObjectiveWatchCheck,
  type ObjectiveWatchEvent,
} from "../lib/objective-watches";
import {
  watchHasEnded,
  watchNeedsAttention,
  watchRefreshWait,
  watchCheckLabel,
  watchCheckDetail,
  watchChangeReasons,
  watchReasonText,
} from "./watch-status";
import { useVisibleRevalidation } from "../hooks/useVisibleRevalidation";
import "./watchlist.css";
import { ReportHistory } from "./ReportHistory";
import { useAccount } from "../hooks/useAccount";
import type { PersistedReport } from "../app/report-storage";
import type { Workspace } from "./model/useWorkspace";
import { ageLabel, dateLabel, sentenceCase, type Page } from "./data";
import { formatClockForStyle } from "../app/core";
import { Dialog } from "./Dialog";
import { Details } from "./Details";

const AVALANCHE_DANGER_NAMES = ["", "Low", "Moderate", "Considerable", "High", "Extreme"];

function WatchReasons({ change, localize }: { change: ObjectiveWatchChange | null | undefined; localize: (text: string) => string }) {
  const reasons = watchChangeReasons(change);
  if (!reasons.length) return null;
  return (
    <ul className="sky-watch-reasons">
      {reasons.map((reason, index) => (
        <li key={`${reason.key}-${index}`} className={`is-${reason.direction}`}>
          {watchReasonText(reason.label, localize)}
        </li>
      ))}
    </ul>
  );
}

function WatchHistory({ id, localize }: { id: string; localize: (text: string) => string }) {
  const [checks, setChecks] = useState<ObjectiveWatchCheck[]>([]);
  const [events, setEvents] = useState<ObjectiveWatchEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      getObjectiveWatchChecks(id, controller.signal),
      getObjectiveWatchEvents(id, controller.signal),
    ])
      .then(([a, b]) => {
        if (!controller.signal.aborted) {
          setChecks(a.checks);
          setEvents(b.events);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Could not load watch history.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, attempt]);
  return (
    <div className="field-watch-history">
      {loading && <p role="status">Loading check history…</p>}
      {error && (
        <div className="sky-notice is-caution" role="alert">
          <div><p>{error}</p></div>
          <button
            className="field-button"
            onClick={() => {
              setLoading(true);
              setError("");
              setAttempt((v) => v + 1);
            }}
          >
            Retry
          </button>
        </div>
      )}
      {checks.map((check) => (
        <article key={check.id} className={`sky-watch-check is-${check.status}${objectiveWatchChangeDirection(check.change) === "better" ? " is-better" : ""}`}>
          <span className="sky-muted">
            {check.checkType === "manual" ? "Manual check" : "Automatic check"} · {watchCheckLabel(check)}
          </span>
          <h3>{sentenceCase(ageLabel(check.checkedAt))}</h3>
          {check.status === "changed"
            ? <WatchReasons change={check.change} localize={localize} />
            : <p>{watchCheckDetail(check)}</p>}
          {check.error && <p className="sky-notice is-caution">{check.error}</p>}
          <Details title="Check measurements" value={check.summary} />
        </article>
      ))}
      {!loading && !error && !checks.length && (
        <p className="sky-cap">No checks recorded yet.</p>
      )}
      <Details title="Change events" value={events} />
    </div>
  );
}

interface LibraryProps {
  kind: "history" | "watches";
  localReport: PersistedReport | null;
  onOpen: (report: PersistedReport, token?: string, reportId?: string) => void;
  navigate: (page: Page) => void;
  workspace: Workspace;
}

export function Library(props: LibraryProps) {
  return props.kind === "history"
    ? <ReportHistory localReport={props.localReport} onOpen={props.onOpen} navigate={props.navigate} sharingEnabled={props.workspace.featureFlags.reportSharing} timeStyle={props.workspace.preferences.timeStyle} />
    : <WatchLibrary {...props} />;
}

function WatchLibrary({ onOpen, navigate, workspace: w }: LibraryProps) {
  const account = useAccount();
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<'active' | 'attention' | 'ended' | 'all'>('active');
  const [now, setNow] = useState(() => Date.now());
  const query = search.trim().toLocaleLowerCase();
  const [items, setItems] = useState<ObjectiveWatch[]>([]);
  const [policy, setPolicy] = useState<ObjectiveWatchPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ObjectiveWatch | null>(null);
  const localize = w.localizeUnitText;
  const matches = (title: string, date: string | null) =>
    `${title} ${date || ""} ${date ? dateLabel(date) : ""}`.toLocaleLowerCase().includes(query);
  const activeCount = items.filter((item) => !watchHasEnded(item, now)).length;
  const attentionCount = items.filter((item) => watchNeedsAttention(item, policy, now)).length;
  const visibleWatches = items.filter((item) => {
    if (!matches(item.title, item.plan.forecastDate)) return false;
    if (filter === 'active') return !watchHasEnded(item, now);
    if (filter === 'ended') return watchHasEnded(item, now);
    if (filter === 'attention') return watchNeedsAttention(item, policy, now);
    return true;
  }).sort((a, b) => Number(watchHasEnded(a, now)) - Number(watchHasEnded(b, now))
    || Number(watchNeedsAttention(b, policy, now)) - Number(watchNeedsAttention(a, policy, now))
    || a.plan.forecastDate.localeCompare(b.plan.forecastDate)
    || a.plan.alpineStartTime.localeCompare(b.plan.alpineStartTime)
    || a.title.localeCompare(b.title));
  const resultCount = visibleWatches.length;
  useEffect(() => {
    setItems([]);
    setPolicy(null);
    setExpanded(null);
  }, [account.user?.id]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    if (!account.user) {
      setItems([]);
      setPolicy(null);
      setExpanded(null);
      setLoading(false);
      return;
    }
    void listObjectiveWatches(controller.signal).then((data) => {
      if (!controller.signal.aborted) {
        setNow(Date.now());
        setItems(data.watches);
        setPolicy(data.policy);
      }
    })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Could not load your plans.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [account.user, revision]);
  useEffect(() => {
    if (!items.length) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [items.length]);
  useVisibleRevalidation(async (signal) => {
    const data = await listObjectiveWatches(signal);
    if (signal.aborted) return;
    setNow(Date.now());
    setItems(data.watches);
    setPolicy(data.policy);
  }, Boolean(account.user) && !loading && !pending);
  async function run(id: string, action: () => Promise<void>) {
    setPending(id);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not complete this action.",
      );
    } finally {
      setPending("");
    }
  }
  const policyLine = policy
    ? `${policy.automaticChecks
      ? policy.schedulerEnabled
        ? `Automatic checks ${formatObjectiveWatchCadence(policy.checkIntervalMinutes)}.`
        : "Automatic checks are paused on this server."
      : `Manual checks · ${policy.manualRefreshCooldownMinutes} minute cooldown.`} ${policy.historyDays} days of check history. ${policy.emailAlerts ? "Email alerts available." : "Email alerts require Premium."}`
    : "";
  return (
    <section className="field-library sky-screen sky-watchlist">
      <header className="field-page-heading">
        <span className="field-kicker">
          Monitoring
        </span>
        <h1>Watchlist</h1>
        <p className="sky-lead">
          {account.user && !loading && items.length > 0
            ? <><strong>{activeCount} {activeCount === 1 ? "objective" : "objectives"}</strong> being watched{attentionCount > 0
              ? <>; <strong className="is-over">{attentionCount} {attentionCount === 1 ? "needs" : "need"} attention</strong></> : ""}. </>
            : null}
          <span className="sky-lead-note">Follow conditions as the forecast updates, review what changed, and get alerts.</span>
        </p>
      </header>
      <div className="sky-card sky-filter-bar">
        <div className="field-library-search">
          <label htmlFor={searchId} className="sr-only">Find an objective</label>
          <div className="field-input-icon sky-search">
            <Search size={17} aria-hidden="true" />
            <input
              id={searchId}
              type="search"
              placeholder="Search by name or date"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button type="button" className="field-icon-button" aria-label="Clear search" onClick={() => {
                setSearch("");
                document.getElementById(searchId)?.focus({ preventScroll: true });
              }}><X size={16} /></button>
            )}
          </div>
        </div>
        <div className="sky-toolbar-actions">
          <button
            className="field-button"
            disabled={loading}
            onClick={() => setRevision((n) => n + 1)}
          >
            <RefreshCw size={15} aria-hidden="true" />
            Refresh
          </button>
          <button className="field-button field-button-primary" onClick={() => navigate("planner")}>
            Plan an outing
            <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      {items.length > 0 && (
        <div className="sky-segmented sky-watch-filter field-watch-filters" role="group" aria-label="Filter watches">
          {([
            ['active', 'Active', activeCount], ['attention', 'Needs attention', attentionCount],
            ['ended', 'Completed', items.length - activeCount], ['all', 'All', items.length],
          ] as const).map(([value, label, count]) => (
            <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {label} <span className="sky-count">{count}</span>
            </button>
          ))}
        </div>
      )}
      <p className="sky-cap sky-watch-meta" role="status">
        {query && !loading ? `${resultCount} ${resultCount === 1 ? "result" : "results"} · ` : ""}
        {`${activeCount}${policy ? ` of ${policy.activeWatchLimit}` : ""} active watches · ${items.length - activeCount} completed`}
        {policyLine && ` · ${policyLine}`}
      </p>
      {loading && <p className="sky-cap" role="status">Loading your plans…</p>}
      {error && (
        <div className="sky-notice is-caution" role="alert">
          <div><p>{error}</p></div>
          <button className="field-button" disabled={loading || !!pending} onClick={() => setRevision((n) => n + 1)}>Retry loading plans</button>
        </div>
      )}
      {notice && (
        <p className="sky-notice is-info" role="status">
          {notice}
        </p>
      )}
      <div className="sky-watch-grid">
      {visibleWatches.map((item) => {
          const ended = watchHasEnded(item, now);
          const wait = watchRefreshWait(item, policy, now);
          const latest = item.latestCheck;
          const latestImproved = objectiveWatchChangeDirection(latest?.change) === "better";
          const avalancheDanger = latest?.summary?.avalancheDanger;
          const unreviewed = item.unreviewedChanges;
          const reviewFocus = unreviewed?.worsened ? unreviewed.latestWorse : unreviewed?.latest;
          // The latest check already lists its reasons; do not repeat them.
          const reviewFocusShown = latest?.status === "changed" && Boolean(reviewFocus?.checkedAt)
            && latest.change?.checkedAt === reviewFocus?.checkedAt;
          const attention = watchNeedsAttention(item, policy, now);
          const state = ended ? 'Completed' : policy?.automaticChecks ? policy.schedulerEnabled ? 'Monitoring' : 'Checks paused' : 'Manual checks';
          return (
          <article className={`sky-card field-watch-card${attention ? " is-attention" : ""}${ended ? " is-ended" : ""}`} key={item.id}>
            <div className="sky-watch-head">
              <div>
                <span className="sky-muted">
                  {dateLabel(item.plan.forecastDate)} ·{" "}
                  {formatClockForStyle(item.plan.alpineStartTime, w.preferences.timeStyle)} · {item.plan.travelWindowHours}h window
                </span>
                <h2>{item.title}</h2>
                {item.route && (
                  <span className="sky-muted field-watch-route">
                    Also checks {item.route.checkpointCount} checkpoints along {item.route.name || "the analyzed route"}
                  </span>
                )}
              </div>
              <span className={`sky-chip field-watch-state${attention ? " is-over" : ""}`}>{state}</span>
            </div>
            <p className="sky-cap">
              {ended ? 'Monitoring complete · history remains available' : item.lastCheckedAt ? `Last successful check ${ageLabel(item.lastCheckedAt)}` : 'No successful checks yet'}
              {!ended && policy?.automaticChecks && policy.schedulerEnabled && item.nextCheckAt
                ? ` · Next check ${new Date(item.nextCheckAt).toLocaleString()}` : ''}
            </p>
            {latest && (
              <section className={`field-watch-latest is-${latest.status}${latestImproved ? " is-better" : ""}`} aria-label={`${item.title} latest check`}>
                <div className="sky-watch-latest-head"><strong>{watchCheckLabel(latest)}</strong>
                  {latest.checkedAt && <time dateTime={latest.checkedAt}>{new Date(latest.checkedAt).toLocaleString()}</time>}
                </div>
                {latest.status !== 'failed' && latest.summary && (
                  <p className="field-watch-measurements">
                    {typeof latest.summary.score === 'number' && <span>Score <b>{Math.round(latest.summary.score)}/100</b></span>}
                    {latest.summary.tier && <span>{latest.summary.tier} risk</span>}
                    {typeof avalancheDanger === 'number' && AVALANCHE_DANGER_NAMES[avalancheDanger] && <span>Avalanche <b>{AVALANCHE_DANGER_NAMES[avalancheDanger]}</b></span>}
                    {typeof latest.summary.maxWindGust === 'number' && <span>Peak gust <b>{w.formatWindDisplay(latest.summary.maxWindGust)}</b></span>}
                    {typeof latest.summary.maxPrecipChance === 'number' && <span>Precipitation <b>{Math.round(latest.summary.maxPrecipChance)}%</b></span>}
                  </p>
                )}
                {latest.status === 'changed'
                  ? <WatchReasons change={latest.change} localize={localize} />
                  : <p className="sky-watch-detail">{watchCheckDetail(latest)}</p>}
              </section>
            )}
            {!ended && unreviewed && unreviewed.count > 0 && (
              <div className={`sky-notice field-watch-review ${unreviewed.worsened ? "is-caution" : "is-improved"}`}>
                {unreviewed.worsened ? <TriangleAlert size={20} aria-hidden="true" /> : <Info size={20} aria-hidden="true" />}
                <div>
                  <strong>{unreviewed.worsened ? "Risk increased since your last review" : "Conditions improved since your last review"}</strong>
                  {unreviewed.count > 1 && <span className="sky-muted"> · {unreviewed.count} changes in check history</span>}
                  {!reviewFocusShown && <WatchReasons change={reviewFocus} localize={localize} />}
                </div>
                <button
                  className="field-button"
                  disabled={!!pending}
                  onClick={() => void run(item.id, async () => {
                    await reviewObjectiveWatch(item.id);
                    setRevision((n) => n + 1);
                  })}
                >
                  <Check size={15} aria-hidden="true" />
                  Mark reviewed
                </button>
              </div>
            )}
            {!ended && isObjectiveWatchCheckOverdue(item, policy, now) && (
              <p className="sky-notice is-caution">
                Scheduled check is overdue. Refresh manually and verify the
                latest source evidence.
              </p>
            )}
            {item.consecutiveFailures > 0 && (
              <p className="sky-notice is-caution">
                {item.consecutiveFailures} recent checks failed. The last
                successful result may be stale.
              </p>
            )}
            <div className="sky-watch-actions">
              <button
                className="field-button field-button-primary"
                onClick={() => w.handleOpenObjectiveWatch(item.plan)}
              >
                Plan this objective
              </button>
              {item.baselineReport && (
                <button
                  className="field-button"
                  onClick={() => onOpen(item.baselineReport!)}
                >
                  Open baseline
                </button>
              )}
              <button
                className="field-button"
                disabled={!!pending || !policy || ended || wait > 0}
                title={ended ? 'This plan date has ended' : wait > 0 ? `Check available ${new Date(now + wait).toLocaleString()}` : undefined}
                onClick={() => {
                  if (!policy || watchHasEnded(item) || watchRefreshWait(item, policy) > 0) return;
                  void run(item.id, async () => {
                    try {
                      await refreshObjectiveWatch(item.id);
                      setNotice("Check complete. Review the latest result below.");
                      setRevision((n) => n + 1);
                    } catch (error) {
                      // Failed attempts also start a cooldown and can add history.
                      try {
                        const data = await listObjectiveWatches();
                        setNow(Date.now());
                        setItems(data.watches);
                        setPolicy(data.policy);
                      } catch { /* Preserve the original check failure. */ }
                      throw error;
                    }
                  });
                }}
              >
                <RefreshCw size={14} aria-hidden="true" />
                {pending === item.id ? 'Working…' : ended ? 'Plan completed' : wait > 0 ? `Check in ${Math.ceil(wait / 60000)}m` : 'Check now'}
              </button>
              <button
                className="field-button"
                aria-expanded={expanded === item.id}
                aria-controls={`watch-history-${item.id}`}
                onClick={() =>
                  setExpanded(expanded === item.id ? null : item.id)
                }
              >
                Check history
              </button>
              <button
                className="field-button sky-icon-only"
                disabled={!!pending}
                aria-label={`Remove watch for ${item.title}`}
                onClick={() => setDeleting(item)}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </div>
            {policy?.emailAlerts && (
              <label className="sky-switch">
                <input
                  type="checkbox"
                  checked={item.notificationsEnabled}
                  disabled={!!pending || ended || !account.user?.emailVerified}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    void run(item.id, async () => {
                      await setObjectiveWatchNotifications(item.id, enabled);
                      setRevision((n) => n + 1);
                    });
                  }}
                />
                <span aria-hidden="true" />
                {account.user?.emailVerified ? 'Email when risk increases' : 'Verify your email in Account to enable alerts'}
              </label>
            )}
            {expanded === item.id && (
              <div id={`watch-history-${item.id}`}>
                <WatchHistory key={`${item.id}-${revision}-${item.latestCheck?.id || item.lastAttemptedAt || ''}`} id={item.id} localize={localize} />
              </div>
            )}
          </article>
        ); })}
      </div>
      {!loading && !error && !query && items.length > 0 && visibleWatches.length === 0 && (
        <div className="sky-card sky-empty-card field-empty-state">
          <h2>{filter === 'attention' ? 'No objectives need attention' : filter === 'ended' ? 'No completed plans yet' : 'No active watches'}</h2>
          <p>Completed plans keep their history and do not count toward your active watch limit.</p>
          <button className="field-button" onClick={() => setFilter('all')}>Show all watches</button>
        </div>
      )}
      {!loading && !error && query && resultCount === 0 && (
        <div className="sky-card sky-empty-card field-empty-state">
          <Search size={30} aria-hidden="true" />
          <h2>No matching objectives</h2>
          <p>Try a different name or date, or clear your search to see everything.</p>
          <button className="field-button" onClick={() => { setSearch(""); setFilter('all'); }}>Clear search and show all watches</button>
        </div>
      )}
      {!loading && !error && !query &&
        (!account.user || items.length === 0) && (
          <div className="sky-card sky-empty-card field-empty-state">
            <Bell size={30} aria-hidden="true" />
            <h2>
              {account.user
                ? "No watched objectives yet"
                : "Sign in to access your plans"}
            </h2>
            <p>
              {account.user
                ? "Create a conditions brief, then add the objective to your watchlist to follow changes."
                : "Sync reports and watch objectives across your devices."}
            </p>
            <button
              className="field-button field-button-primary"
              onClick={() => navigate(account.user ? "planner" : "account")}
            >
              {account.user ? "Create a brief" : "Open your account"}
            </button>
          </div>
        )}
      {deleting && (
        <Dialog
          title={`Remove ${deleting.title}?`}
          onClose={() => setDeleting(null)}
        >
          <p>
            This stops its checks and removes its watch history. Saved reports
            remain in your library.
          </p>
          <div className="field-action-row">
            <button
              className="field-button"
              disabled={!!pending}
              onClick={() =>
                void run(deleting.id, async () => {
                  await deleteObjectiveWatch(deleting.id);
                  setDeleting(null);
                  setRevision((n) => n + 1);
                })
              }
            >
              Remove watch
            </button>
            <button className="field-button" onClick={() => setDeleting(null)}>
              Keep watch
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
