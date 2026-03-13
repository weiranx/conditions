import { useState, useCallback } from 'react';
import { fetchApi } from '../lib/api-client';
import type { SafetyData, UserPreferences, DecisionLevel } from '../app/types';
import { DATE_FMT, MIN_TRAVEL_WINDOW_HOURS, MAX_TRAVEL_WINDOW_HOURS } from '../app/constants';
import { addDaysToIsoDate, normalizeForecastDate } from '../app/core';
import { parseTimeInputMinutes } from '../app/core';
import { evaluateBackcountryDecision } from '../app/decision';
import { normalizeDangerLevel } from '../app/planner-helpers';
import { buildTravelWindowRows, buildTravelWindowInsights, buildTrendWindowFromStart } from '../app/travel-window';

export type MultiDayTripForecastDay = {
  date: string;
  decisionLevel: DecisionLevel;
  decisionHeadline: string;
  score: number | null;
  weatherDescription: string;
  tempF: number | null;
  feelsLikeF: number | null;
  windGustMph: number | null;
  precipChance: number | null;
  avalancheSummary: string;
  travelSummary: string;
  sourceIssuedTime: string | null;
};

export interface UseTripForecastParams {
  hasObjective: boolean;
  position: { lat: number; lng: number };
  todayDate: string;
  maxForecastDate: string;
  preferences: UserPreferences;
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
  preferences,
}: UseTripForecastParams): UseTripForecastReturn {
  const [tripStartDate, setTripStartDate] = useState(todayDate);
  const [tripStartTime, setTripStartTime] = useState(preferences.defaultStartTime);
  const [tripDurationDays, setTripDurationDays] = useState(3);
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
    const safeDurationDays = Math.max(2, Math.min(7, Math.round(Number(tripDurationDays) || 3)));
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

    if (dates.length === 0) {
      setTripForecastRows([]);
      setTripForecastError('No forecast dates available in this range. Adjust start date/duration.');
      setTripForecastNote(null);
      return;
    }

    setTripForecastLoading(true);
    setTripForecastError(null);
    setTripForecastNote(null);

    try {
      const dailyResults = await Promise.all(
        dates.map(async (date) => {
          try {
            const { response, payload } = await fetchApi(
              `/api/safety?lat=${position.lat}&lon=${position.lng}&date=${encodeURIComponent(date)}&start=${encodeURIComponent(
                safeStartTime,
              )}&travel_window_hours=${safeTravelWindowHours}`,
            );
            if (!response.ok || !payload || typeof payload !== 'object') {
              return null;
            }
            const dayData = payload as SafetyData;
            const dayDecision = evaluateBackcountryDecision(dayData, safeStartTime, preferences);
            const trendWindow = buildTrendWindowFromStart(dayData.weather?.trend || [], safeStartTime, safeTravelWindowHours);
            const travelRows = buildTravelWindowRows(trendWindow, preferences);
            const travelInsights = buildTravelWindowInsights(travelRows, preferences.timeStyle);

            const avalancheRelevant = dayData.avalanche?.relevant !== false;
            const avalancheUnknown = avalancheRelevant && Boolean(dayData.avalanche?.dangerUnknown || dayData.avalanche?.coverageStatus !== 'reported');
            const dangerLabel = ['No Rating', 'Low', 'Moderate', 'Considerable', 'High', 'Extreme'][normalizeDangerLevel(dayData.avalanche?.dangerLevel)] || 'N/A';
            const avalancheSummary = !avalancheRelevant
              ? 'Not primary'
              : avalancheUnknown
                ? 'Coverage limited'
                : `L${normalizeDangerLevel(dayData.avalanche.dangerLevel)} ${dangerLabel}`;

            const scoreRaw = Number(dayData?.safety?.score);
            const tempRaw = Number(dayData?.weather?.temp);
            const feelsRaw = Number(dayData?.weather?.feelsLike ?? dayData?.weather?.temp);
            const gustRaw = Number(dayData?.weather?.windGust);
            const precipRaw = Number(dayData?.weather?.precipChance);

            return {
              date: dayData?.forecast?.selectedDate && DATE_FMT.test(dayData.forecast.selectedDate) ? dayData.forecast.selectedDate : date,
              decisionLevel: dayDecision.level,
              decisionHeadline: dayDecision.headline,
              score: Number.isFinite(scoreRaw) ? Math.round(scoreRaw) : null,
              weatherDescription: String(dayData?.weather?.description || 'Unknown'),
              tempF: Number.isFinite(tempRaw) ? tempRaw : null,
              feelsLikeF: Number.isFinite(feelsRaw) ? feelsRaw : null,
              windGustMph: Number.isFinite(gustRaw) ? gustRaw : null,
              precipChance: Number.isFinite(precipRaw) ? Math.round(precipRaw) : null,
              avalancheSummary,
              travelSummary: `${travelInsights.passHours}/${travelRows.length}h passing`,
              sourceIssuedTime: dayData?.weather?.issuedTime || null,
            } as MultiDayTripForecastDay;
          } catch {
            return null;
          }
        }),
      );

      const rows = dailyResults.filter((entry): entry is MultiDayTripForecastDay => Boolean(entry)).sort((a, b) => a.date.localeCompare(b.date));
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
