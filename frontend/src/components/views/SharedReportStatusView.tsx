import { FileWarning, Link2, LoaderCircle, RefreshCw } from 'lucide-react';
import type { AppView } from '../../hooks/useUrlState';
import { ProductNav } from './ProductNav';
import '../../styles/history.css';

interface SharedReportStatusViewProps {
  appShellClassName: string;
  error: string | null;
  navigateToView: (view: AppView) => void;
  onOpenPlanner: () => void;
  onRetry: () => void;
  openTripToolView: () => void;
}

export function SharedReportStatusView({
  appShellClassName,
  error,
  navigateToView,
  onOpenPlanner,
  onRetry,
  openTripToolView,
}: SharedReportStatusViewProps) {
  return (
    <div className={`${appShellClassName} history-page-shell`} aria-busy={!error}>
      <ProductNav
        active="planner"
        navigateToView={navigateToView}
        openPlannerView={onOpenPlanner}
        openTripToolView={openTripToolView}
      />
      <main className="history-page">
        <section className={`history-empty${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>
          {error ? <FileWarning aria-hidden /> : <Link2 aria-hidden />}
          <h1>{error ? 'Shared report unavailable' : 'Opening shared report'}</h1>
          <p>{error || 'Loading the exact saved snapshot. No conditions or AI will be regenerated.'}</p>
          {error ? (
            <div className="history-empty-actions">
              <button type="button" onClick={onRetry}><RefreshCw aria-hidden /> Try again</button>
              <button type="button" className="history-secondary-action" onClick={onOpenPlanner}>Open planner</button>
            </div>
          ) : (
            <LoaderCircle className="history-spinner" aria-hidden />
          )}
        </section>
      </main>
    </div>
  );
}
