import { useState, useCallback, useEffect, useRef, useId } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface CollapsibleCardProps {
  cardKey: string;
  domId?: string;
  title: ReactNode;
  headerMeta?: ReactNode;
  summary: ReactNode;
  preview?: ReactNode;
  defaultExpanded?: boolean;
  children: ReactNode;
  order?: number;
  className?: string;
}

export function CollapsibleCard({
  domId,
  title,
  headerMeta,
  summary,
  preview,
  children,
  order,
  className,
}: CollapsibleCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const labelId = useId();

  const openModal = useCallback(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    setIsOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Escape key dismiss
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeModal();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, closeModal]);

  // Body scroll lock
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  // Focus management
  useEffect(() => {
    if (isOpen) {
      closeRef.current?.focus();
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [isOpen]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) closeModal();
  }, [closeModal]);

  return (
    <>
      <div
        className={`card collapsible-card${isOpen ? ' is-modal-open' : ''}${className ? ` ${className}` : ''}`}
        style={order !== undefined ? { order } : undefined}
        id={domId}
      >
        <button
          type="button"
          className="collapsible-card-header card-header"
          onClick={openModal}
        >
          <span className="collapsible-title-wrap">{title}</span>
          {headerMeta && (
            <span className="collapsible-header-right">
              <span className="collapsible-header-meta">{headerMeta}</span>
            </span>
          )}
        </button>
        {preview ? (
          <>
            <span className="sr-only">{summary}</span>
            <div className="card-preview">{preview}</div>
          </>
        ) : (
          <div className="collapsible-summary">{summary}</div>
        )}
      </div>

      {isOpen && createPortal(
        <div className="card-modal-backdrop" onClick={handleBackdropClick}>
          <div
            className="card-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelId}
          >
            <div className="card-modal-header">
              <span className="card-modal-title" id={labelId}>{title}</span>
              {headerMeta && <span className="card-modal-meta">{headerMeta}</span>}
              <button
                ref={closeRef}
                type="button"
                className="card-modal-close"
                onClick={closeModal}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="card-modal-body">
              {children}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
