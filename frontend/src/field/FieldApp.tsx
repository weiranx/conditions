import { lazy, Suspense, useState } from "react";
import L from "leaflet";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
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
import { useAccount } from "../hooks/useAccount";
import { AiAccessContext } from "../contexts/ai-access";
import {
  createSavedReport,
  buildSavedReportShareUrl,
  sendReportEmail,
} from "../lib/saved-reports";
import { copyTextToClipboard } from "../app/clipboard";
import { saveObjectiveWatch } from "../lib/objective-watches";
import {
  loadPersistedReport,
  parsePersistedReport,
  type PersistedReport,
} from "../app/report-storage";
import { dateLabel, peaks, type Plan } from "./data";
import { WorkspacePlan } from "./WorkspacePlan";
import { Settings } from "./Settings";
import { Library } from "./Library";
import { Dialog } from "./Dialog";
import type { AppView } from "../hooks/useUrlState";
import "./field.css";
import "./workspace.css";
import "./mobile.css";
const Report = lazy(() =>
  import("./Report").then((module) => ({ default: module.Report })),
);
const FieldMap = lazy(() => import("./FieldMap"));
const Legal = lazy(() => import("./Legal"));
const Compare = lazy(() => import("./Compare"));
const Operations = lazy(() => import("./Operations"));
const Administration = lazy(() => import("./Administration"));

export default function FieldApp() {
  const w = useWorkspace();
  const account = useAccount();
  const [feedback, setFeedback] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
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
    { id: "home", label: "Workspace", icon: Compass },
    { id: "planner", label: "Conditions brief", icon: Map },
    ...(w.featureFlags.tripPlanning
      ? [{ id: "trip", label: "Compare days", icon: Sunrise }]
      : []),
    ...(w.featureFlags.reportHistory
      ? [{ id: "history", label: "Saved reports", icon: BookOpen }]
      : []),
    ...(w.featureFlags.objectiveWatch
      ? [{ id: "watches", label: "Watchlist", icon: Bell }]
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
  function navigate(page: AppView) {
    setFeedback("");
    if (page === "trip") w.openTripToolView();
    else w.navigateToView(page);
  }
  function openReport(report: PersistedReport, token = "") {
    const parsed = parsePersistedReport(report);
    if (parsed) w.handleOpenSavedReport(parsed, token);
    else w.setError("This report is incomplete and could not be opened.");
  }
  async function action(kind: "save" | "share" | "watch" | "email") {
    const report = w.reportSnapshot;
    if (!report || actionBusy) return;
    if (kind === "share") {
      const token = w.sharedReportToken || w.activeSavedReportShareToken;
      const link = token
        ? buildSavedReportShareUrl(
            token,
            window.location.origin,
            window.location.hash.slice(1),
          )
        : window.location.href;
      const copied = await copyTextToClipboard(link);
      setFeedback(
        copied ? "Plan or saved report link copied." : `Share link: ${link}`,
      );
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
        await saveObjectiveWatch(report);
        setFeedback("This objective is on your watchlist.");
      } else {
        let token = w.sharedReportToken || w.activeSavedReportShareToken;
        if (!token) {
          const saved = await createSavedReport(report);
          token = saved.shareToken;
          w.setActiveSavedReportId(saved.id);
          w.setActiveSavedReportShareToken(token);
          w.reportSaveIntentRef.current = "browser-only";
          account.syncGeneratedReportUsage(
            account.user.id,
            saved.reportCount,
            saved.reportUsage,
          );
        }
        if (kind === "email") setFeedback(await sendReportEmail(report, token));
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
  const map = (
    <div className="field-planner-map">
      <div>
        <span className="field-kicker">Objective map</span>
        <span>
          {plan.lat === null
            ? "Choose a location on the map"
            : `${plan.lat.toFixed(4)}°, ${plan.lon?.toFixed(4)}°`}
        </span>
      </div>
      <Suspense
        fallback={<div className="field-map-loading">Loading map…</div>}
      >
        <FieldMap
          plan={plan}
          workspace={w}
          onPick={(lat, lon) =>
            w.handleMapPositionChange(new L.LatLng(lat, lon))
          }
        />
      </Suspense>
      <div className="field-map-note">
        <Layers size={16} />
        <p>
          Select a point or search for an objective. Switch map layers for
          terrain, roads, or satellite imagery.
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
            <span>
              <Mountain size={25} strokeWidth={1.4} />
            </span>
            <strong>
              Backcountry<small>CONDITIONS</small>
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
                <item.icon size={18} strokeWidth={1.6} />
                <span>{item.label}</span>
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
              <UserRound size={17} />
              {account.user?.displayName || "Your account"}
            </button>
          </div>
        </aside>
        <div className="field-content">
          <header className="field-topbar">
            <span>
              BACKCOUNTRY / {pageLabel}
            </span>
            <div>
              <span>{dateLabel(w.todayDate)}</span>
              <button
                onClick={() => {
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
                    <span className="field-kicker">Planning workspace</span>
                    <h1>Plan your next outing</h1>
                    <p>
                      A clear view of the weather, terrain, and hours ahead.
                    </p>
                  </div>
                </header>
                <div className="field-planner-grid">
                  <WorkspacePlan workspace={w} />
                  {map}
                </div>
                <div className="field-workspace-bottom">
                  <section className="field-quick-locations">
                    <h2>Quick locations</h2>
                    {peaks.map((peak) => (
                      <button
                        className="field-location-row"
                        key={peak.name}
                        onClick={() =>
                          w.selectSuggestion({
                            ...peak,
                            class: "natural",
                            type: "peak",
                          })
                        }
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
                          {w.safetyData?.safety.score}
                          <small>/100</small>
                        </span>
                        <ArrowUpRight size={17} />
                      </button>
                    ) : (
                      <p className="field-workspace-empty">
                        Your most recent conditions brief will appear here.
                      </p>
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
                <div className="field-empty-state" role="alert">
                  <h1>Report unavailable</h1>
                  <p>{w.sharedReportError}</p>
                  <button
                    className="field-button"
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
              ) : w.loading ? (
                <div className="field-loading" role="status">
                  <LoaderCircle className="field-spin" size={35} />
                  <span className="field-kicker">Conditions request</span>
                  <h1>Generating report</h1>
                  <p>Checking weather, snow, terrain, and source freshness.</p>
                </div>
              ) : w.reportSnapshot ? (
                <Suspense
                  fallback={<p role="status">Opening conditions report…</p>}
                >
                  <Report
                    key={`${w.safetyData?.generatedAt}-${w.reportChatSessionKey}`}
                    report={w.reportSnapshot}
                    workspace={w}
                    onEdit={() => w.handleEditPlan()}
                    onSave={() => void action("save")}
                    onShare={() => void action("share")}
                    onWatch={() => void action("watch")}
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
                    <WorkspacePlan workspace={w} />
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
              <Library
                key={`${w.view}-${account.user?.id}`}
                kind={w.view}
                localReport={loadPersistedReport()}
                onOpen={openReport}
                workspace={w}
                navigate={(page) => navigate(page as AppView)}
              />
            )}
            {(w.view === "settings" || w.view === "account") && (
              <Settings
                preferences={w.preferences}
                onChange={(preferences) => w.updatePreferences(preferences)}
                accountOnly={w.view === "account"}
                workspace={w}
              />
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
              <div className="field-empty-state">
                <Compass size={40} />
                <h1>Page not found</h1>
                <p>This page could not be found.</p>
                <button
                  className="field-button"
                  onClick={() => navigate("home")}
                >
                  Back to workspace
                </button>
              </div>
            )}
          </main>
          <footer className="field-footer">
            <span>
              <Mountain size={16} />
              BACKCOUNTRY CONDITIONS
            </span>
            <p>A planning aid. Verify conditions in the field.</p>
            <div>
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
            <Settings
              preferences={w.preferences}
              onChange={(p) => w.updatePreferences(p)}
              accountOnly
              workspace={w}
            />
          </Dialog>
        )}
      </div>
    </AiAccessContext.Provider>
  );
}
