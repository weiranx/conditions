import type { WeatherTrendPoint } from './types';
import { windDirectionToDegrees, ASPECT_ROSE_ORDER } from '../utils/avalanche';

export function normalizeWindHintDirection(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = String(value).trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  if (normalized === 'VARIABLE') {
    return 'VRB';
  }
  if (normalized === 'VRB' || normalized === 'CALM') {
    return normalized;
  }
  return windDirectionToDegrees(normalized) === null ? null : normalized;
}

export function windDirectionDeltaDegrees(a: string | null | undefined, b: string | null | undefined): number | null {
  const aDeg = windDirectionToDegrees(a || null);
  const bDeg = windDirectionToDegrees(b || null);
  if (aDeg === null || bDeg === null) {
    return null;
  }
  const diff = Math.abs(aDeg - bDeg) % 360;
  return diff > 180 ? 360 - diff : diff;
}

const SIXTEEN_WAY_DIRECTIONS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'] as const;

export function windDirectionFromDegrees(value: number | null | undefined): string {
  const degrees = Number(value);
  if (!Number.isFinite(degrees)) {
    return 'N/A';
  }
  const normalized = ((degrees % 360) + 360) % 360;
  const index = Math.round(normalized / 22.5) % 16;
  return SIXTEEN_WAY_DIRECTIONS[index];
}

export function resolveDominantTrendWindDirection(trend: WeatherTrendPoint[] | null | undefined): {
  direction: string | null;
  count: number;
  total: number;
  ratio: number;
} {
  const directionalRows = Array.isArray(trend)
    ? trend
        .map((row) => normalizeWindHintDirection(row.windDirection))
        .filter((entry): entry is string => Boolean(entry) && entry !== 'CALM' && entry !== 'VRB')
    : [];
  if (directionalRows.length === 0) {
    return { direction: null, count: 0, total: 0, ratio: 0 };
  }

  const counts = new Map<string, number>();
  directionalRows.forEach((direction) => {
    counts.set(direction, (counts.get(direction) || 0) + 1);
  });
  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top) {
    return { direction: null, count: 0, total: directionalRows.length, ratio: 0 };
  }

  return {
    direction: top[0],
    count: top[1],
    total: directionalRows.length,
    ratio: top[1] / directionalRows.length,
  };
}
