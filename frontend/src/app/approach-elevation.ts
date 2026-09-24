import type { ParsedGpxRoute, RouteTimingProfile } from '../lib/gpx';

/**
 * The approach inputs sent with a plan. The backend works out where the party
 * is at each hour and checks those hours at that elevation; this only turns
 * the planner's inputs (trailhead, imported or analyzed route, pace) into
 * request params.
 */

type Timeline = Array<{ minute: number; elevationFt: number }>;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * A GPX track as distance and elevation, [miles, feet] per point, for the backend
 * to time with the same pace model as route checkpoints. Points without an
 * elevation or position are left out.
 */
export function buildGpxElevationTrack(
  route: Pick<ParsedGpxRoute, 'distanceMiles' | 'displayTrack'>,
): Array<{ miles: number; elevationFt: number }> | null {
  const points = (route.displayTrack || []).filter((point) => finite(point.elev_ft) && finite(point.progress_percent));
  if (points.length < 2 || !finite(route.distanceMiles) || route.distanceMiles <= 0) return null;
  return points.map((point) => ({
    miles: (point.progress_percent / 100) * route.distanceMiles,
    elevationFt: point.elev_ft as number,
  }));
}

export const MAX_APPROACH_ROUTE_POINTS = 64;

/** Evenly thin a timeline, always keeping both ends and the high point. */
function thinTimeline<T extends { elevationFt: number }>(timeline: T[], limit: number): T[] {
  if (timeline.length <= limit) return timeline;
  const high = timeline.reduce((best, entry, index) => (entry.elevationFt > timeline[best].elevationFt ? index : best), 0);
  const keep = new Set([0, timeline.length - 1, high]);
  const slots = limit - keep.size;
  for (let i = 1; i <= slots; i += 1) keep.add(Math.round((i * (timeline.length - 1)) / (slots + 1)));
  return [...keep].sort((a, b) => a - b).slice(0, limit).map((index) => timeline[index]);
}

/** Compact "minute:feet,…" form of a timeline, as sent to and echoed by the backend. */
function timelineKey(timeline: Timeline): string {
  return thinTimeline(timeline, MAX_APPROACH_ROUTE_POINTS)
    .map((entry) => `${Math.round(entry.minute)}:${Math.round(entry.elevationFt)}`)
    .join(',');
}

/** A checkpoint from route analysis: its elevation and arrival minutes after the start. */
export interface RouteElevationCheckpoint {
  elev_ft: number | null;
  offset_minutes?: number;
}

/**
 * Params that tell the backend where the party starts: a GPX track (as distances
 * and elevations, with the pace to time it), else an analyzed route's checkpoints (with the typed trailhead to fall back on),
 * else the typed trailhead. Without any, the backend estimates the trailhead
 * from the forecast bands.
 */
export function buildApproachRequestParams(input: {
  enabled: boolean;
  trailheadElevationFt?: number | null;
  gpxRoute?: Pick<ParsedGpxRoute, 'distanceMiles' | 'displayTrack'> | null;
  /** Checkpoints of the analyzed route, in travel order. */
  routeCheckpoints?: RouteElevationCheckpoint[] | null;
  /** The analysis retraced the GPX track, which covers only the way out; its checkpoints cover both ways. */
  routeRetracesTrack?: boolean;
  timing: RouteTimingProfile;
}): Record<string, string> {
  if (!input.enabled) return { approach: 'off' };
  const params: Record<string, string> = {};
  const track = input.gpxRoute && !input.routeRetracesTrack ? buildGpxElevationTrack(input.gpxRoute) : null;
  if (track) {
    // The backend times the track with the same pace, descent and stop model as route checkpoints.
    params.approach_track = thinTimeline(track, MAX_APPROACH_ROUTE_POINTS)
      .map((point) => `${Number(point.miles.toFixed(2))}:${Math.round(point.elevationFt)}`)
      .join(',');
    params.pace_min_per_mi = String(Math.round(input.timing.paceMinutesPerMile));
    params.stop_min = String(Math.round(Math.max(0, input.timing.stopBufferMinutes)));
  } else {
    // Checkpoints whose elevation or arrival is unknown are left out, never sent as 0.
    const checkpoints = (input.routeCheckpoints || [])
      .filter((checkpoint) => finite(checkpoint.elev_ft) && finite(checkpoint.offset_minutes))
      .map((checkpoint) => ({ minute: checkpoint.offset_minutes as number, elevationFt: checkpoint.elev_ft as number }));
    if (checkpoints.length >= 2) params.approach_checkpoints = timelineKey(checkpoints);
    if (finite(input.trailheadElevationFt) && input.trailheadElevationFt >= 0) {
      params.trailhead_ft = String(Math.round(input.trailheadElevationFt));
    }
  }
  if (input.timing.ascentMinutesPer1000Ft > 0) params.ascent_min_per_kft = String(Math.round(input.timing.ascentMinutesPer1000Ft));
  return params;
}
