import { CalendarRange, House, Map, Mountain, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import type { AppView } from '../../hooks/useUrlState';
import { useProductFeatureFlags } from '../../contexts/feature-flags';
import '../../styles/page-chrome.css';

interface ProductNavProps {
  active: AppView;
  navigateToView: (view: AppView) => void;
  openPlannerView?: () => void;
  openTripToolView?: () => void;
}

export function ProductNav({
  active,
  navigateToView,
  openPlannerView,
  openTripToolView,
}: ProductNavProps) {
  const featureFlags = useProductFeatureFlags();
  const items: Array<{ id: AppView; label: string; icon: typeof House; action: () => void }> = [
    { id: 'home', label: 'Home', icon: House, action: () => navigateToView('home') },
    { id: 'planner', label: 'Planner', icon: Map, action: openPlannerView || (() => navigateToView('planner')) },
    ...(featureFlags.tripPlanning
      ? [{ id: 'trip' as const, label: 'Trip', icon: CalendarRange, action: openTripToolView || (() => navigateToView('trip')) }]
      : []),
    { id: 'settings', label: 'Settings', icon: SlidersHorizontal, action: () => navigateToView('settings') },
  ];
  if (active === 'admin') {
    items.push({ id: 'admin', label: 'Admin', icon: ShieldCheck, action: () => navigateToView('admin') });
  }

  return (
    <header className="ssr-product-nav">
      <div className="ssr-product-nav-inner">
        <button type="button" className="ssr-product-brand" onClick={() => navigateToView('home')}>
          <span className="ssr-product-mark"><Mountain size={16} strokeWidth={2.2} aria-hidden /></span>
          <span>Backcountry Conditions</span>
        </button>
        <nav className="ssr-product-links" aria-label="Application navigation">
          {items.map(({ id, label, icon: Icon, action }) => (
            <button
              key={id}
              type="button"
              className={active === id ? 'is-active' : ''}
              aria-current={active === id ? 'page' : undefined}
              title={label}
              onClick={active === id ? undefined : action}
            >
              <Icon size={15} aria-hidden />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
