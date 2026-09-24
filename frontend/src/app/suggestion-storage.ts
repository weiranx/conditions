import { normalizeSuggestionText, suggestionMatchesQuery, uniqueSuggestionPlaces, type Suggestion } from '../lib/search';

export function suggestionIdentityKey(item: Pick<Suggestion, 'lat' | 'lon' | 'name'>): string {
  return `${Number(item.lat).toFixed(4)},${Number(item.lon).toFixed(4)}:${normalizeSuggestionText(item.name || '')}`;
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
    ...(typeof raw.kind === 'string' && raw.kind.trim() ? { kind: raw.kind.trim() } : {}),
    ...(typeof raw.elevationFt === 'number' && Number.isFinite(raw.elevationFt) ? { elevationFt: Math.round(raw.elevationFt) } : {}),
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

/** Earlier buckets win: a recent pick keeps its place over the same peak from a catalog. */
export function mergeSuggestionBuckets(buckets: Suggestion[][], limit: number): Suggestion[] {
  return uniqueSuggestionPlaces(buckets.flat()).slice(0, limit);
}

export function filterSuggestionBucket(items: Suggestion[], query: string): Suggestion[] {
  return items.filter((item) => suggestionMatchesQuery(item.name, query));
}
