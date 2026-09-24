import { useCallback, useEffect, useState } from 'react';
import type { SafetyData, StartTimeScenarioComparison } from '../app/types';
import { comparisonTravelHours } from '../app/comparison-request';
import { readStartTimeComparison } from '../app/plan-evaluation';
import { fetchApi } from '../lib/api-client';

interface UseStartTimeScenariosParams {
  enabled: boolean;
  sourceReport: SafetyData | null;
  forecastDate: string;
  currentStartTime: string;
  position: { lat: number; lng: number };
  travelWindowHours: number;
  /** The traveler's limits, units and approach, as a query string. */
  planSettingsQuery: string;
}

/**
 * The planned trip at other departure times, compared by the backend. A
 * refreshed report asks again even when the plan is unchanged.
 */
export function useStartTimeScenarios({
  enabled,
  sourceReport,
  forecastDate,
  currentStartTime,
  position,
  travelWindowHours,
  planSettingsQuery,
}: UseStartTimeScenariosParams) {
  const hours = comparisonTravelHours(travelWindowHours);
  const planKey = JSON.stringify([position.lat, position.lng, forecastDate, currentStartTime, hours, planSettingsQuery]);
  const [expandedPlanKey, setExpandedPlanKey] = useState<string | null>(null);
  const extended = expandedPlanKey === planKey;
  const requestKey = JSON.stringify([planKey, extended]);
  const [result, setResult] = useState<{
    key: string;
    source: SafetyData | null;
    comparison: StartTimeScenarioComparison | null;
    error: string | null;
  } | null>(null);
  const current = enabled && result?.key === requestKey && result.source === sourceReport ? result : null;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const query = new URLSearchParams({
      lat: String(position.lat),
      lon: String(position.lng),
      date: forecastDate,
      start: currentStartTime,
      travel_window_hours: String(hours),
      ...(extended ? { set: 'extended' } : {}),
    });
    (async () => {
      try {
        const { response, payload } = await fetchApi(
          `/api/start-time-scenarios?${query}${planSettingsQuery ? `&${planSettingsQuery}` : ''}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
        const comparison = response.ok ? readStartTimeComparison(record.comparison) : null;
        setResult({
          key: requestKey,
          source: sourceReport,
          comparison,
          error: !response.ok || !comparison
            ? 'Departure scenarios could not be evaluated.'
            : typeof record.error === 'string' ? record.error : null,
        });
      } catch {
        if (controller.signal.aborted) return;
        setResult({ key: requestKey, source: sourceReport, comparison: null, error: 'Departure scenarios could not be evaluated.' });
      }
    })();
    return () => controller.abort();
  }, [enabled, requestKey, sourceReport, position.lat, position.lng, forecastDate, currentStartTime, hours, extended, planSettingsQuery]);

  const generateMore = useCallback(() => setExpandedPlanKey(planKey), [planKey, setExpandedPlanKey]);
  return {
    comparison: current?.comparison ?? null,
    loading: enabled && !current,
    error: current?.error ?? null,
    canGenerateMore: !extended,
    generateMore,
  };
}
