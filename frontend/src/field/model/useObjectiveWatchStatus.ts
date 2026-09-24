import { useCallback, useEffect, useState } from "react";
import { getObjectiveWatch } from "../../lib/objective-watches";
import type { PersistedReportPlan } from "../../app/report-storage";

/**
 * Whether the signed-in account already watches this exact plan. The lookup
 * repeats whenever `active` turns on again, so a watch removed elsewhere stops
 * showing as watched; the last answer is kept meanwhile to avoid flicker.
 */
export function useObjectiveWatchStatus(
  plan: PersistedReportPlan | null,
  userId: string | null,
  active: boolean,
) {
  const lat = plan?.lat;
  const lon = plan?.lon;
  const forecastDate = plan?.forecastDate;
  const alpineStartTime = plan?.alpineStartTime;
  const travelWindowHours = plan?.travelWindowHours;
  const key = userId && typeof lat === "number" && typeof lon === "number"
    ? [userId, lat.toFixed(4), lon.toFixed(4), forecastDate, alpineStartTime, travelWindowHours].join(":")
    : null;
  const [status, setStatus] = useState<{ key: string; watching: boolean } | null>(null);

  useEffect(() => {
    if (!active || !key || lat === undefined || lon === undefined || !forecastDate || !alpineStartTime
      || travelWindowHours === undefined) return;
    const controller = new AbortController();
    getObjectiveWatch({ lat, lon, forecastDate, alpineStartTime, travelWindowHours }, controller.signal)
      .then(({ watch }) => {
        if (!controller.signal.aborted) setStatus({ key, watching: Boolean(watch) });
      })
      // Without an answer the report keeps offering the plain Watch action.
      .catch(() => {});
    return () => controller.abort();
  }, [active, key, lat, lon, forecastDate, alpineStartTime, travelWindowHours]);

  const markWatched = useCallback(() => {
    if (key) setStatus({ key, watching: true });
  }, [key]);

  return { watching: Boolean(key) && status?.key === key && status.watching, markWatched };
}
