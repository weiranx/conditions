import type { RouteStopSummary } from "../route-planning";
import { useWidth } from "./useWidth";

const HEIGHT = 80;
const TONE_WORD = { over: "over your limits", missing: "forecast incomplete", within: "within your limits" } as const;

/**
 * The route's checkpoints in order, each colored by its forecast against the
 * user's limits. Drawn at its real width so labels stay legible on a phone.
 */
export function RouteStrip({ name, stops, profile, eta }: {
  name: string;
  stops: RouteStopSummary[];
  /** Positions from 0 to 1 (y = 1 is the high point); null draws the stops level and evenly spaced. */
  profile: { x: number; y: number }[] | null;
  eta: (time: string) => string;
}) {
  const [ref, width] = useWidth<HTMLSpanElement>(640);
  if (!stops.length) return null;
  const pad = 10;
  const x = (i: number) => pad + (profile ? profile[i].x : stops.length === 1 ? 0.5 : i / (stops.length - 1)) * (width - pad * 2);
  const y = (i: number) => (profile ? 50 - profile[i].y * 28 : 36);
  const line = stops.map((_, i) => `${x(i).toFixed(1)},${y(i).toFixed(1)}`).join(" ");
  const firstOver = stops.findIndex((stop) => stop.tone === "over");
  const anchor = (px: number) => (px < 60 ? "start" : px > width - 60 ? "end" : "middle");
  const first = stops[0];
  const last = stops[stops.length - 1];
  return (
    <span className="sky-route-strip" ref={ref}>
      <svg className="sky-viz" width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img"
        aria-label={`Checkpoints along ${name}: ${stops.map((stop) => `${stop.name}${stop.eta ? ` at ${eta(stop.eta)}` : ""}, ${TONE_WORD[stop.tone]}${stop.dark ? ", after dark" : ""}`).join("; ")}.`}>
        {stops.length > 1 && (
          <>
            <polygon points={`${x(0).toFixed(1)},56 ${line} ${x(stops.length - 1).toFixed(1)},56`} className="f-fill" />
            <polyline points={line} fill="none" className="s-secondary" strokeOpacity=".55" strokeWidth="2" strokeLinejoin="round" />
          </>
        )}
        {stops.map((stop, i) => (
          <circle key={i} cx={x(i)} cy={y(i)} r={stop.tone === "over" ? 6.5 : 5.5}
            className={stop.tone === "over" ? "f-caution" : stop.tone === "missing" ? "f-none s-missing" : "f-accent"}
            strokeDasharray={stop.tone === "missing" ? "2 2" : undefined} />
        ))}
        {firstOver >= 0 && stops[firstOver].eta && firstOver !== 0 && firstOver !== stops.length - 1 && (
          <text x={x(firstOver)} y={y(firstOver) - 12} textAnchor={anchor(x(firstOver))} className="t-caution">
            {eta(stops[firstOver].eta as string)}
          </text>
        )}
        {first.eta && <text x={x(0)} y={HEIGHT - 4} textAnchor="start" className={first.tone === "over" ? "t-caution" : undefined}>{eta(first.eta)}</text>}
        {stops.length > 1 && last.eta && (
          <text x={x(stops.length - 1)} y={HEIGHT - 4} textAnchor="end" className={last.tone === "over" ? "t-caution" : undefined}>
            {eta(last.eta)}{last.dark ? " · after dark" : ""}
          </text>
        )}
      </svg>
    </span>
  );
}
