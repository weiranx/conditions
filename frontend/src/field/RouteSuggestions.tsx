import type { Workspace } from "./model/useWorkspace";
import { estimateRouteDurationHours } from "../lib/gpx";
import { hasRouteNumber } from "./route-planning";

/**
 * Suggested routes for the objective, shared by the plan and the Route chapter.
 * Each shows its grade, length, climb, a time at the traveler's own pace, and the
 * one-line description; picking one makes it the planned route.
 */
export function RouteSuggestions({ workspace: w }: { workspace: Workspace }) {
  const findingRoutes = w.routeLoadingState?.kind === "suggestions";
  if (findingRoutes || !w.routeSuggestions) return null;
  if (w.routeSuggestions.length === 0) {
    return <p className="field-feedback">No suggestions for this location. Type a route name instead.</p>;
  }
  const pace = {
    paceMinutesPerMile: w.preferences.runnerPaceMinutesPerMile,
    ascentMinutesPer1000Ft: w.preferences.runnerAscentMinutesPer1000Ft,
    stopBufferMinutes: w.preferences.runnerStopBufferMinutes,
  };
  return (
    <div className="sky-plan-route-options" role="group" aria-label="Suggested routes">
      {w.routeSuggestions.map((route, i) => {
        const distance = hasRouteNumber(route.distance_rt_miles) && route.distance_rt_miles > 0 ? route.distance_rt_miles : null;
        const gain = hasRouteNumber(route.elev_gain_ft) && route.elev_gain_ft >= 0 ? route.elev_gain_ft : null;
        // Suggested lengths and climbs are approximate, so the time is only offered when both are listed.
        const hours = distance !== null && gain !== null && hasRouteNumber(pace.paceMinutesPerMile)
          ? estimateRouteDurationHours({ distanceMiles: distance, elevationGainFt: gain }, pace)
          : null;
        return (
          <button
            type="button"
            key={`${route.name}-${i}`}
            aria-pressed={w.customRouteName === route.name}
            onClick={() => w.setCustomRouteName(route.name)}
          >
            <strong>{route.name}</strong>
            <small>
              {[
                route.class,
                distance !== null ? `${w.formatDistanceDisplay(distance)} round trip` : null,
                gain !== null ? `${w.formatElevationDeltaDisplay(gain)} gain` : null,
                hours !== null ? `about ${hours} h at your pace` : null,
              ].filter(Boolean).join(" · ")}
            </small>
            {route.description && <span className="sky-plan-route-description">{route.description}</span>}
          </button>
        );
      })}
    </div>
  );
}
