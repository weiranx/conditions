import { BookOpen, Check, ChevronRight, CircleHelp, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { Workspace } from "../model/useWorkspace";
import { freshnessClass } from "../../app/core";
import { isOverHour, spanLabel, skyRuns, type SkyHour } from "./sky-model";

export type BriefChapter = "forecast" | "timing" | "terrain" | "route" | "sources" | "gear";
type Status = "ok" | "over" | "missing";

const measured = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function StatusTag({ status, children }: { status: Status; children: ReactNode }) {
  const Icon = status === "over" ? TriangleAlert : status === "missing" ? CircleHelp : Check;
  return <span className={`sky-status is-${status}`}><Icon size={15} aria-hidden="true" />{children}</span>;
}

function CheckCard({ title, status, statusText, caption, children, onOpen }: {
  title: string; status: Status; statusText: string; caption: string; children?: ReactNode; onOpen: () => void;
}) {
  return (
    <button type="button" className={`sky-card sky-check${status === "missing" ? " is-missing" : ""}`} onClick={onOpen}>
      <span className="sky-card-head"><span>{title}</span><StatusTag status={status}>{statusText}</StatusTag></span>
      {children}
      <span className="sky-cap">{caption}</span>
      <ChevronRight className="sky-chev" size={18} aria-hidden="true" />
    </button>
  );
}

export function BriefSections({ w, hours, clock, scoreValue, insufficient, bridge, onOpen, onReadAll, routeEnabled, gearEnabled }: {
  w: Workspace;
  hours: SkyHour[];
  clock: (minute: number) => string;
  scoreValue: number | null;
  insufficient: boolean;
  bridge: string;
  onOpen: (chapter: BriefChapter) => void;
  onReadAll: () => void;
  routeEnabled: boolean;
  gearEnabled: boolean;
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
  const surface = data.terrainCondition?.label?.replace(/^[\p{Extended_Pictographic}️\s]+/u, "") || null;
  const gear = (w.gearRecommendations || []).filter(Boolean).slice(0, 4);
  const gearTotal = (w.gearRecommendations || []).filter(Boolean).length;

  const arcPoint = (minute: number) => {
    const t = (minute - sunrise!) / (sunset! - sunrise!);
    const px = 10 + Math.max(0, Math.min(1, t)) * 220;
    const py = 58 - Math.sin(Math.PI * Math.max(0, Math.min(1, t))) * 50;
    return [px, py] as const;
  };

  return (
    <>
      <section className="sky-section" aria-labelledby="sky-numbers">
        <div className="sky-sh"><h2 id="sky-numbers">The numbers</h2><p>What your limits are up against.</p></div>
        <div className="sky-nums">
          <div className="sky-card">
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
          </div>
          <div className="sky-card">
            <span className="sky-card-head"><span>Rain and snow</span><span className="sky-muted">{w.expectedTravelWindowHours}-hour totals</span></span>
            <div className="sky-gauges">
              {[{ label: "rain", value: rainIn, scale: 0.5, display: w.expectedRainWindowDisplay },
                { label: "snow", value: snowIn, scale: 4, display: w.expectedSnowWindowDisplay }].map((g) => (
                <div key={g.label} className="sky-gauge">
                  <svg viewBox="0 0 26 72" className="sky-viz" role="img"
                    aria-label={measured(g.value) ? `Expected ${g.label} ${g.display}` : `Expected ${g.label} unavailable`}>
                    <rect x="1" y="1" width="24" height="70" rx="8" className={measured(g.value) ? "f-fill" : "f-none s-missing"} strokeDasharray={measured(g.value) ? undefined : "3 3"} />
                    {measured(g.value) && g.value > 0 && (
                      <rect x="1" y={71 - Math.max(8, Math.min(1, g.value / g.scale) * 70)} width="24" height={Math.max(8, Math.min(1, g.value / g.scale) * 70)} rx="6"
                        className={g.label === "rain" ? "f-cold" : "f-cold-fill s-cold"} strokeWidth="1.5" />
                    )}
                  </svg>
                  <div><span className="sky-big is-small">{measured(g.value) ? g.display : "—"}</span><span className="sky-cap">{g.label}</span></div>
                </div>
              ))}
            </div>
          </div>
          <div className="sky-card sky-score">
            <span className="sky-card-head"><span>Safety score</span><span className="sky-muted">{data.safety.tier || "hazards only"}</span></span>
            <div className="sky-score-row">
              <svg viewBox="0 0 88 88" className="sky-viz sky-ring" role="img" aria-label={scoreValue === null ? "Safety score unavailable" : `Safety score ${scoreValue} of 100`}>
                <circle cx="44" cy="44" r="36" fill="none" className="s-okfill" strokeWidth="10" />
                {scoreValue !== null && <circle cx="44" cy="44" r="36" fill="none" className="s-accent" strokeWidth="10" strokeLinecap="round"
                  strokeDasharray={`${(scoreValue / 100) * 226.2} 226.2`} transform="rotate(-90 44 44)" />}
                <text x="44" y="51" textAnchor="middle" className="t-ring">{scoreValue ?? "—"}</text>
              </svg>
              <p className="sky-cap is-body">
                {insufficient ? "There isn't enough evidence to score this plan."
                  : bridge || (overCount ? `The score rates hazards on their own. The decision also checks your limits: ${overCount} ${overCount === 1 ? "hour crosses" : "hours cross"} them.`
                    : "The score rates hazards on their own; the decision also checks your limits and timing.")}
              </p>
            </div>
            <span className="sky-cap">Evidence quality: {data.safety.evidenceQuality || "not assessed"}</span>
          </div>
        </div>
      </section>

      <section className="sky-section" aria-labelledby="sky-checks">
        <div className="sky-sh"><h2 id="sky-checks">Checks</h2><p>Open any card for the full evidence.</p></div>
        <div className="sky-checks">
          <CheckCard title="Weather" onOpen={() => onOpen("forecast")}
            status={overCount ? "over" : missingCount ? "missing" : "ok"}
            statusText={overRuns.length === 1 ? `Over ${spanLabel(hours, overRuns[0], clock)}` : overCount ? `${overCount} hours over` : missingCount ? `${missingCount} hours incomplete` : "Within limits"}
            caption={firstOver ? firstOver.failedRules[0] || "A planned hour crosses your limits." : hours.length ? "Every planned hour is within your limits." : "Hourly forecast unavailable."}>
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
                <text x="240" y={48 - (precipLimit / 100) * 44 - 4} textAnchor="end">{precipLimit}% limit</text>
                <text x="0" y="62">{clock(hours[0].minute)}</text>
                <text x="240" y="62" textAnchor="end">{clock(hours[hours.length - 1].minute + 60)}</text>
              </svg>
            )}
          </CheckCard>

          <CheckCard title="Alerts" onOpen={() => onOpen("sources")}
            status={alertCount > 0 ? "over" : alertsMissing ? "missing" : "ok"}
            statusText={alertCount > 0 ? `${alertCount} active` : alertsMissing ? (data.alerts ? "Not confirmed" : "Not loaded") : "None active"}
            caption={alertCount > 0 ? (w.nwsTopAlerts?.[0]?.event || "Review the active alert before you go.")
              : alertsMissing ? (data.alerts ? "The alert feed didn't confirm your planned time. Check official alerts before you go." : "The alert feed didn't respond. This brief may be missing an active warning.") : "No active NWS alerts for your planned time."}>
            {alertsMissing && alertCount === 0 && <span className="sky-empty">{data.alerts ? "Not confirmed for your time" : "No response from NWS"}</span>}
          </CheckCard>

          <CheckCard title="Daylight" onOpen={() => onOpen("timing")} status={daylightStatus}
            statusText={!daylightKnown ? "Unavailable" : spare! < 0 ? `Back ${Math.abs(spare!)} min after sunset` : start! < sunrise! ? `Starts before sunrise · ${spare} min spare` : `${spare} min spare`}
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

          <CheckCard title="Terrain & snow" onOpen={() => onOpen("terrain")} status={surface ? "ok" : "missing"}
            statusText={surface || "Unavailable"}
            caption={bands.length > 1 ? "Temperature by elevation at your planned time." : w.snowpackBestDepthDisplay ? `Best snow depth estimate: ${w.snowpackBestDepthDisplay}.` : "Surface and snow assessment."}>
            {bands.length > 1 && (() => {
              const e0 = bands[0].elevationFt, e1 = bands[bands.length - 1].elevationFt;
              const t0 = Math.min(...bands.map((b) => b.temp), 20), t1 = Math.max(...bands.map((b) => b.temp), 50);
              const px = (t: number) => 20 + ((t - t0) / (t1 - t0 || 1)) * 200;
              const py = (e: number) => 60 - ((e - e0) / (e1 - e0 || 1)) * 50;
              return (
                <svg className="sky-viz" viewBox="0 0 240 70" role="img"
                  aria-label={`Temperature by elevation: ${bands.map((b) => `${w.formatElevationDisplay(b.elevationFt)} ${w.formatTempDisplay(b.temp)}`).join(", ")}.`}>
                  {t0 < 32 && t1 > 32 && <><line x1={px(32)} x2={px(32)} y1="4" y2="62" className="s-cold" strokeDasharray="3 3" /><text x={px(32) + 4} y="10" className="t-cold">32°F</text></>}
                  <polyline fill="none" className="s-label" strokeWidth="2.5" points={bands.map((b) => `${px(b.temp)},${py(b.elevationFt)}`).join(" ")} />
                  {bands.map((b, i) => <circle key={i} cx={px(b.temp)} cy={py(b.elevationFt)} r="3.5" className={b.temp < 32 ? "f-cold" : "f-label"} />)}
                  <text x="0" y="68">{w.formatElevationDisplay(e0)}</text>
                  <text x="0" y="10">{w.formatElevationDisplay(e1)}</text>
                </svg>
              );
            })()}
          </CheckCard>

          <CheckCard title="Avalanche" onOpen={() => onOpen("terrain")}
            status={w.avalancheRelevant && avalancheLevel === null ? "missing" : avalancheLevel !== null && avalancheLevel >= 3 ? "over" : "ok"}
            statusText={avalancheLevel !== null && avalancheLevel > 0 ? ["", "Low", "Moderate", "Considerable", "High", "Extreme"][avalancheLevel] || `Level ${avalancheLevel}` : w.avalancheRelevant ? "No rating" : "Not relevant"}
            caption={w.avalancheNotApplicableReason || (avalancheLevel ? `Danger level ${avalancheLevel} of 5 for your elevation band.` : "No avalanche rating is available for this plan.")}>
            <svg className="sky-viz" viewBox="0 0 240 40" role="img" aria-label={avalancheLevel ? `Avalanche danger ${avalancheLevel} of 5.` : "No avalanche danger rating."}>
              {["Low", "Mod", "Consid", "High", "Extreme"].map((label, i) => (
                <g key={label}>
                  <rect x={i * 49} y="4" width="44" height="16" rx="5" className={avalancheLevel === i + 1 ? (i >= 2 ? "f-caution" : "f-label") : "f-fill"} />
                  <text x={i * 49 + 22} y="36" textAnchor="middle">{label}</text>
                </g>
              ))}
            </svg>
          </CheckCard>

          <CheckCard title="Air & fire" onOpen={() => onOpen("forecast")}
            status={!measured(aqi) ? "missing" : aqi > 100 || (w.fireRiskLevel as number) >= 3 ? "over" : "ok"}
            statusText={measured(aqi) ? `AQI ${aqi}` : "AQI unavailable"}
            caption={`${aqiCategory || "Air quality unavailable"} · fire risk ${String(w.fireRiskLabel || "unavailable").toLowerCase()}.`}>
            {measured(aqi) && (
              <svg className="sky-viz" viewBox="0 0 240 70" role="img" aria-label={`Air quality index ${aqi}, ${aqiCategory || "category unavailable"}.`}>
                <path d="M64 64 A56 56 0 0 1 176 64" fill="none" className="s-okfill" strokeWidth="10" strokeLinecap="round" />
                {(() => { const t = Math.min(1, aqi / 300), a = Math.PI * (1 - t); return (
                  <path d={`M64 64 A56 56 0 0 1 ${120 + 56 * Math.cos(a)} ${64 - 56 * Math.sin(a)}`} fill="none" className={aqi > 100 ? "s-caution" : "s-accent"} strokeWidth="10" strokeLinecap="round" />); })()}
                <text x="120" y="60" textAnchor="middle" className="t-ring">{aqi}</text>
              </svg>
            )}
          </CheckCard>
        </div>
      </section>

      {gearEnabled && gear.length > 0 && (
        <section className="sky-section" aria-labelledby="sky-pack">
          <div className="sky-sh"><h2 id="sky-pack">Pack for this day</h2><p>From the conditions in this brief.</p></div>
          <div className="sky-pack">
            {gear.map((item, i) => item && (
              <button type="button" key={`${item.title}-${i}`} className="sky-card sky-item" onClick={() => onOpen("gear")}>
                <span className="sky-item-cat">{item.category}</span>
                <span className="sky-item-name">{item.title}</span>
                <span className="sky-cap">{w.localizeUnitText(item.detail)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="sky-section" aria-labelledby="sky-more">
        <div className="sky-sh"><h2 id="sky-more">More in this brief</h2></div>
        <div className="sky-group">
          {routeEnabled && <button type="button" className="sky-row" onClick={() => onOpen("route")}>
            <span><strong>Route</strong><small>Conditions along your route and checkpoints</small></span><ChevronRight size={18} aria-hidden="true" /></button>}
          <button type="button" className="sky-row" onClick={() => onOpen("sources")}>
            <span><strong>Checks &amp; sources</strong><small>{w.hasFreshnessWarning ? w.freshnessWarningSummary : "Source freshness and where each number comes from"}</small></span>
            {w.hasFreshnessWarning && <StatusTag status="missing">Review</StatusTag>}<ChevronRight size={18} aria-hidden="true" /></button>
          {gearEnabled && <button type="button" className="sky-row" onClick={() => onOpen("gear")}>
            <span><strong>Gear &amp; actions</strong><small>{gearTotal ? `${gearTotal} recommendations and what to settle first` : "What to settle before you leave"}</small></span><ChevronRight size={18} aria-hidden="true" /></button>}
          <button type="button" className="sky-row" onClick={onReadAll}>
            <span><strong>Read the full report</strong><small>Every section on one page</small></span><BookOpen size={18} aria-hidden="true" /></button>
        </div>
      </section>
    </>
  );
}
