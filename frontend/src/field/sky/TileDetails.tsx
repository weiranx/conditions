import { useState, type ReactNode } from "react";
import type { Workspace } from "../model/useWorkspace";
import { DaylightChart } from "../DaylightChart";
import { HourChart, type HourGuide, type HourTone } from "./HourChart";
import { shortHour, type SkyHour } from "./sky-model";
import { durationLabel } from "./status";

const measured = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** A labelled list of readings, the way a weather tile lists what it measured. */
function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  const shown = rows.filter(([, value]) => value !== null && value !== undefined && value !== "");
  if (!shown.length) return null;
  return (
    <dl className="sky-popup-facts">
      {shown.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}

const METRICS = [
  { key: "gust", label: "Gusts" },
  { key: "precip", label: "Rain chance" },
  { key: "feels", label: "Feels like" },
  { key: "temp", label: "Temperature" },
] as const;
export type WeatherMetric = (typeof METRICS)[number]["key"];

/** The planned hours on one chart; pick a measurement and an hour to read it. */
export function WeatherDetail({ w, hours, initial = "gust" }: { w: Workspace; hours: SkyHour[]; initial?: WeatherMetric }) {
  const [metric, setMetric] = useState<WeatherMetric>(initial);
  const firstOver = hours.findIndex((h) => h.tone === "over");
  const [hour, setHour] = useState(Math.max(0, firstOver));
  if (!hours.length) return <p className="sky-popup-note">Hourly forecast unavailable.</p>;
  const prefs = w.preferences;
  const style = prefs.timeStyle === "24h" ? "24h" : "12h";
  const labels = hours.map((h) => shortHour(h.minute, style));
  const pick = (h: SkyHour) => (metric === "gust" ? h.gust : metric === "precip" ? h.precipChance : metric === "feels" ? h.feelsLike : h.temp);
  const values = hours.map((h) => (measured(pick(h)) ? pick(h) : null));
  const show = (v: number) => (metric === "gust" ? w.formatWindDisplay(v) : metric === "precip" ? `${Math.round(v)}%` : w.formatTempDisplay(v));
  const compact = (v: number) => (metric === "precip" ? `${Math.round(v)}` : show(v).replace(/\s*[a-z/]+$/i, "").replace(/°.*$/, "°"));
  const guides: HourGuide[] = metric === "gust" ? [{ value: prefs.maxWindGustMph, label: `your limit ${w.formatWindDisplay(prefs.maxWindGustMph)}`, tone: "caution" }]
    : metric === "precip" ? [{ value: prefs.maxPrecipChance, label: `your limit ${prefs.maxPrecipChance}%`, tone: "caution" }]
      : metric === "feels" ? [{ value: prefs.minFeelsLikeF, label: `your floor ${w.formatTempDisplay(prefs.minFeelsLikeF)}`, tone: "caution" }]
        : [{ value: 32, label: `freezing ${w.formatTempDisplay(32)}`, tone: "cold" }];
  const selected = hours[Math.min(hour, hours.length - 1)];
  const value = pick(selected);
  return (
    <div className="sky-popup-weather">
      <div className="sky-segmented" role="group" aria-label="Measurement">
        {METRICS.map((m) => (
          <button key={m.key} type="button" aria-pressed={metric === m.key} onClick={() => setMetric(m.key)}>{m.label}</button>
        ))}
      </div>
      <p className="sky-popup-readout">
        <strong>{measured(value) ? show(value) : "—"}</strong>
        <span>{shortHour(selected.minute, style)} · {selected.condition || "Forecast"}</span>
      </p>
      {values.some((v) => v !== null) ? (
        <HourChart labels={labels} values={values} tones={hours.map((h) => h.tone as HourTone)} guides={guides} format={compact} describe={show}
          selected={Math.min(hour, hours.length - 1)} onSelect={setHour} height={190} kind={metric === "precip" ? "bars" : "line"}
          palette={metric === "precip" ? "cold" : metric === "gust" ? "neutral" : "temperature"} coldBelow={metric === "gust" || metric === "precip" ? undefined : 32}
          domain={metric === "precip" ? [0, 100] : undefined} label={`${METRICS.find((m) => m.key === metric)!.label} by hour. Use the arrow keys to move between hours.`} />
      ) : <p className="sky-popup-note">No hourly readings for this measurement.</p>}
      <Facts rows={[
        ["Feels like", measured(selected.feelsLike) ? w.formatTempDisplay(selected.feelsLike) : null],
        ["Wind", measured(selected.wind) ? w.formatWindDisplay(selected.wind) : null],
        ["Gusts", measured(selected.gust) ? w.formatWindDisplay(selected.gust) : null],
        ["Rain chance", measured(selected.precipChance) ? `${selected.precipChance}%` : null],
        ["Checked near", selected.approachAdjusted && measured(selected.elevationFt) ? w.formatElevationDisplay(selected.elevationFt) : null],
      ]} />
    </div>
  );
}

export function DaylightDetail({ w }: { w: Workspace }) {
  const solar = w.safetyData?.solar;
  const sunrise = w.sunriseMinutesForPlan;
  const sunset = w.sunsetMinutesForPlan;
  const back = w.returnMinutes;
  const spare = sunset !== null && back !== null && Number.isFinite(back) ? sunset - back : null;
  const style = w.preferences.timeStyle;
  return (
    <div>
      <DaylightChart start={w.alpineStartTime} hours={w.travelWindowHours} sunrise={solar?.sunrise} sunset={solar?.sunset} />
      <Facts rows={[
        ["Start", w.displayStartTime],
        ["Back", `${w.formatClockForStyle(w.returnTimeDisplay, style)}${w.returnExtendsPastMidnight ? " (+1 day)" : ""}`],
        ["Sunrise", solar?.sunrise ? w.formatClockForStyle(solar.sunrise, style) : null],
        ["Sunset", solar?.sunset ? w.formatClockForStyle(solar.sunset, style) : null],
        ["Daylight", solar?.dayLength || (sunrise !== null && sunset !== null ? durationLabel(sunset - sunrise) : null)],
        ["Spare at return", spare === null ? null : spare < 0 ? `${durationLabel(-spare)} after sunset` : durationLabel(spare)],
      ]} />
    </div>
  );
}

export function AlertsDetail({ w }: { w: Workspace }) {
  const alerts = w.safetyData?.alerts;
  const list = (alerts?.alerts ?? []).slice(0, 4);
  return (
    <div>
      {list.length === 0 && <p className="sky-popup-note">{alerts ? "The feed listed no alerts. Check official alerts before you go." : "The alert feed did not respond."}</p>}
      {list.map((alert, i) => (
        <article key={`${alert.event}-${i}`} className="sky-popup-alert">
          <strong>{alert.event || "Alert"}</strong>
          {alert.severity && <span className="sky-popup-tag">{alert.severity}</span>}
          {alert.headline && <p>{alert.headline}</p>}
          {(alert.ends || alert.expires) && <small>Until {new Date(alert.ends || alert.expires!).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</small>}
        </article>
      ))}
      <Facts rows={[["Source", alerts?.source], ["More alerts", (alerts?.totalActiveCount ?? 0) > list.length ? String((alerts?.totalActiveCount ?? 0) - list.length) : null]]} />
    </div>
  );
}

export function TerrainDetail({ w }: { w: Workspace }) {
  const data = w.safetyData!;
  const { terrainCondition, snowpack } = w.interpretation!;
  const bands = [...(w.elevationForecastBands || [])].filter((b) => measured(b.elevationFt) && measured(b.temp)).sort((a, b) => b.elevationFt - a.elevationFt);
  const freezing = data.atmosphere?.freezingLevelFt;
  return (
    <div>
      {bands.length > 0 && (
        <ol className="sky-ladder" aria-label="Temperature by elevation at your planned time">
          {bands.map((b) => (
            <li key={b.label} className={b.temp <= 32 ? "is-cold" : undefined}>
              <span>{b.label}<small>{w.formatElevationDisplay(b.elevationFt)}</small></span>
              <strong>{w.formatTempDisplay(b.temp)}</strong>
            </li>
          ))}
        </ol>
      )}
      <Facts rows={[
        ["Surface", terrainCondition.surfaceLabel],
        ["Snow depth", snowpack.bestDepthDisplay],
        ["Freezing level", measured(freezing) ? w.formatElevationDisplay(freezing) : null],
        ["Confidence", data.terrainCondition?.confidence],
      ]} />
      {terrainCondition.summary && <p className="sky-popup-note">{terrainCondition.summary}</p>}
    </div>
  );
}

export function AvalancheDetail({ w }: { w: Workspace }) {
  const data = w.safetyData!;
  const { avalanche } = w.interpretation!;
  const av = data.avalanche;
  const rating = (n: number | null) => (n ? ["", "Low", "Moderate", "Considerable", "High", "Extreme"][n] ?? `Level ${n}` : "No rating");
  return (
    <div>
      <Facts rows={[
        ["Danger", av?.risk],
        ...avalanche.elevationRows.map((row): [string, ReactNode] => [row.label, rating(row.rating)]),
        ["Center", av?.center],
        ["Zone", av?.zone],
      ]} />
      {avalanche.problemTerrain.map((problem) => (
        <article key={problem.name} className="sky-popup-alert">
          <strong>{problem.name}</strong>
          <small>{[problem.aspects.join(", "), problem.elevations.join(" / ")].filter(Boolean).join(" · ")}</small>
          {problem.description && <p>{problem.description}</p>}
        </article>
      ))}
      {av?.bottomLine && <p className="sky-popup-note">{av.bottomLine}</p>}
    </div>
  );
}

export function AirDetail({ w }: { w: Workspace }) {
  const data = w.safetyData!;
  const { fireRisk, heatRisk } = w.interpretation!;
  const air = data.airQuality;
  return (
    <div>
      <Facts rows={[
        ["Air quality index", measured(air?.usAqi) ? String(air.usAqi) : null],
        ["Category", air?.category],
        ["Fire risk", fireRisk.label],
        ["Heat risk", data.heatRisk && (measured(data.heatRisk.level) || data.heatRisk.label) ? heatRisk.label : null],
      ]} />
      {(data.fireRisk?.reasons ?? []).slice(0, 3).map((reason) => <p key={reason} className="sky-popup-note">{w.localizeUnitText(reason)}</p>)}
      {data.fireRisk?.guidance && <p className="sky-popup-note">{data.fireRisk.guidance}</p>}
    </div>
  );
}
