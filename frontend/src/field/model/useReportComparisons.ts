import type { SafetyData, UserPreferences } from '../../app/types';
import { useDayComparisons } from '../../hooks/useDayComparisons';
import { useStartTimeScenarios } from '../../hooks/useStartTimeScenarios';
import { comparisonReportMatches } from '../../app/comparison-request';

// Comparisons belong to a completed, current report, never a draft or saved snapshot.
export function useReportComparisons({
  hasObjective, view, safetyData, forecastDate, currentStartTime, position, preferences,
  viewingHistoryReport, loading, startTimeComparisonsEnabled,
}: {
  hasObjective: boolean;
  view: string;
  safetyData: SafetyData | null;
  forecastDate: string;
  currentStartTime: string;
  position: { lat: number; lng: number };
  preferences: UserPreferences;
  viewingHistoryReport: boolean;
  loading: boolean;
  startTimeComparisonsEnabled: boolean;
}) {
  const reportMatchesPlan = comparisonReportMatches(
    safetyData, position.lat, position.lng, forecastDate, currentStartTime, preferences.travelWindowHours,
  );
  const enabled = hasObjective && view === 'planner' && reportMatchesPlan && !viewingHistoryReport && !loading;
  const { dayOverDay } = useDayComparisons({
    hasObjective: enabled, view, safetyData, forecastDate, currentStartTime, position, preferences,
  });
  const startTimeScenarios = useStartTimeScenarios({
    enabled: enabled && startTimeComparisonsEnabled, sourceReport: safetyData,
    forecastDate, currentStartTime, position, preferences,
  });
  return { dayOverDay, startTimeScenarios };
}
