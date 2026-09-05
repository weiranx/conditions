import { useState, useCallback } from 'react';
import { fetchApi } from '../lib/api-client';
import type { UserPreferences } from '../app/types';
import { buildTripForecastDays, type MultiDayTripForecastDay } from '../app/trip-forecast';
export type { MultiDayTripForecastDay } from '../app/trip-forecast';
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
  const [tripForecastRows, setTripForecastRows] = useState<MultiDayTripForecastDay[]>([]);
  const [tripForecastLoading, setTripForecastLoading] = useState(false);
  const [tripForecastError, setTripForecastError] = useState<string | null>(null);
  const [tripForecastNote, setTripForecastNote] = useState<string | null>(null);

  const runTripForecast = useCallback(async () => {
    if (!hasObjective) {
      setTripForecastRows([]);
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
      setTripForecastRows([]);
      setTripForecastError('At least two forecast dates are required. Choose an earlier start date.');
      setTripForecastNote(null);
      return;
    }

    setTripForecastLoading(true);
    setTripForecastError(null);
    setTripForecastNote(null);

    try {
      const { response, payload } = await fetchApi('/api/trip-forecasts', {
        method: 'POST',
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
          travelWindowHours: safeTravelWindowHours,
          objectiveName,
        }),
      });
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
        setTripForecastRows([]);
        setTripForecastError(message);
        setTripForecastNote(null);
        return;
      }
      const serverDays = Array.isArray(responseRecord?.days) ? responseRecord.days : [];
      const rows = buildTripForecastDays(serverDays, dates, safeStartTime, safeTravelWindowHours, preferences);
      const failedCount = dates.length - rows.length;
      if (rows.length === 0) {
        setTripForecastRows([]);
        setTripForecastError('Could not load multi-day forecasts right now. Try again in a moment.');
        setTripForecastNote(null);
        return;
      }

      setTripForecastRows(rows);
      if (failedCount > 0) {
        setTripForecastNote(`${failedCount} day(s) could not be loaded and were skipped.`);
      } else if (rows.length < safeDurationDays) {
        setTripForecastNote(`Only ${rows.length} day(s) are available inside the current forecast range.`);
      } else {
        setTripForecastNote(null);
      }
    } catch {
      setTripForecastRows([]);
      setTripForecastError('Could not load multi-day forecasts right now. Try again in a moment.');
      setTripForecastNote(null);
    } finally {
      setTripForecastLoading(false);
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
  ]);

  return {
    tripStartDate,
    setTripStartDate,
    tripStartTime,
    setTripStartTime,
    tripDurationDays,
    setTripDurationDays,
    tripForecastRows,
    setTripForecastRows,
    tripForecastLoading,
    tripForecastError,
    setTripForecastError,
    tripForecastNote,
    setTripForecastNote,
    runTripForecast,
  };
}
