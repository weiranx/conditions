import { useEffect, useState } from 'react';
import { lookupDaylight, type PlanDaylight } from '../lib/search';

/** Dawn, sunrise and sunset for the planned place and day, or null until known. */
export function usePlanDaylight(point: { lat: number; lon: number } | null, date: string): PlanDaylight | null {
  const key = point && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${point.lat.toFixed(4)},${point.lon.toFixed(4)},${date}` : null;
  const [result, setResult] = useState<{ key: string; daylight: PlanDaylight } | null>(null);
  useEffect(() => {
    if (!key) return;
    const [lat, lon] = key.split(',').map(Number);
    const controller = new AbortController();
    // Waits a moment so stepping through days asks only for the one chosen.
    const timer = window.setTimeout(() => {
      lookupDaylight(lat, lon, date, controller.signal)
        .then((daylight) => {
          if (!controller.signal.aborted) setResult({ key, daylight });
        })
        .catch(() => {});
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, date]);
  return result && result.key === key ? result.daylight : null;
}
