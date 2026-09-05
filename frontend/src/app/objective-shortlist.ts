import { addDaysToIsoDate, parseTimeInputMinutes } from './core';
import { dateTimeInputsFor } from './date-time-inputs';
import { resolveObjectiveTimeZone } from './planned-start';
import type { MultiDayTripForecastDay } from './trip-forecast';

export const SHORTLIST_KEY = 'summitsafe:objective-shortlist:v1';
export interface ShortlistObjective { id: string; name: string; lat: number; lon: number }
export interface ShortlistChoice { objectiveId: string; date: string; startTime: string; hours: number }
export interface ShortlistState {
  objectives: ShortlistObjective[];
  startDate: string;
  durationDays: number;
  startTime: string;
  hours: number;
  planA: ShortlistChoice | null;
  planB: ShortlistChoice | null;
}
export interface ShortlistResult { objectiveId: string; days: MultiDayTripForecastDay[]; error: string | null }

export function objectiveFrom(value: unknown): ShortlistObjective | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.name !== 'string' || !item.name.trim() || !['string', 'number'].includes(typeof item.lat) || !['string', 'number'].includes(typeof item.lon) || String(item.lat).trim() === '' || String(item.lon).trim() === '') return null;
  const lat = Number(item.lat), lon = Number(item.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { id: `${lat.toFixed(4)},${lon.toFixed(4)}`, name: item.name.trim().slice(0, 200), lat, lon };
}
export function isForecastDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function shortlistDates(state: Pick<ShortlistState, 'startDate' | 'durationDays'>): string[] {
  if (!isForecastDate(state.startDate) || !Number.isInteger(state.durationDays) || state.durationDays < 2 || state.durationDays > 7) return [];
  return Array.from({ length: state.durationDays }, (_, i) => addDaysToIsoDate(state.startDate, i));
}
export function shortlistValidation(state: ShortlistState, now = new Date()): string | null {
  if (state.objectives.length < 2 || state.objectives.length > 5) return 'Add 2–5 objectives to compare.';
  const dates = shortlistDates(state);
  if (!dates.length) return 'Choose a valid start date and 2–7 days.';
  if (parseTimeInputMinutes(state.startTime) === null) return 'Choose a valid departure time.';
  if (!Number.isInteger(state.hours) || state.hours < 1 || state.hours > 24) return 'Choose a trip duration of 1–24 hours.';
  for (const objective of state.objectives) {
    const today = dateTimeInputsFor(now, resolveObjectiveTimeZone(objective.lat, objective.lon)).date;
    if (dates[0] < today || dates.at(-1)! > addDaysToIsoDate(today, 6)) return `Choose dates within the next 7 days at ${objective.name}.`;
  }
  return null;
}
export function readShortlist(fallback: ShortlistState): ShortlistState {
  try {
    const raw = JSON.parse(localStorage.getItem(SHORTLIST_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return fallback;
    const objectives = Array.isArray(raw.objectives) ? raw.objectives.map(objectiveFrom).filter((o: ShortlistObjective | null): o is ShortlistObjective => !!o) : [];
    const unique = [...new Map<string, ShortlistObjective>(objectives.map((o: ShortlistObjective) => [o.id, o])).values()].slice(0, 5);
    const choice = (c: ShortlistChoice | null): ShortlistChoice | null => c && unique.some(o => o.id === c.objectiveId)
      && isForecastDate(c.date) && typeof c.startTime === 'string' && parseTimeInputMinutes(c.startTime) !== null
      && Number.isInteger(c.hours) && c.hours >= 1 && c.hours <= 24
      ? { objectiveId: c.objectiveId, date: c.date, startTime: c.startTime, hours: c.hours } : null;
    const planA = choice(raw.planA), planB = choice(raw.planB);
    return { objectives: unique, startDate: isForecastDate(raw.startDate) ? raw.startDate : fallback.startDate,
      durationDays: Number.isInteger(raw.durationDays) && raw.durationDays >= 2 && raw.durationDays <= 7 ? raw.durationDays : 2,
      startTime: typeof raw.startTime === 'string' && parseTimeInputMinutes(raw.startTime) !== null ? raw.startTime : fallback.startTime,
      hours: Number.isInteger(raw.hours) && raw.hours >= 1 && raw.hours <= 24 ? raw.hours : fallback.hours,
      planA, planB: sameChoice(planA, planB) ? null : planB };
  } catch { return fallback; }
}
export function sameChoice(a: ShortlistChoice | null, b: ShortlistChoice | null): boolean {
  return !!a && !!b && a.objectiveId === b.objectiveId && a.date === b.date && a.startTime === b.startTime && a.hours === b.hours;
}
// Comfort never changes the hazard ordering. Missing evidence cannot become a winner.
export function rankShortlist(results: ShortlistResult[], requiredHours = 1) {
  const priority = { GO: 2, CAUTION: 1, 'NO-GO': 0 };
  return results.flatMap(r => r.days.map(day => ({ objectiveId: r.objectiveId, day })))
    .filter(({ day }) => !day.partialData && day.score !== null && Number.isFinite(day.score) && day.travelTotalHours >= requiredHours)
    .sort((a, b) => priority[b.day.decisionLevel] - priority[a.day.decisionLevel] || b.day.score! - a.day.score!);
}
