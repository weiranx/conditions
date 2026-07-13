import tzLookup from 'tz-lookup';
import { DATE_FMT } from './constants';
import { addDaysToIsoDate, parseTimeInputMinutes } from './core';
import { dateTimeInputsFor } from './date-time-inputs';

export const PAST_START_GRACE_MINUTES = 5;

export interface PastPlannedStart {
  date: string;
  time: string;
  timeZone: string | null;
}

export function resolveObjectiveTimeZone(lat: number, lon: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  try {
    return tzLookup(lat, lon);
  } catch {
    return null;
  }
}

export function getPastPlannedStart(
  date: string,
  time: string,
  timeZone: string | null,
  now: Date = new Date(),
  graceMinutes: number = PAST_START_GRACE_MINUTES,
): PastPlannedStart | null {
  if (!DATE_FMT.test(date) || parseTimeInputMinutes(time) === null) {
    return null;
  }

  const graceMs = Math.max(0, graceMinutes) * 60_000;
  const cutoffInputs = dateTimeInputsFor(new Date(now.getTime() - graceMs), timeZone);
  const plannedKey = `${date}T${time}`;
  const cutoffKey = `${cutoffInputs.date}T${cutoffInputs.time}`;

  return plannedKey < cutoffKey ? { date, time, timeZone } : null;
}

export function getInitialForecastDate(
  todayDate: string,
  defaultStartTime: string,
  now: Date = new Date(),
): string {
  return getPastPlannedStart(todayDate, defaultStartTime, null, now)
    ? addDaysToIsoDate(todayDate, 1)
    : todayDate;
}

export function getTomorrowDate(timeZone: string | null, now: Date = new Date()): string {
  return addDaysToIsoDate(dateTimeInputsFor(now, timeZone).date, 1);
}

export function formatTimeZoneLabel(timeZone: string | null): string {
  return timeZone || 'your current timezone';
}
