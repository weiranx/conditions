import { normalizeSuggestionText, type Suggestion } from '../lib/search';

export function suggestionIdentityKey(item: Pick<Suggestion, 'lat' | 'lon' | 'name'>): string {
  return `${Number(item.lat).toFixed(4)},${Number(item.lon).toFixed(4)}:${normalizeSuggestionText(item.name || '')}`;
}

export function suggestionCoordinateKey(lat: number | string, lon: number | string): string {
  return `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;
}

export function normalizeStoredSuggestion(item: unknown, fallbackClass?: string): Suggestion | null {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const raw = item as Partial<Suggestion>;
  const name = String(raw.name || '').trim();
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  return {
    name,
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    class: String(raw.class || fallbackClass || '').trim() || undefined,
    type: raw.type,
  };
}

export function readStoredSuggestions(storageKey: string, fallbackClass?: string): Suggestion[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => normalizeStoredSuggestion(item, fallbackClass))
      .filter((item): item is Suggestion => Boolean(item));
  } catch {
    return [];
  }
}

export function writeStoredSuggestions(storageKey: string, items: Suggestion[], maxItems: number): void {
  if (typeof window === 'undefined') {
    return;
  }
  const deduped: Suggestion[] = [];
  const seen = new Set<string>();
  items.forEach((item) => {
    const normalized = normalizeStoredSuggestion(item, item.class);
    if (!normalized) {
      return;
    }
    const key = suggestionIdentityKey(normalized);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    deduped.push(normalized);
  });
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(deduped.slice(0, maxItems)));
  } catch {
    // QuotaExceededError or SecurityError — silently ignore
  }
}

export function mergeSuggestionBuckets(buckets: Suggestion[][], limit: number): Suggestion[] {
  const output: Suggestion[] = [];
  const seen = new Set<string>();
  buckets.forEach((bucket) => {
    bucket.forEach((item) => {
      const key = suggestionIdentityKey(item);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      output.push(item);
    });
  });
  return output.slice(0, limit);
}

export function filterSuggestionBucket(items: Suggestion[], query: string): Suggestion[] {
  const normalizedQuery = normalizeSuggestionText(query);
  if (!normalizedQuery) {
    return items;
  }
  return items.filter((item) => normalizeSuggestionText(item.name).includes(normalizedQuery));
}
