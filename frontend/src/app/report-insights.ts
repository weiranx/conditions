import type { SafetyData } from './types';

/** Reapply display flags for snapshots restored under different preferences. */
export function reportInsightItems(data: SafetyData) {
  return (data.reportInsights?.items || []).filter(item =>
    Array.isArray(item.features) && item.features.every(key => data.featureFlags?.[key] !== false));
}
