import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchApi } from '../lib/api-client';
import type { MultiDayTripForecastDay, TripHighlight, TripRanking, UserPreferences } from '../app/types';
import { planSettingsParams, readTripDays } from '../app/plan-evaluation';
export type { MultiDayTripForecastDay } from '../app/types';
import { DATE_FMT, MIN_TRAVEL_WINDOW_HOURS, MAX_TRAVEL_WINDOW_HOURS } from '../app/constants';
import { addDaysToIsoDate, normalizeForecastDate } from '../app/core';
import { parseTimeInputMinutes } from '../app/core';
import { parseMultiDayUsage, type MultiDayUsage } from '../app/multi-day-usage';

export interface UseTripForecastParams {
  hasObjective: boolean;
  position: { lat: number; lng: number };
  todayDate: string;
  maxForecastDate: string;
  initialStartDate: string;
  initialStartTime: string;
  preferences: UserPreferences;
  objectiveName: string;
  onUsageUpdated?: (usage: MultiDayUsage) => void;
  onUsageLimitReached?: (usage: MultiDayUsage) => void;
}

export interface UseTripForecastReturn {
  tripStartDate: string;
  setTripStartDate: (value: string) => void;
  tripStartTime: string;
  setTripStartTime: (value: string) => void;
  tripDurationDays: number;
  setTripDurationDays: (value: number) => void;
  tripForecastRows: MultiDayTripForecastDay[];
  setTripForecastRows: (value: MultiDayTripForecastDay[]) => void;
  /** The backend's ranking of the days, best first. */
  tripRanking: TripRanking | null;
  /** Days that stand out on one measurement. */
  tripHighlights: TripHighlight[];
  /** What the trip chat reads about these days. */
  tripChatContext: unknown;
  tripForecastLoading: boolean;
  tripForecastError: string | null;
  setTripForecastError: (value: string | null) => void;
  tripForecastNote: string | null;
  setTripForecastNote: (value: string | null) => void;
  runTripForecast: () => Promise<void>;
}

export function useTripForecast({
  hasObjective,
  position,
  todayDate,
  maxForecastDate,
  initialStartDate,
  initialStartTime,
  preferences,
  objectiveName,
  onUsageUpdated,
  onUsageLimitReached,
}: UseTripForecastParams): UseTripForecastReturn {
  const [tripStartDate, setTripStartDate] = useState(initialStartDate);
  const [tripStartTime, setTripStartTime] = useState(initialStartTime);
  const [tripDurationDays, setTripDurationDays] = useState(7);
  const [tripComparison, setTripComparison] = useState<{
    days: MultiDayTripForecastDay[];
    ranking: TripRanking | null;
    highlights: TripHighlight[];
    chatContext: unknown;
  }>({ days: [], ranking: null, highlights: [], chatContext: null });
  const setTripForecastRowsState = useCallback((days: MultiDayTripForecastDay[]) => {
    setTripComparison({ days, ranking: null, highlights: [], chatContext: null });
  }, []);
  const [tripForecastLoading, setTripForecastLoading] = useState(false);
  const [tripForecastError, setTripForecastError] = useState<string | null>(null);
  const [tripForecastNote, setTripForecastNote] = useState<string | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);

  const cancelTripForecast = useCallback(() => {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setTripForecastLoading(false);
  }, []);

  // Callers clear these rows when the objective or trip inputs change. Invalidate
  // the pending request too, so its late response cannot restore the old plan.
  const setTripForecastRows = useCallback((rows: MultiDayTripForecastDay[]) => {
    cancelTripForecast();
    setTripForecastRowsState(rows);
  }, [cancelTripForecast, setTripForecastRowsState]);

  useEffect(() => () => {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
  }, []);

  const runTripForecast = useCallback(async () => {
    cancelTripForecast();
    if (!hasObjective) {
      setTripForecastRowsState([]);
      setTripForecastError('Select an objective first in Planner to run multi-day trip forecasts.');
      setTripForecastNote(null);
      return;
    }
    const safeStartDate = normalizeForecastDate(tripStartDate, todayDate, maxForecastDate);
    const safeStartTime = parseTimeInputMinutes(tripStartTime) === null ? preferences.defaultStartTime : tripStartTime;
    const safeDurationDays = Math.max(2, Math.min(7, Math.round(Number(tripDurationDays) || 7)));
    if (safeStartDate !== tripStartDate) {
      setTripStartDate(safeStartDate);
    }
    if (safeStartTime !== tripStartTime) {
      setTripStartTime(safeStartTime);
    }
    if (safeDurationDays !== tripDurationDays) {
      setTripDurationDays(safeDurationDays);
    }

    const safeTravelWindowHours = Math.max(
      MIN_TRAVEL_WINDOW_HOURS,
      Math.min(MAX_TRAVEL_WINDOW_HOURS, Math.round(Number(preferences.travelWindowHours) || 12)),
    );

    const dates: string[] = [];
    let cursor = safeStartDate;
    for (let i = 0; i < safeDurationDays; i += 1) {
      if (!DATE_FMT.test(cursor) || cursor > maxForecastDate) {
        break;
      }
      dates.push(cursor);
      cursor = addDaysToIsoDate(cursor, 1);
    }

    if (dates.length < 2) {
      setTripForecastRowsState([]);
      setTripForecastError('At least two forecast dates are required. Choose an earlier start date.');
      setTripForecastNote(null);
      return;
    }

    const controller = new AbortController();
    activeRequestRef.current = controller;
    setTripForecastLoading(true);
    setTripForecastError(null);
    setTripForecastNote(null);

    try {
      const { response, payload } = await fetchApi('/api/trip-forecasts', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          lat: position.lat,
          lon: position.lng,
          startDate: safeStartDate,
          startTime: safeStartTime,
          durationDays: dates.length,
          requestedDays: safeDurationDays,
          travelWindowHours: safeTravelWindowHours,
          activity: preferences.defaultActivity,
          objectiveName,
          plan: planSettingsParams(preferences),
        }),
      });
      if (activeRequestRef.current !== controller) return;
      const responseRecord = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : null;
      const usage = parseMultiDayUsage(responseRecord?.multiDayUsage);
      if (usage) onUsageUpdated?.(usage);
      if (!response.ok) {
        if (response.status === 429 && usage) {
          onUsageLimitReached?.(usage);
          setTripForecastError(null);
          return;
        }
        const message = typeof responseRecord?.error === 'string'
          ? responseRecord.error
          : 'Could not load multi-day forecasts right now. Try again in a moment.';
        setTripForecastRowsState([]);
        setTripForecastError(message);
        setTripForecastNote(null);
        return;
      }
      const days = readTripDays(responseRecord?.days);
      if (days.length === 0) {
        setTripForecastRowsState([]);
        setTripForecastError('Could not load multi-day forecasts right now. Try again in a moment.');
        setTripForecastNote(null);
        return;
      }
      setTripComparison({
        days,
        ranking: (responseRecord?.ranking as TripRanking | undefined) ?? null,
        highlights: Array.isArray(responseRecord?.highlights) ? responseRecord.highlights as TripHighlight[] : [],
        chatContext: responseRecord?.chatContext ?? null,
      });
      setTripForecastNote(typeof responseRecord?.note === 'string' ? responseRecord.note : null);
    } catch {
      if (activeRequestRef.current !== controller) return;
      setTripForecastRowsState([]);
      setTripForecastError('Could not load multi-day forecasts right now. Try again in a moment.');
      setTripForecastNote(null);
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
        setTripForecastLoading(false);
      }
    }
  }, [
    hasObjective,
    tripStartDate,
    tripStartTime,
    tripDurationDays,
    todayDate,
    maxForecastDate,
    preferences,
    position.lat,
    position.lng,
    objectiveName,
    onUsageLimitReached,
    onUsageUpdated,
    cancelTripForecast,
    setTripForecastRowsState,
  ]);

  return {
    tripStartDate,
    setTripStartDate,
    tripStartTime,
    setTripStartTime,
    tripDurationDays,
    setTripDurationDays,
    tripForecastRows: tripComparison.days,
    setTripForecastRows,
    tripRanking: tripComparison.ranking,
    tripHighlights: tripComparison.highlights,
    tripChatContext: tripComparison.chatContext,
    tripForecastLoading,
    tripForecastError,
    setTripForecastError,
    tripForecastNote,
    setTripForecastNote,
    runTripForecast,
  };
}
