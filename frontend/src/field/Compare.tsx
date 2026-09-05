import { useMemo, useState } from "react";
import { copyTextToClipboard } from "../app/clipboard";
import { Details } from "./Details";
import { ArrowRight, Sunrise } from "lucide-react";
import type { Workspace } from "./model/useWorkspace";
import { WorkspacePlan } from "./WorkspacePlan";
import { Forecast } from "./Forecast";
import { buildPersistedReport } from "../app/report-storage";
import { emptyAi, dateLabel, ageLabel } from "./data";
import { Chat } from "./Chat";
import { useAiAvailability } from "../hooks/useAiAvailability";

export default function Compare({ workspace: w }: { workspace: Workspace }) {
  const [selectedDate, setSelectedDate] = useState("");
  const days = w.tripForecastRows;
  const priority = { GO: 2, CAUTION: 1, "NO-GO": 0 };
  const ordered = [...days].sort(
    (a, b) =>
      priority[b.decisionLevel] - priority[a.decisionLevel] ||
      (b.score ?? -Infinity) - (a.score ?? -Infinity),
  );
  const best = ordered[0];
  const selected = days.find((day) => day.date === selectedDate) || best;
  const [copyStatus, setCopyStatus] = useState("");
  const extremes = [
    {
      label: "Calmest day",
      day: [...days]
        .filter((d) => d.windGustMph !== null)
        .sort((a, b) => a.windGustMph! - b.windGustMph!)[0],
    },
    {
      label: "Driest day",
      day: [...days]
        .filter((d) => d.precipChance !== null)
        .sort((a, b) => a.precipChance! - b.precipChance!)[0],
    },
    {
      label: "Most hours within limits",
      day: [...days]
        .filter((d) => d.travelTotalHours > 0)
        .sort(
          (a, b) =>
            b.travelPassHours / b.travelTotalHours -
            a.travelPassHours / a.travelTotalHours,
        )[0],
    },
    { label: "Watch closely", day: ordered[ordered.length - 1] },
  ];
  const amount = (value: number | null, snow = false) =>
    value === null
      ? "Unavailable"
      : w.preferences.elevationUnit === "m"
        ? `${(value * (snow ? 2.54 : 25.4)).toFixed(1)} ${snow ? "cm" : "mm"}`
        : `${value.toFixed(2)} in`;
  async function copyBrief() {
    const text = [
      w.objectiveName,
      `${w.tripStartDate} · ${w.tripStartTime} daily start · ${w.travelWindowHours} hours`,
      ...days.map(
        (day) =>
          `${day.date}: ${day.decisionLevel}, ${day.score ?? "unavailable"}/100. ${day.decisionHeadline} ${day.weatherDescription}. Gust ${w.formatWindDisplay(day.windGustMph)}; precipitation ${day.precipChance ?? "unavailable"}%; ${day.travelPassHours}/${day.travelTotalHours} hours within thresholds.`,
      ),
      "Weather comparison only. Verify official sources and current avalanche information before departure.",
    ].join("\n");
    setCopyStatus(
      (await copyTextToClipboard(text))
        ? "Trip brief copied."
        : "Could not copy. Use print to save a PDF.",
    );
  }

  const available = useAiAvailability(selected?.safetyData.capabilities);
  const snapshot = selected
    ? buildPersistedReport(
        {
          lat: w.position.lat,
          lon: w.position.lng,
          objectiveName: w.objectiveName,
          searchQuery: w.searchQuery,
          forecastDate: selected.date,
          alpineStartTime: w.tripStartTime,
          travelWindowHours: w.travelWindowHours,
          targetElevationInput: "",
        },
        selected.safetyData,
        emptyAi,
        { preferences: w.preferences },
      )
    : null;
  const payload = useMemo(
    () =>
      JSON.stringify({
        objectiveName: w.objectiveName,
        position: w.position,
        startTime: w.tripStartTime,
        travelWindowHours: w.travelWindowHours,
        preferences: w.preferences,
        days,
      }),
    [
      days,
      w.objectiveName,
      w.position,
      w.preferences,
      w.travelWindowHours,
      w.tripStartTime,
    ],
  );
  return (
    <section className="field-comparison">
      <header className="field-page-heading">
        <span className="field-kicker">Forecast comparison</span>
        <h1>Compare days</h1>
        <p>
          Choose your window with weather, timing, and source confidence side by
          side.
        </p>
      </header>
      <div className="field-compare-layout">
        <WorkspacePlan workspace={w} comparison />
        <div>
          {w.tripForecastError && (
            <p className="field-warning" role="alert">
              {w.tripForecastError}
            </p>
          )}
          {w.tripForecastNote && (
            <p className="field-feedback" role="status">
              {w.tripForecastNote}
            </p>
          )}
          {w.tripForecastLoading ? (
            <div className="field-empty-state" role="status">
              <Sunrise />
              <h2>Comparing forecasts</h2>
              <p>Checking each day for the same objective and travel window.</p>
            </div>
          ) : !days.length ? (
            <div className="field-empty-state">
              <Sunrise size={44} />
              <h2>Find your weather window</h2>
              <p>Set a location and compare two to seven days.</p>
            </div>
          ) : (
            <>
              {best && (
                <section className="field-panel">
                  <span className="field-kicker">
                    {best.decisionLevel === "NO-GO"
                      ? "Least unfavorable window · still blocked"
                      : "Most favorable weather window"}
                  </span>
                  <h2>{dateLabel(best.date)}</h2>
                  <p>{best.decisionHeadline}</p>
                  <button
                    className="field-button"
                    onClick={() => setSelectedDate(best.date)}
                  >
                    Review this window
                  </button>
                  <div className="field-preset-list">
                    {extremes.map(
                      (item) =>
                        item.day && (
                          <button
                            key={item.label}
                            onClick={() => setSelectedDate(item.day.date)}
                          >
                            {item.label} · {dateLabel(item.day.date)}
                          </button>
                        ),
                    )}
                  </div>
                  <div className="field-action-row">
                    <button
                      className="field-button"
                      onClick={() => void copyBrief()}
                    >
                      Copy trip brief
                    </button>
                    <button
                      className="field-button"
                      onClick={() => window.print()}
                    >
                      Print comparison
                    </button>
                  </div>
                  {copyStatus && <p role="status">{copyStatus}</p>}
                </section>
              )}
              <div
                className="field-day-tabs"
                role="group"
                aria-label="Select comparison day"
              >
                {days.map((day) => (
                  <button
                    key={day.date}
                    aria-pressed={selected?.date === day.date}
                    onClick={() => setSelectedDate(day.date)}
                  >
                    <span>{dateLabel(day.date)}</span>
                    <strong>
                      {day.score ?? "—"}
                      <small>/100</small>
                    </strong>
                    <span>{day.decisionLevel}</span>
                    <p>
                      {w.formatTempDisplay(day.tempHighF)} ·{" "}
                      {w.formatWindDisplay(day.windGustMph)} gust
                    </p>
                  </button>
                ))}
              </div>
              {selected && (
                <article className="field-panel">
                  <div className="field-panel-heading">
                    <div>
                      <span className="field-kicker">
                        {dateLabel(selected.date)}
                      </span>
                      <h2>{selected.decisionHeadline}</h2>
                    </div>
                    <button
                      className="field-button"
                      onClick={() =>
                        w.handleUseTripDayInPlanner(
                          selected.date,
                          w.tripStartTime,
                        )
                      }
                    >
                      Open this day <ArrowRight size={15} />
                    </button>
                  </div>
                  <p>{selected.travelSummary}</p>
                  <dl className="field-detail-grid">
                    <div>
                      <dt>Temperature</dt>
                      <dd>
                        {w.formatTempDisplay(selected.tempLowF)} –{" "}
                        {w.formatTempDisplay(selected.tempHighF)}
                      </dd>
                    </div>
                    <div>
                      <dt>Rain / snow expected</dt>
                      <dd>
                        {amount(selected.expectedRainIn)} /{" "}
                        {amount(selected.expectedSnowIn, true)}
                      </dd>
                    </div>
                    <div>
                      <dt>Visibility</dt>
                      <dd>{selected.visibilityLevel || "Unavailable"}</dd>
                      <small>{selected.visibilitySummary}</small>
                    </div>
                    <div>
                      <dt>Air quality / alerts</dt>
                      <dd>
                        {selected.airQualityAqi ?? "—"} AQI ·{" "}
                        {selected.alertCount} alerts
                      </dd>
                    </div>
                    <div>
                      <dt>Daylight</dt>
                      <dd>
                        {selected.sunrise || "—"} – {selected.sunset || "—"}
                      </dd>
                      <small>{selected.dayLength}</small>
                    </div>
                    <div>
                      <dt>Source freshness</dt>
                      <dd>{ageLabel(selected.sourceIssuedTime)}</dd>
                      <small>
                        {selected.partialData
                          ? "Partial data. Verify current sources."
                          : "Forecast evidence available"}
                      </small>
                    </div>
                  </dl>
                  {selected.deltas && (
                    <p className="field-muted">
                      Change from prior day: score{" "}
                      {selected.deltas.score === null
                        ? "unavailable"
                        : `${selected.deltas.score > 0 ? "+" : ""}${selected.deltas.score}`}{" "}
                      · Precipitation{" "}
                      {selected.deltas.precipChance === null
                        ? "unavailable"
                        : `${selected.deltas.precipChance > 0 ? "+" : ""}${selected.deltas.precipChance} percentage points`}
                    </p>
                  )}
                  <Details
                    title="Daily thresholds, weather, and comparison measurements"
                    value={{ ...selected, safetyData: undefined }}
                  />
                  {selected.apiWarning && (
                    <p className="field-warning">{selected.apiWarning}</p>
                  )}
                </article>
              )}
            </>
          )}
        </div>
      </div>
      {snapshot && w.featureFlags.hourlyWeatherCharts && (
        <section>
          <h2 className="field-subtitle">
            Hourly detail · {dateLabel(selected.date)}
          </h2>
          <Forecast key={selected.date} report={snapshot} />
        </section>
      )}
      {days.length > 0 && available.reportChat && (
        <Chat key={payload} reportPayload={payload} contextType="trip" />
      )}
    </section>
  );
}
