import { useSyncExternalStore } from 'react';
import { fetchApi, readApiErrorMessage } from './api-client';

export const FIELD_OBSERVATION_TEXT_LIMIT = 12000;

export type FieldObservationSurface =
  | 'dry-trail' | 'wet-trail' | 'mud' | 'firm-snow' | 'soft-snow' | 'slush' | 'ice' | 'verglas' | 'mixed' | 'unknown';

/** One thing a person reported seeing, read from pasted text. Evidence only: it never changes the verdict. */
export interface FieldObservation {
  observedDate: string | null;
  /** Days before the planned date; null when either date is unknown. */
  ageDays: number | null;
  stale: boolean;
  location: string;
  elevationFt: number | null;
  aspect: string | null;
  surface: FieldObservationSurface;
  snowlineFt: number | null;
  hazards: string[];
  /** The sentence from the pasted text that supports this observation. */
  quote: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface FieldObservationRequest {
  text: string;
  objective: { name: string; lat: number; lon: number; elevationFt?: number | null };
  /** Planned trip date, YYYY-MM-DD. */
  date: string | null;
}

export interface FieldObservationResponse {
  observations: FieldObservation[];
  plannedDate: string | null;
  generatedAt: string;
}

export async function extractFieldObservations(request: FieldObservationRequest, signal?: AbortSignal): Promise<FieldObservationResponse> {
  const { response, payload } = await fetchApi('/api/field-observations/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) {
    throw new Error(readApiErrorMessage(payload, 'Could not read observations from that text.'));
  }
  const record = payload && typeof payload === 'object' ? payload as Partial<FieldObservationResponse> : {};
  return {
    observations: Array.isArray(record.observations) ? record.observations : [],
    plannedDate: typeof record.plannedDate === 'string' ? record.plannedDate : null,
    generatedAt: typeof record.generatedAt === 'string' ? record.generatedAt : new Date().toISOString(),
  };
}

// Extracted observations are kept per place and date for the session, so the brief
// and report chat can read them and they survive switching between report views.
const storedObservations = new Map<string, FieldObservation[]>();
const observationListeners = new Set<() => void>();

export function fieldObservationKey(lat: number, lon: number, date: string | null | undefined): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)},${date ?? ''}`;
}

export function getStoredFieldObservations(key: string): FieldObservation[] | null {
  return storedObservations.get(key) ?? null;
}

export function storeFieldObservations(key: string, observations: FieldObservation[]): void {
  storedObservations.set(key, observations);
  observationListeners.forEach((listener) => listener());
}

function subscribeFieldObservations(listener: () => void): () => void {
  observationListeners.add(listener);
  return () => observationListeners.delete(listener);
}

export function useStoredFieldObservations(key: string | null): FieldObservation[] | null {
  return useSyncExternalStore(
    subscribeFieldObservations,
    () => (key ? getStoredFieldObservations(key) : null),
    () => null,
  );
}
