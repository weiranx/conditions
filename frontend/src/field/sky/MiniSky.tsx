import { useId } from "react";
import { useWidth } from "./useWidth";
import { isOverHour, skyRuns, spanLabel, sunProgress, type SkyHour } from "./sky-model";

/**
 * A day's forecast as a small scene, for picking between days at a glance:
 * the sky colour of each hour, clouds and rain where they are forecast, the
 * sun where it is up, and a strip along the ridge that is hatched for hours
 * over your limits and dashed where readings are missing.
 */
export function MiniSky({ hours, sunrise, sunset, clock }: {
  hours: SkyHour[];
  sunrise: number | null;
  sunset: number | null;
  clock: (minute: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(360);
  const id = useId().replace(/:/g, "");
  if (!hours.length) return null;
  const height = 58;
  const ground = 40;
  const cw = width / hours.length;
  const x = (i: number) => i * cw;
  const over = skyRuns(hours).filter((run) => run.tone === "over");
  const label = `${clock(hours[0].minute)} to ${clock(hours[hours.length - 1].minute + 60)}. ` +
    (over.length ? `Over your limits ${over.map((run) => spanLabel(hours, run, clock)).join(" and ")}.` : "No hours over your limits.") +
    ` Wettest hour ${Math.max(...hours.map((h) => (Number.isFinite(h.precipChance) ? h.precipChance : 0)))}% chance.`;
  // The sun sits over the middle of the brightest stretch it is up for.
  const up = hours.map((h) => sunProgress(h.minute + 30, sunrise, sunset));
  const clear = hours.map((h, i) => up[i] !== null && (h.kind === "clear" || h.kind === "partly"));
  const sunIndex = clear.some(Boolean)
    ? (clear.indexOf(true) + clear.lastIndexOf(true)) / 2
    : null;
  const sunT = sunIndex !== null ? up[Math.round(sunIndex)] : null;
  const ridge = (() => {
    let d = `M0 ${ground}`;
    for (let i = 0; i <= 12; i += 1) {
      const px = (width * i) / 12;
      const py = ground - Math.abs(Math.sin(i * 1.9) * 5) - (i === 6 ? 9 : i === 5 || i === 7 ? 4 : 0);
      d += ` L${px.toFixed(1)} ${py.toFixed(1)}`;
    }
    return `${d} L${width} ${height} L0 ${height} Z`;
  })();
  return (
    <div className="sky-minisky" ref={ref} role="img" aria-label={label}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <defs>
          <linearGradient id={`${id}z`} x1="0" x2="1">
            {hours.map((h, i) => <stop key={i} offset={hours.length === 1 ? 0 : ((i + 0.5) / hours.length).toFixed(4)} stopColor={h.zenith} />)}
          </linearGradient>
          <linearGradient id={`${id}h`} x1="0" x2="1">
            {hours.map((h, i) => <stop key={i} offset={hours.length === 1 ? 0 : ((i + 0.5) / hours.length).toFixed(4)} stopColor={h.horizon} />)}
          </linearGradient>
          <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#fff" stopOpacity="1" />
          </linearGradient>
          <mask id={`${id}m`}><rect width={width} height={ground} fill={`url(#${id}f)`} /></mask>
          <pattern id={`${id}p`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <rect width="5" height="5" fill="rgba(255,154,77,.3)" /><line x1="0" y1="0" x2="0" y2="5" stroke="#FF9A4D" strokeWidth="1.6" />
          </pattern>
          <clipPath id={`${id}c`}><rect width={width} height={height} rx="8" /></clipPath>
        </defs>
        <g clipPath={`url(#${id}c)`}>
          <rect width={width} height={ground + 4} fill={`url(#${id}z)`} />
          <rect width={width} height={ground + 4} fill={`url(#${id}h)`} mask={`url(#${id}m)`} />
          {sunIndex !== null && sunT !== null && (
            <circle cx={x(sunIndex + 0.5)} cy={ground - 6 - Math.sin(Math.PI * sunT) * 22} r="6" fill="#fff4cf" />
          )}
          {hours.map((h, i) => {
            const chance = Number.isFinite(h.precipChance) ? h.precipChance : 0;
            const wet = chance >= 30 || h.kind === "rain" || h.kind === "snow" || h.kind === "storm";
            const cloudy = wet || h.kind === "cloudy" || h.kind === "fog";
            if (!cloudy) return null;
            const cx = x(i + 0.5), cy = 11 + (i % 2) * 3;
            const fill = chance >= 60 || h.kind === "storm" ? "#aab3bb" : "#eef2f5";
            return (
              <g key={i}>
                {wet && [-0.25, 0, 0.25].map((f) => (
                  <line key={f} x1={cx + f * cw} y1={cy + 6} x2={cx + f * cw - 3} y2={ground - 4}
                    stroke={h.kind === "snow" ? "#fff" : "#d6e6f5"} strokeWidth={h.kind === "snow" ? 2 : 1.2}
                    strokeDasharray={h.kind === "snow" ? "2 5" : "4 4"} strokeOpacity=".8" />
                ))}
                <ellipse cx={cx} cy={cy} rx={Math.max(6, cw * 0.46)} ry="6" fill={fill} opacity=".9" />
              </g>
            );
          })}
          <path d={ridge} className="minisky-ridge" />
          {hours.map((h, i) => {
            const bad = isOverHour(h);
            const missing = !bad && h.tone === "missing";
            return (
              <rect key={i} x={x(i) + 1} y={ground + 5} width={Math.max(1, cw - 2)} height="6" rx="3"
                fill={bad ? `url(#${id}p)` : missing ? "none" : "rgba(255,255,255,.28)"}
                stroke={bad ? "#FF9A4D" : missing ? "rgba(255,255,255,.7)" : "none"} strokeWidth="1"
                strokeDasharray={missing ? "2 2" : undefined} />
            );
          })}
        </g>
      </svg>
      <span>{clock(hours[0].minute)}</span>
      <span className="is-end">{clock(hours[hours.length - 1].minute + 60)}</span>
    </div>
  );
}
