// Daylight-margin / finish-by-dark engine for fast-and-light objectives.
//
// A mountain runner's core planning question is "if I start at T and this takes
// me ~N hours, do I finish with light, and do I need a headlamp?" This module
// estimates a moving-time budget from distance + vertical gain (or an explicit
// duration) and compares the projected finish against sunset.

export interface PaceModel {
  /** Flat-ground equivalent pace, minutes per kilometre. */
  flatPaceMinPerKm: number;
  /** Added minutes per 100 m of ascent. */
  climbMinPer100m: number;
}

// A trail runner covers ground far faster than the classic Naismith hiker rule
// (which assumes ~12 min/km + 10 min per 100 m). Defaults below are tuned for a
// fit runner on mixed mountain terrain; callers can override per objective.
export const RUNNER_PACE_DEFAULTS: PaceModel = { flatPaceMinPerKm: 8, climbMinPer100m: 8 };
export const HIKER_PACE_DEFAULTS: PaceModel = { flatPaceMinPerKm: 13, climbMinPer100m: 10 };

export interface TripDurationInputs {
  distanceKm?: number | null;
  gainM?: number | null;
  /** Explicit moving-time override, in minutes. Wins over distance/gain when set. */
  durationMinutes?: number | null;
  pace?: Partial<PaceModel>;
}

/**
 * Estimate moving time in minutes. Returns null when there is nothing to base an
 * estimate on (no explicit duration and no distance).
 */
export function estimateTripDurationMinutes(inputs: TripDurationInputs, base: PaceModel = RUNNER_PACE_DEFAULTS): number | null {
  const explicit = Number(inputs.durationMinutes);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.round(explicit);
  }

  const distanceKm = Number(inputs.distanceKm);
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    return null;
  }

  const gainM = Number.isFinite(Number(inputs.gainM)) ? Math.max(0, Number(inputs.gainM)) : 0;
  const flatPace = Number.isFinite(Number(inputs.pace?.flatPaceMinPerKm)) ? Number(inputs.pace?.flatPaceMinPerKm) : base.flatPaceMinPerKm;
  const climbRate = Number.isFinite(Number(inputs.pace?.climbMinPer100m)) ? Number(inputs.pace?.climbMinPer100m) : base.climbMinPer100m;

  const flatMinutes = distanceKm * flatPace;
  const climbMinutes = (gainM / 100) * climbRate;
  return Math.round(flatMinutes + climbMinutes);
}

export type DaylightTone = 'go' | 'caution' | 'nogo';

export interface DaylightMargin {
  /** Projected finish (start + duration), in minutes-after-midnight; may exceed 1440. */
  finishMinutes: number;
  durationMinutes: number;
  /** Sunset minus finish, in minutes. Negative means finishing after dark. */
  marginMinutes: number;
  startsBeforeSunrise: boolean;
  finishesAfterSunset: boolean;
  /** Minutes spent moving in darkness (pre-sunrise + post-sunset). */
  darkMinutes: number;
  headlampLikely: boolean;
  tone: DaylightTone;
  headline: string;
  detail: string;
}

export interface DaylightMarginInputs {
  startMinutes: number | null;
  sunriseMinutes: number | null;
  sunsetMinutes: number | null;
  durationMinutes: number | null;
  /** Comfort buffer before sunset, in minutes. Below this → caution. */
  bufferMinutes?: number;
}

function formatGap(minutes: number): string {
  const abs = Math.abs(Math.round(minutes));
  if (abs >= 60) {
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return m > 0 ? `${h} h ${m} min` : `${h} h`;
  }
  return `${abs} min`;
}

/**
 * Compare a projected finish against sunset and decide whether a headlamp is
 * warranted. Returns null when the required inputs are missing.
 */
export function buildDaylightMargin(inputs: DaylightMarginInputs): DaylightMargin | null {
  const { startMinutes, sunriseMinutes, sunsetMinutes, durationMinutes } = inputs;
  if (startMinutes === null || sunsetMinutes === null || durationMinutes === null || durationMinutes <= 0) {
    return null;
  }

  const buffer = Number.isFinite(Number(inputs.bufferMinutes)) ? Number(inputs.bufferMinutes) : 30;
  const finishMinutes = startMinutes + durationMinutes;
  const marginMinutes = sunsetMinutes - finishMinutes;

  const startsBeforeSunrise = sunriseMinutes !== null && startMinutes < sunriseMinutes;
  const finishesAfterSunset = finishMinutes > sunsetMinutes;

  const preSunriseDark = startsBeforeSunrise && sunriseMinutes !== null
    ? Math.max(0, Math.min(sunriseMinutes, finishMinutes) - startMinutes)
    : 0;
  const postSunsetDark = finishesAfterSunset ? Math.max(0, finishMinutes - Math.max(startMinutes, sunsetMinutes)) : 0;
  const darkMinutes = preSunriseDark + postSunsetDark;

  const headlampLikely = darkMinutes > 0 || marginMinutes < buffer;

  let tone: DaylightTone;
  if (finishesAfterSunset) {
    tone = 'nogo';
  } else if (marginMinutes < buffer || startsBeforeSunrise) {
    tone = 'caution';
  } else {
    tone = 'go';
  }

  let headline: string;
  if (finishesAfterSunset) {
    headline = `Finishing ~${formatGap(marginMinutes)} after dark`;
  } else if (marginMinutes < buffer) {
    headline = `Only ${formatGap(marginMinutes)} of daylight to spare`;
  } else {
    headline = `${formatGap(marginMinutes)} of daylight in hand`;
  }

  const parts: string[] = [];
  if (startsBeforeSunrise) {
    parts.push(`Start is ${formatGap(preSunriseDark)} before sunrise — headlamp for the approach.`);
  }
  if (finishesAfterSunset) {
    parts.push(`Estimated finish runs ${formatGap(postSunsetDark)} past sunset. Carry a headlamp and consider a shorter line or earlier start.`);
  } else if (marginMinutes < buffer) {
    parts.push('Margin is thin — any slowdown puts the finish in the dark. Pack a headlamp.');
  } else {
    parts.push('Comfortable finish before sunset on the estimated pace.');
  }

  return {
    finishMinutes,
    durationMinutes,
    marginMinutes,
    startsBeforeSunrise,
    finishesAfterSunset,
    darkMinutes,
    headlampLikely,
    tone,
    headline,
    detail: parts.join(' '),
  };
}
