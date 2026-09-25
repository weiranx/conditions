import { isMountainSuggestion, normalizeSuggestionText, type Suggestion } from '../lib/search';

export type ObjectiveKind = 'summit' | 'route' | 'place';

/**
 * Words for the two ends of the approach: where the party sets out, and the
 * point the forecast is for. A GPX route is read at its high point and starts
 * at its first point; a lake or trail is an objective, not a summit.
 */
export interface ObjectiveTerms {
  kind: ObjectiveKind;
  /** "trailhead" or "start", lower case. */
  start: string;
  /** "summit", "high point" or "objective", lower case. */
  top: string;
}

const TERMS: Record<ObjectiveKind | 'flatRoute', ObjectiveTerms> = {
  summit: { kind: 'summit', start: 'trailhead', top: 'summit' },
  route: { kind: 'route', start: 'start', top: 'high point' },
  // A track without elevations is read halfway; it has no known high point.
  flatRoute: { kind: 'route', start: 'start', top: 'objective' },
  place: { kind: 'place', start: 'trailhead', top: 'objective' },
};

export const SUMMIT_TERMS = TERMS.summit;

// Place kinds from search (backend place-search.js) that are tops.
const SUMMIT_KINDS = new Set(['peak', 'volcano', 'hill']);
// Named for something other than a top, even with "Mount" in the name ("Mount Si Trailhead").
const NOT_A_SUMMIT_NAME = /\b(trailhead|trail|lake|pass|hut|camp|campground|meadows?|falls|creek|river|parking|road|basin|valley|canyon|lot|park)\b/i;

/**
 * The terms for a plan: a GPX route (by its high point when its track has
 * elevations), else what the chosen place is (its search kind, then its name).
 */
export function objectiveTerms({ route, place }: {
  route: { hasElevation: boolean } | null;
  place: Pick<Suggestion, 'name' | 'type' | 'class' | 'kind'> | null;
}): ObjectiveTerms {
  if (route) return route.hasElevation ? TERMS.route : TERMS.flatRoute;
  if (!place?.name) return TERMS.place;
  const kind = normalizeSuggestionText(place.kind ?? '');
  if (kind) return SUMMIT_KINDS.has(kind) ? TERMS.summit : TERMS.place;
  if (NOT_A_SUMMIT_NAME.test(place.name.split(',')[0] ?? '')) return TERMS.place;
  return isMountainSuggestion({ ...place, lat: 0, lon: 0 }) ? TERMS.summit : TERMS.place;
}

export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
