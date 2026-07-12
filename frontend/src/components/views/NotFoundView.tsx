import { ArrowRight, Compass, MapPinned } from 'lucide-react';
import type { AppView } from '../../hooks/useUrlState';
import { ProductNav } from './ProductNav';
import '../../styles/not-found.css';

interface NotFoundViewProps {
  appShellClassName: string;
  isViewPending: boolean;
  navigateToView: (view: AppView) => void;
  openPlannerView: () => void;
  openTripToolView: () => void;
}

export function NotFoundView({
  appShellClassName,
  isViewPending,
  navigateToView,
  openPlannerView,
  openTripToolView,
}: NotFoundViewProps) {
  return (
    <div key="view-not-found" className={`${appShellClassName} page-shell-not-found`} aria-busy={isViewPending}>
      <ProductNav
        active="not-found"
        navigateToView={navigateToView}
        openPlannerView={openPlannerView}
        openTripToolView={openTripToolView}
      />

      <main className="not-found-shell">
        <div className="not-found-contours" aria-hidden="true">
          <span className="not-found-route-line" />
          <span className="not-found-pin"><MapPinned size={24} /></span>
        </div>

        <section className="not-found-card" aria-labelledby="not-found-title">
          <p className="not-found-code">Error 404 · Off route</p>
          <h1 id="not-found-title">This trail doesn’t lead anywhere.</h1>
          <p className="not-found-copy">
            The page may have moved, or the address might be mistyped. Head back to familiar terrain
            and start a new conditions brief.
          </p>
          <div className="not-found-actions">
            <button type="button" className="not-found-primary" onClick={() => navigateToView('home')}>
              Return home <ArrowRight size={16} aria-hidden />
            </button>
            <button type="button" className="not-found-secondary" onClick={openPlannerView}>
              <Compass size={16} aria-hidden /> Open planner
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
