import { useId, useState } from "react";
import { Cloud } from "./MountainSection";
import type { SkyHour } from "./sky-model";
import { useWidth } from "./useWidth";
import type { CheckpointTone } from "../route-planning";

/** The sky and forecast at a checkpoint's arrival, drawn above it. */
export type ProfileSky = {
  zenith: string;
  horizon: string;
  night: boolean;
  kind: SkyHour["kind"];
  /** Formatted temperature, e.g. "56°F". */
  temp: string | null;
};

export type ProfileStop = {
  name: string;
  eta: string;
  tone: CheckpointTone;
  dark?: boolean;
  sky?: ProfileSky | null;
};

export type ProfileLevel = { y: number; label: string; tone: "cold" | "snow" };

const PLOT_HEIGHT = 280;
const AXIS_HEIGHT = 26;
/** Row in the sky where each checkpoint's weather sits. */
const SKY_ROW_Y = 24;

/** A small forecast symbol: sun or moon, cloud, rain or snow, drawn at (x, y). */
function SkyGlyph({ x, y, sky }: { x: number; y: number; sky: ProfileSky }) {
  const { kind, night } = sky;
  const wet = kind === "rain" || kind === "snow" || kind === "storm";
  const cloudy = wet || kind === "cloudy" || kind === "partly" || kind === "fog";
  const bright = kind === "clear" || kind === "partly";
  const shift = cloudy ? "translate(-5,-3)" : undefined;
  return (
    <g className="rp-glyph" aria-hidden="true">
      {bright && (night
        ? <path className="mt-moon" d={`M${x - 2},${y - 9} a9,9 0 1,0 6,15 a7,7 0 1,1 -6,-15 Z`} transform={shift} />
        : (
          <g className="mt-sun" transform={shift}>
            {Array.from({ length: 8 }, (_, i) => {
              const a = (i * Math.PI) / 4;
              return <line key={i} x1={x + Math.cos(a) * 11} y1={y + Math.sin(a) * 11} x2={x + Math.cos(a) * 14.5} y2={y + Math.sin(a) * 14.5} />;
            })}
            <circle cx={x} cy={y} r="7.5" />
          </g>
        ))}
      {cloudy && <Cloud x={x + 1} y={y - 2} s={0.42} className={`mt-cloud${wet ? " is-heavy" : ""}`} />}
      {wet && [-7, 0, 7].map((dx) => kind === "snow"
        ? <circle key={dx} className="mt-flake" cx={x + dx} cy={y + 12} r="1.8" />
        : <line key={dx} className="mt-drop" x1={x + dx} y1={y + 9} x2={x + dx - 2} y2={y + 15} />)}
      {kind === "storm" && <path className="mt-bolt" d={`M${x + 2},${y + 6} l-5,8 h4 l-3,7 l8,-10 h-4 l3,-5 Z`} />}
    </g>
  );
}

/**
 * The route drawn as a mountain in cross-section, in the style of the Terrain
 * chapter's mountain: the ridge follows each checkpoint's elevation (x by
 * distance when known), capped in snow above the snow level, under a sky that
 * shifts with the time of each arrival. Each checkpoint shows its forecast in
 * the sky above it. Points come from buildCheckpointProfile (x 20–980, y 30–155
 * in a 1000×180 frame) and are rescaled to the real width so labels stay legible.
 * Sections leading into a checkpoint over a limit are drawn in the caution colour.
 * A checkpoint with no known elevation sits between its neighbours, dashed.
 */
export function RouteProfile({ points, stops, selected, onSelect, caption, ticks = [], levels = [], distanceTicks = [], legs = [] }: {
  points: { x: number; y: number; estimated?: boolean }[];
  stops: ProfileStop[];
  selected: number;
  onSelect: (index: number) => void;
  caption: string;
  /** Elevation gridlines in the same frame units as the points. */
  ticks?: { y: number; label: string }[];
  /** Freezing and snow levels in frame units; the ridge is capped in snow above the snow level. */
  levels?: ProfileLevel[];
  /** Distance gridlines in frame x units, labeled. */
  distanceTicks?: { x: number; label: string }[];
  /** Distance and vert of each section, in travel order; the short form fits narrow sections. */
  legs?: ({ label: string; short: string } | null)[];
}) {
  const [ref, width] = useWidth<HTMLDivElement>(900);
  const [hovered, setHovered] = useState<number | null>(null);
  const id = useId().replace(/:/g, "");
  const axisHeight = distanceTicks.length ? AXIS_HEIGHT : 0;
  const height = PLOT_HEIGHT + axisHeight;
  const m = { l: ticks.length ? 64 : 22, r: 22, t: 84, b: 24 };
  const plotR = width - m.r;
  const px = (x: number) => m.l + ((x - 20) / 960) * (plotR - m.l);
  const py = (y: number) => m.t + ((y - 30) / 125) * (PLOT_HEIGHT - m.t - m.b - 18);
  const base = PLOT_HEIGHT;
  const pts = points.map((p) => [px(p.x), py(p.y)] as const);
  // The ridge runs edge to edge; the flanks beyond the first and last checkpoints ease down.
  const ridge = [
    `M0,${base}`,
    `L0,${(pts[0][1] + (base - pts[0][1]) * 0.18).toFixed(1)}`,
    ...pts.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`),
    `L${width},${(pts[pts.length - 1][1] + (base - pts[pts.length - 1][1]) * 0.18).toFixed(1)}`,
    `L${width},${base} Z`,
  ].join(" ");
  // Levels may sit a little above the high point (frame y down to 0) but not below the base.
  const shown = levels.filter((l) => Number.isFinite(l.y) && l.y >= 0 && l.y <= 180);
  const snow = levels.find((l) => l.tone === "snow" && Number.isFinite(l.y));
  const snowTop = snow ? Math.min(base, Math.max(0, py(snow.y))) : null;
  const showEvery = width / Math.max(1, pts.length) < 70 ? 2 : 1;
  const labeled = (i: number) => i % showEvery === 0 || i === selected || i === hovered || i === pts.length - 1;
  // The sky follows the clock: each checkpoint's arrival colours the sky above it.
  const skies = stops.map((stop) => stop.sky ?? null);
  const hasSky = skies.some(Boolean);
  const stopOffset = (x: number) => Math.max(0, Math.min(1, x / width)).toFixed(3);
  // Checkpoints share a column band: half the gap to each neighbour.
  const column = (i: number) => ({
    from: i === 0 ? 0 : (pts[i - 1][0] + pts[i][0]) / 2,
    to: i === pts.length - 1 ? width : (pts[i][0] + pts[i + 1][0]) / 2,
  });
  const skyX = (x: number) => Math.max(m.l + 20, Math.min(plotR - 34, x));
  const describe = stops.map((stop, i) => `${i + 1}. ${stop.name}${stop.eta ? ` at ${stop.eta}` : ""}${stop.sky?.temp ? `, ${stop.sky.temp}` : ""}${stop.tone === "over" ? ", over your limits" : stop.tone === "hazard" ? ", alert or avalanche danger" : ""}${points[i]?.estimated ? ", elevation unknown" : ""}`).join(". ");
  return (
    <div className="sky-route-profile sky-mountain" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${caption}. ${describe}.`}
        onMouseLeave={() => setHovered(null)}>
        <defs>
          <linearGradient id={`${id}-zenith`} x1="0" y1="0" x2="1" y2="0">
            {hasSky ? skies.map((sky, i) => sky && <stop key={i} offset={stopOffset(pts[i][0])} stopColor={sky.zenith} />)
              : <stop offset="0" stopColor="#6f95bd" />}
          </linearGradient>
          <linearGradient id={`${id}-horizon`} x1="0" y1="0" x2="1" y2="0">
            {hasSky ? skies.map((sky, i) => sky && <stop key={i} offset={stopOffset(pts[i][0])} stopColor={sky.horizon} />)
              : <stop offset="0" stopColor="#d5e1ec" />}
          </linearGradient>
          {/* Fade the zenith colour into the horizon colour going down. */}
          <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" />
            <stop offset="1" stopColor="#000" />
          </linearGradient>
          <mask id={`${id}-fade-mask`}><rect width={width} height={base} fill={`url(#${id}-fade)`} /></mask>
          <clipPath id={`${id}-ridge`}><path d={ridge} /></clipPath>
        </defs>
        <g className="rp-sky">
          <rect width={width} height={base} fill={`url(#${id}-horizon)`} />
          <rect width={width} height={base} fill={`url(#${id}-zenith)`} mask={`url(#${id}-fade-mask)`} />
        </g>
        {hovered !== null && hovered !== selected && pts[hovered] && (
          <rect x={column(hovered).from} y={0} width={column(hovered).to - column(hovered).from} height={base} className="rp-column" aria-hidden="true" />
        )}
        {ticks.map((tick) => (
          <g key={tick.label} className="rp-tick" aria-hidden="true">
            <line x1={m.l} x2={plotR} y1={py(tick.y)} y2={py(tick.y)} />
            <text x={m.l - 10} y={py(tick.y) + 4} textAnchor="end">{tick.label}</text>
          </g>
        ))}
        {pts.map(([x, y], i) => {
          const sky = skies[i];
          if (!sky || !labeled(i)) return null;
          return (
            <g key={`sky-${i}`}>
              <line x1={x} x2={x} y1={SKY_ROW_Y + 20} y2={y - 32} className="rp-sky-drop" aria-hidden="true" />
              <SkyGlyph x={skyX(x) - (sky.temp ? 14 : 0)} y={SKY_ROW_Y} sky={sky} />
              {sky.temp && <text x={skyX(x) + 6} y={SKY_ROW_Y + 5} className="rp-sky-temp">{sky.temp}</text>}
            </g>
          );
        })}
        <path d={ridge} className="mt-ridge" />
        {snowTop !== null && snowTop > 0 && (
          <rect x="0" y="0" width={width} height={snowTop} clipPath={`url(#${id}-ridge)`} className="mt-snow" aria-hidden="true" />
        )}
        {ticks.map((tick) => (
          <line key={tick.label} x1={0} x2={width} y1={py(tick.y)} y2={py(tick.y)} clipPath={`url(#${id}-ridge)`} className="rp-tick-in" aria-hidden="true" />
        ))}
        {shown.map((level) => (
          <g key={level.label} className={`mt-level is-${level.tone}`} aria-hidden="true">
            <line x1="0" x2={width} y1={py(level.y)} y2={py(level.y)} strokeDasharray="5 4" />
            <text x={plotR - 4} y={py(level.y) - 6} textAnchor="end">{level.label}</text>
          </g>
        ))}
        <polyline points={pts.map((p) => p.join(",")).join(" ")} className="rp-crest" />
        {pts.slice(1).map((p, i) => stops[i + 1]?.tone === "over" && (
          <line key={i} x1={pts[i][0]} y1={pts[i][1]} x2={p[0]} y2={p[1]} className="rp-crest is-over" />
        ))}
        {/* The height of a section touching an unknown elevation is a guess. */}
        {pts.slice(1).map((p, i) => (points[i]?.estimated || points[i + 1]?.estimated) && (
          <line key={`est-${i}`} x1={pts[i][0]} y1={pts[i][1]} x2={p[0]} y2={p[1]} className="rp-crest is-estimated" aria-hidden="true" />
        ))}
        {pts.slice(1).map((p, i) => {
          const leg = legs[i];
          const span = p[0] - pts[i][0];
          const text = !leg ? null : span >= leg.label.length * 6.4 + 28 ? leg.label : span >= leg.short.length * 6.4 + 24 ? leg.short : null;
          if (!text) return null;
          // Inside the ridge, below the section's lower end.
          const midX = (pts[i][0] + p[0]) / 2;
          const lowY = Math.max(pts[i][1], p[1]);
          return <text key={`leg-${i}`} x={midX} y={Math.min(base - 10, lowY + 26)} textAnchor="middle" className="rp-leg" aria-hidden="true">{text}</text>;
        })}
        {distanceTicks.length > 0 && (
          <g className="rp-axis" aria-hidden="true">
            {distanceTicks.map((tick) => (
              <g key={tick.label}>
                <line x1={px(tick.x)} x2={px(tick.x)} y1={base} y2={base + 5} />
                <text x={Math.max(m.l + 8, Math.min(plotR - 8, px(tick.x)))} y={base + 19} textAnchor="middle">{tick.label}</text>
              </g>
            ))}
          </g>
        )}
        {pts.map(([x, y], i) => (
          <g key={i} role="button" tabIndex={0} aria-label={`Select ${stops[i]?.name}`} aria-pressed={i === selected}
            className={`rp-stop is-${stops[i]?.tone}${points[i]?.estimated ? " is-estimated" : ""}${i === selected ? " is-selected" : ""}`}
            onClick={() => onSelect(i)}
            onMouseEnter={() => setHovered(i)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(i); } }}>
            <rect x={column(i).from} y={0} width={Math.max(0, column(i).to - column(i).from)} height={height} fill="transparent" />
            {i === selected && <circle cx={x} cy={y} r={17} className="rp-halo" />}
            <circle cx={x} cy={y} r={i === selected ? 12 : 10} className="rp-dot" />
            <text x={x} y={y + 4} textAnchor="middle" className="rp-num">{i + 1}</text>
            {labeled(i) && stops[i]?.eta && (
              <text x={Math.max(m.l + 24, Math.min(plotR - 24, x))} y={y - 18} textAnchor="middle" className="rp-eta">{stops[i].eta}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
