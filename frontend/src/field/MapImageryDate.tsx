import { useEffect, useState } from "react";
import { useMapEvents } from "react-leaflet";
import { buildApiUrl } from "../lib/api-client";
import { imageryDateLabel } from "./data";
import "./map-imagery-date.css";

/** Each tile can use a different pass; only date the tile at the map's center. */
export default function MapImageryDate() {
  const [, refresh] = useState(0);
  const map = useMapEvents({ moveend: () => refresh((value) => value + 1) });
  const zoom = Math.min(15, Math.max(2, Math.round(map.getZoom())));
  const center = map.getCenter().wrap();
  const point = map.project(center, zoom).divideBy(256).floor();
  const limit = 2 ** zoom - 1;
  const key = `${zoom}/${Math.max(0, Math.min(limit, point.x))}/${Math.max(0, Math.min(limit, point.y))}`;
  const [result, setResult] = useState<{ key: string; date: string | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(buildApiUrl(`/api/satellite-tile/${key}.png?metadata=1`), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Imagery date unavailable");
        const metadata: unknown = await response.json();
        const acquiredAt = metadata && typeof metadata === "object" && "acquiredAt" in metadata
          && typeof metadata.acquiredAt === "string" ? metadata.acquiredAt : null;
        if (!controller.signal.aborted) setResult({ key, date: imageryDateLabel(acquiredAt) });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, date: null });
      });
    return () => controller.abort();
  }, [key]);
  return (
    <div className="field-map-imagery-date" role="status">
      {result?.key !== key ? "Loading imagery date…" : result.date ? `Imaged ${result.date}` : "Imagery date unavailable"}
      <span>At map center · dates vary across map</span>
    </div>
  );
}
