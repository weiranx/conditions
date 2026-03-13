import React from 'react';
import {
  House,
  Route,
} from 'lucide-react';
import { AppDisclaimer } from '../../app/map-components';
import type {
  ElevationUnit,
  ReportLayout,
  TemperatureUnit,
  ThemeMode,
  TimeStyle,
  UserPreferences,
  WindSpeedUnit,
} from '../../app/types';
import {
  MAX_TRAVEL_WINDOW_HOURS,
  MIN_TRAVEL_WINDOW_HOURS,
} from '../../app/constants';

export interface SettingsViewProps {
  appShellClassName: string;
  isViewPending: boolean;
  preferences: UserPreferences;

  // Display values
  displayDefaultStartTime: string;
  travelWindowHoursLabel: string;
  windThresholdDisplay: string;
  feelsLikeThresholdDisplay: string;
  heatCeilingDisplay: string;
  windUnitLabel: string;
  tempUnitLabel: string;

  // Draft values for threshold inputs
  travelWindowHoursDraft: string;
  maxWindGustDraft: string;
  maxPrecipChanceDraft: string;
  minFeelsLikeDraft: string;
  maxFeelsLikeDraft: string;

  // Threshold input limits
  windThresholdMin: number;
  windThresholdMax: number;
  windThresholdStep: number;
  feelsLikeThresholdMin: number;
  feelsLikeThresholdMax: number;
  feelsLikeThresholdStep: number;
  heatCeilingMin: number;
  heatCeilingMax: number;

  // Preference change handlers
  handlePreferenceTimeChange: (field: 'defaultStartTime', value: string) => void;
  handleThemeModeChange: (themeMode: ThemeMode) => void;
  handleTemperatureUnitChange: (temperatureUnit: TemperatureUnit) => void;
  handleElevationUnitChange: (elevationUnit: ElevationUnit) => void;
  handleWindSpeedUnitChange: (windSpeedUnit: WindSpeedUnit) => void;
  handleTimeStyleChange: (timeStyle: TimeStyle) => void;
  handleReportLayoutChange: (reportLayout: ReportLayout) => void;

  // Threshold draft handlers
  handleTravelWindowHoursDraftChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleTravelWindowHoursDraftBlur: () => void;
  handleWindThresholdDisplayChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleWindThresholdDisplayBlur: () => void;
  handleMaxPrecipChanceDraftChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleMaxPrecipChanceDraftBlur: () => void;
  handleFeelsLikeThresholdDisplayChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleFeelsLikeThresholdDisplayBlur: () => void;
  handleHeatCeilingDisplayChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleHeatCeilingDisplayBlur: () => void;

  // Actions
  applyPreferencesToPlanner: () => void;
  resetPreferences: () => void;
  navigateToView: (view: 'home' | 'planner' | 'settings' | 'status' | 'trip' | 'logs') => void;
  openPlannerView: () => void;
}

export function SettingsView({
  appShellClassName,
  isViewPending,
  preferences,
  displayDefaultStartTime,
  travelWindowHoursLabel,
  windThresholdDisplay,
  feelsLikeThresholdDisplay,
  heatCeilingDisplay,
  windUnitLabel,
  tempUnitLabel,
  travelWindowHoursDraft,
  maxWindGustDraft,
  maxPrecipChanceDraft,
  minFeelsLikeDraft,
  maxFeelsLikeDraft,
  windThresholdMin,
  windThresholdMax,
  windThresholdStep,
  feelsLikeThresholdMin,
  feelsLikeThresholdMax,
  feelsLikeThresholdStep,
  heatCeilingMin,
  heatCeilingMax,
  handlePreferenceTimeChange,
  handleThemeModeChange,
  handleTemperatureUnitChange,
  handleElevationUnitChange,
  handleWindSpeedUnitChange,
  handleTimeStyleChange,
  handleReportLayoutChange,
  handleTravelWindowHoursDraftChange,
  handleTravelWindowHoursDraftBlur,
  handleWindThresholdDisplayChange,
  handleWindThresholdDisplayBlur,
  handleMaxPrecipChanceDraftChange,
  handleMaxPrecipChanceDraftBlur,
  handleFeelsLikeThresholdDisplayChange,
  handleFeelsLikeThresholdDisplayBlur,
  handleHeatCeilingDisplayChange,
  handleHeatCeilingDisplayBlur,
  applyPreferencesToPlanner,
  resetPreferences,
  navigateToView,
  openPlannerView,
}: SettingsViewProps) {
  return (
    <div key="view-settings" className={appShellClassName} aria-busy={isViewPending}>
      <section className="settings-shell">
        <div className="settings-head">
          <div>
            <div className="home-kicker">Backcountry Conditions Preferences</div>
            <h2>Settings</h2>
            <p>Set default planning values for this device. Shared links can still override these values.</p>
          </div>
          <div className="settings-nav">
            <button className="settings-btn" onClick={() => navigateToView('home')}>
              <House size={14} /> Homepage
            </button>
            <button className="primary-btn" onClick={openPlannerView}>
              <Route size={14} /> Planner
            </button>
          </div>
        </div>

        <div className="settings-grid">
          <article className="settings-card">
            <h3>Default timing</h3>
            <p>Applied when you start a new objective without shared time values.</p>
            <div className="settings-time-row">
              <label className="date-control">
                <span>Start time</span>
                <input type="time" value={preferences.defaultStartTime} onChange={(e) => handlePreferenceTimeChange('defaultStartTime', e.target.value)} />
              </label>
            </div>
          </article>

          <article className="settings-card">
            <h3>Appearance</h3>
            <p>Theme follows your system by default. Override it here if needed.</p>
            <div className="settings-theme-row">
              <button type="button" className={`theme-chip ${preferences.themeMode === 'system' ? 'active' : ''}`} onClick={() => handleThemeModeChange('system')}>
                System
              </button>
              <button type="button" className={`theme-chip ${preferences.themeMode === 'light' ? 'active' : ''}`} onClick={() => handleThemeModeChange('light')}>
                Light
              </button>
              <button type="button" className={`theme-chip ${preferences.themeMode === 'dark' ? 'active' : ''}`} onClick={() => handleThemeModeChange('dark')}>
                Dark
              </button>
            </div>
            <div style={{ marginTop: '16px' }}>
              <label className="settings-number-row">
                <span>Report layout</span>
                <div className="settings-theme-row">
                  <button type="button" className={`theme-chip ${preferences.reportLayout === 'cards' ? 'active' : ''}`} onClick={() => handleReportLayoutChange('cards')}>
                    Cards
                  </button>
                  <button type="button" className={`theme-chip ${preferences.reportLayout === 'briefing' ? 'active' : ''}`} onClick={() => handleReportLayoutChange('briefing')}>
                    Briefing
                  </button>
                </div>
              </label>
            </div>
          </article>

          <article className="settings-card">
            <h3>Units & time</h3>
            <p>Controls display units in report cards and exported summaries.</p>
            <div className="settings-time-row">
              <label className="settings-number-row">
                <span>Temperature</span>
                <div className="settings-theme-row">
                  <button type="button" className={`theme-chip ${preferences.temperatureUnit === 'f' ? 'active' : ''}`} onClick={() => handleTemperatureUnitChange('f')}>
                    °F
                  </button>
                  <button type="button" className={`theme-chip ${preferences.temperatureUnit === 'c' ? 'active' : ''}`} onClick={() => handleTemperatureUnitChange('c')}>
                    °C
                  </button>
                </div>
              </label>
              <label className="settings-number-row">
                <span>Elevation</span>
                <div className="settings-theme-row">
                  <button type="button" className={`theme-chip ${preferences.elevationUnit === 'ft' ? 'active' : ''}`} onClick={() => handleElevationUnitChange('ft')}>
                    ft
                  </button>
                  <button type="button" className={`theme-chip ${preferences.elevationUnit === 'm' ? 'active' : ''}`} onClick={() => handleElevationUnitChange('m')}>
                    m
                  </button>
                </div>
              </label>
              <label className="settings-number-row">
                <span>Wind speed</span>
                <div className="settings-theme-row">
                  <button type="button" className={`theme-chip ${preferences.windSpeedUnit === 'mph' ? 'active' : ''}`} onClick={() => handleWindSpeedUnitChange('mph')}>
                    mph
                  </button>
                  <button type="button" className={`theme-chip ${preferences.windSpeedUnit === 'kph' ? 'active' : ''}`} onClick={() => handleWindSpeedUnitChange('kph')}>
                    kph
                  </button>
                </div>
              </label>
              <label className="settings-number-row">
                <span>Time style</span>
                <div className="settings-theme-row">
                  <button type="button" className={`theme-chip ${preferences.timeStyle === 'ampm' ? 'active' : ''}`} onClick={() => handleTimeStyleChange('ampm')}>
                    12h (AM/PM)
                  </button>
                  <button type="button" className={`theme-chip ${preferences.timeStyle === '24h' ? 'active' : ''}`} onClick={() => handleTimeStyleChange('24h')}>
                    24h
                  </button>
                </div>
              </label>
            </div>
          </article>

          <article className="settings-card">
            <h3>Travel window thresholds</h3>
            <p>Used by the pass/fail timeline in planner view.</p>
            <div className="settings-time-row">
              <label className="settings-number-row">
                <span>Window length (hours)</span>
                <input
                  type="number"
                  min={MIN_TRAVEL_WINDOW_HOURS}
                  max={MAX_TRAVEL_WINDOW_HOURS}
                  step={1}
                  value={travelWindowHoursDraft}
                  onChange={handleTravelWindowHoursDraftChange}
                  onBlur={handleTravelWindowHoursDraftBlur}
                />
              </label>
              <label className="settings-number-row">
                <span>Max gust ({windUnitLabel})</span>
                <input
                  type="number"
                  min={windThresholdMin}
                  max={windThresholdMax}
                  step={windThresholdStep}
                  value={maxWindGustDraft}
                  onChange={handleWindThresholdDisplayChange}
                  onBlur={handleWindThresholdDisplayBlur}
                />
              </label>
              <label className="settings-number-row">
                <span>Max precip chance (%)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={maxPrecipChanceDraft}
                  onChange={handleMaxPrecipChanceDraftChange}
                  onBlur={handleMaxPrecipChanceDraftBlur}
                />
              </label>
              <label className="settings-number-row">
                <span>Min feels-like ({tempUnitLabel})</span>
                <input
                  type="number"
                  min={feelsLikeThresholdMin}
                  max={feelsLikeThresholdMax}
                  step={feelsLikeThresholdStep}
                  value={minFeelsLikeDraft}
                  onChange={handleFeelsLikeThresholdDisplayChange}
                  onBlur={handleFeelsLikeThresholdDisplayBlur}
                />
              </label>
              <label className="settings-number-row">
                <span>Max heat ({tempUnitLabel})</span>
                <input
                  type="number"
                  min={heatCeilingMin}
                  max={heatCeilingMax}
                  step={feelsLikeThresholdStep}
                  value={maxFeelsLikeDraft}
                  onChange={handleHeatCeilingDisplayChange}
                  onBlur={handleHeatCeilingDisplayBlur}
                />
              </label>
            </div>
          </article>

          <article className="settings-card settings-card-full">
            <h3>Actions</h3>
            <p>Preferences are saved in your browser and stay on this device.</p>
            <div className="settings-actions">
              <button className="primary-btn" onClick={applyPreferencesToPlanner}>
                Open Planner with These Settings
              </button>
              <button className="settings-btn settings-reset-btn" onClick={resetPreferences}>
                Reset Built-in Defaults
              </button>
            </div>
            <div className="settings-note">
              Current defaults: Start {displayDefaultStartTime} • Theme {preferences.themeMode} • Units {preferences.temperatureUnit.toUpperCase()}/{preferences.elevationUnit}/{preferences.windSpeedUnit} • Time {preferences.timeStyle === 'ampm' ? '12h' : '24h'} • Window {travelWindowHoursLabel} • Gust {windThresholdDisplay} • Precip {preferences.maxPrecipChance}% • Feels-like {feelsLikeThresholdDisplay} • Heat {heatCeilingDisplay}
            </div>
          </article>
        </div>
        <AppDisclaimer compact />
      </section>
    </div>
  );
}
