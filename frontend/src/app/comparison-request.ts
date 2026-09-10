import { MAX_TRAVEL_WINDOW_HOURS, MIN_TRAVEL_WINDOW_HOURS } from './constants';
import { parseTimeInputMinutes } from './core';
import type { SafetyData } from './types';

// selectedStartTime is the provider's forecast period, not the requested departure.
// Older mock/saved reports used a bare clock there; retain that compatibility only.
export function reportRequestedStartTime(data: SafetyData): string | null {
  const clock = data.forecast?.requestedStartTime ?? data.forecast?.selectedStartTime;
  return typeof clock === 'string' && /^\d{2}:\d{2}$/.test(clock) && parseTimeInputMinutes(clock) !== null ? clock : null;
}

export function comparisonReportMatches(
  data: SafetyData | null, lat: number, lon: number, date: string, start: string, hours: number,
): boolean {
  if (!data) return false;
  const requestedStart = reportRequestedStartTime(data);
  return Boolean(data.location
    && Number.isFinite(data.location.lat) && Number.isFinite(data.location.lon)
    && Math.abs(data.location.lat - lat) < 0.0001
    && Math.abs(data.location.lon - lon) < 0.0001
    && data.forecast?.selectedDate === date
    && (requestedStart === null || requestedStart === start)
    && (data.rainfall?.expected?.travelWindowHours == null
      || data.rainfall.expected.travelWindowHours === comparisonTravelHours(hours)));
}

export function comparisonTravelHours(hours: number): number {
  return Math.max(MIN_TRAVEL_WINDOW_HOURS, Math.min(MAX_TRAVEL_WINDOW_HOURS, Math.round(Number(hours) || 12)));
}

export function comparisonRequestUrl(lat: number, lon: number, date: string, start: string, hours: number): string {
  const params = new URLSearchParams({
    lat: String(lat), lon: String(lon), date, start,
    travel_window_hours: String(comparisonTravelHours(hours)),
  });
  return `/api/safety?${params}`;
}
