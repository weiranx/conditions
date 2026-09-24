import { useId } from "react";
import { useWidth } from "./useWidth";
import { ridgeShape } from "./ridge";

export type AvalancheBandKey = "above" | "at" | "below";
export type AvalancheBandRow = { key: string; label: string; rating: number | null };
export type AvalancheMountainProblem = { name: string; bands: AvalancheBandKey[] };

// Bands are drawn in thirds of an illustrative mountain; heights are not to scale.
const BAND_SPAN: Record<AvalancheBandKey, [number, number]> = { below: [-400, 1000], at: [1000, 2000], above: [2000, 3600] };
const BAND_MARK_FT: Record<AvalancheBandKey, number> = { below: 600, at: 1450, above: 2350 };

const ratingClass = (rating: number | null) =>
  rating !== null && rating >= 1 && rating <= 5 ? `is-danger-${Math.round(rating)}` : "is-unrated";

/**
 * The regional danger ratings drawn on a mountain: below, near and above
 * treeline each coloured by the bulletin's rating on the North American
 * scale, with the bulletin's problems numbered in the bands they affect.
 * The mountain is illustrative; bands follow treeline, not a fixed elevation.
 */
export function AvalancheMountain({ rows, problems, dangerText }: {
  rows: AvalancheBandRow[];
  problems: AvalancheMountainProblem[];
  dangerText: (rating: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(900);
  const id = useId().replace(/:/g, "");
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const compact = width < 560;
  const height = compact ? 230 : 260;
  const side = compact ? 128 : 190;
  const plotW = width - side;
  const lo = -400, hi = 3600;
  const y = (ft: number) => 12 + (1 - (ft - lo) / (hi - lo)) * (height - 12);
  const { path, x: ridgeX } = ridgeShape({ plotW, height, y, base: 0, top: 3000 });
  const trees = Array.from({ length: 9 }, (_, i) => 120 + i * 105);
  // A rating of 0 is the bulletin's "no rating", drawn like a missing one.
  const bands = (["above", "at", "below"] as const).map((key) => {
    const row = byKey.get(key) ?? null;
    return { key, row: row && row.rating !== null && row.rating < 1 ? { ...row, rating: null } : row };
  });
  const describe = bands.map(({ row }) => row ? `${row.label}: ${row.rating === null ? "no rating" : `${row.rating} of 5, ${dangerText(row.rating)}`}` : "").filter(Boolean).join(". ");
  const problemText = problems.map((p, i) => `${i + 1}, ${p.name}${p.bands.length ? ` (${p.bands.map((b) => byKey.get(b)?.label.toLowerCase() || b).join(", ")})` : ""}`).join("; ");
  return (
    <div className="sky-avy-mountain" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label={`Avalanche danger by elevation. ${describe}.${problems.length ? ` Problems: ${problemText}.` : ""}`}>
        <defs>
          <clipPath id={`${id}-ridge`}><path d={path} /></clipPath>
          <pattern id={`${id}-unrated`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="7" height="7" className="avy-unrated-bg" />
            <line x1="0" y1="0" x2="0" y2="7" className="avy-unrated-line" strokeWidth="1.5" />
          </pattern>
        </defs>
        <rect width={plotW} height={height} className="avy-sky" />
        <g clipPath={`url(#${id}-ridge)`}>
          {bands.map(({ key, row }) => {
            const [from, to] = BAND_SPAN[key];
            const rating = row?.rating ?? null;
            return (
              <rect key={key} x="0" y={y(to)} width={plotW} height={y(from) - y(to)}
                className={`avy-band ${ratingClass(rating)}`}
                fill={rating === null ? `url(#${id}-unrated)` : undefined} />
            );
          })}
          <line x1="0" x2={plotW} y1={y(1000)} y2={y(1000)} className="avy-divide" />
          <line x1="0" x2={plotW} y1={y(2000)} y2={y(2000)} className="avy-divide" />
        </g>
        <path d={path} className="avy-ridge" />
        {/* Treeline, drawn as trees thinning out up the slope. */}
        <g className="avy-trees" aria-hidden="true">
          {trees.map((ft, i) => {
            const tx = ridgeX(ft) + 10 + (i % 3) * 16;
            const ty = y(ft) + 16 + (i % 2) * 6;
            const s = ft > 900 ? 0.7 : 1;
            return <path key={ft} d={`M${tx},${ty - 16 * s} l${7 * s},${16 * s} h${-14 * s} Z`} />;
          })}
        </g>
        {problems.map((problem, i) => problem.bands.map((band) => {
          const ft = BAND_MARK_FT[band];
          // Below treeline, clear the trees drawn along the lower slope.
          const mx = ridgeX(ft) + (band === "below" ? 80 : 26) + i * 24;
          const my = y(ft) + (band === "above" ? 14 : 4);
          return (
            <g key={`${i}-${band}`} className="avy-marker" aria-hidden="true">
              <circle cx={mx} cy={my} r="10" />
              <text x={mx} y={my + 4} textAnchor="middle">{i + 1}</text>
            </g>
          );
        }))}
        {bands.map(({ key, row }) => {
          const [from, to] = BAND_SPAN[key];
          const mid = y((Math.max(from, 0) + Math.min(to, 3000)) / 2);
          const rating = row?.rating ?? null;
          return (
            <g key={key} className="avy-label">
              <line x1={plotW - 6} x2={plotW + 6} y1={mid} y2={mid} />
              <rect x={plotW + 12} y={mid - 22} width="12" height="12" rx="3" className={`avy-swatch ${ratingClass(rating)}`}
                fill={rating === null ? `url(#${id}-unrated)` : undefined} />
              <text x={plotW + 30} y={mid - 12} className="avy-label-name">{row?.label ?? key}</text>
              <text x={plotW + 12} y={mid + 8} className={`avy-label-rating${rating !== null && rating >= 3 ? " is-over" : ""}`}>
                {rating === null ? "No rating" : `${rating} · ${dangerText(rating)}`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
