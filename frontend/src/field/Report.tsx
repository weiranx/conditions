import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
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
import { GearActions } from "./GearActions";
import { ReportVerdict } from "./ReportVerdict";
import { ReportInsights } from "./ReportInsights";
import { ReportSummary } from "./ReportSummary";
import "./report-reading.css";
import "./report-navigation.css";
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
  const navigationRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const requestedChapter = useRef<Chapter | null>(null);
  const [detailRequest, setDetailRequest] = useState(0);
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
  const activeChapterLabel = visibleChapters.find((c) => c.id === activeChapter)!.label;
  useEffect(() => {
    const listener = () => {
      requestedChapter.current = null;
      setChapter(chapterFromHash());
    };
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    // Only an overview shortcut requests a jump. Loading a report, changing
    // chapters, and syncing the URL must not move the reader's position.
    if (requestedChapter.current !== activeChapter) return;
    requestedChapter.current = null;
    const detail = detailRef.current;
    if (!detail) return;
    const focusHeading = () => {
      const heading = Array.from(detail.querySelectorAll<HTMLHeadingElement>("h2"))
        .find((element) => element.getClientRects().length > 0);
      if (!heading) return false;
      navigationRef.current?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      return true;
    };
    if (focusHeading()) return;
    // Wait for the selected section when its lazy module is still loading.
    const observer = new MutationObserver(() => {
      if (focusHeading()) observer.disconnect();
    });
    observer.observe(detail, { childList: true, subtree: true, attributes: true });
    return () => observer.disconnect();
  }, [activeChapter, detailRequest, fullReport]);
  function selectChapter(next: Chapter) {
    requestedChapter.current = null;
    setFullReport(false);
    setChapter(next);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}${buildReportSectionHash(`planner-section-${next}`)}`,
    );
  }
  function openChapter(next: Chapter) {
    selectChapter(next);
    requestedChapter.current = next;
    setDetailRequest((request) => request + 1);
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
      {w.viewingHistoryReport && (
        <aside className="field-feedback" aria-label="Saved report snapshot">
          This is a saved snapshot. It shows conditions from when it was generated
          and won’t update. For current conditions, edit the plan and generate a new report.
        </aside>
      )}
      <div className="field-report-toolbar">
        <span>
          Generated {ageLabel(data.generatedAt)} ·{" "}
          {w.objectiveTimezone || "Objective local time"}
        </span>
        <div>
          {flags.reportHistory && (
            <button disabled={actionBusy || Boolean(w.activeSavedReportId)} onClick={onSave}>
              {w.activeSavedReportId ? <Check size={14} /> : <Download size={14} />}
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
              if ((event.target as HTMLElement).closest("button")) {
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus({ preventScroll: true });
              }
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
              <button onClick={() => window.print()}>Print current view</button>
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
              "Some sources returned incomplete data. Check the official forecasts before committing."}
          </span>
        </div>
      )}
      {passed && (
        <div className="field-warning">
          <div>
            <strong>This report’s planned start has passed.</strong>
            <p>
              The forecast below is kept for reference. Pick a new start to get
              current conditions.
            </p>
            <div className="field-action-row">
              <button
                className="field-button"
                onClick={w.handleUseNowAfterPastStart}
              >
                Start now
              </button>
              <button
                className="field-button"
                onClick={w.handleUseTomorrowAfterPastStart}
              >
                Start tomorrow
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
          onSources={() => openChapter("sources")}
        />
        <ReportSummary workspace={w} onOpen={openChapter} />
      </div>
      <div className="field-report-layout">
        <div className="report-section-navigation" ref={navigationRef}>
          <div className="report-reading-controls">
            <div>
              <h2>Report sections</h2>
              <p role="status" aria-live="polite" aria-atomic="true">
                {fullReport ? "All sections in one view" : `Viewing ${activeChapterLabel}`}
              </p>
            </div>
            <button
              type="button"
              className="field-button"
              aria-pressed={fullReport}
              aria-controls="field-report-detail"
              onClick={() => setFullReport((value) => !value)}
            >
              <BookOpen size={16} aria-hidden="true" />
              {fullReport ? "Back to sections" : "Read full report"}
            </button>
          </div>
          <label className="report-section-picker">
            <span>Report section</span>
            <select
              value={fullReport ? "all" : activeChapter}
              aria-controls="field-report-detail"
              onChange={(event) => {
                if (event.target.value === "all") setFullReport(true);
                else selectChapter(event.target.value as Chapter);
              }}
            >
              {visibleChapters.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              <option value="all">All sections</option>
            </select>
          </label>
          <nav className="field-chapters" aria-label="Report sections">
            {visibleChapters.map((c) => (
              <button
                key={c.id}
                aria-current={!fullReport && activeChapter === c.id ? "page" : undefined}
                aria-controls="field-report-detail"
                onClick={() => selectChapter(c.id)}
              >
                <c.icon size={17} aria-hidden="true" />
                <strong>{c.label}</strong>
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            ))}
          </nav>
        </div>
        <div className="field-chapter-content" id="field-report-detail" ref={detailRef}>
          <Suspense
            fallback={
              <p className="field-loading" role="status">
                Loading section…
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
            {flags.gearRecommendations && (
              <GearActions
                key={JSON.stringify([report.plan, data.generatedAt, data.gear])}
                hidden={!fullReport && activeChapter !== "gear"}
                recommendations={w.gearRecommendations}
                decision={decision}
                actionLine={w.decisionActionLine}
                onSources={() => selectChapter("sources")}
              />
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
            contextLabel={`${report.plan.objectiveName} · ${dateLabel(report.plan.forecastDate)}`}
            initialMessages={w.reportChatMessages}
            onMessagesChange={w.setReportChatMessages}
            readOnly={w.viewingHistoryReport}
          />
        </Suspense>
      )}
      <ReportInsights data={data} localize={w.localizeUnitText} onSources={() => openChapter("sources")} />
      <p className="field-muted">
        Backcountry Conditions is a planning aid, not a guarantee of safety. Check
        official forecasts, and make the final call from what you see in the field
        and your team’s judgment.
      </p>
    </div>
  );
}
