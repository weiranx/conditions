import { parseOptionalFiniteNumber } from './core';

export function normalizeElevationInput(rawValue: string | null | undefined): string {
  if (!rawValue) {
    return '';
  }
  const cleaned = rawValue.trim().replace(/,/g, '');
  if (!/^\d{3,5}$/.test(cleaned)) {
    return '';
  }
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 20000) {
    return '';
  }
  return String(Math.round(numeric));
}

export function parseOptionalElevationInput(rawValue: string): number | null {
  const cleaned = String(rawValue || '').trim().replace(/,/g, '');
  if (!cleaned) {
    return null;
  }
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
}

export function parsePrecipNumericValue(value: unknown): number {
  const parsed = parseOptionalFiniteNumber(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  if (typeof value !== 'string') {
    return Number.NaN;
  }
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return Number.NaN;
  }
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

export function computeFeelsLikeF(tempF: number, windMph: number): number {
  if (!Number.isFinite(tempF)) {
    return tempF;
  }
  if (tempF <= 50 && windMph >= 3) {
    const feelsLike = 35.74 + 0.6215 * tempF - 35.75 * Math.pow(windMph, 0.16) + 0.4275 * tempF * Math.pow(windMph, 0.16);
    return Math.round(feelsLike);
  }
  return Math.round(tempF);
}

export function normalizeDangerLevel(level: number | undefined): number {
  if (!Number.isFinite(level)) {
    return 0;
  }
  return Math.max(0, Math.min(5, Math.round(level || 0)));
}

export function getDangerLevelClass(level: number | undefined): string {
  return `danger-level-${normalizeDangerLevel(level)}`;
}
