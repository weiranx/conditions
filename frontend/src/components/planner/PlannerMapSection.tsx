import React from 'react';
import { MapContainer, TileLayer, ScaleControl } from 'react-leaflet';
import L from 'leaflet';
import {
  Wind,
  Mountain,
  Compass,
  Map as MapIcon,
  LocateFixed,
  Layers,
  Navigation,
  Clock,
  CalendarDays,
  Zap,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { LocationMarker, MapUpdater } from '../../app/map-components';
import {
  MAX_TRAVEL_WINDOW_HOURS,
  MIN_TRAVEL_WINDOW_HOURS,
} from '../../app/constants';
import type { MapStyle, SafetyData, UserPreferences } from '../../app/types';

export interface PlannerMapSectionProps {
  position: L.LatLng;
  activeBasemap: { url: string; attribution: string };
  preferences: UserPreferences;
  updateObjectivePosition: (pos: L.LatLng, label?: string) => void;
  mapFocusNonce: number;
  mapStyle: string;
  setMapStyle: React.Dispatch<React.SetStateAction<MapStyle>>;
  locatingUser: boolean;
  handleUseCurrentLocation: () => void;
  handleRecenterMap: () => void;
  hasObjective: boolean;
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
  satelliteConditionLine: string;
  openTripToolView: () => void;
  timezoneMismatch: boolean;
  deviceTimezone: string | null;
}

export function PlannerMapSection({
  position, activeBasemap, preferences, updateObjectivePosition, mapFocusNonce,
  mapStyle, setMapStyle, locatingUser, handleUseCurrentLocation, handleRecenterMap,
  hasObjective, safetyData,
  mapElevationChipTitle, mapElevationLabel,
  mapWeatherEmoji, mapWeatherTempLabel, mapWeatherConditionLabel, mapWeatherChipTitle,
  mobileMapControlsExpanded, setMobileMapControlsExpanded,
  forecastDate, todayDate, maxForecastDate, handleDateChange,
  startLabel, alpineStartTime, handlePlannerTimeChange, setAlpineStartTime,
  travelWindowHoursDraft, handleTravelWindowHoursDraftChange, handleTravelWindowHoursDraftBlur,
  objectiveTimezone, handleUseNowConditions,
  loading, handleRetryFetch, satelliteConditionLine, openTripToolView,
  timezoneMismatch, deviceTimezone,
}: PlannerMapSectionProps) {
  return (
    <section className="map-shell" id="planner-main-content">
      <div className="map-section">
        <MapContainer center={position} zoom={hasObjective ? 11 : 4} style={{ height: '100%', width: '100%' }}>
          <TileLayer attribution={activeBasemap.attribution} url={activeBasemap.url} />
          <ScaleControl
            position="bottomleft"
            imperial={preferences.elevationUnit === 'ft'}
            metric={preferences.elevationUnit === 'm'}
          />
          <LocationMarker position={position} setPosition={updateObjectivePosition} />
          <MapUpdater position={position} zoom={hasObjective ? 11 : 4} focusKey={mapFocusNonce} />
        </MapContainer>

        <div className="map-overlay map-overlay-tr">
          <button
            type="button"
            className={`map-overlay-btn ${mapStyle === 'street' ? 'is-active' : ''}`}
            onClick={() => setMapStyle(mapStyle === 'topo' ? 'street' : 'topo')}
            title={`Switch to ${mapStyle === 'topo' ? 'street' : 'terrain'} basemap`}
            aria-label={`Switch to ${mapStyle === 'topo' ? 'street' : 'terrain'} basemap`}
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

        {hasObjective && (
          <div className="map-overlay map-overlay-br">
            <span className={`map-overlay-info ${safetyData ? '' : 'is-pending'}`} title={mapElevationChipTitle}>
              <Mountain size={12} aria-hidden="true" />
              <span className="map-elevation-value">{mapElevationLabel}</span>
            </span>
            <span className={`map-overlay-info ${safetyData ? '' : 'is-pending'}`} title={mapWeatherChipTitle}>
              <span className="map-weather-chip-emoji" aria-hidden="true">{mapWeatherEmoji}</span>
              <span className="map-weather-chip-temp">{mapWeatherTempLabel}</span>
              <span className="map-weather-chip-condition">{mapWeatherConditionLabel}</span>
            </span>
          </div>
        )}
      </div>

      <div className={`map-actions ${mobileMapControlsExpanded ? '' : 'is-collapsed'}`}>
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
            <input type="date" value={forecastDate} min={todayDate} max={maxForecastDate} onChange={handleDateChange} />
          </label>

          <label className="date-control compact">
            <span>{startLabel}</span>
            <input
              type="time"
              aria-label={startLabel}
              title="When you plan to start moving."
              value={alpineStartTime}
              onChange={handlePlannerTimeChange(setAlpineStartTime)}
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
            />
          </label>

          <button
            type="button"
            className="now-control-btn"
            onClick={handleUseNowConditions}
            title={objectiveTimezone ? `Set date/time to now in ${objectiveTimezone}` : 'Set date/time to now'}
          >
            <Clock size={14} /> Now
          </button>
        </div>

        <div className="map-actions-utils">
          <button type="button" className="action-btn" onClick={handleRetryFetch} disabled={!hasObjective || loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button type="button" className="settings-btn" onClick={openTripToolView}>
            <CalendarDays size={14} /> Multi-day
          </button>
          <button type="button" className="settings-btn" onClick={() => { if (satelliteConditionLine) { navigator.clipboard.writeText(satelliteConditionLine); } }} disabled={!satelliteConditionLine} title={satelliteConditionLine || 'SAT one-liner (load a report first)'}>
            <Zap size={14} /> SAT Msg
          </button>

          <div className="map-ext-links">
            <a href={`https://caltopo.com/map.html#ll=${position.lat},${position.lng}&z=14&b=mbt`} target="_blank" rel="noreferrer" className="map-ext-link-btn" title="CalTopo">
              <MapIcon size={15} />
            </a>
            <a href={`https://www.gaiagps.com/map/?lat=${position.lat}&lon=${position.lng}&zoom=14`} target="_blank" rel="noreferrer" className="map-ext-link-btn" title="Gaia GPS">
              <Compass size={15} />
            </a>
            <a href={`https://www.windy.com/?${position.lat},${position.lng},12`} target="_blank" rel="noreferrer" className="map-ext-link-btn" title="Windy">
              <Wind size={15} />
            </a>
          </div>
        </div>

        {timezoneMismatch && (
          <p className="map-time-help is-warning">
            Objective timezone: <strong>{objectiveTimezone}</strong>. Your device timezone is <strong>{deviceTimezone}</strong>. Times in this report are objective-local.
          </p>
        )}
      </div>
    </section>
  );
}
