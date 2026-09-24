import { useState } from "react";
import type { FreshnessState, SourceFreshnessRow } from "../../app/types";

const STATE_LABEL: Record<FreshnessState, string> = { fresh: "Current", aging: "Aging", stale: "Stale", missing: "Missing" };

/**
 * How old each source is, on one axis running from older (left) to now
 * (right). Each row shades the part of the axis where that source would count
 * as stale; a source with no timestamp is drawn as missing, never as current.
 * Each row's state is the backend's.
 */
export function FreshnessChart({ rows, age, stamp }: {
  rows: SourceFreshnessRow[];
  age: (issued: string | null) => string;
  stamp: (issued: string) => string;
}) {
  // Ages are measured once, when the chart first renders, like the rest of the report.
  const [now] = useState(() => Date.now());
  const hoursOld = (issued: string | null) => {
    const ms = issued ? Date.parse(issued) : NaN;
    return Number.isFinite(ms) ? Math.max(0, (now - ms) / 3600000) : null;
  };
  const ages = rows.map((r) => hoursOld(r.issued)).filter((v): v is number => v !== null);
  const span = Math.min(72, Math.max(24, ...rows.map((r) => r.staleHours * 1.25), ...ages.map((a) => Math.ceil(a / 6) * 6)));
  const pos = (hours: number) => `${(1 - Math.min(hours, span) / span) * 100}%`;
  const ticks = [span, span * 0.75, span * 0.5, span * 0.25, 0].map((h) => Math.round(h));
  return (
    <div className="sky-fresh">
      <ul className="sky-fresh-rows">
        {rows.map((row) => {
          const state = row.state;
          const hours = hoursOld(row.issued);
          return (
            <li key={row.label} className={`sky-fresh-row is-${state}`}>
              <span className="sky-fresh-label">{row.label}</span>
              <span className="sky-fresh-track" aria-hidden="true">
                <i className="sky-fresh-stale" style={{ left: 0, width: `${(1 - Math.min(row.staleHours, span) / span) * 100}%` }} />
                {hours !== null ? (
                  <>
                    <i className="sky-fresh-bar" style={{ left: pos(hours), right: 0 }} />
                    <b className="sky-fresh-dot" style={{ left: pos(hours) }} />
                  </>
                ) : (
                  <b className="sky-fresh-missing" style={{ left: "100%" }} />
                )}
              </span>
              <span className="sky-fresh-value">
                <strong>{STATE_LABEL[state]}</strong>
                <small>
                  {row.displayValue || age(row.issued)}
                  {row.issued ? <> · {stamp(row.issued)}</> : " · timestamp unavailable"}
                </small>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="sky-fresh-axis" aria-hidden="true">
        <span />
        <span className="sky-fresh-ticks">
          {ticks.map((t) => <span key={t} style={{ left: pos(t) }}>{t === 0 ? "now" : `${t} h`}</span>)}
        </span>
        <span />
      </div>
      <p className="sky-legend-line"><i className="sky-fresh-stale is-legend" /> Shaded: older than that source's freshness limit</p>
    </div>
  );
}
