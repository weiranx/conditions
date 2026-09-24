import { useId, type KeyboardEvent } from "react";

export const ROSE_ASPECTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type RoseAspect = (typeof ROSE_ASPECTS)[number];

const point = (cx: number, cy: number, r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r].map((v) => v.toFixed(2)).join(",");
};

/** One ring segment: the slice of an aspect between two radii. */
function sector(cx: number, cy: number, inner: number, outer: number, from: number, to: number) {
  return `M${point(cx, cy, inner, from)} L${point(cx, cy, outer, from)} A${outer},${outer} 0 0,1 ${point(cx, cy, outer, to)}`
    + ` L${point(cx, cy, inner, to)} A${inner},${inner} 0 0,0 ${point(cx, cy, inner, from)} Z`;
}

/**
 * Slopes seen from above: eight aspects around, elevation as rings. By
 * avalanche-forecast convention the highest terrain is the inner ring. Each
 * cell takes a class from `cellClass`; when `onSelect` is given, cells are
 * buttons.
 */
export function AspectRose({ rings, cellClass, cellLabel, onSelect, selected, size = 180, label, compact = false }: {
  /** Ring labels, innermost (highest) first. */
  rings: string[];
  cellClass: (aspect: RoseAspect, ring: number) => string;
  cellLabel: (aspect: RoseAspect, ring: number) => string;
  onSelect?: (aspect: RoseAspect, ring: number) => void;
  selected?: { aspect: RoseAspect; ring: number } | null;
  size?: number;
  label: string;
  /** Hide the aspect letters, for small inline roses. */
  compact?: boolean;
}) {
  const hatchId = `${useId().replace(/:/g, "")}-hatch`;
  // Over-limit cells are hatched as well as coloured, never colour alone.
  const hatch = (cls: string) => /\bis-avoid\b/.test(cls) ? { fill: `url(#${hatchId})` } : undefined;
  const c = size / 2;
  const outer = compact ? c - 2 : c - 22;
  const hub = outer * 0.16;
  const step = (outer - hub) / Math.max(1, rings.length);
  const key = (event: KeyboardEvent, aspect: RoseAspect, ring: number) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect?.(aspect, ring); }
  };
  return (
    <svg className={`sky-rose${compact ? " is-compact" : ""}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      role={onSelect ? "group" : "img"} aria-label={label}>
      <defs>
        <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" className="rose-hatch-bg" />
          <line x1="0" y1="0" x2="0" y2="6" className="rose-hatch-line" strokeWidth="2.4" />
        </pattern>
      </defs>
      {ROSE_ASPECTS.map((aspect, k) => rings.map((ringLabel, r) => {
        const isSelected = selected?.aspect === aspect && selected.ring === r;
        const cls = cellClass(aspect, r);
        const d = sector(c, c, hub + r * step, hub + (r + 1) * step, k * 45 - 22.5, k * 45 + 22.5);
        return onSelect ? (
          <path key={`${aspect}-${r}`} d={d} className={`rose-cell ${cls}${isSelected ? " is-selected" : ""}`} style={hatch(cls)}
            role="button" tabIndex={0} aria-pressed={isSelected} aria-label={cellLabel(aspect, r)}
            onClick={() => onSelect(aspect, r)} onKeyDown={(event) => key(event, aspect, r)} />
        ) : (
          <path key={`${aspect}-${r}`} d={d} className={`rose-cell ${cls}`} style={hatch(cls)}>
            <title>{`${aspect} · ${ringLabel}`}</title>
          </path>
        );
      }))}
      {selected && (() => {
        const k = ROSE_ASPECTS.indexOf(selected.aspect);
        return <path className="rose-outline" d={sector(c, c, hub + selected.ring * step, hub + (selected.ring + 1) * step, k * 45 - 22.5, k * 45 + 22.5)} />;
      })()}
      <circle cx={c} cy={c} r={hub} className="rose-hub" />
      {!compact && ROSE_ASPECTS.map((aspect, k) => {
        const [x, y] = point(c, c, outer + 11, k * 45).split(",");
        return <text key={aspect} x={x} y={y} className="rose-aspect" textAnchor="middle" dominantBaseline="central">{aspect}</text>;
      })}
    </svg>
  );
}
