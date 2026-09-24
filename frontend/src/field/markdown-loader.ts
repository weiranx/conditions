// Streamdown and its markdown and HTML parsers outweigh the rest of the report
// screen, and only AI-written text needs them, so they load on first use.
export const loadStreamdown = () => import("streamdown");

/** Starts loading the renderer for AI text that is on its way. */
export function preloadMarkdown() {
  void loadStreamdown();
}
