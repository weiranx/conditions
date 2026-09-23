import type { ReactNode } from "react";
import type { SkyHour } from "./sky-model";
import { isOverHour } from "./sky-model";

export type TimelineRow = {
  key: string;
  label: string;
  sub?: string;
  start: number;
  hours: SkyHour[];
  summit: number | null;
  best?: boolean;
  current?: boolean;
  note: ReactNode;
  noteTone: "ok" | "over" | "missing";
  action?: ReactNode;
};

/**
 * Departures side by side on one clock. Each hour of each departure is drawn
 * from that departure's own forecast: hatched when a reading crosses a limit,
 * dashed when readings are missing, dark after sunset or before sunrise.
 */
export function StartTimeline({ rows, sunrise, sunset, clock, caption }: {
  rows: TimelineRow[];
  sunrise: number | null;
  sunset: number | null;
  clock: (minute: number) => string;
  caption: string;
}) {
  if (rows.length === 0) return null;
  const starts = rows.map((r) => r.start);
  const ends = rows.map((r) => r.start + r.hours.length * 60);
  let lo = Math.floor((Math.min(...starts) - 30) / 60) * 60;
  let hi = Math.ceil((Math.max(...ends) + 30) / 60) * 60;
  if (sunrise !== null && sunrise < lo && lo - sunrise <= 120) lo = Math.floor(sunrise / 60) * 60;
  if (sunset !== null && sunset > hi && sunset - hi <= 120) hi = Math.ceil(sunset / 60) * 60;
  const span = Math.max(60, hi - lo);
  const pct = (m: number) => `${((m - lo) / span) * 100}%`;
  const width = (m: number) => `${(m / span) * 100}%`;
  const step = span > 16 * 60 ? 240 : span > 9 * 60 ? 180 : 120;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  const shade = (from: number, to: number) => {
    const a = Math.max(lo, from), b = Math.min(hi, to);
    return b > a ? { left: pct(a), width: width(b - a) } : null;
  };
  // Night bands across the whole axis, repeated for trips that pass midnight.
  const nights: { left: string; width: string }[] = [];
  if (sunrise !== null && sunset !== null) {
    for (let day = Math.floor(lo / 1440) * 1440; day < hi; day += 1440) {
      const before = shade(day, day + sunrise);
      const after = shade(day + sunset, day + 1440);
      if (before) nights.push(before);
      if (after) nights.push(after);
    }
  }
  return (
    <figure className="sky-timeline">
      <figcaption className="sr-only">{caption}</figcaption>
      <div className="sky-timeline-rows">
        {rows.map((row) => (
          <div key={row.key} className={`sky-timeline-row${row.best ? " is-best" : ""}${row.current ? " is-current" : ""}`}>
            <div className="sky-timeline-label">
              <strong>{row.label}</strong>
              {row.sub && <span>{row.sub}</span>}
            </div>
            <div className="sky-timeline-track" aria-hidden="true">
              {nights.map((n, i) => <i key={i} className="sky-timeline-night" style={n} />)}
              <i className="sky-timeline-base" style={{ left: pct(row.start), width: width(row.hours.length * 60) }} />
              {row.hours.map((h) => (
                <i key={h.index} className={`sky-timeline-hour is-${isOverHour(h) ? "over" : h.tone}${h.night ? " is-night" : ""}`}
                  style={{ left: pct(row.start + h.index * 60), width: width(60) }} />
              ))}
              {row.summit !== null && <b className="sky-timeline-summit" style={{ left: pct(row.summit) }} />}
            </div>
            <div className={`sky-timeline-note is-${row.noteTone}`}>
              {row.note}
              {row.action}
            </div>
          </div>
        ))}
      </div>
      <div className="sky-timeline-axis" aria-hidden="true">
        <span />
        <div>
          {ticks.map((t) => <span key={t} style={{ left: pct(t) }}>{clock(t)}</span>)}
        </div>
        <span />
      </div>
      <ul className="sky-legend" aria-label="Legend">
        <li><i className="is-within" />On the trail</li>
        <li><i className="is-over" />Over your limits</li>
        <li><i className="is-missing" />Readings incomplete</li>
        <li><i className="is-night" />Dark</li>
        <li><b className="sky-timeline-summit is-legend" />Halfway point</li>
      </ul>
    </figure>
  );
}
