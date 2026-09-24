import L from "leaflet";
import type { CheckpointTone } from "./route-planning";

const TONE_RANK: Record<CheckpointTone, number> = { over: 3, hazard: 2, missing: 1, within: 0 };

/** The most serious of several checkpoints' tones, for a pin they share. */
export function worstTone(tones: CheckpointTone[]): CheckpointTone {
  return tones.reduce<CheckpointTone>((worst, tone) => (TONE_RANK[tone] > TONE_RANK[worst] ? tone : worst), "within");
}

/**
 * Checkpoints grouped by place. An out-and-back passes each checkpoint twice, so
 * the way back shares the way out's pin, labelled with both numbers.
 */
export function groupCheckpointsByPlace(points: { lat: number; lon: number }[]): number[][] {
  const groups = new Map<string, number[]>();
  points.forEach((point, index) => {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return;
    const key = `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`;
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  return [...groups.values()];
}

/** A numbered checkpoint pin, colored like the profile's stops. */
export function checkpointPin({ label, tone, selected = false, estimated = false }: {
  label: string; tone: CheckpointTone; selected?: boolean; estimated?: boolean;
}): L.DivIcon {
  const width = Math.max(26, 14 + label.length * 8);
  return L.divIcon({
    className: "route-map-pin-anchor",
    html: `<span class="route-map-pin is-${tone}${selected ? " is-selected" : ""}${estimated ? " is-estimated" : ""}">${label}</span>`,
    iconSize: [width, 26],
    iconAnchor: [width / 2, 13],
  });
}
