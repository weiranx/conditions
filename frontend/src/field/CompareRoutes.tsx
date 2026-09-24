import { useEffect, useRef, useState } from "react";
import { Route as RouteIcon, X } from "lucide-react";
import type { Workspace } from "./model/useWorkspace";
import type { RouteAnalysisResult } from "../hooks/useRouteAnalysis";
import {
  describeCheckpointBreach,
  describeCheckpointHazard,
  formatRouteHours,
  summarizePlannedRoute,
} from "./route-planning";
import { RouteStrip } from "./sky/RouteStrip";
import { RouteSuggestions } from "./RouteSuggestions";
import { dateLabel } from "./data";
import "./route-planning.css";
import "./sky/plan.css";

// Each compared route is a full AI route analysis, so only a few are compared at once.
export const MAX_COMPARED_ROUTES = 3;

type Entry = {
  id: number;
  name: string;
  status: "running" | "done" | "failed";
  result?: RouteAnalysisResult;
  error?: string;
  progress?: { done: number; total: number };
};

const SOURCE_LABEL: Record<string, string> = {
  generated: "Generated from named landmarks",
  gpx: "Your GPX track",
  nps: "National Park Service trail",
  openstreetmap: "OpenStreetMap trail",
};

/**
 * Named routes up the same objective, analyzed for the same plan and shown side
 * by side. Facts only: which checkpoints cross limits, how long it takes, when to
 * turn around. The routes are not ranked.
 */
export default function CompareRoutes({ workspace: w }: { workspace: Workspace }) {
  const [entries, setEntries] = useState<Entry[]>(() => (w.routeAnalysis && w.routeAnalysis.routeSource !== "gpx"
    ? [{ id: 0, name: w.routeAnalysis.routeName || w.plannedRouteName, status: "done", result: w.routeAnalysis }]
    : []));
  const [draft, setDraft] = useState("");
  const nextId = useRef(1);
  const controllers = useRef(new Map<number, AbortController>());
  useEffect(() => {
    const running = controllers.current;
    return () => running.forEach((controller) => controller.abort());
  }, []);
  const update = (id: number, change: Partial<Entry>) =>
    setEntries((list) => list.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)));
  const full = entries.length >= MAX_COMPARED_ROUTES;
  const canAnalyze = w.hasObjective && !full;

  function add(rawName: string) {
    const name = rawName.trim();
    if (!name || !canAnalyze || entries.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) return;
    const id = nextId.current++;
    const controller = new AbortController();
    controllers.current.set(id, controller);
    setEntries((list) => [...list, { id, name, status: "running" }]);
    setDraft("");
    w.analyzeRouteForComparison(name, {
      signal: controller.signal,
      onProgress: (event) => {
        if (event.type === "stage" && event.stage === "forecasts" && Array.isArray(event.checkpoints)) {
          update(id, { progress: { done: 0, total: event.checkpoints.length } });
        } else if (event.type === "checkpoint") {
          setEntries((list) => list.map((entry) => (entry.id === id && entry.progress
            ? { ...entry, progress: { ...entry.progress, done: entry.progress.done + 1 } } : entry)));
        }
      },
    })
      .then((result) => update(id, { status: "done", result }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        update(id, { status: "failed", error: error instanceof Error ? error.message : "Route analysis failed." });
      })
      .finally(() => controllers.current.delete(id));
  }
  function remove(id: number) {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    setEntries((list) => list.filter((entry) => entry.id !== id));
  }

  const eta = (time: string) => w.formatClockForStyle(time, w.preferences.timeStyle);
  const format = { temp: (f: number) => w.formatTempDisplay(f), wind: (mph: number) => w.formatWindDisplay(mph), eta };
  return (
    <>
      <header className="field-page-heading">
        <span className="field-kicker">Route comparison</span>
        <h1>Which way up?</h1>
        <p>
          {w.hasObjective
            ? <>Routes to {w.objectiveName} for {dateLabel(w.forecastDate)}, starting {w.displayStartTime}, each checked at timed checkpoints against your limits.</>
            : "Choose an objective in the plan to compare routes up it."}
        </p>
      </header>
      {w.hasObjective && (
        <form className="sky-card sky-section sky-route-choose compare-routes-add" onSubmit={(event) => { event.preventDefault(); add(draft); }}>
          <label className="sky-route-planned-name">
            Add a route
            <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Enter a named route" maxLength={250} disabled={full} />
          </label>
          <button type="button" className="field-button" disabled={w.routeLoading}
            onClick={() => w.handleFetchRouteSuggestions(w.objectiveName, w.position.lat, w.position.lng)}>
            {w.routeLoadingState?.kind === "suggestions" ? "Finding routes…" : "Suggest routes"}
          </button>
          <button className="field-button field-button-primary" disabled={!canAnalyze || !draft.trim()}>Compare</button>
          <p className="field-route-plan-context">
            {full ? `Up to ${MAX_COMPARED_ROUTES} routes at a time; remove one to add another.` : "Each route is a live analysis and can take a minute."}
          </p>
          {!full && w.routeSuggestions && w.routeSuggestions.length > 0 && (
            <div className="compare-routes-suggestions" role="group" aria-label="Add a suggested route">
              {w.routeSuggestions.filter((option) => !entries.some((entry) => entry.name === option.name)).map((option) => (
                <button key={option.name} type="button" className="field-button" onClick={() => add(option.name)}>+ {option.name}</button>
              ))}
            </div>
          )}
          {!w.routeSuggestions?.length && (
            <div className="sky-route-suggestions"><RouteSuggestions workspace={w} /></div>
          )}
        </form>
      )}
      {entries.length > 0 && (
        <div className="compare-routes" aria-label="Compared routes">
          {entries.map((entry) => {
            const route = entry.result ? summarizePlannedRoute({
              name: entry.name, analysis: entry.result, checking: null, error: null, limits: w.preferences,
              signedIn: true, available: true, saved: false,
            }) : null;
            const timing = entry.result?.timing;
            const planned = Boolean(entry.result && w.routeAnalysis === entry.result);
            const facts = route?.state === "checked" ? [
              route.distanceMiles !== null ? ["Distance", w.formatDistanceDisplay(route.distanceMiles)] : null,
              route.gainFt !== null ? ["Gain", w.formatElevationDeltaDisplay(route.gainFt)] : null,
              timing?.mode === "pace" && timing.estimatedMinutes ? ["At your pace", formatRouteHours(timing.estimatedMinutes)] : null,
              route.finish ? [route.finish.returnToStart ? "Back at start" : "Finish", `${eta(route.finish.eta)}${route.finish.dark ? ", after dark" : ""}`] : null,
              timing?.turnaround ? ["Turn around by", eta(timing.turnaround.byPlanEnd)] : null,
              ["Checkpoints", `${route.stops.length}${route.overCount ? ` · ${route.overCount} over` : ""}${route.hazardCount ? ` · ${route.hazardCount} alert or danger` : ""}${route.missingCount ? ` · ${route.missingCount} incomplete` : ""}`],
            ].filter((fact): fact is string[] => Boolean(fact)) : [];
            return (
              <section key={entry.id} className={`sky-card compare-route is-${route?.state === "checked" ? route.tone : "missing"}`} aria-label={entry.name}>
                <div className="compare-route-head">
                  <h2><RouteIcon size={16} aria-hidden="true" />{entry.name}</h2>
                  <button type="button" className="field-icon-button" aria-label={`Remove ${entry.name}`} onClick={() => remove(entry.id)}><X size={16} /></button>
                </div>
                {entry.status === "running" && (
                  <p className="sky-cap" role="status">
                    Checking{entry.progress ? ` · ${entry.progress.done} of ${entry.progress.total} forecasts` : "…"}
                  </p>
                )}
                {entry.status === "failed" && <p className="sky-notice is-caution" role="alert">{entry.error}</p>}
                {route?.state === "checked" && (
                  <>
                    <span className="sky-cap">{SOURCE_LABEL[entry.result?.routeSource ?? ""] ?? "Route analysis"}</span>
                    <p className="compare-route-verdict">
                      {route.firstOver
                        ? <><strong className="is-over">{route.overCount} of {route.stops.length} over your limits.</strong> First at {route.firstOver.name}{route.firstOver.eta ? ` (${eta(route.firstOver.eta)})` : ""}: {describeCheckpointBreach(route.firstOver.breach, format)}.</>
                        : route.firstHazard
                          ? <><strong className="is-over">Within your limits, with {describeCheckpointHazard(route.firstHazard.hazard)}</strong> at {route.firstHazard.name}.</>
                          : route.missingCount
                            ? <strong className="is-missing">{route.missingCount} checkpoint {route.missingCount === 1 ? "forecast is" : "forecasts are"} incomplete.</strong>
                            : <strong>Every checkpoint is within your limits.</strong>}
                    </p>
                    <RouteStrip name={entry.name} stops={route.stops} profile={route.profile} eta={eta} />
                    <dl className="compare-route-facts">
                      {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                    </dl>
                    {planned
                      ? <p className="sky-cap">This is the planned route.</p>
                      : (
                        <button type="button" className="field-button" disabled={Boolean(w.importedGpxRoute) || w.viewingHistoryReport}
                          onClick={() => entry.result && w.adoptRouteAnalysis(entry.result)}>
                          Use this route
                        </button>
                      )}
                    {!planned && w.importedGpxRoute && <p className="sky-cap">Remove the GPX track from the plan to use a named route.</p>}
                  </>
                )}
              </section>
            );
          })}
        </div>
      )}
      <p className="sky-cap compare-routes-note">
        Checkpoints use point forecasts at each estimated arrival. Routes are compared, not ranked; the plan's decision still uses the objective's forecast.
      </p>
    </>
  );
}
