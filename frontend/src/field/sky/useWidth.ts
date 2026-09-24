import { useEffect, useState, type RefCallback } from "react";

type MeasuredRef<T> = RefCallback<T> & { current: T | null };

/**
 * Track an element's content width so SVG charts can lay out text at its real size.
 * The ref is a callback so a remounted element is observed again, and it keeps a
 * `current` for callers that read the element directly.
 */
export function useWidth<T extends HTMLElement>(fallback: number) {
  const [node, setNode] = useState<T | null>(null);
  const [ref] = useState<MeasuredRef<T>>(() => {
    const attach = ((el: T | null) => { attach.current = el; setNode(el); }) as MeasuredRef<T>;
    attach.current = null;
    return attach;
  });
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      // A hidden or detached element reports zero; keep the last real width.
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [ref, width] as const;
}
