import { useSyncExternalStore } from 'react';
import { fetchApi } from '../lib/api-client';

export const AI_AVAILABILITY_EVENT = 'summitsafe:ai-availability-change';
const AI_AVAILABILITY_REFRESH_MS = 15_000;
export const AI_FEATURE_KEYS = ['aiBrief', 'reportChat', 'routeAnalysis', 'snowVision'] as const;
export type AiFeatureKey = (typeof AI_FEATURE_KEYS)[number];
export type AiFeatureAvailability = Record<AiFeatureKey, boolean>;

interface AiStatusPayload {
  available?: unknown;
  features?: Partial<Record<AiFeatureKey, { available?: unknown }>>;
}

interface ReportCapabilities extends Partial<Record<AiFeatureKey, boolean>> {
  ai?: boolean;
}

function readAvailability(payload: unknown): AiFeatureAvailability | null {
  if (!payload || typeof payload !== 'object' || !('ai' in payload)) return null;
  const ai = payload.ai as AiStatusPayload | null;
  if (!ai || typeof ai !== 'object' || typeof ai.available !== 'boolean') return null;
  return Object.fromEntries(AI_FEATURE_KEYS.map((feature) => {
    const featureAvailability = ai.features?.[feature]?.available;
    return [feature, typeof featureAvailability === 'boolean' ? featureAvailability : ai.available];
  })) as AiFeatureAvailability;
}

// Every mounted consumer shares one poll of the health endpoint (each request
// also checks the database), so a report with its terrain and route sections
// open still makes a single request per interval. Polling runs only while a
// consumer is mounted, and skips hidden tabs until they are shown again.
let availability: AiFeatureAvailability | null = null;
const listeners = new Set<() => void>();
let stopPolling: (() => void) | null = null;

function setAvailability(next: AiFeatureAvailability) {
  availability = next;
  listeners.forEach((listener) => listener());
}

function startPolling() {
  const controller = new AbortController();
  let requestInFlight = false;

  const refresh = async () => {
    if (requestInFlight || document.visibilityState === 'hidden') return;
    requestInFlight = true;
    try {
      const result = await fetchApi('/api/healthz', { signal: controller.signal });
      if (!result.response.ok) return;
      const nextAvailability = readAvailability(result.payload);
      if (nextAvailability !== null) setAvailability(nextAvailability);
    } catch {
      // Retain the last known state when the health endpoint is unreachable.
    } finally {
      requestInFlight = false;
    }
  };
  const handleVisibilityChange = () => void refresh();

  void refresh();
  const interval = window.setInterval(() => void refresh(), AI_AVAILABILITY_REFRESH_MS);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    controller.abort();
    window.clearInterval(interval);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) stopPolling = startPolling();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopPolling?.();
      stopPolling = null;
    }
  };
}

const getAvailability = () => availability;

export function publishAiAvailability(status: AiStatusPayload): void {
  const nextAvailability = readAvailability({ ai: status });
  if (!nextAvailability) return;
  setAvailability(nextAvailability);
  window.dispatchEvent(new CustomEvent(AI_AVAILABILITY_EVENT, { detail: nextAvailability }));
}

export function useAiAvailability(reportCapabilities?: ReportCapabilities): AiFeatureAvailability {
  const available = useSyncExternalStore(subscribe, getAvailability, getAvailability);

  if (available) return available;
  const fallback = reportCapabilities?.ai === true;
  return Object.fromEntries(AI_FEATURE_KEYS.map((feature) => [
    feature,
    typeof reportCapabilities?.[feature] === 'boolean' ? reportCapabilities[feature] : fallback,
  ])) as AiFeatureAvailability;
}
