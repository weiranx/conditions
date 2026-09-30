// Touch-screen conventions for the planner and its map.

import { copyTextToClipboard } from "../app/clipboard";

const matches = (query: string) =>
  typeof window !== "undefined" && Boolean(window.matchMedia?.(query).matches);

/** A finger, not a mouse, is the main pointer (phones and tablets). */
export const hasCoarsePointer = () => matches("(pointer: coarse)");

/**
 * For a field that takes a place name or coordinates. Autocorrect rewrites proper nouns ("Rainier") and
 * mangles "46.85, -121.76", and the return key should say what it does.
 */
export const placeSearchKeyboard = { autoCorrect: "off", spellCheck: false, enterKeyHint: "search" } as const;

/**
 * Closes open <details> menus matching `selector` when a press lands outside them. A menu that closes when it
 * loses focus cannot do this on iOS Safari, which never focuses what is tapped. Returns the function that stops listening.
 */
export function closeDetailsOnOutsidePress(selector: string) {
  const close = (event: PointerEvent) => {
    document.querySelectorAll<HTMLDetailsElement>(`${selector}[open]`).forEach((menu) => {
      if (!menu.contains(event.target as Node)) menu.open = false;
    });
  };
  document.addEventListener("pointerdown", close);
  return () => document.removeEventListener("pointerdown", close);
}

export type LinkShare = "shared" | "copied" | "dismissed" | "failed";

/**
 * Sends a link where the person wants it: the system share sheet (Messages, Mail, a chat app) on a phone or
 * tablet, the clipboard elsewhere. A desktop browser's share dialog is worse than a copied link, so it is not used.
 * Closing the sheet is a choice, not an error. Any other refusal, such as the tap's permission lapsing while a
 * report saved first, copies the link instead so the action never ends in nothing.
 */
export async function shareOrCopyLink(link: { url: string; title?: string }): Promise<LinkShare> {
  const canShare = hasCoarsePointer()
    && typeof navigator !== "undefined"
    && typeof navigator.share === "function"
    && (typeof navigator.canShare !== "function" || navigator.canShare(link));
  if (canShare) {
    try {
      await navigator.share(link);
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "dismissed";
    }
  }
  return (await copyTextToClipboard(link.url)) ? "copied" : "failed";
}

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
