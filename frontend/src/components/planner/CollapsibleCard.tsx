import { useState, useCallback } from 'react';
import type { ReactNode } from 'react';

const STORAGE_PREFIX = 'summitsafe:card-expanded:';

interface CollapsibleCardProps {
  cardKey: string;
  domId?: string;
  title: ReactNode;
  headerMeta?: ReactNode;
  summary: ReactNode;
  defaultExpanded?: boolean;
  children: ReactNode;
  order?: number;
  className?: string;
}

export function CollapsibleCard({
  cardKey,
  domId,
  title,
  headerMeta,
  summary,
  defaultExpanded = false,
  children,
  order,
  className,
}: CollapsibleCardProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(`${STORAGE_PREFIX}${cardKey}`);
      if (stored !== null) return stored === 'true';
    } catch {
      // ignore storage errors
    }
    return defaultExpanded;
  });

  const toggle = useCallback(() => {
    setIsExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(`${STORAGE_PREFIX}${cardKey}`, String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, [cardKey]);

  const bodyId = `collapsible-body-${cardKey}`;

  return (
    <div
      className={`card collapsible-card ${isExpanded ? 'is-expanded' : 'is-collapsed'}${className ? ` ${className}` : ''}`}
      style={order !== undefined ? { order } : undefined}
      id={domId}
    >
      <button
        type="button"
        className="collapsible-card-header card-header"
        aria-expanded={isExpanded}
        aria-controls={bodyId}
        onClick={toggle}
      >
        <span className="collapsible-title-wrap">{title}</span>
        <span className="collapsible-header-right">
          {headerMeta && <span className="collapsible-header-meta">{headerMeta}</span>}
          <span className="collapsible-chevron" aria-hidden="true">›</span>
        </span>
      </button>
      {!isExpanded && <div className="collapsible-summary">{summary}</div>}
      <div id={bodyId} hidden={!isExpanded}>
        {children}
      </div>
    </div>
  );
}
