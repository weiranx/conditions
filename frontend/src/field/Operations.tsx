import type { Workspace } from "./model/useWorkspace";
import { ageLabel } from "./data";
export default function Operations({ workspace: w }: { workspace: Workspace }) {
  return (
    <section>
      <header className="field-page-heading">
        <span className="field-kicker">Service status</span>
        <h1>System status</h1>
        <p>Checked {ageLabel(w.healthCheckedAt)}</p>
      </header>
      <button
        className="field-button"
        disabled={w.healthLoading}
        onClick={() => void w.runHealthChecks()}
      >
        {w.healthLoading ? "Checking…" : "Run checks"}
      </button>
      {w.healthError && (
        <p className="field-warning" role="alert">
          {w.healthError}
        </p>
      )}
      <div className="field-detail-grid">
        {w.healthChecks.map((check) => (
          <article className="field-panel" key={check.label}>
            <span className="field-kicker">{check.status}</span>
            <h2>{check.label}</h2>
            <p>{check.detail}</p>
            <small>{check.meta}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
