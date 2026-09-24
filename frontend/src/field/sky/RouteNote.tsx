import { Route as RouteIcon } from "lucide-react";
import { describeCheckpointBreach, type PlannedRouteSummary } from "../route-planning";

/**
 * Hero note for route checkpoints over the user's limits. The decision is scored
 * on the objective's forecast, so a crossing along the route must not hide in a chapter.
 */
export function RouteNote({ route, format, onOpen }: {
  route: PlannedRouteSummary | null;
  format: { temp: (f: number) => string; wind: (mph: number) => string; eta: (time: string) => string };
  onOpen?: () => void;
}) {
  if (route?.state !== "checked" || !route.firstOver) return null;
  const { firstOver, overCount, stops } = route;
  const where = `${firstOver.name}${firstOver.eta ? ` around ${format.eta(firstOver.eta)}` : ""}`;
  return (
    <div className="sky-approach-note sky-route-note">
      <RouteIcon size={16} aria-hidden="true" />
      <p>
        <strong>
          Along {route.name}, {overCount} of {stops.length} {stops.length === 1 ? "checkpoint" : "checkpoints"} {overCount === 1 ? "crosses" : "cross"} your limits
        </strong>
        {overCount > 1 ? `, first at ${where}` : ` at ${where}`}: {describeCheckpointBreach(firstOver.breach, format)}.
        {" "}The decision uses the objective’s forecast, not these checkpoints.{" "}
        {onOpen && <button type="button" onClick={onOpen}>See route</button>}
      </p>
    </div>
  );
}
