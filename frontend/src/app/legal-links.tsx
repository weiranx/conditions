import type { MouseEvent } from 'react';
import type { AppView } from '../hooks/useUrlState';

interface LegalLinksProps {
  navigateToView?: (view: AppView) => void;
  className?: string;
}

export function LegalLinks({ navigateToView, className = '' }: LegalLinksProps) {
  const handleClick = (view: 'privacy' | 'terms') => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!navigateToView || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigateToView(view);
  };

  return (
    <nav className={`legal-links ${className}`.trim()} aria-label="Legal">
      <a href="/privacy" onClick={handleClick('privacy')}>Privacy Policy</a>
      <a href="/terms" onClick={handleClick('terms')}>Terms of Use</a>
    </nav>
  );
}
