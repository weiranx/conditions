import type { ReportChapter } from "./report-chapters";

/** True once each section's content has rendered, with nothing still loading in it. */
export function sectionsReady(root: HTMLElement, ids: readonly ReportChapter[]) {
  return ids.every((id) => {
    const block = root.querySelector<HTMLElement>(`[data-chapter="${id}"]`);
    return Boolean(block && block.dataset.mounted === "true" && !block.querySelector(".sky-section-loading"));
  });
}

/**
 * Scrolls a part of the report into view under the section bar and moves focus
 * there. A target inside a closed fold opens it first. Sections above the target
 * can still grow (a map, a late chart), so for a moment the page follows the
 * target until the reader scrolls on their own.
 */
export function landOn(target: HTMLElement, { smooth }: { smooth: boolean }) {
  for (let fold = target.closest("details"); fold; fold = fold.parentElement?.closest("details") ?? null) {
    if (!fold.open) fold.open = true;
  }
  const behavior: ScrollBehavior = smooth && !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "smooth" : "instant";
  const place = target.closest<HTMLElement>("section") ?? target;
  place.scrollIntoView({ block: "start", behavior });
  const focusable = target.matches("h1, h2, h3, [tabindex]") ? target : place;
  if (!focusable.hasAttribute("tabindex")) focusable.setAttribute("tabindex", "-1");
  focusable.focus({ preventScroll: true });

  const root = document.scrollingElement ?? document.documentElement;
  if (typeof ResizeObserver === "undefined") return () => {};
  const follow = new ResizeObserver(() => place.scrollIntoView({ block: "start", behavior }));
  const stop = () => {
    follow.disconnect();
    window.clearTimeout(timer);
    for (const type of ["wheel", "touchstart", "keydown", "pointerdown"] as const) window.removeEventListener(type, stop);
  };
  const timer = window.setTimeout(stop, 1500);
  for (const type of ["wheel", "touchstart", "keydown", "pointerdown"] as const) window.addEventListener(type, stop, { passive: true });
  follow.observe(root.querySelector("#field-report-detail") ?? root);
  return stop;
}
