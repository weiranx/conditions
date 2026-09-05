import { useEffect, useState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import type { Workspace } from "./model/useWorkspace";
import { freshnessClass } from "../app/core";
import { resolveReportFeatureFlags } from "../contexts/feature-flags";
import { compareReports, type ReportComparison } from "../app/report-changes";
import { getReportComparisonBaseline } from "../lib/saved-reports";
import { parsePersistedReport } from "../app/report-storage";
import { AccumulationBars, ConditionScale } from "./ConditionCharts";
import { Details, SourceLink } from "./Details";
import { dateLabel } from "./data";

export function Sources({ workspace: w }: { workspace: Workspace }) {
  const flags = resolveReportFeatureFlags(w.safetyData?.featureFlags);
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
  return (
    <section>
      <div className="field-chapter-heading">
        <h2>Checks and source evidence</h2>
      </div>
      <div className="report-check-summary">
        <div>
          <strong>
            {w.decision?.checks.filter((check) => check.ok).length || 0}
          </strong>
          <span>checks passed</span>
        </div>
        <div>
          <strong>
            {w.decision?.checks.filter((check) => !check.ok).length || 0}
          </strong>
          <span>need review</span>
        </div>
        <div>
          <strong>
            {w.safetyData?.safety.confidence ?? "—"}
            <small>%</small>
          </strong>
          <span>evidence confidence</span>
        </div>
      </div>
      <div className="field-checks">
        {w.decision?.checks.map((check, i) => (
          <details key={check.key || i}>
            <summary>
              <span className={check.ok ? "field-pass" : "field-fail"}>
                {check.ok ? <Check size={17} /> : <TriangleAlert size={17} />}
              </span>
              {check.label}
              <span>{check.ok ? "Pass" : "Review"}</span>
            </summary>
            <p>{check.detail}</p>
            {check.action && (
              <p>
                <strong>Action:</strong> {check.action}
              </p>
            )}
          </details>
        ))}
      </div>
      {flags.scoreBreakdown && (
        <section className="field-panel field-sources-score">
          <h2>Score and confidence</h2>
          <ConditionScale
            label="Safety score"
            value={w.safetyData?.safety.score}
            maximum={100}
          />
          <AccumulationBars
            label="Effective score deductions"
            rows={Object.entries(w.safetyData?.safety.groupImpacts || {}).map(
              ([label, impact]) => ({
                label,
                value: impact.effective ?? impact.capped ?? null,
                display: `${impact.effective ?? impact.capped ?? "—"} pts`,
              }),
            )}
          />
          <details className="field-detail-disclosure">
            <summary>How the score is calculated</summary>
            <p>
              Overlapping hazard adjustments mean individual factors may not sum
              to the final score.
            </p>
            <ul className="field-prose-list">
              {w.safetyData?.safety.explanations?.map((text, i) => (
                <li key={i}>{w.localizeUnitText(text)}</li>
              ))}
            </ul>
            <Details
              title="Raw and effective deductions"
              value={w.safetyData?.safety.groupImpacts}
            />
          </details>
          <Details
            title="Individual factors and confidence reasons"
            value={{
              factors: w.safetyData?.safety.factors,
              confidence: w.safetyData?.safety.confidence,
              reasons: w.safetyData?.safety.confidenceReasons,
            }}
          />
        </section>
      )}
      {comparison && (
        <section className="field-panel">
          <span className="field-kicker">
            Since the previous matching report
          </span>
          <h2>{comparison.headline}</h2>
          <p>Baseline {dateLabel(comparison.baselineAt)}</p>
          <ul className="field-prose-list">
            {comparison.changes.map((change) => (
              <li key={change.key}>{w.localizeUnitText(change.summary)}</li>
            ))}
          </ul>
        </section>
      )}
      {comparisonError && <p className="field-muted">{comparisonError}</p>}
      {w.dayOverDay && (
        <section className="field-panel">
          <h2>Change from the prior day</h2>
          <p>
            {w.dayOverDay.delta > 0 ? "+" : ""}
            {w.dayOverDay.delta} score points compared with{" "}
            {dateLabel(w.dayOverDay.previousDate)}.
          </p>
          <p className="field-muted">
            Both days use a {w.formatClockForStyle(w.dayOverDay.startTime, w.preferences.timeStyle)} local start
            and a {w.dayOverDay.travelWindowHours}-hour travel window.
          </p>
          <Details title="What changed" value={w.dayOverDay.changes} open />
        </section>
      )}
      <section className="field-panel">
        <h2>Source freshness</h2>
        {w.hasFreshnessWarning && (
          <p className="field-warning">{w.freshnessWarningSummary}</p>
        )}
        <div className="field-table-scroll">
          <table className="field-data-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Freshness</th>
                <th>Issued / observed</th>
              </tr>
            </thead>
            <tbody>
              {w.sourceFreshnessRows.map((source) => (
                <tr key={source.label}>
                  <th>{source.label}</th>
                  <td>
                    {source.stateOverride ||
                      freshnessClass(source.issued, source.staleHours)}
                  </td>
                  <td>
                    {source.displayValue || w.formatAgeFromNow(source.issued)}
                    <small>
                      {source.issued
                        ? w.formatPubTime(source.issued)
                        : "Timestamp unavailable"}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="field-action-row">
          <SourceLink url={w.safeWeatherLink}>Weather forecast</SourceLink>
          {flags.avalancheDetails && (
            <SourceLink url={w.safeAvalancheLink}>Avalanche center</SourceLink>
          )}
          <SourceLink url={w.safeRainfallLink}>Precipitation source</SourceLink>
          {flags.snowpackDetails && (
            <>
              <SourceLink url={w.safeSnotelLink}>SNOTEL</SourceLink>
              <SourceLink url={w.safeNohrscLink}>NOHRSC</SourceLink>
              <SourceLink url={w.safeCdecLink}>CDEC</SourceLink>
            </>
          )}
        </div>
      </section>
      <section className="field-panel">
        <h2>Official alerts</h2>
        <p>
          {w.nwsAlertCount} alerts relevant to the selected start ·{" "}
          {w.nwsTotalAlertCount} in the returned feed.
        </p>
        {w.nwsAlerts.map((alert, i) => (
          <Details
            key={i}
            title={`${alert.event || "Official alert"} · ${alert.severity || "Severity unavailable"}`}
            value={alert}
          />
        ))}
        {!w.nwsAlerts.length && (
          <p className="field-muted">
            {w.safetyData?.alerts?.note ||
              "No alert details returned. This does not establish that every hazard is absent."}
          </p>
        )}
      </section>
      <section className="field-panel">
        <h2>Forecast provenance</h2>
        <p>{w.weatherSourceDisplay}</p>
        <Details
          title="Weather field sources and forecast context"
          value={{
            sources: w.safetyData?.weather.sourceDetails,
            forecast: w.safetyData?.forecast,
            timeZone: w.objectiveTimezone,
          }}
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
    </section>
  );
}
