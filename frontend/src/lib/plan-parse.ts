import type { ActivityType } from '../app/types';
import { fetchApi, readApiErrorMessage } from './api-client';

/** Plan params a sentence can set, in the plan's own (imperial) units. */
export interface ParsedPlanParams {
  max_gust_mph?: number;
  max_precip_chance?: number;
  min_feels_like_f?: number;
  max_feels_like_f?: number;
  travel_window_hours?: number;
  target_elevation_ft?: number;
}

/**
 * A multi-day trip read from a description. `placeQuery` above is its
 * trailhead, `date` its first day and `travel_window_hours` each day's hours.
 * Every place here is a search for the traveler to pick from.
 */
export interface ParsedTrip {
  name: string | null;
  nights: number | null;
  /** One per night named, in order; a layover stays at the night before's camp. */
  camps: Array<{ placeQuery: string | null; layover: boolean }>;
  /** Null ends the trip back at the trailhead. */
  exit: string | null;
  /** Passes or high points crossed, per day (day 1 first). */
  passes: string[][];
}

/** What `/api/plan-parse` read from a sentence; anything it could not use is a note. */
export interface ParsedPlan {
  placeQuery: string | null;
  date: string | null;
  startTime: string | null;
  activity: ActivityType | null;
  params: ParsedPlanParams;
  notes: string[];
  /** Present when a multi-day trip was read. */
  trip?: ParsedTrip;
}

export const PLAN_SENTENCE_MAX_LENGTH = 500;
export const TRIP_DESCRIPTION_MAX_LENGTH = 1000;

const queryOrNull = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

function readTrip(value: unknown): ParsedTrip | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const trip = value as Record<string, unknown>;
  const nights = typeof trip.nights === 'number' && Number.isInteger(trip.nights) ? trip.nights : null;
  return {
    name: queryOrNull(trip.name),
    nights,
    camps: Array.isArray(trip.camps)
      ? trip.camps.map((camp) => {
          const entry = camp && typeof camp === 'object' ? camp as Record<string, unknown> : {};
          return { placeQuery: queryOrNull(entry.placeQuery), layover: entry.layover === true };
        })
      : [],
    exit: queryOrNull(trip.exit),
    passes: Array.isArray(trip.passes)
      ? trip.passes.map((day) => (Array.isArray(day) ? day.map(queryOrNull).filter((pass): pass is string => pass !== null) : []))
      : [],
  };
}

export async function parsePlanSentence(
  text: string,
  today: string,
  units: { temperature: 'f' | 'c'; wind: 'mph' | 'kph'; elevation: 'ft' | 'm' },
  signal?: AbortSignal,
  mode: 'day' | 'multi' = 'day',
): Promise<ParsedPlan> {
  const { response, payload } = await fetchApi('/api/plan-parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mode === 'multi' ? { text, today, units, mode } : { text, today, units }),
    signal,
  });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, mode === 'multi' ? 'Could not read that trip.' : 'Could not read that plan.'));
  const plan = (payload && typeof payload === 'object' ? payload : {}) as Partial<ParsedPlan>;
  const trip = mode === 'multi' ? readTrip(plan.trip) : undefined;
  return {
    placeQuery: queryOrNull(plan.placeQuery),
    date: typeof plan.date === 'string' ? plan.date : null,
    startTime: typeof plan.startTime === 'string' ? plan.startTime : null,
    activity: typeof plan.activity === 'string' ? plan.activity : null,
    params: plan.params && typeof plan.params === 'object' ? plan.params : {},
    notes: Array.isArray(plan.notes) ? plan.notes.filter((note): note is string => typeof note === 'string') : [],
    ...(trip ? { trip } : {}),
  };
}
