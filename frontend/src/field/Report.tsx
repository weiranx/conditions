import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { flushSync } from "react-dom";
import {
  ArrowDown,
  ArrowUpRight,
  Bell,
  BellRing,
  BookOpen,
  Check,
  Clock3,
  Download,
  Link,
  Mail,
  Ellipsis,
  Info,
  Printer,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { GearActions, GearLead } from "./GearActions";
import { ReportInsights } from "./ReportInsights";
import "./report-reading.css";
import "./report-navigation.css";
import { AiRead } from "./AiRead";
import { AiLead, SourcesLead, TerrainLead, TimingLead } from "./chapter-leads";
import { ForecastDiscussion } from "./ForecastDiscussion";
import { starterQuestions, suggestedQuestions } from "./ai-explanation";
import { aiChapterText, isOutdatedRead, shownAiHero } from "../app/ai-evidence";
import { SkyHero } from "./sky/SkyHero";
import { ApproachNote } from "./sky/ApproachNote";
import { summarizePlannedRoute } from "./route-planning";
import { closeDetailsOnOutsidePress } from "./touch";
import { Fold } from "./sky/Fold";
import { insightCounts } from "../app/report-insights";
import { BriefSections, StatusTag } from "./sky/BriefSections";
import { buildBrief, sectionChecks } from "./sky/brief-model";
import { DeferredSection, ReportNav, type ReportPlace } from "./sky/ReportNav";
import { landOn, sectionsReady } from "./sky/report-scroll";
import { placeToReturnTo, reportPlaceKey, useKeepReportPlace, type ReadingPlace } from "./report-place";
import { REPORT_CHAPTERS, type ReportChapter } from "./sky/report-chapters";
import { buildSkyHours } from "./sky/sky-model";
import { plainHeadline } from "./sky/plain-headline";
import { minutesToTwentyFourHourClock } from "../app/core";
import { activityProfile, reportActivity, type ActivityChapter } from "../app/activity-profiles";
import "./sky/sky.css";
import "./sky/parts.css";
import "./sky/chapters.css";
import "./sky/skin.css";
import type { PersistedReport } from "../app/report-storage";
import type { Workspace } from "./model/useWorkspace";
import { resolveReportFeatureFlags } from "../contexts/feature-flags";
import { useAiAvailability, useAiEnabled } from "../hooks/useAiAvailability";
import { useOpeningHold } from "../hooks/useOpeningHold";
import { getPastPlannedStart } from "../app/planned-start";
import {
  parseReportSectionHash,
  buildReportSectionHash,
} from "../app/report-sections";
import { useWhere } from "../hooks/useWhere";
import { ageLabel, dateLabel } from "./data";
import { Forecast, ForecastLead } from "./Forecast";
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
const TripDebrief = lazy(() => import("./TripDebrief").then((m) => ({ default: m.TripDebrief })));
const chapters = REPORT_CHAPTERS;
type Chapter = ReportChapter;
/** The section a report link names, if any; the whole-report link names none. */
function chapterFromHash(): Chapter | null {
  const hash = parseReportSectionHash(window.location.hash) || "";
  if (!hash || hash === "planner-section-all") return null;
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
  watching = false,
  onOpenWatchlist,
  onShare,
  onEmail,
  actionBusy,
  feedback,
  feedbackAction,
  kept,
}: {
  report: PersistedReport;
  workspace: Workspace;
  onEdit: () => void;
  onSave: () => void;
  onWatch: () => void;
  /** The signed-in account already watches this exact plan. */
  watching?: boolean;
  onOpenWatchlist?: () => void;
  onShare: () => void;
  onEmail: () => void;
  actionBusy: boolean;
  feedback: string;
  feedbackAction?: { label: string; onClick: () => void };
  /** Where the reader was in a report, kept while the report is closed for another page. */
  kept?: MutableRefObject<ReadingPlace | null>;
}) {
  const placeKey = reportPlaceKey(report);
  // Back from another page, the report opens where it was left.
  const [returning] = useState(() => placeToReturnTo(kept?.current, placeKey));
  const topRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  // The report is one page: the summary, then every section. The bar marks where the reader is.
  const [place, setPlace] = useState<ReportPlace>("summary");
  // Sections render as the reader nears them, or when they jump to one.
  // Back at an old spot, the sections above it render at once so the page is as tall as it was.
  const [mounted, setMounted] = useState<ReadonlySet<Chapter>>(() => new Set(
    chapters.map((c) => c.id).filter((id) => returning?.sections.includes(id)),
  ));
  // A jump lands on a part of a section once it, and every section above it, has rendered.
  const landing = useRef<{ chapter: Chapter; anchor?: string; smooth: boolean; needed: Chapter[] } | null>(null);
  const [navigation, setNavigation] = useState(0);
  // A question asked from the AI read, handed to the report assistant.
  // It belongs to one conversation: a new report's assistant never receives it.
  const [chatAsk, setChatAsk] = useState<{ id: number; text: string; session: number } | null>(null);
  const data = report.safetyData;
  const flags = resolveReportFeatureFlags(data.featureFlags);
  const ai = useAiAvailability(data.capabilities);
  // Turned off on the plan form, the report is the checks' alone: no AI read, chat or route analysis.
  const aiEnabled = useAiEnabled();
  // The app shows a report only once the backend has evaluated it for the plan.
  const evaluation = w.evaluation!;
  const decision = evaluation.decision;
  const emailNeedsSave = !w.sharedReportToken && !w.activeSavedReportId;
  const passed = getPastPlannedStart(
    report.plan.forecastDate,
    report.plan.alpineStartTime,
    w.objectiveTimezone,
  );
  // The report reads in the order its activity needs, e.g. snow first for a ski tour.
  const activity = activityProfile(reportActivity(report));
  const chapterRank = (id: Chapter) => {
    const index = activity.report.chapters.indexOf(id as ActivityChapter);
    return index < 0 ? chapters.findIndex((c) => c.id === id) + activity.report.chapters.length : index;
  };
  const routeChapter = Boolean(flags.routeAnalysis) && aiEnabled;
  const visibleChapters = chapters
    .filter((c) => c.id !== "route" || routeChapter)
    .filter((c) => c.id !== "gear" || flags.gearRecommendations)
    .sort((a, b) => chapterRank(a.id) - chapterRank(b.id));

  // The planned day, as the sky and day strip draw it.
  const plannedApproach = evaluation.travelWindow.planned.approachSummary;
  const skyHours = buildSkyHours(evaluation.travelWindow.planned.rows, {
    start: w.alpineStartTime,
    sunriseMinutes: w.sunriseMinutesForPlan,
    sunsetMinutes: w.sunsetMinutesForPlan,
  });
  const clock = (minute: number) =>
    w.formatClockForStyle(minutesToTwentyFourHourClock(((minute % 1440) + 1440) % 1440), w.preferences.timeStyle);
  const copy = evaluation.verdict;
  // Say what crosses your limits and when, in plain words; the decision's own headline covers the rest.
  const plain = plainHeadline(skyHours, clock);
  const headline = plain ?? decision.headline;
  // The route chosen in the plan, once the report has a Route chapter to show it.
  const route = routeChapter
    ? summarizePlannedRoute({
      name: w.plannedRouteName,
      analysis: w.routeAnalysis,
      // Analysis waits for a loading account before it starts.
      checking: w.routeLoadingState?.kind === "analysis"
        ? { checkpointCount: w.routeLoadingState.checkpointCount, routeName: w.routeLoadingState.routeName }
        : w.accountLoading && !w.viewingHistoryReport ? {} : null,
      error: w.routeError,
      limits: w.preferences,
      signedIn: Boolean(w.accountUser),
      available: ai.routeAnalysis,
      saved: w.viewingHistoryReport,
    })
    : null;
  // A route can cross boundaries, so the areas come from everywhere it goes.
  const routePoints = w.routeAnalysis?.routeGeometry ?? w.routeAnalysis?.waypoints;
  const { lat: objectiveLat, lon: objectiveLon } = data.location;
  const hasRoute = routeChapter;
  const wherePoints = useMemo(
    () => [{ lat: objectiveLat, lon: objectiveLon }, ...(hasRoute && routePoints ? routePoints : [])],
    [objectiveLat, objectiveLon, hasRoute, routePoints],
  );
  const where = useWhere(report.plan.objectiveName, wherePoints);
  const eta = (time: string) => w.formatClockForStyle(time, w.preferences.timeStyle);
  // The brief's checks also say which sections hold a problem.
  const brief = buildBrief({ w, hours: skyHours, clock, route, activity: reportActivity(report) });

  useKeepReportPlace(kept, placeKey, mounted, returning);
  const mount = useCallback((id: Chapter) => {
    setMounted((previous) => (previous.has(id) ? previous : new Set(previous).add(id)));
  }, []);
  useEffect(() => {
    // Only an explicit navigation moves focus; loading a report must not.
    const request = landing.current;
    landing.current = null;
    const root = topRef.current;
    if (!request || !root) return;
    let stopFollowing: (() => void) | null = null;
    const attempt = (force = false) => {
      if (!force && !sectionsReady(root, request.needed)) return false;
      const target = (request.anchor ? root.querySelector<HTMLElement>(`#${request.anchor}`) : null)
        ?? root.querySelector<HTMLElement>(`#sky-chapter-${request.chapter}`);
      if (!target) return false;
      stopFollowing = landOn(target, { smooth: request.smooth });
      return true;
    };
    if (attempt()) return () => stopFollowing?.();
    // The sections may still be loading; land as soon as they render.
    const observer = new MutationObserver(() => { if (attempt()) stopWaiting(); });
    const timer = window.setTimeout(() => { stopWaiting(); attempt(true); }, 5000);
    const stopWaiting = () => { observer.disconnect(); window.clearTimeout(timer); };
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-mounted"] });
    return () => { stopWaiting(); stopFollowing?.(); };
  }, [navigation]);
  useEffect(() => {
    // The bar follows the reading: the section whose heading has passed under it.
    let frame = 0;
    const update = () => {
      frame = 0;
      const root = topRef.current;
      const nav = navRef.current;
      if (!root || !nav) return;
      const line = nav.getBoundingClientRect().bottom + 24;
      const blocks = [...root.querySelectorAll<HTMLElement>("[data-chapter]")];
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let current: ReportPlace = "summary";
      for (const block of blocks) if (block.getBoundingClientRect().top <= line) current = block.dataset.chapter as Chapter;
      if (atEnd && blocks.length && blocks[0].getBoundingClientRect().top <= line) current = blocks[blocks.length - 1].dataset.chapter as Chapter;
      setPlace(current);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);
  useEffect(() => {
    // A printed report holds every section, with its warnings and the AI read's detail open.
    const all = () => {
      flushSync(() => setMounted(new Set(chapters.map((c) => c.id))));
      topRef.current?.querySelectorAll<HTMLDetailsElement>("details.sky-notice-fold, details.ai-read-fold, details.supplemental-source, details.sky-check-passed").forEach((fold) => { fold.open = true; });
    };
    window.addEventListener("beforeprint", all);
    return () => window.removeEventListener("beforeprint", all);
  }, []);
  // The actions menu closes when focus leaves it, which never happens on iOS Safari: a tap elsewhere closes it instead.
  useEffect(() => closeDetailsOnOutsidePress(".report-actions-menu"), []);
  // The AI read is part of the report, so it is written as the report opens,
  // once per report and plan, unless the reader turned that off.
  const autoReadKey = useRef<string | null>(null);
  const readKey = `${data.generatedAt ?? ""}|${JSON.stringify(evaluation.params ?? null)}`;
  // An admin switch: off, the read sits at the end of Checks & sources and is written only on request.
  const aiFirst = ai.aiReport;
  // Under AI-first the AI writes the report's opening; the badge and the checks
  // beside it still come from the evaluation.
  // The opening a read in progress just wrote leads, so AI text reaches the top
  // in seconds rather than when the whole read is done.
  const hero = aiFirst ? shownAiHero(w.aiReadRun, w.aiBriefDetails, decision.level) : null;
  const heroHeadline = hero?.headline ?? headline;
  const heroReason = hero?.reason ?? copy.reason;
  const autoReadWanted = aiFirst && w.preferences.autoAiRead && ai.aiBrief && !w.viewingHistoryReport;
  const autoRead = autoReadWanted && Boolean(w.accountUser);
  // A read written before the AI also wrote the report's opening (no hero in its
  // details) is outdated under AI-first, so it is written again once.
  const outdatedRead = isOutdatedRead(w.aiBriefNarrative, w.aiBriefDetails);
  const [checksWording, setChecksWording] = useState(false);
  const openingPending = aiFirst && !hero && w.aiBriefLoading && w.aiReadRun?.opening === "pending";
  // The checks' wording never comes first: while an AI read is about to write this
  // report's first opening, or is writing it, the top waits for the AI, including
  // while the account it needs is loading and after the fast opening fails, until
  // the full read brings its own. The badge, timeline and checks show meanwhile.
  // Only a read that ends without an opening, a reader who turns out to be signed
  // out, or an answer that never arrives (useOpeningHold's time limit) lets the checks' wording through.
  const firstRead = !w.aiBriefNarrative || outdatedRead;
  const readStarting = autoReadWanted && (Boolean(w.accountUser) || w.accountLoading);
  const opening = useOpeningHold({
    expected: aiFirst && !hero && firstRead && !w.aiBriefError && (w.aiBriefLoading || readStarting),
    key: readKey,
  });
  // Says which text is the AI's and keeps the checks' own wording one tap away,
  // so the reader can see what the AI changed.
  const heroByline = hero ? (
    <div className="sky-ai-byline">
      <p>
        <Sparkles size={13} aria-hidden="true" />
        <span>Worded by AI; the call comes from the checks.</span>
        <button type="button" aria-expanded={checksWording} onClick={() => setChecksWording((open) => !open)}>
          {checksWording ? "Hide the checks’ wording" : "Show the checks’ wording"}
        </button>
      </p>
      {checksWording && (
        <p className="sky-checks-wording">
          <span className="sky-checks-wording-label">The checks wrote</span>
          <strong>{headline}.</strong> {copy.reason}
        </p>
      )}
    </div>
  ) : opening.holding || openingPending ? (
    <div className="sky-ai-byline is-pending" role="status">
      <p>
        <Sparkles size={13} aria-hidden="true" />
        <span>
          {opening.holding
            ? "AI is writing this opening from the report’s data…"
            : opening.expired
              ? "AI is still writing. This opening is from the checks for now."
              : "AI is reading the report to rewrite this opening…"}
        </span>
      </p>
    </div>
  ) : null;
  // Where snow shapes the trip, the AI read also looks at a satellite image of it (the backend decides).
  const readsSatellite = Boolean(evaluation.snowTravel?.consequential) && flags.satelliteImagery && flags.snowpackDetails && ai.snowVision;
  useEffect(() => {
    if (!autoRead || (w.aiBriefNarrative && !outdatedRead) || w.aiBriefLoading || w.aiBriefError) return;
    const key = outdatedRead ? `${readKey}|outdated` : readKey;
    if (autoReadKey.current === key) return;
    autoReadKey.current = key;
    void w.handleRequestAiBriefAction({ opening: true });
  }, [autoRead, readKey, outdatedRead, w.aiBriefNarrative, w.aiBriefLoading, w.aiBriefError, w]);
  function go(next: ReportPlace, anchor?: string, smooth = true) {
    const hash = next === "summary" ? "" : buildReportSectionHash(`planner-section-${next}`);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}${hash}`,
    );
    if (next === "summary") {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      window.scrollTo({ top: 0, behavior: reduced ? "instant" : "smooth" });
      topRef.current?.querySelector<HTMLElement>("#field-verdict-title")?.focus({ preventScroll: true });
      return;
    }
    const index = visibleChapters.findIndex((c) => c.id === next);
    if (index < 0) return;
    const needed = visibleChapters.slice(0, index + 1).map((c) => c.id);
    setMounted((previous) => (needed.every((id) => previous.has(id)) ? previous : new Set([...previous, ...needed])));
    landing.current = { chapter: next, anchor, smooth, needed };
    setNavigation((n) => n + 1);
  }
  function toAiRead() {
    const read = document.getElementById("ai-read");
    if (read) landOn(read, { smooth: true });
  }
  function printReport() {
    // Every section renders before the page prints.
    setMounted(new Set(chapters.map((c) => c.id)));
    const root = topRef.current;
    const ids = visibleChapters.map((c) => c.id);
    const started = Date.now();
    const wait = () => {
      if (!root || sectionsReady(root, ids) || Date.now() - started > 4000) window.print();
      else window.setTimeout(wait, 100);
    };
    window.setTimeout(wait, 0);
  }
  // A link to a section opens the report there.
  const goRef = useRef<typeof go | null>(null);
  useEffect(() => { goRef.current = go; });
  useEffect(() => {
    const open = (smooth: boolean) => {
      const chapter = chapterFromHash();
      if (chapter) goRef.current?.(chapter, undefined, smooth);
    };
    // Back from another page, the spot the reader left beats the section last jumped to.
    if (!returning) open(false);
    const listener = () => open(true);
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, [returning]);
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
          {flags.reportHistory && (
            <button disabled={actionBusy || Boolean(w.activeSavedReportId)} onClick={onSave}>
              {w.activeSavedReportId ? <Check size={16} /> : <Download size={16} />}
              {w.activeSavedReportId ? "Saved" : "Save report"}
            </button>
          )}
          {flags.reportSharing && (
            <button disabled={actionBusy} onClick={onShare}>
              <Link size={16} />
              {w.copiedLink ? "Link copied" : "Share link"}
            </button>
          )}
          {flags.objectiveWatch && (watching && onOpenWatchlist ? (
            <button onClick={onOpenWatchlist} title="Open this plan in your watchlist">
              <BellRing size={16} />
              Watching
            </button>
          ) : (
            <button disabled={actionBusy} onClick={onWatch}>
              <Bell size={16} />
              Watch this plan
            </button>
          ))}
          <button
            disabled={actionBusy}
            onClick={onEmail}
            title={emailNeedsSave ? "Saves this report to your account and emails you a link" : undefined}
          >
            <Mail size={16} />
            {emailNeedsSave ? "Save & email report" : "Email report"}
          </button>
          <button onClick={w.handleRetryFetch}>
            <RefreshCw size={16} />
            Refresh conditions
          </button>
          <button onClick={download}>
            <ArrowDown size={16} />
            Export report data
          </button>
          <button onClick={printReport}>
            <Printer size={16} />
            Print report
          </button>
        </div>
      </details>
      <button className="is-prominent" onClick={onEdit}>
        Edit plan
        <ArrowUpRight size={16} />
      </button>
    </div>
  );
  const dataWarning = data.partialData || data.apiWarning || evaluation.interpretation.sourceFreshness.hasWarning
    ? data.apiWarning ||
      evaluation.interpretation.sourceFreshness.warningSummary ||
      "Some sources returned incomplete data. Check the official forecasts before committing."
    : "";
  // Each warning stays one tap away; closed, the notice is a single line of what needs checking.
  const cautionLine = [
    dataWarning ? "Some sources returned incomplete data" : null,
    copy.warnings.length ? `${copy.warnings.length} field ${copy.warnings.length === 1 ? "report" : "reports"} to check` : null,
    copy.missing.length === 1 ? copy.missing[0].title : copy.missing.length > 1 ? `${copy.missing.length} feeds unavailable` : null,
  ].filter(Boolean).join(" · ");
  // A borderline plan offers a watch beside the decision rather than in a banner.
  const watchOffer = flags.objectiveWatch && !watching && !feedback && !w.viewingHistoryReport && copy.tone === "watch" && !copy.insufficient ? (
    <button type="button" className="sky-pill-aside" disabled={actionBusy} onClick={onWatch}>
      <Bell size={14} aria-hidden="true" />
      Watch this plan
    </button>
  ) : null;
  const notices = (
    <>
      {w.viewingHistoryReport && (w.restoredReportSource === "itinerary" ? (
        <aside className="sky-notice" aria-label="Trip day">
          <BookOpen size={20} aria-hidden="true" />
          <div>This day was checked with your trip and won’t update on its own.
            For newer forecasts, go back to the trip brief and check the trip again.</div>
        </aside>
      ) : (
        <aside className="sky-notice" aria-label="Saved report snapshot">
          <BookOpen size={20} aria-hidden="true" />
          <div>This is a saved snapshot. It shows conditions from when it was generated
            and won’t update. For current conditions, edit the plan and generate a new report.</div>
        </aside>
      ))}
      {feedback && (
        <p className="sky-notice is-info is-compact" role="status">
          <Info size={16} aria-hidden="true" />
          <span className="sky-notice-line">{feedback}</span>
          {feedbackAction && (
            <button type="button" className="sky-link" onClick={feedbackAction.onClick}>{feedbackAction.label}</button>
          )}
        </p>
      )}
      {cautionLine && (
        <details className="sky-notice sky-notice-fold is-caution is-compact" aria-label="Warnings and evidence gaps">
          <summary>
            <TriangleAlert size={16} aria-hidden="true" />
            <span className="sky-notice-line">{cautionLine}</span>
          </summary>
          <div className="sky-notice-body">
            {dataWarning && <p>{dataWarning}</p>}
            {copy.warnings.length > 0 && <p>
              <strong>Field reports to check.</strong>{" "}
              {copy.warnings.map((signal) => `${signal.title}: ${signal.detail}`).join(" · ")}{" "}
              Check when each report was made and whether it applies to your route.
            </p>}
            {copy.missing.length > 0 && <p>{copy.missing.map((signal) => signal.title).join(" · ")}. Missing data does not mean conditions are clear.</p>}
            {dataWarning && <button type="button" className="sky-link" onClick={() => go("sources", "sky-sources-fresh")}>Checks &amp; sources</button>}
          </div>
        </details>
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
      {/* Line breaks fall between the parts, never inside "7:00 AM" or "13,775 ft". */}
      {where && <>{where} · </>}
      {route && <>via {route.name} · </>}
      <span className="sky-nowrap">{dateLabel(report.plan.forecastDate)}</span> · <span className="sky-nowrap">starts {w.displayStartTime}</span> · <span className="sky-nowrap">{report.plan.travelWindowHours} hours</span>
      <span className="sky-subtitle-meta">
        {data.weather.elevation != null && <><span className="sky-nowrap">{w.formatElevationDisplay(Number(data.weather.elevation))}</span> · </>}
        <span className="sky-generated">Generated {ageLabel(data.generatedAt)}</span>
      </span>
    </>
  );
  // On the brief the passed start leads the hero, before the decision it dates.
  const passedStatus = passed && !w.viewingHistoryReport ? (
    <div className="sky-passed" role="status">
      <Clock3 size={16} aria-hidden="true" />
      <p><strong>This start has passed.</strong> The forecast is kept for reference.</p>
      <div className="sky-passed-actions">
        <button type="button" onClick={w.handleUseNowAfterPastStart}>Start now</button>
        <button type="button" onClick={w.handleUseTomorrowAfterPastStart}>Start tomorrow</button>
      </div>
    </div>
  ) : null;
  const approachNote = (
    <ApproachNote
      hours={skyHours}
      summary={plannedApproach}
      source={w.planApproach?.source ?? null}
      clock={clock}
      elevation={(ft) => w.formatElevationDisplay(ft)}
      onEdit={w.viewingHistoryReport ? undefined : () => go("terrain", "sky-terrain-approach")}
      terms={w.objectiveTerms}
      text={hero?.note?.text}
      writing={opening.holding}
      compact
    />
  );
  const chapterContent = (id: Chapter) => {
    if (id === "forecast") return (
      <section key="forecast" className="sky-chapter" aria-label="Weather">
        <Forecast report={report} evaluation={evaluation} elevation={(ft) => w.formatElevationDisplay(ft)} terms={w.objectiveTerms} lead={false} />
        {aiEnabled && (
          <ForecastDiscussion
            folded
            report={data}
            objectiveName={report.plan.objectiveName}
            units={{ temperature: w.preferences.temperatureUnit, wind: w.preferences.windSpeedUnit, elevation: w.preferences.elevationUnit }}
            available={ai.aiBrief}
            timeStyle={w.preferences.timeStyle}
          />
        )}
        <Conditions workspace={w} hours={skyHours} />
      </section>
    );
    if (id === "timing") return <Timing key="timing" workspace={w} hours={skyHours} />;
    if (id === "terrain") return <Terrain key="terrain" workspace={w} hours={skyHours} />;
    if (id === "sources") return <Sources key="sources" workspace={w} more={sourcesMore} />;
    if (id === "route" && routeChapter) return <Route key="route" workspace={w} />;
    if (id === "gear" && flags.gearRecommendations) return (
      <GearActions
        key={JSON.stringify([report.plan, data.generatedAt, data.gear])}
        hidden={false}
        recommendations={w.gearRecommendations}
        decision={decision}
        actionLine={w.decisionActionLine}
        onSources={() => go("sources")}
        activityLabel={data.forecast?.activity ? activity.label : null}
        localize={w.localizeUnitText}
        lead={false}
      />
    );
    return null;
  };
  // Each chapter opens with one lead, in its heading so it shows before the chapter loads:
  // under AI-first the AI's analysis of the chapter when it wrote one, otherwise the checks' sentence.
  const chapterLead = (id: Chapter) => {
    const text = aiFirst ? aiChapterText(w.aiBriefNarrative, w.aiBriefDetails, id) : null;
    if (text) return <AiLead text={text} onReadAll={toAiRead} />;
    if (id === "forecast") return <ForecastLead report={report} evaluation={evaluation} elevation={(ft) => w.formatElevationDisplay(ft)} terms={w.objectiveTerms} />;
    if (id === "timing") return <TimingLead workspace={w} hours={skyHours} />;
    if (id === "terrain") return <TerrainLead workspace={w} />;
    if (id === "sources") return <SourcesLead workspace={w} />;
    if (id === "gear" && flags.gearRecommendations) return <GearLead decision={decision} actionLine={w.decisionActionLine} />;
    return null;
  };
  const showChat = aiEnabled && (ai.reportChat || w.reportChatMessages.length > 0);
  const starters = starterQuestions(decision.level);
  const aiRead = aiEnabled && (
    <AiRead
      narrative={w.aiBriefNarrative}
      details={w.aiBriefDetails}
      loading={w.aiBriefLoading}
      error={w.aiBriefError}
      briefAvailable={ai.aiBrief}
      chatAvailable={ai.reportChat}
      readOnly={w.viewingHistoryReport}
      fallbackQuestions={starters}
      run={w.aiReadRun}
      acrossReport={aiFirst}
      openingRewritten={Boolean(hero)}
      readsSatellite={readsSatellite}
      chatBelow={aiFirst && showChat}
      onRequest={() => void w.handleRequestAiBriefAction({ opening: aiFirst })}
      onAsk={(text) => {
        if (!w.requestAiAccess()) return;
        setChatAsk((previous) => ({ id: (previous?.id ?? 0) + 1, text, session: w.reportChatSessionKey }));
      }}
      onOpen={(chapter) => go(chapter)}
    />
  );
  const chat = showChat && (
    <Suspense fallback={<p>Loading report assistant…</p>}>
      <Chat
        key={w.reportChatSessionKey}
        reportPayload={w.rawReportPayload}
        contextLabel={`${report.plan.objectiveName} · ${dateLabel(report.plan.forecastDate)}`}
        initialMessages={w.reportChatMessages}
        onMessagesChange={w.setReportChatMessages}
        readOnly={w.viewingHistoryReport}
        starters={suggestedQuestions(w.aiBriefDetails?.questions, starters)}
        ask={chatAsk?.session === w.reportChatSessionKey ? chatAsk : null}
      />
    </Suspense>
  );
  // A read the reader can write or ask about; under AI-first it leads the brief instead.
  const aiReadShown = aiEnabled && Boolean(w.aiBriefNarrative || ((ai.aiBrief || ai.reportChat) && !w.viewingHistoryReport));
  const insights = insightCounts(data);
  // Reference at the end of Checks & sources, each folded.
  const sourcesMore = (
    <>
      {!aiFirst && (aiReadShown || showChat) && (
        <Fold id="sky-sources-ai" title="AI read" hint={w.aiBriefNarrative ? "What this means for your plan, and ask about it" : "A plain-language read of this report"}>
          {aiRead}
          {chat}
        </Fold>
      )}
      {insights.cautions > 0 ? (
        <Fold id="sky-sources-insights" title="Field and access flags"
          hint={`${insights.cautions} ${insights.cautions === 1 ? "check" : "checks"} to resolve before you commit`}>
          <ReportInsights data={data} localize={w.localizeUnitText} onSources={() => go("sources")} timeStyle={w.preferences.timeStyle} />
        </Fold>
      ) : (
        <ReportInsights data={data} localize={w.localizeUnitText} onSources={() => go("sources")} timeStyle={w.preferences.timeStyle} />
      )}
    </>
  );
  const debrief = w.viewingHistoryReport && w.restoredReportSource === "saved" && w.accountUser ? (
    <Suspense fallback={null}>
      <TripDebrief report={report} aiAvailable={ai.tripDebrief} formatClock={eta} />
    </Suspense>
  ) : null;
  return (
    <div className="field-report sky-report is-brief" ref={topRef}>
      <SkyHero
        hours={skyHours}
        sunrise={w.sunriseMinutesForPlan}
        sunset={w.sunsetMinutesForPlan}
        kicker={`${w.restoredReportSource === "itinerary" ? "Trip day report" : w.viewingHistoryReport ? "Saved conditions report" : "Conditions report"} · ${activity.label}`}
        title={report.plan.objectiveName}
        subtitle={subtitle}
        status={passedStatus}
        level={decision.level}
        headline={heroHeadline}
        reason={heroReason}
        writing={opening.holding}
        spanInHeadline={!hero && plain !== null}
        pillAside={watchOffer}
        limitingChecks={copy.limitingChecks}
        note={heroByline}
        actions={actions}
        photo={data.objectiveImage}
        format={{
          temp: (f) => w.formatTempDisplay(f),
          wind: (mph) => w.formatWindDisplay(mph),
          elevation: (ft) => w.formatElevationDisplay(ft),
          clock,
          timeStyle: w.preferences.timeStyle,
        }}
      />
      <div className="sky-body">
        <ReportNav
          navRef={navRef}
          active={place}
          onPick={(next) => go(next)}
          sections={visibleChapters.map((c) => ({ id: c.id, label: c.label, short: c.short, status: sectionChecks(brief, c.id).status }))}
        />
        {notices}
        {aiFirst && (
          <>
            {aiRead}
            {chat}
          </>
        )}
        <BriefSections
          brief={brief}
          w={w}
          hours={skyHours}
          clock={clock}
          route={route}
          activity={reportActivity(report)}
          onOpen={(chapter, anchor) => go(chapter, anchor)}
          notes={approachNote}
        />
        <div className="field-chapter-content" id="field-report-detail">
          {visibleChapters.map((c) => {
            const { checks } = sectionChecks(brief, c.id);
            const ready = mounted.has(c.id);
            return (
              <section key={c.id} className="sky-chapter-block" data-chapter={c.id} data-mounted={ready ? "true" : "false"} aria-labelledby={`sky-chapter-${c.id}`}>
                <header className="sky-chapter-top">
                  <h2 className="sky-chapter-name" id={`sky-chapter-${c.id}`} tabIndex={-1}>{c.label}</h2>
                  {checks.length > 0 && (
                    <ul className="sky-chapter-checks" aria-label={`${c.label} checks`}>
                      {checks.map((check) => (
                        <li key={check.key}>
                          <span>{check.title}</span>
                          <StatusTag status={check.status}>{check.statusText}</StatusTag>
                        </li>
                      ))}
                    </ul>
                  )}
                </header>
                {chapterLead(c.id)}
                <DeferredSection id={c.id} mounted={ready} onNear={mount}>
                  <Suspense fallback={<p className="field-loading sky-section-loading" role="status">Loading {c.label.toLowerCase()}…</p>}>
                    {chapterContent(c.id)}
                  </Suspense>
                </DeferredSection>
              </section>
            );
          })}
        </div>
        {debrief}
        <p className="field-muted">
          Backcountry Conditions is a planning aid, not a guarantee of safety. Check
          official forecasts, and make the final call from what you see in the field
          and your team’s judgment.
        </p>
      </div>
    </div>
  );
}
