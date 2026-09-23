import { useId, type KeyboardEvent } from "react";
import { useWidth } from "./useWidth";

export type HourTone = "within" | "over" | "missing";

export type HourGuide = { value: number; label: string; tone: "cold" | "caution" | "secondary" };

/**
 * One measurement across the planned hours. Each hour is a column tinted by its
 * sky; hours over a limit are hatched, hours with missing readings have a gap
 * in the line. The chart is a single-select list of hours for keyboard users.
 */
export function HourChart({ labels, values, tones, tints, guides = [], format, describe = format, selected, onSelect, label, height = 220 }: {
  labels: string[];
  values: (number | null)[];
  tones: HourTone[];
  tints?: (string | null)[];
  guides?: HourGuide[];
  format: (value: number) => string;
  /** Full reading for assistive technology, e.g. "31 mph" where the chart shows "31". */
  describe?: (value: number) => string;
  selected: number;
  onSelect: (index: number) => void;
  label: string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(900);
  const hatch = useId().replace(/:/g, "");
  const n = labels.length;
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (n === 0 || known.length === 0) return null;
  const guideValues = guides.map((g) => g.value);
  let lo = Math.min(...known, ...guideValues.filter((v) => v <= Math.max(...known) + 20));
  let hi = Math.max(...known, ...guideValues.filter((v) => v >= Math.min(...known) - 20));
  if (hi - lo < 4) { hi += 2; lo -= 2; }
  const pad = (hi - lo) * 0.18;
  lo -= pad; hi += pad;
  const left = 8, right = 8, top = 26, bottom = 28;
  const plotH = height - top - bottom;
  const col = (width - left - right) / n;
  const x = (i: number) => left + col * i + col / 2;
  const y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * plotH;
  const everyLabel = col >= 34 ? 1 : col >= 20 ? 2 : 3;
  const path = values.map((v, i) => v === null || !Number.isFinite(v) ? "" : `${i === 0 || values[i - 1] === null || !Number.isFinite(values[i - 1] as number) ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const onKey = (event: KeyboardEvent) => {
    const next = event.key === "ArrowRight" ? selected + 1 : event.key === "ArrowLeft" ? selected - 1
      : event.key === "Home" ? 0 : event.key === "End" ? n - 1 : null;
    if (next === null) return;
    event.preventDefault();
    onSelect(Math.max(0, Math.min(n - 1, next)));
  };
  return (
    <div className="sky-hourchart" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="slider" tabIndex={0}
        aria-label={label} aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={selected}
        aria-valuetext={`${labels[selected]}: ${values[selected] === null || !Number.isFinite(values[selected] as number) ? "unavailable" : describe(values[selected] as number)}${tones[selected] === "over" ? ", over your limits" : tones[selected] === "missing" ? ", readings incomplete" : ""}`}
        onKeyDown={onKey}>
        <defs>
          <pattern id={hatch} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="7" height="7" className="hc-over-bg" />
            <line x1="0" y1="0" x2="0" y2="7" className="hc-over-line" strokeWidth="2.4" />
          </pattern>
        </defs>
        {labels.map((_, i) => (
          <g key={i} onClick={() => onSelect(i)} className="hc-col">
            <rect x={left + col * i} y={top - 8} width={col} height={plotH + 8}
              fill={tones[i] === "over" ? `url(#${hatch})` : tints?.[i] || "transparent"}
              className={tones[i] === "missing" ? "hc-missing" : undefined} />
          </g>
        ))}
        <rect x={left + col * selected + 1} y={top - 8} width={col - 2} height={plotH + 8} rx="6" className="hc-selected" />
        {guides.filter((g) => g.value >= lo && g.value <= hi).map((g) => (
          <g key={g.label} className={`hc-guide is-${g.tone}`}>
            <line x1={left} x2={width - right} y1={y(g.value)} y2={y(g.value)} strokeDasharray="4 4" />
            <text x={width - right - 4} y={y(g.value) - 5} textAnchor="end">{g.label}</text>
          </g>
        ))}
        <path d={path} className="hc-line" />
        {values.map((v, i) => v === null || !Number.isFinite(v) ? null : (
          <g key={i} className={`hc-point is-${tones[i]}`}>
            <circle cx={x(i)} cy={y(v)} r={i === selected ? 5.5 : 3.5} />
            {(i % everyLabel === 0 || i === selected) && (
              <text x={x(i)} y={y(v) - 10} textAnchor="middle" className={i === selected ? "is-selected" : undefined}>{format(v)}</text>
            )}
          </g>
        ))}
        {labels.map((l, i) => (i % everyLabel === 0 || i === selected) && (
          <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className={`hc-hour is-${tones[i]}${i === selected ? " is-selected" : ""}`}>{l}</text>
        ))}
      </svg>
    </div>
  );
}
