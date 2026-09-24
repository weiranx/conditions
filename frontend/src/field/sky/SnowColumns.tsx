import { formatSnowDepthForElevationUnit, formatSweForElevationUnit } from "../../app/core";
import { useWidth } from "./useWidth";

export type SnowColumn = {
  label: string;
  /** Where the reading comes from, e.g. station name and distance. */
  sub: string;
  depthIn: number | null;
  sweIn: number | null;
};

// Rough heights on an adult, for reading depth against your own legs.
const BODY = [
  { in: 8, label: "Boot top" },
  { in: 20, label: "Knee" },
  { in: 36, label: "Waist" },
  { in: 54, label: "Chest" },
];

const known = (v: number | null): v is number => v !== null && Number.isFinite(v) && v >= 0;

/**
 * Each snowpack source as a column of snow drawn to one scale, with the water
 * it holds (snow water equivalent) as a layer at the base and rough body
 * heights across the back. A source with no reading is drawn as an empty,
 * dashed column rather than as zero snow.
 */
export function SnowColumns({ columns, metric }: { columns: SnowColumn[]; metric: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>(600);
  const depths = columns.map((c) => c.depthIn).filter(known);
  const max = Math.max(24, ...depths.map((d) => d * 1.15));
  const height = 210;
  const top = 14, bottom = height - 46;
  const y = (inches: number) => bottom - (inches / max) * (bottom - top);
  const left = 52;
  const plotW = width - left - 8;
  const slot = plotW / Math.max(1, columns.length);
  const colW = Math.min(88, slot * 0.56);
  const unit = metric ? "cm" : "in";
  const toUnit = (inches: number) => (metric ? inches * 2.54 : inches);
  const depth = (inches: number) => formatSnowDepthForElevationUnit(inches, metric ? "m" : "ft");
  const water = (inches: number) => formatSweForElevationUnit(inches, metric ? "m" : "ft").replace(/\s*SWE$/, "");
  const steps = metric ? [5, 10, 20, 25, 50, 100] : [2, 6, 12, 24, 36, 48];
  const maxUnit = toUnit(max);
  const step = steps.find((s) => maxUnit / s <= 5) ?? steps[steps.length - 1];
  const ticks: number[] = [];
  for (let v = 0; v <= maxUnit; v += step) ticks.push(metric ? v / 2.54 : v);
  // About 6 px per character at 11–12 px; clip text to its slot.
  const fit = (text: string) => {
    const chars = Math.max(4, Math.floor((slot - 6) / 6.2));
    return text.length > chars ? `${text.slice(0, chars - 1)}…` : text;
  };
  const describe = columns.map((c) => `${c.label}: ${known(c.depthIn) ? `${depth(c.depthIn)} deep` : "depth unavailable"}${known(c.sweIn) ? `, ${water(c.sweIn)} of water` : ""}`).join(". ");
  return (
    <div className="sky-snow-columns" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Snow depth by source, to scale. ${describe}.`}>
        {ticks.map((t, i) => (
          <g key={t} className="sc-tick" aria-hidden="true">
            <line x1={left} x2={width - 8} y1={y(t)} y2={y(t)} />
            <text x={left - 8} y={y(t) + 4} textAnchor="end">{Math.round(toUnit(t))}{i === ticks.length - 1 ? ` ${unit}` : ""}</text>
          </g>
        ))}
        {BODY.filter((b) => b.in < max).map((b) => (
          <g key={b.label} className="sc-body" aria-hidden="true">
            <line x1={left} x2={width - 8} y1={y(b.in)} y2={y(b.in)} />
            <text x={width - 10} y={y(b.in) - 4} textAnchor="end">{b.label}</text>
          </g>
        ))}
        {columns.map((c, i) => {
          const cx = left + slot * (i + 0.5);
          const x0 = cx - colW / 2;
          const has = known(c.depthIn);
          const depthY = has ? y(c.depthIn as number) : top + 20;
          const sweY = known(c.sweIn) && has ? y(Math.min(c.sweIn, c.depthIn as number)) : bottom;
          return (
            <g key={c.label} className={`sc-col${has ? "" : " is-missing"}`}>
              {has ? (
                <>
                  <path className="sc-snow" d={`M${x0},${bottom} V${depthY + 4} q${colW * 0.25},-6 ${colW * 0.5},-2 t${colW * 0.5},-1 V${bottom} Z`} />
                  {sweY < bottom && <rect className="sc-swe" x={x0} y={sweY} width={colW} height={bottom - sweY} />}
                  <text className="sc-depth" x={cx} y={depthY - 8} textAnchor="middle">{depth(c.depthIn as number)}</text>
                </>
              ) : (
                <>
                  <rect className="sc-empty" x={x0} y={depthY} width={colW} height={bottom - depthY} rx="4" />
                  <text className="sc-depth is-missing" x={cx} y={(depthY + bottom) / 2} textAnchor="middle">No reading</text>
                </>
              )}
              <text className="sc-label" x={cx} y={bottom + 18} textAnchor="middle">{fit(c.label)}</text>
              <text className="sc-sub" x={cx} y={bottom + 34} textAnchor="middle">{fit(c.sub)}<title>{c.sub}</title></text>
            </g>
          );
        })}
        <line className="sc-ground" x1={left} x2={width - 8} y1={bottom} y2={bottom} />
      </svg>
      <ul className="sky-legend" aria-label="Legend">
        <li><i className="is-snow" />Snow depth</li>
        <li><i className="is-swe" />Water in the snow (SWE)</li>
      </ul>
    </div>
  );
}
