import { fetchApi } from "./api-client";

export interface WherePoint {
  lat: number;
  lon: number;
}

const MAX_POINTS = 60;

/** At most `MAX_POINTS` evenly spread points, so a long GPX track is one small request. */
export function samplePoints(points: WherePoint[]): WherePoint[] {
  const valid = points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
  if (valid.length <= MAX_POINTS) return valid;
  const step = (valid.length - 1) / (MAX_POINTS - 1);
  return Array.from({ length: MAX_POINTS }, (_, index) => valid[Math.round(index * step)]);
}

/** "Inyo NF, Sequoia NP, CA": the areas a place, route or trip is in, from the server's boundaries. */
export async function fetchWhere(name: string, points: WherePoint[], signal?: AbortSignal): Promise<string | null> {
  const { response, payload } = await fetchApi("/api/where", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, points: samplePoints(points) }),
    signal,
  });
  if (!response.ok) return null;
  const where = (payload as { where?: unknown } | null)?.where;
  return typeof where === "string" && where ? where : null;
}
