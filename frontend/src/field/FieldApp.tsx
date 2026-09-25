import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  CloudOff,
  Compass,
  Layers,
  LoaderCircle,
  Map,
  Mountain,
  Settings2,
  ShieldCheck,
  Sunrise,
  UserRound,
} from "lucide-react";
import { useWorkspace } from "./model/useWorkspace";
import { useObjectiveWatchStatus } from "./model/useObjectiveWatchStatus";
import { useAccount } from "../hooks/useAccount";
import { AiAccessContext } from "../contexts/ai-access";
import {
  buildSavedReportShareUrl,
  sendReportEmail,
} from "../lib/saved-reports";
import { copyTextToClipboard } from "../app/clipboard";
import { markLandingSeen } from "../app/landing-gate";
import { saveObjectiveWatch } from "../lib/objective-watches";
import { saveTrip, watchTripDays } from "../lib/saved-trips";
import { convertElevationFeetToDisplayValue } from "../app/core";
import {
  loadPersistedReport,
  parsePersistedReport,
  type PersistedReport,
} from "../app/report-storage";
import { dateLabel, peaks, type Plan } from "./data";
import { WorkspacePlan } from "./WorkspacePlan";
import { buildTripOverlay } from "./itinerary-overlay";
import { Dialog } from "./Dialog";
import { BrandMark } from "./BrandMark";
import { hasCoarsePointer } from "./touch";
import { revealStart, scrollPageToTop, useNewPageStartsAtTop } from "./page-scroll";
import type { AppView } from "../hooks/useUrlState";
import "./field.css";
import "./workspace.css";
import "./mobile.css";
import "./polish.css";
import "./sky/tokens.css";
import "./sky/shell.css";
import "./sky/sky.css";
import "./sky/parts.css";
import "./sky/chapters.css";
import "./sky/screens.css";
import "./sky/skin.css";
const Report = lazy(() =>
  import("./Report").then((module) => ({ default: module.Report })),
);
const FieldMap = lazy(() => import("./FieldMap"));
const Legal = lazy(() => import("./Legal"));
const Compare = lazy(() => import("./Compare"));
const Itinerary = lazy(() =>
  import("./Itinerary").then((module) => ({ default: module.Itinerary })),
);
const Operations = lazy(() => import("./Operations"));
const Administration = lazy(() => import("./Administration"));

const Settings = lazy(() =>
  import("./Settings").then((module) => ({ default: module.Settings })),
);
const Library = lazy(() =>
  import("./Library").then((module) => ({ default: module.Library })),
);

export default function FieldApp() {
  const w = useWorkspace();
  const account = useAccount();
  const [feedback, setFeedback] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const watchStatus = useObjectiveWatchStatus(
    w.reportSnapshot?.plan ?? null,
    account.user?.id ?? null,
    w.view === "planner" && w.featureFlags.objectiveWatch,
  );
  const [touch] = useState(hasCoarsePointer);
  const mapRef = useRef<HTMLDivElement>(null);
  // Anyone who has opened the planner goes straight back to it from `/`.
  useEffect(markLandingSeen, []);
  const plan: Plan = {
    name: w.objectiveName,
    lat: w.hasObjective ? w.position.lat : null,
    lon: w.hasObjective ? w.position.lng : null,
    date: w.forecastDate,
    start: w.alpineStartTime,
    hours: w.travelWindowHours,
    activity: w.preferences.defaultActivity,
    route: w.importedGpxRoute,
  };
  const nav = [
    { id: "home", label: "Workspace", short: "Plan", icon: Compass },
    { id: "planner", label: "Conditions brief", short: "Brief", icon: Map },
    ...(w.featureFlags.tripPlanning
      ? [{ id: "trip", label: "Compare", short: "Compare", icon: Sunrise }]
      : []),
    ...(w.featureFlags.reportHistory
      ? [{ id: "history", label: "Saved reports", short: "Saved", icon: BookOpen }]
      : []),
    ...(w.featureFlags.objectiveWatch
      ? [{ id: "watches", label: "Watchlist", short: "Watchlist", icon: Bell }]
      : []),
  ];
  const pageLabels: Record<string, string> = {
    settings: "Preferences",
    account: "Your account",
    admin: "Administration",
    status: "Service status",
    privacy: "Privacy",
    terms: "Terms",
  };
  const pageLabel = nav.find((item) => item.id === w.view)?.label || pageLabels[w.view] || "Planning";
  // The brief is replaced by a loading state while a new one is generated.
  useNewPageStartsAtTop(w.view, w.view === "planner" && w.loading);
  function navigate(page: AppView) {
    setFeedback("");
    if (page === w.view) {
      scrollPageToTop();
      return;
    }
    // Leaving an opened trip day puts the trailhead back as the objective.
    if (w.itinerary.openDayIndex !== null && page !== "planner") w.closeItineraryDay(false);
    if (page === "trip") w.openTripToolView();
    else w.navigateToView(page);
  }
  function openReport(report: PersistedReport, token = "", reportId?: string) {
    const parsed = parsePersistedReport(report);
    if (parsed) {
      w.handleOpenSavedReport(parsed, token);
      if (reportId) {
        w.setActiveSavedReportId(reportId);
        w.setActiveSavedReportShareToken(token);
      }
    }
    else w.setError("This report is incomplete and could not be opened.");
  }
  async function action(kind: "save" | "share" | "watch" | "email") {
    const report = w.reportSnapshot;
    if (!report || actionBusy || w.reportSaveIntentRef.current === "saving") return;
    if (kind === "share") {
      let token = w.sharedReportToken || w.activeSavedReportShareToken;
      // A plan link makes a new report without the route analysis or AI work,
      // so a signed-in user's report is saved and its saved copy is shared.
      let saveFailed = false;
      if (!token && account.user) {
        setActionBusy(true);
        setFeedback("");
        try {
          const saved = await w.saveReportSnapshot(report, (result) => {
            account.syncGeneratedReportUsage(account.user!.id, result.reportCount, result.reportUsage);
          });
          if (!saved) return;
          token = saved.shareToken;
        } catch {
          saveFailed = true;
        } finally {
          setActionBusy(false);
        }
      }
      const link = token
        ? buildSavedReportShareUrl(
            token,
            window.location.origin,
            window.location.hash.slice(1),
          )
        : window.location.href;
      const copied = await copyTextToClipboard(link);
      const described = token
        ? "Report link copied."
        : `Plan link copied. ${saveFailed ? "The report could not be saved, so this" : "This"} link makes a new report without the route analysis or AI brief${saveFailed ? "." : "; sign in to share the report itself."}`;
      setFeedback(copied ? described : `Share link: ${link}`);
      return;
    }
    if (!account.user) {
      w.setAccountAccessReason(kind === "email" ? "report-email" : "ai");
      return;
    }
    setActionBusy(true);
    setFeedback("");
    try {
      if (kind === "watch") {
        const { policy } = await saveObjectiveWatch(report);
        watchStatus.markWatched();
        setFeedback(policy.automaticChecks
          ? "Added to your watchlist. Automatic checks will flag meaningful changes from this report."
          : "Added to your watchlist. Run checks from the watchlist to compare with this report.");
      } else {
        let token = kind === "save"
          ? w.activeSavedReportShareToken
          : w.sharedReportToken || w.activeSavedReportShareToken;
        // Emailing links to a saved copy, so an unsaved report is saved first.
        const savedForEmail = !token;
        if (!token) {
          const saved = await w.saveReportSnapshot(report, (result) => {
            account.syncGeneratedReportUsage(account.user!.id, result.reportCount, result.reportUsage);
          });
          if (!saved) return;
          token = saved.shareToken;
        }
        if (kind === "email") {
          const sent = await sendReportEmail(report, token);
          setFeedback(savedForEmail ? `Report saved to your account. ${sent}` : sent);
        }
        else {
          setFeedback("Report saved to your account.");
        }
      }
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Could not complete this action.",
      );
    } finally {
      setActionBusy(false);
    }
  }
  const it = w.itinerary;
  const multiDay = it.mode === "multi";
  // The trip being built, or the one last checked, drawn over the map.
  const tripOverlay = multiDay ? buildTripOverlay(it.draft, it.assessment) : null;
  // A map tap sets whichever trip point is waiting for one, else the objective.
  function pickOnMap(lat: number, lon: number) {
    const target = it.pickTarget;
    if (!multiDay || !target) {
      w.handleMapPositionChange({ lat, lng: lon });
      return;
    }
    const point = { name: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon, elevationFt: null };
    it.updateDraft((draft) => {
      if (target.kind === "camp") {
        return { ...draft, camps: draft.camps.map((camp, index) => (index === target.index ? { point, layover: false } : camp)) };
      }
      if (target.kind === "exit") return { ...draft, exit: point };
      if (target.kind === "bail") return { ...draft, bailPoints: [...draft.bailPoints, point].slice(0, 4) };
      return {
        ...draft,
        days: draft.days.map((day, index) => (index === target.day ? { ...day, checkpoints: [...day.checkpoints, { ...point, name: "High point" }].slice(0, 2) } : day)),
      };
    });
    it.setPickTarget(null);
  }
  async function tripAction(kind: "save" | "watch") {
    const result = it.result;
    if (!result || actionBusy) return;
    if (!account.user) {
      w.setAccountAccessReason("ai");
      return;
    }
    setActionBusy(true);
    setFeedback("");
    try {
      if (kind === "save") {
        await saveTrip(it.draft, result);
        setFeedback("Trip saved to your account. Find it under Saved reports.");
        return;
      }
      const outcome = await watchTripDays(
        it.draft,
        result,
        w.preferences,
        (feet) => String(Math.round(convertElevationFeetToDisplayValue(feet, w.preferences.elevationUnit))),
        w.todayDate,
      );
      const days = (list: number[]) => list.map((index) => index + 1).join(", ");
      if (outcome.watched.length === 0) {
        setFeedback(outcome.error || "No upcoming day of this trip could be watched.");
        return;
      }
      const watchedText = `Watching day${outcome.watched.length > 1 ? "s" : ""} ${days(outcome.watched)} in your watchlist.`;
      const automatic = outcome.policy?.automaticChecks
        ? " Automatic checks will flag meaningful changes."
        : " Run checks from the watchlist to compare with this trip.";
      setFeedback(outcome.limited
        ? `${watchedText} Your plan's watch limit stopped the rest: ${outcome.error}`
        : outcome.error
          ? `${watchedText} ${outcome.error}`
          : `${watchedText}${automatic}`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not complete this action.");
    } finally {
      setActionBusy(false);
    }
  }
  function editTrip() {
    navigate("home");
  }
  function chooseOnMap() {
    w.setShowSuggestions(false);
    mapRef.current?.focus({ preventScroll: true });
    mapRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }
  function returnToPlan() {
    const search = w.searchInputRef.current;
    const form = search?.form;
    const target = w.hasObjective && !w.objectiveDraftDirty
      ? form?.querySelector<HTMLInputElement>('input[type="date"]')
      : search;
    target?.focus({ preventScroll: true });
    form?.scrollIntoView({ block: "start", behavior: "instant" });
  }
  const map = (
    <div
      className="field-planner-map"
      ref={mapRef}
      role="region"
      aria-labelledby="field-objective-map-title"
      tabIndex={-1}
    >
      <div className="field-planner-map-heading">
        <div>
          <span className="field-kicker" id="field-objective-map-title">{multiDay ? "Trip map" : "Objective map"}</span>
          <span role="status">
            {multiDay && it.pickTarget
              ? it.pickTarget.kind === "camp"
                ? `Tap the map to place the camp for night ${it.pickTarget.index + 1}`
                : it.pickTarget.kind === "exit"
                  ? "Tap the map to place the exit"
                  : it.pickTarget.kind === "bail"
                    ? "Tap the map to add a bail point"
                    : `Tap the map to add a high point for day ${it.pickTarget.day + 1}`
              : plan.lat === null
                ? "Choose a location on the map"
                : `${plan.lat.toFixed(4)}°, ${plan.lon?.toFixed(4)}° selected`}
          </span>
        </div>
        <button type="button" className="field-text-button" onClick={returnToPlan}>
          <ArrowLeft size={15} aria-hidden="true" />
          Back to plan
        </button>
      </div>
      <Suspense
        fallback={<div className="field-map-loading">Loading map…</div>}
      >
        <FieldMap
          plan={plan}
          workspace={w}
          trip={tripOverlay}
          onPick={pickOnMap}
        />
      </Suspense>
      <div className="field-map-note">
        <Layers size={16} />
        <p>
          {touch
            ? "Tap to select a point, then return to your plan. Move or zoom the map with two fingers."
            : "Select a point, then return to your plan. Switch map layers for terrain, roads, or satellite imagery."}
        </p>
      </div>
    </div>
  );
  return (
    <AiAccessContext.Provider value={w.aiAccessContextValue}>
      <div className="field-app">
        <a className="field-skip" href="#field-main">
          Skip to content
        </a>
        <aside className="field-sidebar">
          <a
            className="field-brand"
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate("home");
            }}
          >
            <span className="sky-brand-tile">
              <BrandMark size={20} />
            </span>
            <strong>
              Backcountry <small>Conditions</small>
            </strong>
          </a>
          <span className="field-sidebar-label">PLANNING TOOLS</span>
          <nav aria-label="Main navigation">
            {nav.map((item) => (
              <button
                key={item.id}
                aria-current={w.view === item.id ? "page" : undefined}
                onClick={() => navigate(item.id as AppView)}
              >
                <item.icon size={18} strokeWidth={1.6} aria-hidden="true" />
                <span className="field-nav-label">{item.label}</span>
                <span className="field-nav-short">{item.short}</span>
                {w.view === item.id && <span className="field-nav-dot" />}
              </button>
            ))}
          </nav>
          <div className="field-sidebar-bottom">
            {w.isAdminAccount && (
              <button
                title="Administration"
                aria-current={w.view === "admin" ? "page" : undefined}
                onClick={() => navigate("admin")}
              >
                <ShieldCheck size={17} />
                Administration
              </button>
            )}
            <button
              title="Preferences"
              aria-current={w.view === "settings" ? "page" : undefined}
              onClick={() => navigate("settings")}
            >
              <Settings2 size={17} />
              Preferences
            </button>
            <button
              title="Your account"
              aria-current={w.view === "account" ? "page" : undefined}
              onClick={() => navigate("account")}
            >
              {account.user ? (
                <span className="field-sidebar-avatar" aria-hidden="true">
                  {account.user.displayName.slice(0, 1).toUpperCase() || <UserRound size={13} />}
                </span>
              ) : (
                <UserRound size={17} />
              )}
              {account.user?.displayName || "Your account"}
            </button>
          </div>
        </aside>
        <div className="field-content">
          <header className="field-topbar">
            <span>
              <span>Backcountry</span>
              <span aria-hidden="true">/</span>
              <span className="field-breadcrumb-current">{pageLabel}</span>
            </span>
            <div>
              <span>{dateLabel(w.todayDate)}</span>
              <button
                onClick={() => {
                  if (w.itinerary.openDayIndex !== null) w.closeItineraryDay(false);
                  if (w.handleEditPlan()) navigate("planner");
                }}
              >
                New plan <ArrowUpRight size={14} />
              </button>
            </div>
          </header>
          <main id="field-main" tabIndex={-1}>
            {w.error && (
              <div className="field-warning" role="alert">
                <p>{w.error}</p>
                <button
                  className="field-text-button"
                  onClick={() => w.setError(null)}
                >
                  Dismiss
                </button>
              </div>
            )}
            {w.view === "home" && (
              <section className="field-workspace">
                <header className="field-workspace-heading">
                  <div>
                    <h1>Plan your next outing</h1>
                    <p>
                      Choose a location and time to check weather, terrain, and daylight.
                    </p>
                  </div>
                </header>
                <div className="field-planner-grid">
                  <WorkspacePlan workspace={w} onChooseMap={chooseOnMap} />
                  {map}
                </div>
                <div className="field-workspace-bottom">
                  <section className="field-quick-locations">
                    <h2>Quick locations</h2>
                    {peaks.map((peak) => (
                      <button
                        className="field-location-row"
                        key={peak.name}
                        onClick={() => {
                          w.selectSuggestion({
                            ...peak,
                            class: "natural",
                            type: "peak",
                          });
                          // On a phone the plan it fills in is a long way up.
                          revealStart(w.searchInputRef.current?.form ?? null);
                        }}
                      >
                        <Mountain size={16} />
                        <span>
                          {peak.name}
                          <small>{peak.region}</small>
                        </span>
                        <ArrowRight size={14} />
                      </button>
                    ))}
                  </section>
                  <section className="field-recent-brief">
                    <h2>Recent brief</h2>
                    {w.reportSnapshot ? (
                      <button
                        className="field-recent-row"
                        onClick={() => navigate("planner")}
                      >
                        <div>
                          <span className="field-kicker">
                            {dateLabel(w.reportSnapshot.plan.forecastDate)}
                          </span>
                          <strong>{w.reportSnapshot.plan.objectiveName}</strong>
                          <span>
                            {w.displayStartTime} · {w.travelWindowHours} hours
                          </span>
                        </div>
                        <span>
                          {w.safetyData?.safety.assessmentStatus === 'insufficient_evidence' ? 'Insufficient evidence' : w.safetyData?.safety.score}
                          {w.safetyData?.safety.assessmentStatus !== 'insufficient_evidence' && <small>/100</small>}
                        </span>
                        <ArrowUpRight size={17} />
                      </button>
                    ) : (
                      <div className="field-workspace-empty">
                        <BookOpen size={22} strokeWidth={1.5} aria-hidden="true" />
                        <strong>Your next outing starts here</strong>
                        <p>Create a conditions brief to keep weather, terrain, and daylight in one place.</p>
                      </div>
                    )}
                    <p className="field-muted">
                      Reports are planning aids. Check source freshness and
                      verify conditions in the field.
                    </p>
                  </section>
                </div>
              </section>
            )}
            {w.view === "planner" &&
              (w.sharedReportLoading ? (
                <div className="field-loading" role="status">
                  <LoaderCircle className="field-spin" />
                  <h1>Opening shared report</h1>
                </div>
              ) : w.sharedReportError ? (
                <div className="sky-card sky-empty-card sky-lost" role="alert">
                  <span className="sky-lost-icon" aria-hidden="true">
                    <CloudOff size={34} strokeWidth={1.6} />
                  </span>
                  <h1>Report unavailable</h1>
                  <p>{w.sharedReportError}</p>
                  <div className="sky-toolbar-actions">
                    <button
                      className="field-button field-button-primary"
                      onClick={w.retrySharedReport}
                    >
                      Try again
                    </button>
                    <button
                      className="field-button"
                      onClick={w.openBlankPlannerFromSharedReport}
                    >
                      Plan an outing
                    </button>
                  </div>
                </div>
              ) : multiDay && it.openDayIndex === null ? (
                it.loading ? (
                  <div className="field-loading" role="status">
                    <LoaderCircle className="field-spin" size={35} />
                    <span className="field-kicker">Trip check</span>
                    <h1>Checking {it.draft.camps.length + 1} days and {it.draft.camps.length} {it.draft.camps.length === 1 ? "night" : "nights"}</h1>
                    <p>Each day at its camp and high points, then each night at camp. This takes a little longer than a single day.</p>
                  </div>
                ) : it.result ? (
                  <Suspense fallback={<p role="status">Opening trip brief…</p>}>
                    <Itinerary
                      workspace={w}
                      onEdit={editTrip}
                      onSave={w.featureFlags.reportHistory ? () => void tripAction("save") : undefined}
                      onWatch={w.featureFlags.objectiveWatch ? () => void tripAction("watch") : undefined}
                      actionBusy={actionBusy}
                      feedback={feedback}
                    />
                  </Suspense>
                ) : (
                  <section className="field-planner">
                    <header className="field-page-heading">
                      <span className="field-kicker">New trip</span>
                      <h1>Plan a multi-day trip</h1>
                      <p>Set a trailhead, a camp for each night, and how long you hike each day.</p>
                    </header>
                    {it.error && (
                      <p className="sky-notice is-caution" role="alert">{it.error}</p>
                    )}
                    <div className="field-planner-grid">
                      <WorkspacePlan workspace={w} onChooseMap={chooseOnMap} />
                      {map}
                    </div>
                  </section>
                )
              ) : w.loading ? (
                <div className="field-loading" role="status">
                  <LoaderCircle className="field-spin" size={35} />
                  <span className="field-kicker">Conditions request</span>
                  <h1>Generating report</h1>
                  <p>Checking weather, snow, terrain, and source freshness.</p>
                </div>
              ) : w.reportSnapshot && !w.evaluation ? (
                w.evaluationError ? (
                  <div className="sky-card sky-empty-card sky-lost" role="alert">
                    <span className="sky-lost-icon" aria-hidden="true">
                      <CloudOff size={34} strokeWidth={1.6} />
                    </span>
                    <h1>Plan check unavailable</h1>
                    <p>{w.evaluationError} The forecast is kept; try the check again.</p>
                    <div className="sky-toolbar-actions">
                      <button className="field-button field-button-primary" onClick={w.retryEvaluation}>
                        Try again
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="field-loading" role="status">
                    <LoaderCircle className="field-spin" size={35} />
                    <span className="field-kicker">Conditions report</span>
                    <h1>Checking your plan</h1>
                    <p>Comparing the forecast with your limits and timing.</p>
                  </div>
                )
              ) : w.reportSnapshot ? (
                <Suspense
                  fallback={<p role="status">Opening conditions report…</p>}
                >
                  {w.restoredReportSource === "itinerary" && it.openDayIndex !== null && it.result && (
                    <TripDayBar workspace={w} />
                  )}
                  <Report
                    key={`${w.safetyData?.generatedAt}-${w.reportChatSessionKey}`}
                    report={w.reportSnapshot}
                    workspace={w}
                    onEdit={() => (w.restoredReportSource === "itinerary" ? editTrip() : w.handleEditPlan())}
                    onSave={() => void action("save")}
                    onShare={() => void action("share")}
                    onWatch={() => void action("watch")}
                    watching={watchStatus.watching}
                    onOpenWatchlist={() => navigate("watches")}
                    onEmail={() => void action("email")}
                    actionBusy={
                      actionBusy || w.reportSaveIntentRef.current === "saving"
                    }
                    feedback={feedback}
                  />
                </Suspense>
              ) : (
                <section className="field-planner">
                  <header className="field-page-heading">
                    <span className="field-kicker">New plan</span>
                    <h1>Plan an outing</h1>
                    <p>Set an objective, departure time, and duration.</p>
                  </header>
                  <div className="field-planner-grid">
                    <WorkspacePlan workspace={w} onChooseMap={chooseOnMap} />
                    {map}
                  </div>
                </section>
              ))}
            {w.view === "trip" && (
              <Suspense fallback={<p>Loading comparison…</p>}>
                <Compare workspace={w} />
              </Suspense>
            )}
            {(w.view === "history" || w.view === "watches") && (
              <Suspense fallback={<p role="status">Loading saved plans…</p>}>
                <Library
                  key={`${w.view}-${account.user?.id}`}
                  kind={w.view}
                  localReport={loadPersistedReport()}
                  onOpen={openReport}
                  workspace={w}
                  navigate={(page) => navigate(page as AppView)}
                />
              </Suspense>
            )}
            {(w.view === "settings" || w.view === "account") && (
              <Suspense fallback={<p role="status">Loading preferences…</p>}>
                <Settings
                  preferences={w.preferences}
                  onChange={(preferences) => w.updatePreferences(preferences)}
                  accountOnly={w.view === "account"}
                  workspace={w}
                />
              </Suspense>
            )}
            {(w.view === "privacy" || w.view === "terms") && (
              <Suspense fallback={<p>Loading policy…</p>}>
                <Legal kind={w.view} />
              </Suspense>
            )}
            {w.view === "status" && (
              <Suspense fallback={<p>Loading operations…</p>}>
                <Operations workspace={w} />
              </Suspense>
            )}
            {w.view === "admin" && w.isAdminAccount && (
              <Suspense fallback={<p>Loading administration…</p>}>
                <Administration />
              </Suspense>
            )}
            {(w.view === "not-found" || w.showAdminNotFound) && (
              <div className="sky-card sky-empty-card sky-lost">
                <span className="sky-lost-icon" aria-hidden="true">
                  <Compass size={34} strokeWidth={1.6} />
                </span>
                <span className="sky-lost-code">404</span>
                <h1>Off the map</h1>
                <p>This page could not be found. The link may be old, or the page may have moved.</p>
                <div className="sky-toolbar-actions">
                  <button
                    className="field-button field-button-primary"
                    onClick={() => navigate("home")}
                  >
                    Back to workspace
                  </button>
                  <button
                    className="field-button"
                    onClick={() => navigate("history")}
                  >
                    Saved reports
                  </button>
                </div>
              </div>
            )}
          </main>
          <footer className="field-footer">
            <span>
              <BrandMark size={16} />
              BACKCOUNTRY CONDITIONS
            </span>
            <p>A planning aid. Verify conditions in the field.</p>
            <div>
              <a href="/welcome">About</a>
              <a
                href="/status"
                onClick={(e) => {
                  e.preventDefault();
                  navigate("status");
                }}
              >
                Status
              </a>
              <a
                href="/privacy"
                onClick={(e) => {
                  e.preventDefault();
                  navigate("privacy");
                }}
              >
                Privacy
              </a>
              <a
                href="/terms"
                onClick={(e) => {
                  e.preventDefault();
                  navigate("terms");
                }}
              >
                Terms
              </a>
            </div>
          </footer>
        </div>
        {w.pastStartPrompt && (
          <Dialog
            title="This departure time has passed"
            onClose={() => w.setPastStartPrompt(null)}
          >
            <p>
              Choose a current departure before requesting a new forecast. Times
              follow the objective’s local time zone.
            </p>
            <div className="field-action-row">
              <button
                className="field-button field-button-primary"
                onClick={w.handleUseNowAfterPastStart}
              >
                Use now
              </button>
              <button
                className="field-button"
                onClick={w.handleUseTomorrowAfterPastStart}
              >
                Tomorrow at {w.displayDefaultStartTime}
              </button>
              <button
                className="field-button"
                onClick={() => w.setPastStartPrompt(null)}
              >
                Edit time
              </button>
            </div>
          </Dialog>
        )}
        {w.accountAccessReason && (
          <Dialog
            title={
              w.accountAccessReason.includes("limit")
                ? "Planning allowance reached"
                : "Sign in to continue"
            }
            onClose={w.closeAccountAccessPrompt}
          >
            {w.accountAccessReason.includes("limit") && (
              <p>
                Review your report, comparison, and AI allowances in your
                account. Monthly limits reset automatically.
              </p>
            )}
            <Suspense fallback={<p role="status">Loading account…</p>}>
              <Settings
                preferences={w.preferences}
                onChange={(p) => w.updatePreferences(p)}
                accountOnly
                workspace={w}
              />
            </Suspense>
          </Dialog>
        )}
      </div>
    </AiAccessContext.Provider>
  );
}

/** Above a trip day opened in the brief: where it sits in the trip, and the way back. */
function TripDayBar({ workspace: w }: { workspace: ReturnType<typeof useWorkspace> }) {
  const it = w.itinerary;
  const index = it.openDayIndex ?? 0;
  const stages = it.result?.stages ?? [];
  const stage = stages[index];
  const checked = (dayIndex: number) => Boolean(it.result?.results[dayIndex]?.report);
  const previous = [...stages.keys()].filter((dayIndex) => dayIndex < index && checked(dayIndex)).pop();
  const next = [...stages.keys()].find((dayIndex) => dayIndex > index && checked(dayIndex));
  if (!stage) return null;
  return (
    <div className="sky-trip-daybar" role="navigation" aria-label="Trip days">
      <button type="button" className="field-text-button" onClick={() => w.closeItineraryDay()}>
        <ArrowLeft size={15} aria-hidden="true" />
        Trip brief
      </button>
      <span>
        <strong>Day {index + 1} of {stages.length}</strong> · {stage.layover ? "Layover at" : "Ending at"} {stage.to.name || "camp"} · {dateLabel(stage.date)}
      </span>
      <nav>
        <button type="button" className="field-button" disabled={previous === undefined} onClick={() => previous !== undefined && w.openItineraryDay(previous)}>
          Previous day
        </button>
        <button type="button" className="field-button" disabled={next === undefined} onClick={() => next !== undefined && w.openItineraryDay(next)}>
          Next day
        </button>
      </nav>
    </div>
  );
}
