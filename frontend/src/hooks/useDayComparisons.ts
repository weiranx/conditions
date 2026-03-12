import { useState, useEffect } from 'react';
import { fetchApi } from '../lib/api-client';
import type { SafetyData, UserPreferences, DecisionLevel, DayOverDayComparison } from '../app/types';
import { DATE_FMT, MIN_TRAVEL_WINDOW_HOURS, MAX_TRAVEL_WINDOW_HOURS } from '../app/constants';
import { addDaysToIsoDate } from '../app/core';
import {
  decisionLevelRank,
  normalizedDecisionScore,
  evaluateBackcountryDecision,
  summarizeBetterDayWithoutAvalancheText,
} from '../app/decision';
import { buildDayOverDayChanges } from '../app/day-over-day';
import { buildTravelWindowRows } from '../app/travel-window';

export type BetterDaySuggestion = {
  date: string;
  level: DecisionLevel;
  score: number | null;
  weather: string;
  gustMph: number | null;
  precipChance: number | null;
  summary: string;
  bestWindowStart: string | null;
};

export interface UseDayComparisonsParams {
  hasObjective: boolean;
  view: string;
  safetyData: SafetyData | null;
  decisionLevel: DecisionLevel | undefined;
  forecastDate: string;
  alpineStartTime: string;
  position: { lat: number; lng: number };
  preferences: UserPreferences;
  maxForecastDate: string;
}

export interface UseDayComparisonsReturn {
  dayOverDay: DayOverDayComparison | null;
  setDayOverDay: React.Dispatch<React.SetStateAction<DayOverDayComparison | null>>;
  betterDaySuggestions: BetterDaySuggestion[];
  setBetterDaySuggestions: React.Dispatch<React.SetStateAction<BetterDaySuggestion[]>>;
  betterDaySuggestionsLoading: boolean;
  setBetterDaySuggestionsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  betterDaySuggestionsNote: string | null;
  setBetterDaySuggestionsNote: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useDayComparisons({
  hasObjective,
  view,
  safetyData,
  decisionLevel,
  forecastDate,
  alpineStartTime,
  position,
  preferences,
  maxForecastDate,
}: UseDayComparisonsParams): UseDayComparisonsReturn {
  const [dayOverDay, setDayOverDay] = useState<DayOverDayComparison | null>(null);
  const [betterDaySuggestions, setBetterDaySuggestions] = useState<BetterDaySuggestion[]>([]);
  const [betterDaySuggestionsLoading, setBetterDaySuggestionsLoading] = useState(false);
  const [betterDaySuggestionsNote, setBetterDaySuggestionsNote] = useState<string | null>(null);

  // Day-over-day comparison
  useEffect(() => {
    if (!hasObjective || !safetyData) {
      setDayOverDay(null);
      return;
    }

    const selectedDate = safetyData.forecast?.selectedDate || forecastDate;
    if (!DATE_FMT.test(selectedDate)) {
      setDayOverDay(null);
      return;
    }

    const previousDate = addDaysToIsoDate(selectedDate, -1);
    let cancelled = false;

    (async () => {
      try {
        const { response, payload } = await fetchApi(
          `/api/safety?lat=${position.lat}&lon=${position.lng}&date=${encodeURIComponent(previousDate)}`,
        );
        if (!response.ok || !payload || typeof payload !== 'object') {
          if (!cancelled) setDayOverDay(null);
          return;
        }

        const previousPayload = payload as SafetyData;
        const prevScore = Number(previousPayload?.safety?.score);
        if (!Number.isFinite(prevScore)) {
          if (!cancelled) setDayOverDay(null);
          return;
        }

        if (!cancelled) {
          setDayOverDay({
            previousDate,
            previousScore: prevScore,
            delta: safetyData.safety.score - prevScore,
            changes: buildDayOverDayChanges(safetyData, previousPayload, preferences),
          });
        }
      } catch {
        if (!cancelled) setDayOverDay(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasObjective, safetyData, forecastDate, position.lat, position.lng, preferences]);

  // Better day suggestions
  useEffect(() => {
    if (!hasObjective || view !== 'planner' || !safetyData || !decisionLevel || decisionLevel === 'GO') {
      setBetterDaySuggestions([]);
      setBetterDaySuggestionsLoading(false);
      setBetterDaySuggestionsNote(null);
      return;
    }

    const selectedDate = safetyData.forecast?.selectedDate || forecastDate;
    if (!DATE_FMT.test(selectedDate)) {
      setBetterDaySuggestions([]);
      setBetterDaySuggestionsLoading(false);
      setBetterDaySuggestionsNote('Upcoming-day scan unavailable because the selected forecast date is invalid.');
      return;
    }

    const safeTravelWindowHours = Math.max(
      MIN_TRAVEL_WINDOW_HOURS,
      Math.min(MAX_TRAVEL_WINDOW_HOURS, Math.round(Number(preferences.travelWindowHours) || 12)),
    );

    const candidateDates: string[] = [];
    let cursor = selectedDate;
    for (let i = 0; i < 7; i += 1) {
      cursor = addDaysToIsoDate(cursor, 1);
      if (!DATE_FMT.test(cursor) || cursor > maxForecastDate) {
        break;
      }
      candidateDates.push(cursor);
    }

    if (candidateDates.length === 0) {
      setBetterDaySuggestions([]);
      setBetterDaySuggestionsLoading(false);
      setBetterDaySuggestionsNote('No upcoming dates are available inside the current forecast range.');
      return;
    }

    let cancelled = false;
    setBetterDaySuggestionsLoading(true);
    setBetterDaySuggestionsNote(null);

    (async () => {
      try {
        const nextDayPayloads = await Promise.all(
          candidateDates.map(async (date) => {
            try {
              const { response, payload } = await fetchApi(
                `/api/safety?lat=${position.lat}&lon=${position.lng}&date=${encodeURIComponent(date)}&start=${encodeURIComponent(
                  alpineStartTime,
                )}&travel_window_hours=${safeTravelWindowHours}`,
              );
              if (!response.ok || !payload || typeof payload !== 'object') {
                return null;
              }
              const candidateData = payload as SafetyData;
              const candidateDecision = evaluateBackcountryDecision(
                candidateData,
                alpineStartTime,
                preferences,
              );
              const scoreRaw = normalizedDecisionScore(candidateData);
              const gustRaw = Number(candidateData?.weather?.windGust);
              const precipRaw = Number(candidateData?.weather?.precipChance);
              const riskSummary = summarizeBetterDayWithoutAvalancheText(candidateDecision);
              const candidateTrend = Array.isArray(candidateData?.weather?.trend) ? candidateData.weather.trend : [];
              const candidateRows = buildTravelWindowRows(candidateTrend, preferences);
              const firstPassIdx = candidateRows.findIndex((r) => r.pass);
              const bestWindowStart = firstPassIdx >= 0 && candidateRows[firstPassIdx].time
                ? String(candidateRows[firstPassIdx].time).slice(0, 5)
                : null;
              return {
                date: candidateData?.forecast?.selectedDate && DATE_FMT.test(candidateData.forecast.selectedDate) ? candidateData.forecast.selectedDate : date,
                level: candidateDecision.level,
                score: Number.isFinite(scoreRaw) ? Math.round(scoreRaw) : null,
                weather: String(candidateData?.weather?.description || 'Unknown'),
                gustMph: Number.isFinite(gustRaw) ? gustRaw : null,
                precipChance: Number.isFinite(precipRaw) ? Math.round(precipRaw) : null,
                summary: riskSummary,
                bestWindowStart,
              } as BetterDaySuggestion;
            } catch {
              return null;
            }
          }),
        );

        if (cancelled) {
          return;
        }

        const validSuggestions = nextDayPayloads.filter((entry): entry is BetterDaySuggestion => Boolean(entry));
        if (validSuggestions.length === 0) {
          setBetterDaySuggestions([]);
          setBetterDaySuggestionsNote('Could not evaluate upcoming days right now. Try Refresh.');
          return;
        }

        const currentComparisonDecision = evaluateBackcountryDecision(
          safetyData,
          alpineStartTime,
          preferences,
        );
        const currentLevelRank = decisionLevelRank(currentComparisonDecision.level);
        const currentScore = normalizedDecisionScore(safetyData);
        const clearlyBetter = validSuggestions.filter((entry) => {
          const rank = decisionLevelRank(entry.level);
          const candidateScore = Number.isFinite(Number(entry.score)) ? Number(entry.score) : -Infinity;
          return rank > currentLevelRank || (rank === currentLevelRank && candidateScore >= currentScore + 3);
        });
        const pool = clearlyBetter.length > 0 ? clearlyBetter : validSuggestions;
        pool.sort((a, b) => {
          const rankDelta = decisionLevelRank(b.level) - decisionLevelRank(a.level);
          if (rankDelta !== 0) return rankDelta;
          const scoreA = Number.isFinite(Number(a.score)) ? Number(a.score) : -Infinity;
          const scoreB = Number.isFinite(Number(b.score)) ? Number(b.score) : -Infinity;
          if (scoreB !== scoreA) return scoreB - scoreA;
          const precipA = Number.isFinite(Number(a.precipChance)) ? Number(a.precipChance) : 1000;
          const precipB = Number.isFinite(Number(b.precipChance)) ? Number(b.precipChance) : 1000;
          if (precipA !== precipB) return precipA - precipB;
          const gustA = Number.isFinite(Number(a.gustMph)) ? Number(a.gustMph) : 1000;
          const gustB = Number.isFinite(Number(b.gustMph)) ? Number(b.gustMph) : 1000;
          if (gustA !== gustB) return gustA - gustB;
          return a.date.localeCompare(b.date);
        });

        setBetterDaySuggestions(pool.slice(0, 3));
        setBetterDaySuggestionsNote(
          clearlyBetter.length > 0
            ? null
            : 'No clearly better day found in the next 7 days. Showing least-risk alternatives from available forecasts.',
        );
      } finally {
        if (!cancelled) {
          setBetterDaySuggestionsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    hasObjective,
    view,
    safetyData,
    decisionLevel,
    forecastDate,
    position.lat,
    position.lng,
    alpineStartTime,
    preferences,
    maxForecastDate,
  ]);

  return {
    dayOverDay,
    setDayOverDay,
    betterDaySuggestions,
    setBetterDaySuggestions,
    betterDaySuggestionsLoading,
    setBetterDaySuggestionsLoading,
    betterDaySuggestionsNote,
    setBetterDaySuggestionsNote,
  };
}
