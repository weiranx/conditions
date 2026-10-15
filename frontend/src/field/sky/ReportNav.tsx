import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import type { CheckStatus } from "./status";
import type { ReportChapter } from "./report-chapters";

/** The part of the report the reader is in: the summary at the top, or one of its sections. */
export type ReportPlace = ReportChapter | "summary";

/**
 * The report's section bar. It stays at the top of the screen while the reader
 * scrolls, marks the section they are in, and puts a dot on a section whose
 * checks are over a limit or missing evidence, so the problems are one tap away.
 */
export function ReportNav({ sections, active, onPick, navRef }: {
  sections: Array<{ id: ReportChapter; label: string; short: string; status: CheckStatus | null }>;
  active: ReportPlace;
  onPick: (place: ReportPlace) => void;
  navRef: RefObject<HTMLElement | null>;
}) {
  useEffect(() => {
    // On a narrow screen the bar scrolls; keep the current section in view.
    const nav = navRef.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
  }, [active, navRef]);
  return (
    <nav className="sky-chapter-tabs sky-report-nav" aria-label="Report sections" ref={navRef}>
      <button type="button" aria-current={active === "summary" ? "location" : undefined} onClick={() => onPick("summary")}>
        Summary
      </button>
      {sections.map((section) => (
        <button key={section.id} type="button" aria-current={active === section.id ? "location" : undefined}
          title={section.short === section.label ? undefined : section.label} onClick={() => onPick(section.id)}>
          {section.short}
          {(section.status === "over" || section.status === "missing") && (
            <span className={`sky-nav-dot is-${section.status}`}>
              <span className="sr-only">{section.status === "over" ? " (needs attention)" : " (incomplete data)"}</span>
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}

/**
 * A report section that renders once the reader comes near it (or jumps to it),
 * so a report opens as fast as its summary while every section waits below it.
 */
export function DeferredSection({ id, mounted, onNear, children }: {
  id: ReportChapter;
  mounted: boolean;
  onNear: (id: ReportChapter) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mounted) return;
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      onNear(id);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((entry) => entry.isIntersecting)) onNear(id); },
      { rootMargin: "1200px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [id, mounted, onNear]);
  return mounted ? <>{children}</> : <div ref={ref} className="sky-section-placeholder" aria-hidden="true" />;
}
