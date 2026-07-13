import tzLookup from 'tz-lookup';
import { DATE_FMT } from './constants';
import { addDaysToIsoDate, parseTimeInputMinutes } from './core';
import { dateTimeInputsFor } from './date-time-inputs';

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
): PastPlannedStart | null {
  if (!DATE_FMT.test(date) || parseTimeInputMinutes(time) === null) {
    return null;
  }

  const currentDate = dateTimeInputsFor(now, timeZone).date;

  return date < currentDate ? { date, time, timeZone } : null;
}

export function getInitialForecastDate(todayDate: string): string {
  return todayDate;
}

export function getTomorrowDate(timeZone: string | null, now: Date = new Date()): string {
  return addDaysToIsoDate(dateTimeInputsFor(now, timeZone).date, 1);
}

export function formatTimeZoneLabel(timeZone: string | null): string {
  return timeZone || 'your current timezone';
}
