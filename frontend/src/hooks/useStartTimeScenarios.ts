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
import { comparisonRequestUrl, comparisonTravelHours } from '../app/comparison-request';
import { fetchApi } from '../lib/api-client';

interface UseStartTimeScenariosParams {
  enabled: boolean;
  sourceReport: SafetyData | null;
  forecastDate: string;
  currentStartTime: string;
  position: { lat: number; lng: number };
  preferences: UserPreferences;
}

export function useStartTimeScenarios({
  enabled,
  sourceReport,
  forecastDate,
  currentStartTime,
  position,
  preferences,
}: UseStartTimeScenariosParams) {
  const [result, setResult] = useState<{
    key: string;
    source: SafetyData | null;
    payloads: Array<{ startTime: string; data: SafetyData }>;
    error: string | null;
  } | null>(null);
  const travelWindowHours = comparisonTravelHours(preferences.travelWindowHours);
  const planKey = comparisonRequestUrl(position.lat, position.lng, forecastDate, currentStartTime, travelWindowHours);
  const [expandedPlanKey, setExpandedPlanKey] = useState<string | null>(null);
  const includeMoreScenarios = expandedPlanKey === planKey;
  const scenarioTimes = useMemo(
    () => includeUserStartTimeScenario(
      includeMoreScenarios ? EXTENDED_START_TIME_SCENARIO_TIMES : START_TIME_SCENARIO_TIMES,
      currentStartTime,
    ),
    [currentStartTime, includeMoreScenarios],
  );

  const requestKey = JSON.stringify([planKey, scenarioTimes]);
  const currentResult = enabled && result?.key === requestKey && result.source === sourceReport ? result : null;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        scenarioTimes.map(async (startTime) => {
          try {
            const { response, payload } = await fetchApi(
              comparisonRequestUrl(position.lat, position.lng, forecastDate, startTime, travelWindowHours),
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
      setResult({
        key: requestKey,
        source: sourceReport,
        payloads: valid,
        error: valid.length === scenarioTimes.length ? null : 'Some departure scenarios could not be evaluated.',
      });
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    enabled,
    forecastDate,
    position.lat,
    position.lng,
    travelWindowHours,
    requestKey,
    sourceReport,
    scenarioTimes,
  ]);

  const scenarios = useMemo<StartTimeScenario[]>(() => (currentResult?.payloads ?? []).map(({ startTime, data }) => {
    const startMinutes = (Number.parseInt(startTime.slice(0, 2), 10) * 60) + Number.parseInt(startTime.slice(3, 5), 10);
    const returnMinutes = startMinutes + travelWindowHours * 60;
    const turnaroundTime = `${String(Math.floor((returnMinutes % 1440) / 60)).padStart(2, '0')}:${String(returnMinutes % 60).padStart(2, '0')}`;
    const decision = evaluateBackcountryDecision(data, startTime, preferences, { turnaroundTime });
    return buildStartTimeScenario(startTime, data, decision, preferences);
  }), [currentResult, preferences, travelWindowHours]);

  const comparison = useMemo(
    () => compareStartTimeScenarios(scenarios, preferences),
    [scenarios, preferences],
  );
  const generateMore = useCallback(() => setExpandedPlanKey(planKey), [planKey, setExpandedPlanKey]);

  return {
    comparison,
    loading: enabled && !currentResult,
    error: currentResult?.error ?? null,
    canGenerateMore: !includeMoreScenarios,
    generateMore,
  };
}
