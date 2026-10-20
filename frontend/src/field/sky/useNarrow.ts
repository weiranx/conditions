import { useEffect, useState } from "react";

/** Below this width a report's chapters start shut, each its heading, checks and lead. */
export const NARROW_REPORT = "(max-width: 699px)";

/** Whether the screen matches a narrow-layout media query, following it as the window changes. */
export function useNarrow(query = NARROW_REPORT) {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.(query)?.matches));
  useEffect(() => {
    const list = typeof window === "undefined" ? null : window.matchMedia?.(query);
    if (!list) return;
    const update = () => setNarrow(list.matches);
    update();
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, [query]);
  return narrow;
}
