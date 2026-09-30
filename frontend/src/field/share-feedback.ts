import type { LinkShare } from "./touch";

/** Shown, with a "Share link" button, when a report had to be saved first and the browser then wanted a fresh tap. */
export const SHARE_READY_FEEDBACK = "Report saved to your account. Tap Share link to send it.";

/**
 * What to tell the person after a share, or null when nothing more needs saying: closing the share sheet
 * without choosing anyone asks for no message.
 */
export function describeShare(
  outcome: LinkShare,
  { token, saveFailed, link }: { token: string | null | undefined; saveFailed: boolean; link: string },
): string | null {
  if (outcome === "dismissed") return null;
  if (outcome === "blocked") return SHARE_READY_FEEDBACK;
  // Nothing could be shared or copied: show the link so it can still be copied by hand.
  if (outcome === "failed") return `Share link: ${link}`;
  const sent = outcome === "shared" ? "shared" : "copied";
  if (token) return `Report link ${sent}.`;
  // A plan link makes a new report without the route analysis or AI work.
  return `Plan link ${sent}. ${saveFailed ? "The report could not be saved, so this" : "This"} link makes a new report without the route analysis or AI brief${saveFailed ? "." : "; sign in to share the report itself."}`;
}
