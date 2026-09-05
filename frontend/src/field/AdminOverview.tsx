import {
  ArrowRight,
  CircleHelp,
  CheckCircle2,
  Server,
  Users,
  Gauge,
} from "lucide-react";
import type {
  Administration,
  ResourceUsageSnapshot,
} from "./model/useAdministration";
import { AdminNotice, AdminStats } from "./Administration";
import { Details } from "./Details";

function ResourceMeter({
  label,
  resource,
  formatBytes,
}: {
  label: string;
  resource: ResourceUsageSnapshot | null | undefined;
  formatBytes: Administration["formatBytes"];
}) {
  const available = resource && Number.isFinite(resource.usagePercent);
  return (
    <div className="admin-resource">
      <div>
        <span>{label}</span>
        <strong>
          {available
            ? `${Math.round(resource.usagePercent)}% used`
            : "Unavailable"}
        </strong>
      </div>
      {available && (
        <>
          <meter
            aria-label={`${label} usage`}
            min={0}
            max={100}
            low={70}
            high={85}
            optimum={0}
            value={Math.max(0, Math.min(100, resource.usagePercent))}
          />
          <small>
            {formatBytes(resource.usedBytes)} of{" "}
            {formatBytes(resource.totalBytes)}
          </small>
        </>
      )}
    </div>
  );
}

export function AdminOverview({ a }: { a: Administration }) {
  const health = a.healthError ? null : a.health;
  const resources = a.systemResourcesError ? null : a.systemResources;
  const incomplete = !!(
    a.error ||
    a.aiUsageError ||
    a.healthError ||
    a.systemResourcesError ||
    a.usersError ||
    a.objectiveWatchSchedulerError
  );
  return (
    <>
      <AdminStats a={a} />
      <section className="field-panel admin-attention">
        <div className="field-section-heading">
          <div>
            <span className="field-kicker">Review queue</span>
            <h2>Needs attention</h2>
          </div>
          <button
            className="field-button"
            disabled={a.diagnosticsPending || a.loading}
            onClick={a.runDiagnosticsFromOverview}
          >
            {a.diagnosticsPending
              ? "Checking services…"
              : "Run service diagnostics"}
          </button>
        </div>
        {a.loading ? (
          <p role="status">Loading service health and activity…</p>
        ) : (
          <>
            {incomplete && (
              <p className="field-warning" role="status">
                Some data could not be refreshed. Signals may be incomplete;
                review the notices below or refresh data.
              </p>
            )}
            {a.attentionSignals.length ? (
              <div className="admin-attention-list">
                {a.attentionSignals.map((signal) => (
                  <button
                    className="field-location-row"
                    key={signal.key}
                    data-tone={signal.tone}
                    onClick={() => a.reviewAttentionSignal(signal.key)}
                  >
                    <signal.icon size={19} aria-hidden="true" />
                    <span>
                      <strong>{signal.label}</strong>
                      <small>{signal.detail}</small>
                    </span>
                    <b>{signal.count}</b>
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="admin-empty">
                {incomplete ? (
                  <CircleHelp size={22} aria-hidden="true" />
                ) : (
                  <CheckCircle2 size={22} aria-hidden="true" />
                )}
                <div>
                  <strong>
                    {incomplete
                      ? "No signals in the available data"
                      : "No active attention signals"}
                  </strong>
                  <p>
                    Run diagnostics to check connected services and providers.
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </section>
      <div className="admin-overview-grid">
        <section className="field-panel">
          <div className="admin-card-heading">
            <Server size={18} aria-hidden="true" />
            <h2>Platform health</h2>
            <span
              className="admin-badge"
              data-tone={!health ? "neutral" : health.ok ? "good" : "critical"}
            >
              {!health ? "Unavailable" : health.ok ? "Online" : "Degraded"}
            </span>
          </div>
          <AdminNotice message={a.healthError} />
          <dl className="admin-facts">
            <div>
              <dt>Environment</dt>
              <dd>{health?.env || "—"}</dd>
            </div>
            <div>
              <dt>Uptime</dt>
              <dd>{health ? a.formatUptime(health.uptime) : "—"}</dd>
            </div>
            <div>
              <dt>Database</dt>
              <dd>
                {!health?.database
                  ? "Unavailable"
                  : !health.database.configured
                    ? "Not configured"
                    : health.database.connected
                      ? "Connected"
                      : "Disconnected"}
              </dd>
            </div>
            <div>
              <dt>Watch scheduler</dt>
              <dd>
                {a.objectiveWatchSchedulerError || !a.objectiveWatchScheduler
                  ? "Unavailable"
                  : a.schedulerHealthLabel(a.objectiveWatchScheduler.health)}
              </dd>
            </div>
          </dl>
          <AdminNotice message={a.objectiveWatchSchedulerError} />
          <button
            className="field-text-button"
            onClick={() => a.selectOperationsPanel("health")}
          >
            Review service health <ArrowRight size={14} aria-hidden="true" />
          </button>
          <Details
            title={
              a.healthError
                ? "Last available health snapshot"
                : "Full health snapshot"
            }
            value={a.health}
          />
        </section>
        <section className="field-panel">
          <div className="admin-card-heading">
            <Gauge size={18} aria-hidden="true" />
            <h2>Resources & caching</h2>
          </div>
          <AdminNotice message={a.systemResourcesError} />
          <ResourceMeter
            label="Memory"
            resource={resources?.memory}
            formatBytes={a.formatBytes}
          />
          <ResourceMeter
            label="Disk"
            resource={resources?.disk}
            formatBytes={a.formatBytes}
          />
          <dl className="admin-facts">
            <div>
              <dt>Cache hit rate</dt>
              <dd>
                {health && a.cacheMetrics.hitRate !== null
                  ? `${a.cacheMetrics.hitRate}%`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Cached entries</dt>
              <dd>{health ? a.cacheMetrics.entries.toLocaleString() : "—"}</dd>
            </div>
          </dl>
          <Details
            title={
              a.systemResourcesError || a.healthError
                ? "Last available resource and cache measurements"
                : "Resource and cache measurements"
            }
            value={{ resources: a.systemResources, caches: a.health?.caches }}
          />
        </section>
        <section className="field-panel">
          <div className="admin-card-heading">
            <Users size={18} aria-hidden="true" />
            <h2>Account activity</h2>
          </div>
          <AdminNotice message={a.usersError} />
          <dl className="admin-facts">
            {(
              [
                ["Total accounts", a.usersTotal],
                ["Active", a.userSummary.active],
                ["Suspended", a.userSummary.suspended],
                ["Unverified email", a.userSummary.unverified],
                ["Active sessions", a.userSummary.activeSessions],
              ] as const
            ).map(([label, count]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {a.loading || a.usersError ? "—" : count.toLocaleString()}
                </dd>
              </div>
            ))}
          </dl>
          <button
            className="field-text-button"
            onClick={() => a.setActiveSection("users")}
          >
            Manage accounts <ArrowRight size={14} aria-hidden="true" />
          </button>
        </section>
      </div>
    </>
  );
}
