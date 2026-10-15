import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";
import type { PersistedReport } from "../app/report-storage";

// Where the reader was in a report, kept while they visit another page, so the
// brief they come back to opens at the chapter and the spot they left.

/** The open chapter (or the brief) and how far down the page it was read. */
export type ReportPlace = {
  report: string;
  view: string;
  scrollY: number;
  briefScrollY: number;
};

/** One report: the same forecast for the same plan, however it was opened. */
export function reportPlaceKey(report: Pick<PersistedReport, "plan" | "safetyData">): string {
  const { plan, safetyData } = report;
  return [safetyData.generatedAt ?? "", plan.lat, plan.lon, plan.forecastDate, plan.alpineStartTime].join("|");
}

/** The place to return to when this report opens again, or null for a report not read before. */
export function placeToReturnTo(place: ReportPlace | null | undefined, report: string): ReportPlace | null {
  return place && place.report === report ? place : null;
}

// Chapters load lazily, so the page may be too short to reach the old spot at first.
const RESTORE_LIMIT_MS = 2500;
const READER_INPUT = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * Remembers the reader's place in `store` as they scroll and change chapters,
 * and scrolls back to `returning` once the report is tall enough to reach it.
 * The reader scrolling first ends the wait.
 */
export function useKeepReportPlace(
  store: MutableRefObject<ReportPlace | null> | undefined,
  report: string,
  view: string,
  briefScroll: MutableRefObject<number>,
  returning: ReportPlace | null,
) {
  const restoring = useRef(Boolean(returning && returning.scrollY > 0));
  const save = useCallback(() => {
    if (!store || restoring.current) return;
    store.current = { report, view, scrollY: window.scrollY, briefScrollY: briefScroll.current };
  }, [store, report, view, briefScroll]);
  // A layout effect stops listening as the report leaves, before the next page scrolls to its top.
  useLayoutEffect(() => {
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
      save();
    };
    const step = () => {
      window.scrollTo({ top: target, behavior: "instant" });
      if (Math.abs(window.scrollY - target) < 2 || performance.now() > deadline) stop();
      else frame = window.requestAnimationFrame(step);
    };
    READER_INPUT.forEach((type) => window.addEventListener(type, stop, { passive: true }));
    step();
    // Leaving before the spot was reached keeps the place for next time.
    return cancel;
    // Runs once, as the report opens; `save` is read at the end of the wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
