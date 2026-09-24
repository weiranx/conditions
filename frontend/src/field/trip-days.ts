import type { MultiDayTripForecastDay, TimeStyle } from "../app/types";
import { formatClockForStyle } from "../app/core";

/** The longest run of hours within limits, when some but not all hours are. */
export function longestStretch(day: MultiDayTripForecastDay, timeStyle: TimeStyle): string | null {
  const span = day.travelBestWindow;
  if (!span || day.travelPassHours === 0 || day.travelPassHours >= day.travelTotalHours) return null;
  return `Longest stretch ${span.length} h from ${formatClockForStyle(span.start, timeStyle)}`;
}

/** Days ranked the same by the backend. */
export const sameTripRank = (a: MultiDayTripForecastDay, b: MultiDayTripForecastDay) => a.rankValue === b.rankValue;
