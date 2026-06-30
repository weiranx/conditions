import { useState, useCallback, useEffect, useRef, useId } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronRight } from 'lucide-react';

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
          aria-haspopup="dialog"
        >
          <span className="collapsible-title-wrap">{title}</span>
          <span className="collapsible-header-right">
            {headerMeta && <span className="collapsible-header-meta">{headerMeta}</span>}
            <ChevronRight size={16} className="collapsible-chevron" aria-hidden="true" />
          </span>
        </button>
        {preview ? (
          <>
            <span className="sr-only">{summary}</span>
            {/*
              The card header above is a real <button> that already opens this
              same modal and is fully keyboard-accessible. This preview is a
              mouse/touch convenience target only — its content is duplicated
              for assistive tech via the sr-only summary span above, so it's
              hidden from the accessibility tree rather than falsely announced
              as a second, keyboard-unreachable button.
            */}
            <div className="card-preview" onClick={openModal} aria-hidden="true">{preview}</div>
          </>
        ) : (
          // No sr-only duplicate exists for this content, so it stays
          // visible to assistive tech as static text. It's not an
          // interactive element (the header button is the keyboard path to
          // open the modal), so role="button"/tabIndex are removed to avoid
          // announcing an unreachable control.
          <div className="collapsible-summary" onClick={openModal}>{summary}</div>
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
                aria-label="Close dialog"
                title="Close"
              >
                <X size={20} />
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
