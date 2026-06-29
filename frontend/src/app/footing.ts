// Time-aware footing forecast for fast feet.
//
// A runner moves fast enough to exploit (or get caught by) the melt-freeze
// cycle: firm, supportable snow at dawn turns to energy-sapping slush and
// postholing by mid-morning, then refreezes to ice in the evening. Mud behaves
// the same way after rain. This module reads the hourly temperature trace and
// calls when footing is good, when it falls apart, and when it firms back up.

import type { WeatherTrendPoint } from './types';

export type FootingState = 'firm' | 'softening' | 'isothermal' | 'mud' | 'dry' | 'unknown';
export type FootingTone = 'go' | 'watch' | 'caution';

export interface FootingContext {
  snowDepthIn?: number | null;
  rain24hIn?: number | null;
  snow24hIn?: number | null;
}

export interface FootingForecast {
  hasSignal: boolean;
  state: FootingState;
  tone: FootingTone;
  headline: string;
  detail: string;
  /** Clock label (matches trend `time`) when supportable snow turns to slush. */
  thawTime?: string;
  /** Clock label when the surface refreezes in the evening. */
  refreezeTime?: string;
  /** Best footing window (firm/supportable), if one exists. */
  bestWindow?: { start: string; end: string };
}

const THAW_F = 34; // surface starts to break down a touch above freezing
const FREEZE_F = 32;

export function buildFootingForecast(
  trend: WeatherTrendPoint[] | undefined | null,
  context: FootingContext = {},
): FootingForecast {
  const points = (trend || []).filter((p) => Number.isFinite(Number(p?.temp)) && typeof p?.time === 'string');
  if (points.length < 2) {
    return { hasSignal: false, state: 'unknown', tone: 'go', headline: 'Footing trend unavailable', detail: 'Not enough hourly temperature data to project melt-freeze footing.' };
  }

  const temps = points.map((p) => Number(p.temp));
  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps);
  const crossesFreezing = minTemp <= FREEZE_F && maxTemp > FREEZE_F;

  const snowDepthIn = Number(context.snowDepthIn);
  const hasSnow = Number.isFinite(snowDepthIn) && snowDepthIn >= 2;
  const rain24hIn = Number(context.rain24hIn);
  const wetGround = Number.isFinite(rain24hIn) && rain24hIn >= 0.2;

  // First hour rising above the thaw threshold (start of soft/slushy footing).
  const thawIdx = points.findIndex((p) => Number(p.temp) > THAW_F);
  const thawTime = thawIdx > 0 ? points[thawIdx].time : undefined;
  // After any thaw, the first hour dropping back below freezing (refreeze).
  let refreezeTime: string | undefined;
  if (thawIdx !== -1) {
    for (let i = thawIdx + 1; i < points.length; i += 1) {
      if (Number(points[i].temp) <= FREEZE_F) {
        refreezeTime = points[i].time;
        break;
      }
    }
  }

  if (hasSnow) {
    if (maxTemp <= FREEZE_F) {
      return {
        hasSignal: true,
        state: 'firm',
        tone: 'watch',
        headline: 'Firm, frozen snow all window',
        detail: 'Snow stays below freezing — supportable and fast, but icy. Carry microspikes for traction rather than flotation.',
        bestWindow: { start: points[0].time, end: points[points.length - 1].time },
      };
    }
    if (minTemp > FREEZE_F) {
      return {
        hasSignal: true,
        state: 'isothermal',
        tone: 'caution',
        headline: 'No overnight freeze — soft snow, postholing likely',
        detail: 'Snow never refroze, so expect punchy, isothermal snow and slow, wet footing all window. Floatation (or a different objective) beats spikes here.',
      };
    }
    if (crossesFreezing && thawTime) {
      return {
        hasSignal: true,
        state: 'softening',
        tone: 'caution',
        headline: `Supportable early, slushy after ~${thawTime}`,
        detail: `Snow is firm and fast on the early freeze, then breaks down to slush and postholing around ${thawTime}${refreezeTime ? `, refreezing near ${refreezeTime}` : ''}. Move early and be off softening slopes by mid-morning.`,
        thawTime,
        refreezeTime,
        bestWindow: { start: points[0].time, end: thawTime },
      };
    }
  }

  if (wetGround) {
    const muddyAfternoon = crossesFreezing && thawTime;
    return {
      hasSignal: true,
      state: 'mud',
      tone: 'watch',
      headline: muddyAfternoon ? `Frozen early, muddy after ~${thawTime}` : 'Soft, muddy ground likely',
      detail: muddyAfternoon
        ? `Recent rain plus an overnight freeze means firm trail early that turns greasy and mud-prone as it thaws around ${thawTime}. Aggressive lugs help; tread lightly to limit trail damage.`
        : 'Recent rain has left soft, slick ground. Expect mud on low-angle and shaded sections; aggressive-lug shoes recommended.',
      thawTime,
      refreezeTime,
    };
  }

  if (crossesFreezing && thawTime) {
    return {
      hasSignal: true,
      state: 'softening',
      tone: 'watch',
      headline: `Frozen surfaces early, thawing ~${thawTime}`,
      detail: `Below-freezing overnight then warming through ${thawTime}. Watch for early-morning ice on shaded rock, boardwalk, and stream crossings${refreezeTime ? `; surfaces refreeze near ${refreezeTime}` : ''}.`,
      thawTime,
      refreezeTime,
    };
  }

  return {
    hasSignal: false,
    state: 'dry',
    tone: 'go',
    headline: 'Dry, firm footing expected',
    detail: 'No snow, recent rain, or freeze-thaw signal — footing should stay firm and consistent across the window.',
  };
}
