import { useId, useState } from "react";
import { useWidth } from "./useWidth";
import { WeatherSky } from "./MountainSection";
import { ridgeShape } from "./ridge";
import { shortHour, type SkyHour } from "./sky-model";

type Level = { label: string; ft: number; tone: "cold" | "snow" };

const chanceOf = (hour: SkyHour) => (Number.isFinite(hour.precipChance) ? hour.precipChance : null);

/**
 * Where precipitation falls as rain and where as snow, hour by hour. The
 * ridge runs from your trailhead to the objective with heights to scale;
 * precipitation turns to snow at the snow level (or the freezing level when
 * no snow level is forecast). One level is forecast for the whole window.
 */
export function PrecipMountain({ hours, objectiveFt, trailheadFt, levels, format, timeStyle }: {
  hours: SkyHour[];
  objectiveFt: number;
  trailheadFt: number | null;
  levels: Level[];
  format: { elevation: (ft: number) => string; clock: (minute: number) => string };
  timeStyle: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(900);
  const id = useId().replace(/:/g, "");
  // Open on the wettest hour; the first hour when none has a chance.
  const wettest = hours.reduce((best, hour, i) => ((chanceOf(hour) ?? -1) > (chanceOf(hours[best]) ?? -1) ? i : best), 0);
  const [picked, setPicked] = useState<number | null>(null);
  const index = picked !== null && picked < hours.length ? picked : wettest;
  const hour = hours[index];
  if (!hour) return null;
  const base = trailheadFt !== null && trailheadFt < objectiveFt - 300 ? trailheadFt : objectiveFt - 3000;
  const phase = levels.find((l) => l.tone === "snow") ?? levels.find((l) => l.tone === "cold") ?? null;
  const inView = levels.filter((l) => l.ft > base - 2500 && l.ft < objectiveFt + 3000);
  const lo = Math.min(base, ...inView.map((l) => l.ft)) - 500;
  const hi = Math.max(objectiveFt, ...inView.map((l) => l.ft)) + 900;
  const height = width < 560 ? 250 : 290;
  const y = (ft: number) => 12 + (1 - (ft - lo) / (hi - lo)) * (height - 24);
  const { path, x: ridgeX } = ridgeShape({ plotW: width, height, y, base, top: objectiveFt });
  const snowLevel = inView.find((l) => l.tone === "snow");
  const chance = chanceOf(hour);
  const wet = hour.kind === "rain" || hour.kind === "snow" || hour.kind === "storm" || (chance ?? 0) >= 50;
  const phaseText = phase === null
    ? "No snow or freezing level is forecast, so rain and snow can't be separated."
    : phase.ft <= base
      ? `At ${format.elevation(phase.ft)} the ${phase.label.toLowerCase()} is at or below your trailhead: anything that falls on your route is likely snow.`
      : phase.ft >= objectiveFt
        ? `The ${phase.label.toLowerCase()} is above your objective at ${format.elevation(phase.ft)}: anything that falls on your route is likely rain.`
        : `Snow above about ${format.elevation(phase.ft)}, rain below it.`;
  const summary = `${format.clock(hour.minute)}: ${chance === null ? "precipitation chance unavailable" : `${Math.round(chance)}% chance of precipitation`}${hour.condition ? `, ${hour.condition.toLowerCase()}` : ""}.`;
  return (
    <div className="sky-precip-mountain">
      <div className="sky-precip-hours" role="group" aria-label="Precipitation hour">
        {hours.map((h, i) => {
          const c = chanceOf(h);
          return (
            <button key={h.index} type="button" aria-pressed={i === index}
              aria-label={`${format.clock(h.minute)}, ${c === null ? "chance unavailable" : `${Math.round(c)}% chance`}`}
              onClick={() => setPicked(i)}>
              <i style={{ ["--p" as string]: c === null ? 0 : c / 100 }} className={c === null ? "is-missing" : undefined} />
              <span>{c === null ? "—" : `${Math.round(c)}%`}</span>
              <small>{shortHour(h.minute, timeStyle)}</small>
            </button>
          );
        })}
      </div>
      <div className="sky-mountain sky-precip-scene" ref={ref}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
          aria-label={`${summary} ${wet ? phaseText : ""}`}>
          <defs>
            <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={hour.zenith} stopOpacity="0.6" />
              <stop offset="1" stopColor={hour.horizon} stopOpacity="0.35" />
            </linearGradient>
            <clipPath id={`${id}-ridge`}><path d={path} /></clipPath>
            <clipPath id={`${id}-plot`}><rect width={width} height={height} /></clipPath>
          </defs>
          <rect width={width} height={height} fill={`url(#${id}-sky)`} />
          <g clipPath={`url(#${id}-plot)`}>
            <WeatherSky weather={hour} plotW={width} height={height} y={y} phaseFt={phase?.ft ?? null} />
          </g>
          <path d={path} className="mt-ridge" />
          {snowLevel && <rect x="0" y="0" width={width} height={Math.max(0, y(snowLevel.ft))} clipPath={`url(#${id}-ridge)`} className="mt-snow" />}
          {inView.map((l) => (
            <g key={l.label} className={`mt-level is-${l.tone}`}>
              <line x1="0" x2={width} y1={y(l.ft)} y2={y(l.ft)} strokeDasharray="5 4" />
              <text x="22" y={y(l.ft) - 6}>{l.label} {format.elevation(l.ft)}</text>
            </g>
          ))}
          <g className="mt-objective">
            <circle cx={ridgeX(objectiveFt)} cy={y(objectiveFt)} r="7" />
            <text x={ridgeX(objectiveFt) - 12} y={y(objectiveFt) - 12} textAnchor="end">Objective</text>
          </g>
          {trailheadFt !== null && base === trailheadFt && (
            <g className="mt-target">
              <circle cx={Math.max(8, ridgeX(base))} cy={y(base)} r="5" />
              {/* Below the point: level labels run along the left edge above it. */}
              <text x={Math.max(8, ridgeX(base)) + 10} y={Math.min(height - 4, y(base) + 16)}>Trailhead</text>
            </g>
          )}
        </svg>
      </div>
      <p className="sky-cap is-body" aria-live="polite">
        <strong>{summary}</strong> {wet ? phaseText : (chance ?? 0) > 0 ? `Mostly dry. ${phaseText}` : "No precipitation expected this hour."}
      </p>
    </div>
  );
}
