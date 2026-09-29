import type { Workspace } from "./model/useWorkspace";
import { hasRouteNumber } from "./route-planning";

/**
 * Suggested routes for the objective, shared by the plan and the Route chapter.
 * Each shows its grade, length, climb, a time at the traveler's own pace, and the
 * one-line description; picking one makes it the planned route (and, in the
 * plan, sets how long the outing is).
 */
export function RouteSuggestions({
  workspace: w,
  onChoose,
}: {
  workspace: Workspace;
  /** Told the chosen route's name and its time at the traveler's pace, when both are known. */
  onChoose?: (name: string, hours: number | null) => void;
}) {
  const findingRoutes = w.routeLoadingState?.kind === "suggestions";
  if (findingRoutes || !w.routeSuggestions) return null;
  if (w.routeSuggestions.length === 0) {
    return <p className="field-feedback">No suggestions for this location. Type a route name instead.</p>;
  }
  return (
    <div className="sky-plan-route-options" role="group" aria-label="Suggested routes">
      {w.routeSuggestions.map((route, i) => {
        const distance = hasRouteNumber(route.distance_rt_miles) && route.distance_rt_miles > 0 ? route.distance_rt_miles : null;
        const gain = hasRouteNumber(route.elev_gain_ft) && route.elev_gain_ft >= 0 ? route.elev_gain_ft : null;
        // The backend times each route at the traveler's pace, adjusted for altitude and route class.
        const hours = hasRouteNumber(route.estimated_hours) ? route.estimated_hours : null;
        return (
          <button
            type="button"
            key={`${route.name}-${i}`}
            aria-pressed={w.customRouteName === route.name}
            onClick={() => {
              w.setCustomRouteName(route.name);
              onChoose?.(route.name, hours);
            }}
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
