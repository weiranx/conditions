import { MAX_TRAVEL_WINDOW_HOURS, MIN_TRAVEL_WINDOW_HOURS } from './constants';

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
