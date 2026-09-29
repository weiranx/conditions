import type { Workspace } from "./model/useWorkspace";
import {
  formatDistanceForElevationUnit,
  formatRainAmountForElevationUnit,
  formatSnowDepthForElevationUnit,
  formatSweForElevationUnit,
  isFiniteNumber,
  parseIsoToMs,
} from "../app/core";
import { ageLabel } from "./data";

/** Formatters for evidence rows: each returns null for a missing reading so the row is dropped. */
export function evidenceFormat(w: Workspace) {
  const unit = w.preferences.elevationUnit;
  const num = (value: unknown): value is number => isFiniteNumber(value);
  const time = (iso: string | null | undefined) =>
    iso && parseIsoToMs(iso) !== null ? w.formatPubTime(iso) : null;
  return {
    temp: (f: number | null | undefined) => (num(f) ? w.formatTempDisplay(f) : null),
    wind: (mph: number | null | undefined) => (num(mph) ? w.formatWindDisplay(mph) : null),
    elevation: (ft: number | null | undefined) => (num(ft) ? w.formatElevationDisplay(ft) : null),
    distance: (km: number | null | undefined) => (num(km) ? `${formatDistanceForElevationUnit(km, unit)} away` : null),
    rain: (inches: number | null | undefined) => (num(inches) ? formatRainAmountForElevationUnit(inches, null, unit) : null),
    depth: (inches: number | null | undefined) => (num(inches) ? formatSnowDepthForElevationUnit(inches, unit) : null),
    swe: (inches: number | null | undefined) => (num(inches) ? formatSweForElevationUnit(inches, unit) : null),
    percent: (value: number | null | undefined) => (num(value) ? `${Math.round(value)}%` : null),
    number: (value: number | null | undefined, suffix = "") =>
      num(value) ? `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}` : null,
    time,
    /** When an observation was taken, and how long ago. */
    observed: (iso: string | null | undefined) => {
      const at = time(iso);
      return at ? `${at} · ${ageLabel(iso)}` : null;
    },
    text: (value: string | null | undefined) => (value && value.trim() ? w.localizeUnitText(value) : null),
    texts: (values: Array<string | null | undefined> | null | undefined) =>
      (values ?? []).filter((value): value is string => Boolean(value && value.trim())).map(w.localizeUnitText),
  };
}

export type EvidenceFormat = ReturnType<typeof evidenceFormat>;

/** "no_echo_detected" → "No echo detected". */
export const readable = (value: string | null | undefined) =>
  value ? value.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase()) : null;
