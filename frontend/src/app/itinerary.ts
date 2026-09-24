import type { CampNightData, DecisionLevel, MultiDayTripForecastDay, SafetyData, UserPreferences } from './types';
import { DATE_FMT, MAX_TRAVEL_WINDOW_HOURS, MIN_TRAVEL_WINDOW_HOURS } from './constants';
import { addDaysToIsoDate, parseTimeInputMinutes } from './core';
import { planSettingsParams } from './plan-evaluation';
import { estimateRouteDurationHours, type ParsedGpxRoute, type RouteTimingProfile } from '../lib/gpx';

/**
 * A multi-day trip: a trailhead, a camp for each night, and an exit. Day i
 * runs from the trailhead (or last night's camp) to tonight's camp, or to the
 * exit on the last day. This module builds the plan and reads the check; the
 * backend checks each day at its camp and high points, reads each night at
 * camp, and decides the trip (backend/src/routes/itineraries.js,
 * backend/src/utils/itinerary-assessment.js).
 */

export const MIN_ITINERARY_NIGHTS = 1;
export const MAX_ITINERARY_NIGHTS = 6;
export const MAX_DAY_CHECKPOINTS = 2;

export interface ItineraryPoint {
  name: string;
  lat: number;
  lon: number;
  elevationFt: number | null;
}

/** A night's camp. A layover stays at the previous night's camp. */
export interface ItineraryCamp {
  point: ItineraryPoint | null;
  layover: boolean;
}

export interface ItineraryDayPlan {
  start: string;
  travelHours: number;
  /** High points or passes to check besides the camp. */
  checkpoints: ItineraryPoint[];
}

export interface ItineraryDraft {
  name: string;
  startDate: string;
  trailhead: ItineraryPoint | null;
  camps: ItineraryCamp[];
  /** Null ends the trip back at the trailhead. */
  exit: ItineraryPoint | null;
  /** One per day: nights + 1. */
  days: ItineraryDayPlan[];
  /** Places to leave the route early, besides the trailhead and exit. */
  bailPoints: ItineraryPoint[];
  /** An imported GPX track, drawn on the map; null when the trip was built by hand. */
  track: Array<{ lat: number; lon: number }> | null;
}

export interface ItineraryStage {
  index: number;
  date: string;
  start: string;
  travelHours: number;
  from: ItineraryPoint;
  to: ItineraryPoint;
  layover: boolean;
  checkpoints: ItineraryPoint[];
}

export interface ItineraryStageResult {
  index: number;
  date: string;
  fromElevationFt: number | null;
  report: SafetyData | null;
  checkpoints: Array<{ name: string; lat: number; lon: number; report: SafetyData | null }>;
}

export interface ItineraryCheckResult {
  checkedAt: string;
  startDate: string;
  stages: ItineraryStage[];
  results: ItineraryStageResult[];
  /** The backend's reading of the trip; null when the response did not carry one. */
  assessment: ItineraryAssessment | null;
  /** What the trip chat reads, built by the backend. */
  chatContext: unknown;
  /** The limits and activity the trip was checked with. */
  preferences?: UserPreferences;
}

// ─── Draft ────────────────────────────────────────────────────────────────

const clampHours = (hours: number) => Math.max(
  MIN_TRAVEL_WINDOW_HOURS,
  Math.min(MAX_TRAVEL_WINDOW_HOURS, Math.round(Number(hours) || 8)),
);

export const clampNights = (nights: number) => Math.max(
  MIN_ITINERARY_NIGHTS,
  Math.min(MAX_ITINERARY_NIGHTS, Math.round(Number(nights) || 1)),
);

export function createItineraryDraft({ startDate, start, travelHours, nights = 2, trailhead = null }: {
  startDate: string;
  start: string;
  travelHours: number;
  nights?: number;
  trailhead?: ItineraryPoint | null;
}): ItineraryDraft {
  const count = clampNights(nights);
  return {
    name: '',
    startDate,
    trailhead,
    camps: Array.from({ length: count }, () => ({ point: null, layover: false })),
    exit: null,
    days: Array.from({ length: count + 1 }, () => ({ start, travelHours: clampHours(travelHours), checkpoints: [] })),
    bailPoints: [],
    track: null,
  };
}

/** Grow or shrink the trip, keeping the camps and days already set. */
export function setItineraryNights(draft: ItineraryDraft, nights: number): ItineraryDraft {
  const count = clampNights(nights);
  const template = draft.days[draft.days.length - 1] ?? { start: '07:00', travelHours: 8, checkpoints: [] };
  const camps = Array.from({ length: count }, (_, index) => draft.camps[index] ?? { point: null, layover: false });
  const days = Array.from({ length: count + 1 }, (_, index) => draft.days[index] ?? { ...template, checkpoints: [] });
  return { ...draft, camps, days };
}

/** The point a night is spent at, following layovers back to a chosen camp. */
export function campPoint(draft: Pick<ItineraryDraft, 'camps' | 'trailhead'>, nightIndex: number): ItineraryPoint | null {
  for (let index = nightIndex; index >= 0; index -= 1) {
    const camp = draft.camps[index];
    if (!camp) return null;
    if (!camp.layover) return camp.point;
  }
  // A layover on the first night stays at the trailhead.
  return draft.trailhead;
}

export const itineraryExit = (draft: ItineraryDraft) => draft.exit ?? draft.trailhead;

/** What still has to be chosen before the trip can be checked, first gap first. */
export function itineraryGaps(draft: ItineraryDraft): string[] {
  const gaps: string[] = [];
  if (!draft.trailhead) gaps.push('Choose a trailhead');
  draft.camps.forEach((_, index) => {
    if (!campPoint(draft, index)) gaps.push(`Add a camp for night ${index + 1}`);
  });
  return gaps;
}

/** One stage per day, or null while a camp or the trailhead is missing. */
export function buildItineraryStages(draft: ItineraryDraft): ItineraryStage[] | null {
  if (itineraryGaps(draft).length > 0 || !DATE_FMT.test(draft.startDate)) return null;
  const exit = itineraryExit(draft)!;
  return draft.days.map((day, index) => {
    const from = index === 0 ? draft.trailhead! : campPoint(draft, index - 1)!;
    const to = index < draft.camps.length ? campPoint(draft, index)! : exit;
    return {
      index,
      date: addDaysToIsoDate(draft.startDate, index),
      start: parseTimeInputMinutes(day.start) === null ? '07:00' : day.start,
      travelHours: clampHours(day.travelHours),
      from,
      to,
      layover: index < draft.camps.length && draft.camps[index].layover,
      checkpoints: day.checkpoints.slice(0, MAX_DAY_CHECKPOINTS),
    };
  });
}

export function buildItineraryRequest(draft: ItineraryDraft, stages: ItineraryStage[], preferences: UserPreferences) {
  const point = ({ name, lat, lon, elevationFt }: ItineraryPoint) => ({ name, lat, lon, elevationFt });
  return {
    name: draft.name || draft.trailhead?.name || 'Multi-day trip',
    activity: preferences.defaultActivity,
    // The traveler's limits and units; the backend checks every day against them.
    plan: planSettingsParams(preferences),
    bailPoints: draft.bailPoints.map(point),
    startDate: draft.startDate,
    stages: stages.map((stage) => ({
      start: stage.start,
      travelHours: stage.travelHours,
      from: point(stage.from),
      to: point(stage.to),
      checkpoints: stage.checkpoints.map(point),
    })),
  };
}

// ─── Parsing ──────────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const finiteOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asReport = (value: unknown): SafetyData | null =>
  isRecord(value) && isRecord(value.weather) && isRecord(value.safety) ? value as unknown as SafetyData : null;

/** The server's stages, one per planned day; a day it did not return is a failed one. */
export function parseItineraryResults(payload: unknown, stages: ItineraryStage[]): ItineraryStageResult[] {
  const serverStages = isRecord(payload) && Array.isArray(payload.stages) ? payload.stages : [];
  return stages.map((stage) => {
    const raw = serverStages.find((entry) => isRecord(entry) && entry.index === stage.index);
    const checkpoints = isRecord(raw) && Array.isArray(raw.checkpoints) ? raw.checkpoints : [];
    return {
      index: stage.index,
      date: stage.date,
      fromElevationFt: isRecord(raw) ? finiteOrNull(raw.fromElevationFt) : null,
      report: isRecord(raw) ? asReport(raw.report) : null,
      checkpoints: stage.checkpoints.map((point, index) => {
        const entry = checkpoints[index];
        return { name: point.name, lat: point.lat, lon: point.lon, report: isRecord(entry) ? asReport(entry.report) : null };
      }),
    };
  });
}

// ─── The backend's assessment ─────────────────────────────────────────────

export type ItineraryNightState = 'serious' | 'hard' | 'settled' | 'incomplete' | 'not-forecast' | 'unavailable';
export type ItineraryVerdictLevel = DecisionLevel | 'INCOMPLETE';
export type ItineraryTripDay = Omit<MultiDayTripForecastDay, 'safetyData' | 'rankValue' | 'rankable'>;

export interface ItineraryWeakLink {
  kind: 'day' | 'night';
  index: number;
  reason: string;
  /**
   * 0 a day over a hard limit, 1 a serious night, 2 a day that calls for
   * caution, 3 a hard night, 4 not checked or not yet forecast, 5 partly
   * forecast or missing readings.
   */
  rank: number;
  weight: number;
}

export interface ItineraryDayAssessment {
  index: number;
  date: string;
  layover: boolean;
  elevationFt: number | null;
  /** The day at its camp; null when that check failed. */
  day: ItineraryTripDay | null;
  checkpoints: Array<{ name: string | null; day: ItineraryTripDay | null }>;
  /** Worst decision across the camp and every high point, or null if none could be checked. */
  level: DecisionLevel | null;
  limitingPlace: string | null;
  limitingChecks: string[];
  incompleteHours: number;
  partial: boolean;
  avalancheNotIssued: boolean;
  lowConfidence: boolean;
  daysAhead: number;
}

export interface ItineraryNightAssessment {
  /** Night after day `index`. */
  index: number;
  date: string;
  camp: ItineraryPoint;
  layoverFollows: boolean;
  data: CampNightData | null;
  state: ItineraryNightState;
  nearestExit: { name: string | null; lat: number; lon: number; miles: number } | null;
}

export interface ItineraryAssessment {
  level: ItineraryVerdictLevel;
  headline: { title: string; reason: string | null };
  links: ItineraryWeakLink[];
  weakLink: ItineraryWeakLink | null;
  alsoLimiting: ItineraryWeakLink[];
  unresolved: number;
  coldestNightIndex: number | null;
  days: ItineraryDayAssessment[];
  nights: ItineraryNightAssessment[];
}

const VERDICT_LEVELS = new Set(['GO', 'CAUTION', 'NO-GO', 'INCOMPLETE']);

/** The assessment as received, or null when the response is not one. */
export function readItineraryAssessment(value: unknown): ItineraryAssessment | null {
  if (!isRecord(value) || !VERDICT_LEVELS.has(String(value.level)) || !isRecord(value.headline)
    || !Array.isArray(value.days) || !Array.isArray(value.nights) || !Array.isArray(value.links)) return null;
  return value as unknown as ItineraryAssessment;
}

// ─── Bail points ──────────────────────────────────────────────────────────

const EARTH_RADIUS_MILES = 3958.8;

export function straightLineMiles(a: Pick<ItineraryPoint, 'lat' | 'lon'>, b: Pick<ItineraryPoint, 'lat' | 'lon'>): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLon = toRadians(b.lon - a.lon);
  const h = Math.sin(deltaLat / 2) ** 2
    + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(deltaLon / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Straight-line distance for each day; a very long one usually means a misplaced camp. */
export const LONG_DAY_STRAIGHT_LINE_MILES = 25;
export function stageStraightLineMiles(stage: Pick<ItineraryStage, 'from' | 'to'>): number {
  return straightLineMiles(stage.from, stage.to);
}

// ─── GPX ──────────────────────────────────────────────────────────────────

const CAMP_NAME = /\b(camp|campsite|bivy|bivouac|site)\b/i;
// A high point is worth its own check when it rises this far above both ends of the day.
const HIGH_POINT_RISE_FT = 800;

/**
 * Split a GPX route into days. Waypoints named like camps set the nights when
 * there are exactly enough of them; otherwise the track is cut into days of
 * equal effort (distance plus climbing). Each day gets its own hour estimate
 * and, when it climbs well above both ends, its high point as a checkpoint.
 */
export function splitGpxIntoDays(route: ParsedGpxRoute, nights: number, timing: RouteTimingProfile): {
  trailhead: ItineraryPoint;
  exit: ItineraryPoint | null;
  camps: ItineraryPoint[];
  days: Array<{ travelHours: number; checkpoints: ItineraryPoint[] }>;
} | null {
  const track = route.displayTrack;
  if (track.length < 2) return null;
  const count = clampNights(nights);
  const toPoint = (point: { lat: number; lon: number; elev_ft?: number }, name: string): ItineraryPoint => ({
    name,
    lat: point.lat,
    lon: point.lon,
    elevationFt: Number.isFinite(point.elev_ft) ? Number(point.elev_ft) : null,
  });

  // Effort along the track, in miles, with each 1,000 ft of climbing worth one mile.
  const effort: number[] = [0];
  for (let index = 1; index < track.length; index += 1) {
    const miles = route.distanceMiles * (track[index].progress_percent - track[index - 1].progress_percent) / 100;
    const climb = Math.max(0, (track[index].elev_ft ?? 0) - (track[index - 1].elev_ft ?? 0));
    effort.push(effort[index - 1] + Math.max(0, miles) + (Number.isFinite(track[index].elev_ft) && Number.isFinite(track[index - 1].elev_ft) ? climb / 1000 : 0));
  }
  const total = effort[effort.length - 1];

  const namedCamps = route.checkpoints.filter((checkpoint) => CAMP_NAME.test(checkpoint.name));
  let cuts: number[];
  if (namedCamps.length === count) {
    cuts = namedCamps
      .map((camp) => track.reduce((best, point, index) => (
        Math.abs(point.progress_percent - camp.progress_percent) < Math.abs(track[best].progress_percent - camp.progress_percent) ? index : best
      ), 0))
      .sort((a, b) => a - b);
  } else {
    cuts = Array.from({ length: count }, (_, night) => {
      const target = total * (night + 1) / (count + 1);
      const index = effort.findIndex((value) => value >= target);
      return index < 0 ? track.length - 1 : index;
    });
  }
  const bounds = [0, ...cuts, track.length - 1];
  const days = bounds.slice(0, -1).map((startIndex, day) => {
    const endIndex = Math.max(startIndex, bounds[day + 1]);
    const segment = track.slice(startIndex, endIndex + 1);
    const distanceMiles = route.distanceMiles * (track[endIndex].progress_percent - track[startIndex].progress_percent) / 100;
    let gain = 0;
    for (let index = 1; index < segment.length; index += 1) {
      const rise = (segment[index].elev_ft ?? NaN) - (segment[index - 1].elev_ft ?? NaN);
      if (Number.isFinite(rise) && rise > 0) gain += rise;
    }
    const high = segment.reduce((best, point) => ((point.elev_ft ?? -Infinity) > (best.elev_ft ?? -Infinity) ? point : best), segment[0]);
    const ends = [segment[0].elev_ft, segment[segment.length - 1].elev_ft].filter((value): value is number => Number.isFinite(value));
    const checkpoints = Number.isFinite(high.elev_ft) && ends.length === 2 && (high.elev_ft as number) - Math.max(...ends) >= HIGH_POINT_RISE_FT
      ? [toPoint(high, `Day ${day + 1} high point`)]
      : [];
    return {
      travelHours: estimateRouteDurationHours({ distanceMiles: Math.max(0, distanceMiles), elevationGainFt: Math.round(gain) }, timing),
      checkpoints,
    };
  });

  const camps = cuts.map((index, night) => {
    const named = namedCamps.length === count ? namedCamps[night]?.name : null;
    return toPoint(track[index], named || `Camp ${night + 1}`);
  });
  const first = track[0];
  const last = track[track.length - 1];
  const trailhead = toPoint(first, route.name ? `${route.name} start` : 'Trailhead');
  return {
    trailhead,
    exit: route.routeShape === 'closed route' ? null : toPoint(last, route.name ? `${route.name} end` : 'Exit'),
    camps,
    days,
  };
}

// ─── Opening a day in the brief ───────────────────────────────────────────

/**
 * Where a day's approach starts, in feet: last night's camp (as the server
 * looked it up), or the camp itself on a layover or when the start is
 * unknown, so the brief does not guess a climb from the lowest forecast band.
 */
export function stageStartElevationFt(stage: ItineraryStage, result: ItineraryStageResult | undefined): number | null {
  const campElevation = finiteOrNull(result?.report?.weather?.elevation);
  if (stage.layover) return campElevation;
  return result?.fromElevationFt ?? stage.from.elevationFt ?? campElevation;
}

/** The plan a day's report is opened with in the conditions brief. */
export function stagePlan(stage: ItineraryStage, trailheadElevationInput = '') {
  return {
    lat: stage.to.lat,
    lon: stage.to.lon,
    objectiveName: stage.to.name || `Day ${stage.index + 1}`,
    searchQuery: stage.to.name || `${stage.to.lat.toFixed(4)}, ${stage.to.lon.toFixed(4)}`,
    forecastDate: stage.date,
    alpineStartTime: stage.start,
    targetElevationInput: '',
    trailheadElevationInput,
    travelWindowHours: stage.travelHours,
  };
}

/** Last day of the trip, or null when the start date is not valid. */
export function itineraryEndDate(draft: Pick<ItineraryDraft, 'startDate' | 'camps'>): string | null {
  return DATE_FMT.test(draft.startDate) ? addDaysToIsoDate(draft.startDate, draft.camps.length) : null;
}

const daysBetween = (from: string, to: string) => {
  const start = Date.parse(`${from}T12:00:00Z`);
  const end = Date.parse(`${to}T12:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 86_400_000) : 0;
};

/** Most nights that fit between the start date and the last forecast day. */
export function maxNightsWithinForecast(startDate: string, maxForecastDate: string): number {
  return Math.max(MIN_ITINERARY_NIGHTS, Math.min(MAX_ITINERARY_NIGHTS, daysBetween(startDate, maxForecastDate)));
}

// ─── Storage ──────────────────────────────────────────────────────────────

export type PlanMode = 'day' | 'multi';

export interface StoredItinerary {
  mode: PlanMode;
  draft: ItineraryDraft;
}

function parsePoint(value: unknown): ItineraryPoint | null {
  if (!isRecord(value)) return null;
  const lat = finiteOrNull(value.lat);
  const lon = finiteOrNull(value.lon);
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return {
    name: typeof value.name === 'string' ? value.name.slice(0, 100) : '',
    lat,
    lon,
    elevationFt: finiteOrNull(value.elevationFt),
  };
}

/** A draft read back from storage or a saved trip, or null when it is not one. */
export function parseItineraryDraft(value: unknown): ItineraryDraft | null {
  if (!isRecord(value) || !Array.isArray(value.camps) || !Array.isArray(value.days)) return null;
  const camps = value.camps.slice(0, MAX_ITINERARY_NIGHTS).map((camp) => ({
    point: isRecord(camp) ? parsePoint(camp.point) : null,
    layover: isRecord(camp) && camp.layover === true,
  }));
  if (camps.length < MIN_ITINERARY_NIGHTS) return null;
  const storedDays: unknown[] = value.days;
  const days = Array.from({ length: camps.length + 1 }, (_, index) => {
    const day = storedDays[index];
    const start = isRecord(day) && typeof day.start === 'string' && parseTimeInputMinutes(day.start) !== null ? day.start : '07:00';
    const checkpoints = isRecord(day) && Array.isArray(day.checkpoints)
      ? day.checkpoints.map(parsePoint).filter((point): point is ItineraryPoint => Boolean(point)).slice(0, MAX_DAY_CHECKPOINTS)
      : [];
    return { start, travelHours: clampHours(isRecord(day) ? Number(day.travelHours) : 8), checkpoints };
  });
  return {
    name: typeof value.name === 'string' ? value.name.slice(0, 200) : '',
    startDate: typeof value.startDate === 'string' && DATE_FMT.test(value.startDate) ? value.startDate : '',
    trailhead: parsePoint(value.trailhead),
    camps,
    exit: parsePoint(value.exit),
    days,
    bailPoints: Array.isArray(value.bailPoints)
      ? value.bailPoints.map(parsePoint).filter((point): point is ItineraryPoint => Boolean(point)).slice(0, 10)
      : [],
    track: Array.isArray(value.track)
      ? value.track.map(parsePoint).filter((point): point is ItineraryPoint => Boolean(point)).slice(0, 500).map(({ lat, lon }) => ({ lat, lon }))
      : null,
  };
}

export function parseStoredItinerary(value: unknown): StoredItinerary | null {
  if (!isRecord(value)) return null;
  const draft = parseItineraryDraft(value.draft);
  return draft ? { mode: value.mode === 'multi' ? 'multi' : 'day', draft } : null;
}

// ─── Saved trips ──────────────────────────────────────────────────────────

export interface SavedTripSnapshot {
  version: 1;
  title: string;
  verdictLevel: ItineraryVerdictLevel | null;
  draft: ItineraryDraft;
  preferences: UserPreferences | null;
  result: ItineraryCheckResult;
}

export function buildSavedTrip(draft: ItineraryDraft, result: ItineraryCheckResult): SavedTripSnapshot {
  const { preferences = null, ...check } = result;
  return {
    version: 1,
    title: draft.name || (draft.trailhead?.name ? `${draft.trailhead.name} trip` : 'Multi-day trip'),
    verdictLevel: result.assessment?.level ?? null,
    draft,
    preferences,
    result: check,
  };
}

/** A saved trip read back from the account, or null when it is not one. */
export function parseSavedTrip(value: unknown): { draft: ItineraryDraft; result: ItineraryCheckResult } | null {
  if (!isRecord(value) || !isRecord(value.result)) return null;
  const draft = parseItineraryDraft(value.draft);
  const raw = value.result;
  if (!draft || !Array.isArray(raw.stages) || !Array.isArray(raw.results) || raw.stages.length !== raw.results.length) return null;
  const stages = raw.stages as ItineraryStage[];
  if (stages.some((stage) => !isRecord(stage) || !isRecord(stage.from) || !isRecord(stage.to) || typeof stage.date !== 'string')) return null;
  return {
    draft,
    result: {
      checkedAt: typeof raw.checkedAt === 'string' ? raw.checkedAt : '',
      startDate: typeof raw.startDate === 'string' ? raw.startDate : stages[0].date,
      stages,
      results: parseItineraryResults({ stages: raw.results }, stages),
      assessment: readItineraryAssessment(raw.assessment),
      chatContext: raw.chatContext ?? null,
      ...(isRecord(value.preferences) ? { preferences: value.preferences as unknown as UserPreferences } : {}),
    },
  };
}
