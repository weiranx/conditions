import { ArrowUpRight, Clock3, Droplets, Mountain, Wind } from "lucide-react";
import type { Workspace } from "./model/useWorkspace";
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
  const peakGust = gusts.length ? Math.max(...gusts) : data.weather.windGust;
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
        <button onClick={() => onOpen("timing")}>
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
            {flags.daylightTimeline
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
    </section>
  );
}
