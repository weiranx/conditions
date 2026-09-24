import type { ParsedGpxRoute, RouteTimingProfile } from '../lib/gpx';

/**
 * The approach inputs sent with a plan. The backend works out where the party
 * is at each hour and checks those hours at that elevation; this only turns
 * the planner's inputs (trailhead, imported route, pace) into request params.
 */

type Timeline = Array<{ minute: number; elevationFt: number }>;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Elevation over time along a GPX track, using the route timing preferences. */
export function buildGpxElevationTimeline(
  route: Pick<ParsedGpxRoute, 'distanceMiles' | 'displayTrack'>,
  timing: RouteTimingProfile,
): Timeline | null {
  const points = (route.displayTrack || []).filter((point) => finite(point.elev_ft) && finite(point.progress_percent));
  if (points.length < 2 || !finite(route.distanceMiles) || route.distanceMiles <= 0) return null;
  const pace = Math.max(5, timing.paceMinutesPerMile);
  const ascentRate = Math.max(0, timing.ascentMinutesPer1000Ft);
  let moving = 0;
  const raw = points.map((point, index) => {
    if (index > 0) {
      const previous = points[index - 1];
      const miles = Math.max(0, point.progress_percent - previous.progress_percent) / 100 * route.distanceMiles;
      const climb = Math.max(0, (point.elev_ft as number) - (previous.elev_ft as number));
      moving += miles * pace + (climb / 1000) * ascentRate;
    }
    return { minute: moving, elevationFt: point.elev_ft as number };
  });
  if (moving <= 0) return null;
  // Spread stops across the route so the timeline ends when the trip does.
  const scale = (moving + Math.max(0, timing.stopBufferMinutes)) / moving;
  return raw.map((entry) => ({ minute: entry.minute * scale, elevationFt: entry.elevationFt }));
}

export const MAX_APPROACH_ROUTE_POINTS = 64;

/** Evenly thin a timeline, always keeping both ends and the high point. */
function thinTimeline(timeline: Timeline, limit: number): Timeline {
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

/**
 * Params that tell the backend where the party starts. Without a trailhead or
 * route, the backend estimates the trailhead from the forecast bands.
 */
export function buildApproachRequestParams(input: {
  enabled: boolean;
  trailheadElevationFt?: number | null;
  gpxRoute?: Pick<ParsedGpxRoute, 'distanceMiles' | 'displayTrack'> | null;
  timing: RouteTimingProfile;
}): Record<string, string> {
  if (!input.enabled) return { approach: 'off' };
  const params: Record<string, string> = {};
  const track = input.gpxRoute ? buildGpxElevationTimeline(input.gpxRoute, input.timing) : null;
  if (track) {
    params.approach_route = timelineKey(track);
  } else if (finite(input.trailheadElevationFt) && input.trailheadElevationFt >= 0) {
    params.trailhead_ft = String(Math.round(input.trailheadElevationFt));
  }
  if (input.timing.ascentMinutesPer1000Ft > 0) params.ascent_min_per_kft = String(Math.round(input.timing.ascentMinutesPer1000Ft));
  return params;
}
