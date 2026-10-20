import type { SafetyData } from './types';

/** Reapply display flags for snapshots restored under different preferences. */
export function reportInsightItems(data: SafetyData) {
  return (data.reportInsights?.items || []).filter(item =>
    Array.isArray(item.features) && item.features.every(key => data.featureFlags?.[key] !== false));
}

type Insight = ReturnType<typeof reportInsightItems>[number];

/**
 * Items that only restate what a feed cannot establish. They stay in the
 * payload for the AI brief and field brief but are not worth screen space.
 */
export const disclaimerOnlyInsight = (item: Insight) =>
  item.tone === 'gap' || (item.tone === 'context' && ['access', 'station-wind', 'water'].includes(item.id));

/** How many insights need resolving before the trip, and how many are background worth showing. */
export function insightCounts(data: SafetyData) {
  const items = reportInsightItems(data);
  return {
    cautions: items.filter(item => item.decisionRelevant).length,
    background: items.filter(item => !item.decisionRelevant && !disclaimerOnlyInsight(item)).length,
  };
}
