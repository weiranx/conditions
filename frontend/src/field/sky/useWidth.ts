import { useEffect, useRef, useState } from "react";

/** Track an element's content width so SVG charts can lay out text at its real size. */
export function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // A hidden element (display: none, or a subtree hidden while a lazy chunk
    // loads) measures 0 wide. Keep the last real width rather than laying the
    // chart out at zero, which yields Infinity gradient offsets and negative radii.
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}
