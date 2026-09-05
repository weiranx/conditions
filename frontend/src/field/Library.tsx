import { useEffect, useId, useState } from "react";
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  Link,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  listSavedReports,
  getSavedReport,
  buildSavedReportShareUrl,
  type SavedReportSummary,
} from "../lib/saved-reports";
import {
  listObjectiveWatches,
  refreshObjectiveWatch,
  deleteObjectiveWatch,
  setObjectiveWatchNotifications,
  getObjectiveWatchChecks,
  getObjectiveWatchEvents,
  formatObjectiveWatchCadence,
  isObjectiveWatchCheckOverdue,
  type ObjectiveWatch,
  type ObjectiveWatchPolicy,
  type ObjectiveWatchCheck,
  type ObjectiveWatchEvent,
} from "../lib/objective-watches";
import { watchHasEnded, watchNeedsAttention, watchRefreshWait, watchCheckLabel, watchCheckDetail } from "./watch-status";
import { useVisibleRevalidation } from "../hooks/useVisibleRevalidation";
import "./watchlist.css";
import { copyTextToClipboard } from "../app/clipboard";
import { useAccount } from "../hooks/useAccount";
import type { PersistedReport } from "../app/report-storage";
import type { Workspace } from "./model/useWorkspace";
import { ageLabel, dateLabel, type Page } from "./data";
import { Dialog } from "./Dialog";
import { Details } from "./Details";

function WatchHistory({ id }: { id: string }) {
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
        <div className="field-warning" role="alert">
          <p>{error}</p>
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
        <article key={check.id}>
          <span className="field-kicker">
            {check.checkType === "manual" ? "Manual check" : "Automatic check"} · {watchCheckLabel(check.status)}
          </span>
          <h3>{ageLabel(check.checkedAt)}</h3>
          <p>{watchCheckDetail(check)}</p>
          {check.error && <p className="field-warning">{check.error}</p>}
          <Details title="Check measurements" value={check.summary} />
        </article>
      ))}
      {!loading && !error && !checks.length && (
        <p className="field-muted">No checks recorded yet.</p>
      )}
      <Details title="Change events" value={events} />
    </div>
  );
}

export function Library({
  kind,
  localReport,
  onOpen,
  navigate,
  workspace: w,
}: {
  kind: "history" | "watches";
  localReport: PersistedReport | null;
  onOpen: (report: PersistedReport, token?: string) => void;
  navigate: (page: Page) => void;
  workspace: Workspace;
}) {
  const account = useAccount();
  const watches = kind === "watches";
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<'active' | 'attention' | 'ended' | 'all'>('active');
  const [now, setNow] = useState(() => Date.now());
  const query = search.trim().toLocaleLowerCase();
  const [reports, setReports] = useState<SavedReportSummary[]>([]);
  const [items, setItems] = useState<ObjectiveWatch[]>([]);
  const [policy, setPolicy] = useState<ObjectiveWatchPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ObjectiveWatch | null>(null);
  const matches = (title: string, date: string | null) =>
    `${title} ${date || ""} ${date ? dateLabel(date) : ""}`.toLocaleLowerCase().includes(query);
  const visibleReports = reports.filter((report) => matches(report.title, report.forecastDate));
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
  const showLocalReport = !watches && localReport && matches(localReport.plan.objectiveName, localReport.plan.forecastDate);
  const resultCount = watches ? visibleWatches.length : visibleReports.length + (showLocalReport ? 1 : 0);
  useEffect(() => {
    setItems([]);
    setPolicy(null);
    setExpanded(null);
  }, [account.user?.id, watches]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    if (!account.user) {
      setItems([]);
      setReports([]);
      setPolicy(null);
      setExpanded(null);
      setLoading(false);
      return;
    }
    void (
      watches
        ? listObjectiveWatches(controller.signal).then((data) => {
            if (!controller.signal.aborted) {
              setNow(Date.now());
              setItems(data.watches);
              setPolicy(data.policy);
            }
          })
        : listSavedReports(controller.signal).then((data) => {
            if (!controller.signal.aborted) setReports(data);
          })
    )
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
  }, [account.user, watches, revision]);
  useEffect(() => {
    if (!watches || !items.length) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [watches, items.length]);
  useVisibleRevalidation(async (signal) => {
    const data = await listObjectiveWatches(signal);
    if (signal.aborted) return;
    setNow(Date.now());
    setItems(data.watches);
    setPolicy(data.policy);
  }, watches && Boolean(account.user) && !loading && !pending);
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
  async function copy(token: string) {
    const copied = await copyTextToClipboard(buildSavedReportShareUrl(token));
    if (!copied) throw new Error("Could not copy the link.");
    setNotice("Report link copied.");
  }
  return (
    <section className="field-library">
      <header className="field-page-heading">
        <span className="field-kicker">
          {watches ? "Monitoring" : "Library"}
        </span>
        <h1>{watches ? "Watchlist" : "Saved reports"}</h1>
        <p>
          {watches
            ? "Follow conditions, review changes, and manage your objective alerts."
            : "Your report history, including saved AI conversations and route analysis."}
        </p>
      </header>
      <div className="field-library-bar">
        <span>
          {watches
            ? `${activeCount}${policy ? ` / ${policy.activeWatchLimit}` : ""} active watches · ${items.length - activeCount} completed`
            : `${reports.length} account reports`}
        </span>
        <div className="field-action-row">
          <button
            className="field-button"
            disabled={loading}
            onClick={() => setRevision((n) => n + 1)}
          >
            <RefreshCw size={15} />
            Refresh
          </button>
          <button className="field-button" onClick={() => navigate("planner")}>
            Plan an outing
            <ArrowUpRight size={15} />
          </button>
        </div>
      </div>
      <div className="field-library-search">
        <label htmlFor={searchId}>{watches ? "Find an objective" : "Find a report"}</label>
        <div className="field-input-icon">
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
        <p role="status">{query && !loading ? `${resultCount} ${resultCount === 1 ? "result" : "results"}` : ""}</p>
      </div>
      {watches && items.length > 0 && (
        <div className="field-watch-filters" role="group" aria-label="Filter watches">
          {([
            ['active', 'Active', activeCount], ['attention', 'Needs attention', attentionCount],
            ['ended', 'Completed', items.length - activeCount], ['all', 'All', items.length],
          ] as const).map(([value, label, count]) => (
            <button type="button" className="field-button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {label} <span>{count}</span>
            </button>
          ))}
        </div>
      )}
      {watches && policy && (
        <p className="field-feedback">
          {policy.automaticChecks
            ? policy.schedulerEnabled
              ? `Automatic checks ${formatObjectiveWatchCadence(policy.checkIntervalMinutes)}.`
              : "Automatic checks are paused on this server."
            : `Manual checks · ${policy.manualRefreshCooldownMinutes} minute cooldown.`}{" "}
          {policy.historyDays} days of check history.{" "}
          {policy.emailAlerts
            ? "Email alerts available."
            : "Email alerts require Premium."}
        </p>
      )}
      {loading && <p role="status">Loading your plans…</p>}
      {error && (
        <div className="field-warning" role="alert">
          <p>{error}</p>
          <button className="field-button" disabled={loading || !!pending} onClick={() => setRevision((n) => n + 1)}>Retry loading plans</button>
        </div>
      )}
      {notice && (
        <p className="field-feedback" role="status">
          {notice}
        </p>
      )}
      {showLocalReport && localReport && (
        <button
          className="field-journal-entry"
          onClick={() => onOpen(localReport)}
        >
          <span className="field-journal-icon">
            <BookOpen size={22} />
          </span>
          <span>
            <small>ON THIS DEVICE</small>
            <strong>{localReport.plan.objectiveName}</strong>
            <span>
              {dateLabel(localReport.plan.forecastDate)} ·{" "}
              {localReport.plan.travelWindowHours} hours
            </span>
          </span>
          <b>
            {localReport.safetyData.safety.score}
            <small>/100</small>
          </b>
          <ArrowUpRight size={18} />
        </button>
      )}
      {!watches &&
        visibleReports.map((report) => (
          <article className="field-library-entry" key={report.id}>
            <button
              className="field-journal-entry"
              disabled={!!pending}
              onClick={() =>
                void run(report.id, async () =>
                  onOpen(await getSavedReport(report.id), report.shareToken),
                )
              }
            >
              <span className="field-journal-icon">
                <BookOpen size={22} />
              </span>
              <span>
                <small>
                  {dateLabel(report.forecastDate)}
                  {report.hasAi && " · Includes AI"}
                </small>
                <strong>{report.title}</strong>
                <span>Saved {ageLabel(report.createdAt)}</span>
              </span>
              <b>
                {report.score ?? "—"}
                <small>/100</small>
              </b>
              <ArrowUpRight size={18} />
            </button>
            {w.featureFlags.reportSharing && (
              <button
                className="field-text-button"
                onClick={() =>
                  void run(report.id, () => copy(report.shareToken))
                }
              >
                <Link size={14} />
                Copy report link
              </button>
            )}
          </article>
        ))}
      {watches &&
        visibleWatches.map((item) => {
          const ended = watchHasEnded(item, now);
          const wait = watchRefreshWait(item, policy, now);
          const latest = item.latestCheck;
          return (
          <article className="field-panel field-watch-card" key={item.id}>
            <div className="field-panel-heading">
              <div>
                <span className="field-kicker">
                  {dateLabel(item.plan.forecastDate)} ·{" "}
                  {item.plan.alpineStartTime} · {item.plan.travelWindowHours}h window
                </span>
                <h2>{item.title}</h2>
              </div>
              <span className="field-watch-state">{ended ? 'Completed' : policy?.automaticChecks ? policy.schedulerEnabled ? 'Monitoring' : 'Checks paused' : 'Manual checks'}</span>
            </div>
            <p className="field-muted">
              {ended ? 'Monitoring complete · history remains available' : item.lastCheckedAt ? `Last successful check ${ageLabel(item.lastCheckedAt)}` : 'No successful checks yet'}
              {!ended && policy?.automaticChecks && policy.schedulerEnabled && item.nextCheckAt
                ? ` · Next check ${new Date(item.nextCheckAt).toLocaleString()}` : ''}
            </p>
            {latest && (
              <section className={`field-watch-latest is-${latest.status}`} aria-label={`${item.title} latest check`}>
                <div><strong>{watchCheckLabel(latest.status)}</strong>
                  {latest.checkedAt && <time dateTime={latest.checkedAt}>{new Date(latest.checkedAt).toLocaleString()}</time>}
                </div>
                {latest.status !== 'failed' && latest.summary && (
                  <p className="field-watch-measurements">
                    {typeof latest.summary.score === 'number' && <span>Score <b>{Math.round(latest.summary.score)}/100</b></span>}
                    {latest.summary.tier && <span>{latest.summary.tier} risk</span>}
                    {typeof latest.summary.maxWindGust === 'number' && <span>Peak gust <b>{Math.round(latest.summary.maxWindGust)} mph</b></span>}
                    {typeof latest.summary.maxPrecipChance === 'number' && <span>Precipitation <b>{Math.round(latest.summary.maxPrecipChance)}%</b></span>}
                  </p>
                )}
                <p>{watchCheckDetail(latest)}</p>
              </section>
            )}
            {!!item.lastChange?.reasons?.length && latest?.status !== 'changed' && (
              <p className="field-warning">Previous risk increase{item.lastChange.checkedAt ? ` · ${new Date(item.lastChange.checkedAt).toLocaleString()}` : ''}: {item.lastChange.reasons.map((r) => r.label).join(' · ')}</p>
            )}
            {!ended && isObjectiveWatchCheckOverdue(item, policy, now) && (
              <p className="field-warning">
                Scheduled check is overdue. Refresh manually and verify the
                latest source evidence.
              </p>
            )}
            {item.consecutiveFailures > 0 && (
              <p className="field-warning">
                {item.consecutiveFailures} recent checks failed. The last
                successful result may be stale.
              </p>
            )}
            <div className="field-action-row">
              <button
                className="field-button"
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
                <RefreshCw size={14} />
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
                className="field-button"
                disabled={!!pending}
                aria-label={`Remove watch for ${item.title}`}
                onClick={() => setDeleting(item)}
              >
                <Trash2 size={14} />
              </button>
            </div>
            {policy?.emailAlerts && (
              <label className="field-toggle">
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
                {account.user?.emailVerified ? 'Email when risk increases' : 'Verify your email in Account to enable alerts'}
              </label>
            )}
            {expanded === item.id && (
              <div id={`watch-history-${item.id}`}>
                <WatchHistory key={`${item.id}-${revision}-${item.latestCheck?.id || item.lastAttemptedAt || ''}`} id={item.id} />
              </div>
            )}
          </article>
        ); })}
      {watches && !loading && !error && !query && items.length > 0 && visibleWatches.length === 0 && (
        <div className="field-empty-state">
          <h2>{filter === 'attention' ? 'No objectives need attention' : filter === 'ended' ? 'No completed plans yet' : 'No active watches'}</h2>
          <p>Completed plans keep their history and do not count toward your active watch limit.</p>
          <button className="field-button" onClick={() => setFilter('all')}>Show all watches</button>
        </div>
      )}
      {!loading && !error && query && resultCount === 0 && (
        <div className="field-empty-state">
          <Search size={32} aria-hidden="true" />
          <h2>No matching {watches ? "objectives" : "reports"}</h2>
          <p>Try a different name or date, or clear your search to see everything.</p>
          <button className="field-button" onClick={() => { setSearch(""); if (watches) setFilter('all'); }}>Clear search{watches ? ' and show all watches' : ''}</button>
        </div>
      )}
      {!loading && !error && !query &&
        (!account.user ||
          (watches
            ? items.length === 0
            : reports.length === 0 && !localReport)) && (
          <div className="field-empty-state">
            {watches ? <Bell size={36} /> : <BookOpen size={36} />}
            <h2>
              {account.user
                ? watches ? "No watched objectives yet" : "No saved reports yet"
                : "Sign in to access your plans"}
            </h2>
            <p>
              {account.user
                ? watches
                  ? "Create a conditions brief, then add the objective to your watchlist to follow changes."
                  : "Create a conditions brief and save it to revisit the forecast and your planning notes."
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
