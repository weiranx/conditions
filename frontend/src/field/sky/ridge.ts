/** Shapes and text shared by the mountain drawings. */
import type { SkyHour } from "./sky-model";

export type Weather = Pick<SkyHour, "kind" | "condition" | "precipChance" | "night">;

/** Deterministic 0–1 noise so precipitation marks hold still between renders. */
export const noise = (i: number, j: number, salt: number) => {
  const v = Math.sin(i * 127.1 + j * 311.7 + salt * 74.7) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * The illustrative ridge shared by the mountain drawings: it rises from `base`
 * on the left to a summit just above `top`, then falls away to the right.
 * `x` finds the rising slope at an elevation, so markers sit on the ridge.
 */
export function ridgeShape({ plotW, height, y, base, top, peakAt = 0.62 }: {
  plotW: number;
  height: number;
  y: (ft: number) => number;
  base: number;
  top: number;
  /** Summit position as a fraction of the plot width. */
  peakAt?: number;
}) {
  const span = top - base;
  const peakX = plotW * peakAt;
  const k = peakAt / 0.62;
  const ridge = [
    [0, y(base - 200)], [plotW * 0.18 * k, y(base + span * 0.22)], [plotW * 0.34 * k, y(base + span * 0.48)],
    [plotW * 0.47 * k, y(base + span * 0.8)], [peakX, y(top + 250)], [peakX + (plotW - peakX) * 0.32, y(base + span * 0.72)],
    [peakX + (plotW - peakX) * 0.63, y(base + span * 0.5)], [plotW, y(base + span * 0.34)], [plotW, height], [0, height],
  ];
  const path = `M${ridge.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" L")} Z`;
  const x = (ft: number) => {
    const pts = ridge.slice(0, 5);
    const yy = y(ft);
    for (let i = 1; i < pts.length; i += 1) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      if (yy <= y0 && yy >= y1) return x0 + ((y0 - yy) / (y0 - y1 || 1)) * (x1 - x0);
    }
    return yy > pts[0][1] ? 0 : peakX;
  };
  return { path, x, peakX };
}

/** Condition and precipitation chance; `maxLength` shortens the condition for the visible label. */
export function precipText(weather: Weather, maxLength = Infinity) {
  const chance = Number.isFinite(weather.precipChance) ? Math.round(weather.precipChance) : null;
  const condition = weather.condition.trim();
  const shown = condition.length > maxLength ? `${condition.slice(0, maxLength - 1)}…` : condition;
  return [shown, chance !== null && chance > 0 ? `${chance}% precip` : null].filter(Boolean).join(" · ");
}
