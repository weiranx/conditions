import { useId, type ReactNode } from "react";
import type { SkyHour } from "./sky-model";
import { isOverHour } from "./sky-model";
import { useWidth } from "./useWidth";

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

const SKY = { night: "#26304a", twilight: "#f0b98a", day: "#8fbde6" };

/**
 * The day's sky over the departures' clock: night, twilight and daylight
 * shade the backdrop, the sun's arc runs from sunrise to sunset, and each
 * departure is drawn as its own climb and descent, with the hours that cross
 * a limit in the caution colour. Your plan and the best margin are emphasised.
 */
function DepartureSky({ rows, lo, hi, sunrise, sunset, clock }: {
  rows: TimelineRow[];
  lo: number;
  hi: number;
  sunrise: number | null;
  sunset: number | null;
  clock: (minute: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(600);
  const id = useId().replace(/:/g, "");
  const height = 118;
  const horizon = height - 16;
  const x = (m: number) => ((m - lo) / (hi - lo)) * width;
  const known = sunrise !== null && sunset !== null && sunset > sunrise;
  const light = (m: number) => {
    if (!known) return SKY.day;
    const d = ((m % 1440) + 1440) % 1440;
    if (d < sunrise - 30 || d > sunset + 30) return SKY.night;
    if (Math.abs(d - sunrise) <= 45 || Math.abs(d - sunset) <= 45) return SKY.twilight;
    return SKY.day;
  };
  const stops: { offset: number; color: string }[] = [];
  for (let m = lo; m <= hi; m += 15) stops.push({ offset: (m - lo) / (hi - lo), color: light(m) });
  const sunTop = 14;
  // Height of the sun at minute m on the day whose midnight is `day`.
  const arcAt = (day: number) => (m: number) => {
    const t = (m - day - (sunrise as number)) / ((sunset as number) - (sunrise as number));
    return horizon - Math.sin(Math.PI * t) * (horizon - sunTop);
  };
  // Overnight trips span more than one day, so draw each day's sun that falls in view.
  const days: number[] = [];
  if (known) for (let day = Math.floor(lo / 1440) * 1440; day < hi; day += 1440) {
    if (day + sunset! > lo && day + sunrise! < hi) days.push(day);
  }
  const sample = (from: number, to: number, f: (m: number) => number) => {
    const pts: string[] = [];
    const n = Math.max(2, Math.ceil((to - from) / 10));
    for (let k = 0; k <= n; k += 1) {
      const m = from + ((to - from) * k) / n;
      pts.push(`${x(m).toFixed(1)},${f(m).toFixed(1)}`);
    }
    return pts.join(" ");
  };
  const tripHeight = (horizon - sunTop) * 0.55;
  return (
    <div className="sky-timeline-sky" ref={ref} aria-hidden="true">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id={`${id}-sky`} x1="0" x2="1">
            {stops.map((stop, i) => <stop key={i} offset={stop.offset.toFixed(4)} stopColor={stop.color} />)}
          </linearGradient>
          <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.9" /><stop offset="1" stopColor="#fff" stopOpacity="0.35" />
          </linearGradient>
          <mask id={`${id}-mask`}><rect width={width} height={height} fill={`url(#${id}-fade)`} /></mask>
        </defs>
        <rect width={width} height={horizon} rx="10" fill={`url(#${id}-sky)`} mask={`url(#${id}-mask)`} className="tl-sky" />
        {days.map((day) => {
          const rise = day + sunrise!, set = day + sunset!, noon = (rise + set) / 2;
          return (
            <g key={day}>
              <polyline className="tl-sun-arc" points={sample(Math.max(lo, rise), Math.min(hi, set), arcAt(day))} />
              {noon > lo && noon < hi && <circle className="tl-sun" cx={x(noon)} cy={arcAt(day)(noon)} r="9" />}
              {rise > lo && <text className="tl-sun-label" x={x(rise)} y={horizon - 5} textAnchor="middle">↑ {clock(rise)}</text>}
              {set < hi && <text className="tl-sun-label" x={x(set)} y={horizon - 5} textAnchor="middle">↓ {clock(set)}</text>}
            </g>
          );
        })}
        {[...rows].sort((a, b) => Number(Boolean(a.current || a.best)) - Number(Boolean(b.current || b.best))).map((row) => {
          const end = row.start + row.hours.length * 60;
          const trip = (m: number) => horizon - Math.sin(Math.PI * ((m - row.start) / Math.max(60, end - row.start))) * tripHeight;
          const tone = row.best ? "is-best" : row.current ? "is-current" : "";
          return (
            <g key={row.key} className={`tl-trip ${tone}`}>
              <polyline points={sample(row.start, end, trip)} />
              {row.hours.map((hour) => isOverHour(hour) && (
                <polyline key={hour.index} className="tl-trip-over"
                  points={sample(row.start + hour.index * 60, row.start + hour.index * 60 + 60, trip)} />
              ))}
              {(row.best || row.current) && (
                <text x={x(row.start + (end - row.start) / 2)} y={trip(row.start + (end - row.start) / 2) - 7} textAnchor="middle">{row.label}</text>
              )}
            </g>
          );
        })}
        <line className="tl-horizon" x1="0" x2={width} y1={horizon} y2={horizon} />
      </svg>
    </div>
  );
}

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
        <div className="sky-timeline-row is-sky">
          <div className="sky-timeline-label"><strong>Sky</strong><span>each trip's arc</span></div>
          <DepartureSky rows={rows} lo={lo} hi={hi} sunrise={sunrise} sunset={sunset} clock={clock} />
          <div className="sky-timeline-note">
            <span>
              <strong>{sunrise !== null && sunset !== null ? `${clock(sunrise)} – ${clock(sunset)}` : "Daylight unknown"}</strong>
              <small>Arcs peak at each trip's halfway point</small>
            </span>
          </div>
        </div>
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
                <i key={h.index} className={`sky-timeline-hour is-${isOverHour(h) ? "over" : h.tone}${h.night ? " is-night" : ""}${h.approachAdjusted ? " is-approach" : ""}`}
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
