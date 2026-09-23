import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
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
  Info,
  TriangleAlert,
} from "lucide-react";
import { GearActions } from "./GearActions";
import { ReportInsights } from "./ReportInsights";
import "./report-reading.css";
import "./report-navigation.css";
import { AiExplanation, AiExplanationSkeleton } from "./AiExplanation";
import { SkyHero } from "./sky/SkyHero";
import { DayStrip } from "./sky/DayStrip";
import { ApproachNote } from "./sky/ApproachNote";
import { BriefSections } from "./sky/BriefSections";
import { buildSkyHours } from "./sky/sky-model";
import { verdictCopy } from "./verdict-copy";
import { buildPlannedReportWeatherRows } from "./report-weather";
import { minutesToTwentyFourHourClock } from "../app/core";
import "./sky/sky.css";
import "./sky/parts.css";
import "./sky/chapters.css";
import "./sky/skin.css";
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
type View = Chapter | "brief" | "all";
function viewFromHash(): View {
  const hash = parseReportSectionHash(window.location.hash) || "";
  if (!hash) return "brief";
  if (hash === "planner-section-all") return "all";
  return chapterFromHash(hash);
}
function chapterFromHash(hash: string): Chapter {
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
  const [view, setView] = useState<View>(viewFromHash);
  const topRef = useRef<HTMLDivElement>(null);
  const briefScroll = useRef(0);
  // An anchor asks to land on a specific part of a (possibly lazy) chapter.
  const focusRequest = useRef<"chapter" | "brief" | { anchor: string } | null>(null);
  const [navigation, setNavigation] = useState(0);
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
  const activeView: View = view === "brief" || view === "all" || visibleChapters.some((c) => c.id === view)
    ? view
    : "forecast";
  const chapterIndex = visibleChapters.findIndex((c) => c.id === activeView);
  const activeChapter = chapterIndex >= 0 ? visibleChapters[chapterIndex] : null;
  const fullReport = activeView === "all";

  // The planned day, as the sky and day strip draw it.
  const plannedRows = buildPlannedReportWeatherRows(data, w.preferences, w.travelWindowHours, {
    start: w.alpineStartTime,
    date: w.forecastDate,
    approach: w.approachProfile,
  });
  const skyHours = buildSkyHours(plannedRows, {
    start: w.alpineStartTime,
    sunriseMinutes: w.sunriseMinutesForPlan,
    sunsetMinutes: w.sunsetMinutesForPlan,
  });
  const clock = (minute: number) =>
    w.formatClockForStyle(minutesToTwentyFourHourClock(((minute % 1440) + 1440) % 1440), w.preferences.timeStyle);
  const copy = verdictCopy({ data, decision, primaryReason: w.fieldBriefPrimaryReason, preferences: w.preferences });

  useEffect(() => {
    const listener = () => setView(viewFromHash());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    // Only an explicit navigation moves focus; loading a report must not.
    const request = focusRequest.current;
    focusRequest.current = null;
    if (!request) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (request === "brief") {
      window.scrollTo({ top: briefScroll.current, behavior: "instant" });
      topRef.current?.querySelector<HTMLElement>("#field-verdict-title")?.focus({ preventScroll: true });
      return;
    }
    if (typeof request === "object") {
      const root = topRef.current;
      if (!root) return;
      const land = () => {
        const target = root.querySelector<HTMLElement>(`#${request.anchor}`);
        if (!target) return false;
        target.scrollIntoView({ block: "start", behavior: reduced ? "instant" : "smooth" });
        const section = target.closest("section") ?? target;
        (section.querySelector<HTMLElement>("input:not(:disabled)") ?? target).focus({ preventScroll: true });
        return true;
      };
      if (land()) return;
      // The chapter may still be loading; land as soon as it renders.
      const observer = new MutationObserver(() => { if (land()) stop(); });
      const timer = window.setTimeout(() => stop(), 5000);
      const stop = () => { observer.disconnect(); window.clearTimeout(timer); };
      observer.observe(root, { childList: true, subtree: true });
      return stop;
    }
    topRef.current?.scrollIntoView({ block: "start", behavior: reduced ? "instant" : "smooth" });
    const heading = topRef.current?.querySelector<HTMLElement>(".sky-chapter-head h1");
    heading?.focus({ preventScroll: true });
  }, [navigation]);
  function go(next: View, anchor?: string) {
    if (activeView === "brief") briefScroll.current = window.scrollY;
    focusRequest.current = next === "brief" ? "brief" : anchor ? { anchor } : "chapter";
    setView(next);
    setNavigation((n) => n + 1);
    const hash = next === "brief" ? "" : buildReportSectionHash(`planner-section-${next}`);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}${hash}`,
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
  const actions = (
    <div className="field-report-actions">
      {flags.reportHistory && (
        <button disabled={actionBusy || Boolean(w.activeSavedReportId)} onClick={onSave}>
          {w.activeSavedReportId ? <Check size={14} /> : <Download size={14} />}
          <span className="sky-action-label">{w.activeSavedReportId ? "Saved" : "Save"}</span>
        </button>
      )}
      {flags.reportSharing && (
        <button disabled={actionBusy} onClick={onShare}>
          <Link size={14} />
          <span className="sky-action-label">{w.copiedLink ? "Copied" : "Share"}</span>
        </button>
      )}
      {flags.objectiveWatch && (
        <button disabled={actionBusy} onClick={onWatch}>
          <Bell size={14} />
          <span className="sky-action-label">Watch</span>
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
          <span className="sr-only">More actions</span>
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
      <button className="is-prominent" onClick={onEdit}>
        Edit plan
        <ArrowUpRight size={16} />
      </button>
    </div>
  );
  const notices = (
    <>
      {w.viewingHistoryReport && (
        <aside className="sky-notice" aria-label="Saved report snapshot">
          <BookOpen size={20} aria-hidden="true" />
          <div>This is a saved snapshot. It shows conditions from when it was generated
            and won’t update. For current conditions, edit the plan and generate a new report.</div>
        </aside>
      )}
      {feedback && (
        <p className="sky-notice is-info" role="status">
          {feedback}
        </p>
      )}
      {(data.partialData || data.apiWarning || w.hasFreshnessWarning) && (
        <div className="sky-notice is-missing" role="status">
          <TriangleAlert size={20} aria-hidden="true" />
          <div>
            {data.apiWarning ||
              w.freshnessWarningSummary ||
              "Some sources returned incomplete data. Check the official forecasts before committing."}
          </div>
          <button type="button" className="sky-link" onClick={() => go("sources")}>Checks &amp; sources</button>
        </div>
      )}
      {(copy.warnings.length > 0 || copy.missing.length > 0) && (
        <div className="sky-notice is-caution" aria-label="Warnings and evidence gaps">
          <TriangleAlert size={20} aria-hidden="true" />
          <div>
            {copy.warnings.length > 0 && <>
              <strong>Field reports to check.</strong>{" "}
              {copy.warnings.map((signal) => `${signal.title}: ${signal.detail}`).join(" · ")}{" "}
              Check when each report was made and whether it applies to your route.
            </>}
            {copy.missing.length > 0 && <span> {copy.missing.map((signal) => signal.title).join(" · ")}. Missing data does not mean conditions are clear.</span>}
          </div>
        </div>
      )}
      {passed && (
        <div className="sky-notice is-caution">
          <TriangleAlert size={20} aria-hidden="true" />
          <div>
            <strong>This report’s planned start has passed.</strong>{" "}
            The forecast below is kept for reference. Pick a new start to get current conditions.
            <div className="field-action-row">
              <button className="field-button" onClick={w.handleUseNowAfterPastStart}>
                Start now
              </button>
              <button className="field-button" onClick={w.handleUseTomorrowAfterPastStart}>
                Start tomorrow
              </button>
            </div>
          </div>
        </div>
      )}
      {w.tripForecastRows.length > 0 && (
        <div className="field-preset-list" role="group" aria-label="Days from your comparison">
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
    </>
  );
  const subtitle = (
    <>
      {dateLabel(report.plan.forecastDate)} · {w.displayStartTime} start · {report.plan.travelWindowHours} hours
      {data.weather.elevation != null && <> · {w.formatElevationDisplay(Number(data.weather.elevation))}</>}
      <span className="sky-generated"> · Generated {ageLabel(data.generatedAt)}</span>
    </>
  );
  const approachNote = (
    <ApproachNote
      hours={skyHours}
      source={w.approachProfile?.source ?? null}
      clock={clock}
      elevation={(ft) => w.formatElevationDisplay(ft)}
      onEdit={w.viewingHistoryReport ? undefined : () => go("terrain", "sky-terrain-approach")}
    />
  );
  const chapterContent = (id: Chapter) => {
    if (id === "forecast") return (
      <section key="forecast" className="sky-chapter" aria-label="Weather">
        <Forecast report={report} approach={w.approachProfile} elevation={(ft) => w.formatElevationDisplay(ft)} />
        <Conditions workspace={w} />
      </section>
    );
    if (id === "timing") return <Timing key="timing" workspace={w} hours={skyHours} />;
    if (id === "terrain") return <Terrain key="terrain" workspace={w} hours={skyHours} />;
    if (id === "sources") return <Sources key="sources" workspace={w} />;
    if (id === "route" && flags.routeAnalysis) return <Route key="route" workspace={w} />;
    return null;
  };
  return (
    <div className={`field-report sky-report is-${activeView === "brief" ? "brief" : "chapter"}`} ref={topRef}>
      {activeView === "brief" ? (
        <SkyHero
          hours={skyHours}
          sunrise={w.sunriseMinutesForPlan}
          sunset={w.sunsetMinutesForPlan}
          kicker={w.viewingHistoryReport ? "Saved conditions report" : "Conditions report"}
          title={report.plan.objectiveName}
          subtitle={subtitle}
          level={decision.level}
          headline={decision.headline}
          reason={copy.reason}
          bridge={copy.bridge}
          note={approachNote}
          actions={actions}
          format={{
            temp: (f) => w.formatTempDisplay(f),
            wind: (mph) => w.formatWindDisplay(mph),
            elevation: (ft) => w.formatElevationDisplay(ft),
            clock,
            timeStyle: w.preferences.timeStyle,
          }}
        />
      ) : (
        <header className="sky-chapter-head">
          <div className="sky-chapter-bar">
            <button type="button" className="sky-back" onClick={() => go("brief")}>
              <ArrowLeft size={18} aria-hidden="true" />
              Brief
            </button>
            {actions}
          </div>
          <div className="sky-chapter-title">
            <div>
              <span className="sky-kicker">{report.plan.objectiveName} · {dateLabel(report.plan.forecastDate)}</span>
              <h1 tabIndex={-1}>{fullReport ? "Full report" : activeChapter?.label}</h1>
            </div>
            <DayStrip hours={skyHours} clock={clock} elevation={(ft) => w.formatElevationDisplay(ft)} />
          </div>
          {!fullReport && (
            <nav className="sky-chapter-tabs" aria-label="Report sections">
              {visibleChapters.map((c) => (
                <button key={c.id} type="button" aria-current={activeView === c.id ? "page" : undefined} onClick={() => go(c.id)}>
                  {c.label}
                </button>
              ))}
              <button type="button" onClick={() => go("all")}>All sections</button>
            </nav>
          )}
        </header>
      )}
      <div className="sky-body">
        {notices}
        {activeView === "brief" && (
          <BriefSections
            w={w}
            hours={skyHours}
            clock={clock}
            scoreValue={copy.scoreValue}
            insufficient={copy.insufficient}
            bridge={copy.bridge}
            onOpen={(next) => go(next)}
            onReadAll={() => go("all")}
            routeEnabled={flags.routeAnalysis}
            gearEnabled={flags.gearRecommendations}
          />
        )}
        {fullReport && (
          <div className="report-overview sky-full-summary">
            <section className={`sky-verdict-card is-${copy.tone}`} aria-labelledby="sky-full-verdict">
              <span className={`sky-pill is-${copy.tone}`}>
                {copy.tone === "go" ? <Check size={17} aria-hidden="true" /> : <TriangleAlert size={17} aria-hidden="true" />}
                <span><span className="sr-only">Trip decision: </span>{decision.level === "GO" ? "Go" : decision.level === "NO-GO" ? "No-go" : "Caution"}</span>
              </span>
              <h2 id="sky-full-verdict">{decision.headline}</h2>
              <p className="sky-verdict-reason">{copy.reason}</p>
              {copy.bridge && <p className="sky-cap">{copy.bridge}</p>}
              {approachNote}
              <p className="sky-cap">{subtitle}</p>
            </section>
            <BriefSections
              w={w}
              hours={skyHours}
              clock={clock}
              scoreValue={copy.scoreValue}
              insufficient={copy.insufficient}
              bridge={copy.bridge}
              onOpen={(next) => go(next)}
              onReadAll={() => go("all")}
              routeEnabled={flags.routeAnalysis}
              gearEnabled={flags.gearRecommendations}
              showMore={false}
            />
          </div>
        )}
        <div className="field-chapter-content" id="field-report-detail">
          <Suspense
            fallback={
              <p className="field-loading" role="status">
                Loading section…
              </p>
            }
          >
            {fullReport
              ? visibleChapters.filter((c) => c.id !== "gear").map((c) => (
                <section key={c.id} className="sky-chapter-block" aria-labelledby={`sky-chapter-${c.id}`}>
                  <h2 className="sky-chapter-name" id={`sky-chapter-${c.id}`}>{c.label}</h2>
                  {chapterContent(c.id)}
                </section>
              ))
              : activeChapter && chapterContent(activeChapter.id)}
            {fullReport && flags.gearRecommendations && (
              <h2 className="sky-chapter-name sky-chapter-block">Gear &amp; actions</h2>
            )}
            {flags.gearRecommendations && (
              <GearActions
                key={JSON.stringify([report.plan, data.generatedAt, data.gear])}
                hidden={!fullReport && activeView !== "gear"}
                recommendations={w.gearRecommendations}
                decision={decision}
                actionLine={w.decisionActionLine}
                onSources={() => go("sources")}
              />
            )}
          </Suspense>
        </div>
        {activeChapter && (
          <nav className="sky-pager" aria-label="Chapters">
            {chapterIndex > 0 ? (
              <button type="button" onClick={() => go(visibleChapters[chapterIndex - 1].id)}>
                <span>Previous</span><strong>‹ {visibleChapters[chapterIndex - 1].label}</strong>
              </button>
            ) : (
              <button type="button" onClick={() => go("brief")}><span>Back to</span><strong>‹ Brief</strong></button>
            )}
            {chapterIndex < visibleChapters.length - 1 ? (
              <button type="button" className="is-next" onClick={() => go(visibleChapters[chapterIndex + 1].id)}>
                <span>Next</span><strong>{visibleChapters[chapterIndex + 1].label} ›</strong>
              </button>
            ) : (
              <button type="button" className="is-next" onClick={() => go("brief")}><span>Done</span><strong>Brief ›</strong></button>
            )}
          </nav>
        )}
        {activeView === "brief" && (w.aiBriefNarrative || (ai.aiBrief && !w.viewingHistoryReport)) && (
          <section
            className="field-panel ai-brief"
            aria-labelledby="ai-brief-title"
            aria-busy={w.aiBriefLoading}
          >
            <div className="ai-brief-heading">
              <div>
                <span className="field-kicker ai-brief-kicker">
                  <Sparkles size={14} aria-hidden="true" />
                  AI explanation
                </span>
                <h2 id="ai-brief-title">The report, explained</h2>
              </div>
              {w.aiBriefNarrative && !w.viewingHistoryReport && (
                <button
                  className="field-button ai-brief-regenerate"
                  disabled={!ai.aiBrief}
                  aria-disabled={w.aiBriefLoading || undefined}
                  onClick={w.handleRequestAiBriefAction}
                >
                  <RefreshCw
                    size={14}
                    aria-hidden="true"
                    className={w.aiBriefLoading ? "is-spinning" : undefined}
                  />
                  {w.aiBriefLoading ? "Rewriting…" : "Regenerate"}
                </button>
              )}
            </div>
            {w.aiBriefError && (
              <p className="field-warning" role="alert">
                {w.aiBriefError}
              </p>
            )}
            {w.aiBriefNarrative ? (
              <>
                <AiExplanation text={w.aiBriefNarrative} stale={w.aiBriefLoading} />
                <p className="ai-brief-footnote">
                  <Info size={13} aria-hidden="true" />
                  Written by AI from this report’s data and can be wrong. It never
                  changes the decision or score.
                </p>
              </>
            ) : (
              <>
                <div className="ai-brief-empty">
                  <p>
                    A plain-language read of this report: what drives the decision,
                    what to watch, and the best move for your plan.
                  </p>
                  <button
                    className="field-button field-button-primary"
                    aria-disabled={w.aiBriefLoading || undefined}
                    onClick={w.handleRequestAiBriefAction}
                  >
                    <Sparkles size={16} aria-hidden="true" />
                    {w.aiBriefLoading ? "Writing explanation…" : "Explain this report"}
                  </button>
                </div>
                {w.aiBriefLoading && <AiExplanationSkeleton />}
              </>
            )}
          </section>
        )}
        {activeView === "brief" && (ai.reportChat || w.reportChatMessages.length > 0) && (
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
        {(activeView === "brief" || fullReport) && (
          <ReportInsights data={data} localize={w.localizeUnitText} onSources={() => go("sources")} />
        )}
        <p className="field-muted">
          Backcountry Conditions is a planning aid, not a guarantee of safety. Check
          official forecasts, and make the final call from what you see in the field
          and your team’s judgment.
        </p>
      </div>
    </div>
  );
}
