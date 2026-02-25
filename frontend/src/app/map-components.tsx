import { useEffect, useMemo, useRef } from 'react';
import { Marker, useMap, useMapEvents } from 'react-leaflet';
import { AlertTriangle } from 'lucide-react';
import { APP_DISCLAIMER_TEXT } from './constants';
import type L from 'leaflet';

export function LocationMarker({ position, setPosition }: { position: L.LatLng; setPosition: (p: L.LatLng) => void }) {
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
      setPosition(e.latlng);
    },
  });

  return <Marker draggable={true} eventHandlers={eventHandlers} position={position} ref={markerRef} />;
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

export function AppDisclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <aside className={`app-disclaimer ${compact ? 'compact' : ''}`} role="note" aria-label="Safety disclaimer">
      <div className="app-disclaimer-title">
        <AlertTriangle size={14} /> Disclaimer
      </div>
      <p>{APP_DISCLAIMER_TEXT}</p>
    </aside>
  );
}
