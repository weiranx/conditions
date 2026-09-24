export interface Suggestion {
  name: string;
  lat: string | number;
  lon: string | number;
  class?: string;
  type?: string;
  /** What the place is, e.g. "Peak", "Trailhead", "Town" (from the server). */
  kind?: string;
  /** Mapped summit or feature elevation, when OpenStreetMap or the catalog has one. */
  elevationFt?: number;
}

const LOCAL_POPULAR_SUGGESTIONS: Suggestion[] = [
  { name: 'Mount Rainier, Washington', lat: 46.8523, lon: -121.7603, class: 'popular', type: 'peak', kind: 'Peak', elevationFt: 14411 },
  { name: 'Mount Shasta, California', lat: 41.4091, lon: -122.1946, class: 'popular', type: 'peak', kind: 'Peak', elevationFt: 14179 },
  { name: 'Mount Whitney, California', lat: 36.5786, lon: -118.2923, class: 'popular', type: 'peak', kind: 'Peak', elevationFt: 14505 },
  { name: 'Grand Teton, Wyoming', lat: 43.7417, lon: -110.8024, class: 'popular', type: 'peak', kind: 'Peak', elevationFt: 13775 },
  { name: 'Longs Peak, Colorado', lat: 40.2549, lon: -105.615, class: 'popular', type: 'peak', kind: 'Peak', elevationFt: 14259 },
  { name: 'Mount Elbert, Colorado', lat: 39.1178, lon: -106.4454, class: 'popular', type: 'peak', kind: 'Peak', elevationFt: 14440 },
  { name: 'Mount Hood, Oregon', lat: 45.3735, lon: -121.6959, class: 'popular', type: 'peak', kind: 'Peak', elevationFt: 11249 },
  { name: 'Mount Washington, New Hampshire', lat: 44.2706, lon: -71.3033, class: 'popular', type: 'peak', kind: 'Peak', elevationFt: 6288 },
  { name: 'Kings Peak, Utah', lat: 40.7764, lon: -110.3726, class: 'popular', type: 'peak', kind: 'Peak', elevationFt: 13528 },
  { name: 'San Jacinto Peak, California', lat: 33.8147, lon: -116.6794, class: 'popular', type: 'peak', kind: 'Peak', elevationFt: 10834 },
];

const MOUNTAIN_TYPE_HINTS = new Set(['mountain', 'peak', 'summit', 'volcano']);
const MOUNTAIN_CLASS_HINTS = new Set(['mountain', 'peak']);
const MOUNTAIN_NAME_HINT = /\b(mt|mount|mountain|peak|summit|volcano)\b/i;

export function isMountainSuggestion(suggestion: Suggestion): boolean {
  const typeValue = normalizeSuggestionText(suggestion.type ?? '');
  const classValue = normalizeSuggestionText(suggestion.class ?? '');
  const primaryName = suggestion.name.split(',')[0] ?? '';

  if (typeValue && MOUNTAIN_TYPE_HINTS.has(typeValue)) {
    return true;
  }
  if (classValue && MOUNTAIN_CLASS_HINTS.has(classValue)) {
    return true;
  }
  return MOUNTAIN_NAME_HINT.test(primaryName);
}

export function normalizeSuggestionText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,()]/g, ' ')
    .replace(/\bmt\b/g, 'mount')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordsStartWith(text: string, query: string): boolean {
  const words = normalizeSuggestionText(text).split(' ');
  return normalizeSuggestionText(query)
    .split(' ')
    .every((part) => words.some((word) => word.startsWith(part)));
}

/** The name contains the query, or every query word starts one of its words ("teton grand", "mt rain"). */
export function suggestionMatchesQuery(name: string, query: string): boolean {
  const normalizedQuery = normalizeSuggestionText(query);
  if (!normalizedQuery) {
    return true;
  }
  return normalizeSuggestionText(name).includes(normalizedQuery) || wordsStartWith(name, query);
}

// The same summit arrives from this catalog, the server's catalog and OpenStreetMap
// with coordinates a few metres apart and fuller or shorter names ("Grand Teton",
// "Grand Teton, Wyoming", "Grand Teton, Teton County, …"). Within about 1 km with
// the same leading name, they are one place.
const SAME_PLACE_DEGREES = 0.01;

// "Mount San Antonio (Mt Baldy)" in the catalog is OpenStreetMap's "Mount San Antonio".
function primarySuggestionName(suggestion: Suggestion): string {
  return normalizeSuggestionText((suggestion.name.split(',')[0] ?? '').replace(/\([^)]*\)/g, ''));
}

export function isSameSuggestionPlace(a: Suggestion, b: Suggestion): boolean {
  return (
    primarySuggestionName(a) === primarySuggestionName(b) &&
    Math.abs(Number(a.lat) - Number(b.lat)) <= SAME_PLACE_DEGREES &&
    Math.abs(Number(a.lon) - Number(b.lon)) <= SAME_PLACE_DEGREES
  );
}

/**
 * Keeps the first suggestion for each place, in order. A later copy fills in what the kept
 * one lacks, so a recent pick still shows the elevation the server knows.
 */
export function uniqueSuggestionPlaces(items: Suggestion[]): Suggestion[] {
  const output: Suggestion[] = [];
  items.forEach((item) => {
    const index = output.findIndex((kept) => isSameSuggestionPlace(kept, item));
    if (index < 0) {
      output.push(item);
      return;
    }
    const kept = output[index];
    if ((kept.kind === undefined && item.kind !== undefined) || (kept.elevationFt === undefined && item.elevationFt !== undefined)) {
      output[index] = { ...kept, kind: kept.kind ?? item.kind, elevationFt: kept.elevationFt ?? item.elevationFt };
    }
  });
  return output;
}

// Only whether the place's own name matches: the server already orders its results
// (backcountry features before towns, then by prominence), so "rainier" keeps Mount Rainier
// above Rainier, Oregon. Places matched through another name (Mount San Antonio for
// "mt baldy") follow.
function suggestionRank(suggestion: Suggestion, query: string): number {
  return wordsStartWith(suggestion.name.split(',')[0] ?? '', query) ? 0 : 1;
}

export function rankAndDeduplicateSuggestions(items: Suggestion[], query: string): Suggestion[] {
  return uniqueSuggestionPlaces(items)
    .map((item, index) => ({ item, index, rank: suggestionRank(item, query) }))
    .sort((a, b) => {
      if (a.rank !== b.rank) {
        return a.rank - b.rank;
      }
      const aPopular = a.item.class === 'popular' ? 0 : 1;
      const bPopular = b.item.class === 'popular' ? 0 : 1;
      return aPopular - bPopular || a.index - b.index;
    })
    .map(({ item }) => item)
    .slice(0, 8);
}

export function getLocalPopularSuggestions(query: string): Suggestion[] {
  const normalizedQuery = normalizeSuggestionText(query);
  if (!normalizedQuery) {
    return LOCAL_POPULAR_SUGGESTIONS.slice(0, 8);
  }
  return rankAndDeduplicateSuggestions(
    LOCAL_POPULAR_SUGGESTIONS.filter((item) => suggestionMatchesQuery(item.name, query)),
    query,
  ).slice(0, 8);
}

export interface SearchNear {
  lat: number;
  lon: number;
}

/**
 * The search request for a query, biased toward where the user is planning. The server
 * prefers places within a couple of degrees of `near` ("snow lake" near Seattle is the
 * Alpine Lakes one) without dropping farther matches; whole degrees are all it uses.
 */
export function searchRequestPath(query: string, near?: SearchNear | null): string {
  const params = new URLSearchParams({ q: query });
  if (near && Number.isFinite(near.lat) && Number.isFinite(near.lon)) {
    params.set('near', `${Math.round(near.lat)},${Math.round(near.lon)}`);
  }
  return `/api/search?${params.toString()}`;
}
