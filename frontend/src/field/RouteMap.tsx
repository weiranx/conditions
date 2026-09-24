import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, ScaleControl, TileLayer, Tooltip, useMap } from "react-leaflet";
import "./route-map.css";
import { MAP_STYLE_OPTIONS } from "../app/constants";
import { useProductFeatureFlags } from "../contexts/feature-flags";
import type { Workspace } from "./model/useWorkspace";
import type { CheckpointTone } from "./route-planning";
import { checkpointPin, groupCheckpointsByPlace, worstTone } from "./route-map-pins";
import { hasCoarsePointer } from "./touch";

export type RouteMapStop = { name: string; lat: number; lon: number; tone: CheckpointTone; eta: string; estimated?: boolean };

/** Fit the route when it changes, then follow the selected checkpoint without zooming. */
function Framing({ bounds, focus }: { bounds: [number, number][]; focus: [number, number] | null }) {
  const map = useMap();
  const framed = useRef(false);
  // Re-fit only for a different route, not for every render's new array.
  const key = JSON.stringify(bounds);
  useEffect(() => {
    const points = JSON.parse(key) as [number, number][];
    if (!points.length) return;
    map.fitBounds(points, { padding: [30, 30], maxZoom: 15 });
    framed.current = true;
  }, [map, key]);
  const focusKey = focus ? focus.join(",") : "";
  useEffect(() => {
    if (!framed.current || !focusKey) return;
    const [lat, lon] = focusKey.split(",").map(Number);
    if (!map.getBounds().pad(-0.1).contains([lat, lon])) map.panTo([lat, lon]);
  }, [map, focusKey]);
  return null;
}

/**
 * The route on a map: its line (solid for a GPX track or mapped trail, dashed for
 * the straight lines between estimated checkpoints) and a numbered pin per place,
 * colored by the forecast there. Selecting a pin selects its checkpoint.
 */
export default function RouteMap({ workspace: w, stops, line, lineEstimated, selected, onSelect }: {
  workspace: Workspace;
  stops: RouteMapStop[];
  line: [number, number][];
  /** The line only joins estimated checkpoints; it isn't a mapped path. */
  lineEstimated: boolean;
  selected: number;
  onSelect: (index: number) => void;
}) {
  const flags = useProductFeatureFlags();
  const [touch] = useState(hasCoarsePointer);
  const style = w.mapStyle === "satellite" && !flags.satelliteImagery ? "topo" : w.mapStyle || "topo";
  const source = MAP_STYLE_OPTIONS[style];
  const groups = useMemo(() => groupCheckpointsByPlace(stops), [stops]);
  const bounds = useMemo(() => {
    const points = line.length >= 2 ? line : stops.map((stop) => [stop.lat, stop.lon] as [number, number]);
    return points.filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
  }, [line, stops]);
  const focus: [number, number] | null = stops[selected] ? [stops[selected].lat, stops[selected].lon] : null;
  if (!bounds.length) return null;
  return (
    <div className={`field-map-surface route-map is-${style}`}>
      <MapContainer
        center={bounds[0]}
        zoom={12}
        scrollWheelZoom={false}
        dragging={!touch}
        className="field-map route-map-canvas"
        aria-label="Route map"
      >
        <TileLayer key={source.url} attribution={source.attribution} url={source.url} maxNativeZoom={source.maxNativeZoom} />
        <ScaleControl position="bottomleft" metric={w.preferences.elevationUnit !== "ft"} imperial={w.preferences.elevationUnit !== "m"} />
        <Framing bounds={bounds} focus={focus} />
        {line.length >= 2 && (
          <Polyline positions={line} pathOptions={{ color: "#2878d7", weight: 4, opacity: 0.85, ...(lineEstimated ? { dashArray: "6 8" } : {}) }} />
        )}
        {groups.map((indexes) => {
          const first = stops[indexes[0]];
          const isSelected = indexes.includes(selected);
          // A shared pin selects its next checkpoint in turn.
          const next = isSelected ? indexes[(indexes.indexOf(selected) + 1) % indexes.length] : indexes[0];
          return (
            <Marker
              key={indexes.join("-")}
              position={[first.lat, first.lon]}
              icon={checkpointPin({
                label: indexes.map((index) => index + 1).join("·"),
                tone: worstTone(indexes.map((index) => stops[index].tone)),
                selected: isSelected,
                estimated: indexes.some((index) => stops[index].estimated),
              })}
              zIndexOffset={isSelected ? 1000 : 0}
              eventHandlers={{ click: () => onSelect(next) }}
              keyboard
              title={indexes.map((index) => `${index + 1}. ${stops[index].name}`).join(", ")}
            >
              <Tooltip>
                {indexes.map((index) => (
                  <span key={index} className="route-map-tip">
                    {index + 1}. {stops[index].name}{stops[index].eta ? ` · ${stops[index].eta}` : ""}
                    {stops[index].estimated ? " · location estimated" : ""}
                  </span>
                ))}
              </Tooltip>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
