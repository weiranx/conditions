import { Route as RouteIcon } from "lucide-react";
import { describeCheckpointBreach, describeCheckpointHazard, type PlannedRouteSummary } from "../route-planning";

/**
 * Hero note for route checkpoints over the user's limits, or under an official
 * alert or avalanche danger. The decision is scored on the objective's forecast,
 * so a problem along the route must not hide in a chapter.
 */
export function RouteNote({ route, format, onOpen }: {
  route: PlannedRouteSummary | null;
  format: { temp: (f: number) => string; wind: (mph: number) => string; eta: (time: string) => string };
  onOpen?: () => void;
}) {
  if (route?.state !== "checked" || (!route.firstOver && !route.firstHazard)) return null;
  const { firstOver, firstHazard, overCount, hazardCount, stops } = route;
  const first = firstOver ?? firstHazard!;
  const count = firstOver ? overCount : hazardCount;
  const where = `${first.name}${first.eta ? ` around ${format.eta(first.eta)}` : ""}`;
  const checkpoints = `${count} of ${stops.length} ${stops.length === 1 ? "checkpoint" : "checkpoints"}`;
  return (
    <div className="sky-approach-note sky-route-note">
      <RouteIcon size={16} aria-hidden="true" />
      <p>
        <strong>
          {firstOver
            ? `Along ${route.name}, ${checkpoints} ${count === 1 ? "crosses" : "cross"} your limits`
            : `Along ${route.name}, ${checkpoints} ${count === 1 ? "has" : "have"} an official hazard`}
        </strong>
        {count > 1 ? `, first at ${where}` : ` at ${where}`}: {firstOver ? describeCheckpointBreach(firstOver.breach, format) : describeCheckpointHazard(firstHazard!.hazard)}.
        {" "}The decision uses the objective’s forecast, not these checkpoints.{" "}
        {onOpen && <button type="button" onClick={onOpen}>See route</button>}
      </p>
    </div>
  );
}
