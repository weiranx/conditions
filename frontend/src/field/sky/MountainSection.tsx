import { useId, type ReactElement } from "react";
import type { ElevationForecastBand } from "../../app/types";
import { useWidth } from "./useWidth";
import { spreadLabels } from "./spread-labels";
import { noise, precipText, ridgeShape, type Weather } from "./ridge";

type Level = { label: string; ft: number; tone: "cold" | "snow" };

export function Cloud({ x, y, s, className }: { x: number; y: number; s: number; className: string }) {
  return (
    <g className={className} transform={`translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${s})`}>
      <circle cx="-16" cy="4" r="12" />
      <circle cx="2" cy="-4" r="17" />
      <circle cx="20" cy="4" r="12" />
      <rect x="-28" y="4" width="60" height="12" rx="6" />
    </g>
  );
}

/**
 * The hour's sky drawn over the section: sun or moon, cloud cover, and
 * precipitation that falls as snow above the snow level (or freezing level)
 * and as rain below it. Illustrative, like the ridge; driven by the forecast.
 */
export function WeatherSky({ weather, plotW, height, y, phaseFt }: {
  weather: Weather;
  plotW: number;
  height: number;
  y: (ft: number) => number;
  /** Elevation where precipitation turns from rain to snow, when known. */
  phaseFt: number | null;
}) {
  const { kind, night } = weather;
  const chance = Number.isFinite(weather.precipChance) ? weather.precipChance : 0;
  const wet = kind === "rain" || kind === "snow" || kind === "storm" || chance >= 50;
  const clouds = kind === "storm" ? 5 : wet || kind === "cloudy" ? 4 : kind === "partly" || kind === "fog" ? 2 : 0;
  const heavy = wet || kind === "storm";
  // "neutral" means the condition is unknown or unavailable, so draw no sun or stars for it.
  const showSun = kind === "clear" || kind === "partly" || (kind === "fog" && !wet);
  const cloudY = 34;
  const cloudSpots = [[0.3, 0], [0.72, 6], [0.5, -4], [0.12, 8], [0.9, 2]] as const;
  const scale = plotW < 420 ? 0.9 : 1.2;
  // Pixels back to feet: y() is linear, so two probes recover it.
  const y0 = y(0), perFt = (y(1000) - y0) / 1000;
  const marks: ReactElement[] = [];
  if (wet) {
    const density = Math.min(0.85, Math.max(0.35, chance / 100));
    const colW = 22, rowH = 24, startY = cloudY + 22;
    for (let i = 0; i * colW < plotW; i += 1) {
      for (let j = 0; startY + j * rowH < height; j += 1) {
        if (noise(i, j, 1) > density) continue;
        const mx = i * colW + noise(i, j, 2) * colW;
        const my = startY + j * rowH + noise(i, j, 3) * rowH;
        const ft = (my - y0) / perFt;
        const snow = phaseFt !== null ? ft >= phaseFt : kind === "snow";
        marks.push(snow
          ? <circle key={`${i}-${j}`} className="mt-flake" cx={mx.toFixed(1)} cy={my.toFixed(1)} r="2.4" />
          : <line key={`${i}-${j}`} className="mt-drop" x1={mx.toFixed(1)} y1={my.toFixed(1)} x2={(mx - 3).toFixed(1)} y2={(my + 9).toFixed(1)} />);
      }
    }
  }
  const sunX = plotW * 0.14, sunY = cloudY + 6;
  return (
    <g className="mt-weather" aria-hidden="true">
      {night && (kind === "clear" || kind === "partly") && [0.08, 0.22, 0.41, 0.58, 0.83, 0.94].map((fx, i) => (
        <circle key={fx} className="mt-star" cx={plotW * fx} cy={14 + noise(i, 0, 9) * 60} r={i % 2 ? 1 : 1.4} />
      ))}
      {showSun && (night
        ? <path className="mt-moon" d={`M${sunX + 6},${sunY - 14} a14,14 0 1,0 8,24 a11,11 0 1,1 -8,-24 Z`} />
        : (
          <g className="mt-sun">
            {Array.from({ length: 8 }, (_, i) => {
              const a = (i * Math.PI) / 4;
              return <line key={i} x1={sunX + Math.cos(a) * 19} y1={sunY + Math.sin(a) * 19} x2={sunX + Math.cos(a) * 25} y2={sunY + Math.sin(a) * 25} />;
            })}
            <circle cx={sunX} cy={sunY} r="13" />
          </g>
        ))}
      {marks}
      {cloudSpots.slice(0, clouds).map(([fx, dy], i) => (
        <Cloud key={i} x={plotW * fx} y={cloudY + dy} s={scale * (i % 2 ? 0.85 : 1.05)} className={`mt-cloud${heavy ? " is-heavy" : ""}`} />
      ))}
      {kind === "storm" && (
        <path className="mt-bolt" d={`M${plotW * 0.52 + 4},${cloudY + 20} l-10,22 h8 l-6,20 l18,-28 h-9 l7,-14 Z`} />
      )}
    </g>
  );
}

/** Low valley fog, drawn over the ridge. */
export function Fog({ plotW, height }: { plotW: number; height: number }) {
  return (
    <g className="mt-fog" aria-hidden="true">
      {[0.62, 0.72, 0.82].map((fy, i) => (
        <rect key={fy} x={plotW * (i % 2 ? 0.05 : -0.05)} y={height * fy} width={plotW * 0.95} height="14" rx="7" />
      ))}
    </g>
  );
}



/** Vertical space one band label (name line + temperature line) needs. */
const BAND_LABEL_GAP = 38;

/**
 * The mountain in cross-section at the planned start: forecast bands by
 * elevation on the right, freezing and snow levels drawn across the slope,
 * and the objective marked on the ridge. Heights are to scale; the ridge
 * shape is illustrative.
 */
export function MountainSection({ bands, objectiveFt, objectiveLabel, target, levels, sky, weather = null, format, when = "at your start" }: {
  bands: ElevationForecastBand[];
  objectiveFt: number | null;
  objectiveLabel: string;
  target: { ft: number; label: string } | null;
  levels: Level[];
  sky: { zenith: string; horizon: string } | null;
  /** The selected hour's forecast, drawn into the sky. */
  weather?: Weather | null;
  format: { elevation: (ft: number) => string; temp: (f: number) => string; wind: (mph: number) => string };
  /** Time phrase for the accessible label, e.g. "at 10:00 AM". */
  when?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(900);
  const id = useId().replace(/:/g, "");
  const sorted = [...bands].filter((b) => Number.isFinite(b.elevationFt)).sort((a, b) => a.elevationFt - b.elevationFt);
  const heights = [...sorted.map((b) => b.elevationFt), ...(objectiveFt !== null ? [objectiveFt] : []), ...(target ? [target.ft] : [])];
  if (heights.length === 0) return null;
  const top = Math.max(...heights);
  const base = Math.min(...heights);
  const levelsInView = levels.filter((l) => Number.isFinite(l.ft) && l.ft > base - 3000 && l.ft < top + 4000);
  const lo = Math.min(base, ...levelsInView.map((l) => l.ft)) - 600;
  const hi = Math.max(top, ...levelsInView.map((l) => l.ft)) + 900;
  const height = Math.max(width < 560 ? 280 : 320, sorted.length * BAND_LABEL_GAP + 40);
  const side = width < 560 ? 132 : 190;
  const plotW = width - side;
  const y = (ft: number) => 16 + (1 - (ft - lo) / (hi - lo)) * (height - 32);
  const { path: ridgePath, x: ridgeX } = ridgeShape({ plotW, height, y, base, top });
  const labelYs = spreadLabels(sorted.map((b) => y(b.elevationFt)), BAND_LABEL_GAP, 20, height - 20);
  const snow = levelsInView.find((l) => l.tone === "snow");
  const phaseLevel = levels.find((l) => l.tone === "snow" && Number.isFinite(l.ft)) ?? levels.find((l) => l.tone === "cold" && Number.isFinite(l.ft));
  const weatherText = weather ? precipText(weather, 32) : "";
  const weatherDescription = weather ? precipText(weather) : "";
  const describe = [
    ...(weatherDescription ? [weatherDescription] : []),
    ...sorted.map((b) => `${b.label} ${format.elevation(b.elevationFt)}: ${format.temp(b.temp)}, gusts ${format.wind(b.windGust)}`),
    ...levelsInView.map((l) => `${l.label} ${format.elevation(l.ft)}`),
  ].join(". ");
  return (
    <div className="sky-mountain" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label={`Conditions by elevation ${when}. ${describe}.`}>
        <defs>
          <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={sky?.zenith || "#6f95bd"} stopOpacity="0.55" />
            <stop offset="1" stopColor={sky?.horizon || "#d5e1ec"} stopOpacity="0.35" />
          </linearGradient>
          <clipPath id={`${id}-ridge`}><path d={ridgePath} /></clipPath>
          <clipPath id={`${id}-plot`}><rect width={plotW} height={height} /></clipPath>
        </defs>
        <rect width={plotW} height={height} fill={`url(#${id}-sky)`} />
        {weather && (
          <g clipPath={`url(#${id}-plot)`}>
            <WeatherSky weather={weather} plotW={plotW} height={height} y={y} phaseFt={phaseLevel?.ft ?? null} />
          </g>
        )}
        <path d={ridgePath} className="mt-ridge" />
        {snow && <rect x="0" y="0" width={plotW} height={y(snow.ft)} clipPath={`url(#${id}-ridge)`} className="mt-snow" />}
        {weather?.kind === "fog" && <g clipPath={`url(#${id}-plot)`}><Fog plotW={plotW} height={height} /></g>}
        {weatherText && <text className="mt-condition" x={plotW - 10} y="20" textAnchor="end">{weatherText}</text>}
        {levelsInView.map((l) => (
          <g key={l.label} className={`mt-level is-${l.tone}`}>
            <line x1="0" x2={plotW} y1={y(l.ft)} y2={y(l.ft)} strokeDasharray="5 4" />
            <text x="10" y={y(l.ft) - 6}>{l.label} {format.elevation(l.ft)}</text>
          </g>
        ))}
        {sorted.map((b, i) => {
          const by = y(b.elevationFt);
          const ly = labelYs[i];
          return (
            <g key={b.label} className="mt-band">
              <polyline points={`${ridgeX(b.elevationFt).toFixed(1)},${by.toFixed(1)} ${plotW},${by.toFixed(1)} ${plotW + 8},${ly.toFixed(1)} ${width},${ly.toFixed(1)}`} />
              <text x={plotW + 12} y={ly - 5} className="mt-band-name">{b.label} · {format.elevation(b.elevationFt)}</text>
              <text x={plotW + 12} y={ly + 14} className={`mt-band-temp${b.temp <= 32 ? " is-cold" : ""}`}>
                {format.temp(b.temp)} · {format.wind(b.windGust)} gust
              </text>
            </g>
          );
        })}
        {target && (
          <g className="mt-target">
            <line x1={ridgeX(target.ft)} x2={plotW} y1={y(target.ft)} y2={y(target.ft)} strokeDasharray="2 3" />
            <circle cx={ridgeX(target.ft)} cy={y(target.ft)} r="5" />
            <text x={Math.min(plotW - 8, ridgeX(target.ft) + 10)} y={y(target.ft) + 16} textAnchor={ridgeX(target.ft) + 180 > plotW ? "end" : "start"}>{target.label}</text>
          </g>
        )}
        {objectiveFt !== null && (
          <g className="mt-objective">
            <circle cx={ridgeX(objectiveFt)} cy={y(objectiveFt)} r="7" />
            <text x={ridgeX(objectiveFt) - 12} y={y(objectiveFt) - 12} textAnchor="end">{objectiveLabel}</text>
          </g>
        )}
      </svg>
    </div>
  );
}
