import { CircleCheck, CircleX, RefreshCw, TriangleAlert } from "lucide-react";
import type { Workspace } from "./model/useWorkspace";
import { ageLabel } from "./data";
import "./operations.css";

const STATUS = {
  ok: { label: "Operational", Icon: CircleCheck },
  warn: { label: "Degraded", Icon: TriangleAlert },
  down: { label: "Unavailable", Icon: CircleX },
} as const;

export default function Operations({ workspace: w }: { workspace: Workspace }) {
  const checks = w.healthChecks;
  const issues = checks.filter((check) => check.status !== "ok").length;
  const down = checks.some((check) => check.status === "down");
  const summary = !checks.length
    ? { tone: "idle", title: w.healthLoading ? "Checking services…" : "No checks yet", note: "Run the checks to see each service." }
    : issues
      ? { tone: down ? "down" : "warn", title: `${issues} of ${checks.length} services need attention`, note: "Reports keep working with partial data where a source is unavailable." }
      : { tone: "ok", title: "All systems operational", note: `${checks.length} services responding normally.` };
  return (
    <section className="sky-screen sky-status-screen">
      <header className="field-page-heading">
        <span className="field-kicker">Service status</span>
        <h1>System status</h1>
        <p className="sky-lead"><span className="sky-lead-note">Checked {ageLabel(w.healthCheckedAt)}</span></p>
      </header>
      <div className={`sky-card sky-status-hero is-${summary.tone}`} role="status">
        <span className="sky-status-orb" aria-hidden="true" />
        <div>
          <h2>{summary.title}</h2>
          <p>{summary.note}</p>
        </div>
        <button
          className="field-button"
          disabled={w.healthLoading}
          onClick={() => void w.runHealthChecks()}
        >
          <RefreshCw size={16} aria-hidden="true" className={w.healthLoading ? "field-spin" : undefined} />
          {w.healthLoading ? "Checking…" : "Run checks"}
        </button>
      </div>
      {w.healthError && (
        <p className="sky-notice is-caution" role="alert">
          {w.healthError}
        </p>
      )}
      {checks.length > 0 && (
        <section className="sky-status-section" aria-labelledby="status-services">
          <div className="sky-sh">
            <h2 id="status-services">Services</h2>
          </div>
          <ul className="sky-card sky-status-list">
            {checks.map((check) => {
              const { label, Icon } = STATUS[check.status] || STATUS.warn;
              return (
                <li key={check.label} className={`sky-status-row is-${check.status}`}>
                  <Icon size={20} aria-hidden="true" />
                  <div>
                    <h3>{check.label}</h3>
                    <p>{check.detail}</p>
                    {check.meta && <small>{check.meta}</small>}
                  </div>
                  <span className="sky-status-label">{label}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </section>
  );
}
