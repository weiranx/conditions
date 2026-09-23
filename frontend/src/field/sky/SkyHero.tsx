import { useEffect, useId, useState, type ReactNode } from "react";
import { useWidth } from "./useWidth";
import { plainRule } from "./status";
import { Check, CircleHelp, TriangleAlert } from "lucide-react";
import { isOverHour, shortHour, skyRuns, spanLabel, sunProgress, type SkyHour } from "./sky-model";

type Formatters = {
  temp: (f: number) => string;
  wind: (mph: number) => string;
  clock: (minute: number) => string;
  timeStyle: string;
};

const LEVEL_LABEL: Record<string, string> = { GO: "Go", CAUTION: "Caution", "NO-GO": "No-go" };

/** The Brief's signature: the planned day drawn as its forecast sky. */
export function SkyHero({ hours, sunrise, sunset, kicker, title, subtitle, level, headline, reason, bridge, limitingChecks = [], actions, format }: {
  hours: SkyHour[];
  sunrise: number | null;
  sunset: number | null;
  kicker: string;
  title: string;
  subtitle: ReactNode;
  level: "GO" | "CAUTION" | "NO-GO" | string;
  headline: string;
  reason: string;
  bridge?: string;
  limitingChecks?: string[];
  actions?: ReactNode;
  format: Formatters;
}) {
  const [ref, width] = useWidth<HTMLElement>(960);
  const gradientId = useId().replace(/:/g, "");
  const runs = skyRuns(hours);
  const overRuns = runs.filter((run) => run.tone === "over");
  const firstAttention = hours.findIndex((hour) => hour.tone !== "within");
  const [selected, setSelected] = useState(Math.max(0, firstAttention));
  const [sunT, setSunT] = useState<number | null>(null);
  const safeSelected = Math.min(selected, Math.max(0, hours.length - 1));
  const hour = hours[safeSelected];

  // One defining moment: the sun rises and travels to the hour that needs attention.
  useEffect(() => {
    const target = hour ? sunProgress(hour.minute + 30, sunrise, sunset) : null;
    const reduced = typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (target === null || reduced) { setSunT(target); return; }
    let frame = 0;
    const from = 0;
    const began = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - began) / 1400);
      setSunT(from + (target - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // Animate only on first render; later selections move the sun directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function select(index: number) {
    const next = Math.max(0, Math.min(hours.length - 1, index));
    setSelected(next);
    const h = hours[next];
    setSunT(h ? sunProgress(h.minute + 30, sunrise, sunset) : null);
  }

  const compact = width < 700;
  const pad = compact ? 16 : 32;
  const scene = compact ? 170 : 190;
  const ridge = compact ? 104 : 112;
  const count = Math.max(1, hours.length);
  const cw = (width - pad * 2) / count;
  const x = (i: number) => pad + cw * i;
  const hasHours = hours.length > 0;

  // Geometry is measured from the bottom so the text block above can grow freely.
  const [heroHeight, setHeroHeight] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (el) setHeroHeight(el.getBoundingClientRect().height || 640);
  }, [ref, width, headline, reason]);
  const horizon = heroHeight - ridge + 18;
  const peak = heroHeight - ridge - scene + 26;
  const arcX = (t: number) => {
    // Map the sun's day onto the trip's hours when both are known.
    if (!hasHours || sunrise === null || sunset === null) return pad + t * (width - pad * 2);
    const minute = sunrise + t * (sunset - sunrise);
    return x((minute - hours[0].minute) / 60);
  };
  const arcY = (t: number) => horizon - Math.sin(Math.PI * t) * (horizon - peak);
  const arc = sunrise !== null && sunset !== null
    ? Array.from({ length: 41 }, (_, k) => `${arcX(k / 40).toFixed(1)},${arcY(k / 40).toFixed(1)}`).join(" ")
    : "";
  const ridgePath = (() => {
    const seg = 24;
    let d = `M0 ${horizon + 8}`;
    for (let i = 0; i <= seg; i += 1) {
      const px = (width * i) / seg;
      const py = horizon + 6 - Math.abs(Math.sin(i * 1.7) * 16) - (i === 12 ? 22 : i === 11 || i === 13 ? 12 : 0);
      d += ` L${px.toFixed(1)} ${py.toFixed(1)}`;
    }
    return `${d} L${width} ${heroHeight} L0 ${heroHeight}Z`;
  })();
  const stripY = horizon + 26;
  const describe = (h: SkyHour) =>
    `${format.clock(h.minute)}: ${Number.isFinite(h.temp) ? format.temp(h.temp) : "temperature unavailable"}, ` +
    `gust ${Number.isFinite(h.gust) ? format.wind(h.gust) : "unavailable"}, ` +
    `rain chance ${Number.isFinite(h.precipChance) ? `${h.precipChance}%` : "unavailable"}` +
    (isOverHour(h) ? `, over your limits: ${h.failedRules.map(plainRule).join("; ")}` : h.tone === "missing" ? ", readings incomplete" : ", within your limits");
  const callout = overRuns.length === 1
    ? `Outside your limits · ${spanLabel(hours, overRuns[0], format.clock)}`
    : overRuns.length > 1 ? `${overRuns.length} periods outside your limits`
    : runs.some((run) => run.tone === "missing") ? "Some hours have incomplete readings" : "Within your limits all day";
  const calloutX = overRuns.length === 1 ? (x(overRuns[0].start) + x(overRuns[0].end + 1)) / 2 : width / 2;
  const toneWord = LEVEL_LABEL[level] || level;
  const tone = level === "GO" ? "go" : level === "NO-GO" ? "stop" : "watch";

  return (
    <header className="sky-hero" ref={ref} style={{ ["--sky-scene" as string]: `${scene}px`, ["--sky-ridge" as string]: `${ridge}px` }}>
      <svg
        className="sky-canvas"
        viewBox={`0 0 ${width} ${heroHeight}`}
        preserveAspectRatio="none"
        role={hasHours ? "slider" : "img"}
        tabIndex={hasHours ? 0 : undefined}
        aria-label={hasHours ? "Hour of your trip" : "Hourly forecast unavailable"}
        aria-valuemin={hasHours ? 0 : undefined}
        aria-valuemax={hasHours ? hours.length - 1 : undefined}
        aria-valuenow={hasHours ? safeSelected : undefined}
        aria-valuetext={hour ? describe(hour) : undefined}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowUp") { select(safeSelected + 1); event.preventDefault(); }
          if (event.key === "ArrowLeft" || event.key === "ArrowDown") { select(safeSelected - 1); event.preventDefault(); }
          if (event.key === "Home") { select(0); event.preventDefault(); }
          if (event.key === "End") { select(hours.length - 1); event.preventDefault(); }
        }}
        onPointerDown={(event) => {
          if (!hasHours) return;
          (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
          const box = event.currentTarget.getBoundingClientRect();
          select(Math.floor(((event.clientX - box.left) / box.width * width - pad) / cw));
        }}
        onPointerMove={(event) => {
          if (!event.buttons || !hasHours) return;
          const box = event.currentTarget.getBoundingClientRect();
          select(Math.floor(((event.clientX - box.left) / box.width * width - pad) / cw));
        }}
      >
        <defs>
          <linearGradient id={`${gradientId}z`} x1="0" x2="1">
            {(hasHours ? hours : [{ zenith: "#3f6f9f", horizon: "#c9dcee" }]).map((h, i, list) => (
              <stop key={i} offset={list.length === 1 ? 0 : (x(i + 0.5) / width).toFixed(4)} stopColor={h.zenith} />
            ))}
          </linearGradient>
          <linearGradient id={`${gradientId}h`} x1="0" x2="1">
            {(hasHours ? hours : [{ zenith: "#3f6f9f", horizon: "#c9dcee" }]).map((h, i, list) => (
              <stop key={i} offset={list.length === 1 ? 0 : (x(i + 0.5) / width).toFixed(4)} stopColor={h.horizon} />
            ))}
          </linearGradient>
          <linearGradient id={`${gradientId}f`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".35" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#fff" stopOpacity="1" />
          </linearGradient>
          <mask id={`${gradientId}m`}><rect width={width} height={heroHeight} fill={`url(#${gradientId}f)`} /></mask>
          {/* Scrim keeps white text at 5:1 or better over the brightest sky. */}
          <linearGradient id={`${gradientId}s`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#061423" stopOpacity=".5" /><stop offset=".5" stopColor="#061423" stopOpacity=".4" /><stop offset=".72" stopColor="#061423" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${gradientId}g`}><stop offset="0" stopColor="#fff6d8" stopOpacity=".9" /><stop offset="1" stopColor="#fff6d8" stopOpacity="0" /></radialGradient>
          <filter id={`${gradientId}b`}><feGaussianBlur stdDeviation="2.2" /></filter>
          <pattern id={`${gradientId}p`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <rect width="6" height="6" fill="rgba(255,154,77,.25)" /><line x1="0" y1="0" x2="0" y2="6" stroke="#FF9A4D" strokeWidth="1.6" />
          </pattern>
        </defs>
        <rect width={width} height={heroHeight} fill={`url(#${gradientId}z)`} />
        <rect width={width} height={heroHeight} fill={`url(#${gradientId}h)`} mask={`url(#${gradientId}m)`} />
        <rect width={width} height={heroHeight} fill={`url(#${gradientId}s)`} />
        {arc && <polyline points={arc} fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="1.5" strokeDasharray="2 6" strokeLinecap="round" />}
        {sunT !== null && (
          <g className="sky-sun">
            <circle cx={arcX(sunT)} cy={arcY(sunT)} r="46" fill={`url(#${gradientId}g)`} />
            <circle cx={arcX(sunT)} cy={arcY(sunT)} r="15" fill="#fff4cf" />
          </g>
        )}
        {hours.map((h, i) => {
          const wet = h.precipChance >= 20 || h.kind === "rain" || h.kind === "storm" || h.kind === "snow";
          const cloudy = wet || h.kind === "cloudy" || h.kind === "fog";
          if (!cloudy || !Number.isFinite(cw)) return null;
          const cx = x(i + 0.5);
          const cy = peak + 18 + (i % 2) * 10;
          const k = Math.min(1.25, 0.55 + (Number.isFinite(h.precipChance) ? h.precipChance : 40) / 100);
          const storm = h.precipChance >= 60 || h.kind === "storm";
          const fill = storm ? "#aab3bb" : "#eef2f5";
          const drops = wet ? Math.max(2, Math.round(((Number.isFinite(h.precipChance) ? h.precipChance : 40) / 100) * cw / 9)) : 0;
          return (
            <g key={i} aria-hidden="true">
              {Array.from({ length: drops }, (_, j) => {
                const rx = cx - cw * 0.35 + (j / Math.max(1, drops - 1)) * cw * 0.7;
                return <line key={j} className="sky-rain" x1={rx} y1={cy + 18} x2={rx - 10} y2={horizon - 6}
                  stroke={h.kind === "snow" ? "#ffffff" : "#d6e6f5"} strokeOpacity={0.25 + (h.precipChance || 40) / 200}
                  strokeWidth={h.kind === "snow" ? 2.2 : 1.4} strokeDasharray={h.kind === "snow" ? "2 10" : "7 9"} strokeDashoffset={j * 5} />;
              })}
              <g className="sky-cloud" filter={`url(#${gradientId}b)`} opacity={storm ? 0.95 : 0.8}>
                <ellipse cx={cx - cw * 0.28 * k} cy={cy + 6} rx={cw * 0.36 * k} ry={15 * k} fill={fill} />
                <ellipse cx={cx + cw * 0.05} cy={cy - 6 * k} rx={cw * 0.42 * k} ry={22 * k} fill={fill} />
                <ellipse cx={cx + cw * 0.34 * k} cy={cy + 7} rx={cw * 0.32 * k} ry={13 * k} fill={fill} />
              </g>
            </g>
          );
        })}
        <path d={ridgePath} fill="#17221d" />
        {hasHours ? (
          <g className="sky-ridge-labels">
            {hours.map((h, i) => {
              const over = isOverHour(h);
              const cold = Number.isFinite(h.temp) && h.temp < 32;
              const showTick = !compact || cw >= 26 || i % 2 === 0;
              return (
                <g key={i}>
                  <rect x={x(i) + 1.5} y={stripY} width={Math.max(1, cw - 3)} height="8" rx="4"
                    fill={over ? `url(#${gradientId}p)` : h.tone === "missing" ? "none" : "rgba(255,255,255,.22)"}
                    stroke={over ? "#FF9A4D" : h.tone === "missing" ? "rgba(255,255,255,.6)" : "none"}
                    strokeWidth="1.2" strokeDasharray={h.tone === "missing" && !over ? "3 3" : undefined} />
                  {showTick && <text x={x(i + 0.5)} y={stripY + 32} textAnchor="middle" className="sky-temp" fill={cold ? "#9fd0ff" : "#fff"}>
                    {Number.isFinite(h.temp) ? `${Math.round(h.temp)}°` : "—"}
                  </text>}
                  {showTick && <text x={x(i + 0.5)} y={stripY + 52} textAnchor="middle" className="sky-hour" fill={over ? "#FF9A4D" : "rgba(255,255,255,.72)"} fontWeight={over ? 700 : 500}>
                    {shortHour(h.minute, format.timeStyle)}
                  </text>}
                </g>
              );
            })}
            <text x={Math.max(80, Math.min(width - 80, calloutX))} y={stripY - 8} textAnchor="middle" className="sky-callout"
              fill={overRuns.length ? "#FF9A4D" : "rgba(255,255,255,.85)"}>
              {overRuns.length ? "▲ " : ""}{callout}
            </text>
            <rect x={x(safeSelected) + 2} y={stripY - 8} width={Math.max(4, cw - 4)} height="68" rx="10" fill="none" stroke="#fff" strokeWidth="2" />
          </g>
        ) : (
          <text x={width / 2} y={stripY + 30} textAnchor="middle" className="sky-callout" fill="rgba(255,255,255,.85)">Hourly forecast unavailable</text>
        )}
      </svg>
      <div className="sky-hero-in">
        {actions && <div className="sky-hero-actions">{actions}</div>}
        <div className="sky-hero-grid">
        <div className="sky-hero-text">
        <span className="sky-kicker">{kicker}</span>
        <h1>{title}</h1>
        <p className="sky-subtitle">{subtitle}</p>
        <span className={`sky-pill is-${tone}`}>
          {tone === "go" ? <Check size={17} aria-hidden="true" /> : <TriangleAlert size={17} aria-hidden="true" />}
          <span><span className="sr-only">Trip decision: </span>{toneWord}</span>
        </span>
        <h2 id="field-verdict-title">{headline}</h2>
        <p className="sky-lede">{reason}</p>
        {bridge && <p className="sky-lede sky-bridge">{bridge}</p>}
        {limitingChecks.length > 0 && (
          <ul className="sky-limiting" aria-label="Checks setting the decision">
            {limitingChecks.map((check) => <li key={check}>{check}</li>)}
          </ul>
        )}
        </div>
        {hour && (
          <div className="sky-readout" aria-live="polite">
            <div>
              <div className="sky-readout-time">{format.clock(hour.minute)}</div>
              <div className="sky-readout-big">{Number.isFinite(hour.temp) ? format.temp(hour.temp) : "—"}</div>
            </div>
            <dl>
              <dt>Gust</dt><dd className={hour.failedRules.some((r) => /gust|wind/i.test(r)) ? "is-over" : undefined}>{Number.isFinite(hour.gust) ? format.wind(hour.gust) : "—"}</dd>
              <dt>Rain chance</dt><dd className={hour.failedRules.some((r) => /precip|rain/i.test(r)) ? "is-over" : undefined}>{Number.isFinite(hour.precipChance) ? `${hour.precipChance}%` : "—"}</dd>
            </dl>
            <p className={`sky-readout-flag is-${isOverHour(hour) ? "over" : hour.tone}`}>
              {isOverHour(hour) ? <TriangleAlert size={15} aria-hidden="true" /> : hour.tone === "missing" ? <CircleHelp size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
              {isOverHour(hour) ? hour.failedRules.map(plainRule).join(" · ") : hour.tone === "missing" ? "Readings incomplete for this hour" : "Within your limits"}
            </p>
          </div>
        )}
        </div>
      </div>
      {hasHours && <span className="sky-hint" aria-hidden="true">Drag across the sky to check any hour</span>}
    </header>
  );
}
