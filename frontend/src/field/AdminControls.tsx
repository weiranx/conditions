import { useState } from "react";
import { ModelSelect } from "./ModelSelect";
import { modelOptions } from "./model/model-drafts";
import type {
  Administration,
  ObjectiveWatchSchedulerStatus,
  RuntimeEnvironmentEntry,
} from "./model/useAdministration";
import { AdminNotice } from "./Administration";
import { Details } from "./Details";

/** A relative time ("5m ago") with the full timestamp on hover. */
function When({
  a,
  value,
  fallback,
}: {
  a: Administration;
  value: string | null | undefined;
  fallback: string;
}) {
  if (!value) return <>{fallback}</>;
  const date = new Date(value);
  return (
    <time
      dateTime={value}
      title={Number.isNaN(date.getTime()) ? undefined : date.toLocaleString()}
    >
      {a.formatAccountDate(value)}
    </time>
  );
}

function describeWatchRun(
  summary: ObjectiveWatchSchedulerStatus["lastSummary"],
): string {
  if (!summary) return "No completed runs yet";
  const parts = [
    `${summary.checked ?? 0} checked`,
    `${summary.changed ?? 0} changed`,
    `${summary.failed ?? 0} failed`,
  ];
  if (summary.notificationsSent)
    parts.push(
      `${summary.notificationsSent} ${summary.notificationsSent === 1 ? "alert" : "alerts"} sent`,
    );
  return parts.join(" · ");
}

const SCHEDULER_TONES: Record<
  ObjectiveWatchSchedulerStatus["health"],
  "good" | "critical" | "neutral"
> = {
  healthy: "good",
  running: "good",
  waiting: "neutral",
  stopped: "neutral",
  not_configured: "critical",
  unhealthy: "critical",
  failed: "critical",
};

const HEALTH_CHECKS_SHOWN = 8;

function HealthCheckHistory({ a }: { a: Administration }) {
  const [showAll, setShowAll] = useState(false);
  const entries = a.healthHistory?.entries ?? [];
  const summary = a.healthHistory?.summary;
  const visible = showAll ? entries : entries.slice(0, HEALTH_CHECKS_SHOWN);
  return (
    <section className="field-panel">
      <div className="field-section-heading">
        <h2>Automated health checks</h2>
        {summary?.availabilityPercent != null && (
          <span
            className="admin-badge"
            data-tone={summary.unhealthy > 0 ? "warning" : "good"}
          >
            {summary.availabilityPercent}% healthy
          </span>
        )}
      </div>
      <p>
        Scheduled checks of the public health endpoint and the alert emails
        they sent.
      </p>
      <AdminNotice message={a.healthHistoryError} />
      {summary && entries.length > 0 ? (
        <>
          <dl className="admin-tiles">
            <div>
              <dt>Checks</dt>
              <dd>{summary.total.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Unhealthy</dt>
              <dd>{summary.unhealthy.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Last check</dt>
              <dd>
                <When a={a} value={summary.lastCheckAt} fallback="—" />
              </dd>
            </div>
            <div>
              <dt>Last failure</dt>
              <dd>
                <When
                  a={a}
                  value={summary.lastUnhealthyAt}
                  fallback="None recorded"
                />
              </dd>
            </div>
          </dl>
          <div
            className="admin-uptime"
            role="img"
            aria-label={`${summary.healthy} of ${summary.total} recorded checks were healthy`}
          >
            {[...entries].reverse().map((entry, i) => (
              <i
                key={`${entry.checkedAt}-${i}`}
                className={entry.healthy ? undefined : "is-failed"}
                title={`${a.formatSchedulerTimestamp(entry.checkedAt)} · ${entry.summary}`}
              />
            ))}
          </div>
          <div className="admin-uptime-axis" aria-hidden="true">
            <span>Oldest</span>
            <span>Latest</span>
          </div>
          <ul className="admin-services admin-checks">
            {visible.map((entry, i) => (
              <li
                className={`admin-service${entry.healthy ? "" : " is-failed"}`}
                key={`${entry.checkedAt}-${i}`}
              >
                <span className="admin-service-dot" aria-hidden="true" />
                <span>
                  <strong>{entry.summary}</strong>
                  <small>
                    {a.formatSchedulerTimestamp(entry.checkedAt)} ·{" "}
                    {entry.statusCode ? `HTTP ${entry.statusCode}` : "No response"}
                    {entry.durationMs !== null
                      ? ` · ${a.formatDuration(entry.durationMs)}`
                      : ""}
                  </small>
                  {entry.alertError && (
                    <small className="admin-check-error">
                      Alert email failed: {entry.alertError}
                    </small>
                  )}
                </span>
                <span className="admin-service-meta">
                  <b>{entry.healthy ? "Healthy" : "Unhealthy"}</b>
                  <small>{a.formatHealthMonitorAction(entry.action)}</small>
                </span>
              </li>
            ))}
          </ul>
          {entries.length > HEALTH_CHECKS_SHOWN && (
            <button
              className="field-text-button"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll
                ? "Show recent checks only"
                : `Show all ${entries.length} checks`}
            </button>
          )}
        </>
      ) : (
        !a.healthHistoryError && (
          <p className="sky-empty">
            No automated health checks have been recorded yet.
          </p>
        )
      )}
    </section>
  );
}

function WatchScheduler({ a }: { a: Administration }) {
  const s = a.objectiveWatchScheduler;
  const cadenceChanged =
    !!s && a.objectiveWatchCheckIntervalDraft !== String(s.checkIntervalMinutes);
  return (
    <section className="field-panel">
      <div className="field-section-heading">
        <h2>Objective Watch scheduler</h2>
        <span
          className="admin-badge"
          data-tone={s ? SCHEDULER_TONES[s.health] : "neutral"}
        >
          {s ? a.schedulerHealthLabel(s.health) : "Unavailable"}
        </span>
      </div>
      <p>{s?.message || "Scheduler status is unavailable."}</p>
      <AdminNotice message={a.objectiveWatchSchedulerError} />
      <AdminNotice message={a.objectiveWatchSchedulerNotice} tone="success" />
      {s && (
        <dl className="admin-facts admin-facts-grid">
          <div>
            <dt>Automatic checks</dt>
            <dd>{s.enabled ? "On" : "Paused"}</dd>
          </div>
          <div>
            <dt>Watch check cadence</dt>
            <dd>{a.formatCheckIntervalChoice(s.checkIntervalMinutes)}</dd>
          </div>
          <div>
            <dt>Last heartbeat</dt>
            <dd>
              <When a={a} value={s.lastHeartbeatAt} fallback="Not received yet" />
            </dd>
          </div>
          <div>
            <dt>Last completed run</dt>
            <dd>
              <When a={a} value={s.lastCompletedAt} fallback="No runs yet" />
            </dd>
          </div>
          <div>
            <dt>Last run result</dt>
            <dd>{describeWatchRun(s.lastSummary)}</dd>
          </div>
          {s.lastError && s.health !== "failed" && (
            <div>
              <dt>Last error</dt>
              <dd>{s.lastError}</dd>
            </div>
          )}
        </dl>
      )}
      <div className="field-action-row">
        <button
          className="field-button"
          disabled={a.objectiveWatchSchedulerPending || !s?.configured}
          onClick={() => void a.setObjectiveWatchSchedulerEnabled(!s?.enabled)}
        >
          {s?.enabled ? "Pause automatic checks" : "Enable automatic checks"}
        </button>
        <button
          className="field-button"
          disabled={
            a.objectiveWatchSchedulerRunPending || !s?.configured || s.running
          }
          onClick={() => void a.runObjectiveWatchChecksNow()}
        >
          {a.objectiveWatchSchedulerRunPending
            ? "Running checks…"
            : "Run due checks now"}
        </button>
      </div>
      <div className="field-action-row">
        <label className="field-form-label">
          Check cadence
          <select
            value={a.objectiveWatchCheckIntervalDraft}
            disabled={!s}
            onChange={(e) =>
              a.setObjectiveWatchCheckIntervalDraft(e.target.value)
            }
          >
            {a.OBJECTIVE_WATCH_INTERVAL_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {a.formatCheckIntervalChoice(n)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="field-button"
          disabled={a.objectiveWatchSchedulerPending || !cadenceChanged}
          onClick={() => void a.saveObjectiveWatchCheckInterval()}
        >
          Save cadence
        </button>
      </div>
      <Details title="Scheduler status record" value={s} />
    </section>
  );
}

function aiStatusLine(a: Administration): string {
  const s = a.aiSettings;
  if (!s) return "AI status is unavailable.";
  if (!s.enabled)
    return "AI is stopped. Every AI feature is unavailable until it is enabled again.";
  const provider = a.aiProviderLabel(s.provider);
  if (!s.available)
    return `AI is on but unavailable: ${provider} is not configured${s.failoverEnabled ? " and no other provider is" : ""}.`;
  const failover = !s.failoverEnabled
    ? "Failover is off."
    : s.fallbackConfigured
      ? `Failed or timed-out requests retry with ${a.aiProviderLabel(s.fallbackProvider)}.`
      : "No other provider is configured for failover.";
  return `Requests use ${provider}. ${failover}`;
}

function AIControls({ a }: { a: Administration }) {
  const s = a.aiSettings;
  return (
    <>
      <section className="field-panel">
        <div className="field-section-heading">
          <h2>AI availability</h2>
          <span
            className="admin-badge"
            data-tone={!s ? "neutral" : s.available ? "good" : "warning"}
          >
            {!s ? "Unavailable" : s.available ? "Available" : s.enabled ? "Unavailable" : "Stopped"}
          </span>
        </div>
        <p>{aiStatusLine(a)}</p>
        <AdminNotice message={a.aiSettingsError} />
        {s && !s.persistent && (
          <AdminNotice message="Persistent storage is unavailable, so AI changes last until the backend restarts." />
        )}
        <fieldset disabled={a.aiSettingsPending || !s}>
          <label className="field-admin-toggle">
            <span>
              <strong>AI features</strong>
              <small>Master switch for every AI feature below.</small>
            </span>
            <input
              type="checkbox"
              checked={s?.enabled ?? false}
              onChange={() => void a.toggleAIEnabled()}
            />
          </label>
          <label className="field-admin-toggle">
            <span>
              <strong>Provider failover</strong>
              <small>
                Retry failed or timed-out requests with another configured
                provider.
              </small>
            </span>
            <input
              type="checkbox"
              checked={s?.failoverEnabled ?? false}
              onChange={a.toggleAIFailover}
            />
          </label>
          <label className="field-admin-toggle admin-select-row">
            <span>
              <strong>Active provider</strong>
              <small>Handles every AI request unless it fails over.</small>
            </span>
            <select
              value={s?.provider || "openai"}
              onChange={(e) =>
                void a.updateAIControl({
                  provider: e.target.value as (typeof a.AI_PROVIDERS)[number],
                })
              }
            >
              {a.AI_PROVIDERS.map((provider) => {
                const configured = s?.providers[provider]?.configured;
                return (
                  <option
                    key={provider}
                    value={provider}
                    disabled={!configured && s?.provider !== provider}
                  >
                    {a.aiProviderLabel(provider)}
                    {configured ? "" : " · not configured"}
                  </option>
                );
              })}
            </select>
          </label>
        </fieldset>
      </section>
      <section className="field-panel">
        <h2>AI features</h2>
        <p>Each feature also needs AI to be on and a configured provider.</p>
        <fieldset disabled={a.aiSettingsPending || !s}>
          {a.AI_FEATURE_CONTROLS.map((feature) => {
            const state = s?.features[feature.key];
            return (
              <label className="field-admin-toggle" key={feature.key}>
                <span>
                  <strong>{feature.label}</strong>
                  <small>{feature.description}</small>
                  {state?.enabled && !state.available && (
                    <small className="admin-toggle-note">
                      {s?.enabled
                        ? "Unavailable until a provider is configured"
                        : "Unavailable while AI is stopped"}
                    </small>
                  )}
                </span>
                <input
                  type="checkbox"
                  checked={state?.enabled ?? false}
                  onChange={() => a.toggleAIFeature(feature.key)}
                />
              </label>
            );
          })}
        </fieldset>
      </section>
      <section className="field-panel">
        <div className="field-section-heading">
          <h2>Provider models</h2>
          <button
            className="field-button"
            disabled={a.aiModelCatalogPending}
            onClick={() => void a.refreshModelCatalog()}
          >
            {a.aiModelCatalogPending
              ? "Loading catalog…"
              : "Refresh model catalog"}
          </button>
        </div>
        <AdminNotice message={a.aiModelCatalogError} />
        {a.AI_PROVIDERS.map((provider) => (
          <article className="field-admin-setting" key={provider}>
            <h3>
              {a.aiProviderLabel(provider)}{" "}
              <small>
                {s?.providers[provider]?.configured
                  ? "Configured"
                  : "Not configured"}
              </small>
              {s?.provider === provider && (
                <span className="admin-badge" data-tone="good">
                  Active
                </span>
              )}
            </h3>
            <AdminNotice
              message={a.aiModelCatalog?.providers[provider]?.error}
            />
            <div className="field-action-row">
              {(["primary", "fast"] as const).map((kind) => (
                <ModelSelect
                  key={kind}
                  label={`${a.aiProviderLabel(provider)} ${kind === "primary" ? "primary" : "fast"} model`}
                  value={a.modelDrafts[provider][kind]}
                  options={modelOptions(
                    a.aiModelCatalog?.providers[provider]?.models || [],
                    [
                      s?.providers[provider]?.primary || "",
                      s?.providers[provider]?.fast || "",
                      ...(s?.providers[provider]?.options || []),
                    ],
                  )}
                  disabled={a.aiSettingsPending || !s}
                  onChange={(value) =>
                    a.setModelDrafts((current) => ({
                      ...current,
                      [provider]: { ...current[provider], [kind]: value },
                    }))
                  }
                />
              ))}
              <button
                className="field-button"
                disabled={
                  a.aiSettingsPending ||
                  !s ||
                  !a.modelDrafts[provider].primary.trim() ||
                  !a.modelDrafts[provider].fast.trim() ||
                  (a.modelDrafts[provider].primary ===
                    s.providers[provider].primary &&
                    a.modelDrafts[provider].fast ===
                      s.providers[provider].fast)
                }
                onClick={() => void a.saveProviderModels(provider)}
              >
                Save {a.aiProviderLabel(provider)} models
              </button>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}

function EnvironmentField({
  a,
  entry,
}: {
  a: Administration;
  entry: RuntimeEnvironmentEntry;
}) {
  const value = a.runtimeEnvironmentDrafts[entry.key] ?? "";
  const setValue = (value: string) =>
    a.setRuntimeEnvironmentDrafts((d) => ({ ...d, [entry.key]: value }));
  return (
    <article className="field-admin-setting">
      <div>
        <h3>
          {entry.label}
          {entry.overridden && <span className="admin-badge">Overridden</span>}
        </h3>
        <p>{entry.description}</p>
        <small>
          <code>{entry.key}</code> · {entry.source}
        </small>
      </div>
      {entry.editable ? (
        <div className="field-action-row">
          <label className="field-form-label">
            <span className="field-sr-only">{entry.label}</span>
            {entry.options || entry.type === "boolean" ? (
              <select value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">Choose a value</option>
                {(entry.options || ["true", "false"]).map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            ) : (
              <input
                type={
                  entry.secret
                    ? "password"
                    : entry.type === "integer"
                      ? "number"
                      : entry.type === "url"
                        ? "url"
                        : "text"
                }
                autoComplete="off"
                min={entry.min ?? undefined}
                max={entry.max ?? undefined}
                value={value}
                placeholder={
                  entry.secret && entry.configured
                    ? "Enter replacement value"
                    : "Not configured"
                }
                onChange={(e) => setValue(e.target.value)}
              />
            )}
          </label>
          <button
            className="field-button"
            disabled={
              !!a.runtimeEnvironmentPendingKey ||
              !value.trim() ||
              (!entry.secret && value === entry.value)
            }
            onClick={() => void a.updateRuntimeEnvironmentEntry(entry)}
          >
            Save
          </button>
          {entry.overridden && (
            <button
              className="field-button"
              disabled={!!a.runtimeEnvironmentPendingKey}
              onClick={() => void a.updateRuntimeEnvironmentEntry(entry, true)}
            >
              Use deployment value
            </button>
          )}
        </div>
      ) : (
        <p>
          {entry.configured ? "Configured" : "Not configured"} · Managed in
          deployment settings
        </p>
      )}
    </article>
  );
}

function Maintenance({ a }: { a: Administration }) {
  const caches = a.healthError ? [] : (a.health?.caches ?? []);
  const restart = a.backendRestartStatus;
  return (
    <section className="field-panel">
      <h2>Maintenance</h2>
      <AdminNotice message={a.maintenanceError} />
      <AdminNotice message={a.maintenanceNotice} tone="success" />
      <article className="field-admin-setting admin-maintenance">
        <div>
          <h3>Restart backend</h3>
          <p>
            Starts a fresh backend process so saved configuration changes take
            effect. Requests may fail for a few seconds.
          </p>
          {restart?.reason && <small>{restart.reason}</small>}
        </div>
        <button
          className="field-button"
          disabled={
            a.backendRestartPending || !restart?.available || restart.scheduled
          }
          onClick={() => void a.restartBackend()}
        >
          {a.backendRestartPending
            ? "Restarting…"
            : restart?.scheduled
              ? "Restart scheduled"
              : "Restart backend"}
        </button>
      </article>
      <article className="field-admin-setting admin-maintenance">
        <div>
          <h3>Clear caches</h3>
          <p>
            Discards cached forecasts and provider responses so the next reports
            fetch fresh data.
          </p>
          <small>
            {a.healthError || !a.health
              ? "Cache measurements are unavailable."
              : `${a.cacheMetrics.entries.toLocaleString()} cached ${a.cacheMetrics.entries === 1 ? "entry" : "entries"} across ${caches.length} ${caches.length === 1 ? "cache" : "caches"}${a.cacheMetrics.hitRate !== null ? ` · ${a.cacheMetrics.hitRate}% hit rate` : ""}`}
          </small>
        </div>
        <button
          className="field-button"
          disabled={a.cacheClearPending}
          onClick={() => void a.clearBackendCaches()}
        >
          {a.cacheClearPending ? "Clearing…" : "Clear caches"}
        </button>
      </article>
    </section>
  );
}

export function AdminControls({ a }: { a: Administration }) {
  const flags = a.featureFlagStatus;
  return (
    <>
      <nav className="field-chapter-nav" aria-label="Operational controls">
        {a.ADMIN_OPERATIONS_PANELS.map((p) => (
          <button
            key={p.value}
            aria-current={
              a.activeOperationsPanel === p.value ? "page" : undefined
            }
            onClick={() => a.setActiveOperationsPanel(p.value)}
          >
            {p.label}
          </button>
        ))}
      </nav>
      {a.activeOperationsPanel === "health" && (
        <>
          <section className="field-panel">
            <div className="field-section-heading">
              <h2>Service diagnostics</h2>
              <button
                className="field-button"
                disabled={a.diagnosticsPending}
                onClick={() => void a.runServiceDiagnostics()}
              >
                {a.diagnosticsPending
                  ? "Checking services…"
                  : "Run diagnostics"}
              </button>
            </div>
            <AdminNotice message={a.diagnosticsError || a.healthError} />
            <p className="admin-summary-chips">
              <span className="sky-chip">{a.diagnosticSummary.total} services</span>
              <span className="sky-chip">{a.diagnosticSummary.operational} operational</span>
              {a.diagnosticSummary.failed > 0 && (
                <span className="sky-chip is-over">{a.diagnosticSummary.failed} failed</span>
              )}
              {a.diagnosticSummary.notConfigured > 0 && (
                <span className="sky-chip is-missing">{a.diagnosticSummary.notConfigured} not configured</span>
              )}
            </p>
            <ul className="admin-services">
              {a.diagnosticServices.map((service) => (
                <li className={`admin-service is-${service.status}`} key={service.id}>
                  <span className="admin-service-dot" aria-hidden="true" />
                  <span>
                    <strong>{service.name}</strong>
                    <small>{service.message}</small>
                  </span>
                  <span className="admin-service-meta">
                    <b>{service.status.replaceAll("_", " ")}</b>
                    <small>
                      {service.latencyMs === null
                        ? "No response time"
                        : `${service.latencyMs} ms`}
                      {service.httpStatus ? ` · HTTP ${service.httpStatus}` : ""}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
            <p className="sky-cap admin-table-foot">
              {a.diagnostics ? (
                <>
                  Last external check:{" "}
                  <When a={a} value={a.diagnostics.completedAt} fallback="—" />
                </>
              ) : (
                "External data providers and integrations are checked when you run diagnostics."
              )}
            </p>
          </section>
          <HealthCheckHistory a={a} />
        </>
      )}
      {a.activeOperationsPanel === "monitoring" && <WatchScheduler a={a} />}
      {a.activeOperationsPanel === "ai" && <AIControls a={a} />}
      {a.activeOperationsPanel === "features" && (
        <section className="field-panel">
          <div className="field-section-heading">
            <h2>Product availability</h2>
            {flags && (
              <span className="admin-badge">
                {a.enabledFeatureCount} of {Object.keys(flags.flags).length} on
              </span>
            )}
          </div>
          <p>
            Changes apply across the product. Existing reports retain their
            recorded feature settings.
          </p>
          <AdminNotice message={a.featureFlagsError} />
          {flags && !flags.persistent && (
            <AdminNotice message="Persistent storage is unavailable, so feature changes last until the backend restarts." />
          )}
          <fieldset disabled={a.featureFlagsPending || !flags}>
            {a.PRODUCT_FEATURE_CONTROLS.map((feature) => (
              <label className="field-admin-toggle" key={feature.key}>
                <span>
                  <strong>{feature.label}</strong>
                  <small>{feature.description}</small>
                </span>
                <input
                  type="checkbox"
                  checked={flags?.flags[feature.key] ?? false}
                  onChange={() => void a.toggleProductFeature(feature.key)}
                />
              </label>
            ))}
          </fieldset>
        </section>
      )}
      {a.activeOperationsPanel === "environment" && (
        <>
          <section className="field-panel">
            <div className="field-section-heading">
              <h2>Runtime configuration</h2>
              {a.runtimeOverrideCount > 0 && (
                <span className="admin-badge">
                  {a.runtimeOverrideCount} overridden
                </span>
              )}
            </div>
            <p>
              {a.runtimeEnvironment?.persistent
                ? "Overrides are saved persistently."
                : "Persistent configuration is unavailable."}{" "}
              {a.runtimeEnvironment?.restartRequired
                ? "Saved changes take effect after a backend restart."
                : ""}
            </p>
            <AdminNotice message={a.runtimeEnvironmentError} />
            <AdminNotice message={a.runtimeEnvironmentNotice} tone="success" />
          </section>
          <Maintenance a={a} />
          {a.runtimeEnvironmentGroups.map(([category, entries]) => (
            <section className="field-panel" key={category}>
              <h2>{category}</h2>
              {entries.map((entry) => (
                <EnvironmentField key={entry.key} a={a} entry={entry} />
              ))}
            </section>
          ))}
        </>
      )}
    </>
  );
}
