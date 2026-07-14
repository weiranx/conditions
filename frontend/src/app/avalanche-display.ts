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
  const avalanche = safetyData?.avalanche;
  const relevant = Boolean(avalanche && avalanche.relevant !== false);
  const expiredForSelectedStart = avalanche?.coverageStatus === 'expired_for_selected_start';
  const coverageUnknown = avalanche
    ? ['no_center_coverage', 'temporarily_unavailable', 'no_active_forecast'].includes(String(avalanche.coverageStatus || ''))
    : false;
  const unknown = avalanche
    ? relevant && Boolean(avalanche.dangerUnknown || coverageUnknown)
    : false;
  const overallLevel = avalanche && !unknown ? normalizeDangerLevel(avalanche.dangerLevel) : null;
  const notApplicableReason = avalanche
    ? localizeUnitText(
        avalanche.relevanceReason || 'Avalanche forecast is not applicable for this objective/date based on seasonal and snowpack context.',
      )
    : '';
  const elevationRows = avalanche && !unknown
    ? [
        { key: 'above', label: 'Above treeline', rating: avalanche.elevations?.above?.level ?? null },
        { key: 'at', label: 'Near treeline', rating: avalanche.elevations?.at?.level ?? null },
        { key: 'below', label: 'Below treeline', rating: avalanche.elevations?.below?.level ?? null },
      ]
    : [];
  return { relevant, expiredForSelectedStart, coverageUnknown, unknown, overallLevel, notApplicableReason, elevationRows };
}
