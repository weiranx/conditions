import { useState, useCallback, useRef, useEffect } from 'react';
import { fetchApi, readApiErrorMessage } from '../lib/api-client';
import {
  getLocalPopularSuggestions,
  normalizeSuggestionText,
  rankAndDeduplicateSuggestions,
  type Suggestion,
} from '../lib/search';
import { SEARCH_DEBOUNCE_MS } from '../app/constants';
import { parseCoordinates } from '../app/core';
import {
  normalizeStoredSuggestion,
  readStoredSuggestions,
  writeStoredSuggestions,
  mergeSuggestionBuckets,
  filterSuggestionBucket,
  suggestionCoordinateKey,
} from '../app/suggestion-storage';
import L from 'leaflet';

const RECENT_SEARCHES_STORAGE_KEY = 'summitsafe-recent-searches';
const SAVED_OBJECTIVES_STORAGE_KEY = 'summitsafe-saved-objectives';
const MAX_RECENT_SEARCHES = 8;
const MAX_SAVED_OBJECTIVES = 12;

export interface UseSearchSuggestionsParams {
  initialSearchQuery: string;
  updateObjectivePosition: (nextPosition: L.LatLng, label?: string) => void;
}

export interface UseSearchSuggestionsReturn {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  committedSearchQuery: string;
  setCommittedSearchQuery: (value: string) => void;
  suggestions: Suggestion[];
  setSuggestions: React.Dispatch<React.SetStateAction<Suggestion[]>>;
  showSuggestions: boolean;
  setShowSuggestions: (value: boolean) => void;
  searchLoading: boolean;
  activeSuggestionIndex: number;
  setActiveSuggestionIndex: (value: number) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchWrapperRef: React.RefObject<HTMLDivElement | null>;
  savedObjectives: Suggestion[];
  recentSearches: Suggestion[];
  fetchSuggestions: (q: string) => Promise<void>;
  selectSuggestion: (s: Suggestion) => void;
  searchAndSelectFirst: (rawQuery: string) => Promise<boolean>;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  handleSearchSubmit: () => void;
  handleFocus: () => void;
  handleSearchClear: () => void;
  handleUseTypedCoordinates: (value: string) => void;
  handleToggleSaveObjective: (params: { hasObjective: boolean; objectiveName: string; position: L.LatLng }) => void;
  recordRecentSuggestion: (item: Suggestion) => void;
  persistSavedObjectiveList: (next: Suggestion[]) => void;
  objectiveIsSaved: (lat: number, lng: number) => boolean;
  parsedTypedCoordinates: { lat: number; lon: number } | null;
  clearSuggestionCache: () => void;
}

export function useSearchSuggestions({
  initialSearchQuery,
  updateObjectivePosition,
}: UseSearchSuggestionsParams): UseSearchSuggestionsReturn {
  const [searchQuery, setSearchQueryState] = useState(initialSearchQuery);
  const [committedSearchQuery, setCommittedSearchQuery] = useState(initialSearchQuery);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);

  const [savedObjectives, setSavedObjectives] = useState<Suggestion[]>(() =>
    readStoredSuggestions(SAVED_OBJECTIVES_STORAGE_KEY, 'saved'),
  );
  const [recentSearches, setRecentSearches] = useState<Suggestion[]>(() =>
    readStoredSuggestions(RECENT_SEARCHES_STORAGE_KEY, 'recent'),
  );

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchWrapperRef = useRef<HTMLDivElement | null>(null);
  const latestSuggestionRequestId = useRef(0);
  const suggestionCacheRef = useRef<Map<string, Suggestion[]>>(new Map());
  const suggestionAbortControllerRef = useRef<AbortController | null>(null);
  const suggestionsQueryRef = useRef<string>('');
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSearchQuery = useCallback((value: string) => {
    setSearchQueryState(value);
  }, []);

  const persistSavedObjectiveList = useCallback((next: Suggestion[]) => {
    setSavedObjectives(next);
    writeStoredSuggestions(SAVED_OBJECTIVES_STORAGE_KEY, next, MAX_SAVED_OBJECTIVES);
  }, []);

  const persistRecentSearchList = useCallback((next: Suggestion[]) => {
    setRecentSearches(next);
    writeStoredSuggestions(RECENT_SEARCHES_STORAGE_KEY, next, MAX_RECENT_SEARCHES);
  }, []);

  const getStoredSuggestionsForQuery = useCallback(
    (query: string, options?: { includePopular?: boolean }) => {
      const savedMatches = filterSuggestionBucket(savedObjectives, query).map((item) => ({ ...item, class: 'saved' }));
      const recentMatches = filterSuggestionBucket(recentSearches, query).map((item) => ({ ...item, class: 'recent' }));
      const popularMatches = options?.includePopular ? getLocalPopularSuggestions(query) : [];
      return mergeSuggestionBuckets([savedMatches, recentMatches, popularMatches], 10);
    },
    [recentSearches, savedObjectives],
  );

  const recordRecentSuggestion = useCallback(
    (item: Suggestion) => {
      const normalized = normalizeStoredSuggestion({ ...item, class: 'recent' }, 'recent');
      if (!normalized) {
        return;
      }
      persistRecentSearchList(
        mergeSuggestionBuckets([[normalized], recentSearches.map((entry) => ({ ...entry, class: 'recent' }))], MAX_RECENT_SEARCHES),
      );
    },
    [persistRecentSearchList, recentSearches],
  );

  const fetchSuggestions = useCallback(async (q: string) => {
    const requestId = ++latestSuggestionRequestId.current;
    const query = q.trim();
    const storedMatches = getStoredSuggestionsForQuery(query);
    if (!query || query.length < 2) {
      const discoverySuggestions = getStoredSuggestionsForQuery(query, { includePopular: true });
      suggestionsQueryRef.current = query;
      setSuggestions(discoverySuggestions);
      setShowSuggestions(true);
      setActiveSuggestionIndex(-1);
      setSearchLoading(false);
      return;
    }

    const cacheKey = normalizeSuggestionText(query);
    const cached = suggestionCacheRef.current.get(cacheKey);

    if (cached) {
      suggestionsQueryRef.current = query;
      setSuggestions(cached);
      setShowSuggestions(true);
      setActiveSuggestionIndex(-1);
      setSearchLoading(false);
      return;
    }

    if (suggestionAbortControllerRef.current) {
      suggestionAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    suggestionAbortControllerRef.current = controller;

    setSearchLoading(true);
    try {
      const queryParam = query ? `?q=${encodeURIComponent(query)}` : '';
      const { response, payload, requestId: apiRequestId } = await fetchApi(
        `/api/search${queryParam}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        const baseMessage = readApiErrorMessage(payload, `Search request failed (${response.status})`);
        throw new Error(apiRequestId ? `${baseMessage} (request ${apiRequestId})` : baseMessage);
      }
      if (requestId !== latestSuggestionRequestId.current) {
        return;
      }
      const nextSuggestions = Array.isArray(payload) ? payload : [];
      const resolvedSuggestions = mergeSuggestionBuckets(
        [storedMatches, rankAndDeduplicateSuggestions(nextSuggestions, query)],
        8,
      );
      suggestionCacheRef.current.set(cacheKey, resolvedSuggestions);
      if (suggestionCacheRef.current.size > 50) {
        const oldestKey = suggestionCacheRef.current.keys().next().value;
        if (typeof oldestKey === 'string') {
          suggestionCacheRef.current.delete(oldestKey);
        }
      }
      suggestionsQueryRef.current = query;
      setSuggestions(resolvedSuggestions);
      setShowSuggestions(true);
      setActiveSuggestionIndex(-1);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      if (requestId !== latestSuggestionRequestId.current) {
        return;
      }
      const fallback = mergeSuggestionBuckets([storedMatches, getLocalPopularSuggestions(query)], 8);
      suggestionCacheRef.current.set(cacheKey, fallback);
      suggestionsQueryRef.current = query;
      setSuggestions(fallback);
      setShowSuggestions(true);
      setActiveSuggestionIndex(-1);
      console.error('Search error:', err);
    } finally {
      if (suggestionAbortControllerRef.current === controller) {
        suggestionAbortControllerRef.current = null;
      }
      if (requestId === latestSuggestionRequestId.current) {
        setSearchLoading(false);
      }
    }
  }, [getStoredSuggestionsForQuery]);

  const selectSuggestion = useCallback(
    (s: Suggestion) => {
      const label = s.name.split(',')[0];
      const lat = Number(s.lat);
      const lon = Number(s.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return;
      }
      setSearchQuery(label);
      setCommittedSearchQuery(label);
      setShowSuggestions(false);
      setActiveSuggestionIndex(-1);
      updateObjectivePosition(new L.LatLng(lat, lon), label);
      recordRecentSuggestion({ ...s, name: s.name, lat, lon, class: 'recent' });
    },
    [recordRecentSuggestion, setSearchQuery, updateObjectivePosition],
  );

  const handleUseTypedCoordinates = useCallback(
    (value: string) => {
      const parsed = parseCoordinates(value);
      if (!parsed) {
        return;
      }
      setSearchQuery(value);
      setCommittedSearchQuery(value);
      updateObjectivePosition(new L.LatLng(parsed.lat, parsed.lon), 'Dropped pin');
      setShowSuggestions(false);
      setActiveSuggestionIndex(-1);
      recordRecentSuggestion({
        name: `${parsed.lat.toFixed(4)}, ${parsed.lon.toFixed(4)}`,
        lat: parsed.lat,
        lon: parsed.lon,
        class: 'recent',
        type: 'coordinate',
      });
    },
    [recordRecentSuggestion, setSearchQuery, updateObjectivePosition],
  );

  const searchAndSelectFirst = useCallback(
    async (rawQuery: string) => {
      const query = rawQuery.trim();
      if (!query) {
        return false;
      }

      const parsed = parseCoordinates(query);
      if (parsed) {
        setSearchQuery(query);
        setCommittedSearchQuery(query);
        updateObjectivePosition(new L.LatLng(parsed.lat, parsed.lon), 'Dropped pin');
        setShowSuggestions(false);
        setActiveSuggestionIndex(-1);
        recordRecentSuggestion({
          name: `${parsed.lat.toFixed(4)}, ${parsed.lon.toFixed(4)}`,
          lat: parsed.lat,
          lon: parsed.lon,
          class: 'recent',
          type: 'coordinate',
        });
        return true;
      }

      const cached = suggestionCacheRef.current.get(normalizeSuggestionText(query));
      if (cached && cached[0]) {
        setSuggestions(cached);
        selectSuggestion(cached[0]);
        return true;
      }

      if (query.length < 2) {
        const localSuggestions = getStoredSuggestionsForQuery(query, { includePopular: true });
        setSuggestions(localSuggestions);
        if (localSuggestions[0]) {
          selectSuggestion(localSuggestions[0]);
          return true;
        }
        setShowSuggestions(true);
        setActiveSuggestionIndex(-1);
        return false;
      }

      setSearchLoading(true);
      const requestId = ++latestSuggestionRequestId.current;
      try {
        const queryParam = query ? `?q=${encodeURIComponent(query)}` : '';
        const { response, payload, requestId: apiRequestId } = await fetchApi(
          `/api/search${queryParam}`,
        );
        if (requestId !== latestSuggestionRequestId.current) {
          return false;
        }
        if (!response.ok) {
          const baseMessage = readApiErrorMessage(payload, `Search request failed (${response.status})`);
          throw new Error(apiRequestId ? `${baseMessage} (request ${apiRequestId})` : baseMessage);
        }
        const nextSuggestions = Array.isArray(payload) ? payload : [];
        const resolvedSuggestions = mergeSuggestionBuckets(
          [getStoredSuggestionsForQuery(query), rankAndDeduplicateSuggestions(nextSuggestions, query)],
          8,
        );
        setSuggestions(resolvedSuggestions);
        if (resolvedSuggestions[0]) {
          selectSuggestion(resolvedSuggestions[0]);
          return true;
        }
        setShowSuggestions(true);
        setActiveSuggestionIndex(-1);
        return false;
      } catch (err) {
        if (requestId !== latestSuggestionRequestId.current) {
          return false;
        }
        console.error('Search submit error:', err);
        const fallbackSuggestions = mergeSuggestionBuckets([getStoredSuggestionsForQuery(query), getLocalPopularSuggestions(query)], 8);
        setSuggestions(fallbackSuggestions);
        if (fallbackSuggestions[0]) {
          selectSuggestion(fallbackSuggestions[0]);
          return true;
        }
        setShowSuggestions(true);
        setActiveSuggestionIndex(-1);
        return false;
      } finally {
        setSearchLoading(false);
      }
    },
    [getStoredSuggestionsForQuery, recordRecentSuggestion, selectSuggestion, setSearchQuery, updateObjectivePosition],
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQueryState(value);
    setActiveSuggestionIndex(-1);

    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
    }

    if (value.length > 0) {
      setShowSuggestions(true);
      searchTimeout.current = setTimeout(() => {
        void fetchSuggestions(value);
      }, SEARCH_DEBOUNCE_MS);
    } else {
      void fetchSuggestions('');
    }
  }, [fetchSuggestions]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowSuggestions(false);
      setActiveSuggestionIndex(-1);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!showSuggestions) {
        setShowSuggestions(true);
      }
      if (suggestions.length > 0) {
        setActiveSuggestionIndex((prev: number) => (prev < 0 ? 0 : (prev + 1) % suggestions.length));
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (suggestions.length > 0) {
        setActiveSuggestionIndex((prev: number) => {
          if (prev < 0) {
            return suggestions.length - 1;
          }
          return prev === 0 ? suggestions.length - 1 : prev - 1;
        });
      }
      return;
    }

    if (e.key !== 'Enter') {
      return;
    }

    e.preventDefault();
    const liveQuery = searchQuery;
    const suggestionsMatchLiveQuery =
      normalizeSuggestionText(liveQuery) === normalizeSuggestionText(suggestionsQueryRef.current);

    if (suggestionsMatchLiveQuery && activeSuggestionIndex >= 0 && suggestions[activeSuggestionIndex]) {
      selectSuggestion(suggestions[activeSuggestionIndex]);
      return;
    }

    if (suggestionsMatchLiveQuery && suggestions.length > 0) {
      selectSuggestion(suggestions[0]);
      return;
    }

    void searchAndSelectFirst(liveQuery);
  }, [activeSuggestionIndex, searchAndSelectFirst, searchQuery, selectSuggestion, showSuggestions, suggestions]);

  const handleSearchSubmit = useCallback(() => {
    const liveQuery = searchQuery;
    const suggestionsMatchLiveQuery =
      normalizeSuggestionText(liveQuery) === normalizeSuggestionText(suggestionsQueryRef.current);
    if (!liveQuery.trim()) {
      setShowSuggestions(true);
      setActiveSuggestionIndex(-1);
      if (!suggestions.length && !searchLoading) {
        void fetchSuggestions('');
      }
      return;
    }
    if (suggestionsMatchLiveQuery && activeSuggestionIndex >= 0 && suggestions[activeSuggestionIndex]) {
      selectSuggestion(suggestions[activeSuggestionIndex]);
      return;
    }
    if (suggestionsMatchLiveQuery && suggestions.length > 0) {
      selectSuggestion(suggestions[0]);
      return;
    }
    setCommittedSearchQuery(liveQuery.trim());
    void searchAndSelectFirst(liveQuery);
  }, [activeSuggestionIndex, fetchSuggestions, searchAndSelectFirst, searchLoading, searchQuery, selectSuggestion, suggestions]);

  const handleFocus = useCallback(() => {
    setShowSuggestions(true);
    setActiveSuggestionIndex(-1);
    const liveQuery = searchQuery;
    if (!liveQuery) {
      void fetchSuggestions('');
      return;
    }

    if (!suggestions.length && !searchLoading) {
      void fetchSuggestions(liveQuery);
    }
  }, [fetchSuggestions, searchLoading, searchQuery, suggestions.length]);

  const handleSearchClear = useCallback(() => {
    setSearchQuery('');
    setCommittedSearchQuery('');
    setActiveSuggestionIndex(-1);
    setShowSuggestions(true);
    void fetchSuggestions('');
  }, [fetchSuggestions, setSearchQuery]);

  const handleToggleSaveObjective = useCallback((params: { hasObjective: boolean; objectiveName: string; position: L.LatLng }) => {
    if (!params.hasObjective) {
      return;
    }
    const fallbackName = (params.objectiveName || `${params.position.lat.toFixed(4)}, ${params.position.lng.toFixed(4)}`).trim();
    const normalized = normalizeStoredSuggestion(
      { name: fallbackName, lat: params.position.lat, lon: params.position.lng, class: 'saved', type: 'objective' },
      'saved',
    );
    if (!normalized) {
      return;
    }
    const nextCoordinateKey = suggestionCoordinateKey(normalized.lat, normalized.lon);
    const exists = savedObjectives.some(
      (saved) => suggestionCoordinateKey(saved.lat, saved.lon) === nextCoordinateKey,
    );
    const nextSaved = exists
      ? savedObjectives.filter((saved) => suggestionCoordinateKey(saved.lat, saved.lon) !== nextCoordinateKey)
      : mergeSuggestionBuckets(
          [[{ ...normalized, class: 'saved' }], savedObjectives.map((item) => ({ ...item, class: 'saved' }))],
          MAX_SAVED_OBJECTIVES,
        );
    persistSavedObjectiveList(nextSaved);
  }, [persistSavedObjectiveList, savedObjectives]);

  const objectiveIsSaved = useCallback((lat: number, lng: number) => {
    const coordinateKey = suggestionCoordinateKey(lat, lng);
    return savedObjectives.some((item) => suggestionCoordinateKey(item.lat, item.lon) === coordinateKey);
  }, [savedObjectives]);

  const trimmedSearchQuery = searchQuery.trim();
  const parsedTypedCoordinates = parseCoordinates(trimmedSearchQuery);

  const clearSuggestionCache = useCallback(() => {
    suggestionCacheRef.current.clear();
  }, []);

  // Clear suggestion cache when stored suggestions change
  useEffect(() => {
    suggestionCacheRef.current.clear();
  }, [savedObjectives, recentSearches]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      latestSuggestionRequestId.current += 1;
      if (suggestionAbortControllerRef.current) {
        suggestionAbortControllerRef.current.abort();
        suggestionAbortControllerRef.current = null;
      }
      if (searchTimeout.current) {
        clearTimeout(searchTimeout.current);
      }
    };
  }, []);

  // Click outside to close suggestions
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!searchWrapperRef.current) {
        return;
      }
      const target = event.target;
      if (target instanceof Node && searchWrapperRef.current.contains(target)) {
        return;
      }
      setShowSuggestions(false);
      setActiveSuggestionIndex(-1);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, []);

  // "/" hotkey to focus search
  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      searchInputRef.current?.focus();
      setShowSuggestions(true);
      if (!searchQuery.trim()) {
        void fetchSuggestions('');
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  }, [fetchSuggestions, searchQuery]);

  return {
    searchQuery,
    setSearchQuery,
    committedSearchQuery,
    setCommittedSearchQuery,
    suggestions,
    setSuggestions,
    showSuggestions,
    setShowSuggestions,
    searchLoading,
    activeSuggestionIndex,
    setActiveSuggestionIndex,
    searchInputRef,
    searchWrapperRef,
    savedObjectives,
    recentSearches,
    fetchSuggestions,
    selectSuggestion,
    searchAndSelectFirst,
    handleInputChange,
    handleSearchKeyDown,
    handleSearchSubmit,
    handleFocus,
    handleSearchClear,
    handleUseTypedCoordinates,
    handleToggleSaveObjective,
    recordRecentSuggestion,
    persistSavedObjectiveList,
    objectiveIsSaved,
    parsedTypedCoordinates,
    clearSuggestionCache,
  };
}
