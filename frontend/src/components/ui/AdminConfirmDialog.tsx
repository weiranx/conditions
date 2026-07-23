import React from 'react';
import { AlertTriangle } from 'lucide-react';
import '../../styles/admin-confirm-dialog.css';

export type AdminConfirmTone = 'danger' | 'caution';

export interface AdminConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: AdminConfirmTone;
}

interface AdminConfirmDialogProps {
  request: AdminConfirmRequest | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function AdminConfirmDialog({
  request,
  onCancel,
  onConfirm,
}: AdminConfirmDialogProps) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const cancelButtonRef = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => {
    if (!request) return undefined;

    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    if (dialog && !dialog.open) dialog.showModal();
    const focusFrame = window.requestAnimationFrame(() => cancelButtonRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (dialog?.open) dialog.close();
      previouslyFocused?.focus();
    };
  }, [request]);

  if (!request) return null;

  const tone = request.tone ?? 'danger';

  return (
    <dialog
      ref={dialogRef}
      className={`admin-confirm-dialog is-${tone}`}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const clickedOutside = event.clientX < bounds.left
          || event.clientX > bounds.right
          || event.clientY < bounds.top
          || event.clientY > bounds.bottom;
        if (clickedOutside) onCancel();
      }}
    >
      <div className="admin-confirm-card">
        <span className="admin-confirm-icon" aria-hidden>
          <AlertTriangle size={21} />
        </span>
        <div className="admin-confirm-copy">
          <span className="admin-confirm-eyebrow">
            {tone === 'danger' ? 'Confirm sensitive action' : 'Review this change'}
          </span>
          <h2 id={titleId}>{request.title}</h2>
          <p id={descriptionId}>{request.description}</p>
        </div>
        <div className="admin-confirm-actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="admin-confirm-cancel"
            onClick={onCancel}
          >
            {request.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            className="admin-confirm-submit"
            onClick={onConfirm}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
