import type { RouteWaypointSummary } from "../hooks/useRouteAnalysis";

export function hasRouteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Do not invent elevations or imply equal distances between uneven checkpoints. */
export function buildCheckpointProfile(summaries: RouteWaypointSummary[]) {
  if (summaries.length < 2 || !summaries.every((p) => hasRouteNumber(p.elev_ft))) return null;
  const low = Math.min(...summaries.map((p) => p.elev_ft));
  const high = Math.max(...summaries.map((p) => p.elev_ft));
  const distances = summaries.map((p) => p.distance_miles);
  const progress = summaries.map((p) => p.progress_percent);
  const ordered = (values: unknown[]): values is number[] =>
    values.every((value, i) => hasRouteNumber(value) && value >= 0 &&
      (i === 0 || value >= (values[i - 1] as number))) &&
    (values.at(-1) as number) > (values[0] as number);
  const axis = ordered(distances) ? "distance" : ordered(progress) ? "progress" : "order";
  const positions = axis === "distance" ? distances as number[] :
    axis === "progress" ? progress as number[] : summaries.map((_, i) => i);
  const first = positions[0];
  const span = positions[positions.length - 1] - first;
  return {
    axis,
    low,
    high,
    points: summaries.map((p, i) => ({
      x: 20 + ((positions[i] - first) / span) * 960,
      y: 155 - ((p.elev_ft - low) / Math.max(100, high - low)) * 125,
    })),
  };
}
