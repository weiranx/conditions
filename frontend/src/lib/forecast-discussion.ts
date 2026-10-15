import { useSyncExternalStore } from 'react';
import type { ElevationUnit, SafetyData, TemperatureUnit, WindSpeedUnit } from '../app/types';
import { fetchApi, readApiErrorMessage } from './api-client';

/** An AI reading of the NWS Area Forecast Discussion for one plan. Regional context: it never changes the verdict. */
export interface DiscussionSummary {
  /** What the forecasters expect for the region, around the trip date. */
  summary: string;
  /** What that means at this objective on this plan. */
  forObjective: string;
  /** Signals in the discussion that would change the plan. */
  watch: string[];
  forecasterConfidence: 'high' | 'moderate' | 'low' | 'not stated';
  /** Whether the discussion's dated periods include the trip date; null when none could be dated. */
  coversTripDate: boolean | null;
  office: string | null;
  issuedTime: string | null;
  generatedAt: string;
}

export interface DiscussionSummaryRequest {
  report: SafetyData;
  objectiveName: string;
  units: { temperature: TemperatureUnit; wind: WindSpeedUnit; elevation: ElevationUnit };
}

const CONFIDENCES = ['high', 'moderate', 'low', 'not stated'] as const;

export async function fetchDiscussionSummary(request: DiscussionSummaryRequest, signal?: AbortSignal): Promise<DiscussionSummary> {
  const { response, payload } = await fetchApi('/api/forecast-discussion/summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  }, { retries: 0 });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not summarize the forecast discussion right now.'));
  const record = payload && typeof payload === 'object' ? payload as Partial<DiscussionSummary> : {};
  if (typeof record.summary !== 'string' || typeof record.forObjective !== 'string') throw new Error('Could not summarize the forecast discussion right now.');
  return {
    summary: record.summary,
    forObjective: record.forObjective,
    watch: Array.isArray(record.watch) ? record.watch.filter((item): item is string => typeof item === 'string') : [],
    forecasterConfidence: CONFIDENCES.find((value) => value === record.forecasterConfidence) ?? 'not stated',
    coversTripDate: typeof record.coversTripDate === 'boolean' ? record.coversTripDate : null,
    office: typeof record.office === 'string' ? record.office : null,
    issuedTime: typeof record.issuedTime === 'string' ? record.issuedTime : null,
    generatedAt: typeof record.generatedAt === 'string' ? record.generatedAt : new Date().toISOString(),
  };
}

// Summaries are kept for the session per place, date, discussion issue and units,
// so the card keeps its answer when the weather chapter is shown again.
const stored = new Map<string, DiscussionSummary>();
const listeners = new Set<() => void>();

export function discussionSummaryKey(request: DiscussionSummaryRequest): string | null {
  const discussion = request.report.supplementalEvidence?.discussion;
  if (!discussion?.available || !discussion.issuedTime) return null;
  const { lat, lon } = request.report.location;
  const { temperature, wind, elevation } = request.units;
  return [lat.toFixed(4), lon.toFixed(4), request.report.forecast?.selectedDate ?? '', request.report.forecast?.selectedStartTime ?? '', discussion.issuedTime, request.objectiveName, temperature, wind, elevation].join('|');
}

export function storeDiscussionSummary(key: string, summary: DiscussionSummary): void {
  stored.set(key, summary);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStoredDiscussionSummary(key: string | null): DiscussionSummary | null {
  return useSyncExternalStore(subscribe, () => (key ? stored.get(key) ?? null : null), () => null);
}
