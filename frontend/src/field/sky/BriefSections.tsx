import { Bell, BookOpen, Check, Smile, ChevronRight, CircleHelp, CloudSun, Mountain, Route as RouteIcon, Snowflake, Sunset, TriangleAlert, Wind } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Fold } from "./Fold";
import { TilePopup, type TileDetail } from "./TilePopup";
import { AirDetail, AlertsDetail, AvalancheDetail, DaylightDetail, TerrainDetail, WeatherDetail, type WeatherMetric } from "./TileDetails";
import type { Workspace } from "../model/useWorkspace";
import { durationLabel, knownFeet, plainRule, type CheckStatus } from "./status";
import { isOverHour, spanLabel, skyRuns, type SkyHour } from "./sky-model";
import { describeCheckpointBreach, describeCheckpointHazard, type PlannedRouteSummary } from "../route-planning";
import { RouteStrip } from "./RouteStrip";
import { activityProfile, orderActivityChecks, type ActivityCheck, type ActivityNumber } from "../../app/activity-profiles";
import type { ActivityType } from "../../app/types";
import { chapterLabel, type ReportChapter } from "./report-chapters";

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

/** Each check's icon, as on a weather tile. */
const CHECK_ICONS: Record<string, typeof Bell> = {
  Weather: CloudSun, Alerts: Bell, Daylight: Sunset, "Terrain & snow": Mountain, Avalanche: Snowflake, "Air & fire": Wind, Route: RouteIcon,
};

/** Tiles open a popup with their detail; without a provider they go straight to their section. */
const TileContext = createContext<((detail: TileDetail) => void) | null>(null);

function CheckCard({ title, status, statusText, caption, children, to, onOpen, className = "" }: {
  title: string; status: Status; statusText: string; caption: string; children?: ReactNode;
  to: BriefChapter; onOpen: (chapter: BriefChapter) => void; className?: string;
}) {
  const Icon = CHECK_ICONS[title];
  const pick = useContext(TileContext);
  // The route has its own section to work in; every other tile opens as a popup first.
  const open = pick && title !== "Route"
    ? () => pick({ title, icon: Icon, status, value: statusText, caption, visual: children, to })
    : onOpen;
  return (
    <SectionCard to={to} onOpen={open} className={`sky-check sky-tile${status === "missing" ? " is-missing" : ""}${className ? ` ${className}` : ""}`}>
      <span className="sky-card-head">{Icon && <Icon size={14} aria-hidden="true" />}<span>{title}</span><StatusTag status={status}>{statusText}</StatusTag></span>
      {children}
      <span className="sky-cap">{caption}</span>
    </SectionCard>
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
  if (route.firstHazard) return {
    status: "over" as Status,
    statusText: route.hazardCount === 1 ? "1 alert or danger" : `${route.hazardCount} alerts or dangers`,
    caption: `Within your limits, but ${route.firstHazard.name}${route.firstHazard.eta ? ` at ${format.eta(route.firstHazard.eta)}` : ""} has ${describeCheckpointHazard(route.firstHazard.hazard)}.${back}`,
  };
  if (missingCount) return {
    status: "missing" as Status,
    statusText: `${missingCount} incomplete`,
    caption: `${missingCount} checkpoint ${missingCount === 1 ? "forecast is" : "forecasts are"} missing or incomplete, so ${missingCount === 1 ? "it" : "they"} can't be checked against every limit.${back}`,
  };
  return { status: "ok" as Status, statusText: "Within limits", caption: `All ${stops.length} checkpoint forecasts are within your limits.${back}` };
}

export function BriefSections({ w, hours, clock, onOpen, onReadAll, route = null, gearEnabled, activity, showMore = true, more = null }: {
  w: Workspace;
  hours: SkyHour[];
  clock: (minute: number) => string;
  onOpen: (chapter: BriefChapter) => void;
  onReadAll: () => void;
  /** Extra brief parts (AI explanation, assistant) shown under More beside the pack list. */
  more?: ReactNode;
  /** The full-report link; the full report already contains every section. */
  showMore?: boolean;
  /** The route chosen in the plan; the checks then lead with it. */
  route?: PlannedRouteSummary | null;
  gearEnabled: boolean;
  /** The report's activity; it sets the order of the checks. */
  activity: ActivityType;
}) {
  const data = w.safetyData!;
  const { avalanche, fireRisk, rainfall, snowpack, sourceFreshness, terrainCondition } = w.interpretation!;
  const prefs = w.preferences;
  const overRuns = skyRuns(hours).filter((run) => run.tone === "over");
  const overCount = hours.filter(isOverHour).length;
  const missingCount = hours.filter((h) => h.tone === "missing" && !isOverHour(h)).length;
  const firstOver = hours.find(isOverHour);


  // Daylight: sunrise, sunset, start and return in minutes after midnight.
  const sunrise = w.sunriseMinutesForPlan;
  const sunset = w.sunsetMinutesForPlan;
  const start = w.startMinutesForPlan;
  const back = w.returnMinutes;
  const daylightKnown = sunrise !== null && sunset !== null && start !== null && back !== null && sunset > sunrise;
  const spare = daylightKnown ? sunset - back : null;
  const daylightStatus: Status = !daylightKnown ? "missing" : spare! < 0 ? "over" : "ok";

  // Alerts: an active alert needs attention; an unavailable feed cannot confirm clear conditions.
  // The same freshness state as Checks & sources, so the two never disagree.
  const alertState = sourceFreshness.rows.find((row) => row.label === "Alerts")?.state ?? "missing";
  const alertsMissing = !data.alerts || alertState === "missing" || alertState === "stale";
  const alertCount = w.nwsAlertCount || 0;

  const aqi = data.airQuality?.usAqi;
  const aqiCategory = data.airQuality?.category;
  const avalancheLevel = avalanche.overallLevel;
  const bands = [...(w.elevationForecastBands || [])].filter((b) => measured(b.elevationFt) && measured(b.temp))
    .sort((a, b) => a.elevationFt - b.elevationFt);
  const surface = terrainCondition.surfaceLabel;
  const terrain = terrainCondition.status;
  const fireHigh = (fireRisk.level ?? 0) >= 3;
  // What sets an elevated fire level, in a few words; the full reason is in Weather.
  const fireDriver = data.fireRisk?.primaryDriver;
  const fireCause = (fireRisk.level ?? 0) >= 2 && fireDriver
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

  // The night before the start sets the snow surface (backend surface-evidence.js).
  const signals = data.terrainCondition?.signals;
  const refreeze = REFREEZE[signals?.refreezeQuality ?? "unknown"] ?? REFREEZE.unknown;
  const nightLow = signals?.freezeThawMinTempF;
  const freezingLevel = data.atmosphere?.freezingLevelFt;
  const objectiveFt = knownFeet(data.weather?.elevation);
  const freezingAbove = measured(freezingLevel) && objectiveFt !== null && freezingLevel > objectiveFt;
  const snowFirst = activity === "ski-touring" || activity === "snow-climbing";
  const refreezeCaption = snowFirst && signals?.refreezeQuality
    ? `Overnight refreeze: ${refreeze.big.toLowerCase()}.${measured(nightLow) ? ` Night low ${w.formatTempDisplay(nightLow)}.` : ""} ${
      refreeze === REFREEZE.weak && measured(nightLow) && nightLow > 32 ? "It stays above freezing, so the snow won't firm up." : refreeze.caption}${freezingAbove ? " The freezing level sits above the objective." : ""}`
    : "";

  // The weather tile: what the sky does, how low and high it gets, and how it feels.
  const temps = hours.filter((h) => measured(h.temp)).map((h) => h.temp);
  const lowTemp = temps.length ? Math.min(...temps) : null;
  const highTemp = temps.length ? Math.max(...temps) : null;
  const conditionCounts = new Map<string, number>();
  for (const h of hours) if (h.condition) conditionCounts.set(h.condition, (conditionCounts.get(h.condition) ?? 0) + 1);
  const commonCondition = [...conditionCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  // A rough spell is what the traveller needs to hear about, so it names the sky before the calm hours do.
  const skyCondition = firstOver?.condition || commonCondition || "";
  const comfort = data.pleasantness;
  const comfortScore = comfort && measured(comfort.score) && comfort.score >= 0 && comfort.score <= 100 ? comfort.score : null;

  // Every check is shown; the activity sets the order and a failing check leads.
  const checks: { key: ActivityCheck; over: boolean; card: ReactNode }[] = [
    { key: "weather", over: overCount > 0, card: (
      <CheckCard key="weather" title="Weather" to="forecast" onOpen={onOpen}
        status={overCount ? "over" : missingCount ? "missing" : "ok"}
        statusText={skyCondition || (overRuns.length === 1 ? `Over ${spanLabel(hours, overRuns[0], clock)}` : overCount ? `${overCount} hours over` : missingCount ? `${missingCount} ${missingCount === 1 ? "hour" : "hours"} incomplete` : hours.length ? "Within limits" : "Unavailable")}
        caption={firstOver ? `${firstOver.failedRules[0] ? plainRule(firstOver.failedRules[0]) : "A planned hour crosses your limits"}${overRuns.length === 1 ? ` · ${spanLabel(hours, overRuns[0], clock)}` : ""}`
          : missingCount ? `${missingCount} planned ${missingCount === 1 ? "hour has" : "hours have"} incomplete readings, so ${missingCount === 1 ? "it" : "they"} can't be confirmed within your limits.`
          : hours.length ? "Every planned hour is within your limits." : "Hourly forecast unavailable."}>
        {(lowTemp !== null || comfortScore !== null) && (
          <span className="sky-wx">
            {lowTemp !== null && highTemp !== null && (
              <span className="sky-hilo" role="img" aria-label={`Low ${w.formatTempDisplay(lowTemp)}, high ${w.formatTempDisplay(highTemp)}`}>
                <span>L {w.formatTempDisplay(lowTemp)}</span>
                <span className="sky-hilo-bar" aria-hidden="true" />
                <span>H {w.formatTempDisplay(highTemp)}</span>
              </span>
            )}
            {comfort && (
              <span className="sky-comfort">
                <Smile size={14} aria-hidden="true" />
                <span>Comfort</span>
                <strong>{comfortScore === null ? "Unknown" : comfort.label}</strong>
                {comfortScore !== null && <span className="sky-comfort-meter" role="img" aria-label={`Comfort ${Math.round(comfortScore)} of 100`}><span style={{ width: `${comfortScore}%` }} /></span>}
              </span>
            )}
          </span>
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
        caption={refreezeCaption || (bands.length > 1 ? "Temperature by elevation at your start." : snowpack.bestDepthDisplay ? `Best snow depth estimate: ${snowpack.bestDepthDisplay}.` : "Surface and snow assessment.")}>
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
        status={avalanche.relevant && avalancheLevel === null ? "missing" : avalancheLevel !== null && avalancheLevel >= 3 ? "over" : "ok"}
        statusText={avalancheLevel !== null && avalancheLevel > 0 ? ["", "Low", "Moderate", "Considerable", "High", "Extreme"][avalancheLevel] || `Level ${avalancheLevel}` : avalanche.relevant ? "No rating" : "Not relevant"}
        caption={avalanche.briefCaption}>
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
        statusText={fireHigh && !(measured(aqi) && aqi > 100) ? `Fire risk ${String(fireRisk.label || "high").toLowerCase()}` : measured(aqi) ? `AQI ${aqi}` : "AQI unavailable"}
        caption={`${aqiCategory || "Air quality unavailable"} · fire risk ${String(fireRisk.label || "unavailable").toLowerCase()}${fireCause ? ` (${fireCause})` : ""}.`}>
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

  const packItems = gearEnabled && gear.length > 0 ? (
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
  ) : null;

  // The activity's two headline numbers, each against your limit.
  const gustLimit = prefs.maxWindGustMph;
  const peak = hours.filter((h) => measured(h.gust)).reduce<SkyHour | null>((a, h) => (!a || h.gust > a.gust ? h : a), null);
  const thermal = hours.filter((h) => h.thermalComplete && measured(h.feelsLike));
  const coldest = thermal.reduce<SkyHour | null>((a, h) => (!a || h.feelsLike < a.feelsLike ? h : a), null);
  const warmest = thermal.reduce<SkyHour | null>((a, h) => (!a || h.feelsLike > a.feelsLike ? h : a), null);
  const floor = prefs.minFeelsLikeF;
  const ceiling = prefs.maxFeelsLikeF;
  const [firstPrecip, secondPrecip] = snowFirst
    ? [["snow", rainfall.expectedSnowWindowDisplay], ["rain", rainfall.expectedRainWindowDisplay]]
    : [["rain", rainfall.expectedRainWindowDisplay], ["snow", rainfall.expectedSnowWindowDisplay]];
  const tiles: Record<ActivityNumber, { label: string; value: string; note: string; over: boolean; to: BriefChapter }> = {
    gust: { label: "Peak gust", value: peak ? w.formatWindDisplay(peak.gust) : "—", to: "forecast",
      note: peak ? `at ${clock(peak.minute)} · limit ${w.formatWindDisplay(gustLimit)}` : "Unavailable", over: Boolean(peak && peak.gust > gustLimit) },
    precip: { label: `${firstPrecip[0] === "rain" ? "Rain" : "Snow"} expected`, value: String(firstPrecip[1]), to: "forecast", over: false,
      note: `${secondPrecip[1]} ${secondPrecip[0]} · ${rainfall.expectedTravelWindowHours}-hour window` },
    cold: { label: "Coldest feels-like", value: coldest ? w.formatTempDisplay(coldest.feelsLike) : "—", to: "forecast",
      note: coldest ? `at ${clock(coldest.minute)} · floor ${w.formatTempDisplay(floor)}` : "Unavailable", over: Boolean(coldest && coldest.feelsLike < floor) },
    heat: { label: "Warmest feels-like", value: warmest ? w.formatTempDisplay(warmest.feelsLike) : "—", to: "forecast",
      note: warmest ? `at ${clock(warmest.minute)} · limit ${w.formatTempDisplay(ceiling)}` : "Unavailable", over: Boolean(warmest && warmest.feelsLike > ceiling) },
    refreeze: { label: "Overnight refreeze", value: refreeze.big, to: "terrain", over: refreeze.status === "over",
      note: measured(nightLow) ? `night low ${w.formatTempDisplay(nightLow)}` : refreeze.text },
  };

  const ordered = orderActivityChecks(checks, activity);
  const [detail, setDetail] = useState<TileDetail | null>(null);
  // What each tile shows when opened: the readings behind its value.
  const detailsFor = (title: string): ReactNode => {
    switch (title) {
      case "Weather": return <WeatherDetail w={w} hours={hours} />;
      case "Daylight": return <DaylightDetail w={w} />;
      case "Alerts": return <AlertsDetail w={w} />;
      case "Terrain & snow": return <TerrainDetail w={w} />;
      case "Avalanche": return <AvalancheDetail w={w} />;
      case "Air & fire": return <AirDetail w={w} />;
      default: return undefined;
    }
  };
  const metricFor: Partial<Record<ActivityNumber, WeatherMetric>> = { gust: "gust", precip: "precip", cold: "feels", heat: "feels" };

  return (
    <TileContext.Provider value={(tile) => setDetail({ ...tile, details: tile.details ?? detailsFor(tile.title) })}>
      <div className="sky-numbers" role="group" aria-label="Key numbers">
        {profile.report.numbers.map((key) => {
          const tile = tiles[key];
          return (
            <button key={key} type="button" className={`sky-card sky-tile sky-number-tile${tile.over ? " is-over" : ""}`} onClick={() => setDetail({ title: tile.label, status: tile.over ? "over" : "ok", value: tile.value, caption: tile.note, to: tile.to,
              details: metricFor[key] ? <WeatherDetail w={w} hours={hours} initial={metricFor[key]} /> : <TerrainDetail w={w} /> })}>
              <span className="sky-tile-label">{tile.label}</span>
              <span className="sky-big">{tile.value}</span>
              <span className="sky-cap">{tile.note}</span>
            </button>
          );
        })}
      </div>

      <section className="sky-section" aria-labelledby="sky-checks">
        <div className="sr-only"><h2 id="sky-checks">Checks</h2><p>{leads ? `Ordered for ${profile.label.toLowerCase()}: ${leads} first. ` : ""}Problems first; tap one for the evidence.</p></div>
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
          {ordered.map((check) => check.card)}
        </div>
        {showMore && (
          <button type="button" className="sky-link sky-full-link" onClick={onReadAll}>
            <BookOpen size={16} aria-hidden="true" />Read the full report<ChevronRight size={16} aria-hidden="true" />
          </button>
        )}
      </section>

      {showMore && (packItems || more) && (
        <Fold id="sky-more" title="More" hint={[packItems ? "pack list" : null, more ? "AI explanation, assistant, insights" : null].filter(Boolean).join(" · ")}>
          {packItems}
          {more}
        </Fold>
      )}
      {detail && (
        <TilePopup detail={detail} onClose={() => setDetail(null)} onOpen={(chapter) => { setDetail(null); onOpen(chapter); }} />
      )}
    </TileContext.Provider>
  );
}
