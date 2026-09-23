import type { TravelWindowRow } from "../../app/types";
import { parseTimeInputMinutes } from "../../app/core";
import { weatherAppearance } from "../weather-appearance";

/** A planned weather row as produced by buildPlannedReportWeatherRows. */
export type PlannedRow = TravelWindowRow & { complete: boolean; thermalComplete?: boolean };

export type SkyTone = "within" | "over" | "missing";

export type SkyHour = {
  index: number;
  /** Minutes after local midnight on the plan date; can exceed 1440 for overnight trips. */
  minute: number;
  time: string;
  tone: SkyTone;
  temp: number;
  feelsLike: number;
  wind: number;
  gust: number;
  /** Temperature and wind were measured, whatever else is missing. */
  thermalComplete: boolean;
  precipChance: number;
  failedRules: string[];
  /** Estimated party elevation when the hour was scored below the objective. */
  elevationFt?: number;
  approachAdjusted?: boolean;
  inversionRisk?: boolean;
  /** Objective-elevation reading when temp/wind/gust were shifted to the approach. */
  objectiveReading?: { temp: number; wind: number; gust: number };
  kind: ReturnType<typeof weatherAppearance>["condition"];
  night: boolean;
  zenith: string;
  horizon: string;
};

export type SkyRun = { start: number; end: number; tone: Exclude<SkyTone, "within"> };

const measured = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

// Sky colours by light and weather. The palette is illustrative, but every
// choice is driven by the hour's forecast: night, twilight, cloud and rain.
const PALETTE = {
  night: ["#1a2440", "#2c3858"],
  twilight: ["#4f7fbf", "#f2c49c"],
  dusk: ["#3f5f9f", "#f3a86f"],
  clear: ["#357fd0", "#d3e5f5"],
  partly: ["#3f7fc8", "#c9dcee"],
  cloudy: ["#5b7a98", "#c3ccd4"],
  showers: ["#4a6f94", "#aebcc7"],
  storm: ["#3c4753", "#7e8a95"],
} as const;

function paletteFor(minuteOfDay: number, sunrise: number | null, sunset: number | null,
  kind: SkyHour["kind"], precip: number) {
  const known = sunrise !== null && sunset !== null;
  const night = known && (minuteOfDay < sunrise - 30 || minuteOfDay > sunset + 30);
  if (night) return { colors: PALETTE.night, night: true };
  const wet = kind === "rain" || kind === "snow" || kind === "storm" || (measured(precip) && precip >= 60);
  if (wet) return { colors: PALETTE.storm, night: false };
  if (measured(precip) && precip >= 30) return { colors: PALETTE.showers, night: false };
  if (known && Math.abs(minuteOfDay - sunrise) <= 60) return { colors: PALETTE.twilight, night: false };
  if (known && Math.abs(minuteOfDay - sunset) <= 75) return { colors: PALETTE.dusk, night: false };
  if (kind === "cloudy" || kind === "fog") return { colors: PALETTE.cloudy, night: false };
  if (kind === "partly") return { colors: PALETTE.partly, night: false };
  return { colors: PALETTE.clear, night: false };
}

function hex(color: string) {
  return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
}

function blend(a: number[], b: number[], c: number[]) {
  return "#" + b.map((v, i) => Math.round((a[i] + 2 * v + c[i]) / 4).toString(16).padStart(2, "0")).join("");
}

/** Soften hour-to-hour changes so the sky reads as one continuous day. */
export function smoothSky(hours: SkyHour[], passes = 2): SkyHour[] {
  let out = hours.map((h) => ({ ...h }));
  for (let p = 0; p < passes; p += 1) {
    const z = out.map((h) => hex(h.zenith));
    const hz = out.map((h) => hex(h.horizon));
    out = out.map((h, i) => ({
      ...h,
      zenith: blend(z[Math.max(0, i - 1)], z[i], z[Math.min(z.length - 1, i + 1)]),
      horizon: blend(hz[Math.max(0, i - 1)], hz[i], hz[Math.min(hz.length - 1, i + 1)]),
    }));
  }
  return out;
}

export function buildSkyHours(rows: PlannedRow[], plan: {
  start: string;
  sunriseMinutes: number | null;
  sunsetMinutes: number | null;
}): SkyHour[] {
  const start = parseTimeInputMinutes(plan.start);
  const hours = rows.map((row, index): SkyHour => {
    const minute = start === null ? NaN : start + index * 60;
    const minuteOfDay = Number.isFinite(minute) ? minute % 1440 : 720;
    const appearance = weatherAppearance({ condition: row.condition, isDaytime: null });
    const { colors, night } = paletteFor(minuteOfDay, plan.sunriseMinutes, plan.sunsetMinutes,
      appearance.condition, row.precipChance);
    return {
      index,
      minute,
      time: row.time,
      tone: !row.complete ? "missing" : row.pass ? "within" : "over",
      temp: row.temp,
      feelsLike: row.feelsLike,
      wind: row.wind,
      gust: row.gust,
      thermalComplete: row.thermalComplete ?? row.complete,
      precipChance: row.precipChance,
      failedRules: row.failedRules,
      elevationFt: row.elevationFt,
      approachAdjusted: row.approachAdjusted,
      inversionRisk: row.inversionRisk,
      objectiveReading: row.objectiveReading,
      kind: appearance.condition,
      night,
      zenith: colors[0],
      horizon: colors[1],
    };
  });
  return smoothSky(hours);
}

/**
 * Contiguous runs of hours that need attention. A known limit breach wins over
 * missing evidence, so an incomplete hour with a measured breach reads as "over".
 */
export function skyRuns(hours: SkyHour[]): SkyRun[] {
  const runs: SkyRun[] = [];
  hours.forEach((hour, index) => {
    const tone = hour.tone === "over" || hour.failedRules.length > 0 ? "over" : hour.tone;
    if (tone === "within") return;
    const last = runs[runs.length - 1];
    if (last && last.tone === tone && last.end === index - 1) last.end = index;
    else runs.push({ start: index, end: index, tone });
  });
  return runs;
}

/** Hours whose readings breach a limit, even if other readings are missing. */
export function isOverHour(hour: SkyHour) {
  return hour.tone === "over" || hour.failedRules.length > 0;
}

/** Position of the sun along its arc, 0 at sunrise and 1 at sunset; null at night or when unknown. */
export function sunProgress(minute: number, sunrise: number | null, sunset: number | null) {
  if (sunrise === null || sunset === null || !Number.isFinite(minute) || sunset <= sunrise) return null;
  const minuteOfDay = ((minute % 1440) + 1440) % 1440;
  const t = (minuteOfDay - sunrise) / (sunset - sunrise);
  return t < 0 || t > 1 ? null : t;
}

/** "7a", "12p" or "07", "13" for compact hour ticks. */
export function shortHour(minute: number, style: "12h" | "24h" | string) {
  if (!Number.isFinite(minute)) return "—";
  const h = Math.floor((((minute % 1440) + 1440) % 1440) / 60);
  if (style === "24h") return String(h).padStart(2, "0");
  return `${h % 12 || 12}${h < 12 ? "a" : "p"}`;
}

/** Plain-language span for a run, e.g. "12–4 PM" (end is exclusive: the hour after the last over hour). */
export function spanLabel(hours: SkyHour[], run: { start: number; end: number }, format: (minute: number) => string) {
  const a = hours[run.start]?.minute;
  const b = hours[run.end]?.minute;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "";
  return `${format(a)}–${format(b + 60)}`;
}
