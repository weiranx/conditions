import { BookOpen, Check, ChevronRight, CircleHelp, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { Workspace } from "../model/useWorkspace";
import { freshnessClass } from "../../app/core";
import { durationLabel, plainRule, surfaceLabel, terrainStatus, type CheckStatus } from "./status";
import { isOverHour, spanLabel, skyRuns, type SkyHour } from "./sky-model";
import { avalancheBriefCaption } from "../../app/avalanche-display";
import { describeCheckpointBreach, type PlannedRouteSummary } from "../route-planning";
import { RouteStrip } from "./RouteStrip";
import { activityProfile, orderActivityChecks, type ActivityCheck, type ActivityNumber } from "../../app/activity-profiles";
import type { ActivityType } from "../../app/types";
import { REPORT_CHAPTERS, chapterLabel, type ReportChapter } from "./report-chapters";

export type BriefChapter = ReportChapter;
type Status = CheckStatus;

const measured = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function StatusTag({ status, children }: { status: Status; children: ReactNode }) {
  const Icon = status === "over" ? TriangleAlert : status === "missing" ? CircleHelp : Check;
  return <span className={`sky-status is-${status}`}><Icon size={15} aria-hidden="true" />{children}</span>;
}

/** A brief card that opens a report section, and says which one. */
function SectionCard({ to, onOpen, className, children }: {
  to: BriefChapter; onOpen: (chapter: BriefChapter) => void; className: string; children: ReactNode;
}) {
  return (
    <button type="button" className={`sky-card ${className}`} onClick={() => onOpen(to)}>
      {children}
      <span className="sky-open">Open {chapterLabel(to)}<ChevronRight size={16} aria-hidden="true" /></span>
    </button>
  );
}

function CheckCard({ title, status, statusText, caption, children, to, onOpen, className = "" }: {
  title: string; status: Status; statusText: string; caption: string; children?: ReactNode;
  to: BriefChapter; onOpen: (chapter: BriefChapter) => void; className?: string;
}) {
  return (
    <SectionCard to={to} onOpen={onOpen} className={`sky-check${status === "missing" ? " is-missing" : ""}${className ? ` ${className}` : ""}`}>
      <span className="sky-card-head"><span>{title}</span><StatusTag status={status}>{statusText}</StatusTag></span>
      {children}
      <span className="sky-cap">{caption}</span>
    </SectionCard>
  );
}

/** Where a value sits against a single limit: the out-of-limit side is shaded. */
function LimitScale({ value, limit, side, lo, hi, limitLabel, note, label }: {
  value: number; limit: number; side: "above" | "below"; lo: number; hi: number; limitLabel: string; note: string; label: string;
}) {
  const x = (v: number) => Math.max(0, Math.min(240, ((v - lo) / (hi - lo)) * 240));
  const over = side === "above" ? value > limit : value < limit;
  return (
    <svg className="sky-viz" viewBox="0 0 240 54" role="img" aria-label={label}>
      <rect x="0" y="18" width="240" height="12" rx="6" className="f-fill" />
      <rect x={side === "above" ? x(limit) : 0} y="18" width={side === "above" ? 240 - x(limit) : x(limit)} height="12"
        className="f-caution" opacity=".22" />
      <line x1={x(limit)} y1="10" x2={x(limit)} y2="38" className="s-label" strokeWidth="2" />
      <text x={Math.max(24, Math.min(216, x(limit)))} y="8" textAnchor="middle" className="t-label">{limitLabel}</text>
      <circle cx={x(value)} cy="24" r="7" className={over ? "f-caution" : "f-secondary"} />
      <text x="240" y="50" textAnchor="end" className={over ? "t-caution" : undefined}>{note}</text>
    </svg>
  );
}

const REFREEZE = {
  strong: { big: "Strong", status: "ok" as Status, text: "Firm", caption: "A solid freeze; expect firm snow after dawn." },
  fair: { big: "Marginal", status: "ok" as Status, text: "Shallow", caption: "A shallow freeze gives a shorter firm window after sunrise." },
  weak: { big: "Weak", status: "over" as Status, text: "Weak freeze", caption: "Without a solid freeze, snow softens early." },
  unknown: { big: "—", status: "missing" as Status, text: "Unavailable", caption: "The night before the start is incomplete, so the refreeze can't be judged." },
};

const UNCHECKED_ROUTE: Record<Extract<PlannedRouteSummary, { state: "unchecked" }>["reason"], string> = {
  failed: "Route analysis didn't finish. Open Route to try again.",
  saved: "No route analysis was saved with this report.",
  unavailable: "Route analysis is unavailable on this server right now.",
  "sign-in": "Sign in to check conditions at timed checkpoints along the route.",
  "not-run": "Open Route to check conditions at timed checkpoints along the route.",
};

/** Status, status text and caption for the planned route's check card. */
function routeCheck(route: PlannedRouteSummary, format: { temp: (f: number) => string; wind: (mph: number) => string; eta: (time: string) => string }) {
  if (route.state === "checking") return {
    status: "missing" as Status, statusText: "Checking…",
    caption: `Checking ${route.checkpointCount ? `${route.checkpointCount} checkpoints` : "timed checkpoints"} along the route. This can take a minute.`,
  };
  if (route.state === "unchecked") return { status: "missing" as Status, statusText: "Not checked", caption: UNCHECKED_ROUTE[route.reason] };
  const { stops, overCount, missingCount, firstOver, finish } = route;
  const back = finish
    ? ` ${finish.returnToStart ? "Back at the start" : "Finish"} around ${format.eta(finish.eta)}${finish.dark ? ", after dark" : ""}.`
    : "";
  if (!stops.length) return { status: "missing" as Status, statusText: "No forecasts", caption: "No checkpoint forecasts were returned for this route." };
  if (firstOver) return {
    status: "over" as Status,
    statusText: `${overCount} of ${stops.length} over`,
    caption: `${firstOver.name}${firstOver.eta ? ` at ${format.eta(firstOver.eta)}` : ""}: ${describeCheckpointBreach(firstOver.breach, format)}.${back}`,
  };
  if (missingCount) return {
    status: "missing" as Status,
    statusText: `${missingCount} incomplete`,
    caption: `${missingCount} checkpoint ${missingCount === 1 ? "forecast is" : "forecasts are"} missing or incomplete, so ${missingCount === 1 ? "it" : "they"} can't be checked against every limit.${back}`,
  };
  return { status: "ok" as Status, statusText: "Within limits", caption: `All ${stops.length} checkpoint forecasts are within your limits.${back}` };
}

export function BriefSections({ w, hours, clock, scoreValue, insufficient, bridge, onOpen, onReadAll, sections = [], route = null, gearEnabled, activity, showMore = true }: {
  w: Workspace;
  hours: SkyHour[];
  clock: (minute: number) => string;
  scoreValue: number | null;
  insufficient: boolean;
  bridge: string;
  onOpen: (chapter: BriefChapter) => void;
  onReadAll: () => void;
  /** The report sections list; the full report already contains every section. */
  showMore?: boolean;
  /** The report's sections in reading order, as the chapter tabs show them. */
  sections?: BriefChapter[];
  /** The route chosen in the plan; the checks then lead with it. */
  route?: PlannedRouteSummary | null;
  gearEnabled: boolean;
  /** The report's activity; it sets the order of the checks. */
  activity: ActivityType;
}) {
  const data = w.safetyData!;
  const prefs = w.preferences;
  const gustLimit = prefs.maxWindGustMph;
  const precipLimit = prefs.maxPrecipChance;
  const gusts = hours.filter((h) => measured(h.gust));
  const peak = gusts.reduce<SkyHour | null>((a, h) => (!a || h.gust > a.gust ? h : a), null);
  const gustMax = Math.max(gustLimit * 1.6, (peak?.gust ?? 0) * 1.15, 10);
  const overRuns = skyRuns(hours).filter((run) => run.tone === "over");
  const overCount = hours.filter(isOverHour).length;
  const missingCount = hours.filter((h) => h.tone === "missing" && !isOverHour(h)).length;
  const firstOver = hours.find(isOverHour);

  // Precipitation totals over the planned window, when the source supplied them.
  const rainIn = data.rainfall?.expected?.rainWindowIn;
  const snowIn = data.rainfall?.expected?.snowWindowIn;

  // Daylight: sunrise, sunset, start and return in minutes after midnight.
  const sunrise = w.sunriseMinutesForPlan;
  const sunset = w.sunsetMinutesForPlan;
  const start = w.startMinutesForPlan;
  const back = w.returnMinutes;
  const daylightKnown = sunrise !== null && sunset !== null && start !== null && back !== null && sunset > sunrise;
  const spare = daylightKnown ? sunset - back : null;
  const daylightStatus: Status = !daylightKnown ? "missing" : spare! < 0 ? "over" : "ok";

  // Alerts: an active alert needs attention; an unavailable feed cannot confirm clear conditions.
  // Use the same freshness rule as Checks & sources, so the two never disagree.
  const alertRow = (w.sourceFreshnessRows || []).find((row) => row.label === "Alerts");
  const alertState = alertRow ? alertRow.stateOverride || freshnessClass(alertRow.issued, alertRow.staleHours) : "missing";
  const alertsMissing = !data.alerts || alertState === "missing" || alertState === "stale";
  const alertCount = w.nwsAlertCount || 0;

  const aqi = data.airQuality?.usAqi;
  const aqiCategory = data.airQuality?.category;
  const avalancheLevel = w.overallAvalancheLevel as number | null;
  const bands = [...(w.elevationForecastBands || [])].filter((b) => measured(b.elevationFt) && measured(b.temp))
    .sort((a, b) => a.elevationFt - b.elevationFt);
  const surface = surfaceLabel(data);
  const terrain = terrainStatus(data);
  const fireHigh = Number(w.fireRiskLevel) >= 3;
  // What sets an elevated fire level, in a few words; the full reason is in Weather.
  const fireDriver = data.fireRisk?.primaryDriver;
  const fireCause = Number(w.fireRiskLevel) >= 2 && fireDriver
    ? ({ fire: "fire nearby", weather: "fire weather", smoke: "smoke" } as const)[fireDriver]
    : "";
  const eta = (time: string) => w.formatClockForStyle(time, prefs.timeStyle);
  const routeFormat = { temp: (f: number) => w.formatTempDisplay(f), wind: (mph: number) => w.formatWindDisplay(mph), eta };
  const routeFacts = route?.state === "checked"
    ? [
      route.distanceMiles !== null ? w.formatDistanceDisplay(route.distanceMiles) : null,
      route.gainFt !== null ? `${w.formatElevationDeltaDisplay(route.gainFt)} gain` : null,
      route.stops.length ? `${route.stops.length} ${route.stops.length === 1 ? "checkpoint" : "checkpoints"}` : null,
    ].filter(Boolean).join(" · ")
    : "";
  const gear = (w.gearRecommendations || []).filter(Boolean).slice(0, 4);
  const gearTotal = (w.gearRecommendations || []).filter(Boolean).length;

  const arcPoint = (minute: number) => {
    const t = (minute - sunrise!) / (sunset! - sunrise!);
    const px = 10 + Math.max(0, Math.min(1, t)) * 220;
    const py = 58 - Math.sin(Math.PI * Math.max(0, Math.min(1, t))) * 50;
    return [px, py] as const;
  };

  // Every check is shown; the activity sets the order and a failing check leads.
  const checks: { key: ActivityCheck; over: boolean; card: ReactNode }[] = [
    { key: "weather", over: overCount > 0, card: (
      <CheckCard key="weather" title="Weather" to="forecast" onOpen={onOpen}
        status={overCount ? "over" : missingCount ? "missing" : "ok"}
        statusText={overRuns.length === 1 ? `Over ${spanLabel(hours, overRuns[0], clock)}` : overCount ? `${overCount} hours over` : missingCount ? `${missingCount} ${missingCount === 1 ? "hour" : "hours"} incomplete` : "Within limits"}
        caption={firstOver ? (firstOver.failedRules[0] ? plainRule(firstOver.failedRules[0]) : "A planned hour crosses your limits.")
          : missingCount ? `${missingCount} planned ${missingCount === 1 ? "hour has" : "hours have"} incomplete readings, so ${missingCount === 1 ? "it" : "they"} can't be confirmed within your limits.`
          : hours.length ? "Every planned hour is within your limits." : "Hourly forecast unavailable."}>
        {hours.length > 0 && (
          <svg className="sky-viz" viewBox="0 0 240 64" role="img"
            aria-label={`Rain chance by hour against your ${precipLimit}% limit: ${hours.map((h) => `${clock(h.minute)} ${measured(h.precipChance) ? `${h.precipChance}%` : "unavailable"}`).join(", ")}.`}>
            {hours.map((h, i) => {
              const bw = 240 / hours.length;
              const v = measured(h.precipChance) ? h.precipChance : 0;
              const bh = Math.max(3, (v / 100) * 44);
              return <rect key={i} x={i * bw + 2} y={48 - bh} width={Math.max(1, bw - 4)} height={bh} rx="3"
                className={isOverHour(h) ? "f-caution" : h.tone === "missing" ? "f-none s-missing" : "f-okfill"} strokeDasharray={h.tone === "missing" ? "2 2" : undefined} />;
            })}
            <line x1="0" x2="240" y1={48 - (precipLimit / 100) * 44} y2={48 - (precipLimit / 100) * 44} className="s-secondary" strokeDasharray="3 3" />
            <text x="0" y={Math.max(9, 48 - (precipLimit / 100) * 44 - 5)} textAnchor="start" className="t-limit">rain limit {precipLimit}%</text>
            <text x="0" y="62">{clock(hours[0].minute)}</text>
            <text x="240" y="62" textAnchor="end">{clock(hours[hours.length - 1].minute + 60)}</text>
          </svg>
        )}
      </CheckCard>
    ) },
    { key: "alerts", over: alertCount > 0, card: (
      <CheckCard key="alerts" title="Alerts" to="sources" onOpen={onOpen}
        status={alertCount > 0 ? "over" : alertsMissing ? "missing" : "ok"}
        statusText={alertCount > 0 ? `${alertCount} active` : alertsMissing ? (data.alerts ? "Not confirmed" : "Not loaded") : "None active"}
        caption={alertCount > 0 ? (w.nwsTopAlerts?.[0]?.event || "Review the active alert before you go.")
          : alertsMissing ? (data.alerts ? "The alert feed didn't confirm your planned time. Check official alerts before you go." : "The alert feed didn't respond. This brief may be missing an active warning.") : "No active NWS alerts for your planned time."}>
        {alertsMissing && alertCount === 0 && <span className="sky-empty">{data.alerts ? "Not confirmed for your time" : "No response from NWS"}</span>}
      </CheckCard>
    ) },
    { key: "daylight", over: daylightStatus === "over", card: (
      <CheckCard key="daylight" title="Daylight" to="timing" onOpen={onOpen} status={daylightStatus}
        statusText={!daylightKnown ? "Unavailable" : spare! < 0 ? `Back ${durationLabel(spare!)} after sunset` : start! < sunrise! ? `Starts before sunrise · ${durationLabel(spare!)} spare` : `${durationLabel(spare!)} spare`}
        caption={daylightKnown ? `Back at ${w.formatClockForStyle(w.returnTimeDisplay, prefs.timeStyle)}, sunset ${w.formatClockForStyle(data.solar?.sunset, prefs.timeStyle)}.` : "Sunrise and sunset are unavailable for this plan."}>
        {daylightKnown && (
          <svg className="sky-viz" viewBox="0 0 240 70" role="img"
            aria-label={`Sunrise ${w.formatClockForStyle(data.solar?.sunrise, prefs.timeStyle)}, sunset ${w.formatClockForStyle(data.solar?.sunset, prefs.timeStyle)}. Out ${w.displayStartTime}, back ${w.formatClockForStyle(w.returnTimeDisplay, prefs.timeStyle)}.`}>
            <line x1="6" y1="58" x2="234" y2="58" className="s-secondary" strokeOpacity=".35" />
            <path d="M10 58 Q120 -42 230 58" fill="none" className="s-secondary" strokeOpacity=".35" strokeDasharray="2 5" strokeLinecap="round" />
            <polyline fill="none" className={daylightStatus === "over" ? "s-caution" : "s-accent"} strokeWidth="4" strokeLinecap="round"
              points={Array.from({ length: 21 }, (_, k) => arcPoint(start! + ((back! - start!) * k) / 20).join(",")).join(" ")} />
            <circle cx={arcPoint(back!)[0]} cy={arcPoint(back!)[1]} r="5" className={daylightStatus === "over" ? "f-caution" : "f-accent"} />
            <circle cx="230" cy="58" r="7" fill="#f4b25c" />
            <text x="10" y="70">{w.formatClockForStyle(data.solar?.sunrise, prefs.timeStyle)}</text>
            <text x="236" y="70" textAnchor="end">{w.formatClockForStyle(data.solar?.sunset, prefs.timeStyle)}</text>
          </svg>
        )}
      </CheckCard>
    ) },
    { key: "terrain", over: terrain === "over", card: (
      <CheckCard key="terrain" title="Terrain & snow" to="terrain" onOpen={onOpen} status={terrain}
        statusText={surface || "Unavailable"}
        caption={bands.length > 1 ? "Temperature by elevation at your start." : w.snowpackBestDepthDisplay ? `Best snow depth estimate: ${w.snowpackBestDepthDisplay}.` : "Surface and snow assessment."}>
        {bands.length > 1 && (
          <ol className="sky-ladder" aria-label="Temperature by elevation at your planned time">
            {[...bands].reverse().slice(0, 3).map((b) => (
              <li key={b.label} className={b.temp <= 32 ? "is-cold" : undefined}>
                <span>{b.label}<small>{w.formatElevationDisplay(b.elevationFt)}</small></span>
                <strong>{w.formatTempDisplay(b.temp)}</strong>
              </li>
            ))}
          </ol>
        )}
      </CheckCard>
    ) },
    { key: "avalanche", over: avalancheLevel !== null && avalancheLevel >= 3, card: (
      <CheckCard key="avalanche" title="Avalanche" to="terrain" onOpen={onOpen}
        status={w.avalancheRelevant && avalancheLevel === null ? "missing" : avalancheLevel !== null && avalancheLevel >= 3 ? "over" : "ok"}
        statusText={avalancheLevel !== null && avalancheLevel > 0 ? ["", "Low", "Moderate", "Considerable", "High", "Extreme"][avalancheLevel] || `Level ${avalancheLevel}` : w.avalancheRelevant ? "No rating" : "Not relevant"}
        caption={avalancheBriefCaption(data.avalanche, w.avalancheDisplay)}>
        <svg className="sky-viz" viewBox="0 0 240 40" role="img" aria-label={avalancheLevel ? `Avalanche danger ${avalancheLevel} of 5.` : "No avalanche danger rating."}>
          {["Low", "Mod", "Consid", "High", "Extreme"].map((label, i) => (
            <g key={label}>
              <rect x={i * 49} y="4" width="44" height="16" rx="5" className={avalancheLevel === i + 1 ? (i >= 2 ? "f-caution" : "f-label") : "f-fill"} />
              <text x={i * 49 + 22} y="36" textAnchor="middle">{label}</text>
            </g>
          ))}
        </svg>
      </CheckCard>
    ) },
    { key: "air", over: fireHigh || (measured(aqi) && aqi > 100), card: (
      <CheckCard key="air" title="Air & fire" to="forecast" onOpen={onOpen}
        status={fireHigh || (measured(aqi) && aqi > 100) ? "over" : !measured(aqi) ? "missing" : "ok"}
        statusText={fireHigh && !(measured(aqi) && aqi > 100) ? `Fire risk ${String(w.fireRiskLabel || "high").toLowerCase()}` : measured(aqi) ? `AQI ${aqi}` : "AQI unavailable"}
        caption={`${aqiCategory || "Air quality unavailable"} · fire risk ${String(w.fireRiskLabel || "unavailable").toLowerCase()}${fireCause ? ` (${fireCause})` : ""}.`}>
        {measured(aqi) && (
          <svg className="sky-viz" viewBox="0 0 240 70" role="img" aria-label={`Air quality index ${aqi}, ${aqiCategory || "category unavailable"}.`}>
            <path d="M64 64 A56 56 0 0 1 176 64" fill="none" className="s-okfill" strokeWidth="10" strokeLinecap="round" />
            {(() => { const t = Math.min(1, aqi / 300), a = Math.PI * (1 - t); return (
              <path d={`M64 64 A56 56 0 0 1 ${120 + 56 * Math.cos(a)} ${64 - 56 * Math.sin(a)}`} fill="none" className={aqi > 100 ? "s-caution" : "s-accent"} strokeWidth="10" strokeLinecap="round" />); })()}
            <text x="120" y="60" textAnchor="middle" className="t-ring">{aqi}</text>
          </svg>
        )}
      </CheckCard>
    ) },
  ];
  const profile = activityProfile(activity);
  const leads = profile.report.leads;

  // Feels-like extremes over the planned hours, for the cold and heat numbers.
  const thermal = hours.filter((h) => h.thermalComplete && measured(h.feelsLike));
  const coldest = thermal.reduce<SkyHour | null>((a, h) => (!a || h.feelsLike < a.feelsLike ? h : a), null);
  const warmest = thermal.reduce<SkyHour | null>((a, h) => (!a || h.feelsLike > a.feelsLike ? h : a), null);
  const floor = prefs.minFeelsLikeF;
  const ceiling = prefs.maxFeelsLikeF;
  // The night before the start sets the snow surface (backend surface-evidence.js).
  const signals = data.terrainCondition?.signals;
  const refreeze = REFREEZE[signals?.refreezeQuality ?? "unknown"] ?? REFREEZE.unknown;
  const nightLow = signals?.freezeThawMinTempF;
  const freezingLevel = data.atmosphere?.freezingLevelFt;
  const objectiveFt = Number(data.weather?.elevation);
  const freezingAbove = measured(freezingLevel) && Number.isFinite(objectiveFt) && freezingLevel > objectiveFt;
  const snowFirst = activity === "ski-touring" || activity === "snow-climbing";

  const numberCards: Record<ActivityNumber, ReactNode> = {
    gust: (
      <SectionCard key="gust" to="forecast" onOpen={onOpen} className="sky-number">
        <span className="sky-card-head"><span>Peak gust</span>
          {peak ? <StatusTag status={peak.gust > gustLimit ? "over" : "ok"}>{peak.gust > gustLimit ? "Over" : "Within"}</StatusTag> : <StatusTag status="missing">Unavailable</StatusTag>}
        </span>
        <span className={`sky-big${peak && peak.gust > gustLimit ? " is-over" : ""}`}>{peak ? w.formatWindDisplay(peak.gust) : "—"}</span>
        {peak && (
          <svg className="sky-viz" viewBox="0 0 240 54" role="img"
            aria-label={`Peak gust ${w.formatWindDisplay(peak.gust)} at ${clock(peak.minute)}; your limit is ${w.formatWindDisplay(gustLimit)}.`}>
            <rect x="0" y="18" width="240" height="12" rx="6" className="f-fill" />
            <rect x="0" y="18" width={Math.min(240, (Math.min(peak.gust, gustLimit) / gustMax) * 240)} height="12" rx="6" className="f-secondary" opacity=".45" />
            {peak.gust > gustLimit && <rect x={(gustLimit / gustMax) * 240} y="18" width={((peak.gust - gustLimit) / gustMax) * 240} height="12" className="f-caution" />}
            <line x1={(gustLimit / gustMax) * 240} y1="10" x2={(gustLimit / gustMax) * 240} y2="38" className="s-label" strokeWidth="2" />
            <text x={(gustLimit / gustMax) * 240} y="8" textAnchor="middle" className="t-label">your limit</text>
            <text x="240" y="50" textAnchor="end" className={peak.gust > gustLimit ? "t-caution" : undefined}>at {clock(peak.minute)}</text>
          </svg>
        )}
      </SectionCard>
    ),
    precip: (
      <SectionCard key="precip" to="forecast" onOpen={onOpen} className="sky-number">
        <span className="sky-card-head"><span>{snowFirst ? "Snow and rain" : "Rain and snow"}</span><span className="sky-muted">{w.expectedTravelWindowHours}-hour totals</span></span>
        <span className="sky-gauges">
          {(snowFirst ? ["snow", "rain"] as const : ["rain", "snow"] as const).map((label) => {
            const g = label === "rain"
              ? { value: rainIn, scale: 0.5, display: w.expectedRainWindowDisplay }
              : { value: snowIn, scale: 4, display: w.expectedSnowWindowDisplay };
            return (
              <span key={label} className="sky-gauge">
                <svg viewBox="0 0 26 72" className="sky-viz" role="img"
                  aria-label={measured(g.value) ? `Expected ${label} ${g.display}` : `Expected ${label} unavailable`}>
                  <rect x="1" y="1" width="24" height="70" rx="8" className={measured(g.value) ? "f-fill" : "f-none s-missing"} strokeDasharray={measured(g.value) ? undefined : "3 3"} />
                  {measured(g.value) && g.value > 0 && (
                    <rect x="1" y={71 - Math.max(8, Math.min(1, g.value / g.scale) * 70)} width="24" height={Math.max(8, Math.min(1, g.value / g.scale) * 70)} rx="6"
                      className={label === "rain" ? "f-cold" : "f-cold-fill s-cold"} strokeWidth="1.5" />
                  )}
                </svg>
                <span><span className="sky-big is-small">{measured(g.value) ? g.display : "—"}</span><span className="sky-cap">{label}</span></span>
              </span>
            );
          })}
        </span>
      </SectionCard>
    ),
    cold: (
      <SectionCard key="cold" to="forecast" onOpen={onOpen} className="sky-number">
        <span className="sky-card-head"><span>Coldest feels-like</span>
          {coldest ? <StatusTag status={coldest.feelsLike < floor ? "over" : "ok"}>{coldest.feelsLike < floor ? "Below floor" : "Within"}</StatusTag> : <StatusTag status="missing">Unavailable</StatusTag>}
        </span>
        <span className={`sky-big${coldest && coldest.feelsLike < floor ? " is-over" : ""}`}>{coldest ? w.formatTempDisplay(coldest.feelsLike) : "—"}</span>
        {coldest && (
          <LimitScale value={coldest.feelsLike} limit={floor} side="below"
            lo={Math.min(floor - 25, coldest.feelsLike - 5)} hi={Math.max(floor + 45, coldest.feelsLike + 5)}
            limitLabel="your floor" note={`at ${clock(coldest.minute)}`}
            label={`Coldest feels-like ${w.formatTempDisplay(coldest.feelsLike)} at ${clock(coldest.minute)}; your floor is ${w.formatTempDisplay(floor)}.`} />
        )}
      </SectionCard>
    ),
    heat: (
      <SectionCard key="heat" to="forecast" onOpen={onOpen} className="sky-number">
        <span className="sky-card-head"><span>Warmest feels-like</span>
          {warmest ? <StatusTag status={warmest.feelsLike > ceiling ? "over" : "ok"}>{warmest.feelsLike > ceiling ? "Over" : "Within"}</StatusTag> : <StatusTag status="missing">Unavailable</StatusTag>}
        </span>
        <span className={`sky-big${warmest && warmest.feelsLike > ceiling ? " is-over" : ""}`}>{warmest ? w.formatTempDisplay(warmest.feelsLike) : "—"}</span>
        {warmest && (
          <LimitScale value={warmest.feelsLike} limit={ceiling} side="above"
            lo={Math.min(ceiling - 45, warmest.feelsLike - 5)} hi={Math.max(ceiling + 20, warmest.feelsLike + 5)}
            limitLabel="your limit" note={`at ${clock(warmest.minute)}`}
            label={`Warmest feels-like ${w.formatTempDisplay(warmest.feelsLike)} at ${clock(warmest.minute)}; your limit is ${w.formatTempDisplay(ceiling)}.`} />
        )}
        {w.heatRiskLabel && <span className="sky-cap">Heat risk {String(w.heatRiskLabel).toLowerCase()}.</span>}
      </SectionCard>
    ),
    refreeze: (
      <SectionCard key="refreeze" to="terrain" onOpen={onOpen} className="sky-number">
        <span className="sky-card-head"><span>Overnight refreeze</span><StatusTag status={refreeze.status}>{refreeze.text}</StatusTag></span>
        <span className={`sky-big${refreeze.status === "over" ? " is-over" : ""}`}>{refreeze.big}</span>
        <svg className="sky-viz" viewBox="0 0 240 40" role="img" aria-label={`Overnight refreeze: ${refreeze.big === "—" ? "unavailable" : refreeze.big.toLowerCase()}.`}>
          {(["weak", "fair", "strong"] as const).map((key, i) => (
            <g key={key}>
              <rect x={i * 82} y="4" width="76" height="16" rx="5"
                className={signals?.refreezeQuality === key ? (key === "weak" ? "f-caution" : "f-label") : "f-fill"} />
              <text x={i * 82 + 38} y="36" textAnchor="middle">{REFREEZE[key].big}</text>
            </g>
          ))}
        </svg>
        <span className="sky-cap">
          {measured(nightLow) ? `Night before the start: low ${w.formatTempDisplay(nightLow)}. ` : ""}
          {refreeze === REFREEZE.weak && measured(nightLow) && nightLow > 32 ? "It stays above freezing, so the snow won't firm up." : refreeze.caption}
          {freezingAbove ? " The freezing level sits above the objective." : ""}
        </span>
      </SectionCard>
    ),
  };

  // Each section's state in a few words, so the list says where to look first.
  const weatherOver = overCount > 0;
  const airOver = fireHigh || (measured(aqi) && aqi > 100);
  const avalancheOver = avalancheLevel !== null && avalancheLevel >= 3;
  const avalancheMissing = w.avalancheRelevant && avalancheLevel === null;
  const routeState = route ? routeCheck(route, routeFormat) : null;
  const sectionState: Record<BriefChapter, { status: Status | "none"; text: string }> = {
    forecast: weatherOver ? { status: "over", text: overRuns.length === 1 ? `Over ${spanLabel(hours, overRuns[0], clock)}` : `${overCount} hours over` }
      : airOver ? { status: "over", text: fireHigh ? `Fire risk ${String(w.fireRiskLabel || "high").toLowerCase()}` : `AQI ${aqi}` }
        : missingCount ? { status: "missing", text: `${missingCount} ${missingCount === 1 ? "hour" : "hours"} incomplete` }
          : hours.length ? { status: "ok", text: "Within limits" } : { status: "missing", text: "Hourly forecast unavailable" },
    timing: !daylightKnown ? { status: "missing", text: "Daylight unavailable" }
      : spare! < 0 ? { status: "over", text: `Back ${durationLabel(spare!)} after sunset` } : { status: "ok", text: `${durationLabel(spare!)} of daylight spare` },
    terrain: avalancheOver ? { status: "over", text: `Avalanche ${["", "Low", "Moderate", "Considerable", "High", "Extreme"][avalancheLevel!] || `level ${avalancheLevel}`}` }
      : terrain === "over" ? { status: "over", text: surface || "Hazardous surface" }
        : avalancheMissing ? { status: "missing", text: "No avalanche rating" }
          : { status: terrain, text: surface || "Surface unavailable" },
    route: routeState ? { status: routeState.status, text: routeState.statusText } : { status: "none", text: "Check a route’s checkpoints" },
    sources: alertCount > 0 ? { status: "over", text: `${alertCount} active ${alertCount === 1 ? "alert" : "alerts"}` }
      : alertsMissing ? { status: "missing", text: "Alerts not confirmed" }
        : w.hasFreshnessWarning ? { status: "missing", text: "Review source freshness" } : { status: "ok", text: "Sources current" },
    gear: { status: "none", text: gearTotal ? `${gearTotal} recommendations` : "What to settle first" },
  };

  return (
    <>
      {showMore && sections.length > 0 && (
        <section className="sky-section" aria-labelledby="sky-sections">
          <div className="sky-sh"><h2 id="sky-sections">Report sections</h2><p>{leads ? `Ordered for ${profile.label.toLowerCase()}. ` : ""}Open one for the full evidence.</p></div>
          <nav className="sky-sections" aria-labelledby="sky-sections">
            {sections.map((id) => {
              const chapter = REPORT_CHAPTERS.find((c) => c.id === id)!;
              const state = sectionState[id];
              const Icon = chapter.icon;
              return (
                <button key={id} type="button" className={`sky-section-link is-${state.status}`} onClick={() => onOpen(id)}>
                  <span className="sky-section-icon"><Icon size={18} aria-hidden="true" /></span>
                  <span><strong>{chapter.label}</strong><small>{state.text}</small></span>
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              );
            })}
            <button type="button" className="sky-section-link is-none" onClick={onReadAll}>
              <span className="sky-section-icon"><BookOpen size={18} aria-hidden="true" /></span>
              <span><strong>Full report</strong><small>Every section on one page</small></span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </nav>
        </section>
      )}

      <section className="sky-section" aria-labelledby="sky-numbers">
        <div className="sky-sh"><h2 id="sky-numbers">The numbers</h2><p>{profile.report.numbersNote}</p></div>
        <div className="sky-nums">
          {profile.report.numbers.map((key) => numberCards[key])}
          <SectionCard to="sources" onOpen={onOpen} className="sky-number sky-score">
            <span className="sky-card-head"><span>Safety score</span><span className="sky-muted">{scoreValue === null ? "Not scored" : data.safety.tier || "hazards only"}</span></span>
            <span className="sky-score-row">
              <svg viewBox="0 0 88 88" className="sky-viz sky-ring" role="img" aria-label={scoreValue === null ? "Safety score unavailable" : `Safety score ${scoreValue} of 100`}>
                <circle cx="44" cy="44" r="36" fill="none" className="s-okfill" strokeWidth="10" />
                {scoreValue !== null && <circle cx="44" cy="44" r="36" fill="none" className="s-accent" strokeWidth="10" strokeLinecap="round"
                  strokeDasharray={`${(scoreValue / 100) * 226.2} 226.2`} transform="rotate(-90 44 44)" />}
                <text x="44" y="51" textAnchor="middle" className="t-ring">{scoreValue ?? "—"}</text>
              </svg>
              <span className="sky-cap is-body">
                {insufficient ? "There isn't enough evidence to score this plan."
                  : bridge || (overCount ? `The score rates hazards on their own. The decision also checks your limits: ${overCount} ${overCount === 1 ? "hour crosses" : "hours cross"} them.`
                    : "The score rates hazards on their own; the decision also checks your limits and timing.")}
              </span>
            </span>
            {data.safety.evidenceQuality && <span className="sky-cap">Evidence quality: {data.safety.evidenceQuality}</span>}
          </SectionCard>
        </div>
      </section>

      <section className="sky-section" aria-labelledby="sky-checks">
        <div className="sky-sh"><h2 id="sky-checks">Checks</h2><p>{leads ? `Ordered for ${profile.label.toLowerCase()}: ${leads} first. ` : ""}Each card opens its section.</p></div>
        <div className="sky-checks">
          {route && (
            <CheckCard title="Route" className="is-route" to="route" onOpen={onOpen} {...routeCheck(route, routeFormat)}>
              <span className="sky-route-check-name">
                <strong>{route.name}</strong>
                {routeFacts && <span className="sky-muted">{routeFacts}</span>}
              </span>
              {route.state === "checked" && (
                <RouteStrip name={route.name} stops={route.stops} profile={route.profile} eta={eta} />
              )}
            </CheckCard>
          )}
          {orderActivityChecks(checks, activity).map((check) => check.card)}
        </div>
      </section>

      {gearEnabled && gear.length > 0 && (
        <section className="sky-section" aria-labelledby="sky-pack">
          <div className="sky-sh"><h2 id="sky-pack">Pack for today</h2>
            <button type="button" className="sky-link sky-sh-link" onClick={() => onOpen("gear")}>
              {gearTotal > gear.length ? `All ${gearTotal} in Gear & actions` : "Open Gear & actions"}<ChevronRight size={16} aria-hidden="true" />
            </button></div>
          <div className="sky-pack">
            {gear.map((item, i) => item && (
              <button type="button" key={`${item.title}-${i}`} className="sky-card sky-item" onClick={() => onOpen("gear")}>
                <span className="sky-item-cat">{item.category}</span>
                <span className="sky-item-name">{item.title}</span>
                <span className="sky-cap">{w.localizeUnitText(item.reason || item.detail)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
