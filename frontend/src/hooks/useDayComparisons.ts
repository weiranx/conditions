import { useEffect, useState } from 'react';
import { fetchApi } from '../lib/api-client';
import type { DayOverDayComparison, SafetyData, UserPreferences } from '../app/types';
import { DATE_FMT } from '../app/constants';
import { parseOptionalFiniteNumber } from '../app/core';
import { comparisonTravelHours, reportRequestedStartTime } from '../app/comparison-request';

export interface UseDayComparisonsParams {
  hasObjective: boolean;
  view: string;
  safetyData: SafetyData | null;
  forecastDate: string;
  currentStartTime: string;
  position: { lat: number; lng: number };
  preferences: UserPreferences;
}

export interface UseDayComparisonsReturn {
  dayOverDay: DayOverDayComparison | null;
}

/** The plan against the same plan a day earlier, compared by the backend. */
export function useDayComparisons({
  hasObjective,
  view,
  safetyData,
  forecastDate,
  currentStartTime,
  position,
  preferences,
}: UseDayComparisonsParams): UseDayComparisonsReturn {
  const [result, setResult] = useState<{ key: string; source: SafetyData; comparison: DayOverDayComparison | null } | null>(null);
  const { temperatureUnit, windSpeedUnit } = preferences;
  const selectedDate = safetyData?.forecast?.selectedDate || forecastDate;
  const startTime = (safetyData && reportRequestedStartTime(safetyData)) || currentStartTime;
  const travelWindowHours = comparisonTravelHours(preferences.travelWindowHours);
  const comparisonEnabled = Boolean(
    hasObjective && view === 'planner' && safetyData && DATE_FMT.test(selectedDate)
      && Number.isFinite(parseOptionalFiniteNumber(safetyData.safety?.score)),
  );
  const comparisonKey = comparisonEnabled
    ? JSON.stringify([selectedDate, startTime, travelWindowHours, position.lat, position.lng, temperatureUnit, windSpeedUnit])
    : null;

  useEffect(() => {
    if (!comparisonKey || !safetyData) return;
    const controller = new AbortController();
    const query = new URLSearchParams({
      lat: String(position.lat),
      lon: String(position.lng),
      date: selectedDate,
      start: startTime,
      travel_window_hours: String(travelWindowHours),
      temp_unit: temperatureUnit,
      wind_unit: windSpeedUnit,
    });
    (async () => {
      let comparison: DayOverDayComparison | null = null;
      try {
        const { response, payload } = await fetchApi(`/api/day-over-day?${query}`, { signal: controller.signal });
        const value = response.ok && payload && typeof payload === 'object'
          ? (payload as { comparison?: DayOverDayComparison | null }).comparison
          : null;
        comparison = value && typeof value === 'object' && Array.isArray(value.changes) ? value : null;
      } catch {
        comparison = null;
      }
      if (!controller.signal.aborted) setResult({ key: comparisonKey, source: safetyData, comparison });
    })();
    return () => controller.abort();
  }, [comparisonKey, selectedDate, startTime, travelWindowHours, safetyData, position.lat, position.lng, temperatureUnit, windSpeedUnit]);

  return { dayOverDay: result?.key === comparisonKey && result?.source === safetyData ? result.comparison : null };
}
