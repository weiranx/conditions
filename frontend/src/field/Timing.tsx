import { ArrowRight } from "lucide-react";
import type { Workspace } from "./model/useWorkspace";
import { DaylightChart } from "./DaylightChart";
import { ContingencyCard } from "./ContingencyCard";
import { Thresholds } from "./Thresholds";
import { resolveReportFeatureFlags } from "../contexts/feature-flags";
import { minutesToTwentyFourHourClock, parseHourLabelToMinutes, parseTimeInputMinutes } from "../app/core";
import { buildPlannedReportWeatherRows } from "./report-weather";
import { buildSkyHours, isOverHour, type SkyHour } from "./sky/sky-model";
import { StartTimeline, type TimelineRow } from "./sky/StartTimeline";
import { durationLabel } from "./sky/status";
import { summarizeApproachHours, type ApproachSummary } from "../app/approach-elevation";
import { decisionLevelRank } from "../app/decision";

const LEVEL: Record<string, string> = { GO: "Go", CAUTION: "Caution", "NO-GO": "No-go" };

const duration = durationLabel;

export function Timing({ workspace: w, hours }: { workspace: Workspace; hours: SkyHour[] }) {
  const comparison = w.startTimeScenarios.comparison;
  const flags = resolveReportFeatureFlags(w.safetyData?.featureFlags);
  const sunrise = w.sunriseMinutesForPlan;
  const sunset = w.sunsetMinutesForPlan;
  const clock = (minute: number) =>
    w.formatClockForStyle(minutesToTwentyFourHourClock(((minute % 1440) + 1440) % 1440), w.preferences.timeStyle);
  const clockText = (value: string) => w.formatClockForStyle(value, w.preferences.timeStyle);
  const approachRange = ({ lowFt, highFt }: ApproachSummary) => {
    const low = Math.round(lowFt / 100) * 100;
    const high = Math.round(highFt / 100) * 100;
    return low === high ? `~${w.formatElevationDisplay(low)}` : `~${w.formatElevationDisplay(low)}–${w.formatElevationDisplay(high)}`;
  };
  const applyStart = (startTime: string) => {
    if (w.handleEditPlan()) w.setAlpineStartTime(startTime);
  };

  // Each departure drawn from its own forecast, not the planned one shifted in time.
  const rowFor = (startTime: string, rowHours: SkyHour[], opts: {
    daylight: number | null; decision?: string; best?: boolean; current?: boolean; key?: string;
  }): TimelineRow => {
    const start = parseTimeInputMinutes(startTime) ?? 0;
    const over = rowHours.filter(isOverHour).length;
    const missing = rowHours.filter((h) => h.tone === "missing").length;
    const dark = rowHours.filter((h) => h.night).length;
    const approach = summarizeApproachHours(rowHours);
    const daylightText = opts.daylight === null ? "daylight at return unknown"
      : opts.daylight < 0 ? `back ${duration(-opts.daylight)} after sunset` : `back ${duration(opts.daylight)} before sunset`;
    return {
      key: opts.key || startTime,
      label: clockText(startTime),
      sub: [opts.current ? "your plan" : null, opts.best ? "suggested" : null].filter(Boolean).join(" · ") || undefined,
      start,
      hours: rowHours,
      summit: start + (rowHours.length * 60) / 2,
      best: opts.best,
      current: opts.current,
      noteTone: over > 0 || (opts.daylight !== null && opts.daylight < 0) ? "over" : missing > 0 ? "missing" : "ok",
      note: (
        <span>
          {opts.decision && <strong className="sky-timeline-level">{LEVEL[opts.decision] || opts.decision}</strong>}
          <strong>{over > 0 ? `${over} h over your limits` : missing > 0 ? `${missing} h with incomplete readings` : "Within your limits"}</strong>
          <small>
            {daylightText}{dark > 0 ? ` · ${dark} h in the dark` : ""}
            {approach ? ` · ${approach.adjustedHours} h checked at ${approachRange(approach)}` : ""}
          </small>
        </span>
      ),
      action: !opts.current && !w.viewingHistoryReport ? (
        <button type="button" className="sky-link sky-timeline-use" disabled={w.startTimeScenarios.loading}
          onClick={() => applyStart(startTime)} aria-label={`Use ${clockText(startTime)} start`}>
          Use <ArrowRight size={13} aria-hidden="true" />
        </button>
      ) : null,
    };
  };

  const scenarioRows: TimelineRow[] = comparison
    ? comparison.scenarios.map((scenario) => {
      const current = scenario.startTime === w.alpineStartTime;
      const rowHours = current ? hours : buildSkyHours(
        buildPlannedReportWeatherRows(scenario.data, w.preferences, w.travelWindowHours, { start: scenario.startTime, date: w.forecastDate, approach: w.approachProfile }),
        { start: scenario.startTime, sunriseMinutes: sunrise, sunsetMinutes: sunset },
      );
      return rowFor(scenario.startTime, rowHours, {
        daylight: scenario.daylightRemainingMinutes,
        decision: scenario.decision.level,
        best: scenario.startTime === comparison.bestStartTime && !comparison.allNoGo,
        current,
      });
    })
    : [];
  const planDaylight = sunset !== null && Number.isFinite(w.returnMinutes) ? sunset - (w.returnMinutes as number) : null;
  const rows = scenarioRows.some((r) => r.current)
    ? scenarioRows
    : [...scenarioRows, rowFor(w.alpineStartTime, hours, { daylight: planDaylight, current: true, key: "plan" })]
      .sort((a, b) => a.start - b.start);

  const overPlan = hours.filter(isOverHour).length;
  const daylightLength = sunrise !== null && sunset !== null && sunset > sunrise ? sunset - sunrise : null;
  const best = comparison?.scenarios.find((s) => s.startTime === comparison.bestStartTime);
  const planScenario = comparison?.scenarios.find((s) => s.startTime === w.alpineStartTime);
  // Suggest another start only when it is clearly better: a better decision,
  // or a score more than a point higher. The top-ranked departure need not
  // have the most daylight, so do not call it the best margin.
  const suggestion = !best || !comparison || comparison.allNoGo || comparison.effectivelyTied || best.startTime === w.alpineStartTime
    ? null
    : planScenario && decisionLevelRank(best.decision.level) > decisionLevelRank(planScenario.decision.level)
      ? `changes the decision to ${LEVEL[best.decision.level] || best.decision.level}`
      : planScenario ? `scores higher (${Math.round(best.score)} vs ${Math.round(planScenario.score)})` : "has the best decision and score of these departures";
  // A peak only means something when an hour carries a risk signal; the
  // first reading can open before an off-the-hour start.
  const peak = w.peakCriticalWindow && w.peakCriticalWindow.score > 0 ? w.peakCriticalWindow : null;
  const peakMinute = peak ? parseTimeInputMinutes(peak.time) ?? parseHourLabelToMinutes(peak.time) : null;
  const planStartMinute = parseTimeInputMinutes(w.alpineStartTime);
  const peakTime = peak && peakMinute !== null && planStartMinute !== null && planStartMinute - peakMinute > 0 && planStartMinute - peakMinute < 60
    ? w.alpineStartTime
    : peak?.time;
  const limits = [
    { label: "Gusts up to", value: w.formatWindDisplay(w.preferences.maxWindGustMph) },
    { label: "Rain chance up to", value: `${w.preferences.maxPrecipChance}%` },
    { label: "Feels-like at least", value: w.formatTempDisplay(w.preferences.minFeelsLikeF) },
    { label: "Feels-like at most", value: w.formatTempDisplay(w.preferences.maxFeelsLikeF) },
  ];

  return (
    <div className="sky-timing">
      <p className="sky-lead">
        Your <strong>{w.displayStartTime} start</strong> has you back at{" "}
        <strong>{w.formatClockForStyle(w.returnTimeDisplay, w.preferences.timeStyle)}{w.returnExtendsPastMidnight ? " (+1 day)" : ""}</strong>
        {planDaylight !== null && (planDaylight < 0
          ? <>, <strong className="is-over">{duration(-planDaylight)} after sunset</strong></>
          : <>, {duration(planDaylight)} before sunset</>)}
        {overPlan > 0 && <>, with <strong className="is-over">{overPlan} h over your limits</strong></>}.{" "}
        {suggestion && best && (
          <>Starting at <strong>{clockText(best.startTime)}</strong> {suggestion}. </>
        )}
        <span className="sky-lead-note">
          {sunrise !== null && sunset !== null
            ? `Sunrise ${clock(sunrise)} · Sunset ${clock(sunset)}${daylightLength ? ` · ${duration(daylightLength)} of daylight` : ""}.`
            : "Sunrise and sunset are unavailable for this plan."}
        </span>
      </p>

      {flags.startTimeComparisons && (
        <section className="sky-section" aria-labelledby="sky-timing-compare">
          <div className="sky-sh">
            <h2 id="sky-timing-compare">Compare start times</h2>
            <p>{comparison?.recommendationReason || "Same trip length, different departures."}</p>
          </div>
          <div className="sky-card sky-timeline-card">
            {w.startTimeScenarios.loading && <p className="sky-muted" role="status">Checking departure windows…</p>}
            {w.startTimeScenarios.error && <p className="sky-notice is-caution" role="alert">{w.startTimeScenarios.error}</p>}
            <StartTimeline rows={rows} sunrise={sunrise} sunset={sunset} clock={clock}
              caption={`Departures compared on one clock: ${rows.map((r) => {
                const notes = [r.current ? "your plan" : null, r.best ? "suggested" : null].filter(Boolean);
                return `${r.label}${notes.length ? ` (${notes.join(", ")})` : ""}`;
              }).join(", ")}.`} />
            {!comparison && !w.startTimeScenarios.loading && (
              <p className="sky-cap">
                Departure comparisons are unavailable for this saved or undated
                report. Create a new report to compare current forecasts.
              </p>
            )}
            {comparison && (
              <p className="sky-cap">
                {comparison.allNoGo
                  ? "No departure clears the no-go checks"
                  : `${comparison.effectivelyTied ? "Suggested among near-equal departures" : "Suggested departure"}: ${clockText(comparison.bestStartTime)}`}
                {" "}· Main difference: {comparison.drivingRisk}
              </p>
            )}
            <div className="sky-card-actions">
              {comparison && (
                <details className="sky-details">
                  <summary>Compare all departure measurements</summary>
                  <div className="sky-table-scroll">
                    <table className="sky-table">
                      <thead>
                        <tr>
                          <th scope="col">Departure</th>
                          <th scope="col">Decision</th>
                          <th scope="col" className="is-num">Peak gust</th>
                          <th scope="col" className="is-num">Feels like</th>
                          <th scope="col" className="is-num">Rain</th>
                          <th scope="col">Halfway / return</th>
                          <th scope="col">Daylight at return</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparison.scenarios.map((scenario) => (
                          <tr key={scenario.startTime}>
                            <th scope="row">
                              {clockText(scenario.startTime)}
                              {scenario.startTime === comparison.bestStartTime && !comparison.allNoGo && <small> · suggested</small>}
                            </th>
                            <td>{LEVEL[scenario.decision.level] || scenario.decision.level} <small>{Math.round(scenario.score)}/100</small></td>
                            <td className="is-num">{w.formatWindDisplay(scenario.peakGustMph)}</td>
                            <td className="is-num">{w.formatTempDisplay(scenario.peakFeelsLikeF)}</td>
                            <td className="is-num">{scenario.peakPrecipChance === null ? "N/A" : `${scenario.peakPrecipChance}%`}<small> · {scenario.stormHours} storm h{scenario.avalancheLabel ? ` · ${scenario.avalancheLabel}` : ""}</small></td>
                            <td>
                              {clockText(scenario.summitTime)} / {clockText(scenario.returnTime)}
                              {scenario.returnDayOffset > 0 && " +1 day"}
                            </td>
                            <td>
                              {scenario.daylightRemainingMinutes === null
                                ? "Unknown"
                                : `${Math.abs(scenario.daylightRemainingMinutes)} min ${scenario.daylightRemainingMinutes < 0 ? "after sunset" : "remaining"}`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
              {w.startTimeScenarios.canGenerateMore && !w.viewingHistoryReport && (
                <button className="field-button" disabled={w.startTimeScenarios.loading} onClick={w.startTimeScenarios.generateMore}>
                  More departures
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="sky-duo sky-section">
        {flags.daylightTimeline && (
          <section className="sky-card report-daylight-panel" aria-labelledby="sky-timing-daylight">
            <span className="sky-card-head"><span id="sky-timing-daylight">Your day outside</span></span>
            <DaylightChart
              start={w.alpineStartTime}
              hours={w.travelWindowHours}
              sunrise={w.safetyData?.solar?.sunrise}
              sunset={w.safetyData?.solar?.sunset}
            />
            <dl className="sky-list">
              <div>
                <dt>Start / return</dt>
                <dd>
                  {w.displayStartTime} – {w.formatClockForStyle(w.returnTimeDisplay, w.preferences.timeStyle)}
                  {w.returnExtendsPastMidnight && " (+1 day)"}
                </dd>
              </div>
              <div><dt>Daylight remaining at start</dt><dd>{w.daylightRemainingFromStartLabel}</dd></div>
              <div><dt>Sunrise</dt><dd>{w.safetyData?.solar?.sunrise || "Unavailable"}</dd></div>
              <div><dt>Sunset</dt><dd>{w.safetyData?.solar?.sunset || "Unavailable"}</dd></div>
            </dl>
          </section>
        )}
        <section className="sky-card" aria-labelledby="sky-timing-limits">
          <span className="sky-card-head"><span id="sky-timing-limits">Your planning limits</span></span>
          <dl className="sky-list">
            {limits.map((limit) => (
              <div key={limit.label}><dt>{limit.label}</dt><dd>{limit.value}</dd></div>
            ))}
          </dl>
          <p className="sky-cap">{w.travelWindowSummary}</p>
          {peak && peakTime && (
            <p className="sky-cap">
              Most severe weather: {clockText(peakTime)} · {peak.condition}
              {peak.reasons.length > 0 && <> ({w.localizeUnitText(peak.reasons.join(", "))})</>}
            </p>
          )}
          <details className="sky-details report-threshold-disclosure">
            <summary>Adjust limits</summary>
            <Thresholds workspace={w} />
          </details>
        </section>
      </div>

      {flags.contingencyPlanning && w.safetyData?.contingency?.status === "ok" && (
        <div className="sky-section">
          <ContingencyCard
            contingency={w.safetyData.contingency}
            returnMinutes={Number.isFinite(w.returnMinutes) ? (w.returnMinutes as number) : null}
            clock={clock}
            formatTemp={(value) => w.formatTempDisplay(value)}
            formatWind={(value) => w.formatWindDisplay(value)}
            timeZone={w.objectiveTimezone}
          />
        </div>
      )}
    </div>
  );
}
