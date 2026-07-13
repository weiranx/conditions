import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, Marker, Polyline, Popup, useMap, useMapEvents } from 'react-leaflet';
import { AlertTriangle } from 'lucide-react';
import { APP_DISCLAIMER_TEXT } from './constants';
import { LegalLinks } from './legal-links';
import type { AppView } from '../hooks/useUrlState';
import L from 'leaflet';
import type { ParsedGpxRoute } from '../lib/gpx';
import type { RouteAnalysisResult } from '../hooks/useRouteAnalysis';

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

function routeScoreColor(score: number | null | undefined): string {
  if (!Number.isFinite(Number(score))) return '#64748b';
  if (Number(score) < 40) return '#b91c1c';
  if (Number(score) < 65) return '#c2410c';
  if (Number(score) < 80) return '#ca8a04';
  return '#15803d';
}

export function RouteMapOverlay({ route, analysis }: { route: ParsedGpxRoute; analysis?: RouteAnalysisResult | null }) {
  const map = useMap();
  const positions = useMemo(
    () => route.displayTrack.map((point) => [point.lat, point.lon] as [number, number]),
    [route.displayTrack],
  );

  useEffect(() => {
    if (positions.length < 2) return;
    map.fitBounds(L.latLngBounds(positions), { padding: [28, 28], maxZoom: 14, animate: true });
    const timeoutId = window.setTimeout(() => map.invalidateSize(), 250);
    return () => window.clearTimeout(timeoutId);
  }, [map, positions]);

  return (
    <>
      <Polyline positions={positions} pathOptions={{ color: '#1d4ed8', weight: 5, opacity: 0.86 }} />
      {analysis?.waypoints.map((waypoint, index) => {
        if (!Number.isFinite(waypoint.lat) || !Number.isFinite(waypoint.lon)) return null;
        const summary = analysis.summaries[index];
        const key = `${waypoint.name}-${waypoint.lat}-${waypoint.lon}`;
        return (
          <CircleMarker
            key={key}
            center={[waypoint.lat, waypoint.lon]}
            radius={6}
            pathOptions={{ color: '#fff', weight: 2, fillColor: routeScoreColor(summary?.score), fillOpacity: 1 }}
          >
            <Popup>
              <strong>{waypoint.name}</strong><br />
              {summary?.etaTime ? `ETA ${summary.etaTime}` : 'ETA unavailable'}
              {summary?.score !== null && summary?.score !== undefined ? ` · score ${Math.round(summary.score)}` : ''}
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
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
