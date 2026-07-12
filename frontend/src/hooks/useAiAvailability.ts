import { useEffect, useState } from 'react';
import { fetchApi } from '../lib/api-client';

const AI_AVAILABILITY_EVENT = 'summitsafe:ai-availability-change';
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

export function publishAiAvailability(status: AiStatusPayload): void {
  const availability = readAvailability({ ai: status });
  if (!availability) return;
  window.dispatchEvent(new CustomEvent(AI_AVAILABILITY_EVENT, { detail: availability }));
}

export function useAiAvailability(reportCapabilities?: ReportCapabilities): AiFeatureAvailability {
  const [available, setAvailable] = useState<AiFeatureAvailability | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let requestInFlight = false;

    const refresh = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const result = await fetchApi('/api/healthz', { signal: controller.signal });
        if (!result.response.ok) return;
        const nextAvailability = readAvailability(result.payload);
        if (nextAvailability !== null) setAvailable(nextAvailability);
      } catch {
        // Retain the last known state when the health endpoint is unreachable.
      } finally {
        requestInFlight = false;
      }
    };

    const handleAvailabilityChange = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const nextAvailability = event.detail as AiFeatureAvailability | null;
      if (nextAvailability && AI_FEATURE_KEYS.every((feature) => typeof nextAvailability[feature] === 'boolean')) {
        setAvailable(nextAvailability);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh();
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), AI_AVAILABILITY_REFRESH_MS);
    window.addEventListener(AI_AVAILABILITY_EVENT, handleAvailabilityChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener(AI_AVAILABILITY_EVENT, handleAvailabilityChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  if (available) return available;
  const fallback = reportCapabilities?.ai === true;
  return Object.fromEntries(AI_FEATURE_KEYS.map((feature) => [
    feature,
    typeof reportCapabilities?.[feature] === 'boolean' ? reportCapabilities[feature] : fallback,
  ])) as AiFeatureAvailability;
}
