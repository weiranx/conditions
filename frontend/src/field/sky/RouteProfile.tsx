import { useId } from "react";
import { useWidth } from "./useWidth";

export type ProfileStop = { name: string; eta: string; tone: "within" | "over" | "missing" };

/**
 * The route's elevation profile with numbered checkpoints. Points come from
 * buildCheckpointProfile (x 20–980, y 30–155 in a 1000×180 frame) and are
 * rescaled to the real width so labels stay legible. Segments leading into a
 * checkpoint whose forecast crosses a limit are hatched.
 */
export function RouteProfile({ points, stops, selected, onSelect, caption }: {
  points: { x: number; y: number }[];
  stops: ProfileStop[];
  selected: number;
  onSelect: (index: number) => void;
  caption: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(900);
  const hatch = useId().replace(/:/g, "");
  const height = 230;
  const m = { l: 18, r: 18, t: 40, b: 12 };
  const px = (x: number) => m.l + ((x - 20) / 960) * (width - m.l - m.r);
  const py = (y: number) => m.t + ((y - 30) / 125) * (height - m.t - m.b);
  const pts = points.map((p) => [px(p.x), py(p.y)] as const);
  const line = pts.map((p) => p.join(",")).join(" ");
  const area = `M${pts[0][0]},${height - m.b} L${pts.map((p) => p.join(",")).join(" L")} L${pts[pts.length - 1][0]},${height - m.b} Z`;
  const showEvery = width / Math.max(1, pts.length) < 70 ? 2 : 1;
  return (
    <div className="sky-route-profile" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={caption}>
        <defs>
          <pattern id={hatch} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="7" height="7" className="rp-over-bg" />
            <line x1="0" y1="0" x2="0" y2="7" className="rp-over-line" strokeWidth="2" />
          </pattern>
        </defs>
        <path d={area} className="rp-area" />
        {pts.slice(1).map((p, i) => stops[i + 1]?.tone === "over" && (
          <path key={i} d={`M${pts[i][0]},${height - m.b} L${pts[i][0]},${pts[i][1]} L${p[0]},${p[1]} L${p[0]},${height - m.b} Z`} fill={`url(#${hatch})`} />
        ))}
        <polyline points={line} className="rp-line" />
        {pts.slice(1).map((p, i) => stops[i + 1]?.tone === "over" && (
          <line key={i} x1={pts[i][0]} y1={pts[i][1]} x2={p[0]} y2={p[1]} className="rp-line is-over" />
        ))}
        {pts.map(([x, y], i) => (
          <g key={i} role="button" tabIndex={0} aria-label={`Select ${stops[i]?.name}`} aria-pressed={i === selected}
            className={`rp-stop is-${stops[i]?.tone}${i === selected ? " is-selected" : ""}`}
            onClick={() => onSelect(i)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(i); } }}>
            <rect x={x - 22} y={0} width="44" height={height} fill="transparent" />
            <circle cx={x} cy={y} r={i === selected ? 12 : 10} />
            <text x={x} y={y + 4} textAnchor="middle" className="rp-num">{i + 1}</text>
            {(i % showEvery === 0 || i === selected || i === pts.length - 1) && stops[i]?.eta && (
              <text x={Math.max(24, Math.min(width - 24, x))} y={y - 18} textAnchor="middle" className="rp-eta">{stops[i].eta}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
