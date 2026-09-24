import { AlertTriangle, CheckCircle2, Download } from "lucide-react";
import type { Administration } from "./model/useAdministration";
import { AdminNotice } from "./Administration";
import { Details } from "./Details";

export function AdminActivity({ a }: { a: Administration }) {
  const filtered = !!a.auditQuery || a.auditFilter !== "all";
  return (
    <section className="field-panel">
      <div className="field-section-heading">
        <h2>Audit trail</h2>
        <button
          className="field-button"
          disabled={!a.filteredAuditEntries.length}
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
          <Download size={16} aria-hidden="true" />
          Export activity
        </button>
      </div>
      <p>
        Account, configuration, maintenance, and diagnostic changes made from
        this workspace.
      </p>
      <div className="field-action-row admin-filters">
        <label className="field-form-label">
          Search activity
          <input
            type="search"
            placeholder="Summary, action, or category"
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
      </div>
      <AdminNotice message={a.auditError} />
      <div className="admin-result-summary" role="status">
        <span>
          {a.filteredAuditEntries.length} of {a.auditEntries.length} loaded
          events
        </span>
        {filtered && (
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
      {a.filteredAuditEntries.length > 0 && (
        <ul className="admin-audit">
          {a.filteredAuditEntries.map((entry, i) => {
            const failed = entry.status === "error";
            const time = new Date(entry.timestamp);
            return (
              <li
                className={`admin-audit-entry${failed ? " is-failed" : ""}`}
                key={`${entry.timestamp}-${i}`}
              >
                {failed ? (
                  <AlertTriangle size={17} aria-hidden="true" />
                ) : (
                  <CheckCircle2 size={17} aria-hidden="true" />
                )}
                <div>
                  <strong>{entry.summary}</strong>
                  <small>
                    <time
                      dateTime={entry.timestamp}
                      title={
                        Number.isNaN(time.getTime())
                          ? undefined
                          : time.toLocaleString()
                      }
                    >
                      {a.formatAccountDate(entry.timestamp)}
                    </time>
                    <span className="admin-badge">{a.capitalize(entry.category)}</span>
                    {failed && <b>Failed</b>}
                  </small>
                  <Details
                    title="Details"
                    value={{
                      action: entry.action,
                      ...entry.details,
                      actorNetwork: entry.actorNetwork,
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!a.filteredAuditEntries.length && !(a.auditError && !a.auditEntries.length) && (
        <p className="sky-empty">
          {a.auditEntries.length
            ? "No activity matches these filters."
            : "No administrative activity yet. Account, setting, and maintenance changes will appear here."}
        </p>
      )}
    </section>
  );
}
