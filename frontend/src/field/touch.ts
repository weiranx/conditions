// Touch-screen conventions for the planner and its map.

const matches = (query: string) =>
  typeof window !== "undefined" && Boolean(window.matchMedia?.(query).matches);

/** A finger, not a mouse, is the main pointer (phones and tablets). */
export const hasCoarsePointer = () => matches("(pointer: coarse)");

/**
 * On a phone or tablet in the one-column layout, moves a field to the top of
 * the screen as it takes focus, so what opens below it (search suggestions)
 * is not hidden behind the on-screen keyboard. The jump is immediate, before
 * the keyboard opens, so it cannot race the browser's own focus scrolling.
 */
export function liftAboveKeyboard(element: HTMLElement | null) {
  if (element && matches("(pointer: coarse) and (max-width: 850px)"))
    element.scrollIntoView?.({ block: "start", behavior: "instant" });
}
