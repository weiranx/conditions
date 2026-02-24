export interface Suggestion {
  name: string;
  lat: string | number;
  lon: string | number;
  class?: string;
  type?: string;
}

const LOCAL_POPULAR_SUGGESTIONS: Suggestion[] = [
  { name: 'Mount Rainier, Washington', lat: 46.8523, lon: -121.7603, class: 'popular', type: 'peak' },
  { name: 'Mount Shasta, California', lat: 41.4091, lon: -122.1946, class: 'popular', type: 'peak' },
  { name: 'Mount Whitney, California', lat: 36.5786, lon: -118.2923, class: 'popular', type: 'peak' },
  { name: 'Grand Teton, Wyoming', lat: 43.7417, lon: -110.8024, class: 'popular', type: 'peak' },
  { name: 'Longs Peak, Colorado', lat: 40.2549, lon: -105.615, class: 'popular', type: 'peak' },
  { name: 'Mount Elbert, Colorado', lat: 39.1178, lon: -106.4454, class: 'popular', type: 'peak' },
  { name: 'Mount Hood, Oregon', lat: 45.3735, lon: -121.6959, class: 'popular', type: 'peak' },
  { name: 'Mount Washington, New Hampshire', lat: 44.2706, lon: -71.3033, class: 'popular', type: 'peak' },
  { name: 'Kings Peak, Utah', lat: 40.7764, lon: -110.3726, class: 'popular', type: 'peak' },
  { name: 'San Jacinto Peak, California', lat: 33.8147, lon: -116.6794, class: 'popular', type: 'peak' },
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
    .replace(/[.,]/g, ' ')
    .replace(/\bmt\b/g, 'mount')
    .replace(/\s+/g, ' ')
    .trim();
}

function suggestionRank(name: string, query: string): number {
  const normalizedName = normalizeSuggestionText(name);
  const normalizedQuery = normalizeSuggestionText(query);
  if (!normalizedQuery) {
    return 99;
  }
  if (normalizedName === normalizedQuery) {
    return 0;
  }
  if (normalizedName.startsWith(normalizedQuery)) {
    return 1;
  }

  const primaryName = normalizedName.split(' ').slice(0, 3).join(' ');
  if (primaryName.startsWith(normalizedQuery)) {
    return 2;
  }

  const tokens = normalizedName.split(' ');
  if (tokens.some((token) => token.startsWith(normalizedQuery))) {
    return 3;
  }

  if (normalizedName.includes(normalizedQuery)) {
    return 4;
  }

  return 5;
}

export function rankAndDeduplicateSuggestions(items: Suggestion[], query: string): Suggestion[] {
  const deduped = new Map<string, Suggestion>();
  items.forEach((item) => {
    const key = `${normalizeSuggestionText(item.name)}|${Number(item.lat).toFixed(4)}|${Number(item.lon).toFixed(4)}`;
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  });

  return Array.from(deduped.values())
    .sort((a, b) => {
      const rankDiff = suggestionRank(a.name, query) - suggestionRank(b.name, query);
      if (rankDiff !== 0) {
        return rankDiff;
      }

      const aPopular = a.class === 'popular' ? 0 : 1;
      const bPopular = b.class === 'popular' ? 0 : 1;
      if (aPopular !== bPopular) {
        return aPopular - bPopular;
      }

      return a.name.localeCompare(b.name);
    })
    .slice(0, 8);
}

export function getLocalPopularSuggestions(query: string): Suggestion[] {
  const normalizedQuery = normalizeSuggestionText(query);
  if (!normalizedQuery) {
    return LOCAL_POPULAR_SUGGESTIONS.slice(0, 8);
  }
  return rankAndDeduplicateSuggestions(
    LOCAL_POPULAR_SUGGESTIONS.filter((item) => normalizeSuggestionText(item.name).includes(normalizedQuery)),
    query,
  ).slice(0, 8);
}
