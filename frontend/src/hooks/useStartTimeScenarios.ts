import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SafetyData, UserPreferences } from '../app/types';
import { evaluateBackcountryDecision } from '../app/decision';
import type { ApproachProfile } from '../app/approach-elevation';
import {
  EXTENDED_START_TIME_SCENARIO_TIMES,
  START_TIME_SCENARIO_TIMES,
  buildStartTimeScenario,
  compareStartTimeScenarios,
  includeUserStartTimeScenario,
  type StartTimeScenario,
} from '../app/start-time-scenarios';
import { comparisonReportMatches, comparisonRequestUrl, comparisonTravelHours, reportRequestedStartTime } from '../app/comparison-request';
import { fetchApi } from '../lib/api-client';
import { minutesToTwentyFourHourClock } from '../app/core';

interface UseStartTimeScenariosParams {
  enabled: boolean;
  sourceReport: SafetyData | null;
  forecastDate: string;
  currentStartTime: string;
  position: { lat: number; lng: number };
  preferences: UserPreferences;
  approach?: ApproachProfile | null;
}

export function useStartTimeScenarios({
  enabled,
  sourceReport,
  forecastDate,
  currentStartTime,
  position,
  preferences,
  approach = null,
}: UseStartTimeScenariosParams) {
  const [result, setResult] = useState<{
    key: string;
    source: SafetyData | null;
    payloads: Array<{ startTime: string; data: SafetyData }>;
    error: string | null;
  } | null>(null);
  const scenarioCache = useRef<{
    planKey: string;
    source: SafetyData | null;
    payloads: Map<string, SafetyData>;
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
    // Reuse validated departures only within this report generation and plan.
    // Refreshing the report must fetch fresh alternatives even if its values match.
    if (scenarioCache.current?.planKey !== planKey || scenarioCache.current.source !== sourceReport) {
      scenarioCache.current = { planKey, source: sourceReport, payloads: new Map() };
    }
    if (!enabled) {
      return;
    }

    const cache = scenarioCache.current;
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        scenarioTimes.map(async (startTime) => {
          const cached = cache.payloads.get(startTime);
          if (cached) return { startTime, data: cached };
          // Older snapshots may omit request identity. They remain fetchable,
          // but cannot safely replace a request for a specific departure.
          if (startTime === currentStartTime && sourceReport
            && reportRequestedStartTime(sourceReport) === startTime
            && sourceReport.rainfall?.expected?.travelWindowHours === travelWindowHours
            && comparisonReportMatches(sourceReport, position.lat, position.lng, forecastDate, startTime, travelWindowHours)) {
            cache.payloads.set(startTime, sourceReport);
            return { startTime, data: sourceReport };
          }
          try {
            const { response, payload } = await fetchApi(
              comparisonRequestUrl(position.lat, position.lng, forecastDate, startTime, travelWindowHours),
              { signal: controller.signal },
            );
            if (!response.ok || !payload || typeof payload !== 'object') return null;
            if (!comparisonReportMatches(payload as SafetyData, position.lat, position.lng, forecastDate, startTime, travelWindowHours)) return null;
            if (cancelled) return null;
            cache.payloads.set(startTime, payload as SafetyData);
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
    planKey,
    currentStartTime,
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
    // Like the main report, a return after midnight is checked as 23:59 on the
    // start day; wrapping it to the next morning would pass the daylight check.
    const turnaroundTime = minutesToTwentyFourHourClock(startMinutes + travelWindowHours * 60);
    const decision = evaluateBackcountryDecision(data, startTime, preferences, { turnaroundTime, approach });
    return buildStartTimeScenario(startTime, data, decision, preferences);
  }), [currentResult, preferences, travelWindowHours, approach]);

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
