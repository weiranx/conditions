import { BellRing, CalendarRange, CircleUserRound, FileClock, House, Map, Mountain, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import type { AppView } from '../../hooks/useUrlState';
import { useProductFeatureFlags } from '../../contexts/feature-flags';
import { useAccount } from '../../hooks/useAccount';
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
  const { user } = useAccount();
  const items: Array<{ id: AppView; label: string; icon: typeof House; action: () => void }> = [
    { id: 'home', label: 'Home', icon: House, action: () => navigateToView('home') },
    { id: 'planner', label: 'Planner', icon: Map, action: openPlannerView || (() => navigateToView('planner')) },
    ...(featureFlags.tripPlanning
      ? [{ id: 'trip' as const, label: 'Compare', icon: CalendarRange, action: openTripToolView || (() => navigateToView('trip')) }]
      : []),
    ...(user && featureFlags.objectiveWatch
      ? [{ id: 'watches' as const, label: 'Watches', icon: BellRing, action: () => navigateToView('watches') }]
      : []),
    ...(user
      ? [{ id: 'history' as const, label: 'History', icon: FileClock, action: () => navigateToView('history') }]
      : []),
    {
      id: 'settings',
      label: user ? 'Account' : 'Settings',
      icon: user ? CircleUserRound : SlidersHorizontal,
      action: () => navigateToView('settings'),
    },
  ];
  if (active === 'admin') {
    items.push({ id: 'admin', label: 'Admin', icon: ShieldCheck, action: () => navigateToView('admin') });
  }

  return (
    <header className="ssr-product-nav">
      <div className="ssr-product-nav-inner">
        <button type="button" className="ssr-product-brand" onClick={() => navigateToView('home')}>
          <span className="ssr-product-mark"><Mountain size={16} strokeWidth={2.2} aria-hidden /></span>
          <span className="ssr-product-brand-copy">
            <strong>Backcountry Conditions</strong>
            <small>Mountain planning intelligence</small>
          </span>
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
