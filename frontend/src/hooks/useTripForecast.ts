import { useState, useCallback } from 'react';
import { fetchApi } from '../lib/api-client';
import type { SafetyData, UserPreferences, DecisionLevel, WeatherTrendPoint } from '../app/types';
import { DATE_FMT, MIN_TRAVEL_WINDOW_HOURS, MAX_TRAVEL_WINDOW_HOURS } from '../app/constants';
import { addDaysToIsoDate, normalizeForecastDate } from '../app/core';
import { parseTimeInputMinutes } from '../app/core';
import { evaluateBackcountryDecision, normalizedDecisionScore } from '../app/decision';
import { buildTravelWindowRows, buildTravelWindowInsights, buildTrendWindowFromStart } from '../app/travel-window';
import { parseMultiDayUsage, type MultiDayUsage } from '../app/multi-day-usage';

export type MultiDayTripForecastDay = {
  date: string;
  decisionLevel: DecisionLevel;
  decisionHeadline: string;
  score: number | null;
  weatherDescription: string;
  tempHighF: number | null;
  tempLowF: number | null;
  windGustMph: number | null;
  windDirection: string | null;
  precipChance: number | null;
  expectedRainIn: number | null;
  expectedSnowIn: number | null;
  humidityPct: number | null;
  cloudCoverPct: number | null;
  isDaytime: boolean | null;
  travelSummary: string;
  travelPassHours: number;
  travelTotalHours: number;
  sunrise: string | null;
  sunset: string | null;
  dayLength: string | null;
  visibilityLevel: string | null;
  visibilitySummary: string | null;
  alertCount: number;
  airQualityAqi: number | null;
  airQualityCategory: string | null;
  partialData: boolean;
  apiWarning: string | null;
  sourceIssuedTime: string | null;
  hourlyWeather: WeatherTrendPoint[];
  deltas?: {
    score: number | null;
    tempHighF: number | null;
    tempLowF: number | null;
    windGustMph: number | null;
    precipChance: number | null;
  } | null;
};

const diffOrNull = (current: number | null, previous: number | null): number | null =>
  current != null && previous != null ? Math.round((current - previous) * 10) / 10 : null;

const finiteNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

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
      const dailyResults = serverDays.map((entry, index) => {
          try {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
              return null;
            }
            const dayData = entry as SafetyData;
            const fallbackDate = dates[index] || safeStartDate;
            const decisionOptions = { ignoreAvalancheForDecision: true } as const;
            const dayDecision = evaluateBackcountryDecision(dayData, safeStartTime, preferences, decisionOptions);
            const trendWindow = buildTrendWindowFromStart(dayData.weather?.trend || [], safeStartTime, safeTravelWindowHours);
            const tripSnowContext = {
              snowDepthIn: dayData.terrainCondition?.signals?.maxSnowDepthIn
                ?? dayData.snowpack?.snotel?.snowDepthIn
                ?? dayData.snowpack?.nohrsc?.snowDepthIn
                ?? null,
            };
            const travelRows = buildTravelWindowRows(trendWindow, preferences, tripSnowContext);
            const travelInsights = buildTravelWindowInsights(travelRows, preferences.timeStyle);
            const noCleanTravelHours = travelRows.length > 0 && travelInsights.passHours === 0;
            const decisionLevel = noCleanTravelHours && dayDecision.level !== 'NO-GO'
              ? 'CAUTION'
              : dayDecision.level;
            const decisionHeadline = noCleanTravelHours && dayDecision.level !== 'NO-GO'
              ? 'No travel hour meets every threshold — re-time the start, shorten the objective, or choose another day.'
              : dayDecision.headline;

            const rawSafetyScore = Number(dayData?.safety?.score);
            const scoreRaw = Number.isFinite(rawSafetyScore)
              ? normalizedDecisionScore(dayData, decisionOptions)
              : Number.NaN;
            const tempHighRaw = finiteNumberOrNull(
              dayData?.weather?.dailyTempHighF ?? dayData?.weather?.temperatureContext24h?.maxTempF,
            );
            const tempLowRaw = finiteNumberOrNull(
              dayData?.weather?.dailyTempLowF ?? dayData?.weather?.temperatureContext24h?.minTempF,
            );
            const gustRaw = Number(dayData?.weather?.windGust);
            const precipRaw = Number(dayData?.weather?.precipChance);
            const humidityRaw = finiteNumberOrNull(dayData?.weather?.humidity);
            const cloudCoverRaw = finiteNumberOrNull(dayData?.weather?.cloudCover);
            const expectedRainRaw = finiteNumberOrNull(dayData?.rainfall?.expected?.rainWindowIn);
            const expectedSnowRaw = finiteNumberOrNull(dayData?.rainfall?.expected?.snowWindowIn);
            const airQualityAqiRaw = finiteNumberOrNull(dayData?.airQuality?.forecast?.usAqi ?? dayData?.airQuality?.usAqi);
            const airQualityCategoryRaw = dayData?.airQuality?.forecast?.category || dayData?.airQuality?.category || null;
            const airQualityCategory = airQualityCategoryRaw?.trim().toLowerCase() === 'unknown'
              ? null
              : airQualityCategoryRaw;

            return {
              date: dayData?.forecast?.selectedDate && DATE_FMT.test(dayData.forecast.selectedDate) ? dayData.forecast.selectedDate : fallbackDate,
              decisionLevel,
              decisionHeadline,
              score: Number.isFinite(scoreRaw) ? Math.round(scoreRaw) : null,
              weatherDescription: String(dayData?.weather?.description || 'Unknown'),
              tempHighF: tempHighRaw,
              tempLowF: tempLowRaw,
              windGustMph: Number.isFinite(gustRaw) ? gustRaw : null,
              windDirection: dayData?.weather?.windDirection || null,
              precipChance: Number.isFinite(precipRaw) ? Math.round(precipRaw) : null,
              expectedRainIn: expectedRainRaw,
              expectedSnowIn: expectedSnowRaw,
              humidityPct: humidityRaw !== null ? Math.round(humidityRaw) : null,
              cloudCoverPct: cloudCoverRaw !== null ? Math.round(cloudCoverRaw) : null,
              isDaytime: typeof dayData?.weather?.isDaytime === 'boolean' ? dayData.weather.isDaytime : null,
              travelSummary: `${travelInsights.passHours}/${travelRows.length}h passing`,
              travelPassHours: travelInsights.passHours,
              travelTotalHours: travelRows.length,
              sunrise: dayData?.solar?.sunrise || null,
              sunset: dayData?.solar?.sunset || null,
              dayLength: dayData?.solar?.dayLength || null,
              visibilityLevel: dayData?.weather?.visibilityRisk?.level || null,
              visibilitySummary: dayData?.weather?.visibilityRisk?.summary || null,
              alertCount: Math.max(0, Math.round(Number(dayData?.alerts?.activeCount) || 0)),
              airQualityAqi: airQualityAqiRaw !== null ? Math.round(airQualityAqiRaw) : null,
              airQualityCategory,
              partialData: Boolean(dayData?.partialData),
              apiWarning: dayData?.apiWarning || null,
              sourceIssuedTime: dayData?.weather?.issuedTime || null,
              hourlyWeather: trendWindow,
            } as MultiDayTripForecastDay;
          } catch {
            return null;
          }
        });

      const rows = dailyResults.filter((entry): entry is MultiDayTripForecastDay => Boolean(entry)).sort((a, b) => a.date.localeCompare(b.date));
      // Day-over-day trend deltas relative to the previous available day.
      rows.forEach((row, idx) => {
        if (idx === 0) {
          row.deltas = null;
          return;
        }
        const prev = rows[idx - 1];
        row.deltas = {
          score: diffOrNull(row.score, prev.score),
          tempHighF: diffOrNull(row.tempHighF, prev.tempHighF),
          tempLowF: diffOrNull(row.tempLowF, prev.tempLowF),
          windGustMph: diffOrNull(row.windGustMph, prev.windGustMph),
          precipChance: diffOrNull(row.precipChance, prev.precipChance),
        };
      });
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
