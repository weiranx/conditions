import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SafetyData, UserPreferences } from '../app/types';
import { evaluateBackcountryDecision } from '../app/decision';
import {
  EXTENDED_START_TIME_SCENARIO_TIMES,
  START_TIME_SCENARIO_TIMES,
  buildStartTimeScenario,
  compareStartTimeScenarios,
  includeUserStartTimeScenario,
  type StartTimeScenario,
} from '../app/start-time-scenarios';
import { MAX_TRAVEL_WINDOW_HOURS, MIN_TRAVEL_WINDOW_HOURS } from '../app/constants';
import { fetchApi } from '../lib/api-client';

interface UseStartTimeScenariosParams {
  enabled: boolean;
  forecastDate: string;
  currentStartTime: string;
  position: { lat: number; lng: number };
  preferences: UserPreferences;
}

export function useStartTimeScenarios({
  enabled,
  forecastDate,
  currentStartTime,
  position,
  preferences,
}: UseStartTimeScenariosParams) {
  const [scenarioPayloads, setScenarioPayloads] = useState<Array<{ startTime: string; data: SafetyData }>>([]);
  const [includeMoreScenarios, setIncludeMoreScenarios] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scenarioTimes = useMemo(
    () => includeUserStartTimeScenario(
      includeMoreScenarios ? EXTENDED_START_TIME_SCENARIO_TIMES : START_TIME_SCENARIO_TIMES,
      currentStartTime,
    ),
    [currentStartTime, includeMoreScenarios],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const safeTravelWindowHours = Math.max(
      MIN_TRAVEL_WINDOW_HOURS,
      Math.min(MAX_TRAVEL_WINDOW_HOURS, Math.round(Number(preferences.travelWindowHours) || 12)),
    );
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const results = await Promise.all(
        scenarioTimes.map(async (startTime) => {
          try {
            const { response, payload } = await fetchApi(
              `/api/safety?lat=${position.lat}&lon=${position.lng}&date=${encodeURIComponent(forecastDate)}&start=${encodeURIComponent(startTime)}&travel_window_hours=${safeTravelWindowHours}`,
              { signal: controller.signal },
            );
            if (!response.ok || !payload || typeof payload !== 'object') return null;
            return { startTime, data: payload as SafetyData };
          } catch {
            return null;
          }
        }),
      );

      if (cancelled) return;
      const valid = results.filter((scenario): scenario is NonNullable<(typeof results)[number]> => scenario !== null);
      setScenarioPayloads(valid);
      setError(valid.length === scenarioTimes.length ? null : 'Some departure scenarios could not be evaluated.');
    })().finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    enabled,
    forecastDate,
    position.lat,
    position.lng,
    preferences.travelWindowHours,
    scenarioTimes,
  ]);

  const scenarios = useMemo<StartTimeScenario[]>(() => scenarioPayloads.map(({ startTime, data }) => {
    const startMinutes = (Number.parseInt(startTime.slice(0, 2), 10) * 60) + Number.parseInt(startTime.slice(3, 5), 10);
    const returnMinutes = startMinutes + Math.max(1, Math.round(Number(preferences.travelWindowHours) || 12)) * 60;
    const turnaroundTime = `${String(Math.floor((returnMinutes % 1440) / 60)).padStart(2, '0')}:${String(returnMinutes % 60).padStart(2, '0')}`;
    const decision = evaluateBackcountryDecision(data, startTime, preferences, { turnaroundTime });
    return buildStartTimeScenario(startTime, data, decision, preferences);
  }), [scenarioPayloads, preferences]);

  const comparison = useMemo(
    () => compareStartTimeScenarios(scenarios, preferences),
    [scenarios, preferences],
  );
  const generateMore = useCallback(() => setIncludeMoreScenarios(true), []);

  return {
    comparison,
    loading,
    error,
    canGenerateMore: !includeMoreScenarios,
    generateMore,
  };
}
