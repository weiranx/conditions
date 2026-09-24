import { useId } from "react";
import { useWidth } from "./sky/useWidth";
import { runs, smoothPath } from "./sky/chart-path";

/** A shaded value range on a trend, e.g. "dry" humidity or "freezing" temperature. */
export type TrendBand = { from: number; to: number; label: string; tone: "cold" | "caution" };

/**
 * An hourly measurement in a small card. Draws a smoothed line (or bars for
 * percentages), labels the high and low, and ticks a few hours along the base.
 */
export function ConditionTrend({
  label,
  values,
  format,
  start,
  end,
  domain,
  hours,
  kind = "line",
  bands = [],
  compare,
}: {
  label: string;
  values: Array<number | null | undefined>;
  format: (value: number) => string;
  start: string;
  end: string;
  domain?: [number, number];
  /** Short clock labels for each value; a few are shown as ticks. */
  hours?: string[];
  kind?: "line" | "bars";
  bands?: TrendBand[];
  /** A reference series drawn dashed behind the main line, e.g. the summit beside the trailhead. */
  compare?: { label: string; values: Array<number | null | undefined>; primaryLabel: string };
}) {
  const id = useId().replace(/:/g, "");
  const [ref, width] = useWidth<HTMLDivElement>(300);
  const clean = values.map((value) =>
    typeof value === "number" && Number.isFinite(value) ? value : null,
  );
  const valid = clean.filter((value): value is number => value !== null);
  const reference = compare?.values.map((value) =>
    typeof value === "number" && Number.isFinite(value) ? value : null,
  ) ?? [];
  const referenceValid = reference.filter((value): value is number => value !== null);
  if (!valid.length)
    return <p className="condition-chart-empty">{label} trend unavailable.</p>;
  const low = Math.min(...valid),
    high = Math.max(...valid);
  let floor = domain?.[0] ?? Math.min(low, ...referenceValid),
    ceiling = domain?.[1] ?? Math.max(high, ...referenceValid);
  if (!domain) {
    // Leave headroom so a flat reading sits mid-chart instead of on an edge.
    const span = Math.max(ceiling - floor, 6);
    const mid = (ceiling + floor) / 2;
    floor = mid - span * 0.7;
    ceiling = mid + span * 0.7;
  }
  const n = clean.length;
  const height = 92, top = 20, base = 70, side = 6;
  const col = (width - side * 2) / n;
  const x = (i: number) => side + col * i + col / 2;
  const y = (v: number) => base - ((v - floor) / Math.max(1e-6, ceiling - floor)) * (base - top);
  const clampY = (v: number) => Math.max(top - 6, Math.min(base, y(v)));
  const referenceLines = runs(reference).map((seg) => smoothPath(seg.map(({ i, v }) => ({ x: x(i), y: y(v) }))));
  const segments = runs(clean);
  const lines = segments.map((seg) => smoothPath(seg.map(({ i, v }) => ({ x: x(i), y: y(v) }))));
  const areas = segments.map((seg, k) => seg.length < 2 ? "" :
    `${lines[k]} L${x(seg[seg.length - 1].i).toFixed(1)},${base} L${x(seg[0].i).toFixed(1)},${base} Z`);
  const hiIdx = clean.indexOf(high), loIdx = clean.lastIndexOf(low);
  const lastIdx = clean.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).at(-1)!;
  const marks = kind === "bars" || high === low
    ? [hiIdx]
    : [...new Set([hiIdx, loIdx])];
  const tickEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(width / 64))));
  const ticks = hours && hours.length === n
    ? hours.map((h, i) => ({ i, h })).filter(({ i }) => i % tickEvery === 0)
    : [];
  const range = low === high ? format(low) : `${format(low)}–${format(high)}`;
  const visibleBands = bands
    .map((b) => ({ ...b, y1: clampY(Math.min(ceiling, b.to)), y2: clampY(Math.max(floor, b.from)) }))
    .filter((b) => b.from < ceiling && b.to > floor && b.y2 - b.y1 > 1);
  return (
    <figure className={`condition-trend is-${kind}`}>
      <figcaption>
        <span>{label}</span>
        <strong>{range}</strong>
      </figcaption>
      {referenceValid.length > 0 && (
        <p className="condition-legend">
          <span className="is-primary">{compare!.primaryLabel}</span>
          <span className="is-reference">{compare!.label}</span>
        </p>
      )}
      <div ref={ref}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${label}: ${range}, from ${start} to ${end}. Missing readings are shown as gaps.`}
        >
          <defs>
            <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity=".22" />
              <stop offset="1" stopColor="currentColor" stopOpacity=".02" />
            </linearGradient>
          </defs>
          {visibleBands.map((b) => (
            <g key={b.label} className={`condition-band is-${b.tone}`}>
              <rect x={side} width={width - side * 2} y={b.y1} height={b.y2 - b.y1} />
              <text x={side + 4} y={b.y2 - b.y1 >= 14 ? b.y1 + 11 : b.y1 - 3}>{b.label}</text>
            </g>
          ))}
          <path d={`M${side},${base}H${width - side}`} className="condition-chart-baseline" />
          {kind === "bars" ? (
            clean.map((v, i) => (
              <g key={i}>
                <rect x={x(i) - col * 0.3} width={col * 0.6} y={top} height={base - top} rx="2.5" className="condition-bar-track" />
                {v !== null && (
                  <rect x={x(i) - col * 0.3} width={col * 0.6} y={Math.min(y(v), base - 2)} height={Math.max(2, base - y(v))} rx="2.5"
                    className="condition-bar" style={{ animationDelay: `${i * 30}ms` }} />
                )}
              </g>
            ))
          ) : (
            <>
              {referenceLines.map((d, k) => <path key={`r${k}`} d={d} className="condition-reference" />)}
              {areas.map((d, k) => d && <path key={`a${k}`} d={d} fill={`url(#${id}-area)`} className="condition-area" />)}
              {lines.map((d, k) => <path key={`l${k}`} d={d} className="condition-line" pathLength={1} />)}
              {clean.map((v, i) => v !== null && (
                <circle key={i} cx={x(i)} cy={y(v)} r={marks.includes(i) || i === lastIdx ? 3.5 : 2}
                  className={marks.includes(i) || i === lastIdx ? "condition-dot is-marked" : "condition-dot"} />
              ))}
            </>
          )}
          {marks.map((i) => {
            const v = clean[i]!;
            const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
            const tx = anchor === "start" ? x(i) - 4 : anchor === "end" ? x(i) + 4 : x(i);
            const below = kind === "line" && i === loIdx && i !== hiIdx;
            return (
              <text key={`m${i}`} x={tx} y={below ? Math.min(base + 13, y(v) + 16) : Math.max(11, y(v) - 8)} textAnchor={anchor} className="condition-value">
                {format(v)}
              </text>
            );
          })}
          {ticks.map(({ i, h }) => (
            <text key={`t${i}`} x={x(i)} y={height - 4} textAnchor="middle" className="condition-tick">{h}</text>
          ))}
        </svg>
      </div>
      {ticks.length === 0 && (
        <div className="condition-chart-times">
          <span>{start}</span>
          <span>{end}</span>
        </div>
      )}
    </figure>
  );
}

/** Named ranges along a scale, each starting at `from`; the last ends at the maximum. Drawn as equal-width segments. */
export type ScaleBand = { from: number; label: string };

export function ConditionScale({
  label,
  value,
  maximum,
  format = String,
  endLabel,
  bands,
}: {
  label: string;
  value: number | null | undefined;
  maximum: number;
  format?: (value: number) => string;
  endLabel?: string;
  /**
   * Category bands. Equal-width segments keep the low end readable on skewed
   * scales such as AQI, where almost every day falls in the first tenth.
   */
  bands?: ScaleBand[];
}) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return <p className="condition-chart-empty">{label} unavailable.</p>;
  if (bands && bands.length > 0) {
    const active = bands.reduce((found, b, i) => (value >= b.from ? i : found), 0);
    const from = bands[active].from;
    const to = active + 1 < bands.length ? bands[active + 1].from : Math.max(maximum, value);
    const within = Math.max(0, Math.min(1, (value - from) / Math.max(1e-6, to - from)));
    const percent = ((active + within) / bands.length) * 100;
    return (
      <figure className="condition-scale is-banded">
        <figcaption>
          <span>{label}</span>
          <strong>{format(value)}</strong>
        </figcaption>
        <div className="condition-bands" role="img"
          aria-label={`${label}: ${format(value)}, in the ${bands[active].label} range (${from} to ${to}).`}>
          <div className="condition-bands-track" style={{ gridTemplateColumns: `repeat(${bands.length}, 1fr)` }}>
            {bands.map((b, i) => (
              <span key={b.label} className={`condition-band-seg${i === active ? " is-active" : i < active ? " is-passed" : ""}`} />
            ))}
            <span className="condition-scale-marker" style={{ left: `${percent}%` }} />
          </div>
          <div className="condition-bands-labels" style={{ gridTemplateColumns: `repeat(${bands.length}, 1fr)` }}>
            {bands.map((b, i) => (
              <span key={b.label} className={i === active ? `is-active${i >= bands.length / 2 ? " is-end" : ""}` : undefined}>
                <small>{b.from}</small>
                {i === active && <b>{b.label}</b>}
              </span>
            ))}
          </div>
        </div>
      </figure>
    );
  }
  const max = Math.max(maximum, value);
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <figure className="condition-scale">
      <figcaption>
        <span>{label}</span>
        <strong>{format(value)}</strong>
      </figcaption>
      <div
        className="condition-scale-track"
        role="img"
        aria-label={`${label}: ${format(value)} on a scale from zero to ${max}.`}
      >
        <span
          className="condition-scale-fill"
          style={{ width: `${percent}%` }}
        />
        <span
          className="condition-scale-marker"
          style={{ left: `${percent}%` }}
        />
      </div>
      <div className="condition-chart-times">
        <span>0</span>
        <span>{max === maximum && endLabel ? endLabel : max}</span>
      </div>
    </figure>
  );
}
export function AccumulationBars({
  label,
  rows,
}: {
  label: string;
  rows: Array<{ label: string; value: number | null; display: string }>;
}) {
  const maximum = Math.max(
    0,
    ...rows.map((row) =>
      typeof row.value === "number" && Number.isFinite(row.value)
        ? row.value
        : 0,
    ),
  );
  return (
    <figure className="condition-accumulation">
      <figcaption>{label}</figcaption>
      {rows.map((row) => (
        <div className="condition-accumulation-row" key={row.label}>
          <span>{row.label}</span>
          <div className="condition-accumulation-track" aria-hidden="true">
            <span
              style={{
                width: `${row.value !== null && Number.isFinite(row.value) && maximum > 0 ? Math.max(0, row.value / maximum) * 100 : 0}%`,
              }}
            />
          </div>
          <strong>{row.display}</strong>
        </div>
      ))}
    </figure>
  );
}
