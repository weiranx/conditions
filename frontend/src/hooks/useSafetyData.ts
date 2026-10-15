import { useState, useCallback, useRef, useEffect } from 'react';
import { fetchApi, readApiErrorMessage, fetchAiBrief, fetchAiOpening, fetchSnowVisionAnalysis } from '../lib/api-client';
import type { AiBriefDetails, AiBriefHero, AiReadRun, SafetyData, SnowVisionImagery, UserPreferences, DecisionLevel } from '../app/types';
import {
  DATE_FMT,
  BACKEND_WAKE_RETRY_DELAY_MS,
  BACKEND_WAKE_RETRY_MAX_ATTEMPTS,
  MIN_TRAVEL_WINDOW_HOURS,
  MAX_TRAVEL_WINDOW_HOURS,
} from '../app/constants';
import { parseTimeInputMinutes } from '../app/core';
import { buildSafetyRequestKey } from '../app/url-state';
import { parseAiBriefSatellite } from '../app/report-storage';

export interface UseSafetyDataParams {
  todayDate: string;
  preferences: UserPreferences;
  isProductionBuild: boolean;
  objectiveNameRef: React.RefObject<string>;
  /** Extra query string (without a leading "&"), e.g. the approach inputs for comfort scoring. */
  extraQueryRef?: React.RefObject<string>;
  onNewReportGenerated?: () => void;
  initialSafetyData?: SafetyData | null;
  initialAiBriefNarrative?: string | null;
  initialAiBriefDetails?: AiBriefDetails | null;
  initialSnowVisionAnalysis?: string | null;
  initialSnowVisionImage?: string | null;
  initialSnowVisionImagery?: SnowVisionImagery | null;
}

export interface SafetyFetchOptions {
  force?: boolean;
  countAsNewReport?: boolean;
}

export interface UseSafetyDataReturn {
  safetyData: SafetyData | null;
  setSafetyData: React.Dispatch<React.SetStateAction<SafetyData | null>>;
  loading: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  aiBriefNarrative: string | null;
  setAiBriefNarrative: React.Dispatch<React.SetStateAction<string | null>>;
  /** Citations and questions for the current narrative, or null when it has none. */
  aiBriefDetails: AiBriefDetails | null;
  setAiBriefDetails: React.Dispatch<React.SetStateAction<AiBriefDetails | null>>;
  aiBriefLoading: boolean;
  /** Setting it to false also drops any read still being written, so its answer can't land on another report. */
  setAiBriefLoading: React.Dispatch<React.SetStateAction<boolean>>;
  /** The read being written, or the last one written, for the report on screen. */
  aiReadRun: AiReadRun | null;
  aiBriefError: string | null;
  setAiBriefError: React.Dispatch<React.SetStateAction<string | null>>;
  snowVisionAnalysis: string | null;
  setSnowVisionAnalysis: React.Dispatch<React.SetStateAction<string | null>>;
  snowVisionImage: string | null;
  setSnowVisionImage: React.Dispatch<React.SetStateAction<string | null>>;
  /** The pass the current analysis read, or null when it has none. */
  snowVisionImagery: SnowVisionImagery | null;
  setSnowVisionImagery: (value: { analysis: string | null; imagery: SnowVisionImagery | null }) => void;
  snowVisionLoading: boolean;
  /** Setting it to false also drops any analysis still being written, so its answer can't land on another report. */
  setSnowVisionLoading: React.Dispatch<React.SetStateAction<boolean>>;
  snowVisionError: string | null;
  setSnowVisionError: React.Dispatch<React.SetStateAction<string | null>>;
  handleRequestSnowVision: (lat: number, lon: number, snowpack?: SafetyData['snowpack']) => Promise<void>;
  fetchSafetyData: (
    lat: number,
    lon: number,
    date: string,
    startTime: string,
    options?: SafetyFetchOptions,
  ) => Promise<void>;
  clearLastLoadedKey: () => void;
  clearWakeRetry: () => void;
  handleRequestAiBrief: (params: {
    safetyData: SafetyData;
    decisionLevel: DecisionLevel;
    /** The analyzed route, sent alongside the report when there is one. */
    route?: unknown;
    /** Also ask a fast model for the report's opening, shown as soon as it is written. */
    opening?: boolean;
  }) => Promise<void>;
}

export function useSafetyData({
  todayDate,
  preferences,
  isProductionBuild,
  objectiveNameRef,
  extraQueryRef,
  onNewReportGenerated,
  initialSafetyData = null,
  initialAiBriefNarrative = null,
  initialAiBriefDetails = null,
  initialSnowVisionAnalysis = null,
  initialSnowVisionImage = null,
  initialSnowVisionImagery = null,
}: UseSafetyDataParams): UseSafetyDataReturn {
  const [safetyData, setSafetyData] = useState<SafetyData | null>(initialSafetyData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiBriefNarrative, setAiBriefNarrative] = useState<string | null>(initialAiBriefNarrative);
  // Details carry the narrative they belong to, so clearing or replacing the
  // narrative anywhere can never leave another brief's citations showing.
  const [aiBriefDetailsState, setAiBriefDetails] = useState<AiBriefDetails | null>(initialAiBriefDetails);
  const aiBriefDetails = aiBriefDetailsState && aiBriefDetailsState.narrative === aiBriefNarrative ? aiBriefDetailsState : null;
  const [aiBriefLoading, setAiBriefLoadingState] = useState(false);
  const [aiBriefError, setAiBriefError] = useState<string | null>(null);
  const [aiReadRun, setAiReadRun] = useState<AiReadRun | null>(null);
  // Each read gets a number; a newer read, or a report replacing this one, makes
  // an older read's answers stale, so they are dropped instead of shown.
  const aiReadIdRef = useRef(0);
  const setAiBriefLoading = useCallback<React.Dispatch<React.SetStateAction<boolean>>>((value) => {
    if (value === false) {
      aiReadIdRef.current += 1;
      setAiReadRun(null);
    }
    setAiBriefLoadingState(value);
  }, []);
  const [snowVisionAnalysis, setSnowVisionAnalysis] = useState<string | null>(initialSnowVisionAnalysis);
  const [snowVisionImage, setSnowVisionImage] = useState<string | null>(initialSnowVisionImage);
  // Like the read's details, the imagery carries the analysis it belongs to, so
  // clearing or replacing the analysis anywhere can never leave another pass's date showing.
  const [snowVisionImageryState, setSnowVisionImagery] = useState<{ analysis: string | null; imagery: SnowVisionImagery | null }>(
    { analysis: initialSnowVisionAnalysis, imagery: initialSnowVisionImagery },
  );
  const snowVisionImagery = snowVisionAnalysis && snowVisionImageryState.analysis === snowVisionAnalysis ? snowVisionImageryState.imagery : null;
  const [snowVisionLoading, setSnowVisionLoadingState] = useState(false);
  const [snowVisionError, setSnowVisionError] = useState<string | null>(null);
  const snowVisionIdRef = useRef(0);
  const setSnowVisionLoading = useCallback<React.Dispatch<React.SetStateAction<boolean>>>((value) => {
    if (value === false) snowVisionIdRef.current += 1;
    setSnowVisionLoadingState(value);
  }, []);

  const lastLoadedSafetyKeyRef = useRef<string | null>(null);
  const inFlightSafetyKeyRef = useRef<string | null>(null);
  const pendingSafetyRequestRef = useRef<{
    lat: number;
    lon: number;
    date: string;
    startTime: string;
    travelWindowHours: number;
    activity: string;
    force: boolean;
    countAsNewReport: boolean;
  } | null>(null);
  const fetchSafetyDataRef = useRef<
    ((lat: number, lon: number, date: string, startTime: string, options?: SafetyFetchOptions) => Promise<void>) | null
  >(null);
  const wakeRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeRetryStateRef = useRef<{
    key: string;
    lat: number;
    lon: number;
    date: string;
    startTime: string;
    attempts: number;
    countAsNewReport: boolean;
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

  const scheduleWakeRetry = useCallback((payload: {
    key: string;
    lat: number;
    lon: number;
    date: string;
    startTime: string;
    countAsNewReport: boolean;
  }) => {
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

      // Clearing or replacing a retry also invalidates a health check that was
      // already in flight, including one for the same objective and time.
      if (wakeRetryStateRef.current !== state) {
        return;
      }

      if (backendHealthy) {
        clearWakeRetry();
        const fetchFn = fetchSafetyDataRef.current;
        if (fetchFn) {
          void fetchFn(state.lat, state.lon, state.date, state.startTime, {
            force: true,
            countAsNewReport: state.countAsNewReport,
          });
        }
        return;
      }

      scheduleWakeRetry(payload);
    }, BACKEND_WAKE_RETRY_DELAY_MS);
  }, [clearWakeRetry, isProductionBuild]);

  const fetchSafetyData = useCallback(
    async (lat: number, lon: number, date: string, startTime: string, options?: SafetyFetchOptions) => {
      const safeDate = DATE_FMT.test(date) ? date : todayDate;
      const safeStartTime = parseTimeInputMinutes(startTime) === null ? preferences.defaultStartTime : startTime;
      const safeTravelWindowHours = Math.max(
        MIN_TRAVEL_WINDOW_HOURS,
        Math.min(MAX_TRAVEL_WINDOW_HOURS, Math.round(Number(preferences.travelWindowHours) || 12)),
      );
      const activity = preferences.defaultActivity;
      const requestKey = buildSafetyRequestKey(lat, lon, safeDate, safeStartTime, safeTravelWindowHours, activity);
      const forceReload = options?.force === true;
      const countAsNewReport = options?.countAsNewReport === true;

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
          activity,
          force: forceReload,
          countAsNewReport,
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
          )}&travel_window_hours=${safeTravelWindowHours}&activity=${encodeURIComponent(activity)}&name=${encodeURIComponent(objectiveNameRef.current)}${
            extraQueryRef?.current ? `&${extraQueryRef.current}` : ''
          }`,
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
              pending.activity,
            )
          : null;
        if (!pendingRequestKey || pendingRequestKey === requestKey) {
          setSafetyData(payload as SafetyData);
          setAiBriefNarrative(null);
          setAiBriefLoading(false);
          setAiBriefError(null);
          setSnowVisionAnalysis(null);
          setSnowVisionImage(null);
          setSnowVisionLoading(false);
          setSnowVisionError(null);
          lastLoadedSafetyKeyRef.current = requestKey;
          if (countAsNewReport) {
            onNewReportGenerated?.();
          }
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
          scheduleWakeRetry({
            key: requestKey,
            lat,
            lon,
            date: safeDate,
            startTime: safeStartTime,
            countAsNewReport,
          });
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
            void nextFetch(pending.lat, pending.lon, pending.date, pending.startTime, {
              force: pending.force,
              countAsNewReport: pending.countAsNewReport,
            });
          }
        }
      }
    },
    [todayDate, preferences.defaultStartTime, preferences.travelWindowHours, preferences.defaultActivity, isRetriableWakeupError, scheduleWakeRetry, clearWakeRetry, objectiveNameRef, extraQueryRef, onNewReportGenerated, setAiBriefLoading, setSnowVisionLoading],
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
    route?: unknown;
    opening?: boolean;
  }) => {
    if (aiBriefLoading) return;
    const id = aiReadIdRef.current + 1;
    aiReadIdRef.current = id;
    const current = () => aiReadIdRef.current === id;
    const startedAt = Date.now();
    const secondsSince = () => Math.round((Date.now() - startedAt) / 1000);
    setAiBriefLoadingState(true);
    setAiBriefError(null);
    setAiReadRun({ startedAt, opening: params.opening ? 'pending' : 'off', hero: null, openingSeconds: null, seconds: null });
    const request = {
      decisionLevel: params.decisionLevel,
      report: {
        ...params.safetyData,
        ...(params.route ? { route: params.route } : {}),
      },
      units: {
        temperature: preferences.temperatureUnit,
        wind: preferences.windSpeedUnit,
        elevation: preferences.elevationUnit,
      },
    };
    // The opening the reader has already seen; the full read keeps it rather than
    // changing the top of the report a second time.
    let openingHero: AiBriefHero | null = null;
    if (params.opening) {
      // The opening goes first and alone: the full read starts only once it has
      // answered or failed, so no other AI request competes with the top of the report.
      try {
        const result = await fetchAiOpening(request);
        if (!current()) return;
        const hero = result.hero && typeof result.hero.headline === 'string' && typeof result.hero.reason === 'string' ? result.hero : null;
        openingHero = hero;
        setAiReadRun((run) => run && { ...run, opening: hero ? 'written' : 'kept', hero, openingSeconds: secondsSince() });
      } catch {
        if (!current()) return;
        setAiReadRun((run) => run && { ...run, opening: 'kept', openingSeconds: secondsSince() });
      }
    }
    try {
      const result = await fetchAiBrief(request);
      if (!current()) return;
      const readHero = result.hero === undefined
        ? undefined
        : result.hero && typeof result.hero.headline === 'string' && typeof result.hero.reason === 'string' ? result.hero : null;
      const hero = openingHero ?? readHero;
      setAiBriefNarrative(result.narrative);
      const satellite = parseAiBriefSatellite(result.satellite);
      setAiBriefDetails({
        narrative: result.narrative,
        evidence: Array.isArray(result.evidence) ? result.evidence : [],
        questions: Array.isArray(result.questions) ? result.questions.filter((q) => typeof q === 'string').slice(0, 3) : [],
        chapters: result.chapters && typeof result.chapters === 'object' ? result.chapters : {},
        ...(result.checks && Array.isArray(result.checks.problems) ? {
          checks: {
            attempts: Number(result.checks.attempts) || 1,
            problems: result.checks.problems.filter((problem): problem is string => typeof problem === 'string'),
            ...(Array.isArray(result.checks.seconds) ? { seconds: result.checks.seconds.filter((second): second is number => typeof second === 'number') } : {}),
          },
        } : {}),
        ...(hero === undefined ? {} : { hero }),
        ...(satellite ? { satellite } : {}),
        validation: result.validation ?? null,
      });
      setAiReadRun((run) => run && {
        ...run,
        opening: run.opening === 'pending' ? (hero ? 'written' : 'kept') : run.opening,
        hero: hero ?? null,
        seconds: secondsSince(),
      });
    } catch (err) {
      if (!current()) return;
      setAiBriefError(err instanceof Error ? err.message : 'AI brief unavailable');
      // An opening already written stays.
      setAiReadRun((run) => run && (run.opening === 'pending' ? { ...run, opening: 'kept' } : run));
    } finally {
      if (current()) setAiBriefLoadingState(false);
    }
  }, [aiBriefLoading, preferences.temperatureUnit, preferences.windSpeedUnit, preferences.elevationUnit]);

  const handleRequestSnowVision = useCallback(async (lat: number, lon: number, snowpack?: SafetyData['snowpack']) => {
    if (snowVisionLoading) return;
    const id = snowVisionIdRef.current + 1;
    snowVisionIdRef.current = id;
    const current = () => snowVisionIdRef.current === id;
    setSnowVisionLoadingState(true);
    setSnowVisionError(null);
    try {
      const result = await fetchSnowVisionAnalysis(lat, lon, snowpack, { elevation: preferences.elevationUnit });
      if (!current()) return;
      setSnowVisionAnalysis(result.analysis);
      setSnowVisionImage(result.image ?? null);
      setSnowVisionImagery({
        analysis: result.analysis,
        imagery: result.imagery ? { acquiredAt: result.imagery.acquiredAt ?? null, cloudCover: result.imagery.cloudCover ?? null } : null,
      });
    } catch (err) {
      if (!current()) return;
      setSnowVisionError(err instanceof Error ? err.message : 'Satellite snow analysis unavailable');
    } finally {
      if (current()) setSnowVisionLoadingState(false);
    }
  }, [snowVisionLoading, preferences.elevationUnit]);

  return {
    safetyData,
    setSafetyData,
    loading,
    error,
    setError,
    aiBriefNarrative,
    setAiBriefNarrative,
    aiBriefDetails,
    setAiBriefDetails,
    aiBriefLoading,
    setAiBriefLoading,
    aiReadRun,
    aiBriefError,
    setAiBriefError,
    snowVisionAnalysis,
    setSnowVisionAnalysis,
    snowVisionImage,
    setSnowVisionImage,
    snowVisionImagery,
    setSnowVisionImagery,
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
