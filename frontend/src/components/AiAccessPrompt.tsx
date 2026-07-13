import React from 'react';
import { LockKeyhole, Sparkles, X } from 'lucide-react';
import '../styles/ai-access-prompt.css';

interface AiAccessPromptProps {
  open: boolean;
  accountAvailable: boolean | null;
  onClose: () => void;
  onOpenAccount: () => void;
}

export function AiAccessPrompt({
  open,
  accountAvailable,
  onClose,
  onOpenAccount,
}: AiAccessPromptProps) {
  const primaryActionRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusTimer = window.setTimeout(() => primaryActionRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="ai-access-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="ai-access-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-access-title"
        aria-describedby="ai-access-description"
      >
        <button type="button" className="ai-access-close" onClick={onClose} aria-label="Close account prompt">
          <X size={18} aria-hidden />
        </button>
        <div className="ai-access-icon" aria-hidden>
          <Sparkles size={22} />
        </div>
        <span className="ai-access-eyebrow"><LockKeyhole size={13} aria-hidden /> Account required</span>
        <h2 id="ai-access-title">Sign in to use AI features</h2>
        <p id="ai-access-description">
          {accountAvailable === false
            ? 'AI features require an account, but accounts are temporarily unavailable on this deployment.'
            : 'Create an account or sign in to use AI analysis, report chat, snow imagery insights, and route assistance.'}
        </p>
        <div className="ai-access-actions">
          <button
            ref={primaryActionRef}
            type="button"
            className="ai-access-primary"
            onClick={onOpenAccount}
          >
            Sign in or create account
          </button>
          <button type="button" className="ai-access-secondary" onClick={onClose}>Not now</button>
        </div>
      </section>
    </div>
  );
}
