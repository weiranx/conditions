import { ArrowRight, Clock3 } from "lucide-react";
import type { Workspace } from "./model/useWorkspace";
import { DaylightChart } from "./DaylightChart";
import { Thresholds } from "./Settings";
import { resolveReportFeatureFlags } from "../contexts/feature-flags";

export function Timing({ workspace: w }: { workspace: Workspace }) {
  const comparison = w.startTimeScenarios.comparison;
  const flags = resolveReportFeatureFlags(w.safetyData?.featureFlags);
  return (
    <section>
      <div className="field-chapter-heading">
        <h2>Timing and planning limits</h2>
        <p>
          Compare departures, check daylight, and see when conditions cross your
          thresholds.
        </p>
      </div>
      {flags.daylightTimeline && (
        <section className="field-panel report-daylight-panel">
          <h3>
            <Clock3 size={17} /> Your day outside
          </h3>
          <DaylightChart
            start={w.alpineStartTime}
            hours={w.travelWindowHours}
            sunrise={w.safetyData?.solar?.sunrise}
            sunset={w.safetyData?.solar?.sunset}
          />
          <dl className="field-detail-grid">
            <div>
              <dt>Start / return</dt>
              <dd>
                {w.displayStartTime} –{" "}
                {w.formatClockForStyle(
                  w.returnTimeDisplay,
                  w.preferences.timeStyle,
                )}
                {w.returnExtendsPastMidnight && " (+1 day)"}
              </dd>
            </div>
            <div>
              <dt>Daylight remaining at start</dt>
              <dd>{w.daylightRemainingFromStartLabel}</dd>
            </div>
            <div>
              <dt>Sunrise</dt>
              <dd>{w.safetyData?.solar?.sunrise || "Unavailable"}</dd>
            </div>
            <div>
              <dt>Sunset</dt>
              <dd>{w.safetyData?.solar?.sunset || "Unavailable"}</dd>
            </div>
          </dl>
        </section>
      )}
      {flags.startTimeComparisons && (
        <section className="field-panel">
          <div className="field-panel-heading">
            <div>
              <h2>Compare departure times</h2>
              <p className="field-muted">
                {comparison?.recommendationReason ||
                  "Compare wind, weather, and daylight at different starts."}
              </p>
            </div>
            {w.startTimeScenarios.canGenerateMore &&
              !w.viewingHistoryReport && (
                <button
                  className="field-button"
                  disabled={w.startTimeScenarios.loading}
                  onClick={w.startTimeScenarios.generateMore}
                >
                  More departures
                </button>
              )}
          </div>
          {w.startTimeScenarios.loading && (
            <p role="status">Checking departure windows…</p>
          )}
          {w.startTimeScenarios.error && (
            <p className="field-warning" role="alert">
              {w.startTimeScenarios.error}
            </p>
          )}
          {comparison ? (
            <>
              <p className="field-feedback">
                {comparison.effectivelyTied
                  ? "Best margin among tied scores"
                  : "Recommended departure"}
                :{" "}
                {w.formatClockForStyle(
                  comparison.bestStartTime,
                  w.preferences.timeStyle,
                )}{" "}
                · Main difference: {comparison.drivingRisk}
              </p>
              <div className="departure-cards">
                {comparison.scenarios.map((scenario) => (
                  <article
                    key={scenario.startTime}
                    className={`departure-card ${scenario.startTime === comparison.bestStartTime ? "is-best" : ""}`}
                  >
                    <span className="field-kicker">
                      {scenario.startTime === comparison.bestStartTime
                        ? "Best margin"
                        : "Departure"}
                    </span>
                    <strong>
                      {w.formatClockForStyle(
                        scenario.startTime,
                        w.preferences.timeStyle,
                      )}
                    </strong>
                    <span
                      className={`field-badge ${scenario.decision.level === "GO" ? "is-go" : scenario.decision.level === "NO-GO" ? "is-stop" : "is-watch"}`}
                    >
                      {scenario.decision.level}
                    </span>
                    <dl>
                      <div>
                        <dt>Peak gust</dt>
                        <dd>{w.formatWindDisplay(scenario.peakGustMph)}</dd>
                      </div>
                      <div>
                        <dt>Rain chance</dt>
                        <dd>{scenario.peakPrecipChance}%</dd>
                      </div>
                      <div>
                        <dt>Return</dt>
                        <dd>
                          {w.formatClockForStyle(
                            scenario.returnTime,
                            w.preferences.timeStyle,
                          )}
                          {scenario.returnDayOffset > 0 ? " +1 day" : ""}
                        </dd>
                      </div>
                    </dl>
                    <button
                      className="field-button"
                      disabled={w.startTimeScenarios.loading || w.viewingHistoryReport || scenario.startTime === w.alpineStartTime}
                      onClick={() => {
                        if (w.handleEditPlan())
                          w.setAlpineStartTime(scenario.startTime);
                      }}
                    >
                      Use start
                      <ArrowRight size={13} />
                    </button>
                  </article>
                ))}
              </div>
              <details className="field-detail-disclosure">
                <summary>Compare all departure measurements</summary>
                <div className="field-table-scroll">
                  <table className="field-data-table">
                    <thead>
                      <tr>
                        <th>Departure</th>
                        <th>Decision</th>
                        <th>Gust / feels like</th>
                        <th>Rain chance</th>
                        <th>Summit / return</th>
                        <th>Daylight at return</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.scenarios.map((scenario) => (
                        <tr key={scenario.startTime}>
                          <th>
                            {w.formatClockForStyle(
                              scenario.startTime,
                              w.preferences.timeStyle,
                            )}
                            {scenario.startTime ===
                              comparison.bestStartTime && (
                              <small>Best margin</small>
                            )}
                          </th>
                          <td>
                            {scenario.decision.level}
                            <small>{Math.round(scenario.score)}/100</small>
                          </td>
                          <td>
                            {w.formatWindDisplay(scenario.peakGustMph)}
                            <small>
                              {w.formatTempDisplay(scenario.peakFeelsLikeF)}
                            </small>
                          </td>
                          <td>
                            {scenario.peakPrecipChance}%
                            <small>
                              {scenario.stormHours} storm hours ·{" "}
                              {scenario.avalancheLabel}
                            </small>
                          </td>
                          <td>
                            {w.formatClockForStyle(
                              scenario.summitTime,
                              w.preferences.timeStyle,
                            )}{" "}
                            /{" "}
                            {w.formatClockForStyle(
                              scenario.returnTime,
                              w.preferences.timeStyle,
                            )}
                            {scenario.returnDayOffset > 0 && " +1 day"}
                          </td>
                          <td>
                            {scenario.daylightRemainingMinutes === null
                              ? "Unknown"
                              : `${Math.abs(scenario.daylightRemainingMinutes)} min ${scenario.daylightRemainingMinutes < 0 ? "after sunset" : "remaining"}`}
                          </td>
                          <td>
                            <button
                              className="field-text-button"
                              disabled={
                                w.startTimeScenarios.loading || w.viewingHistoryReport || scenario.startTime === w.alpineStartTime
                              }
                              onClick={() => {
                                if (w.handleEditPlan())
                                  w.setAlpineStartTime(scenario.startTime);
                              }}
                            >
                              Use start
                              <ArrowRight size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          ) : (
            !w.startTimeScenarios.loading && (
              <p className="field-muted">
                Departure comparisons are unavailable for this saved or undated
                report. Create a new report to compare current forecasts.
              </p>
            )
          )}
        </section>
      )}
      <details className="field-panel report-threshold-disclosure">
        <summary>Adjust weather thresholds</summary>
        <Thresholds workspace={w} />
      </details>
      <section className="field-panel">
        <h2>Window assessment</h2>
        <p>{w.travelWindowSummary}</p>
        {w.peakCriticalWindow && (
          <p className="field-feedback">
            Highest critical weather signal:{" "}
            {w.formatClockForStyle(
              w.peakCriticalWindow.time,
              w.preferences.timeStyle,
            )}{" "}
            · {w.peakCriticalWindow.condition}
          </p>
        )}
        <div
          className="report-hour-strip"
          role="list"
          aria-label="Hourly planning limits"
        >
          {w.travelWindowRows.map((row, index) => (
            <div
              role="listitem"
              key={index}
              className={row.pass ? "is-pass" : "is-review"}
            >
              <span>
                {w.formatClockForStyle(row.time, w.preferences.timeStyle)}
              </span>
              <strong>{row.pass ? "✓" : "!"}</strong>
              <small>{row.pass ? "Within limits" : "Review"}</small>
            </div>
          ))}
        </div>
        <details className="field-detail-disclosure">
          <summary>Hourly measurements and reasons</summary>
          <div className="field-table-scroll">
            <table className="field-data-table">
              <thead>
                <tr>
                  <th>Hour</th>
                  <th>Feels like</th>
                  <th>Gust</th>
                  <th>Precipitation</th>
                  <th>Assessment</th>
                </tr>
              </thead>
              <tbody>
                {w.travelWindowRows.map((row, i) => (
                  <tr key={i}>
                    <th>
                      {w.formatClockForStyle(row.time, w.preferences.timeStyle)}
                    </th>
                    <td>{w.formatTempDisplay(row.feelsLike)}</td>
                    <td>{w.formatWindDisplay(row.gust)}</td>
                    <td>{row.precipChance}%</td>
                    <td>
                      {row.pass ? "Within limits" : "Review"}
                      <small>{row.reasonSummary}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </section>
  );
}
