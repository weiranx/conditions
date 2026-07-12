import { useEffect, useMemo, useRef, useState } from 'react';
import { Marker, useMap, useMapEvents } from 'react-leaflet';
import { AlertTriangle } from 'lucide-react';
import { APP_DISCLAIMER_TEXT } from './constants';
import { LegalLinks } from './legal-links';
import type { AppView } from '../hooks/useUrlState';
import type L from 'leaflet';

export function LocationMarker({ position, setPosition, locked = false }: { position: L.LatLng; setPosition: (p: L.LatLng) => void; locked?: boolean }) {
  const markerRef = useRef<L.Marker | null>(null);
  const eventHandlers = useMemo(
    () => ({
      dragend() {
        if (markerRef.current) {
          setPosition(markerRef.current.getLatLng());
        }
      },
    }),
    [setPosition],
  );

  useMapEvents({
    click(e) {
      if (locked) {
        return;
      }
      setPosition(e.latlng);
    },
  });

  return <Marker draggable={!locked} eventHandlers={eventHandlers} position={position} ref={markerRef} />;
}

export function MapUpdater({ position, zoom, focusKey }: { position: L.LatLng; zoom: number; focusKey: number }) {
  const map = useMap();
  void focusKey;
  useEffect(() => {
    map.flyTo(position, zoom, { animate: true, duration: 1.05 });
    const timeoutId = setTimeout(() => map.invalidateSize(), 400);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [position, zoom, focusKey, map]);
  return null;
}

// The map sits at the top of a long, scrollable report. With Leaflet's default
// scroll-wheel-zoom, a user scrolling straight down the page (which naturally passes the
// cursor over the map) gets their scroll hijacked into a map zoom instead. This component
// disables plain scroll-to-zoom (see `scrollWheelZoom={false}` on MapContainer) and instead
// zooms only on Ctrl/Cmd+scroll, showing a brief hint the first couple of times so the
// behavior is discoverable rather than the map just feeling "stuck".
export function CtrlScrollZoom() {
  const map = useMap();
  const [showHint, setShowHint] = useState(false);
  const hintTimeoutRef = useRef<number | null>(null);
  const hintShownCountRef = useRef(0);

  useEffect(() => {
    const container = map.getContainer();

    const handleWheel = (e: WheelEvent) => {
      const isZoomModifier = e.ctrlKey || e.metaKey;
      if (isZoomModifier) {
        e.preventDefault();
        const nextZoom = e.deltaY < 0 ? map.getZoom() + 1 : map.getZoom() - 1;
        map.setZoom(nextZoom);
        setShowHint(false);
        return;
      }
      // No modifier: let the wheel event fall through to normal page scroll. Surface a
      // short-lived hint (max twice) so users discover how to zoom without it nagging them
      // on every scroll past the map.
      if (hintShownCountRef.current < 2) {
        hintShownCountRef.current += 1;
        setShowHint(true);
        if (hintTimeoutRef.current) window.clearTimeout(hintTimeoutRef.current);
        hintTimeoutRef.current = window.setTimeout(() => setShowHint(false), 1600);
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
      if (hintTimeoutRef.current) window.clearTimeout(hintTimeoutRef.current);
    };
  }, [map]);

  if (!showHint) return null;
  return (
    <div className="map-scroll-zoom-hint" role="status">
      Hold Ctrl (⌘ on Mac) + scroll to zoom the map
    </div>
  );
}

export function AppDisclaimer({ compact = false, navigateToView }: { compact?: boolean; navigateToView?: (view: AppView) => void }) {
  return (
    <aside className={`app-disclaimer ${compact ? 'compact' : ''}`} role="note" aria-label="Safety disclaimer">
      <div className="app-disclaimer-title">
        <AlertTriangle size={14} /> Disclaimer
      </div>
      <p>{APP_DISCLAIMER_TEXT}</p>
      <LegalLinks navigateToView={navigateToView} className="app-disclaimer-legal" />
    </aside>
  );
}
