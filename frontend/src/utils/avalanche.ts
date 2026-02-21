export type TerrainAspect = 'NW' | 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W';
export type TerrainElevationBand = 'upper' | 'middle' | 'lower';

export interface AvalancheProblemFields {
  likelihood?: string;
  size?: Array<string | number> | string | number;
  location?: string[] | string | Record<string, unknown>;
}

export const ASPECT_ROSE_ORDER: TerrainAspect[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
// Ring order is inner -> outer.
// Requested visual mapping:
// inner ring = near treeline, middle ring = above treeline, outer ring = below treeline.
export const ELEVATION_ROSE_ORDER: TerrainElevationBand[] = ['middle', 'upper', 'lower'];
const EIGHT_WAY_ASPECTS: TerrainAspect[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function windDirectionToDegrees(direction: string | null | undefined): number | null {
  if (!direction) {
    return null;
  }
  const normalized = direction.trim().toUpperCase();
  if (normalized === 'CALM' || normalized === 'VRB' || normalized === 'VARIABLE') {
    return null;
  }

  const map: Record<string, number> = {
    N: 0,
    NNE: 22.5,
    NE: 45,
    ENE: 67.5,
    E: 90,
    ESE: 112.5,
    SE: 135,
    SSE: 157.5,
    S: 180,
    SSW: 202.5,
    SW: 225,
    WSW: 247.5,
    W: 270,
    WNW: 292.5,
    NW: 315,
    NNW: 337.5,
  };
  return Number.isFinite(map[normalized]) ? map[normalized] : null;
}

export function leewardAspectsFromWind(direction: string | null | undefined): TerrainAspect[] {
  const windDegrees = windDirectionToDegrees(direction);
  if (windDegrees === null) {
    return [];
  }

  const leewardDegrees = (windDegrees + 180) % 360;
  const centerIndex = Math.round(leewardDegrees / 45) % 8;
  const result = new Set<TerrainAspect>();
  result.add(EIGHT_WAY_ASPECTS[(centerIndex + 7) % 8]);
  result.add(EIGHT_WAY_ASPECTS[centerIndex]);
  result.add(EIGHT_WAY_ASPECTS[(centerIndex + 1) % 8]);
  return Array.from(result);
}

export function polarPoint(cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } {
  const radians = (angleDeg * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

export function buildRoseSectorPath(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startDeg: number,
  endDeg: number,
): string {
  const outerStart = polarPoint(cx, cy, outerRadius, startDeg);
  const outerEnd = polarPoint(cx, cy, outerRadius, endDeg);

  if (innerRadius <= 0) {
    return [
      `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
      `A ${outerRadius} ${outerRadius} 0 0 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
      `L ${cx.toFixed(2)} ${cy.toFixed(2)}`,
      'Z',
    ].join(' ');
  }

  const innerEnd = polarPoint(cx, cy, innerRadius, endDeg);
  const innerStart = polarPoint(cx, cy, innerRadius, startDeg);

  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${outerRadius} ${outerRadius} 0 0 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${innerRadius} ${innerRadius} 0 0 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export function formatProblemSize(size: AvalancheProblemFields['size']): string {
  if (Array.isArray(size)) {
    const values = size
      .map((item) => parseInt(String(item), 10))
      .filter((item) => Number.isFinite(item));

    if (values.length === 0) {
      return 'Not listed';
    }

    const minSize = Math.min(...values);
    const maxSize = Math.max(...values);
    return minSize === maxSize ? `D${minSize}` : `D${minSize}-${maxSize}`;
  }

  if (typeof size === 'number' && Number.isFinite(size)) {
    return `D${size}`;
  }

  if (typeof size === 'string' && size.trim()) {
    const parsed = parseInt(size.trim(), 10);
    if (Number.isFinite(parsed)) {
      return `D${parsed}`;
    }
    return size.trim();
  }

  return 'Not listed';
}

export function parseLikelihoodRange(likelihood: string | undefined): { min: number; max: number } | null {
  if (!likelihood || !likelihood.trim()) {
    return null;
  }

  const normalized = likelihood.trim().toLowerCase().replace(/_/g, ' ');
  const steps = new Set<number>();

  if (/\bcertain\b/.test(normalized)) steps.add(5);
  if (/\bvery\s+likely\b/.test(normalized)) steps.add(4);
  if (/\blikely\b/.test(normalized)) steps.add(3);
  if (/\bpossible\b/.test(normalized)) steps.add(2);
  if (/\bunlikely\b/.test(normalized)) steps.add(1);

  const numericMatches = normalized.match(/\b[1-5]\b/g);
  if (numericMatches) {
    numericMatches.forEach((entry) => steps.add(parseInt(entry, 10)));
  }

  const resolved = Array.from(steps).filter((step) => Number.isFinite(step));
  if (resolved.length === 0) {
    return null;
  }

  return {
    min: Math.min(...resolved),
    max: Math.max(...resolved),
  };
}

export function parseProblemSizeRange(size: AvalancheProblemFields['size']): { min: number | null; max: number | null } {
  const formatted = formatProblemSize(size);
  const match = formatted.match(/d?(\d)(?:\s*-\s*(\d))?/i);
  if (!match) {
    return { min: null, max: null };
  }

  const first = parseInt(match[1], 10);
  const second = match[2] ? parseInt(match[2], 10) : first;
  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    return { min: null, max: null };
  }
  return { min: Math.min(first, second), max: Math.max(first, second) };
}

export function getLocationEntries(location: AvalancheProblemFields['location']): string[] {
  if (!location) {
    return [];
  }

  if (Array.isArray(location)) {
    return location.map((entry) => String(entry)).filter(Boolean);
  }

  if (typeof location === 'string') {
    return location
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (typeof location === 'object') {
    const result: string[] = [];
    for (const [key, value] of Object.entries(location)) {
      if (key) {
        result.push(key);
      }
      if (Array.isArray(value)) {
        value.forEach((item) => result.push(String(item)));
      } else if (value !== null && value !== undefined) {
        result.push(String(value));
      }
    }
    return result.filter(Boolean);
  }

  return [];
}

export function parseTerrainFromLocation(location: AvalancheProblemFields['location']): {
  aspects: Set<TerrainAspect>;
  elevations: Set<TerrainElevationBand>;
} {
  const aspects = new Set<TerrainAspect>();
  const elevations = new Set<TerrainElevationBand>();
  const entries = getLocationEntries(location);

  entries.forEach((rawEntry) => {
    const entry = rawEntry.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
    const tokens = entry.split(/\s+/).filter(Boolean);
    const tokenSet = new Set(tokens);
    const includesAny = (values: string[]) => values.some((value) => tokenSet.has(value));

    const hasAllAspects = /\ball\s+aspects?\b|\ball\s+slopes?\b/.test(entry);
    const hasAllElevations = /\ball\s+elevations?\b/.test(entry);

    if (hasAllAspects) {
      ASPECT_ROSE_ORDER.forEach((aspect) => aspects.add(aspect));
    }

    if (/\bnorthwest\b|\bnw\b/.test(entry)) aspects.add('NW');
    if (/\bnortheast\b|\bne\b/.test(entry)) aspects.add('NE');
    if (/\bsouthwest\b|\bsw\b/.test(entry)) aspects.add('SW');
    if (/\bsoutheast\b|\bse\b/.test(entry)) aspects.add('SE');

    if ((/\bnorth\b/.test(entry) && !/\bnorthwest\b|\bnortheast\b/.test(entry)) || tokenSet.has('n')) aspects.add('N');
    if ((/\bsouth\b/.test(entry) && !/\bsouthwest\b|\bsoutheast\b/.test(entry)) || tokenSet.has('s')) aspects.add('S');
    if ((/\beast\b/.test(entry) && !/\bnortheast\b|\bsoutheast\b/.test(entry)) || tokenSet.has('e')) aspects.add('E');
    if ((/\bwest\b/.test(entry) && !/\bnorthwest\b|\bsouthwest\b/.test(entry)) || tokenSet.has('w')) aspects.add('W');

    const hasUpper = /\bupper\b|\babove\b|\balpine\b|\babove\s*treeline\b|\babove\s*tl\b|\batl\b/.test(entry);
    const hasLower = /\blower\b|\bbelow\b|\bbelow\s*treeline\b|\bbelow\s*tl\b|\bbtl\b/.test(entry);
    const hasTreelineWord = /\btreeline\b|\bnear\s*treeline\b|\bat\s*treeline\b|\bntl\b/.test(entry);
    const hasMiddle = /\bmiddle\b|\bmid\b|\bnear\b/.test(entry) || (hasTreelineWord && !hasUpper && !hasLower);

    if (hasAllElevations) {
      ELEVATION_ROSE_ORDER.forEach((band) => elevations.add(band));
    } else {
      if (hasUpper || includesAny(['atl'])) elevations.add('upper');
      if (hasMiddle || includesAny(['ntl'])) elevations.add('middle');
      if (hasLower || includesAny(['btl'])) elevations.add('lower');
    }
  });

  return { aspects, elevations };
}
