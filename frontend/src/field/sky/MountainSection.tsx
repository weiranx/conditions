import { useId } from "react";
import type { ElevationForecastBand } from "../../app/types";
import { useWidth } from "./useWidth";

type Level = { label: string; ft: number; tone: "cold" | "snow" };

/**
 * The mountain in cross-section at the planned start: forecast bands by
 * elevation on the right, freezing and snow levels drawn across the slope,
 * and the objective marked on the ridge. Heights are to scale; the ridge
 * shape is illustrative.
 */
export function MountainSection({ bands, objectiveFt, objectiveLabel, target, levels, sky, format }: {
  bands: ElevationForecastBand[];
  objectiveFt: number | null;
  objectiveLabel: string;
  target: { ft: number; label: string } | null;
  levels: Level[];
  sky: { zenith: string; horizon: string } | null;
  format: { elevation: (ft: number) => string; temp: (f: number) => string; wind: (mph: number) => string };
}) {
  const [ref, width] = useWidth<HTMLDivElement>(900);
  const id = useId().replace(/:/g, "");
  const sorted = [...bands].filter((b) => Number.isFinite(b.elevationFt)).sort((a, b) => a.elevationFt - b.elevationFt);
  const heights = [...sorted.map((b) => b.elevationFt), ...(objectiveFt !== null ? [objectiveFt] : []), ...(target ? [target.ft] : [])];
  if (heights.length === 0) return null;
  const top = Math.max(...heights);
  const base = Math.min(...heights);
  const levelsInView = levels.filter((l) => Number.isFinite(l.ft) && l.ft > base - 3000 && l.ft < top + 4000);
  const lo = Math.min(base, ...levelsInView.map((l) => l.ft)) - 600;
  const hi = Math.max(top, ...levelsInView.map((l) => l.ft)) + 900;
  const height = width < 560 ? 280 : 320;
  const side = width < 560 ? 132 : 190;
  const plotW = width - side;
  const y = (ft: number) => 16 + (1 - (ft - lo) / (hi - lo)) * (height - 32);
  const peakX = plotW * 0.62;
  const peakY = y(top + 250);
  // Illustrative ridge: rises from the lowest band on the left to the summit, falls away to the right.
  const ridge = [
    [0, y(base - 200)], [plotW * 0.18, y(base + (top - base) * 0.22)], [plotW * 0.34, y(base + (top - base) * 0.48)],
    [plotW * 0.47, y(base + (top - base) * 0.8)], [peakX, peakY], [plotW * 0.74, y(base + (top - base) * 0.72)],
    [plotW * 0.86, y(base + (top - base) * 0.5)], [plotW, y(base + (top - base) * 0.34)], [plotW, height], [0, height],
  ];
  const ridgePath = `M${ridge.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" L")} Z`;
  // x on the rising side of the ridge for a given elevation.
  const ridgeX = (ft: number) => {
    const pts = ridge.slice(0, 5);
    const yy = y(ft);
    for (let i = 1; i < pts.length; i += 1) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      if (yy <= y0 && yy >= y1) return x0 + ((y0 - yy) / (y0 - y1 || 1)) * (x1 - x0);
    }
    return yy > pts[0][1] ? 0 : peakX;
  };
  const snow = levelsInView.find((l) => l.tone === "snow");
  const describe = [
    ...sorted.map((b) => `${b.label} ${format.elevation(b.elevationFt)}: ${format.temp(b.temp)}, gusts ${format.wind(b.windGust)}`),
    ...levelsInView.map((l) => `${l.label} ${format.elevation(l.ft)}`),
  ].join(". ");
  return (
    <div className="sky-mountain" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label={`Conditions by elevation at your start. ${describe}.`}>
        <defs>
          <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={sky?.zenith || "#6f95bd"} stopOpacity="0.55" />
            <stop offset="1" stopColor={sky?.horizon || "#d5e1ec"} stopOpacity="0.35" />
          </linearGradient>
          <clipPath id={`${id}-ridge`}><path d={ridgePath} /></clipPath>
        </defs>
        <rect width={plotW} height={height} fill={`url(#${id}-sky)`} />
        <path d={ridgePath} className="mt-ridge" />
        {snow && <rect x="0" y="0" width={plotW} height={y(snow.ft)} clipPath={`url(#${id}-ridge)`} className="mt-snow" />}
        {levelsInView.map((l) => (
          <g key={l.label} className={`mt-level is-${l.tone}`}>
            <line x1="0" x2={plotW} y1={y(l.ft)} y2={y(l.ft)} strokeDasharray="5 4" />
            <text x="10" y={y(l.ft) - 6}>{l.label} {format.elevation(l.ft)}</text>
          </g>
        ))}
        {sorted.map((b) => (
          <g key={b.label} className="mt-band">
            <line x1={ridgeX(b.elevationFt)} x2={width} y1={y(b.elevationFt)} y2={y(b.elevationFt)} />
            <text x={plotW + 12} y={y(b.elevationFt) - 5} className="mt-band-name">{b.label} · {format.elevation(b.elevationFt)}</text>
            <text x={plotW + 12} y={y(b.elevationFt) + 13} className={`mt-band-temp${b.temp <= 32 ? " is-cold" : ""}`}>
              {format.temp(b.temp)} · {format.wind(b.windGust)} gust
            </text>
          </g>
        ))}
        {target && (
          <g className="mt-target">
            <line x1={ridgeX(target.ft)} x2={plotW} y1={y(target.ft)} y2={y(target.ft)} strokeDasharray="2 3" />
            <circle cx={ridgeX(target.ft)} cy={y(target.ft)} r="5" />
            <text x={Math.min(plotW - 8, ridgeX(target.ft) + 10)} y={y(target.ft) + 16} textAnchor={ridgeX(target.ft) + 180 > plotW ? "end" : "start"}>{target.label}</text>
          </g>
        )}
        {objectiveFt !== null && (
          <g className="mt-objective">
            <circle cx={ridgeX(objectiveFt)} cy={y(objectiveFt)} r="7" />
            <text x={ridgeX(objectiveFt) - 12} y={y(objectiveFt) - 12} textAnchor="end">{objectiveLabel}</text>
          </g>
        )}
      </svg>
    </div>
  );
}
