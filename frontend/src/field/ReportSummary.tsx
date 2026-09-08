import { ArrowUpRight, Clock3, Droplets, Mountain, Wind } from "lucide-react";
import type { Workspace } from "./model/useWorkspace";
import { buildPlannedReportWeatherRows } from "./report-weather";
import { resolveReportFeatureFlags } from "../contexts/feature-flags";

export function ReportSummary({
  workspace: w,
  onOpen,
}: {
  workspace: Workspace;
  onOpen: (section: "forecast" | "timing" | "terrain") => void;
}) {
  const data = w.safetyData!;
  const flags = resolveReportFeatureFlags(data.featureFlags);
  const gusts = (data.weather.trend || [])
    .slice(0, w.travelWindowHours)
    .map((hour) => hour.gust)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const knownGusts = [...gusts, data.weather.windGust].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const peakGust = knownGusts.length ? Math.max(...knownGusts) : null;
  const returnAfterSunset = flags.daylightTimeline && w.returnMinutes != null && w.sunsetMinutesForPlan != null
    && w.returnMinutes > w.sunsetMinutesForPlan;
  const hours = buildPlannedReportWeatherRows(data, w.preferences, w.travelWindowHours, { start: w.alpineStartTime, date: w.forecastDate });
  const completeHours = hours.filter((hour) => hour.complete);
  const withinLimits = completeHours.filter((hour) => hour.pass).length;
  const coverageMissing = completeHours.length < w.travelWindowHours;
  const firstConcern = hours.find((hour) => !hour.pass);
  const windowNote = coverageMissing ? `${completeHours.length} of ${w.travelWindowHours} hours have complete weather readings.`
    : firstConcern ? `First threshold concern at ${w.formatClockForStyle(firstConcern.time, w.preferences.timeStyle)}: ${firstConcern.reasonSummary}`
    : "Hourly thresholds only. Daylight, source freshness, and field warnings still apply.";
  const surface =
    data.terrainCondition?.label?.replace(
      /^[\p{Extended_Pictographic}\uFE0F\s]+/u,
      "",
    ) || "Unavailable";
  return (
    <section className="report-plan-summary" aria-label="Plan at a glance">
      <header>
        <h2>Plan at a glance</h2>
        <span>{w.travelWindowHours} hours outside</span>
      </header>
      <div className="report-summary-grid">
        <button onClick={() => onOpen("forecast")}>
          <span className="report-summary-label">
            <Wind size={17} />
            Peak gust
          </span>
          <strong>{w.formatWindDisplay(peakGust)}</strong>
          <span>
            Across the forecast window
            <ArrowUpRight size={14} />
          </span>
        </button>
        <button onClick={() => onOpen("forecast")}>
          <span className="report-summary-label">
            <Droplets size={17} />
            Expected rain
          </span>
          <strong>{w.expectedRainWindowDisplay}</strong>
          <span>
            {w.expectedTravelWindowHours}-hour accumulation
            <ArrowUpRight size={14} />
          </span>
        </button>
        <button className={returnAfterSunset ? "report-summary-attention" : undefined} onClick={() => onOpen("timing")}>
          <span className="report-summary-label">
            <Clock3 size={17} />
            Planned return
          </span>
          <strong>
            {w.formatClockForStyle(
              w.returnTimeDisplay,
              w.preferences.timeStyle,
            )}
            {w.returnExtendsPastMidnight ? " +1 day" : ""}
          </strong>
          <span>
            {returnAfterSunset ? "Return is after sunset" : flags.daylightTimeline
              ? `Sunset ${data.solar?.sunset ? w.formatClockForStyle(data.solar.sunset, w.preferences.timeStyle) : "unavailable"}`
              : `Depart ${w.displayStartTime}`}
            <ArrowUpRight size={14} />
          </span>
        </button>
        <button onClick={() => onOpen("terrain")}>
          <span className="report-summary-label">
            <Mountain size={17} />
            Trail surface
          </span>
          <strong className="report-summary-surface">{surface}</strong>
          <span>
            Terrain and snow assessment
            <ArrowUpRight size={14} />
          </span>
        </button>
      </div>
      <button className={`report-window-summary${coverageMissing || withinLimits < hours.length ? " needs-review" : ""}`} onClick={() => onOpen("timing")}>
        <span className="report-summary-label"><Clock3 size={17} aria-hidden="true" /> Travel window <ArrowUpRight size={14} aria-hidden="true" /></span>
        <strong>{(data.weather.trend || []).length ? `${withinLimits} of ${w.travelWindowHours} hours within limits` : "Hourly evidence unavailable"}</strong>
        <span className="report-window-segments" aria-hidden="true">
          {Array.from({ length: w.travelWindowHours }, (_, index) => {
            const hour = hours[index];
            const complete = hour?.complete;
            return <i key={index} className={!complete ? "is-missing" : hour.pass ? "is-pass" : "is-review"} />;
          })}
        </span>
        <span className="report-window-note">{windowNote}</span>
      </button>
    </section>
  );
}
