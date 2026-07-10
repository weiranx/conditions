const METERS_TO_FEET = 3.28084;
const METERS_PER_MILE = 1609.344;
const MAX_GPX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TRACK_POINTS = 100_000;
const DEFAULT_CHECKPOINT_COUNT = 5;

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

export type ParsedGpxRoute = {
  name: string;
  fileName: string;
  pointCount: number;
  distanceMiles: number;
  elevationGainFt: number | null;
  minElevationFt: number | null;
  maxElevationFt: number | null;
  checkpoints: GpxCheckpoint[];
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
    : [{
        segment: 0,
        elements: elementsByLocalName(document, 'rtept'),
      }];

  const points: ParsedTrackPoint[] = [];
  for (const source of sources) {
    for (const element of source.elements) {
      if (points.length >= MAX_TRACK_POINTS) {
        throw new Error(`GPX files are limited to ${MAX_TRACK_POINTS.toLocaleString()} track points.`);
      }
      const lat = Number(element.getAttribute('lat'));
      const lon = Number(element.getAttribute('lon'));
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

function chooseCheckpoints(points: ParsedTrackPoint[], totalDistanceMeters: number): GpxCheckpoint[] {
  const count = Math.min(DEFAULT_CHECKPOINT_COUNT, points.length);
  const selectedIndexes: number[] = [0];
  for (let i = 1; i < count - 1; i += 1) {
    const targetDistance = (totalDistanceMeters * i) / (count - 1);
    const minimumIndex = selectedIndexes[selectedIndexes.length - 1] + 1;
    const maximumIndex = points.length - (count - i);
    let selectedIndex = minimumIndex;
    let smallestDifference = Infinity;
    for (let index = minimumIndex; index <= maximumIndex; index += 1) {
      const difference = Math.abs(points[index].distanceMeters - targetDistance);
      if (difference < smallestDifference) {
        selectedIndex = index;
        smallestDifference = difference;
      }
    }
    selectedIndexes.push(selectedIndex);
  }
  if (points.length > 1) selectedIndexes.push(points.length - 1);

  return selectedIndexes
    .map((index, checkpointIndex, selected) => {
      const point = points[index];
      const progress = totalDistanceMeters > 0
        ? Math.round((point.distanceMeters / totalDistanceMeters) * 100)
        : Math.round((index / Math.max(1, points.length - 1)) * 100);
      const name = checkpointIndex === 0
        ? 'Route start'
        : checkpointIndex === selected.length - 1
          ? 'Route finish'
          : `${progress}% checkpoint`;
      return {
        name,
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

  return {
    name: routeName(document, fileName),
    fileName,
    pointCount: points.length,
    distanceMiles: Number((totalDistanceMeters / METERS_PER_MILE).toFixed(2)),
    elevationGainFt: elevations.length > 1 ? Math.round(elevationGainMeters * METERS_TO_FEET) : null,
    minElevationFt: elevations.length > 0 ? Math.round(Math.min(...elevations) * METERS_TO_FEET) : null,
    maxElevationFt: elevations.length > 0 ? Math.round(Math.max(...elevations) * METERS_TO_FEET) : null,
    checkpoints: chooseCheckpoints(points, totalDistanceMeters),
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
