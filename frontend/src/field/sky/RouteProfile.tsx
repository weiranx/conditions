import { useId } from "react";
import { useWidth } from "./useWidth";

export type ProfileStop = { name: string; eta: string; tone: "within" | "over" | "missing"; dark?: boolean };

/**
 * The route's elevation profile with numbered checkpoints. Points come from
 * buildCheckpointProfile (x 20–980, y 30–155 in a 1000×180 frame) and are
 * rescaled to the real width so labels stay legible. Segments leading into a
 * checkpoint whose forecast crosses a limit are hatched, and stretches reached
 * after dark are shaded.
 */
export function RouteProfile({ points, stops, selected, onSelect, caption, ticks = [] }: {
  points: { x: number; y: number }[];
  stops: ProfileStop[];
  selected: number;
  onSelect: (index: number) => void;
  caption: string;
  /** Elevation gridlines in the same frame units as the points. */
  ticks?: { y: number; label: string }[];
}) {
  const [ref, width] = useWidth<HTMLDivElement>(900);
  const id = useId().replace(/:/g, "");
  const height = 240;
  const m = { l: ticks.length ? 64 : 22, r: 22, t: 44, b: 16 };
  const px = (x: number) => m.l + ((x - 20) / 960) * (width - m.l - m.r);
  const py = (y: number) => m.t + ((y - 30) / 125) * (height - m.t - m.b);
  const base = height - m.b;
  const pts = points.map((p) => [px(p.x), py(p.y)] as const);
  const line = pts.map((p) => p.join(",")).join(" ");
  const area = `M${pts[0][0]},${base} L${pts.map((p) => p.join(",")).join(" L")} L${pts[pts.length - 1][0]},${base} Z`;
  const showEvery = width / Math.max(1, pts.length) < 70 ? 2 : 1;
  // A dark checkpoint shades the half-segments on either side of it.
  const night = pts.map(([x], i) => stops[i]?.dark ? {
    from: i === 0 ? m.l : (pts[i - 1][0] + x) / 2,
    to: i === pts.length - 1 ? width - m.r : (pts[i + 1][0] + x) / 2,
  } : null);
  return (
    <div className="sky-route-profile" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={caption}>
        <defs>
          <pattern id={`${id}-hatch`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="7" height="7" className="rp-over-bg" />
            <line x1="0" y1="0" x2="0" y2="7" className="rp-over-line" strokeWidth="2" />
          </pattern>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="rp-fill-top" />
            <stop offset="100%" className="rp-fill-bottom" />
          </linearGradient>
        </defs>
        {night.map((band, i) => band && (
          <g key={`night-${i}`} className="rp-night" aria-hidden="true">
            <rect x={band.from} y={m.t - 30} width={Math.max(0, band.to - band.from)} height={base - m.t + 30} rx="6" />
          </g>
        ))}
        {ticks.map((tick) => (
          <g key={tick.label} className="rp-tick" aria-hidden="true">
            <line x1={m.l} x2={width - m.r} y1={py(tick.y)} y2={py(tick.y)} />
            <text x={m.l - 10} y={py(tick.y) + 4} textAnchor="end">{tick.label}</text>
          </g>
        ))}
        <path d={area} fill={`url(#${id}-fill)`} className="rp-area" />
        {pts.slice(1).map((p, i) => stops[i + 1]?.tone === "over" && (
          <path key={i} d={`M${pts[i][0]},${base} L${pts[i][0]},${pts[i][1]} L${p[0]},${p[1]} L${p[0]},${base} Z`} fill={`url(#${id}-hatch)`} />
        ))}
        <polyline points={line} className="rp-line" />
        {pts.slice(1).map((p, i) => stops[i + 1]?.tone === "over" && (
          <line key={i} x1={pts[i][0]} y1={pts[i][1]} x2={p[0]} y2={p[1]} className="rp-line is-over" />
        ))}
        {pts[selected] && (
          <line x1={pts[selected][0]} x2={pts[selected][0]} y1={pts[selected][1] + 12} y2={base} className="rp-guide" aria-hidden="true" />
        )}
        {pts.map(([x, y], i) => (
          <g key={i} role="button" tabIndex={0} aria-label={`Select ${stops[i]?.name}`} aria-pressed={i === selected}
            className={`rp-stop is-${stops[i]?.tone}${i === selected ? " is-selected" : ""}`}
            onClick={() => onSelect(i)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(i); } }}>
            <rect x={x - 22} y={0} width="44" height={height} fill="transparent" />
            {i === selected && <circle cx={x} cy={y} r={18} className="rp-halo" />}
            <circle cx={x} cy={y} r={i === selected ? 12 : 10} className="rp-dot" />
            <text x={x} y={y + 4} textAnchor="middle" className="rp-num">{i + 1}</text>
            {(i % showEvery === 0 || i === selected || i === pts.length - 1) && stops[i]?.eta && (
              <text x={Math.max(m.l + 18, Math.min(width - m.r - 18, x))} y={y - 20} textAnchor="middle" className="rp-eta">{stops[i].eta}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
