import { Download, RefreshCw } from "lucide-react";
import { AdminOverview } from "./AdminOverview";
import "./administration.css";
import {
  useAdministration,
  type Administration as Model,
} from "./model/useAdministration";
import { DetailValues } from "./Details";
import { Dialog } from "./Dialog";
import { AdminControls } from "./AdminControls";
import { AdminUsers } from "./AdminUsers";
import { AdminAnalytics } from "./AdminAnalytics";
export function AdminNotice({
  message,
}: {
  message: string | null | undefined;
}) {
  return message ? (
    <p className="sky-notice is-caution" role="status">
      {message}
    </p>
  ) : null;
}
export function AdminStats({ a }: { a: Model }) {
  return (
    <div className="field-admin-stats sky-admin-stats">
      {[
        [
          "Reports",
          a.metrics.total.toLocaleString(),
          "Requests in selected period",
          !!a.error,
        ],
        [
          "Healthy responses",
          a.metrics.healthyRate === null ? "—" : `${a.metrics.healthyRate}%`,
          "Complete, successful responses",
          !!a.error,
        ],
        [
          "P95 response",
          a.metrics.p95Duration === null
            ? "—"
            : a.formatDuration(a.metrics.p95Duration),
          "95% of requests finish within this",
          !!a.error,
        ],
        [
          "AI calls",
          a.aiMetrics.calls.toLocaleString(),
          "Model requests in selected period",
          !!a.aiUsageError,
        ],
        [
          "AI cost estimate",
          a.aiMetrics.calls > 0 && a.aiMetrics.pricedCalls === 0
            ? "—"
            : a.formatEstimatedCost(a.aiMetrics.estimatedCostUsd),
          `${a.aiMetrics.pricedCalls} of ${a.aiMetrics.calls} calls priced`,
          !!a.aiUsageError,
        ],
      ].map(([label, value, detail, unavailable]) => (
        <article className="sky-card sky-admin-stat" key={String(label)}>
          <span className="sky-admin-stat-label">{label}</span>
          <strong>{a.loading || unavailable ? "—" : value}</strong>
          <small>
            {a.loading ? "Loading…" : unavailable ? "Data unavailable" : detail}
          </small>
        </article>
      ))}
    </div>
  );
}
export default function Administration() {
  const a = useAdministration();
  const { dashboardContentRef } = a;
  return (
    <section className="field-administration sky-screen sky-admin">
      <header className="field-page-heading">
        <span className="field-kicker">Platform workspace</span>
        <h1>Administration</h1>
        <p className="sky-lead">
          <span className="sky-lead-note">
            Service health, account access, and product performance.
          </span>
        </p>
      </header>
      <div className="sky-card sky-admin-toolbar admin-toolbar">
        <div className="sky-segmented sky-admin-range" role="group" aria-label="Analytics period">
          {a.ANALYTICS_RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              aria-pressed={a.analyticsRange === r.value}
              onClick={() => a.setAnalyticsRange(r.value)}
            >
              {r.label.replace(/^Last /, "")}
            </button>
          ))}
        </div>
        <label className="sky-switch admin-auto-refresh">
          <input
            type="checkbox"
            checked={a.autoRefresh}
            onChange={(e) => a.setAutoRefresh(e.target.checked)}
          />
          <span aria-hidden="true" />
          Auto-refresh every 30 s
        </label>
        <small className="admin-updated">
          {a.lastRefreshed
            ? `Updated ${a.lastRefreshed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
            : "Waiting for data"}
        </small>
        <div className="sky-toolbar-actions">
          <button
            className="field-button"
            onClick={() => void a.fetchAdminData(true)}
            disabled={a.refreshing || a.loading}
          >
            <RefreshCw size={16} aria-hidden="true" className={a.refreshing ? "field-spin" : undefined} />
            {a.refreshing || a.loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            className="field-button"
            disabled={a.loading || !a.lastRefreshed}
            onClick={a.downloadOperationsSnapshot}
          >
            <Download size={16} aria-hidden="true" />
            Export snapshot
          </button>
        </div>
      </div>
      <AdminNotice message={a.error} />
      <AdminNotice message={a.aiUsageError} />
      <nav className="field-chapter-nav sky-admin-tabs" aria-label="Administration sections">
        {a.ADMIN_SECTIONS.map((section) => (
          <button
            key={section.value}
            aria-current={
              a.activeSection === section.value ? "page" : undefined
            }
            onClick={() => a.setActiveSection(section.value)}
          >
            <section.icon size={17} aria-hidden="true" />
            {section.label}
            {!a.loading && a.sectionCounts[section.value] > 0 && (
              <span
                className="admin-nav-count sky-count"
                aria-label={a.sectionCountTitle(
                  section.value,
                  a.sectionCounts[section.value],
                )}
              >
                {a.sectionCounts[section.value].toLocaleString()}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div ref={dashboardContentRef}>
        {a.activeSection === "overview" && <AdminOverview a={a} />}
        {a.activeSection === "users" && <AdminUsers a={a} />}
        {a.activeSection === "operations" && <AdminControls a={a} />}
        {a.activeSection === "analytics" && <AdminAnalytics a={a} />}
        {a.activeSection === "activity" && (
          <section className="field-panel">
            <h2>Audit trail</h2>
            <div className="field-action-row admin-filters">
              <label className="field-form-label">
                Search activity
                <input
                  type="search"
                  value={a.auditQuery}
                  onChange={(e) => a.setAuditQuery(e.target.value)}
                />
              </label>
              <label className="field-form-label">
                Category
                <select
                  value={a.auditFilter}
                  onChange={(e) =>
                    a.setAuditFilter(e.target.value as typeof a.auditFilter)
                  }
                >
                  {a.AUDIT_FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="field-button"
                onClick={() =>
                  a.triggerCsvDownload(
                    "admin-activity.csv",
                    [
                      "Timestamp",
                      "Action",
                      "Category",
                      "Status",
                      "Summary",
                      "Actor network",
                      "Details",
                    ],
                    a.filteredAuditEntries.map((e) => [
                      e.timestamp,
                      e.action,
                      e.category,
                      e.status,
                      e.summary,
                      e.actorNetwork,
                      JSON.stringify(e.details),
                    ]),
                  )
                }
              >
                Export activity
              </button>
            </div>
            <AdminNotice message={a.auditError} />
            <div className="admin-result-summary" role="status">
              <span>
                {a.filteredAuditEntries.length} of {a.auditEntries.length}{" "}
                loaded events
              </span>
              {(a.auditQuery || a.auditFilter !== "all") && (
                <button
                  className="field-text-button"
                  onClick={() => {
                    a.setAuditQuery("");
                    a.setAuditFilter("all");
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
            {a.filteredAuditEntries.map((entry, i) => (
              <details
                className="field-details"
                key={`${entry.timestamp}-${i}`}
              >
                <summary>
                  <span>{entry.summary}</span>
                  <small>
                    {new Date(entry.timestamp).toLocaleString()} ·{" "}
                    {entry.status}
                  </small>
                </summary>
                <DetailValues value={entry} />
              </details>
            ))}
            {!a.filteredAuditEntries.length && (
              <p className="sky-empty">No matching activity.</p>
            )}
          </section>
        )}
      </div>
      {a.confirmation && (
        <Dialog
          title={a.confirmation.title}
          onClose={() => a.resolveAdminConfirmation(false)}
        >
          <p>{a.confirmation.description}</p>
          <div className="sky-toolbar-actions admin-confirm-actions">
            <button
              className="field-button"
              onClick={() => a.resolveAdminConfirmation(false)}
            >
              {a.confirmation.cancelLabel || "Cancel"}
            </button>
            <button
              className="field-button field-button-primary"
              onClick={() => a.resolveAdminConfirmation(true)}
            >
              {a.confirmation.confirmLabel}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
