import type { SafetyData } from './types';
import { normalizeDangerLevel } from './planner-helpers';

export interface AvalancheDisplayState {
  relevant: boolean;
  expiredForSelectedStart: boolean;
  coverageUnknown: boolean;
  unknown: boolean;
  overallLevel: number | null;
  notApplicableReason: string;
  elevationRows: Array<{ key: string; label: string; rating: number | null }>;
}

export function buildAvalancheDisplayState(
  safetyData: SafetyData | null,
  localizeUnitText: (text: string) => string,
): AvalancheDisplayState {
  const relevant = safetyData ? safetyData.avalanche.relevant !== false : true;
  const expiredForSelectedStart = safetyData ? safetyData.avalanche.coverageStatus === 'expired_for_selected_start' : false;
  const coverageUnknown = safetyData
    ? ['no_center_coverage', 'temporarily_unavailable', 'no_active_forecast'].includes(String(safetyData.avalanche.coverageStatus || ''))
    : false;
  const unknown = safetyData
    ? relevant && Boolean(safetyData.avalanche.dangerUnknown || coverageUnknown)
    : false;
  const overallLevel = safetyData && !unknown ? normalizeDangerLevel(safetyData.avalanche.dangerLevel) : null;
  const notApplicableReason = safetyData
    ? localizeUnitText(
        safetyData.avalanche.relevanceReason || 'Avalanche forecast is not applicable for this objective/date based on seasonal and snowpack context.',
      )
    : '';
  const elevationRows = safetyData && !unknown
    ? [
        { key: 'above', label: 'Above treeline', rating: safetyData.avalanche.elevations?.above?.level ?? null },
        { key: 'at', label: 'Near treeline', rating: safetyData.avalanche.elevations?.at?.level ?? null },
        { key: 'below', label: 'Below treeline', rating: safetyData.avalanche.elevations?.below?.level ?? null },
      ]
    : [];
  return { relevant, expiredForSelectedStart, coverageUnknown, unknown, overallLevel, notApplicableReason, elevationRows };
}
