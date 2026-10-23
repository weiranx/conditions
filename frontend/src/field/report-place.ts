import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";
import type { PersistedReport } from "../app/report-storage";

// Where the reader was in a report, kept while they visit another page, so the
// brief they come back to opens at the spot they left.

/** How far down the report was read, the sections rendered by then, and the ones the reader had open. */
export type ReadingPlace = {
  report: string;
  scrollY: number;
  sections: string[];
  /** On a phone, where sections open and shut, the ones open when the reader left; rendered is not the same as open. */
  opened: string[];
};

/** One report: the same forecast for the same plan, however it was opened. */
export function reportPlaceKey(report: Pick<PersistedReport, "plan" | "safetyData">): string {
  const { plan, safetyData } = report;
  return [safetyData.generatedAt ?? "", plan.lat, plan.lon, plan.forecastDate, plan.alpineStartTime].join("|");
}

/** The place to return to when this report opens again, or null for a report not read before. */
export function placeToReturnTo(place: ReadingPlace | null | undefined, report: string): ReadingPlace | null {
  return place && place.report === report ? place : null;
}

// The sections above the old spot render as the report reopens, but their charts and maps may still be loading.
const RESTORE_LIMIT_MS = 2500;
const READER_INPUT = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * Remembers the reader's place in `store` as they scroll, and scrolls back to
 * `returning` once the report is tall enough to reach it. The reader scrolling
 * first ends the wait.
 */
export function useKeepReportPlace(
  store: MutableRefObject<ReadingPlace | null> | undefined,
  report: string,
  sections: ReadonlySet<string>,
  opened: ReadonlySet<string>,
  returning: ReadingPlace | null,
) {
  const restoring = useRef(Boolean(returning && returning.scrollY > 0));
  const save = useCallback(() => {
    if (!store || restoring.current) return;
    store.current = { report, scrollY: window.scrollY, sections: [...sections], opened: [...opened] };
  }, [store, report, sections, opened]);
  const latestSave = useRef(save);
  // A layout effect stops listening as the report leaves, before the next page scrolls to its top.
  useLayoutEffect(() => {
    latestSave.current = save;
    save();
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [save]);
  useEffect(() => {
    if (!returning || !restoring.current) return;
    const target = returning.scrollY;
    const deadline = performance.now() + RESTORE_LIMIT_MS;
    let frame = 0;
    const cancel = () => {
      window.cancelAnimationFrame(frame);
      READER_INPUT.forEach((type) => window.removeEventListener(type, stop));
    };
    const stop = () => {
      cancel();
      if (!restoring.current) return;
      restoring.current = false;
      latestSave.current();
    };
    const step = () => {
      window.scrollTo({ top: target, behavior: "instant" });
      if (Math.abs(window.scrollY - target) < 2) stop();
      else if (performance.now() > deadline) {
        // Too slow to reach: the spot stays kept for next time instead of the clipped offset.
        cancel();
        restoring.current = false;
      } else frame = window.requestAnimationFrame(step);
    };
    READER_INPUT.forEach((type) => window.addEventListener(type, stop, { passive: true }));
    step();
    // Leaving before the spot was reached keeps the place for next time.
    return cancel;
    // Runs once, as the report opens; the latest sections are saved at the end of the wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
