import { ASPECT_ROSE_ORDER } from '../../../utils/avalanche';
import type { TerrainAspect, TerrainElevationBand } from '../../../utils/avalanche';

// --- Geometry ---

const CX = 80;   // SVG center x
const CY = 84;   // SVG center y (shifted down slightly for N label clearance)
const CORE_R = 12;

// Standard avalanche center ring order: ATL innermost → NTL → BTL outermost
const RINGS: Array<{ band: TerrainElevationBand; r1: number; r2: number; abbr: string }> = [
  { band: 'upper', r1: CORE_R, r2: 30, abbr: 'ATL' },
  { band: 'middle', r1: 30,    r2: 48, abbr: 'NTL' },
  { band: 'lower',  r1: 48,    r2: 62, abbr: 'BTL' },
];

// SVG angle convention: 0° = right (+x), angles increase clockwise on screen
// Compass N (0°) maps to SVG -90° (pointing straight up)
const ASPECT_SVG_CENTER: Record<TerrainAspect, number> = {
  N: -90, NE: -45, E: 0, SE: 45, S: 90, SW: 135, W: 180, NW: 225,
};

// Spoke angles: 8 dividers placed between sectors (at ±22.5° from each sector center)
const SPOKE_ANGLES = [-67.5, -22.5, 22.5, 67.5, 112.5, 157.5, 202.5, 247.5];

const LABEL_R = 76;   // radius for compass direction labels
const HALF_SPAN = 22.5; // full 45° sectors, ring stroke provides visual gap

// Build SVG arc sector path for a ring band + compass direction
function sectorPath(r1: number, r2: number, centerDeg: number): string {
  const s = centerDeg - HALF_SPAN;
  const e = centerDeg + HALF_SPAN;
  const rad = (d: number) => (d * Math.PI) / 180;
  const x = (r: number, d: number) => (CX + r * Math.cos(rad(d))).toFixed(2);
  const y = (r: number, d: number) => (CY + r * Math.sin(rad(d))).toFixed(2);
  // Outer arc: clockwise (sweep=1); inner arc: counter-clockwise (sweep=0)
  // Each sector spans exactly 45° so large-arc-flag is always 0
  return (
    `M${x(r2, s)} ${y(r2, s)}` +
    `A${r2} ${r2} 0 0 1 ${x(r2, e)} ${y(r2, e)}` +
    `L${x(r1, e)} ${y(r1, e)}` +
    `A${r1} ${r1} 0 0 0 ${x(r1, s)} ${y(r1, s)}Z`
  );
}

interface AspectElevationRoseProps {
  aspects: Set<TerrainAspect>;
  elevations: Set<TerrainElevationBand>;
}

export function AspectElevationRose({ aspects, elevations }: AspectElevationRoseProps) {
  // No specific data → treat all cells as active (all-aspects/all-elevations case)
  const allAspects = aspects.size === 0;
  const allElevs = elevations.size === 0;

  return (
    <svg
      viewBox="0 0 185 168"
      className="aspect-rose"
      aria-label="Avalanche aspect/elevation rose diagram"
    >
      {/* 24 sector cells: 3 rings × 8 aspects */}
      {RINGS.flatMap(({ band, r1, r2 }) =>
        ASPECT_ROSE_ORDER.map((aspect) => {
          const active =
            (allAspects || aspects.has(aspect)) &&
            (allElevs || elevations.has(band));
          return (
            <path
              key={`${band}-${aspect}`}
              d={sectorPath(r1, r2, ASPECT_SVG_CENTER[aspect])}
              className={`aspect-rose-cell${active ? ' active' : ''}`}
            />
          );
        })
      )}

      {/* Ring boundary circles */}
      {RINGS.map(({ r2 }) => (
        <circle key={r2} cx={CX} cy={CY} r={r2} className="aspect-rose-ring" />
      ))}
      <circle cx={CX} cy={CY} r={CORE_R} className="aspect-rose-ring" />

      {/* Spoke dividers between sectors (from center to BTL outer edge) */}
      {SPOKE_ANGLES.map((deg) => {
        const rad = (deg * Math.PI) / 180;
        return (
          <line
            key={deg}
            x1={CX} y1={CY}
            x2={(CX + RINGS[2].r2 * Math.cos(rad)).toFixed(2)}
            y2={(CY + RINGS[2].r2 * Math.sin(rad)).toFixed(2)}
            className="aspect-rose-spoke"
          />
        );
      })}

      {/* Center fill (drawn after spokes so it covers their center ends) */}
      <circle cx={CX} cy={CY} r={CORE_R - 0.5} className="aspect-rose-core" />

      {/* Compass direction labels */}
      {ASPECT_ROSE_ORDER.map((aspect) => {
        const rad = (ASPECT_SVG_CENTER[aspect] * Math.PI) / 180;
        return (
          <text
            key={aspect}
            x={(CX + LABEL_R * Math.cos(rad)).toFixed(2)}
            y={(CY + LABEL_R * Math.sin(rad)).toFixed(2)}
            textAnchor="middle"
            className="aspect-rose-label"
          >
            {aspect}
          </text>
        );
      })}

      {/* Elevation ring labels with leader lines (right side of rose) */}
      {RINGS.map(({ band, r2, abbr }, idx) => {
        const active = allElevs || elevations.has(band);
        const labelY = CY + (idx - 1) * 15; // ATL: CY-15, NTL: CY, BTL: CY+15
        const dotX = CX + r2;
        return (
          <g key={band}>
            <line
              x1={(dotX + 2).toFixed(2)} y1={CY.toString()}
              x2="156" y2={labelY.toFixed(2)}
              className="aspect-rose-elev-line"
            />
            <circle
              cx={dotX.toFixed(2)} cy={CY.toString()} r="1.5"
              className="aspect-rose-elev-dot"
            />
            <text
              x="161"
              y={labelY.toFixed(2)}
              dominantBaseline="middle"
              className={`aspect-rose-elev-text${active ? ' active' : ''}`}
            >
              {abbr}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
