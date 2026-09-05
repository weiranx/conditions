import {
  useAdministration,
  type Administration as Model,
} from "./model/useAdministration";
import { Details, DetailValues } from "./Details";
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
    <p className="field-warning" role="status">
      {message}
    </p>
  ) : null;
}
export function AdminStats({ a }: { a: Model }) {
  return (
    <div className="field-admin-stats">
      {[
        ["Reports", a.metrics.total],
        [
          "Healthy responses",
          a.metrics.healthyRate === null ? "—" : `${a.metrics.healthyRate}%`,
        ],
        [
          "P95 response",
          a.metrics.p95Duration === null
            ? "—"
            : a.formatDuration(a.metrics.p95Duration),
        ],
        ["AI calls", a.aiMetrics.calls],
        [
          "AI cost estimate",
          a.formatEstimatedCost(a.aiMetrics.estimatedCostUsd),
        ],
      ].map(([label, value]) => (
        <article className="field-panel" key={label}>
          <span className="field-kicker">{label}</span>
          <strong>{value}</strong>
        </article>
      ))}
    </div>
  );
}
export default function Administration() {
  const a = useAdministration();
  const { dashboardContentRef } = a;
  return (
    <section className="field-administration">
      <header className="field-page-heading">
        <span className="field-kicker">Platform workspace</span>
        <h1>Administration</h1>
        <p>Service health, account access, and product performance.</p>
      </header>
      <div className="field-action-row">
        <label className="field-form-label">
          Time range
          <select
            value={a.analyticsRange}
            onChange={(e) =>
              a.setAnalyticsRange(e.target.value as typeof a.analyticsRange)
            }
          >
            {a.ANALYTICS_RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="field-button"
          onClick={() => void a.fetchAdminData(true)}
          disabled={a.refreshing || a.loading}
        >
          {a.refreshing || a.loading ? "Refreshing…" : "Refresh data"}
        </button>
        <label>
          <input
            type="checkbox"
            checked={a.autoRefresh}
            onChange={(e) => a.setAutoRefresh(e.target.checked)}
          />{" "}
          Refresh every 30 seconds
        </label>
        <button className="field-button" onClick={a.downloadOperationsSnapshot}>
          Export snapshot
        </button>
        <small>
          {a.lastRefreshed
            ? `Updated ${a.lastRefreshed.toLocaleTimeString()}`
            : "Waiting for data"}
        </small>
      </div>
      <AdminNotice message={a.error} />
      <nav className="field-chapter-nav" aria-label="Administration sections">
        {a.ADMIN_SECTIONS.map((section) => (
          <button
            key={section.value}
            aria-current={
              a.activeSection === section.value ? "page" : undefined
            }
            onClick={() => a.setActiveSection(section.value)}
          >
            <section.icon size={16} />
            {section.label}
          </button>
        ))}
      </nav>
      <div ref={dashboardContentRef}>
        {a.activeSection === "overview" && (
          <>
            <AdminStats a={a} />
            <section className="field-panel">
              <h2>Needs attention</h2>
              {a.attentionSignals.length ? (
                a.attentionSignals.map((signal) => (
                  <button
                    className="field-location-row"
                    key={signal.key}
                    onClick={() => a.reviewAttentionSignal(signal.key)}
                  >
                    <signal.icon size={18} />
                    <span>
                      <strong>{signal.label}</strong>
                      <small>{signal.detail}</small>
                    </span>
                    <b>{signal.count}</b>
                  </button>
                ))
              ) : (
                <p>No active attention signals in the available data.</p>
              )}
              <button
                className="field-button"
                disabled={a.diagnosticsPending}
                onClick={a.runDiagnosticsFromOverview}
              >
                Run service diagnostics
              </button>
            </section>
            <div className="field-detail-grid">
              <section className="field-panel">
                <h2>Platform health</h2>
                <AdminNotice message={a.healthError} />
                <DetailValues value={a.health} />
              </section>
              <section className="field-panel">
                <h2>Resources & caching</h2>
                <AdminNotice message={a.systemResourcesError} />
                <DetailValues value={a.systemResources} />
                <Details
                  title="Cache measurements"
                  value={{ summary: a.cacheMetrics, caches: a.health?.caches }}
                />
              </section>
              <section className="field-panel">
                <h2>Account activity</h2>
                <AdminNotice message={a.usersError} />
                <DetailValues value={a.userSummary} />
              </section>
            </div>
          </>
        )}
        {a.activeSection === "users" && <AdminUsers a={a} />}
        {a.activeSection === "operations" && <AdminControls a={a} />}
        {a.activeSection === "analytics" && <AdminAnalytics a={a} />}
        {a.activeSection === "activity" && (
          <section className="field-panel">
            <h2>Audit trail</h2>
            <div className="field-action-row">
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
            <p>{a.filteredAuditEntries.length} events</p>
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
            {!a.filteredAuditEntries.length && <p>No matching activity.</p>}
          </section>
        )}
      </div>
      {a.confirmation && (
        <Dialog
          title={a.confirmation.title}
          onClose={() => a.resolveAdminConfirmation(false)}
        >
          <p>{a.confirmation.description}</p>
          <div className="field-action-row">
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
