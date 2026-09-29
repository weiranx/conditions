import { useEffect, useMemo, useState } from "react";
import { fetchWhere, type WherePoint } from "../lib/where";

/** Where a place, route or trip is; null until known, and when the server can't say. */
export function useWhere(name: string, points: WherePoint[]): string | null {
  const key = useMemo(() => JSON.stringify([name, points.map((point) => [point.lat, point.lon])]), [name, points]);
  const [found, setFound] = useState<{ key: string; where: string | null } | null>(null);
  useEffect(() => {
    if (!points.length) return undefined;
    const controller = new AbortController();
    fetchWhere(name, points, controller.signal)
      .then((where) => setFound({ key, where }))
      .catch(() => undefined);
    return () => controller.abort();
    // `key` stands for name and points.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return found?.key === key ? found.where : null;
}
