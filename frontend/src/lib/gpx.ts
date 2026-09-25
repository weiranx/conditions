const METERS_TO_FEET = 3.28084;
const METERS_PER_MILE = 1609.344;
const MAX_GPX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TRACK_POINTS = 100_000;
// Checkpoints taken from a track: the start, finish and high point always, a deep
// low point and the file's own named waypoints when present, then even spacing.
const TARGET_CHECKPOINT_COUNT = 6;
// The route analysis accepts eight; one is left spare.
const MAX_CHECKPOINT_COUNT = 7;
// A named <wpt> this close to the track names the track point nearest it.
const WAYPOINT_SNAP_METERS = 150;
// A low point this far below both ends is worth checking (cold air pools there).
const LOW_POINT_DROP_METERS = 150;
// Checkpoints closer than this share of the route are merged.
const MIN_CHECKPOINT_GAP_SHARE = 0.03;
/** Most points kept in a route's display track, as saved with reports. */
export const MAX_DISPLAY_TRACK_POINTS = 500;

type ParsedTrackPoint = {
  lat: number;
  lon: number;
  elevationMeters: number | null;
  segment: number;
  distanceMeters: number;
};

export type GpxCheckpoint = {
  name: string;
  lat: number;
  lon: number;
  elev_ft?: number;
  distance_miles: number;
  progress_percent: number;
};

export type GpxTrackPoint = {
  lat: number;
  lon: number;
  elev_ft?: number;
  progress_percent: number;
};

export type ParsedGpxRoute = {
  name: string;
  fileName: string;
  pointCount: number;
  distanceMiles: number;
  elevationGainFt: number | null;
  minElevationFt: number | null;
  maxElevationFt: number | null;
  checkpoints: GpxCheckpoint[];
  displayTrack: GpxTrackPoint[];
  routeShape: 'closed route' | 'point-to-point';
  /** The track's highest point, where the report is read. Missing on routes saved before it was kept. */
  highPoint?: { lat: number; lon: number; elev_ft: number };
};

export type RouteTimingProfile = {
  paceMinutesPerMile: number;
  ascentMinutesPer1000Ft: number;
  stopBufferMinutes: number;
};

function haversineMeters(a: ParsedTrackPoint, b: ParsedTrackPoint): number {
  const radiusMeters = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(b.lon - a.lon);
  const h = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return radiusMeters * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function childText(element: Element, localName: string): string | null {
  for (const child of Array.from(element.children)) {
    if (child.localName === localName) {
      return child.textContent?.trim() || null;
    }
  }
  return null;
}

function elementsByLocalName(root: ParentNode, localName: string): Element[] {
  return Array.from(root.querySelectorAll('*')).filter((element) => element.localName === localName);
}

function routeName(document: Document, fileName: string): string {
  const track = elementsByLocalName(document, 'trk')[0];
  const route = elementsByLocalName(document, 'rte')[0];
  const metadata = elementsByLocalName(document, 'metadata')[0];
  const candidate = (track && childText(track, 'name'))
    || (route && childText(route, 'name'))
    || (metadata && childText(metadata, 'name'));
  if (candidate) return candidate.slice(0, 200);
  return fileName.replace(/\.gpx$/i, '').trim().slice(0, 200) || 'Imported GPX route';
}

function extractTrackPoints(document: Document): ParsedTrackPoint[] {
  const trackSegments = elementsByLocalName(document, 'trkseg');
  const sources = trackSegments.length > 0
    ? trackSegments.map((segment, index) => ({
        segment: index,
        elements: elementsByLocalName(segment, 'trkpt'),
      }))
    : elementsByLocalName(document, 'rte').map((route, index) => ({
        segment: index,
        elements: elementsByLocalName(route, 'rtept'),
      }));

  const points: ParsedTrackPoint[] = [];
  for (const source of sources) {
    for (const element of source.elements) {
      if (points.length >= MAX_TRACK_POINTS) {
        throw new Error(`GPX files are limited to ${MAX_TRACK_POINTS.toLocaleString()} track points.`);
      }
      const latText = element.getAttribute('lat')?.trim();
      const lonText = element.getAttribute('lon')?.trim();
      if (!latText || !lonText) continue;
      const lat = Number(latText);
      const lon = Number(lonText);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        continue;
      }
      const elevationText = childText(element, 'ele');
      const elevationMeters = elevationText === null ? null : Number(elevationText);
      points.push({
        lat,
        lon,
        elevationMeters: Number.isFinite(elevationMeters) ? elevationMeters : null,
        segment: source.segment,
        distanceMeters: 0,
      });
    }
  }

  let distanceMeters = 0;
  points.forEach((point, index) => {
    const previous = points[index - 1];
    if (previous && previous.segment === point.segment) {
      distanceMeters += haversineMeters(previous, point);
    }
    point.distanceMeters = distanceMeters;
  });
  return points;
}

type NamedWaypoint = { name: string; lat: number; lon: number };

/** The file's own named waypoints (<wpt>), which name the track points they sit on. */
function extractNamedWaypoints(document: Document): NamedWaypoint[] {
  return elementsByLocalName(document, 'wpt').slice(0, 200).flatMap((element) => {
    const lat = Number(element.getAttribute('lat'));
    const lon = Number(element.getAttribute('lon'));
    const name = childText(element, 'name')?.slice(0, 100);
    return name && Number.isFinite(lat) && Number.isFinite(lon) ? [{ name, lat, lon }] : [];
  });
}

type CheckpointRole = 'start' | 'finish' | 'waypoint' | 'high' | 'low' | 'even';
// When two picks are too close together, the more important one stays.
const ROLE_RANK: Record<CheckpointRole, number> = { start: 5, finish: 5, waypoint: 4, high: 3, low: 2, even: 1 };

function chooseCheckpoints(points: ParsedTrackPoint[], totalDistanceMeters: number, waypoints: NamedWaypoint[] = []): GpxCheckpoint[] {
  const picks: { index: number; role: CheckpointRole; name?: string }[] = [
    { index: 0, role: 'start' },
    { index: points.length - 1, role: 'finish' },
  ];
  const withElevation = points.map((point, index) => ({ index, elevation: point.elevationMeters }))
    .filter((entry): entry is { index: number; elevation: number } => entry.elevation !== null);
  if (withElevation.length >= 2) {
    const high = withElevation.reduce((best, entry) => (entry.elevation > best.elevation ? entry : best));
    picks.push({ index: high.index, role: 'high' });
    const ends = [points[0].elevationMeters, points[points.length - 1].elevationMeters].filter((value): value is number => value !== null);
    const interior = withElevation.filter((entry) => entry.index > 0 && entry.index < points.length - 1);
    const low = interior.length ? interior.reduce((best, entry) => (entry.elevation < best.elevation ? entry : best)) : null;
    if (low && ends.length && low.elevation <= Math.min(...ends) - LOW_POINT_DROP_METERS) picks.push({ index: low.index, role: 'low' });
  }
  for (const waypoint of waypoints) {
    let nearest = -1;
    let nearestMeters = WAYPOINT_SNAP_METERS;
    const target = { lat: waypoint.lat, lon: waypoint.lon, elevationMeters: null, segment: 0, distanceMeters: 0 };
    points.forEach((point, index) => {
      const meters = haversineMeters(point, target);
      if (meters <= nearestMeters) {
        nearest = index;
        nearestMeters = meters;
      }
    });
    if (nearest >= 0) picks.push({ index: nearest, role: 'waypoint', name: waypoint.name });
  }

  // Merge picks that sit on top of each other; a waypoint's name survives the merge.
  const minGap = totalDistanceMeters * MIN_CHECKPOINT_GAP_SHARE;
  const merged: typeof picks = [];
  for (const pick of [...picks].sort((a, b) => points[a.index].distanceMeters - points[b.index].distanceMeters)) {
    const previous = merged[merged.length - 1];
    if (previous && points[pick.index].distanceMeters - points[previous.index].distanceMeters < minGap) {
      const keep = ROLE_RANK[pick.role] > ROLE_RANK[previous.role] ? pick : previous;
      const drop = keep === pick ? previous : pick;
      merged[merged.length - 1] = { ...keep, name: keep.name ?? drop.name };
      continue;
    }
    merged.push(pick);
  }
  // Too many named places: keep the ends and the most important of the rest.
  let chosen = merged;
  if (chosen.length > MAX_CHECKPOINT_COUNT) {
    const ends = chosen.filter((pick) => pick.role === 'start' || pick.role === 'finish');
    const middle = chosen.filter((pick) => !ends.includes(pick))
      .sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role])
      .slice(0, MAX_CHECKPOINT_COUNT - ends.length);
    chosen = [...ends, ...middle].sort((a, b) => a.index - b.index);
  }
  // Fill the widest gaps until the route has enough checkpoints.
  while (chosen.length < Math.min(TARGET_CHECKPOINT_COUNT, points.length)) {
    let widest = -1;
    let widestGap = 0;
    for (let i = 1; i < chosen.length; i += 1) {
      const gap = points[chosen[i].index].distanceMeters - points[chosen[i - 1].index].distanceMeters;
      if (gap > widestGap && chosen[i].index - chosen[i - 1].index > 1) {
        widest = i;
        widestGap = gap;
      }
    }
    if (widest < 0) break;
    const from = chosen[widest - 1].index;
    const to = chosen[widest].index;
    const middle = (points[from].distanceMeters + points[to].distanceMeters) / 2;
    let best = from + 1;
    for (let index = from + 1; index < to; index += 1) {
      if (Math.abs(points[index].distanceMeters - middle) < Math.abs(points[best].distanceMeters - middle)) best = index;
    }
    chosen = [...chosen.slice(0, widest), { index: best, role: 'even' }, ...chosen.slice(widest)];
  }

  return chosen.map(({ index, role, name }) => {
    const point = points[index];
    const progress = totalDistanceMeters > 0
      ? Math.round((point.distanceMeters / totalDistanceMeters) * 100)
      : Math.round((index / Math.max(1, points.length - 1)) * 100);
    const fallback = role === 'start' ? 'Route start'
      : role === 'finish' ? 'Route finish'
        : role === 'high' ? 'High point'
          : role === 'low' ? 'Low point'
            : `${progress}% checkpoint`;
    return {
      name: name || fallback,
      lat: Number(point.lat.toFixed(6)),
      lon: Number(point.lon.toFixed(6)),
      ...(point.elevationMeters !== null
        ? { elev_ft: Math.round(point.elevationMeters * METERS_TO_FEET) }
        : {}),
      distance_miles: Number((point.distanceMeters / METERS_PER_MILE).toFixed(2)),
      progress_percent: progress,
    };
  });
}

function chooseDisplayTrack(points: ParsedTrackPoint[], totalDistanceMeters: number, highestIndex = -1): GpxTrackPoint[] {
  const stride = Math.max(1, Math.ceil(points.length / MAX_DISPLAY_TRACK_POINTS));
  const indices = points.map((_, index) => index)
    .filter((index) => index === 0 || index === points.length - 1 || index % stride === 0);
  // Keeping the end point can put a strided track one over the limit (1,000
  // points at stride 2 is 500 samples plus the end); drop the sample before it.
  if (indices.length > MAX_DISPLAY_TRACK_POINTS) indices.splice(indices.length - 2, 1);
  // The report is read at the high point, so the track that times the approach
  // must reach it: it takes the place of the nearer interior sample beside it.
  if (highestIndex >= 0 && !indices.includes(highestIndex)) {
    const after = indices.findIndex((index) => index > highestIndex);
    const before = after - 1;
    const interior = (position: number) => position > 0 && position < indices.length - 1;
    if (indices.length < MAX_DISPLAY_TRACK_POINTS) indices.splice(after, 0, highestIndex);
    else if (interior(before) && (!interior(after) || highestIndex - indices[before] <= indices[after] - highestIndex)) indices[before] = highestIndex;
    else indices[after] = highestIndex;
  }
  const selected = indices.map((index) => points[index]);
  return selected.map((point, index) => ({
    lat: Number(point.lat.toFixed(6)),
    lon: Number(point.lon.toFixed(6)),
    ...(point.elevationMeters !== null ? { elev_ft: Math.round(point.elevationMeters * METERS_TO_FEET) } : {}),
    progress_percent: totalDistanceMeters > 0
      ? Math.round((point.distanceMeters / totalDistanceMeters) * 1000) / 10
      : Math.round((index / Math.max(1, selected.length - 1)) * 1000) / 10,
  }));
}

/**
 * The track's distance and elevation, [miles, feet | null] per display point, so
 * route analysis can time arrivals over every climb and descent between checkpoints.
 */
export function gpxTrackForAnalysis(route: Pick<ParsedGpxRoute, 'distanceMiles' | 'displayTrack'>): Array<[number, number | null]> | undefined {
  const points = (route.displayTrack || []).filter((point) => Number.isFinite(point.progress_percent));
  if (points.length < 2 || !(route.distanceMiles > 0)) return undefined;
  return points.map((point) => [
    Number(((point.progress_percent / 100) * route.distanceMiles).toFixed(3)),
    Number.isFinite(point.elev_ft) ? (point.elev_ft as number) : null,
  ]);
}

// Descents cost a third of the climbing rate, as in the backend's route timing.
const DESCENT_SHARE_OF_ASCENT = 1 / 3;

/**
 * Hours for a route at the traveler's pace: distance, climbing, descent and stops,
 * the same model the backend uses for route checkpoints. Descent is the given
 * loss, else the drops along the display track, else none.
 */
export function estimateRouteDurationHours(
  route: Pick<ParsedGpxRoute, 'distanceMiles' | 'elevationGainFt'> & { elevationLossFt?: number | null; displayTrack?: GpxTrackPoint[] },
  profile: RouteTimingProfile,
): number {
  const trackLoss = (route.displayTrack || []).reduce((total, point, index, track) => {
    const previous = track[index - 1];
    return previous && Number.isFinite(previous.elev_ft) && Number.isFinite(point.elev_ft)
      ? total + Math.max(0, (previous.elev_ft as number) - (point.elev_ft as number)) : total;
  }, 0);
  const lossFt = Number.isFinite(route.elevationLossFt) ? Math.max(0, route.elevationLossFt as number) : trackLoss;
  const distanceMinutes = Math.max(0, route.distanceMiles) * Math.max(5, profile.paceMinutesPerMile);
  const ascentRate = Math.max(0, profile.ascentMinutesPer1000Ft);
  const ascentMinutes = Math.max(0, route.elevationGainFt || 0) / 1000 * ascentRate;
  const descentMinutes = lossFt / 1000 * ascentRate * DESCENT_SHARE_OF_ASCENT;
  const totalMinutes = distanceMinutes + ascentMinutes + descentMinutes + Math.max(0, profile.stopBufferMinutes);
  return Math.max(1, Math.min(24, Math.round(totalMinutes / 60)));
}

/**
 * Where a route's report is read: its highest point, where wind, cold and storms
 * are worst. Without elevations, the checkpoint nearest halfway.
 */
export function gpxObjectivePoint(route: Pick<ParsedGpxRoute, 'checkpoints' | 'displayTrack' | 'highPoint'>): { lat: number; lon: number; elev_ft?: number } {
  if (route.highPoint) return route.highPoint;
  const withElevation = [...route.checkpoints, ...(route.displayTrack || [])]
    .filter((point) => Number.isFinite(point.elev_ft));
  if (withElevation.length) {
    return withElevation.reduce((best, point) => ((point.elev_ft as number) > (best.elev_ft as number) ? point : best));
  }
  return route.checkpoints.reduce((closest, checkpoint) =>
    Math.abs(checkpoint.progress_percent - 50) < Math.abs(closest.progress_percent - 50) ? checkpoint : closest);
}

export function parseGpxText(xmlText: string, fileName = 'Imported route.gpx'): ParsedGpxRoute {
  const document = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (document.querySelector('parsererror')) {
    throw new Error('This file is not valid GPX XML.');
  }
  if (document.documentElement.localName !== 'gpx') {
    throw new Error('Choose a GPX file containing a track or route.');
  }

  const points = extractTrackPoints(document);
  if (points.length < 2) {
    throw new Error('The GPX file needs at least two valid track or route points.');
  }
  const totalDistanceMeters = points[points.length - 1].distanceMeters;
  if (totalDistanceMeters <= 0) {
    throw new Error('The GPX track does not contain a measurable route.');
  }

  const elevations = points
    .map((point) => point.elevationMeters)
    .filter((value): value is number => value !== null);
  let elevationGainMeters = 0;
  let previousPoint: ParsedTrackPoint | null = null;
  for (const point of points) {
    if (point.elevationMeters !== null && previousPoint?.elevationMeters !== null && previousPoint?.segment === point.segment) {
      const gain = point.elevationMeters - previousPoint.elevationMeters;
      // Ignore sub-meter GPS jitter while retaining real rolling terrain.
      if (gain >= 1) elevationGainMeters += gain;
    }
    previousPoint = point;
  }
  const highest = points.reduce<ParsedTrackPoint | null>((best, point) =>
    point.elevationMeters !== null && (best === null || point.elevationMeters > (best.elevationMeters as number)) ? point : best, null);

  return {
    name: routeName(document, fileName),
    fileName,
    pointCount: points.length,
    distanceMiles: Number((totalDistanceMeters / METERS_PER_MILE).toFixed(2)),
    elevationGainFt: elevations.length > 1 ? Math.round(elevationGainMeters * METERS_TO_FEET) : null,
    minElevationFt: elevations.length > 0 ? Math.round(Math.min(...elevations) * METERS_TO_FEET) : null,
    maxElevationFt: elevations.length > 0 ? Math.round(Math.max(...elevations) * METERS_TO_FEET) : null,
    checkpoints: chooseCheckpoints(points, totalDistanceMeters, extractNamedWaypoints(document)),
    displayTrack: chooseDisplayTrack(points, totalDistanceMeters, highest ? points.indexOf(highest) : -1),
    routeShape: haversineMeters(points[0], points[points.length - 1]) <= 250 ? 'closed route' : 'point-to-point',
    ...(highest ? {
      highPoint: {
        lat: Number(highest.lat.toFixed(6)),
        lon: Number(highest.lon.toFixed(6)),
        elev_ft: Math.round((highest.elevationMeters as number) * METERS_TO_FEET),
      },
    } : {}),
  };
}

export async function parseGpxFile(file: File): Promise<ParsedGpxRoute> {
  if (!/\.gpx$/i.test(file.name)) {
    throw new Error('Choose a file with a .gpx extension.');
  }
  if (file.size > MAX_GPX_FILE_BYTES) {
    throw new Error('GPX files are limited to 5 MB.');
  }
  return parseGpxText(await file.text(), file.name);
}
