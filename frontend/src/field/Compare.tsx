import { useEffect, useId, useMemo, useRef, useState } from "react";
import { copyTextToClipboard } from "../app/clipboard";
import { Details } from "./Details";
import { ArrowRight, Check, Sunrise, TriangleAlert } from "lucide-react";
import type { Workspace } from "./model/useWorkspace";
import { WorkspacePlan } from "./WorkspacePlan";
import { Forecast } from "./Forecast";
import { buildPersistedReport } from "../app/report-storage";
import { emptyAi, dateLabel, ageLabel, sentenceCase } from "./data";
import { Chat } from "./Chat";
import { useAiAvailability } from "../hooks/useAiAvailability";
import type { MultiDayTripForecastDay } from "../hooks/useTripForecast";
import "./compare.css";
import "./sky/sky.css";
import "./sky/parts.css";
import "./sky/chapters.css";
import { DayStrip } from "./sky/DayStrip";
import { buildSkyHours } from "./sky/sky-model";
import { buildPlannedReportWeatherRows } from "./report-weather";
import { formatClockForStyle, minutesToTwentyFourHourClock, parseSolarClockMinutes } from "../app/core";
import ObjectiveShortlist from "./ObjectiveShortlist";
import { revealStart } from "./page-scroll";

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
  const results = useRef<HTMLDivElement>(null);
  const wasLoading = useRef(w.tripForecastLoading);
  useEffect(() => {
    const started = w.tripForecastLoading && !wasLoading.current;
    wasLoading.current = w.tripForecastLoading;
    // In one column the results sit below the form: follow the comparison just started.
    if (started) revealStart(results.current);
  }, [w.tripForecastLoading]);
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
  const dayHours = (day: MultiDayTripForecastDay) => buildSkyHours(
    buildPlannedReportWeatherRows(day.safetyData, w.preferences, w.travelWindowHours, { start: w.tripStartTime, date: day.date }),
    {
      start: w.tripStartTime,
      sunriseMinutes: parseSolarClockMinutes(day.safetyData.solar?.sunrise),
      sunsetMinutes: parseSolarClockMinutes(day.safetyData.solar?.sunset),
    },
  );
  const clock = (minute: number) =>
    formatClockForStyle(minutesToTwentyFourHourClock(((minute % 1440) + 1440) % 1440), w.preferences.timeStyle);
  const pick = (date: string) => {
    setSelectedDate(date);
    document.getElementById(`${tableId}-detail`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  return (
    <section className="field-comparison sky-compare">
      <header className="field-page-heading">
        <span className="field-kicker">Forecast comparison</span>
        <h1>Compare days</h1>
        <p>
          The same objective, start and trip length, day by day.
        </p>
      </header>
      <div className="field-compare-layout">
        <WorkspacePlan workspace={w} comparison />
        <div className="sky-compare-results" ref={results}>
          {w.tripForecastError && (
            <p className="sky-notice is-caution" role="alert">
              {w.tripForecastError}
            </p>
          )}
          {w.tripForecastNote && (
            <p className="sky-notice is-info" role="status">
              {w.tripForecastNote}
            </p>
          )}
          {w.tripForecastLoading ? (
            <div className="sky-card sky-compare-empty" role="status">
              <Sunrise size={28} aria-hidden="true" />
              <h2>Comparing forecasts</h2>
              <p>Checking each day for the same objective and travel window.</p>
            </div>
          ) : !days.length ? (
            <div className="sky-card sky-compare-empty field-compare-intro">
              <h2>Choose the days to compare</h2>
              <p>Pick a location and a first day. Every day uses the same departure time and trip length.</p>
              <dl className="sky-list">
                <div><dt>Weather</dt><dd>Wind, rain and temperature across 2–7 days</dd></div>
                <div><dt>Timing</dt><dd>Hours within your limits and daylight</dd></div>
                <div><dt>Sources</dt><dd>Forecast freshness and missing data</dd></div>
              </dl>
            </div>
          ) : (
            <>
              {best && (
                <section className={`sky-verdict-card compare-recommendation is-${decisionTone(best)}`} aria-labelledby={`${tableId}-best`}>
                  <span className="sky-muted">
                    {best.decisionLevel === "NO-GO"
                      ? "Least unfavorable window · still blocked"
                      : "Most favorable weather window"}
                  </span>
                  <div className="sky-compare-best">
                    <h2 id={`${tableId}-best`}>{dateLabel(best.date)}</h2>
                    <span className={`sky-pill is-${best.decisionLevel === "GO" ? "go" : best.decisionLevel === "NO-GO" ? "stop" : "watch"}`}>
                      {best.decisionLevel === "GO" ? <Check size={16} aria-hidden="true" /> : <TriangleAlert size={16} aria-hidden="true" />}
                      {best.decisionLevel === "GO" ? "Go" : best.decisionLevel === "NO-GO" ? "No-go" : "Caution"}
                    </span>
                  </div>
                  <p className="sky-verdict-reason">{best.decisionHeadline}</p>
                  {topRankCount > 1 && <p className="sky-cap">{topRankCount} days share this rank. Compare their weather and coverage below.</p>}
                  <p className="sky-cap">
                    {days.length} days at {w.objectiveName || "the selected objective"} · {w.tripStartTime} daily departure · {w.travelWindowHours} hours
                    {w.objectiveTimezone ? ` · ${w.objectiveTimezone}` : ""}
                  </p>
                  <p className="sky-cap compare-method">
                    Ranked by weather decision, then score. Avalanche conditions are excluded from this comparison; review the full report before choosing a day.
                    {best.partialData && " The leading day has partial data."}
                    {!isNumber(best.score) && " Its score is unavailable."}
                  </p>
                  <div>
                    <button className="field-button field-button-primary" onClick={() => pick(best.date)}>
                      Review this window <ArrowRight size={15} aria-hidden="true" />
                    </button>
                  </div>
                </section>
              )}

              <section className="sky-section" aria-labelledby={`${tableId}-glance`}>
                <div className="sky-sh">
                  <h2 id={`${tableId}-glance`}>Your days at a glance</h2>
                  <p>Hatched hours cross a limit. Select a day for its detail.</p>
                </div>
                <div className="sky-card sky-days">
                  {days.map((day) => {
                    const hours = dayHours(day);
                    return (
                      <button key={day.date} type="button" className={`sky-day-row${selected?.date === day.date ? " is-selected" : ""}${day === best ? " is-best" : ""}`}
                        aria-pressed={selected?.date === day.date} onClick={() => pick(day.date)}>
                        <span className="sky-day-label">
                          <strong>{dateLabel(day.date)}</strong>
                          <span className={`sky-status is-${day.decisionLevel === "GO" ? "ok" : "over"}`}>
                            {day.decisionLevel === "GO" ? <Check size={13} aria-hidden="true" /> : <TriangleAlert size={13} aria-hidden="true" />}
                            {day.decisionLevel === "GO" ? "Go" : day.decisionLevel === "NO-GO" ? "No-go" : "Caution"}
                          </span>
                        </span>
                        <DayStrip hours={hours} clock={clock} />
                        <span className="sky-day-fact">
                          <strong>{isNumber(day.score) ? day.score : "—"}<small>{isNumber(day.score) ? "/100" : " score"}</small></strong>
                          <small>{day.travelTotalHours > 0 ? `${day.travelPassHours} of ${day.travelTotalHours} h within` : "Hours unavailable"}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <div className="sky-trio sky-section compare-highlights" aria-label="Weather tradeoffs" role="group">
                {extremes.map((item) => (
                  <div className="sky-card" key={item.label}>
                    <span className="sky-card-head"><span>{item.label}</span></span>
                    {item.days.length === 0 ? <span className="sky-big is-small">Unavailable</span> : (
                      <>
                        <span className="sky-big is-small">{item.days.length === days.length && days.length > 1 ? "All days tied" : item.days.length > 1 ? `${item.days.length} days tied` : dateLabel(item.days[0].date)}</span>
                        <p className="sky-cap">{item.format(item.days[0])}</p>
                        {item.days.length < days.length && item.days.length > 1 && <div className="compare-highlight-days">
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

              <section className="sky-section compare-overview" aria-labelledby={`${tableId}-heading`}>
                <div className="sky-sh">
                  <h2 id={`${tableId}-heading`}>Every day, side by side</h2>
                  <button className="sky-link" aria-expanded={showMeasurements} aria-controls={`${tableId}-extra`} onClick={() => setShowMeasurements(!showMeasurements)}>
                    {showMeasurements ? "Fewer measurements" : "More measurements"}
                  </button>
                </div>
                <div className="sky-card sky-table-card">
                  <div className="compare-table-scroll" role="region" aria-label="Daily forecast comparison" tabIndex={0}>
                    <table className="sky-table compare-table">
                      <caption className="sr-only">Daily weather and travel-window comparison</caption>
                      <thead>
                        <tr>
                          <th scope="col"><span className="sr-only">Forecast</span></th>
                          {days.map((day) => (
                            <th scope="col" key={day.date} className={selected?.date === day.date ? "is-selected" : undefined}>
                              <button aria-pressed={selected?.date === day.date} aria-controls={`${tableId}-detail`} onClick={() => setSelectedDate(day.date)}>
                                <span>{dateLabel(day.date)}</span>
                                <span className={`compare-decision is-${decisionTone(day)}`}>{day.decisionLevel}</span>
                                <strong>{isNumber(day.score) ? day.score : "—"}<small>{isNumber(day.score) ? "/100" : "Score unavailable"}</small></strong>
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
                  <p className="sky-cap compare-table-note">{w.tripStartTime} departure each day · {w.travelWindowHours}-hour plan. Wind and precipitation chance are departure readings; hours within limits assess the available travel window.</p>
                </div>
                <div className="compare-export">
                  <button className="field-button" onClick={() => void copyBrief()}>Copy trip brief</button>
                  <button className="field-button" onClick={() => window.print()}>Print comparison</button>
                  {copyStatus && <p role="status" className="sky-cap">{copyStatus}</p>}
                </div>
              </section>

              {selected && (
                <article className="sky-card sky-section compare-selected-detail" id={`${tableId}-detail`} aria-labelledby={`${tableId}-sel`}>
                  <span className="sky-card-head">
                    <span>{dateLabel(selected.date)}</span>
                    <span className={`sky-status is-${selected.decisionLevel === "GO" ? "ok" : "over"}`}>{selected.decisionLevel === "GO" ? "Go" : selected.decisionLevel === "NO-GO" ? "No-go" : "Caution"}</span>
                  </span>
                  <h2 id={`${tableId}-sel`} className="sky-card-lede">{selected.decisionHeadline}</h2>
                  <p className="sky-cap">{hoursLabel(selected)}</p>
                  <dl className="sky-stat-grid">
                    <div><dt>Temperature</dt><dd>{w.formatTempDisplay(selected.tempLowF)} – {w.formatTempDisplay(selected.tempHighF)}</dd></div>
                    <div><dt>Rain / snow expected</dt><dd>{amount(selected.expectedRainIn)} / {amount(selected.expectedSnowIn, true)}</dd></div>
                    <div><dt>Visibility</dt><dd>{selected.visibilityLevel || "Unavailable"}</dd><small>{selected.visibilitySummary}</small></div>
                    <div><dt>Air quality / alerts</dt><dd>{selected.airQualityAqi ?? "—"} AQI · {selected.alertCount} alerts</dd></div>
                    <div><dt>Daylight</dt><dd>{selected.sunrise || "—"} – {selected.sunset || "—"}</dd><small>{selected.dayLength}</small></div>
                    <div><dt>Source freshness</dt><dd>{sentenceCase(ageLabel(selected.sourceIssuedTime))}</dd><small>{selected.partialData ? "Partial data. Verify current sources." : "Forecast evidence available"}</small></div>
                  </dl>
                  {selected.deltas && (
                    <p className="sky-cap">
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
                  {selected.apiWarning && <p className="sky-notice is-caution">{selected.apiWarning}</p>}
                  <div className="sky-card-actions">
                    <button className="field-button field-button-primary" onClick={() => w.handleUseTripDayInPlanner(selected.date, w.tripStartTime)}>
                      Open this day <ArrowRight size={15} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="sky-evidence">
                    <Details title="Daily thresholds, weather, and comparison measurements" value={{ ...selected, safetyData: undefined }} />
                  </div>
                </article>
              )}
            </>
          )}
        </div>
      </div>
      {snapshot && w.featureFlags.hourlyWeatherCharts && (
        <section className="sky-section sky-compare-hourly" aria-label={`Hourly detail for ${dateLabel(selected.date)}`}>
          <h2 className="sky-chapter-name">Hourly detail · {dateLabel(selected.date)}</h2>
          <Forecast key={selected.date} report={snapshot} approach={w.approachProfile} elevation={(ft) => w.formatElevationDisplay(ft)} />
        </section>
      )}
      {days.length > 0 && available.reportChat && (
        <Chat key={payload} reportPayload={payload} contextType="trip" contextLabel={`${w.objectiveName || "Selected objective"} · ${days.length} days`} />
      )}
    </section>
  );
}
