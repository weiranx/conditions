import { useId } from "react";

export function ConditionTrend({
  label,
  values,
  format,
  start,
  end,
  domain,
}: {
  label: string;
  values: Array<number | null | undefined>;
  format: (value: number) => string;
  start: string;
  end: string;
  domain?: [number, number];
}) {
  const id = useId();
  const clean = values.map((value) =>
    typeof value === "number" && Number.isFinite(value) ? value : null,
  );
  const valid = clean.filter((value): value is number => value !== null);
  if (!valid.length)
    return <p className="condition-chart-empty">{label} trend unavailable.</p>;
  const low = Math.min(...valid),
    high = Math.max(...valid);
  const floor = domain?.[0] ?? low,
    ceiling = domain?.[1] ?? high;
  const points = clean.map((value, index) => ({
    x: 8 + (index * 284) / Math.max(1, clean.length - 1),
    y:
      value === null
        ? null
        : 62 - ((value - floor) / Math.max(1, ceiling - floor)) * 48,
  }));
  const line = points
    .map((point, index) =>
      point.y === null
        ? ""
        : `${index === 0 || points[index - 1].y === null ? "M" : "L"}${point.x},${point.y}`,
    )
    .join(" ");
  const range = low === high ? format(low) : `${format(low)}–${format(high)}`;
  return (
    <figure className="condition-trend">
      <figcaption>
        <span>{label}</span>
        <strong>{range}</strong>
      </figcaption>
      <svg
        viewBox="0 0 300 76"
        role="img"
        aria-label={`${label}: ${range}, from ${start} to ${end}. Missing readings are shown as gaps.`}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity=".2" />
            <stop offset="1" stopColor="currentColor" stopOpacity=".015" />
          </linearGradient>
        </defs>
        <path d="M8,62H292" className="condition-chart-baseline" />
        {points.length > 1 && points.every((point) => point.y !== null) && (
          <path
            d={`${line}L${points.at(-1)!.x},72L8,72Z`}
            fill={`url(#${id})`}
          />
        )}
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map(
          (point, index) =>
            point.y !== null && (
              <circle
                key={index}
                cx={point.x}
                cy={point.y}
                r={points.length === 1 ? 3.5 : 2}
                fill="currentColor"
              />
            ),
        )}
      </svg>
      <div className="condition-chart-times">
        <span>{start}</span>
        <span>{end}</span>
      </div>
    </figure>
  );
}
export function ConditionScale({
  label,
  value,
  maximum,
  format = String,
  endLabel,
}: {
  label: string;
  value: number | null | undefined;
  maximum: number;
  format?: (value: number) => string;
  endLabel?: string;
}) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return <p className="condition-chart-empty">{label} unavailable.</p>;
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
