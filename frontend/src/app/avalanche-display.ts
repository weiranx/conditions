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

const DANGER_LABELS = ['No rating', 'Low', 'Moderate', 'Considerable', 'High', 'Extreme'];

/**
 * One line for the Brief's avalanche card: the rating when there is one;
 * otherwise why there is none, then why avalanche terrain matters here.
 */
export function avalancheBriefCaption(
  avalanche: SafetyData['avalanche'] | null | undefined,
  display: AvalancheDisplayState,
): string {
  if (!avalanche) return 'No avalanche information is available for this plan.';
  if (!display.relevant) return display.notApplicableReason;
  const level = display.overallLevel;
  if (level !== null && level > 0) {
    return `${DANGER_LABELS[level] || `Level ${level}`} (${level} of 5) is the highest rating in the ${avalanche.center || 'avalanche center'} forecast.`;
  }
  const missing = display.expiredForSelectedStart
    ? 'The avalanche forecast expires before your start.'
    : avalanche.coverageStatus === 'no_active_forecast'
      ? `${avalanche.center || 'The avalanche center'} has no current forecast for this zone.`
      : avalanche.coverageStatus === 'no_center_coverage'
        ? 'No avalanche center forecasts this area.'
        : avalanche.coverageStatus === 'temporarily_unavailable'
          ? 'The avalanche forecast could not be loaded.'
          : 'The current avalanche product has no danger rating.';
  return `${missing} ${display.notApplicableReason}`.trim();
}
