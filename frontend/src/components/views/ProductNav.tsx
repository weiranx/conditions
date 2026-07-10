import { CalendarRange, House, Map, Mountain, SlidersHorizontal } from 'lucide-react';
import '../../styles/page-chrome.css';

type ProductView = 'home' | 'planner' | 'settings' | 'trip';

interface ProductNavProps {
  active: 'settings' | 'trip';
  navigateToView: (view: 'home' | 'planner' | 'settings' | 'status' | 'trip' | 'logs') => void;
  openPlannerView: () => void;
}

export function ProductNav({ active, navigateToView, openPlannerView }: ProductNavProps) {
  const items: Array<{ id: ProductView; label: string; icon: typeof House; action: () => void }> = [
    { id: 'home', label: 'Home', icon: House, action: () => navigateToView('home') },
    { id: 'planner', label: 'Planner', icon: Map, action: openPlannerView },
    { id: 'trip', label: 'Trip', icon: CalendarRange, action: () => navigateToView('trip') },
    { id: 'settings', label: 'Settings', icon: SlidersHorizontal, action: () => navigateToView('settings') },
  ];

  return (
    <header className="ssr-product-nav">
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
            onClick={action}
          >
            <Icon size={15} aria-hidden />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </header>
  );
}
