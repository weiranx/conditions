import { 
  firstNonEmptyString, 
  normalizeAvalancheProblemCollection 
} from './avalanche-detail';

export const AVALANCHE_UNKNOWN_MESSAGE =
  "No official avalanche center forecast covers this objective. Avalanche terrain can still be dangerous. Treat conditions as unknown and use conservative terrain choices.";
export const AVALANCHE_OFF_SEASON_MESSAGE =
  "Local avalanche center is not currently issuing forecasts for this zone (likely off-season). This does not imply zero risk; assess snow and terrain conditions directly.";
export const AVALANCHE_LEVEL_LABELS = ['No Rating', 'Low', 'Moderate', 'Considerable', 'High', 'Extreme'];

export const AVALANCHE_WINTER_MONTHS = new Set([10, 11, 0, 1, 2, 3]); // Nov, Dec, Jan, Feb, Mar, Apr
export const AVALANCHE_SHOULDER_MONTHS = new Set([4, 5, 9]); // May, Jun, Oct

export const AVALANCHE_MATERIAL_SNOW_DEPTH_IN = 8;
export const AVALANCHE_MATERIAL_SWE_IN = 1.0;
export const AVALANCHE_MEASURABLE_SNOW_DEPTH_IN = 2;
export const AVALANCHE_MEASURABLE_SWE_IN = 0.2;

export interface AvalancheData {
  center: string | null;
  center_id: string | null;
  zone: string | null;
  risk: string;
  dangerLevel: number;
  dangerUnknown: boolean;
  coverageStatus: string;
  link: string | null;
  bottomLine: string | null;
  problems: any[];
  publishedTime: string | null;
  expiresTime: string | null;
  generatedTime?: string | null;
  elevations: any;
  relevant: boolean;
  relevanceReason: string | null;
  staleWarning?: string;
}

export const createUnknownAvalancheData = (coverageStatus: string = "no_center_coverage"): AvalancheData => {
  const isTemporarilyUnavailable = coverageStatus === "temporarily_unavailable";
  const isOffSeason = coverageStatus === "no_active_forecast";
  return {
    center: isTemporarilyUnavailable
      ? "Avalanche Data Unavailable"
      : isOffSeason
        ? "Avalanche Forecast Off-Season"
        : "No Avalanche Center Coverage",
    center_id: null,
    zone: null,
    risk: "Unknown",
    dangerLevel: 0,
    dangerUnknown: true,
    coverageStatus,
    link: null,
    bottomLine: isTemporarilyUnavailable
      ? "Avalanche center data could not be retrieved right now. Avalanche terrain can still be dangerous. Treat risk as unknown and use conservative terrain choices."
      : isOffSeason
        ? AVALANCHE_OFF_SEASON_MESSAGE
      : AVALANCHE_UNKNOWN_MESSAGE,
    problems: [],
    publishedTime: null,
    expiresTime: null,
    generatedTime: null,
    elevations: null,
    relevant: true,
    relevanceReason: null,
  };
};
