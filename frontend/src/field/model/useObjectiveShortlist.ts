import { useEffect, useRef, useState } from 'react';
import { fetchApi } from '../../lib/api-client';
import { buildTripForecastDays } from '../../app/trip-forecast';
import { parseMultiDayUsage, type MultiDayUsage } from '../../app/multi-day-usage';
import { shortlistDates, shortlistValidation, type ShortlistState, type ShortlistResult } from '../../app/objective-shortlist';
import type { UserPreferences } from '../../app/types';

export function useObjectiveShortlist(state: ShortlistState, preferences: UserPreferences, callbacks: {
  accountKey?: string;
  onUsageUpdated: (usage: MultiDayUsage) => void;
  onUsageLimitReached: (usage: MultiDayUsage) => void;
}) {
  const key = JSON.stringify([state.objectives, state.startDate, state.durationDays, state.startTime, state.hours, preferences, callbacks.accountKey]);
  const [batch, setBatch] = useState<{ key: string; results: ShortlistResult[]; loading: boolean }>({ key: '', results: [], loading: false });
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, [key]);
  const current = batch.key === key;
  async function run() {
    if (shortlistValidation(state) || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const results: ShortlistResult[] = [];
    const isActive = () => active.current === controller && !controller.signal.aborted;
    setBatch({ key, results: [], loading: true });
    const dates = shortlistDates(state);
    // One objective at a time bounds upstream work and preserves guest-cookie and quota ordering.
    try {
      for (const objective of state.objectives) {
        if (!isActive()) break;
        let stop = false;
        try {
          const { response, payload } = await fetchApi('/api/trip-forecasts', {
            method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
            body: JSON.stringify({ lat: objective.lat, lon: objective.lon, objectiveName: objective.name,
              startDate: state.startDate, startTime: state.startTime, durationDays: dates.length, travelWindowHours: state.hours }),
          });
          if (!isActive()) break;
          const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
          const usage = parseMultiDayUsage(record.multiDayUsage);
          if (usage) callbacks.onUsageUpdated(usage);
          if (!response.ok) {
            if (response.status === 429) { stop = true; if (usage) callbacks.onUsageLimitReached(usage); }
            results.push({ objectiveId: objective.id, days: [], error: typeof record.error === 'string' ? record.error : 'Forecast unavailable. Try again.' });
          } else {
            // Failed days are omitted by the API. Match explicit date/location instead of assigning by index.
            // selectedStartTime describes a provider forecast period (usually ISO), not the requested
            // local departure clock. The request key and abort guard already bind results to that clock.
            // Missing precipitation metadata must not discard otherwise usable weather evidence.
            const entries = (Array.isArray(record.days) ? record.days : []).filter(entry => entry && typeof entry === 'object'
              && dates.includes(entry.forecast?.selectedDate)
              && (entry.rainfall?.expected?.travelWindowHours == null || entry.rainfall.expected.travelWindowHours === state.hours)
              && Math.abs(Number(entry.location?.lat) - objective.lat) < 0.0001
              && Math.abs(Number(entry.location?.lon) - objective.lon) < 0.0001);
            const uniqueEntries = [...new Map(entries.map(entry => [entry.forecast.selectedDate, entry])).values()];
            const days = buildTripForecastDays(uniqueEntries, dates, state.startTime, state.hours, { ...preferences, travelWindowHours: state.hours }, false);
            results.push({ objectiveId: objective.id, days, error: days.length ? null : 'No matching forecasts returned. Try again.' });
          }
        } catch {
          if (!isActive()) break;
          results.push({ objectiveId: objective.id, days: [], error: 'Could not load this objective. Try again.' });
        }
        if (!isActive()) break;
        setBatch({ key, results: [...results], loading: true });
        if (stop) {
          for (const remaining of state.objectives.slice(results.length)) results.push({ objectiveId: remaining.id, days: [], error: 'Not requested because the comparison allowance was reached.' });
          break;
        }
      }
    } finally {
      if (isActive()) { active.current = null; setBatch({ key, results: [...results], loading: false }); }
    }
  }
  function cancel() {
    active.current?.abort(); active.current = null;
    setBatch(previous => ({ ...previous, loading: false }));
  }
  return { run, cancel, results: current ? batch.results : [], loading: current && batch.loading, needsRefresh: !current && batch.key !== '' };
}
