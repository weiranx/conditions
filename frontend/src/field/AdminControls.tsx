import type {
  Administration,
  RuntimeEnvironmentEntry,
} from "./model/useAdministration";
import { AdminNotice } from "./Administration";
import { Details, DetailValues } from "./Details";
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
        <h3>{entry.label}</h3>
        <p>{entry.description}</p>
        <small>
          {entry.key} · {entry.source}
          {entry.restartRequired ? " · Restart required" : ""}
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
              Reset override
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
export function AdminControls({ a }: { a: Administration }) {
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
            <DetailValues value={a.diagnosticSummary} />
            <div className="field-detail-grid">
              {a.diagnosticServices.map((service) => (
                <article className="field-metric" key={service.id}>
                  <span className="field-kicker">
                    {service.status.replaceAll("_", " ")}
                  </span>
                  <h3>{service.name}</h3>
                  <p>{service.message}</p>
                  <small>
                    {service.latencyMs === null
                      ? "No response time"
                      : `${service.latencyMs} ms`}
                    {service.httpStatus ? ` · HTTP ${service.httpStatus}` : ""}
                  </small>
                </article>
              ))}
            </div>
          </section>
          <section className="field-panel">
            <h2>Health monitoring history</h2>
            <AdminNotice message={a.healthHistoryError} />
            <DetailValues value={a.healthHistory?.summary} />
            {a.healthHistory?.entries.map((entry, i) => (
              <Details
                key={`${entry.checkedAt}-${i}`}
                title={`${new Date(entry.checkedAt).toLocaleString()} · ${entry.summary}`}
                value={entry}
              />
            ))}
          </section>
        </>
      )}
      {a.activeOperationsPanel === "monitoring" && (
        <section className="field-panel">
          <h2>Objective Watch scheduler</h2>
          <p>
            {a.objectiveWatchScheduler?.message ||
              "Scheduler status is unavailable."}
          </p>
          <AdminNotice
            message={
              a.objectiveWatchSchedulerError || a.objectiveWatchSchedulerNotice
            }
          />
          <div className="field-action-row">
            <button
              className="field-button"
              disabled={
                a.objectiveWatchSchedulerPending ||
                !a.objectiveWatchScheduler?.configured
              }
              onClick={() =>
                void a.setObjectiveWatchSchedulerEnabled(
                  !a.objectiveWatchScheduler?.enabled,
                )
              }
            >
              {a.objectiveWatchScheduler?.enabled
                ? "Pause scheduler"
                : "Enable scheduler"}
            </button>
            <button
              className="field-button"
              disabled={
                a.objectiveWatchSchedulerRunPending ||
                !a.objectiveWatchScheduler?.configured ||
                a.objectiveWatchScheduler.running
              }
              onClick={() => void a.runObjectiveWatchChecksNow()}
            >
              Run due checks now
            </button>
            <label className="field-form-label">
              Check cadence
              <select
                value={a.objectiveWatchCheckIntervalDraft}
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
              disabled={
                a.objectiveWatchSchedulerPending || !a.objectiveWatchScheduler
              }
              onClick={() => void a.saveObjectiveWatchCheckInterval()}
            >
              Save cadence
            </button>
          </div>
          <DetailValues value={a.objectiveWatchScheduler} />
        </section>
      )}
      {a.activeOperationsPanel === "ai" && (
        <>
          <section className="field-panel">
            <h2>AI availability</h2>
            <AdminNotice message={a.aiSettingsError} />
            <fieldset disabled={a.aiSettingsPending || !a.aiSettings}>
              <div className="field-action-row">
                <label>
                  <input
                    type="checkbox"
                    checked={a.aiSettings?.enabled ?? false}
                    onChange={() => void a.toggleAIEnabled()}
                  />{" "}
                  Enable AI
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={a.aiSettings?.failoverEnabled ?? false}
                    onChange={a.toggleAIFailover}
                  />{" "}
                  Provider failover
                </label>
                <label className="field-form-label">
                  Active provider
                  <select
                    value={a.aiSettings?.provider || "openai"}
                    onChange={(e) =>
                      void a.updateAIControl({
                        provider: e.target
                          .value as (typeof a.AI_PROVIDERS)[number],
                      })
                    }
                  >
                    {a.AI_PROVIDERS.map((provider) => (
                      <option key={provider} value={provider}>
                        {a.aiProviderLabel(provider)}
                        {a.aiSettings?.providers[provider]?.configured
                          ? ""
                          : " · not configured"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {a.AI_FEATURE_CONTROLS.map((feature) => (
                <label className="field-admin-toggle" key={feature.key}>
                  <span>
                    <strong>{feature.label}</strong>
                    <small>{feature.description}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={
                      a.aiSettings?.features[feature.key]?.enabled ?? false
                    }
                    onChange={() => a.toggleAIFeature(feature.key)}
                  />
                </label>
              ))}
            </fieldset>
            <p>
              {a.aiSettings?.available
                ? "AI is available."
                : "AI is currently unavailable."}{" "}
              {a.aiSettings?.fallbackConfigured
                ? `Fallback: ${a.aiProviderLabel(a.aiSettings.fallbackProvider)}.`
                : "No configured fallback provider."}
            </p>
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
                    {a.aiSettings?.providers[provider]?.configured
                      ? "Configured"
                      : "Not configured"}
                  </small>
                </h3>
                <AdminNotice
                  message={a.aiModelCatalog?.providers[provider]?.error}
                />
                <div className="field-action-row">
                  {(["primary", "fast"] as const).map((kind) => (
                    <label key={kind} className="field-form-label">
                      {kind === "primary" ? "Primary model" : "Fast model"}
                      <input
                        list={`models-${provider}`}
                        value={a.modelDrafts[provider][kind]}
                        onChange={(e) =>
                          a.setModelDrafts((d) => ({
                            ...d,
                            [provider]: {
                              ...d[provider],
                              [kind]: e.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                  ))}
                  <datalist id={`models-${provider}`}>
                    {(
                      a.aiModelCatalog?.providers[provider]?.models ||
                      a.aiSettings?.providers[provider]?.options ||
                      []
                    ).map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                  <button
                    className="field-button"
                    disabled={a.aiSettingsPending || !a.aiSettings}
                    onClick={() => void a.saveProviderModels(provider)}
                  >
                    Save {a.aiProviderLabel(provider)} models
                  </button>
                </div>
              </article>
            ))}
          </section>
        </>
      )}
      {a.activeOperationsPanel === "features" && (
        <section className="field-panel">
          <h2>Product availability</h2>
          <p>
            Changes apply across the product. Existing reports retain their
            recorded feature settings.
          </p>
          <AdminNotice message={a.featureFlagsError} />
          <fieldset disabled={a.featureFlagsPending || !a.featureFlagStatus}>
            {a.PRODUCT_FEATURE_CONTROLS.map((feature) => (
              <label className="field-admin-toggle" key={feature.key}>
                <span>
                  <strong>{feature.label}</strong>
                  <small>{feature.description}</small>
                </span>
                <input
                  type="checkbox"
                  checked={a.featureFlagStatus?.flags[feature.key] ?? false}
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
            <h2>Runtime configuration</h2>
            <AdminNotice
              message={a.runtimeEnvironmentError || a.runtimeEnvironmentNotice}
            />
            <p>
              {a.runtimeEnvironment?.persistent
                ? "Overrides are saved persistently."
                : "Persistent configuration is unavailable."}{" "}
              {a.runtimeEnvironment?.restartRequired
                ? "Some saved changes require a backend restart."
                : ""}
            </p>
            <button
              className="field-button"
              disabled={
                a.backendRestartPending ||
                !a.backendRestartStatus?.available ||
                a.backendRestartStatus.scheduled
              }
              onClick={() => void a.restartBackend()}
            >
              {a.backendRestartPending
                ? "Restarting…"
                : a.backendRestartStatus?.scheduled
                  ? "Restart scheduled"
                  : "Restart backend"}
            </button>
            <p className="field-muted">{a.backendRestartStatus?.reason}</p>
          </section>
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
