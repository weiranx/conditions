import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  ScaleControl,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { LocateFixed } from "lucide-react";
import "leaflet/dist/leaflet.css";
import type { Plan } from "./data";
import type { Workspace } from "./model/useWorkspace";
import { MAP_STYLE_OPTIONS } from "../app/constants";
import type { MapStyle } from "../app/types";
import { useProductFeatureFlags } from "../contexts/feature-flags";
const pin = L.divIcon({
  className: "field-map-pin",
  html: "<span></span>",
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});
function Position({
  lat,
  lon,
  nonce,
  route,
}: {
  lat: number;
  lon: number;
  nonce: number;
  route: Plan["route"];
}) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lon], map.getZoom());
  }, [map, lat, lon, nonce]);
  useEffect(() => {
    if (route?.displayTrack.length)
      map.fitBounds(
        route.displayTrack.map((p) => [p.lat, p.lon]),
        { padding: [35, 35], maxZoom: 15 },
      );
  }, [map, route]);
  return null;
}
function Pick({ onPick }: { onPick?: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onPick?.(e.latlng.lat, e.latlng.lng) });
  return null;
}
export default function FieldMap({
  plan,
  onPick,
  workspace: w,
}: {
  plan: Plan;
  onPick?: (lat: number, lon: number) => void;
  workspace?: Workspace;
}) {
  const [localStyle, setLocalStyle] = useState<MapStyle>("topo");
  const [nonce, setNonce] = useState(0);
  const flags = useProductFeatureFlags();
  const style = w?.mapStyle || localStyle;
  const source =
    MAP_STYLE_OPTIONS[
      style === "satellite" && !flags.satelliteImagery ? "topo" : style
    ];
  const lat = plan.lat ?? 46.8523;
  const lon = plan.lon ?? -121.7603;
  const events = useMemo(
    () => ({
      dragend: (e: L.DragEndEvent) => {
        const point = (e.target as L.Marker).getLatLng();
        onPick?.(point.lat, point.lng);
      },
    }),
    [onPick],
  );
  return (
    <div className={`field-map-surface is-${style}`}>
      <div className="field-map-tools">
        <div role="group" aria-label="Map layer">
          {(["topo", "street", "satellite"] as const)
            .filter((key) => key !== "satellite" || flags.satelliteImagery)
            .map((key) => (
              <button
                key={key}
                aria-pressed={key === style}
                onClick={() => (w ? w.setMapStyle(key) : setLocalStyle(key))}
              >
                {MAP_STYLE_OPTIONS[key].label}
              </button>
            ))}
        </div>
        <button
          aria-label="Recenter map on objective"
          onClick={() => setNonce((n) => n + 1)}
        >
          <LocateFixed size={16} />
        </button>
      </div>
      <MapContainer
        center={[lat, lon]}
        zoom={10}
        scrollWheelZoom={false}
        className="field-map"
        aria-label="Objective map"
      >
        <TileLayer
          key={source.url}
          attribution={source.attribution}
          url={source.url}
          maxNativeZoom={source.maxNativeZoom}
        />
        <ScaleControl position="bottomleft" />
        <Position
          lat={lat}
          lon={lon}
          nonce={nonce + (w?.mapFocusNonce || 0)}
          route={plan.route}
        />
        <Pick onPick={onPick} />
        {plan.lat !== null && (
          <Marker
            position={[lat, lon]}
            icon={pin}
            draggable={!!onPick}
            eventHandlers={events}
          >
            <Tooltip>{plan.name || "Selected objective"}</Tooltip>
          </Marker>
        )}
        {plan.route && (
          <Polyline
            positions={plan.route.displayTrack.map((p) => [p.lat, p.lon])}
            pathOptions={{ color: "#2878d7", weight: 4 }}
          />
        )}
        {w?.routeAnalysis?.waypoints.map((point, index) => (
          <Marker key={index} position={[point.lat, point.lon]} icon={pin}>
            <Tooltip>
              {point.name} · {w.formatElevationDisplay(point.elev_ft)}
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
