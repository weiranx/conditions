import { useEffect, useState } from 'react';
import { fetchApi } from '../lib/api-client';
import type { DayOverDayComparison, SafetyData, UserPreferences } from '../app/types';
import { DATE_FMT } from '../app/constants';
import { addDaysToIsoDate } from '../app/core';
import { buildDayOverDayChanges } from '../app/day-over-day';
import { comparisonRequestUrl, comparisonTravelHours } from '../app/comparison-request';

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
  const startTime = safetyData?.forecast?.selectedStartTime || currentStartTime;
  const travelWindowHours = comparisonTravelHours(preferences.travelWindowHours);
  const comparisonEnabled = Boolean(
    hasObjective && view === 'planner' && safetyData && DATE_FMT.test(selectedDate),
  );
  const comparisonKey = comparisonEnabled && safetyData
    ? JSON.stringify([
        selectedDate,
        startTime,
        travelWindowHours,
        position.lat,
        position.lng,
        temperatureUnit,
        windSpeedUnit,
        safetyData.safety.score,
        safetyData.avalanche?.dangerLevel,
        safetyData.weather.windGust,
        safetyData.weather.feelsLike,
        safetyData.weather.temp,
        safetyData.weather.precipChance,
        safetyData.weather.description,
      ])
    : null;

  useEffect(() => {
    if (!comparisonKey || !safetyData) {
      return;
    }

    const previousDate = addDaysToIsoDate(selectedDate, -1);
    const controller = new AbortController();

    (async () => {
      try {
        const { response, payload } = await fetchApi(
          comparisonRequestUrl(position.lat, position.lng, previousDate, startTime, travelWindowHours),
          { signal: controller.signal },
        );
        if (!response.ok || !payload || typeof payload !== 'object') {
          if (!controller.signal.aborted) setResult({ key: comparisonKey, source: safetyData, comparison: null });
          return;
        }

        const previousPayload = payload as SafetyData;
        const prevScore = Number(previousPayload?.safety?.score);
        if (!Number.isFinite(prevScore)) {
          if (!controller.signal.aborted) setResult({ key: comparisonKey, source: safetyData, comparison: null });
          return;
        }

        if (!controller.signal.aborted) {
          setResult({
            key: comparisonKey,
            source: safetyData,
            comparison: {
              previousDate,
              startTime,
              travelWindowHours,
              previousScore: prevScore,
              delta: safetyData.safety.score - prevScore,
              changes: buildDayOverDayChanges(safetyData, previousPayload, { temperatureUnit, windSpeedUnit }),
            },
          });
        }
      } catch {
        if (!controller.signal.aborted) setResult({ key: comparisonKey, source: safetyData, comparison: null });
      }
    })();

    return () => {
      controller.abort();
    };
  }, [
    comparisonKey,
    selectedDate,
    startTime,
    travelWindowHours,
    safetyData,
    position.lat,
    position.lng,
    temperatureUnit,
    windSpeedUnit,
  ]);

  return { dayOverDay: result?.key === comparisonKey && result?.source === safetyData ? result.comparison : null };
}
