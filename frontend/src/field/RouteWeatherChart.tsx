import { useState } from "react";
import { parseSolarClockMinutes, parseTimeInputMinutes } from "../app/core";
import { computeFeelsLikeF } from "../app/planner-helpers";
import type { RouteWaypointSummary } from "../hooks/useRouteAnalysis";
import type { Workspace } from "./model/useWorkspace";
import { hasRouteNumber } from "./route-planning";
import { HourChart, type HourGuide, type HourTone } from "./sky/HourChart";
import { skyAt } from "./sky/sky-model";
import "./sky/parts.css";

type RouteMetric = "feelsLike" | "temp" | "gust" | "precipChance";

const METRIC_LABELS: Record<RouteMetric, string> = {
  feelsLike: "Feels like",
  temp: "Temperature",
  gust: "Gusts",
  precipChance: "Rain chance",
};

/** "10:36" → "10:36a" (or "10:36" for 24-hour clocks): short enough for narrow columns. */
function compactClock(minutes: number | null, style: string): string {
  if (minutes === null) return "—";
  const h = Math.floor(minutes / 60) % 24;
  const mm = String(minutes % 60).padStart(2, "0");
  return style === "24h" ? `${String(h).padStart(2, "0")}:${mm}` : `${h % 12 || 12}:${mm}${h < 12 ? "a" : "p"}`;
}

/**
 * Each checkpoint's forecast at its estimated arrival, drawn with the Weather
 * section's hour chart: one column per checkpoint, the user's limits as guides,
 * checkpoints over a limit hatched, and the sky at each arrival along the base.
 */
export function RouteWeatherChart({ workspace: w, summaries, tones, selected, onSelect }: {
  workspace: Workspace;
  summaries: RouteWaypointSummary[];
  tones: HourTone[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const [metric, setMetric] = useState<RouteMetric>("feelsLike");
  const { preferences } = w;
  const arrivals = summaries.map((p) => parseTimeInputMinutes(p.etaTime || ""));
  const sunrise = parseSolarClockMinutes(w.safetyData?.solar?.sunrise);
  const sunset = parseSolarClockMinutes(w.safetyData?.solar?.sunset);
  const read = (p: RouteWaypointSummary): number | null => {
    if (!p.dataAvailable) return null;
    const wx = p.weather;
    if (metric === "feelsLike") {
      return hasRouteNumber(wx.feelsLike) ? wx.feelsLike
        : hasRouteNumber(wx.temp) && hasRouteNumber(wx.windSpeed) ? computeFeelsLikeF(wx.temp, wx.windSpeed) : null;
    }
    const value = metric === "temp" ? wx.temp : metric === "gust" ? wx.windGust : wx.precipChance;
    return hasRouteNumber(value) ? value : null;
  };
  const values = summaries.map(read);
  const isTemp = metric === "feelsLike" || metric === "temp";
  const temp = (value: number) => w.formatTempDisplay(value);
  const wind = (value: number) => w.formatWindDisplay(value);
  const describe = (value: number) => (isTemp ? temp(value) : metric === "gust" ? wind(value) : `${Math.round(value)}%`);
  const compact = (value: number) => (isTemp ? w.formatTempDisplay(value, { includeUnit: false })
    : metric === "gust" ? w.formatWindDisplay(value).replace(/\s*[a-z/]+$/i, "") : `${Math.round(value)}%`);
  const guides: HourGuide[] = isTemp
    ? [{ value: 32, label: `freezing ${temp(32)}`, tone: "cold" },
      ...(metric === "feelsLike" ? [{ value: preferences.minFeelsLikeF, label: `your floor ${temp(preferences.minFeelsLikeF)}`, tone: "caution" as const }] : [])]
    : metric === "gust" ? [{ value: preferences.maxWindGustMph, label: `your limit ${wind(preferences.maxWindGustMph)}`, tone: "caution" }]
      : [{ value: preferences.maxPrecipChance, label: `your limit ${preferences.maxPrecipChance}%`, tone: "caution" }];
  const tints = summaries.map((p, i) => (arrivals[i] === null ? null
    : skyAt(arrivals[i] as number, sunrise, sunset, p.weather.description, p.weather.precipChance).horizon));
  const labels = arrivals.map((minutes) => compactClock(minutes, preferences.timeStyle));

  return (
    <div className="sky-route-weather">
      <div className="sky-segmented" role="group" aria-label="Route weather metric">
        {(Object.keys(METRIC_LABELS) as RouteMetric[]).map((key) => (
          <button key={key} type="button" aria-pressed={metric === key} onClick={() => setMetric(key)}>
            {METRIC_LABELS[key]}
          </button>
        ))}
      </div>
      {values.some((v) => v !== null) ? (
        <HourChart labels={labels} values={values} tones={tones} tints={tints} guides={guides}
          format={compact} describe={describe} selected={selected} onSelect={onSelect}
          kind={metric === "precipChance" ? "bars" : "line"}
          palette={isTemp ? "temperature" : metric === "precipChance" ? "cold" : "neutral"}
          coldBelow={isTemp ? 32 : undefined} domain={metric === "precipChance" ? [0, 100] : undefined}
          height={220}
          label={`${METRIC_LABELS[metric]} at each checkpoint's arrival. Use the arrow keys to move between checkpoints.`} />
      ) : (
        <p className="sky-empty">No {METRIC_LABELS[metric].toLowerCase()} forecast is available at the checkpoints.</p>
      )}
    </div>
  );
}
