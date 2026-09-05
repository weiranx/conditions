import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  Link,
  RefreshCw,
  Trash2,
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
            {check.checkType} · {check.status}
          </span>
          <h3>{ageLabel(check.checkedAt)}</h3>
          <p>
            {check.change?.reasons?.map((reason) => reason.label).join(" · ") ||
              "No material changes recorded."}
          </p>
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
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    if (!account.user) {
      setLoading(false);
      return;
    }
    void (
      watches
        ? listObjectiveWatches(controller.signal).then((data) => {
            if (!controller.signal.aborted) {
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
            ? `${items.length}${policy ? ` / ${policy.activeWatchLimit}` : ""} watched objectives`
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
      {policy && (
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
        <p className="field-warning" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="field-feedback" role="status">
          {notice}
        </p>
      )}
      {!watches && localReport && (
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
        reports.map((report) => (
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
        items.map((item) => (
          <article className="field-panel" key={item.id}>
            <div className="field-panel-heading">
              <div>
                <span className="field-kicker">
                  {dateLabel(item.plan.forecastDate)} ·{" "}
                  {item.plan.alpineStartTime}
                </span>
                <h2>{item.title}</h2>
              </div>
              <Bell size={22} />
            </div>
            <p>
              Last checked {ageLabel(item.lastCheckedAt)}
              {item.nextCheckAt
                ? ` · Next check ${new Date(item.nextCheckAt).toLocaleString()}`
                : ""}
            </p>
            <p>
              {item.lastChange?.reasons?.map((r) => r.label).join(" · ") ||
                "No condition changes recorded."}
            </p>
            {isObjectiveWatchCheckOverdue(item, policy) && (
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
                disabled={!!pending}
                onClick={() =>
                  void run(item.id, async () => {
                    await refreshObjectiveWatch(item.id);
                    setRevision((n) => n + 1);
                    setNotice("Watch checked.");
                  })
                }
              >
                <RefreshCw size={14} />
                Check now
              </button>
              <button
                className="field-button"
                aria-expanded={expanded === item.id}
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
                  disabled={!!pending}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    void run(item.id, async () => {
                      await setObjectiveWatchNotifications(item.id, enabled);
                      setRevision((n) => n + 1);
                    });
                  }}
                />
                Email when conditions change
              </label>
            )}
            {expanded === item.id && (
              <WatchHistory key={`${item.id}-${revision}`} id={item.id} />
            )}
          </article>
        ))}
      {!loading &&
        (!account.user ||
          (watches
            ? items.length === 0
            : reports.length === 0 && !localReport)) && (
          <div className="field-empty-state">
            {watches ? <Bell size={36} /> : <BookOpen size={36} />}
            <h2>
              {account.user
                ? "No saved plans yet"
                : "Sign in to access your plans"}
            </h2>
            <p>
              {account.user
                ? "Create a conditions brief and add it to your watchlist or saved reports."
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
