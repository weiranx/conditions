import {
  ASPECT_ROSE_ORDER,
  leewardAspectsFromWind,
  secondaryCrossLoadingAspects,
  parseTerrainFromLocation,
  windDirectionToDegrees,
} from '../../../utils/avalanche';
import type { TerrainAspect } from '../../../utils/avalanche';
import type { AvalancheProblem } from '../../../app/types';

// --- Rose geometry (mirrors AspectElevationRose constants) ---

const CX = 80;
const CY = 84;
const CORE_R = 12;

const RINGS: Array<{ r1: number; r2: number }> = [
  { r1: CORE_R, r2: 30 },
  { r1: 30,     r2: 48 },
  { r1: 48,     r2: 62 },
];

const ASPECT_SVG_CENTER: Record<TerrainAspect, number> = {
  N: -90, NE: -45, E: 0, SE: 45, S: 90, SW: 135, W: 180, NW: 225,
};

const SPOKE_ANGLES = [-67.5, -22.5, 22.5, 67.5, 112.5, 157.5, 202.5, 247.5];
const LABEL_R = 76;
const HALF_SPAN = 22.5;
const ARROW_R = 44; // radius for arrow tip from center

function sectorPath(r1: number, r2: number, centerDeg: number): string {
  const s = centerDeg - HALF_SPAN;
  const e = centerDeg + HALF_SPAN;
  const rad = (d: number) => (d * Math.PI) / 180;
  const x = (r: number, d: number) => (CX + r * Math.cos(rad(d))).toFixed(2);
  const y = (r: number, d: number) => (CY + r * Math.sin(rad(d))).toFixed(2);
  return (
    `M${x(r2, s)} ${y(r2, s)}` +
    `A${r2} ${r2} 0 0 1 ${x(r2, e)} ${y(r2, e)}` +
    `L${x(r1, e)} ${y(r1, e)}` +
    `A${r1} ${r1} 0 0 0 ${x(r1, s)} ${y(r1, s)}Z`
  );
}

interface WindLoadingRoseProps {
  primaryAspects: TerrainAspect[];
  secondaryAspects: TerrainAspect[];
  windFromDeg: number | null;
}

function WindLoadingRose({ primaryAspects, secondaryAspects, windFromDeg }: WindLoadingRoseProps) {
  const primarySet = new Set(primaryAspects);
  const secondarySet = new Set(secondaryAspects);

  // Wind arrow: draw a line from center pointing toward where wind comes FROM
  // Compass degree → SVG angle: svgDeg = compassDeg - 90
  const arrowEl = windFromDeg !== null ? (() => {
    const svgDeg = windFromDeg - 90;
    const rad = (svgDeg * Math.PI) / 180;
    const tipX = CX + ARROW_R * Math.cos(rad);
    const tipY = CY + ARROW_R * Math.sin(rad);
    // Short tail from center in opposite direction
    const tailR = 6;
    const tailX = CX - tailR * Math.cos(rad);
    const tailY = CY - tailR * Math.sin(rad);
    // Arrowhead sides
    const headAngle = 28 * (Math.PI / 180);
    const headLen = 9;
    const backRad = rad + Math.PI; // opposite of tip direction
    const leftX = tipX + headLen * Math.cos(backRad - headAngle);
    const leftY = tipY + headLen * Math.sin(backRad - headAngle);
    const rightX = tipX + headLen * Math.cos(backRad + headAngle);
    const rightY = tipY + headLen * Math.sin(backRad + headAngle);
    return (
      <g className="wind-arrow">
        <line
          x1={tailX.toFixed(2)} y1={tailY.toFixed(2)}
          x2={tipX.toFixed(2)} y2={tipY.toFixed(2)}
          className="wind-arrow-shaft"
        />
        <polygon
          points={`${tipX.toFixed(2)},${tipY.toFixed(2)} ${leftX.toFixed(2)},${leftY.toFixed(2)} ${rightX.toFixed(2)},${rightY.toFixed(2)}`}
          className="wind-arrow-head"
        />
      </g>
    );
  })() : null;

  return (
    <svg
      viewBox="0 0 185 168"
      className="aspect-rose wind-loading-rose"
      aria-label="Wind loading aspect rose diagram"
    >
      {/* Sector cells: 3 rings × 8 aspects, colored by loading status */}
      {RINGS.flatMap(({ r1, r2 }) =>
        ASPECT_ROSE_ORDER.map((aspect) => {
          const cls = primarySet.has(aspect)
            ? 'wind-rose-cell primary'
            : secondarySet.has(aspect)
              ? 'wind-rose-cell secondary'
              : 'wind-rose-cell';
          return (
            <path
              key={`${r1}-${aspect}`}
              d={sectorPath(r1, r2, ASPECT_SVG_CENTER[aspect])}
              className={cls}
            />
          );
        })
      )}

      {/* Ring boundary circles */}
      {RINGS.map(({ r2 }) => (
        <circle key={r2} cx={CX} cy={CY} r={r2} className="aspect-rose-ring" />
      ))}
      <circle cx={CX} cy={CY} r={CORE_R} className="aspect-rose-ring" />

      {/* Spoke dividers */}
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

      {/* Center fill (covers spoke ends) */}
      <circle cx={CX} cy={CY} r={CORE_R - 0.5} className="aspect-rose-core" />

      {/* Wind direction arrow (drawn after center so it's visible) */}
      {arrowEl}

      {/* Compass labels */}
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
    </svg>
  );
}

// --- Main card ---

interface WindLoadingCardProps {
  windDirection: string | null | undefined;
  windGust: number;
  avalancheProblems?: AvalancheProblem[];
}

export function WindLoadingCard({
  windDirection,
  windGust,
  avalancheProblems,
}: WindLoadingCardProps) {
  const windFromDeg = windDirectionToDegrees(windDirection);
  const isCalm =
    !windDirection ||
    windDirection.trim().toUpperCase() === 'CALM' ||
    windDirection.trim().toUpperCase() === 'VRB' ||
    windDirection.trim().toUpperCase() === 'VARIABLE';

  const primaryAspects = leewardAspectsFromWind(windDirection);
  // Only show secondary cross-loading aspects for stronger gusts
  const showSecondary = Number.isFinite(windGust) && windGust >= 20;
  const secondaryAspects = showSecondary ? secondaryCrossLoadingAspects(windDirection) : [];

  // Detect wind slab problems that overlap with primary loading aspects
  const primarySet = new Set(primaryAspects);
  const windSlabOverlap = (avalancheProblems ?? []).filter((p) => {
    if (!p.name || !p.location) return false;
    if (!p.name.toLowerCase().includes('wind slab')) return false;
    const { aspects } = parseTerrainFromLocation(p.location);
    return [...aspects].some((a) => primarySet.has(a));
  });

  return (
    <>
      {isCalm ? (
        <p className="wind-loading-calm">
          Wind direction is calm or variable — broad lee-aspect loading is unlikely, but small
          drift pockets can still form near terrain features.
        </p>
      ) : (
        <div className="wind-loading-body">
          <WindLoadingRose
            primaryAspects={primaryAspects}
            secondaryAspects={secondaryAspects}
            windFromDeg={windFromDeg}
          />
          <div className="wind-loading-aspects">
            {primaryAspects.length > 0 && (
              <div className="wind-loading-aspect-group">
                <span className="stat-label">Primary loading</span>
                <div className="wind-aspect-chips">
                  {primaryAspects.map((a) => (
                    <span key={a} className="wind-aspect-chip wind-loading-primary-chip">{a}</span>
                  ))}
                </div>
              </div>
            )}
            {secondaryAspects.length > 0 && (
              <div className="wind-loading-aspect-group">
                <span className="stat-label">Cross-loading</span>
                <div className="wind-aspect-chips">
                  {secondaryAspects.map((a) => (
                    <span key={`sec-${a}`} className="wind-aspect-chip wind-loading-secondary-chip">{a}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {windSlabOverlap.length > 0 && (
        <p className="wind-loading-overlap-alert">
          Wind Slab problem reported on primary loading aspects — evaluate carefully before committing to leeward terrain.
        </p>
      )}
    </>
  );
}
