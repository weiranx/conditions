import { SupplementalEvidence } from './SupplementalEvidence';
import { useEffect, useState, type ReactNode } from "react";
import { Check, TriangleAlert } from "lucide-react";
import type { Workspace } from "./model/useWorkspace";
import { resolveReportFeatureFlags } from "../contexts/feature-flags";
import { compareReports, type ReportComparison } from "../app/report-changes";
import { getReportComparisonBaseline } from "../lib/saved-reports";
import { parsePersistedReport } from "../app/report-storage";
import { ScoreExplanation } from "./ScoreExplanation";
import { SourceLink } from "./Details";
import { Evidence } from "./Evidence";
import { evidenceFormat } from "./evidence-format";
import { dateLabel } from "./data";
import { FreshnessChart } from "./sky/FreshnessChart";
import { Fold } from "./sky/Fold";

const FIELD_NAMES: Record<string, string> = {
  temp: "temperature",
  feelsLike: "feels-like",
  dewPoint: "dew point",
  description: "conditions",
  windSpeed: "wind",
  windGust: "gusts",
  windDirection: "wind direction",
  pressure: "pressure",
  humidity: "humidity",
  cloudCover: "cloud cover",
  precipChance: "rain / snow chance",
  isDaytime: "daylight",
};

type DecisionCheck = NonNullable<Workspace["decision"]>["checks"][number];

/** One decision check: its label and result, opening to the detail and the action it asks for. */
function CheckItem({ check }: { check: DecisionCheck }) {
  return (
    <details open={!check.ok} className={check.ok ? "is-ok" : "is-over"}>
      <summary>
        <span className={`sky-check-icon ${check.ok ? "field-pass" : "field-fail"}`}>
          {check.ok ? <Check size={16} aria-hidden="true" /> : <TriangleAlert size={16} aria-hidden="true" />}
        </span>
        <span className="sky-check-label">{check.label}</span>
        <span className={`sky-status is-${check.ok ? "ok" : "over"}`}>{check.ok ? "Pass" : "Review"}</span>
      </summary>
      <div className="sky-check-body">
        <p>{check.detail}</p>
        {check.action && (
          <p>
            <strong>Action:</strong> {check.action}
          </p>
        )}
      </div>
    </details>
  );
}

export function Sources({ workspace: w, more = null }: {
  workspace: Workspace;
  /** Reference that closes the chapter, e.g. the AI read when it does not lead the report. */
  more?: ReactNode;
}) {
  const flags = resolveReportFeatureFlags(w.safetyData?.featureFlags);
  const f = evidenceFormat(w);
  // Group the readings by the source that supplied them: "NOAA: temperature, wind, …".
  const fieldSourceRows = Object.entries(
    Object.entries(w.safetyData?.weather.sourceDetails?.fieldSources ?? {}).reduce<Record<string, string[]>>((groups, [field, source]) => {
      if (source && source !== "Unavailable") (groups[source] ??= []).push(FIELD_NAMES[field] ?? field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase());
      return groups;
    }, {}),
  ).map(([source, fields]) => [source, fields.join(", ")] as const);
  const [comparison, setComparison] = useState<ReportComparison | null>(null);
  const [comparisonError, setComparisonError] = useState("");
  const report = w.reportSnapshot;
  useEffect(() => {
    if (!report || !w.activeSavedReportId || !w.accountUserId) return;
    const controller = new AbortController();
    void getReportComparisonBaseline(
      report,
      w.activeSavedReportId,
      controller.signal,
    )
      .then((baseline) => {
        const parsed = parsePersistedReport(baseline?.snapshot);
        if (!controller.signal.aborted)
          setComparison(parsed ? compareReports(report, parsed) : null);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setComparisonError(
            error instanceof Error ? error.message : "Baseline unavailable.",
          );
      });
    return () => controller.abort();
  }, [report, w.activeSavedReportId, w.accountUserId]);
  const checks = w.decision?.checks || [];
  const review = checks.filter((check) => !check.ok);
  // Passing checks wait behind one line in the same list; the ones to review are open.
  const passing = checks.filter((check) => check.ok);
  const freshness = w.interpretation!.sourceFreshness;
  const current = freshness.rows.filter((row) => row.state === "fresh" || row.state === "aging").length;
  const missingSources = freshness.rows.filter((row) => row.state === "missing").map((row) => row.label);
  const freshHint = `${current} of ${freshness.rows.length} current${missingSources.length ? ` · ${missingSources.join(", ")} missing` : ""}`;
  return (
    <div className="sky-sources">
      <section className="sky-section" aria-labelledby="sky-sources-checks">
        <h2 id="sky-sources-checks" className="sr-only">Checks</h2>
        <div className="sky-card sky-check-list">
          {review.map((check, i) => <CheckItem key={check.key || i} check={check} />)}
          {passing.length > 0 && (
            <details className="sky-check-passed">
              <summary>
                <span className="sky-check-icon field-pass"><Check size={16} aria-hidden="true" /></span>
                <span className="sky-check-label">{passing.length} passed</span>
                <span className="sky-status is-ok">{review.length ? "Show" : "All pass"}</span>
              </summary>
              {passing.map((check, i) => <CheckItem key={check.key || i} check={check} />)}
            </details>
          )}
          {checks.length === 0 && <p className="sky-empty">No decision checks are available for this report.</p>}
        </div>
      </section>

      <Fold id="sky-sources-fresh" title="How fresh is each source" hint={freshHint}>
        <div className="sky-card is-secondary">
          {freshness.hasWarning && <p className="sky-notice is-missing">{freshness.warningSummary}</p>}
          <FreshnessChart rows={freshness.rows} age={(issued) => w.formatAgeFromNow(issued)} stamp={(issued) => w.formatPubTime(issued)} />
          <div className="sky-link-row">
            <SourceLink url={w.safeWeatherLink}>Weather forecast</SourceLink>
            {flags.avalancheDetails && <SourceLink url={w.safeAvalancheLink}>Avalanche center</SourceLink>}
            <SourceLink url={w.safeRainfallLink}>Precipitation source</SourceLink>
            {flags.snowpackDetails && (
              <>
                <SourceLink url={w.safeSnotelLink}>SNOTEL</SourceLink>
                <SourceLink url={w.safeNohrscLink}>NOHRSC</SourceLink>
                <SourceLink url={w.safeCdecLink}>CDEC</SourceLink>
              </>
            )}
          </div>
        </div>
      </Fold>

      {(comparison || comparisonError || w.dayOverDay) && (
        <div className="sky-duo sky-section">
          {comparison && (
            <section className="sky-card is-secondary" aria-labelledby="sky-sources-since">
              <span className="sky-card-head"><span id="sky-sources-since">Since the previous matching report</span></span>
              <strong className="sky-card-lede">{comparison.headline}</strong>
              <p className="sky-cap">Baseline {dateLabel(comparison.baselineAt)}</p>
              <ul className="sky-bullets">
                {comparison.changes.map((change) => (
                  <li key={change.key}>{w.localizeUnitText(change.summary)}</li>
                ))}
              </ul>
            </section>
          )}
          {comparisonError && <p className="sky-cap">{comparisonError}</p>}
          {w.dayOverDay && (
            <section className="sky-card is-secondary" aria-labelledby="sky-sources-prior">
              <span className="sky-card-head">
                <span id="sky-sources-prior">Change from the prior day</span>
                {w.dayOverDay.scoreComparable && <span className="sky-chip">{w.dayOverDay.deltaLabel} pts</span>}
              </span>
              <p className="sky-cap is-body">
                {w.dayOverDay.scoreComparable
                  ? <>{w.dayOverDay.deltaLabel} score points compared with {dateLabel(w.dayOverDay.previousDate)}.</>
                  : <>Compared with {dateLabel(w.dayOverDay.previousDate)}. One of the two days lacks the evidence for a score, so only the forecast changes are listed.</>}
              </p>
              <p className="sky-cap">
                Both days use a {w.formatClockForStyle(w.dayOverDay.startTime, w.preferences.timeStyle)} local start
                and a {w.dayOverDay.travelWindowHours}-hour travel window.
              </p>
              {w.dayOverDay.changes.length > 0 ? (
                <ul className="sky-bullets">
                  {w.dayOverDay.changes.map((change) => <li key={change}>{w.localizeUnitText(change)}</li>)}
                </ul>
              ) : (
                <p className="sky-cap">No meaningful forecast changes.</p>
              )}
            </section>
          )}
        </div>
      )}

      {flags.scoreBreakdown && w.safetyData && (
        <ScoreExplanation safety={w.safetyData.safety} localize={w.localizeUnitText} folded />
      )}
      <SupplementalEvidence evidence={w.safetyData?.supplementalEvidence} localize={w.localizeUnitText} timeStyle={w.preferences.timeStyle} folded />

      <div className="sky-duo sky-section">
        <section className="sky-card is-secondary" aria-labelledby="sky-sources-alerts">
          <span className="sky-card-head">
            <span id="sky-sources-alerts">Official alerts</span>
            <span className={`sky-chip${w.nwsAlertCount > 0 ? " is-over" : ""}`}>{w.nwsAlertCount} for your time</span>
          </span>
          <p className="sky-cap is-body">
            {w.nwsAlertCount} {w.nwsAlertCount === 1 ? "alert applies" : "alerts apply"} to your start time ·{" "}
            {w.nwsTotalAlertCount} in the full feed.
          </p>
          {w.nwsAlerts.map((alert, i) => (
            <Evidence
              key={i}
              title={[alert.event || "Official alert", alert.severity].filter(Boolean).join(" · ")}
              rows={[
                ["Starts", f.time(alert.onset || alert.effective)],
                ["Ends", f.time(alert.ends || alert.expires)],
                ["Issued by", alert.senderName],
                ["Area", alert.areaDesc],
              ]}
              links={[{ url: alert.link, label: "Full alert" }]}
            >
              {alert.headline && <p className="sky-cap is-body">{alert.headline}</p>}
              {alert.description && <p className="sky-cap sky-alert-text">{alert.description}</p>}
              {alert.instruction && <p className="sky-cap sky-alert-text"><strong>What to do:</strong> {alert.instruction}</p>}
            </Evidence>
          ))}
          {!w.nwsAlerts.length && (
            <p className="sky-cap">
              {w.safetyData?.alerts?.note ||
                "No alerts were returned. That does not mean there are no hazards."}
            </p>
          )}
        </section>
        <section className="sky-card is-secondary" aria-labelledby="sky-sources-provenance">
          <span className="sky-card-head"><span id="sky-sources-provenance">Forecast provenance</span></span>
          <p className="sky-cap is-body">{w.weatherSourceDisplay}</p>
          <Evidence
            title="Which source supplied each reading"
            rows={[
              ...fieldSourceRows,
              ["Supplemented by", w.safetyData?.weather.sourceDetails?.supplementalSources?.join(", ")],
              ["Forecast issued", f.time(w.safetyData?.weather.issuedTime)],
              ["Forecast available", w.safetyData?.forecast?.availableRange?.start && w.safetyData.forecast.availableRange.end
                ? [...new Set([dateLabel(w.safetyData.forecast.availableRange.start), dateLabel(w.safetyData.forecast.availableRange.end)])].join(" to ") : null],
              ["Time zone", w.objectiveTimezone],
            ]}
          />
          <details className="field-detail-disclosure">
            <summary>Complete report data</summary>
            <button
              className="field-text-button"
              onClick={w.handleCopyRawPayload}
            >
              {w.copiedRawPayload ? "Copied" : "Copy report data"}
            </button>
            <pre className="field-raw-report">{w.rawReportPayload}</pre>
          </details>
        </section>
      </div>
      {more}
    </div>
  );
}
