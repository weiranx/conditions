import { useEffect, useState, type ReactNode } from 'react';
import { fetchApi } from '../lib/api-client';
import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAGS_EVENT,
  FeatureFlagsContext,
  FeatureFlagsReadyContext,
  readFeatureFlags,
  type ProductFeatureFlags,
} from './feature-flags';

const FEATURE_FLAGS_REFRESH_MS = 15_000;

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<ProductFeatureFlags>(DEFAULT_FEATURE_FLAGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let requestInFlight = false;

    const refresh = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const result = await fetchApi('/api/feature-flags', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!result.response.ok) return;
        const nextFlags = readFeatureFlags(result.payload);
        if (nextFlags) {
          setFlags(nextFlags);
          setReady(true);
        }
      } catch {
        // Keep the last known values when configuration is temporarily unreachable.
      } finally {
        requestInFlight = false;
      }
    };

    const handleFlagsChange = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const nextFlags = readFeatureFlags(event.detail);
      if (nextFlags) {
        setFlags(nextFlags);
        setReady(true);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh();
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), FEATURE_FLAGS_REFRESH_MS);
    window.addEventListener(FEATURE_FLAGS_EVENT, handleFlagsChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener(FEATURE_FLAGS_EVENT, handleFlagsChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return (
    <FeatureFlagsReadyContext.Provider value={ready}>
      <FeatureFlagsContext.Provider value={flags}>{children}</FeatureFlagsContext.Provider>
    </FeatureFlagsReadyContext.Provider>
  );
}
