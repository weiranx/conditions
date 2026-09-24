import {
  campPoint,
  itineraryExit,
  type ItineraryAssessment,
  type ItineraryDraft,
  type ItineraryNightState,
} from "../app/itinerary";
import type { DecisionLevel } from "../app/types";

export type TripOverlayTone = "go" | "caution" | "nogo" | "unknown" | "plan";

export interface TripOverlayPoint {
  key: string;
  kind: "camp" | "exit" | "checkpoint" | "bail";
  lat: number;
  lon: number;
  /** One or two characters drawn in the pin: a night number, "X" for an exit. */
  label: string;
  title: string;
  tone: TripOverlayTone;
}

export interface TripOverlay {
  points: TripOverlayPoint[];
  /** Trailhead, each night's camp, then the exit, in walking order. */
  path: Array<{ lat: number; lon: number }>;
  /** The imported GPX track, when the trip came from one. */
  track: Array<{ lat: number; lon: number }> | null;
}

const DAY_TONE: Record<DecisionLevel, TripOverlayTone> = { GO: "go", CAUTION: "caution", "NO-GO": "nogo" };
const NIGHT_TONE: Record<ItineraryNightState, TripOverlayTone> = {
  settled: "go",
  hard: "caution",
  serious: "nogo",
  incomplete: "unknown",
  "not-forecast": "unknown",
  unavailable: "unknown",
};

/** What the map draws for a trip: pins colored by the last check, or plain while planning. */
export function buildTripOverlay(draft: ItineraryDraft, assessment: ItineraryAssessment | null): TripOverlay {
  const points: TripOverlayPoint[] = [];
  const path: Array<{ lat: number; lon: number }> = [];
  if (draft.trailhead) path.push(draft.trailhead);
  draft.camps.forEach((camp, index) => {
    const point = campPoint(draft, index);
    if (!point) return;
    if (!camp.layover) path.push(point);
    const night = assessment?.nights.find((entry) => entry.index === index);
    points.push({
      key: `camp-${index}`,
      kind: "camp",
      lat: point.lat,
      lon: point.lon,
      label: String(index + 1),
      title: `Night ${index + 1}${point.name ? ` · ${point.name}` : ""}${camp.layover ? " (layover)" : ""}`,
      tone: night ? NIGHT_TONE[night.state] : "plan",
    });
  });
  const exit = itineraryExit(draft);
  if (exit) {
    path.push(exit);
    if (draft.exit) {
      points.push({ key: "exit", kind: "exit", lat: exit.lat, lon: exit.lon, label: "X", title: `Exit · ${exit.name || "End of trip"}`, tone: "plan" });
    }
  }
  draft.days.forEach((day, dayIndex) => {
    const assessed = assessment?.days[dayIndex];
    day.checkpoints.forEach((checkpoint, index) => {
      const checked = assessed?.checkpoints[index]?.day;
      points.push({
        key: `checkpoint-${dayIndex}-${index}`,
        kind: "checkpoint",
        lat: checkpoint.lat,
        lon: checkpoint.lon,
        label: "▲",
        title: `Day ${dayIndex + 1} · ${checkpoint.name || "High point"}`,
        tone: checked ? DAY_TONE[checked.decisionLevel] : assessment ? "unknown" : "plan",
      });
    });
  });
  draft.bailPoints.forEach((point, index) => {
    points.push({ key: `bail-${index}`, kind: "bail", lat: point.lat, lon: point.lon, label: "B", title: `Bail point · ${point.name || "Exit"}`, tone: "plan" });
  });
  return { points, path, track: draft.track && draft.track.length > 1 ? draft.track : null };
}
