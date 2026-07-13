import React from 'react';
import { AttributionControl, MapContainer, TileLayer, ScaleControl } from 'react-leaflet';
import L from 'leaflet';
import {
  Wind,
  Check,
  Mountain,
  Compass,
  Map as MapIcon,
  MapPin,
  LocateFixed,
  Layers,
  Navigation,
  Clock,
  CalendarDays,
  RefreshCw,
  SlidersHorizontal,
  PencilLine,
  Send,
  FileCheck2,
  ArrowDown,
} from 'lucide-react';
import { LocationMarker, MapUpdater, CtrlScrollZoom, RouteMapOverlay } from '../../app/map-components';
import {
  MAP_STYLE_OPTIONS,
  MAX_TRAVEL_WINDOW_HOURS,
  MIN_TRAVEL_WINDOW_HOURS,
} from '../../app/constants';
import { useProductFeatureFlags } from '../../contexts/feature-flags';

const MAP_STYLE_CYCLE: MapStyle[] = ['topo', 'street', 'satellite'];
import type { MapStyle, SafetyData, UserPreferences } from '../../app/types';
import type { ParsedGpxRoute } from '../../lib/gpx';
import type { RouteAnalysisResult } from '../../hooks/useRouteAnalysis';

export interface PlannerMapSectionProps {
  position: L.LatLng;
  activeBasemap: { url: string; attribution: string; maxNativeZoom?: number };
  preferences: UserPreferences;
  updateObjectivePosition: (pos: L.LatLng, label?: string) => void;
  mapFocusNonce: number;
  mapStyle: string;
  setMapStyle: React.Dispatch<React.SetStateAction<MapStyle>>;
  locatingUser: boolean;
  handleUseCurrentLocation: () => void;
  handleRecenterMap: () => void;
  hasObjective: boolean;
  objectiveDraftDirty: boolean;
  objectiveName: string;
  safetyData: SafetyData | null;
  mapElevationChipTitle: string;
  mapElevationLabel: string;
  mapWeatherEmoji: string;
  mapWeatherTempLabel: string;
  mapWeatherConditionLabel: string;
  mapWeatherChipTitle: string;
  mobileMapControlsExpanded: boolean;
  setMobileMapControlsExpanded: (fn: (prev: boolean) => boolean) => void;
  forecastDate: string;
  dateLabel: string;
  displayStartTime: string;
  todayDate: string;
  maxForecastDate: string;
  handleDateChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  startLabel: string;
  alpineStartTime: string;
  handlePlannerTimeChange: (setter: React.Dispatch<React.SetStateAction<string>>) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  setAlpineStartTime: React.Dispatch<React.SetStateAction<string>>;
  travelWindowHoursDraft: string | number;
  handleTravelWindowHoursDraftChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleTravelWindowHoursDraftBlur: () => void;
  objectiveTimezone: string | null;
  handleUseNowConditions: () => void;
  loading: boolean;
  handleRetryFetch: () => void;
  openTripToolView: () => void;
  timezoneMismatch: boolean;
  deviceTimezone: string | null;
  locked: boolean;
  onEditPlan: () => void;
  onGenerateReport: () => void;
  importedGpxRoute: ParsedGpxRoute | null;
  routeAnalysis: RouteAnalysisResult | null;
}

export function PlannerMapSection({
  position, activeBasemap, preferences, updateObjectivePosition, mapFocusNonce,
  mapStyle, setMapStyle, locatingUser, handleUseCurrentLocation, handleRecenterMap,
  hasObjective, objectiveDraftDirty, objectiveName, safetyData,
  mapElevationChipTitle, mapElevationLabel,
  mapWeatherEmoji, mapWeatherTempLabel, mapWeatherConditionLabel, mapWeatherChipTitle,
  mobileMapControlsExpanded, setMobileMapControlsExpanded,
  forecastDate, dateLabel, displayStartTime, todayDate, maxForecastDate, handleDateChange,
  startLabel, alpineStartTime, handlePlannerTimeChange, setAlpineStartTime,
  travelWindowHoursDraft, handleTravelWindowHoursDraftChange, handleTravelWindowHoursDraftBlur,
  objectiveTimezone, handleUseNowConditions,
  loading, handleRetryFetch, openTripToolView,
  timezoneMismatch, deviceTimezone,
  locked, onEditPlan, onGenerateReport,
  importedGpxRoute, routeAnalysis,
}: PlannerMapSectionProps) {
  const featureFlags = useProductFeatureFlags();
  React.useEffect(() => {
    if (!featureFlags.satelliteImagery && mapStyle === 'satellite') {
      setMapStyle('topo');
    }
  }, [featureFlags.satelliteImagery, mapStyle, setMapStyle]);
  const objectiveReady = hasObjective && !objectiveDraftDirty;
  let workflowTitle = 'Choose an objective';
  let workflowDetail = 'Search above or tap the map to place a pin.';
  let WorkflowStateIcon = MapPin;
  if (objectiveDraftDirty) {
    workflowTitle = 'Choose a search result';
    workflowDetail = 'Your typed search is not the selected map objective yet.';
  } else if (loading && locked) {
    workflowTitle = 'Updating current report';
    workflowDetail = 'The existing report stays visible while fresh data loads.';
    WorkflowStateIcon = RefreshCw;
  } else if (loading) {
    workflowTitle = 'Generating report';
    workflowDetail = 'Fetching the latest conditions for this plan.';
    WorkflowStateIcon = RefreshCw;
  } else if (locked) {
    workflowTitle = 'Report ready';
    workflowDetail = 'These inputs match the current results.';
    WorkflowStateIcon = FileCheck2;
  } else if (objectiveReady) {
    workflowTitle = 'Ready to generate';
    workflowDetail = 'Review the timing, then build your conditions brief.';
    WorkflowStateIcon = PencilLine;
  }

  const activeWorkflowStep = !objectiveReady ? 0 : loading || locked ? 2 : 1;
  const workflowSteps = ['Objective', 'Timing', 'Report'];

  const handleBeginEditing = () => {
    onEditPlan();
    setMobileMapControlsExpanded(() => true);
    try { window.localStorage.setItem('summitsafe:mobile-controls-expanded', 'true'); } catch { /* ignore */ }
  };

  const handleViewReport = (event: React.MouseEvent<HTMLButtonElement>) => {
    const report = document.getElementById('planner-section-decision');
    if (!report) return;
    if (event.detail === 0) {
      const heading = report.querySelector<HTMLElement>('h2');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    report.scrollIntoView({ behavior, block: 'start' });
  };

  const handleReviewTiming = (event: React.MouseEvent<HTMLButtonElement>) => {
    setMobileMapControlsExpanded(() => true);
    try { window.localStorage.setItem('summitsafe:mobile-controls-expanded', 'true'); } catch { /* ignore */ }
    window.requestAnimationFrame(() => {
      const controls = document.getElementById('planner-timing-controls');
      if (!controls) return;
      if (event.detail === 0) {
        controls.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
      }
      const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      controls.scrollIntoView({ behavior, block: 'center' });
    });
  };

  return (
    <section className={`map-shell ${locked ? 'has-report' : ''}`}>
      <div
        id="planner-plan-workflow"
        className={`planner-flowbar ${locked ? 'is-current' : objectiveReady ? 'is-ready' : 'is-awaiting'}`}
      >
        <ol className="planner-flow-steps" aria-label="Planning progress">
          {workflowSteps.map((step, index) => {
            const isComplete = index === 0
              ? objectiveReady
              : index === 1
                ? loading || locked
                : locked && !loading;
            const isActive = index === activeWorkflowStep;
            return (
              <li
                key={step}
                className={`${isComplete ? 'is-complete' : ''} ${isActive ? 'is-active' : ''}`}
                aria-current={isActive ? 'step' : undefined}
              >
                <span className="planner-flow-step-marker" aria-hidden>
                  {isComplete ? <Check size={12} /> : index + 1}
                </span>
                <span>{step}</span>
              </li>
            );
          })}
        </ol>

        <div className="map-report-workflow">
          <div className="map-report-state" role="status" aria-live="polite">
            <WorkflowStateIcon size={15} className={loading ? 'spin' : undefined} aria-hidden />
            <span>
              <strong>{workflowTitle}</strong>
              {workflowDetail}
            </span>
          </div>

          {objectiveReady && (
            <div className="planner-flow-summary" role="group" aria-label="Selected plan">
              <strong>{objectiveName || 'Dropped pin'}</strong>
              <span><time dateTime={forecastDate}>{dateLabel}</time> · {displayStartTime} · {travelWindowHoursDraft}h</span>
            </div>
          )}

          {objectiveReady && (
            <div className="map-report-actions">
              {locked ? (
                <>
                  <button
                    type="button"
                    className="action-btn plan-action-primary plan-view-report"
                    onClick={handleViewReport}
                    title="Jump to the report verdict and conditions"
                  >
                    <ArrowDown size={14} /> View report
                  </button>
                  <button
                    type="button"
                    className="action-btn"
                    onClick={handleBeginEditing}
                    disabled={loading}
                    title="Start a new report with editable location and timing"
                  >
                    <PencilLine size={14} /> New report
                  </button>
                  <button type="button" className="action-btn" onClick={handleRetryFetch} disabled={loading}>
                    <RefreshCw size={14} className={loading ? 'spin' : ''} /> {loading ? 'Updating…' : 'Update report'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="action-btn plan-review-timing"
                    onClick={handleReviewTiming}
                    disabled={loading}
                  >
                    <SlidersHorizontal size={14} /> Review timing
                  </button>
                  <button
                    type="button"
                    className="action-btn plan-action-primary"
                    onClick={onGenerateReport}
                    disabled={loading}
                    title="Generate a report for this location and timing"
                  >
                    <Send size={14} /> {loading ? 'Generating…' : 'Generate report'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="map-section">
        <MapContainer center={position} zoom={hasObjective ? 11 : 4} scrollWheelZoom={false} attributionControl={false} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            key={activeBasemap.url}
            attribution={activeBasemap.attribution}
            url={activeBasemap.url}
            maxNativeZoom={activeBasemap.maxNativeZoom}
          />
          <AttributionControl position="bottomright" prefix={false} />
          <ScaleControl
            position="bottomleft"
            imperial={preferences.elevationUnit === 'ft'}
            metric={preferences.elevationUnit === 'm'}
          />
          <LocationMarker position={position} setPosition={updateObjectivePosition} />
          <MapUpdater position={position} zoom={hasObjective ? 11 : 4} focusKey={mapFocusNonce} />
          {importedGpxRoute && <RouteMapOverlay route={importedGpxRoute} analysis={routeAnalysis} />}
          <CtrlScrollZoom />
        </MapContainer>

        <div className="map-overlay map-overlay-tr">
          <button
            type="button"
            className={`map-overlay-btn ${mapStyle !== 'topo' ? 'is-active' : ''}`}
            onClick={() => {
              const availableStyles = featureFlags.satelliteImagery ? MAP_STYLE_CYCLE : MAP_STYLE_CYCLE.slice(0, 2);
              const currentIndex = availableStyles.indexOf(mapStyle as MapStyle);
              const nextStyle = availableStyles[(currentIndex + 1) % availableStyles.length];
              setMapStyle(nextStyle);
            }}
            title={`Basemap: ${MAP_STYLE_OPTIONS[mapStyle as MapStyle].label} (tap to switch)`}
            aria-label={`Basemap: ${MAP_STYLE_OPTIONS[mapStyle as MapStyle].label} (tap to switch)`}
          >
            <Layers size={16} />
          </button>
          <button
            type="button"
            className="map-overlay-btn"
            onClick={handleUseCurrentLocation}
            disabled={locatingUser}
            title={locatingUser ? 'Locating...' : 'Use my location'}
            aria-label="Use my location"
          >
            <LocateFixed size={16} />
          </button>
          <button
            type="button"
            className="map-overlay-btn"
            onClick={handleRecenterMap}
            title="Recenter map"
            aria-label="Recenter map"
          >
            <Navigation size={16} />
          </button>
        </div>

        <div className="map-overlay map-overlay-bl">
          <span className="map-overlay-coords">
            {position.lat.toFixed(4)}, {position.lng.toFixed(4)}
          </span>
        </div>

        {objectiveReady && (
          <div className="map-overlay map-overlay-br">
            <span className={`map-overlay-info ${safetyData ? '' : 'is-pending'}`} title={mapElevationChipTitle}>
              <Mountain size={12} aria-hidden="true" />
              <span className="map-elevation-value">{mapElevationLabel}</span>
            </span>
            {(safetyData || loading) && (
              <span className={`map-overlay-info ${safetyData ? '' : 'is-pending'}`} title={mapWeatherChipTitle}>
                <span className="map-weather-chip-emoji" aria-hidden="true">{mapWeatherEmoji}</span>
                <span className="map-weather-chip-temp">{mapWeatherTempLabel}</span>
                <span className="map-weather-chip-condition">{mapWeatherConditionLabel}</span>
              </span>
            )}
          </div>
        )}
      </div>

      <div id="planner-timing-controls" className={`map-actions ${mobileMapControlsExpanded ? '' : 'is-collapsed'}`}>
        <button
          type="button"
          className="mobile-map-controls-btn"
          onClick={() => setMobileMapControlsExpanded((prev) => {
            const next = !prev;
            try { window.localStorage.setItem('summitsafe:mobile-controls-expanded', String(next)); } catch { /* ignore */ }
            return next;
          })}
          aria-expanded={mobileMapControlsExpanded}
          aria-controls="map-actions-flat"
        >
          <SlidersHorizontal size={14} />
          {mobileMapControlsExpanded ? 'Hide plan controls' : 'Show plan controls'}
        </button>

        <div id="map-actions-flat" className="map-actions-flat">
          <label className="date-control">
            <span>Date</span>
            <input type="date" value={forecastDate} min={todayDate} max={maxForecastDate} onChange={handleDateChange} disabled={locked} />
          </label>

          <label className="date-control compact">
            <span>{startLabel}</span>
            <input
              type="time"
              aria-label={startLabel}
              title="When you plan to start moving."
              value={alpineStartTime}
              onChange={handlePlannerTimeChange(setAlpineStartTime)}
              disabled={locked}
            />
          </label>

          <label className="date-control compact travel-window-control">
            <span>Trip hours</span>
            <input
              type="number"
              inputMode="numeric"
              aria-label="Trip duration in hours"
              title="How many hours to evaluate from the selected start time."
              min={MIN_TRAVEL_WINDOW_HOURS}
              max={MAX_TRAVEL_WINDOW_HOURS}
              step={1}
              value={travelWindowHoursDraft}
              onChange={handleTravelWindowHoursDraftChange}
              onBlur={handleTravelWindowHoursDraftBlur}
              disabled={locked}
            />
          </label>

          <button
            type="button"
            className="now-control-btn"
            onClick={handleUseNowConditions}
            disabled={locked}
            title={objectiveTimezone ? `Set date/time to now in ${objectiveTimezone}` : 'Set date/time to now'}
          >
            <Clock size={14} /> Now
          </button>
        </div>

        {objectiveReady && (
          <div className="map-actions-footer is-utilities-only">
          <div className="map-actions-utils">
            {featureFlags.tripPlanning && <button type="button" className="settings-btn" onClick={openTripToolView}>
              <CalendarDays size={14} /> Multi-day
            </button>}

            <div className="map-ext-links">
              <a href={`https://caltopo.com/map.html#ll=${position.lat},${position.lng}&z=14&b=mbt`} target="_blank" rel="noreferrer" className="map-ext-link-btn" title="Open in CalTopo" aria-label="Open objective in CalTopo (new tab)">
                <MapIcon size={15} aria-hidden />
              </a>
              <a href={`https://www.gaiagps.com/map/?lat=${position.lat}&lon=${position.lng}&zoom=14`} target="_blank" rel="noreferrer" className="map-ext-link-btn" title="Open in Gaia GPS" aria-label="Open objective in Gaia GPS (new tab)">
                <Compass size={15} aria-hidden />
              </a>
              <a href={`https://www.windy.com/?${position.lat},${position.lng},12`} target="_blank" rel="noreferrer" className="map-ext-link-btn" title="Open in Windy" aria-label="Open objective in Windy (new tab)">
                <Wind size={15} aria-hidden />
              </a>
            </div>
          </div>
          </div>
        )}

        {timezoneMismatch && (
          <p className="map-time-help is-warning">
            <Clock size={13} className="map-time-help-icon" aria-hidden="true" />
            <span>
              Objective timezone: <strong>{objectiveTimezone}</strong>. Your device timezone is <strong>{deviceTimezone}</strong>. Times in this report are objective-local.
            </span>
          </p>
        )}
      </div>
    </section>
  );
}
