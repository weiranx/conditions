import { createContext, useContext } from 'react';

export const PRODUCT_FEATURE_KEYS = [
  'tripPlanning',
  'routeAnalysis',
  'satelliteImagery',
  'startTimeComparisons',
  'terrainWindow',
  'objectiveWatch',
  'gpxImport',
  'reportHistory',
  'reportSharing',
  'hourlyWeatherCharts',
  'elevationForecast',
  'heatRiskDetails',
  'fireRiskDetails',
  'snowpackDetails',
  'fieldObservations',
  'airQualityDetails',
  'gearRecommendations',
  'windLoadingDetails',
  'daylightTimeline',
  'scoreBreakdown',
  'weatherContextDetails',
  'avalancheDetails',
] as const;
export type ProductFeatureKey = (typeof PRODUCT_FEATURE_KEYS)[number];
export type ProductFeatureFlags = Record<ProductFeatureKey, boolean>;

export const DEFAULT_FEATURE_FLAGS: ProductFeatureFlags = {
  tripPlanning: true,
  routeAnalysis: true,
  satelliteImagery: true,
  startTimeComparisons: true,
  terrainWindow: true,
  objectiveWatch: true,
  gpxImport: true,
  reportHistory: true,
  reportSharing: true,
  hourlyWeatherCharts: true,
  elevationForecast: true,
  heatRiskDetails: true,
  fireRiskDetails: true,
  snowpackDetails: true,
  fieldObservations: true,
  airQualityDetails: true,
  gearRecommendations: true,
  windLoadingDetails: true,
  daylightTimeline: true,
  scoreBreakdown: true,
  weatherContextDetails: true,
  avalancheDetails: true,
};
export const FEATURE_FLAGS_EVENT = 'summitsafe:product-feature-flags-change';

export const FeatureFlagsContext = createContext<ProductFeatureFlags>(DEFAULT_FEATURE_FLAGS);

export function readFeatureFlags(payload: unknown): ProductFeatureFlags | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  if (!PRODUCT_FEATURE_KEYS.every((flag) => typeof record[flag] === 'boolean')) return null;
  return Object.fromEntries(PRODUCT_FEATURE_KEYS.map((flag) => [flag, Boolean(record[flag])])) as ProductFeatureFlags;
}

export function publishProductFeatureFlags(flags: ProductFeatureFlags): void {
  window.dispatchEvent(new CustomEvent(FEATURE_FLAGS_EVENT, { detail: flags }));
}

export function useProductFeatureFlags(): ProductFeatureFlags {
  return useContext(FeatureFlagsContext);
}
