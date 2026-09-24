import { useLayoutEffect, useRef } from "react";

// Where the page is scrolled when what it shows changes. On a phone every
// screen is one long column, so a new screen opened at the old offset lands
// mid-page, and a change made far from what it affects happens out of sight.

const prefersReducedMotion = () =>
  typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/**
 * Opens a new page, or a new brief replacing the last, at the top rather than
 * at the offset the previous content was scrolled to.
 */
export function useNewPageStartsAtTop(page: string, newBrief: boolean) {
  const shown = useRef({ page, newBrief });
  useLayoutEffect(() => {
    const previous = shown.current;
    shown.current = { page, newBrief };
    if (page !== previous.page || (newBrief && !previous.newBrief))
      window.scrollTo({ top: 0, behavior: "instant" });
  }, [page, newBrief]);
}

/** Choosing the page you are already on returns to its top, as a tab bar does. */
export function scrollPageToTop() {
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "instant" : "smooth" });
}

/**
 * Brings the start of something that just changed into view when it is off
 * screen, as when a choice made low on a phone's one-column page updates a
 * form far above it, or results start loading below a long form.
 */
export function revealStart(element: HTMLElement | null) {
  if (!element?.scrollIntoView) return;
  const { top } = element.getBoundingClientRect();
  if (top < 0 || top > window.innerHeight * 0.6)
    element.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "instant" : "smooth" });
}
