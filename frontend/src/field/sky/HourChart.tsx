import { useId, useState, type KeyboardEvent } from "react";
import { useWidth } from "./useWidth";
import { runs, smoothPath } from "./chart-path";

export type HourTone = "within" | "over" | "missing";

export type HourGuide = { value: number; label: string; tone: "cold" | "caution" | "secondary" };

/**
 * How a measurement is drawn: a smoothed line with an area wash for continuous
 * readings, bars for percentages, and arrows for wind direction.
 */
export type HourChartKind = "line" | "bars" | "direction";

/** Colour family for the line or bars. "temperature" turns the line cold below `coldBelow`. */
export type HourChartPalette = "neutral" | "temperature" | "cold";

/**
 * One measurement across the planned hours. A daylight strip under the plot
 * shows the sky at each hour; hours over a limit are hatched, hours with missing
 * readings have a gap. The chart is a single-select list of hours for keyboard users.
 */
export function HourChart({
  labels, values, tones, tints, guides = [], format, describe = format, selected, onSelect, label,
  height = 240, kind = "line", palette = "neutral", coldBelow, arrows, domain,
}: {
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
  kind?: HourChartKind;
  palette?: HourChartPalette;
  /** With the temperature palette, readings below this value are drawn cold. */
  coldBelow?: number;
  /** Wind direction (degrees the wind blows from) drawn as small arrows along the base. */
  arrows?: (number | null)[];
  /** Fixed value range, e.g. [0, 100] for percentages. */
  domain?: [number, number];
}) {
  const [ref, width] = useWidth<HTMLDivElement>(900);
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (n === 0 || known.length === 0) return null;

  const kMin = Math.min(...known), kMax = Math.max(...known);
  let lo: number, hi: number;
  if (domain) {
    [lo, hi] = domain;
  } else {
    const guideValues = guides.map((g) => g.value);
    lo = Math.min(kMin, ...guideValues.filter((v) => v <= kMax + 20));
    hi = Math.max(kMax, ...guideValues.filter((v) => v >= kMin - 20));
    if (hi - lo < 4) { hi += 2; lo -= 2; }
    const pad = (hi - lo) * 0.18;
    lo -= pad; hi += pad;
  }
  const hasArrows = kind !== "direction" && arrows?.some((a) => a !== null && Number.isFinite(a));
  const left = 8, right = 8, top = 30, strip = 6, arrowRow = hasArrows ? 22 : 0, bottom = 30 + strip + arrowRow;
  const plotH = height - top - bottom;
  const plotBottom = top + plotH;
  const col = (width - left - right) / n;
  const x = (i: number) => left + col * i + col / 2;
  const y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * plotH;
  const everyLabel = col >= 34 ? 1 : col >= 20 ? 2 : 3;
  const hiIdx = kind === "direction" || kMax === kMin ? -1 : values.indexOf(kMax);
  const loIdx = kind === "direction" || kMax === kMin ? -1 : values.indexOf(kMin);

  const segments = runs(values);
  const lines = segments.map((seg) => smoothPath(seg.map(({ i, v }) => ({ x: x(i), y: y(v) }))));
  const areas = segments.map((seg, k) => seg.length < 2 ? "" :
    `${lines[k]} L${x(seg[seg.length - 1].i).toFixed(1)},${plotBottom} L${x(seg[0].i).toFixed(1)},${plotBottom} Z`);

  // Contiguous over-limit hours share one hatched block instead of a column each.
  const overBlocks: [number, number][] = [];
  tones.forEach((t, i) => {
    if (t !== "over") return;
    const last = overBlocks[overBlocks.length - 1];
    if (last && last[1] === i - 1) last[1] = i; else overBlocks.push([i, i]);
  });

  const coldY = palette === "temperature" && coldBelow !== undefined ? Math.max(top, Math.min(plotBottom, y(coldBelow))) : null;
  const coldStop = coldY === null ? 1 : (coldY - top) / plotH;
  const strokeColor = palette === "cold" ? "var(--sky-cold)" : `url(#${id}-stroke)`;
  const fillColor = palette === "cold" ? "var(--sky-cold)" : "var(--sky-label)";
  const active = hover ?? selected;

  const onKey = (event: KeyboardEvent) => {
    const next = event.key === "ArrowRight" ? selected + 1 : event.key === "ArrowLeft" ? selected - 1
      : event.key === "Home" ? 0 : event.key === "End" ? n - 1 : null;
    if (next === null) return;
    event.preventDefault();
    onSelect(Math.max(0, Math.min(n - 1, next)));
  };
  const arrow = (cx: number, cy: number, fromDeg: number, size: number, key: string | number, className: string) => (
    // Points where the wind is going, the way a weather map draws it.
    <g key={key} transform={`translate(${cx.toFixed(1)},${cy.toFixed(1)}) rotate(${(fromDeg + 180) % 360})`} className={className}>
      <path d={`M0,${-size} L${size * 0.62},${size * 0.7} L0,${size * 0.32} L${-size * 0.62},${size * 0.7} Z`} />
    </g>
  );

  return (
    <div className="sky-hourchart" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="slider" tabIndex={0}
        aria-label={label} aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={selected}
        aria-valuetext={`${labels[selected]}: ${values[selected] === null || !Number.isFinite(values[selected] as number) ? "unavailable" : describe(values[selected] as number)}${tones[selected] === "over" ? ", over your limits" : tones[selected] === "missing" ? ", readings incomplete" : ""}`}
        onKeyDown={onKey} onMouseLeave={() => setHover(null)}>
        <defs>
          <pattern id={`${id}-hatch`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" className="hc-over-line" strokeWidth="2" />
          </pattern>
          <linearGradient id={`${id}-stroke`} gradientUnits="userSpaceOnUse" x1="0" y1={top} x2="0" y2={plotBottom}>
            <stop offset={0} stopColor="var(--sky-label)" />
            <stop offset={coldStop} stopColor="var(--sky-label)" />
            <stop offset={coldStop} stopColor="var(--sky-cold)" />
            <stop offset={1} stopColor="var(--sky-cold)" />
          </linearGradient>
          <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={fillColor} stopOpacity="0.16" />
            <stop offset="1" stopColor={fillColor} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}-bar`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={fillColor} stopOpacity="0.55" />
            <stop offset="1" stopColor={fillColor} stopOpacity="0.18" />
          </linearGradient>
          <clipPath id={`${id}-plot`}><rect x={left} y={top - 10} width={width - left - right} height={plotH + 10} /></clipPath>
        </defs>

        {/* Horizontal rhythm: faint gridlines at quarter heights. */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={left} x2={width - right} y1={top + plotH * f} y2={top + plotH * f} className="hc-grid" />
        ))}

        {overBlocks.map(([a, b]) => (
          <g key={a} className="hc-over">
            <rect x={left + col * a + 1} y={top - 10} width={col * (b - a + 1) - 2} height={plotH + 10} rx="8" className="hc-over-bg" />
            <rect x={left + col * a + 1} y={top - 10} width={col * (b - a + 1) - 2} height={plotH + 10} rx="8" fill={`url(#${id}-hatch)`} />
          </g>
        ))}
        {tones.map((t, i) => t === "missing" && (
          <rect key={i} x={left + col * i + 2} y={top - 8} width={col - 4} height={plotH + 8} rx="6" className="hc-missing" />
        ))}

        {/* Below-freezing wash, so cold hours read at a glance. */}
        {coldY !== null && coldY < plotBottom && (
          <rect x={left} y={coldY} width={width - left - right} height={plotBottom - coldY} className="hc-cold-zone" />
        )}

        {guides.filter((g) => g.value >= lo && g.value <= hi).map((g) => (
          <g key={g.label} className={`hc-guide is-${g.tone}`}>
            <line x1={left} x2={width - right} y1={y(g.value)} y2={y(g.value)} strokeDasharray="4 4" />
            <text x={width - right - 4} y={y(g.value) - 5} textAnchor="end">{g.label}</text>
          </g>
        ))}

        <line x1={x(active)} x2={x(active)} y1={top - 10} y2={plotBottom} className="hc-cursor" />

        {kind === "line" && (
          <g key={label} className="hc-series">
            {areas.map((d, k) => d && <path key={`a${k}`} d={d} fill={`url(#${id}-area)`} className="hc-area" />)}
            {lines.map((d, k) => <path key={`l${k}`} d={d} stroke={strokeColor} className="hc-line" pathLength={1} />)}
          </g>
        )}

        {kind === "bars" && (
          <g key={label} className="hc-series" clipPath={`url(#${id}-plot)`}>
            {values.map((v, i) => v === null || !Number.isFinite(v) ? null : (
              <rect key={i} x={x(i) - Math.min(col * 0.32, 18)} width={Math.min(col * 0.64, 36)}
                y={Math.min(y(v), plotBottom - 2)} height={Math.max(2, plotBottom - y(v))} rx="4"
                fill={`url(#${id}-bar)`} className={`hc-bar is-${tones[i]}${i === active ? " is-active" : ""}`}
                style={{ animationDelay: `${i * 25}ms` }} />
            ))}
          </g>
        )}

        {kind === "direction" && (
          <g key={label} className="hc-series">
            {values.map((v, i) => v === null || !Number.isFinite(v) ? null :
              arrow(x(i), top + plotH / 2, v, i === selected ? 14 : 11, i, `hc-dir is-${tones[i]}${i === active ? " is-active" : ""}`))}
          </g>
        )}

        {values.map((v, i) => {
          if (v === null || !Number.isFinite(v)) return null;
          const extreme = i === hiIdx ? "High" : i === loIdx ? "Low" : null;
          const showValue = i % everyLabel === 0 || i === selected || extreme !== null;
          const vy = kind === "direction" ? top + plotH / 2 + 26 : y(v);
          return (
            <g key={i} className={`hc-point is-${tones[i]}`}>
              {kind === "line" && <circle cx={x(i)} cy={y(v)} r={i === selected ? 6 : extreme ? 4.5 : 3.5} className={extreme ? "is-extreme" : undefined} />}
              {kind === "line" && i === selected && <circle cx={x(i)} cy={y(v)} r={11} className="hc-halo" />}
              {showValue && (
                <text x={x(i)} y={kind === "direction" ? vy : vy - (i === selected ? 14 : 11)} textAnchor="middle"
                  className={i === selected ? "is-selected" : extreme ? "is-extreme" : undefined}>{format(v)}</text>
              )}
              {extreme && kind !== "direction" && (
                <text x={x(i)} y={Math.max(10, vy - (i === selected ? 29 : 25))} textAnchor="middle" className="hc-extreme">{extreme}</text>
              )}
            </g>
          );
        })}

        {/* Daylight strip: the sky colour of each hour. */}
        {tints && labels.map((_, i) => (
          <rect key={i} x={left + col * i} y={plotBottom + 4} width={col + 0.5} height={strip}
            fill={tints[i] || "var(--sky-fill)"} className="hc-sky" />
        ))}

        {hasArrows && arrows!.map((a, i) => a === null || !Number.isFinite(a) || (i % everyLabel !== 0 && i !== selected) ? null :
          arrow(x(i), plotBottom + strip + 15, a, 6, `w${i}`, `hc-windarrow${i === selected ? " is-selected" : ""}`))}

        {labels.map((l, i) => (i % everyLabel === 0 || i === selected) && (
          <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className={`hc-hour is-${tones[i]}${i === selected ? " is-selected" : ""}`}>{l}</text>
        ))}

        {/* Hit targets last so the whole column is clickable. */}
        {labels.map((_, i) => (
          <rect key={i} x={left + col * i} y={0} width={col} height={height} className="hc-hit"
            onClick={() => onSelect(i)} onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
    </div>
  );
}
