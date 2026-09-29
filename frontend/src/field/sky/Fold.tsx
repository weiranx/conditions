import { useEffect, useRef, type ReactNode } from "react";

/**
 * A report section that stays closed until asked for: the heading and one line
 * of what is inside. The chapter leads with its answer; the detail waits here.
 */
export function Fold({ id, title, hint, defaultOpen = false, children }: {
  id: string;
  title: ReactNode;
  hint?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    // A printed report has no way to open a closed section.
    const open = () => { if (ref.current) ref.current.open = true; };
    window.addEventListener("beforeprint", open);
    return () => window.removeEventListener("beforeprint", open);
  }, []);
  return (
    <section className="sky-section sky-fold" aria-labelledby={id}>
      <details ref={ref} open={defaultOpen || undefined}>
        <summary>
          <span className="sky-fold-text"><h2 id={id}>{title}</h2>{hint && <span className="sky-fold-hint">{hint}</span>}</span>
        </summary>
        <div className="sky-fold-body">{children}</div>
      </details>
    </section>
  );
}
