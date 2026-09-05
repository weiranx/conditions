import { lazy, Suspense, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  Clock3,
  Download,
  Link,
  Mail,
  Ellipsis,
  Mountain,
  RefreshCw,
  Route as RouteIcon,
  ShieldCheck,
  Sparkles,
  Sunrise,
  TriangleAlert,
} from "lucide-react";
import { ReportVerdict } from "./ReportVerdict";
import { ReportSummary } from "./ReportSummary";
import "./report-reading.css";
import { AiExplanation } from "./AiExplanation";
import type { PersistedReport } from "../app/report-storage";
import type { Workspace } from "./model/useWorkspace";
import { resolveReportFeatureFlags } from "../contexts/feature-flags";
import { useAiAvailability } from "../hooks/useAiAvailability";
import { getPastPlannedStart } from "../app/planned-start";
import {
  parseReportSectionHash,
  buildReportSectionHash,
} from "../app/report-sections";
import { ageLabel, dateLabel } from "./data";
import { Forecast } from "./Forecast";
import { Conditions } from "./Conditions";
const Timing = lazy(() =>
  import("./Timing").then((m) => ({ default: m.Timing })),
);
const Terrain = lazy(() =>
  import("./Terrain").then((m) => ({ default: m.Terrain })),
);
const Sources = lazy(() =>
  import("./Sources").then((m) => ({ default: m.Sources })),
);
const Route = lazy(() => import("./Route").then((m) => ({ default: m.Route })));
const Chat = lazy(() => import("./Chat").then((m) => ({ default: m.Chat })));
const chapters = [
  { id: "forecast", label: "Weather", icon: Sunrise },
  { id: "timing", label: "Timing", icon: Clock3 },
  { id: "terrain", label: "Terrain & snow", icon: Mountain },
  { id: "route", label: "Route", icon: RouteIcon },
  { id: "sources", label: "Checks & sources", icon: ShieldCheck },
  { id: "gear", label: "Gear & actions", icon: Check },
] as const;
type Chapter = (typeof chapters)[number]["id"];
function chapterFromHash(): Chapter {
  const hash = parseReportSectionHash(window.location.hash) || "";
  if (/route/.test(hash)) return "route";
  if (/terrain|snow|avalanche|wind-loading|elevation/.test(hash))
    return "terrain";
  if (/timing|travel|start|daylight|plan-snapshot/.test(hash)) return "timing";
  if (/source|check|score|alert|deep-dive|evidence/.test(hash))
    return "sources";
  if (/gear|pack/.test(hash)) return "gear";
  return "forecast";
}

export function Report({
  report,
  workspace: w,
  onEdit,
  onSave,
  onWatch,
  onShare,
  onEmail,
  actionBusy,
  feedback,
}: {
  report: PersistedReport;
  workspace: Workspace;
  onEdit: () => void;
  onSave: () => void;
  onWatch: () => void;
  onShare: () => void;
  onEmail: () => void;
  actionBusy: boolean;
  feedback: string;
}) {
  const [chapter, setChapter] = useState<Chapter>(chapterFromHash);
  const [fullReport, setFullReport] = useState(false);
  const [packed, setPacked] = useState<Set<string>>(() => new Set());
  const data = report.safetyData;
  const flags = resolveReportFeatureFlags(data.featureFlags);
  const ai = useAiAvailability(data.capabilities);
  const decision = w.decision!;
  const passed = getPastPlannedStart(
    report.plan.forecastDate,
    report.plan.alpineStartTime,
    w.objectiveTimezone,
  );
  const visibleChapters = chapters
    .filter((c) => c.id !== "route" || flags.routeAnalysis)
    .filter((c) => c.id !== "gear" || flags.gearRecommendations);
  const activeChapter = visibleChapters.some((c) => c.id === chapter)
    ? chapter
    : "forecast";
  useEffect(() => {
    const listener = () => setChapter(chapterFromHash());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  function selectChapter(next: Chapter) {
    setFullReport(false);
    setChapter(next);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}${buildReportSectionHash(`planner-section-${next}`)}`,
    );
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${report.plan.objectiveName.replace(/[^a-z0-9]+/gi, "-")}-brief.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="field-report">
      <header className="field-report-head">
        <div>
          <span className="field-kicker">
            {w.viewingHistoryReport
              ? "Saved conditions report"
              : "Conditions report"}{" "}
            / {dateLabel(report.plan.forecastDate)}
          </span>
          <h1>{report.plan.objectiveName}</h1>
          <p>
            {w.displayStartTime} start <span>·</span>{" "}
            {report.plan.travelWindowHours} hours outside <span>·</span>{" "}
            {w.formatElevationDisplay(
              data.weather.elevation == null
                ? null
                : Number(data.weather.elevation),
            )}
          </p>
        </div>
        <button className="field-button" onClick={onEdit}>
          Edit plan
          <ArrowUpRight size={16} />
        </button>
      </header>
      <div className="field-report-toolbar">
        <span>
          <span className="field-status-dot" />
          Generated {ageLabel(data.generatedAt)} ·{" "}
          {w.objectiveTimezone || "Objective local time"}
        </span>
        <div>
          {flags.reportHistory && (
            <button disabled={actionBusy} onClick={onSave}>
              <Download size={14} />
              {w.activeSavedReportId ? "Saved" : "Save"}
            </button>
          )}
          {flags.reportSharing && (
            <button disabled={actionBusy} onClick={onShare}>
              <Link size={14} />
              {w.copiedLink ? "Copied" : "Share"}
            </button>
          )}
          {flags.objectiveWatch && (
            <button disabled={actionBusy} onClick={onWatch}>
              <Bell size={14} />
              Watch
            </button>
          )}
          <details
            className="report-actions-menu"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
              }
            }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                event.currentTarget.open = false;
            }}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("button"))
                event.currentTarget.open = false;
            }}
          >
            <summary>
              <Ellipsis size={18} />
              More actions
            </summary>
            <div className="report-actions-popover">
              <button disabled={actionBusy} onClick={onEmail}>
                <Mail size={16} />
                Email report
              </button>
              <button onClick={w.handleRetryFetch}>
                <RefreshCw size={16} />
                Refresh conditions
              </button>
              <button onClick={download}>
                <ArrowDown size={16} />
                Export report data
              </button>
              <button onClick={() => setFullReport((value) => !value)}>
                {fullReport ? "Back to chapters" : "Full report"}
              </button>
              <button onClick={() => window.print()}>Print view</button>
            </div>
          </details>
        </div>
      </div>
      {w.tripForecastRows.length > 0 && (
        <div
          className="field-preset-list"
          role="group"
          aria-label="Days from your comparison"
        >
          {w.tripForecastRows.map((day) => (
            <button
              key={day.date}
              aria-pressed={day.date === report.plan.forecastDate}
              onClick={() => w.handleSelectMultiDayForecastDay(day.date)}
            >
              {dateLabel(day.date)} · {day.score ?? "—"}
            </button>
          ))}
        </div>
      )}
      {feedback && (
        <p className="field-feedback" role="status">
          {feedback}
        </p>
      )}
      {(data.partialData || data.apiWarning || w.hasFreshnessWarning) && (
        <div className="field-warning" role="status">
          <TriangleAlert size={18} />
          <span>
            {data.apiWarning ||
              w.freshnessWarningSummary ||
              "Some source evidence is incomplete. Verify current sources before committing."}
          </span>
        </div>
      )}
      {passed && (
        <div className="field-warning">
          <div>
            <strong>This report’s departure date has passed.</strong>
            <p>
              The saved forecast is available for reference. Choose a current
              plan for your next outing.
            </p>
            <div className="field-action-row">
              <button
                className="field-button"
                onClick={w.handleUseNowAfterPastStart}
              >
                Use now
              </button>
              <button
                className="field-button"
                onClick={w.handleUseTomorrowAfterPastStart}
              >
                Use tomorrow
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="report-overview">
        <ReportVerdict
          data={data}
          decision={decision}
          primaryReason={w.fieldBriefPrimaryReason}
          freshnessWarning={w.hasFreshnessWarning ? w.freshnessWarningSummary : null}
          preferences={w.preferences}
          onSources={() => selectChapter("sources")}
        />
        <ReportSummary workspace={w} onOpen={selectChapter} />
      </div>
      <div className="field-report-layout">
        <nav className="field-chapters" aria-label="Briefing chapters">
          {visibleChapters.map((c) => (
            <button
              key={c.id}
              aria-current={activeChapter === c.id ? "page" : undefined}
              onClick={() => selectChapter(c.id)}
            >
              <c.icon size={17} />
              <strong>{c.label}</strong>
              <ArrowRight size={14} />
            </button>
          ))}
        </nav>
        <div className="field-chapter-content">
          <Suspense
            fallback={
              <p className="field-loading" role="status">
                Loading report detail…
              </p>
            }
          >
            {(fullReport || activeChapter === "forecast") && (
              <section>
                <div className="field-chapter-heading">
                  <h2>Weather through your day</h2>
                </div>
                <Forecast report={report} />
                <Conditions workspace={w} />
              </section>
            )}
            {(fullReport || activeChapter === "timing") && (
              <Timing workspace={w} />
            )}
            {(fullReport || activeChapter === "terrain") && (
              <Terrain workspace={w} />
            )}
            {(fullReport || activeChapter === "sources") && (
              <Sources workspace={w} />
            )}
            {(fullReport || activeChapter === "route") &&
              flags.routeAnalysis && <Route workspace={w} />}
            {(fullReport || activeChapter === "gear") &&
              flags.gearRecommendations && (
                <section>
                  <div className="field-chapter-heading">
                    <h2>Gear and field actions</h2>
                    <p>
                      Turn the report’s main findings into a practical
                      preparation list.
                    </p>
                  </div>
                  {[...decision.blockers, ...decision.cautions].map(
                    (item, i) => (
                      <div className="field-pack-caution" key={i}>
                        <TriangleAlert size={18} />
                        <p>{item}</p>
                      </div>
                    ),
                  )}
                  <div className="field-packing-list">
                    {w.gearRecommendations.map((gear, i) => {
                      const key = `${gear.title}-${i}`;
                      return (
                        <label key={key}>
                          <input
                            type="checkbox"
                            checked={packed.has(key)}
                            onChange={(e) =>
                              setPacked((current) => {
                                const next = new Set(current);
                                if (e.target.checked) next.add(key);
                                else next.delete(key);
                                return next;
                              })
                            }
                          />
                          <span>
                            <small>{gear.category}</small>
                            <strong>{gear.title}</strong>
                            <small>{gear.detail}</small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="field-muted">
                    Checked items are kept for this report session. Carry your
                    normal essentials in addition to these suggestions.
                  </p>
                </section>
              )}
          </Suspense>
        </div>
      </div>
      {(ai.aiBrief || w.aiBriefNarrative) && (
        <section className="field-panel">
          <div className="field-panel-heading">
            <div>
              <span className="field-kicker">AI explanation</span>
              <h2>The report in context</h2>
            </div>
            {!w.viewingHistoryReport && (
              <button
                className="field-button"
                disabled={w.aiBriefLoading || !ai.aiBrief}
                onClick={w.handleRequestAiBriefAction}
              >
                <Sparkles size={16} />
                {w.aiBriefLoading
                  ? "Writing explanation…"
                  : w.aiBriefNarrative
                    ? "Regenerate explanation"
                    : "Explain this report"}
              </button>
            )}
          </div>
          {w.aiBriefError && (
            <p className="field-warning" role="alert">
              {w.aiBriefError}
            </p>
          )}
          {w.aiBriefNarrative && <AiExplanation text={w.aiBriefNarrative} />}
        </section>
      )}
      {(ai.reportChat || w.reportChatMessages.length > 0) && (
        <Suspense fallback={<p>Loading report assistant…</p>}>
          <Chat
            key={w.reportChatSessionKey}
            reportPayload={w.rawReportPayload}
            initialMessages={w.reportChatMessages}
            onMessagesChange={w.setReportChatMessages}
            readOnly={w.viewingHistoryReport}
          />
        </Suspense>
      )}
      <p className="field-muted">
        Backcountry Conditions is a planning aid, not a safety guarantee. Verify
        official forecasts and make final decisions from field observations and
        team judgment.
      </p>
    </div>
  );
}
