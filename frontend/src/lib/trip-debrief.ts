import type { PersistedReport } from '../app/report-storage';
import type { RecordedTrackPoint } from './gpx';
import { fetchApi, readApiErrorMessage } from './api-client';

/** Points sent for a debrief; the backend compares at most this many. */
export const MAX_DEBRIEF_POINTS = 5000;

export interface TripDebriefStretch {
  miles: number;
  gainFt?: number;
  lossFt?: number;
  movingMinutes: number | null;
  minutesPerMile: number | null;
  verticalFtPerHour?: number | null;
}

export interface TripDebriefForecast {
  tempF: number | null;
  windMph: number | null;
  gustMph: number | null;
  precipChance: number | null;
  condition: string | null;
  elevationFt: number | null;
}

export interface TripDebriefAtElevation {
  elevationFt: number;
  tempF: number;
  feelsLikeF: number | null;
  windMph: number;
  gustMph: number | null;
}

export interface TripDebriefHour {
  time: string;
  clock: string;
  date: string;
  miles: number;
  lowElevationFt: number | null;
  highElevationFt: number | null;
  forecast: TripDebriefForecast | null;
  atHigh: TripDebriefAtElevation | null;
  atLow: TripDebriefAtElevation | null;
}

export interface TripDebriefPace {
  minutesPerMile: number;
  ascentMinutesPer1000Ft: number;
  stopBufferMinutes: number;
  source: 'route-your-pace' | 'route-default' | 'plan' | 'preferences' | 'activity' | 'default';
}

/** The backend's deterministic comparison, always in miles, feet, °F, mph and minutes. */
export interface TripDebriefComparison {
  version: number;
  timeZone: string | null;
  track: {
    pointCount: number;
    originalPointCount: number;
    downsampled: boolean;
    hasTimes: boolean;
    hasElevation: boolean;
    distanceMiles: number;
    gainFt: number | null;
    lossFt: number | null;
    maxElevationFt: number | null;
    minElevationFt: number | null;
    elapsedMinutes: number | null;
    movingMinutes: number | null;
    stoppedMinutes: number | null;
    movingMinutesPerMile: number | null;
    startTime: string | null;
    finishTime: string | null;
    date: string | null;
    startClock: string | null;
    finishClock: string | null;
    highPoint: { lat: number; lon: number; elevationFt: number; clock: string | null } | null;
    pace: { climbing: TripDebriefStretch | null; descending: TripDebriefStretch | null; flat: TripDebriefStretch | null };
  };
  plan: {
    date: string | null;
    activity: string;
    activityLabel: string;
    startClock: string | null;
    travelWindowHours: number | null;
    endClock: string | null;
    turnaroundClock: string | null;
    darkTurnaroundClock: string | null;
    sunriseClock: string | null;
    sunsetClock: string | null;
    pace: TripDebriefPace;
    route: { name: string | null; distanceMiles: number | null; gainFt: number | null; source: string | null } | null;
    estimatedMinutes: number | null;
    estimateSource: string | null;
  };
  differences: {
    dateMatches: boolean | null;
    startMinutes: number | null;
    elapsedVsWindowMinutes: number | null;
    elapsedVsEstimateMinutes: number | null;
    finishMarginToPlanEndMinutes: number | null;
    finishMarginToSunsetMinutes: number | null;
    highPointMarginToTurnaroundMinutes: number | null;
    distanceMiles: number | null;
    gainFt: number | null;
    plannedMovingMinutes: number | null;
    paceRatio: number | null;
    stoppedVsPlannedMinutes: number | null;
    matchingPace: { minutesPerMile: number; ascentMinutesPer1000Ft: number; stopBufferMinutes: number | null } | null;
  };
  hours: TripDebriefHour[];
  forecastSummary: { hours: number; maxGustMph: number | null; maxWindMph: number | null; minTempF: number | null; maxPrecipChance: number | null } | null;
  notes: string[];
}

export interface TripDebriefResult {
  comparison: TripDebriefComparison;
  /** Short AI write-up (markdown), or null when AI is off or failed. */
  narrative: string | null;
  narrativeStatus?: 'ok' | 'unavailable' | 'failed';
}

/** "2h 20m", "45m"; the sign is dropped. */
export function formatDuration(minutes: number | null | undefined): string {
  if (!Number.isFinite(minutes)) return '—';
  const total = Math.round(Math.abs(minutes as number));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return hours ? `${hours}h ${String(rest).padStart(2, '0')}m` : `${rest}m`;
}

/** Evenly thinned to `max` points, always keeping the first, last and highest. */
export function thinTrackPoints(points: RecordedTrackPoint[], max = MAX_DEBRIEF_POINTS): RecordedTrackPoint[] {
  if (points.length <= max) return points;
  let highest = -1;
  points.forEach((point, index) => {
    if (Number.isFinite(point.ele) && (highest < 0 || (point.ele as number) > (points[highest].ele as number))) highest = index;
  });
  const keep = new Set([0, points.length - 1]);
  if (highest >= 0) keep.add(highest);
  const slots = max - keep.size;
  for (let i = 0; i < slots; i += 1) keep.add(Math.round(((i + 1) * (points.length - 1)) / (slots + 1)));
  return [...keep].sort((a, b) => a - b).map((index) => points[index]);
}

/** The saved report without its AI text and images, which the comparison does not read. */
function reportForDebrief(report: PersistedReport): Omit<PersistedReport, 'ai'> {
  const { ai: _ai, ...rest } = report;
  void _ai;
  return rest;
}

export async function requestTripDebrief(
  report: PersistedReport,
  points: RecordedTrackPoint[],
  notes = '',
  signal?: AbortSignal,
): Promise<TripDebriefResult> {
  const { response, payload } = await fetchApi('/api/trip-debrief', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      report: reportForDebrief(report),
      track: { points: thinTrackPoints(points) },
      ...(notes.trim() ? { notes: notes.trim().slice(0, 2000) } : {}),
    }),
    signal,
  });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not compare this track with the report.'));
  const result = payload as Partial<TripDebriefResult> | null;
  if (!result?.comparison || typeof result.comparison !== 'object' || !result.comparison.track) {
    throw new Error('The debrief returned an unexpected response.');
  }
  return {
    comparison: result.comparison,
    narrative: typeof result.narrative === 'string' && result.narrative.trim() ? result.narrative : null,
    narrativeStatus: result.narrativeStatus,
  };
}
