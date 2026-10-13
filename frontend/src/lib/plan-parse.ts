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

/** What `/api/plan-parse` read from a sentence; anything it could not use is a note. */
export interface ParsedPlan {
  placeQuery: string | null;
  date: string | null;
  startTime: string | null;
  activity: ActivityType | null;
  params: ParsedPlanParams;
  notes: string[];
}

export const PLAN_SENTENCE_MAX_LENGTH = 500;

export async function parsePlanSentence(
  text: string,
  today: string,
  units: { temperature: 'f' | 'c'; wind: 'mph' | 'kph'; elevation: 'ft' | 'm' },
  signal?: AbortSignal,
): Promise<ParsedPlan> {
  const { response, payload } = await fetchApi('/api/plan-parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, today, units }),
    signal,
  });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not read that plan.'));
  const plan = (payload && typeof payload === 'object' ? payload : {}) as Partial<ParsedPlan>;
  return {
    placeQuery: typeof plan.placeQuery === 'string' && plan.placeQuery.trim() ? plan.placeQuery.trim() : null,
    date: typeof plan.date === 'string' ? plan.date : null,
    startTime: typeof plan.startTime === 'string' ? plan.startTime : null,
    activity: typeof plan.activity === 'string' ? plan.activity : null,
    params: plan.params && typeof plan.params === 'object' ? plan.params : {},
    notes: Array.isArray(plan.notes) ? plan.notes.filter((note): note is string => typeof note === 'string') : [],
  };
}
