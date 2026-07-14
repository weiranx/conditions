import { useEffect, useEffectEvent } from 'react';

const DEFAULT_REVALIDATION_INTERVAL_MS = 30 * 1000;

export function useVisibleRevalidation(
  revalidate: (signal: AbortSignal) => Promise<void>,
  enabled = true,
  intervalMs = DEFAULT_REVALIDATION_INTERVAL_MS,
) {
  const runRevalidation = useEffectEvent(revalidate);

  useEffect(() => {
    if (!enabled) return;
    let controller: AbortController | null = null;

    const refresh = () => {
      if (document.visibilityState !== 'visible' || controller) return;
      controller = new AbortController();
      const activeController = controller;
      void runRevalidation(activeController.signal)
        .catch(() => {
          // Background refreshes preserve the last known state when unavailable.
        })
        .finally(() => {
          if (controller === activeController) controller = null;
        });
    };

    const intervalId = window.setInterval(refresh, intervalMs);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      controller?.abort();
    };
  }, [enabled, intervalMs]);
}
