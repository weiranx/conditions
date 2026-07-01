import { useState, useCallback, useRef, useEffect } from 'react';
import { fetchApi, readApiErrorMessage, fetchAiBrief, fetchSnowVisionAnalysis } from '../lib/api-client';
import type { SafetyData, UserPreferences, DecisionLevel } from '../app/types';
import {
  DATE_FMT,
  BACKEND_WAKE_RETRY_DELAY_MS,
  BACKEND_WAKE_RETRY_MAX_ATTEMPTS,
  MIN_TRAVEL_WINDOW_HOURS,
  MAX_TRAVEL_WINDOW_HOURS,
} from '../app/constants';
import { parseTimeInputMinutes } from '../app/core';
import { buildSafetyRequestKey } from '../app/url-state';

export interface UseSafetyDataParams {
  todayDate: string;
  preferences: UserPreferences;
  isProductionBuild: boolean;
  objectiveNameRef: React.RefObject<string>;
}

export interface UseSafetyDataReturn {
  safetyData: SafetyData | null;
  setSafetyData: React.Dispatch<React.SetStateAction<SafetyData | null>>;
  loading: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  aiBriefNarrative: string | null;
  setAiBriefNarrative: React.Dispatch<React.SetStateAction<string | null>>;
  aiBriefLoading: boolean;
  setAiBriefLoading: React.Dispatch<React.SetStateAction<boolean>>;
  aiBriefError: string | null;
  setAiBriefError: React.Dispatch<React.SetStateAction<string | null>>;
  snowVisionAnalysis: string | null;
  setSnowVisionAnalysis: React.Dispatch<React.SetStateAction<string | null>>;
  snowVisionLoading: boolean;
  setSnowVisionLoading: React.Dispatch<React.SetStateAction<boolean>>;
  snowVisionError: string | null;
  setSnowVisionError: React.Dispatch<React.SetStateAction<string | null>>;
  handleRequestSnowVision: (lat: number, lon: number, snowpack?: SafetyData['snowpack']) => Promise<void>;
  fetchSafetyData: (
    lat: number,
    lon: number,
    date: string,
    startTime: string,
    options?: { force?: boolean },
  ) => Promise<void>;
  clearLastLoadedKey: () => void;
  clearWakeRetry: () => void;
  handleRequestAiBrief: (params: {
    safetyData: SafetyData;
    decisionLevel: DecisionLevel;
  }) => Promise<void>;
}

export function useSafetyData({
  todayDate,
  preferences,
  isProductionBuild,
  objectiveNameRef,
}: UseSafetyDataParams): UseSafetyDataReturn {
  const [safetyData, setSafetyData] = useState<SafetyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiBriefNarrative, setAiBriefNarrative] = useState<string | null>(null);
  const [aiBriefLoading, setAiBriefLoading] = useState(false);
  const [aiBriefError, setAiBriefError] = useState<string | null>(null);
  const [snowVisionAnalysis, setSnowVisionAnalysis] = useState<string | null>(null);
  const [snowVisionLoading, setSnowVisionLoading] = useState(false);
  const [snowVisionError, setSnowVisionError] = useState<string | null>(null);

  const lastLoadedSafetyKeyRef = useRef<string | null>(null);
  const inFlightSafetyKeyRef = useRef<string | null>(null);
  const pendingSafetyRequestRef = useRef<{
    lat: number;
    lon: number;
    date: string;
    startTime: string;
    travelWindowHours: number;
    force: boolean;
  } | null>(null);
  const fetchSafetyDataRef = useRef<
    ((lat: number, lon: number, date: string, startTime: string, options?: { force?: boolean }) => Promise<void>) | null
  >(null);
  const wakeRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeRetryStateRef = useRef<{
    key: string;
    lat: number;
    lon: number;
    date: string;
    startTime: string;
    attempts: number;
  } | null>(null);
  // Tracks the controller for whichever /api/safety request is currently
  // in flight, so a newer request (or unmount) can cancel it instead of
  // letting an abandoned fetch keep running in the background.
  const safetyAbortControllerRef = useRef<AbortController | null>(null);

  const clearWakeRetry = useCallback(() => {
    if (wakeRetryTimeoutRef.current) {
      clearTimeout(wakeRetryTimeoutRef.current);
      wakeRetryTimeoutRef.current = null;
    }
    wakeRetryStateRef.current = null;
  }, []);

  const isRetriableWakeupError = useCallback((message: string) => {
    const normalized = String(message || '').toLowerCase();
    if (!normalized) {
      return false;
    }
    return (
      normalized.includes('failed to fetch') ||
      normalized.includes('networkerror') ||
      normalized.includes('network request failed') ||
      normalized.includes('timeout') ||
      /\(\s*5\d\d\s*\)/.test(normalized) ||
      normalized.includes('unable to reach backend api')
    );
  }, []);

  const scheduleWakeRetry = useCallback((payload: { key: string; lat: number; lon: number; date: string; startTime: string }) => {
    if (!isProductionBuild) {
      return;
    }

    const existing = wakeRetryStateRef.current;
    const attempts = existing && existing.key === payload.key ? existing.attempts + 1 : 1;
    if (attempts > BACKEND_WAKE_RETRY_MAX_ATTEMPTS) {
      clearWakeRetry();
      return;
    }

    wakeRetryStateRef.current = { ...payload, attempts };
    if (wakeRetryTimeoutRef.current) {
      clearTimeout(wakeRetryTimeoutRef.current);
      wakeRetryTimeoutRef.current = null;
    }

    wakeRetryTimeoutRef.current = setTimeout(async () => {
      const state = wakeRetryStateRef.current;
      if (!state || state.key !== payload.key) {
        return;
      }

      let backendHealthy = false;
      try {
        const { response, payload: healthPayload } = await fetchApi('/api/healthz');
        backendHealthy = response.ok && Boolean((healthPayload as { ok?: boolean } | null)?.ok);
      } catch {
        backendHealthy = false;
      }

      if (backendHealthy) {
        clearWakeRetry();
        const fetchFn = fetchSafetyDataRef.current;
        if (fetchFn) {
          void fetchFn(state.lat, state.lon, state.date, state.startTime, { force: true });
        }
        return;
      }

      scheduleWakeRetry(payload);
    }, BACKEND_WAKE_RETRY_DELAY_MS);
  }, [clearWakeRetry, isProductionBuild]);

  const fetchSafetyData = useCallback(
    async (lat: number, lon: number, date: string, startTime: string, options?: { force?: boolean }) => {
      const safeDate = DATE_FMT.test(date) ? date : todayDate;
      const safeStartTime = parseTimeInputMinutes(startTime) === null ? preferences.defaultStartTime : startTime;
      const safeTravelWindowHours = Math.max(
        MIN_TRAVEL_WINDOW_HOURS,
        Math.min(MAX_TRAVEL_WINDOW_HOURS, Math.round(Number(preferences.travelWindowHours) || 12)),
      );
      const requestKey = buildSafetyRequestKey(lat, lon, safeDate, safeStartTime, safeTravelWindowHours);
      const forceReload = options?.force === true;

      if (wakeRetryStateRef.current?.key && wakeRetryStateRef.current.key !== requestKey) {
        clearWakeRetry();
      }

      if (!forceReload && lastLoadedSafetyKeyRef.current === requestKey) {
        return;
      }
      if (inFlightSafetyKeyRef.current) {
        pendingSafetyRequestRef.current = {
          lat,
          lon,
          date: safeDate,
          startTime: safeStartTime,
          travelWindowHours: safeTravelWindowHours,
          force: forceReload,
        };
        // A newer request has superseded the one currently in flight — abort
        // it immediately rather than letting it run to completion only to
        // have its result discarded.
        safetyAbortControllerRef.current?.abort();
        return;
      }
      setLoading(true);
      setError(null);
      inFlightSafetyKeyRef.current = requestKey;
      const controller = new AbortController();
      safetyAbortControllerRef.current = controller;

      try {
        const { response, payload, requestId } = await fetchApi(
          `/api/safety?lat=${lat}&lon=${lon}&date=${encodeURIComponent(safeDate)}&start=${encodeURIComponent(
            safeStartTime,
          )}&travel_window_hours=${safeTravelWindowHours}&name=${encodeURIComponent(objectiveNameRef.current)}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          const baseMessage = readApiErrorMessage(payload, `Safety API request failed (${response.status})`);
          throw new Error(requestId ? `${baseMessage} (request ${requestId})` : baseMessage);
        }

        if (!payload || typeof payload !== 'object') {
          const emptyResponseMsg = 'Safety API returned an empty or invalid response.';
          throw new Error(requestId ? `${emptyResponseMsg} (request ${requestId})` : emptyResponseMsg);
        }

        const pending = pendingSafetyRequestRef.current;
        const pendingRequestKey = pending
          ? buildSafetyRequestKey(
              pending.lat,
              pending.lon,
              pending.date,
              pending.startTime,
              pending.travelWindowHours,
            )
          : null;
        if (!pendingRequestKey || pendingRequestKey === requestKey) {
          setSafetyData(payload as SafetyData);
          setAiBriefNarrative(null);
          setAiBriefLoading(false);
          setAiBriefError(null);
          setSnowVisionAnalysis(null);
          setSnowVisionLoading(false);
          setSnowVisionError(null);
          lastLoadedSafetyKeyRef.current = requestKey;
          if (wakeRetryStateRef.current?.key === requestKey) {
            clearWakeRetry();
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // Superseded by a newer request or the component unmounted —
          // not a real failure, so don't surface an error or schedule a
          // wake retry.
          return;
        }
        const message = err instanceof Error ? err.message : 'System error';
        setError(message);
        if (isRetriableWakeupError(message)) {
          scheduleWakeRetry({ key: requestKey, lat, lon, date: safeDate, startTime: safeStartTime });
        }
      } finally {
        if (safetyAbortControllerRef.current === controller) {
          safetyAbortControllerRef.current = null;
        }
        inFlightSafetyKeyRef.current = null;
        setLoading(false);
        const pending = pendingSafetyRequestRef.current;
        pendingSafetyRequestRef.current = null;
        if (pending) {
          const nextFetch = fetchSafetyDataRef.current;
          if (nextFetch) {
            void nextFetch(pending.lat, pending.lon, pending.date, pending.startTime, { force: pending.force });
          }
        }
      }
    },
    [todayDate, preferences.defaultStartTime, preferences.travelWindowHours, isRetriableWakeupError, scheduleWakeRetry, clearWakeRetry, objectiveNameRef],
  );

  useEffect(() => {
    fetchSafetyDataRef.current = fetchSafetyData;
  }, [fetchSafetyData]);

  useEffect(() => {
    return () => {
      clearWakeRetry();
      safetyAbortControllerRef.current?.abort();
    };
  }, [clearWakeRetry]);

  const clearLastLoadedKey = useCallback(() => {
    lastLoadedSafetyKeyRef.current = null;
  }, []);

  const handleRequestAiBrief = useCallback(async (params: {
    safetyData: SafetyData;
    decisionLevel: DecisionLevel;
  }) => {
    if (aiBriefLoading) return;
    setAiBriefLoading(true);
    setAiBriefError(null);
    try {
      const result = await fetchAiBrief({
        decisionLevel: params.decisionLevel,
        report: params.safetyData,
      });
      setAiBriefNarrative(result.narrative);
    } catch (err) {
      setAiBriefError(err instanceof Error ? err.message : 'AI brief unavailable');
    } finally {
      setAiBriefLoading(false);
    }
  }, [aiBriefLoading]);

  const handleRequestSnowVision = useCallback(async (lat: number, lon: number, snowpack?: SafetyData['snowpack']) => {
    if (snowVisionLoading) return;
    setSnowVisionLoading(true);
    setSnowVisionError(null);
    try {
      const result = await fetchSnowVisionAnalysis(lat, lon, snowpack);
      setSnowVisionAnalysis(result.analysis);
    } catch (err) {
      setSnowVisionError(err instanceof Error ? err.message : 'Satellite snow analysis unavailable');
    } finally {
      setSnowVisionLoading(false);
    }
  }, [snowVisionLoading]);

  return {
    safetyData,
    setSafetyData,
    loading,
    error,
    setError,
    aiBriefNarrative,
    setAiBriefNarrative,
    aiBriefLoading,
    setAiBriefLoading,
    aiBriefError,
    setAiBriefError,
    snowVisionAnalysis,
    setSnowVisionAnalysis,
    snowVisionLoading,
    setSnowVisionLoading,
    snowVisionError,
    setSnowVisionError,
    handleRequestSnowVision,
    fetchSafetyData,
    clearLastLoadedKey,
    clearWakeRetry,
    handleRequestAiBrief,
  };
}
