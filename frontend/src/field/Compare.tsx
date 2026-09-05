import { useId, useMemo, useState } from "react";
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
import type { MultiDayTripForecastDay } from "../hooks/useTripForecast";
import "./compare.css";
import ObjectiveShortlist from "./ObjectiveShortlist";

const isNumber = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value);
const percent = (value: number | null) => isNumber(value) ? `${value}%` : "Unavailable";
const hoursLabel = (day: MultiDayTripForecastDay) => day.travelTotalHours > 0
  ? `${day.travelPassHours} of ${day.travelTotalHours} forecast hours within limits`
  : "Hourly forecast unavailable";
const decisionTone = (day: MultiDayTripForecastDay) =>
  day.decisionLevel === "GO" ? "go" : day.decisionLevel === "NO-GO" ? "blocked" : "caution";

export default function Compare({ workspace: w }: { workspace: Workspace }) {
  const [mode, setMode] = useState<'days' | 'objectives'>(() => {
    try { return localStorage.getItem('summitsafe:comparison-mode') === 'objectives' ? 'objectives' : 'days'; }
    catch { return 'days'; }
  });
  function chooseMode(next: 'days' | 'objectives') {
    setMode(next);
    try { localStorage.setItem('summitsafe:comparison-mode', next); } catch { /* Mode still works without storage. */ }
  }
  return <>
    <div className="shortlist-mode" role="group" aria-label="Comparison mode">
      <button className="field-button" aria-pressed={mode === 'days'} onClick={() => chooseMode('days')}>Compare days</button>
      <button className="field-button" aria-pressed={mode === 'objectives'} onClick={() => chooseMode('objectives')}>Compare objectives</button>
    </div>
    {mode === 'days' ? <CompareDays workspace={w} /> : <>
      <header className="field-page-heading"><span className="field-kicker">Objective comparison</span><h1>Where should you go?</h1><p>Compare your shortlist, find the tradeoffs, and keep a backup plan.</p></header>
      <ObjectiveShortlist workspace={w} />
    </>}
  </>;
}

function CompareDays({ workspace: w }: { workspace: Workspace }) {
  const [selectedDate, setSelectedDate] = useState("");
  const tableId = useId();
  const [showMeasurements, setShowMeasurements] = useState(false);
  const days = useMemo(
    () => w.tripForecastLoading ? [] : w.tripForecastRows,
    [w.tripForecastLoading, w.tripForecastRows],
  );
  const priority = { GO: 2, CAUTION: 1, "NO-GO": 0 };
  const ordered = [...days].sort(
    (a, b) =>
      priority[b.decisionLevel] - priority[a.decisionLevel] ||
      (b.score ?? -Infinity) - (a.score ?? -Infinity),
  );
  const best = ordered[0];
  const topRankCount = days.filter((day) => day.decisionLevel === best?.decisionLevel && day.score === best?.score).length;
  const selected = days.find((day) => day.date === selectedDate) || best;
  const [copyStatus, setCopyStatus] = useState("");
  const extremes = [
    {
      label: "Calmest day",
      metric: (d: MultiDayTripForecastDay) => isNumber(d.windGustMph) ? -d.windGustMph : null,
      format: (d: MultiDayTripForecastDay) => `${w.formatWindDisplay(d.windGustMph)} gust at departure`,
    },
    {
      label: "Lowest rain / snow chance",
      metric: (d: MultiDayTripForecastDay) => isNumber(d.precipChance) ? -d.precipChance : null,
      format: (d: MultiDayTripForecastDay) => `${percent(d.precipChance)} at departure`,
    },
    {
      label: "Most hours within limits",
      metric: (d: MultiDayTripForecastDay) => d.travelTotalHours > 0 ? d.travelPassHours : null,
      format: (d: MultiDayTripForecastDay) => `${d.travelPassHours} hours within limits`,
    },
  ].map((item) => {
    const measured = days.filter((day) => item.metric(day) !== null);
    const maximum = Math.max(...measured.map((day) => item.metric(day)!));
    return { ...item, days: measured.filter((day) => item.metric(day) === maximum) };
  });
  const amount = (value: number | null, snow = false) =>
    !isNumber(value)
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
          `${day.date}: ${day.decisionLevel}, ${isNumber(day.score) ? `${day.score}/100` : "score unavailable"}. ${day.decisionHeadline} ${day.weatherDescription}. Departure gust ${w.formatWindDisplay(day.windGustMph)}; rain / snow chance ${percent(day.precipChance)}; ${hoursLabel(day)}. ${day.partialData ? "Partial data. " : ""}Forecast issued: ${ageLabel(day.sourceIssuedTime)}.`,
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
            <div className="field-empty-state field-compare-intro">
              <h2>Choose the days to compare</h2>
              <p>Select a location and a start date. Each day uses the same departure time and trip duration.</p>
              <dl className="field-compare-features">
                <div><dt>Weather</dt><dd>Wind, rain, and temperature across 2–7 days</dd></div>
                <div><dt>Timing</dt><dd>Hours within your limits and available daylight</dd></div>
                <div><dt>Sources</dt><dd>Forecast freshness, confidence, and missing data</dd></div>
              </dl>
            </div>
          ) : (
            <>
              {best && (
                <section className={`field-panel compare-recommendation is-${decisionTone(best)}`}>
                  <div className="field-panel-heading">
                    <div>
                      <span className="field-kicker">
                        {best.decisionLevel === "NO-GO"
                          ? "Least unfavorable window · still blocked"
                          : "Most favorable weather window"}
                      </span>
                      <h2>{dateLabel(best.date)}</h2>
                    </div>
                    <span className={`compare-decision is-${decisionTone(best)}`}>{best.decisionLevel}</span>
                  </div>
                  <p>{best.decisionHeadline}</p>
                  {topRankCount > 1 && <p className="compare-context">{topRankCount} days share this rank. Compare their weather and coverage below.</p>}
                  <p className="compare-context">
                    {days.length} days at {w.objectiveName || "the selected objective"} · {w.tripStartTime} daily departure · {w.travelWindowHours} hours<br />
                    {w.objectiveTimezone || "Objective local time"}
                  </p>
                  <p className="compare-method">
                    Ranked by weather decision, then score. Avalanche conditions are excluded from this comparison; review the full report before choosing a day.
                    {best.partialData && " The leading day has partial data."}
                    {!isNumber(best.score) && " Its score is unavailable."}
                  </p>
                  <button className="field-button" onClick={() => {
                    setSelectedDate(best.date);
                    document.getElementById(`${tableId}-detail`)?.scrollIntoView({ block: "start" });
                  }}>
                    Review this window <ArrowRight size={15} aria-hidden="true" />
                  </button>
                </section>
              )}
              <div className="compare-highlights" aria-label="Weather tradeoffs" role="group">
                {extremes.map((item) => (
                  <div key={item.label}>
                    <span className="field-kicker">{item.label}</span>
                    {item.days.length === 0 ? <p>Unavailable</p> : (
                      <>
                        <p>{item.days.length === days.length && days.length > 1 ? "All days tied" : item.days.length > 1 ? `${item.days.length} days tied` : dateLabel(item.days[0].date)}</p>
                        <small>{item.format(item.days[0])}</small>
                        {item.days.length < days.length && <div className="compare-highlight-days">
                          {item.days.map((day) => (
                            <button key={day.date} aria-pressed={selected?.date === day.date} onClick={() => setSelectedDate(day.date)}>
                              {dateLabel(day.date)}{day.decisionLevel === "NO-GO" ? " · blocked" : day.decisionLevel === "CAUTION" ? " · caution" : ""}
                            </button>
                          ))}
                        </div>}
                      </>
                    )}
                  </div>
                ))}
              </div>
              <section className="compare-overview" aria-labelledby={`${tableId}-heading`}>
                <div className="field-panel-heading">
                  <div>
                    <h2 id={`${tableId}-heading`}>Every day, side by side</h2>
                    <p>Select a date to explore its hourly forecast. Scroll across to see more days.</p>
                  </div>
                  <button className="field-button" aria-expanded={showMeasurements} aria-controls={`${tableId}-extra`} onClick={() => setShowMeasurements(!showMeasurements)}>
                    {showMeasurements ? "Fewer measurements" : "More measurements"}
                  </button>
                </div>
                <p className="compare-table-note">{w.tripStartTime} departure each day · {w.travelWindowHours}-hour plan. Wind and precipitation chance are departure readings; hours within limits assess the available travel window.</p>
                <div className="compare-table-scroll" role="region" aria-label="Daily forecast comparison" tabIndex={0}>
                  <table className="compare-table">
                    <caption>Daily weather and travel-window comparison</caption>
                    <thead>
                      <tr>
                        <th scope="col">Forecast</th>
                        {days.map((day) => (
                          <th scope="col" key={day.date} className={selected?.date === day.date ? "is-selected" : undefined}>
                            <button aria-pressed={selected?.date === day.date} aria-controls={`${tableId}-detail`} onClick={() => setSelectedDate(day.date)}>
                              <span>{dateLabel(day.date)}</span>
                              <span className={`compare-decision is-${decisionTone(day)}`}>{day.decisionLevel}</span>
                              <strong>{isNumber(day.score) ? day.score : "—"}<small>{isNumber(day.score) ? "/100" : "Score unavailable"}</small></strong>
                              <span className="compare-selection">{selected?.date === day.date ? "Viewing this day" : "View day"}</span>
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: "Conditions", value: (d: MultiDayTripForecastDay) => d.weatherDescription || "Unavailable" },
                        { label: "Low / high", value: (d: MultiDayTripForecastDay) => `${w.formatTempDisplay(d.tempLowF)} / ${w.formatTempDisplay(d.tempHighF)}` },
                        { label: "Departure gust", value: (d: MultiDayTripForecastDay) => isNumber(d.windGustMph) ? w.formatWindDisplay(d.windGustMph) : "Unavailable" },
                        { label: "Rain / snow chance", value: (d: MultiDayTripForecastDay) => percent(d.precipChance) },
                      ].map((metric) => (
                        <tr key={metric.label}><th scope="row">{metric.label}</th>{days.map((day) => <td key={day.date} className={selected?.date === day.date ? "is-selected" : undefined}>{metric.value(day)}</td>)}</tr>
                      ))}
                      <tr>
                        <th scope="row">Hours within limits</th>
                        {days.map((day) => (
                          <td key={day.date} className={selected?.date === day.date ? "is-selected" : undefined}>
                            {day.travelTotalHours > 0 ? <>
                              <strong>{day.travelPassHours} / {day.travelTotalHours} hours</strong>
                              <span className="compare-hours-track" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, day.travelPassHours / Math.max(day.travelTotalHours, w.travelWindowHours) * 100))}%` }} /></span>
                              {day.travelTotalHours < w.travelWindowHours && <small className="compare-data-warning">Only {day.travelTotalHours} of {w.travelWindowHours} planned hours covered</small>}
                            </> : "Unavailable"}
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <th scope="row">Forecast evidence</th>
                        {days.map((day) => (
                          <td key={day.date} className={selected?.date === day.date ? "is-selected" : undefined}>
                            <span className={day.partialData ? "compare-data-warning" : undefined}>{day.partialData ? "Partial data" : "Forecast available"}</span>
                            <small>Issued {ageLabel(day.sourceIssuedTime)}</small>
                            {day.apiWarning && <small className="compare-data-warning">Source warning · review this day</small>}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                    <tbody id={`${tableId}-extra`} hidden={!showMeasurements}>
                      {[
                        { label: "Expected rain", value: (d: MultiDayTripForecastDay) => amount(d.expectedRainIn) },
                        { label: "Expected snow", value: (d: MultiDayTripForecastDay) => amount(d.expectedSnowIn, true) },
                        { label: "Cloud cover", value: (d: MultiDayTripForecastDay) => percent(d.cloudCoverPct) },
                        { label: "Visibility risk", value: (d: MultiDayTripForecastDay) => d.visibilityLevel || "Unavailable" },
                        { label: "Air quality", value: (d: MultiDayTripForecastDay) => isNumber(d.airQualityAqi) ? `${d.airQualityAqi} AQI` : "Unavailable" },
                        { label: "Active alerts", value: (d: MultiDayTripForecastDay) => String(d.alertCount) },
                        { label: "Sunrise / sunset", value: (d: MultiDayTripForecastDay) => `${d.sunrise || "—"} / ${d.sunset || "—"}` },
                      ].map((metric) => (
                        <tr key={metric.label}><th scope="row">{metric.label}</th>{days.map((day) => <td key={day.date} className={selected?.date === day.date ? "is-selected" : undefined}>{metric.value(day)}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="compare-export field-action-row">
                  <button className="field-button" onClick={() => void copyBrief()}>Copy trip brief</button>
                  <button className="field-button" onClick={() => window.print()}>Print comparison</button>
                  {copyStatus && <p role="status">{copyStatus}</p>}
                </div>
              </section>
              {selected && (
                <article className="field-panel compare-selected-detail" id={`${tableId}-detail`}>
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
                  <p>{hoursLabel(selected)}</p>
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
                      Change from previous available day: score{" "}
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
        <Chat key={payload} reportPayload={payload} contextType="trip" contextLabel={`${w.objectiveName || "Selected objective"} · ${days.length} days`} />
      )}
    </section>
  );
}
