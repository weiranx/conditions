import { SupplementalEvidence } from './SupplementalEvidence';
import { useEffect, useState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import type { Workspace } from "./model/useWorkspace";
import { resolveReportFeatureFlags } from "../contexts/feature-flags";
import { compareReports, type ReportComparison } from "../app/report-changes";
import { getReportComparisonBaseline } from "../lib/saved-reports";
import { parsePersistedReport } from "../app/report-storage";
import { ScoreExplanation } from "./ScoreExplanation";
import { Details, SourceLink } from "./Details";
import { dateLabel } from "./data";
import { FreshnessChart } from "./sky/FreshnessChart";

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
  const checks = [...(w.decision?.checks || [])].sort((a, b) => Number(a.ok) - Number(b.ok));
  const review = checks.filter((check) => !check.ok);
  const freshness = w.interpretation!.sourceFreshness;
  const current = freshness.rows.filter((row) => row.state === "fresh" || row.state === "aging").length;
  const missing = freshness.rows.filter((row) => row.state === "missing").map((row) => row.label);
  return (
    <div className="sky-sources">
      <p className="sky-lead">
        <strong>{checks.length - review.length} of {checks.length} checks</strong> pass
        {review.length > 0 && <>; <strong className="is-over">{review.length} need review</strong></>}.{" "}
        <strong>{current} of {freshness.rows.length} sources</strong> are current
        {missing.length > 0 && <>, and <strong className="is-missing">{missing.join(", ")}</strong> didn't load, so this report can't rule out what {missing.length === 1 ? "it covers" : "they cover"}</>}.{" "}
        <span className="sky-lead-note">Evidence quality: {w.safetyData?.safety.evidenceQuality || "not assessed"}.</span>
      </p>

      <section className="sky-section" aria-labelledby="sky-sources-checks">
        <div className="sky-sh">
          <h2 id="sky-sources-checks">Checks</h2>
          <p>Items that need review are open.</p>
        </div>
        <div className="sky-card sky-check-list">
          {checks.map((check, i) => (
            <details key={check.key || i} open={!check.ok} className={check.ok ? "is-ok" : "is-over"}>
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
          ))}
          {checks.length === 0 && <p className="sky-empty">No decision checks are available for this report.</p>}
        </div>
      </section>

      <section className="sky-section" aria-labelledby="sky-sources-fresh">
        <div className="sky-sh">
          <h2 id="sky-sources-fresh">How fresh is each source</h2>
          <p>When it was issued or observed.</p>
        </div>
        <div className="sky-card">
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
      </section>

      {(comparison || comparisonError || w.dayOverDay) && (
        <div className="sky-duo sky-section">
          {comparison && (
            <section className="sky-card" aria-labelledby="sky-sources-since">
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
            <section className="sky-card" aria-labelledby="sky-sources-prior">
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
              <Details title="What changed" value={w.dayOverDay.changes} open />
            </section>
          )}
        </div>
      )}

      {flags.scoreBreakdown && w.safetyData && (
        <div className="sky-section">
          <ScoreExplanation safety={w.safetyData.safety} localize={w.localizeUnitText} />
        </div>
      )}
      <div className="sky-section">
        <SupplementalEvidence evidence={w.safetyData?.supplementalEvidence} localize={w.localizeUnitText} />
      </div>

      <div className="sky-duo sky-section">
        <section className="sky-card" aria-labelledby="sky-sources-alerts">
          <span className="sky-card-head">
            <span id="sky-sources-alerts">Official alerts</span>
            <span className={`sky-chip${w.nwsAlertCount > 0 ? " is-over" : ""}`}>{w.nwsAlertCount} for your time</span>
          </span>
          <p className="sky-cap is-body">
            {w.nwsAlertCount} {w.nwsAlertCount === 1 ? "alert applies" : "alerts apply"} to your start time ·{" "}
            {w.nwsTotalAlertCount} in the full feed.
          </p>
          {w.nwsAlerts.map((alert, i) => (
            <Details
              key={i}
              title={`${alert.event || "Official alert"} · ${alert.severity || "Severity unavailable"}`}
              value={alert}
            />
          ))}
          {!w.nwsAlerts.length && (
            <p className="sky-cap">
              {w.safetyData?.alerts?.note ||
                "No alerts were returned. That does not mean there are no hazards."}
            </p>
          )}
        </section>
        <section className="sky-card" aria-labelledby="sky-sources-provenance">
          <span className="sky-card-head"><span id="sky-sources-provenance">Forecast provenance</span></span>
          <p className="sky-cap is-body">{w.weatherSourceDisplay}</p>
          <Details
            title="Weather field sources and forecast context"
            value={{
              sources: w.safetyData?.weather.sourceDetails,
              evidence: w.safetyData?.safety.weatherProvenance,
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
      </div>
    </div>
  );
}
