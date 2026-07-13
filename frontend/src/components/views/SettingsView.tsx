import React from 'react';
import {
  Clock,
  Eye,
  Ruler,
  Gauge,
  Footprints,
  CircleUserRound,
  Check,
  X,
  FlaskConical,
} from 'lucide-react';
import type {
  ElevationUnit,
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
import { ACTIVITY_PROFILES, ACTIVITY_PROFILE_ORDER } from '../../app/activity-profiles';
import '../../styles/settings-redesign.css';
import { ProductNav } from './ProductNav';
import type { AppView } from '../../hooks/useUrlState';
import { useAccount } from '../../hooks/useAccount';
import { AccountView } from './AccountView';

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
  updatePreferences: (patch: Partial<UserPreferences>) => void;

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
  navigateToView: (view: AppView) => void;
  openPlannerView: () => void;
  openTripToolView: () => void;
  initialSection?: 'timing' | 'account';
}

type SettingsSection = 'timing' | 'activity' | 'appearance' | 'units' | 'thresholds' | 'account';

const THEME_OPTIONS: Array<[ThemeMode, string]> = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];
const TEMP_OPTIONS: Array<[TemperatureUnit, string]> = [['f', '°F'], ['c', '°C']];
const ELEV_OPTIONS: Array<[ElevationUnit, string]> = [['ft', 'Feet'], ['m', 'Meters']];
const WIND_OPTIONS: Array<[WindSpeedUnit, string]> = [['mph', 'mph'], ['kph', 'kph']];
const TIME_OPTIONS: Array<[TimeStyle, string]> = [['ampm', '12-hour'], ['24h', '24-hour']];

function Seg<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="ssr-seg" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Thresh({
  label, value, min, max, step, unit, onChange, onCommit,
}: {
  label: string;
  value: string | number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCommit: () => void;
}) {
  return (
    <div className="ssr-set-thresh">
      <span className="ssr-set-thresh-label">{label}</span>
      <span className="ssr-set-thresh-val">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={onChange}
          onBlur={onCommit}
          aria-label={label}
        />
        <span className="ssr-unit">{unit}</span>
      </span>
      <input
        className="ssr-set-thresh-slider"
        type="range"
        value={Number.isFinite(Number(value)) && String(value) !== '' ? Number(value) : min}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
        onPointerUp={onCommit}
        onBlur={onCommit}
        aria-label={`${label} slider`}
      />
      <div className="ssr-set-thresh-track"><span>{min}{unit}</span><span>{max}{unit}</span></div>
    </div>
  );
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
  updatePreferences,
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
  openTripToolView,
  initialSection = 'timing',
}: SettingsViewProps) {
  const account = useAccount();
  const [activeSection, setActiveSection] = React.useState<SettingsSection>(initialSection);

  React.useEffect(() => {
    setActiveSection(initialSection);
    if (initialSection !== 'account') {
      return undefined;
    }
    const animationFrame = window.requestAnimationFrame(() => {
      document.getElementById('ssr-set-account')?.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [initialSection]);

  const goToSection = (id: SettingsSection) => {
    setActiveSection(id);
    document.getElementById(`ssr-set-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Live gate check — uses committed canonical preference values (mph / % / °F).
  const sample = { gust: 32, precip: 5, feelsLike: 16, heat: 71 };
  const gates = [
    { label: 'Wind gust under ceiling', val: sample.gust, lim: preferences.maxWindGustMph, unit: 'mph', ok: sample.gust < preferences.maxWindGustMph, cmp: '<' },
    { label: 'Precip chance under ceiling', val: sample.precip, lim: preferences.maxPrecipChance, unit: '%', ok: sample.precip < preferences.maxPrecipChance, cmp: '<' },
    { label: 'Feels-like above floor', val: sample.feelsLike, lim: preferences.minFeelsLikeF, unit: '°F', ok: sample.feelsLike > preferences.minFeelsLikeF, cmp: '>' },
    { label: 'Heat under ceiling', val: sample.heat, lim: preferences.maxFeelsLikeF, unit: '°F', ok: sample.heat < preferences.maxFeelsLikeF, cmp: '<' },
  ];

  const railItem = (id: SettingsSection, icon: React.ReactNode, label: string) => (
    <button type="button" className={activeSection === id ? 'on' : ''} onClick={() => goToSection(id)}>
      {icon} {label}
    </button>
  );

  return (
    <div key="view-settings" className={appShellClassName} aria-busy={isViewPending}>
      <div className="ssr-settings">
        <ProductNav
          active="settings"
          navigateToView={navigateToView}
          openPlannerView={openPlannerView}
          openTripToolView={openTripToolView}
        />
        <div className="ssr-set-head">
          <div className="ssr-set-kicker">Preferences and profile</div>
          <h1>Settings &amp; account</h1>
          <p>
            {account.user ? 'Defaults saved to your account.' : 'Defaults for this browser.'}
            {' '}Shared planner links can still override any value for a single report.
          </p>
        </div>

        <div className="ssr-set-layout">
          {/* RAIL */}
          <nav className="ssr-set-rail" aria-label="Settings sections">
            {railItem('timing', <Clock />, 'Timing')}
            {railItem('activity', <Footprints />, 'Objective')}
            {railItem('appearance', <Eye />, 'Appearance')}
            {railItem('units', <Ruler />, 'Units & time')}
            {railItem('thresholds', <Gauge />, 'Thresholds')}
            <div className="ssr-set-rail-sep" aria-hidden="true" />
            {railItem('account', <CircleUserRound />, 'Account')}
            <div className="ssr-set-rail-foot" role="status" aria-live="polite">
              {account.preferenceSyncState === 'error' ? <X /> : <Check />}
              {account.user
                ? account.preferenceSyncState === 'saving'
                  ? 'Saving to your account…'
                  : account.preferenceSyncState === 'error'
                    ? account.preferenceError || 'Account sync needs a retry.'
                    : 'Saved to your account.'
                : 'Changes save automatically in this browser.'}
            </div>
          </nav>

          {/* PANELS */}
          <div className="ssr-set-panels">
            {/* TIMING */}
            <section className="ssr-set-card" id="ssr-set-timing">
              <div className="ssr-set-card-h">
                <h2><Clock /> Default timing</h2>
                <p>Applied when you start a new objective without shared time values.</p>
              </div>
              <div className="ssr-set-row">
                <span className="ssr-set-row-label">
                  Alpine start time
                  <span className="ssr-hint">Reports score conditions forward from this start across your travel window.</span>
                </span>
                <input
                  className="ssr-set-time-input"
                  type="time"
                  value={preferences.defaultStartTime}
                  onChange={(e) => handlePreferenceTimeChange('defaultStartTime', e.target.value)}
                  aria-label="Alpine start time"
                />
              </div>
              <Thresh
                label="Travel window length"
                value={travelWindowHoursDraft}
                min={MIN_TRAVEL_WINDOW_HOURS}
                max={MAX_TRAVEL_WINDOW_HOURS}
                step={1}
                unit="h"
                onChange={handleTravelWindowHoursDraftChange}
                onCommit={handleTravelWindowHoursDraftBlur}
              />
            </section>

            {/* OBJECTIVE + ROUTE TIMING PROFILE */}
            <section className="ssr-set-card" id="ssr-set-activity">
              <div className="ssr-set-card-h">
                <h2><Footprints /> Objective profile</h2>
                <p>Sets a starting point for weather gates and GPX timing. Lightning and unknown avalanche danger remain verification gates in every profile.</p>
              </div>
              <div className="ssr-set-activity-grid" role="radiogroup" aria-label="Objective profile">
                {ACTIVITY_PROFILE_ORDER.map((profileKey) => {
                  const profile = ACTIVITY_PROFILES[profileKey];
                  const selected = preferences.defaultActivity === profileKey;
                  return (
                    <button
                      key={profileKey}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={selected ? 'is-selected' : ''}
                      onClick={() => updatePreferences(profile.preferencePatch)}
                    >
                      <strong>{profile.label}</strong>
                      <span>{profile.description}</span>
                    </button>
                  );
                })}
              </div>
              <div className="ssr-set-subhead">
                <strong>Route timing assumptions</strong>
                <span>Used to estimate GPX checkpoint arrivals; edit these for your party and conditions.</span>
              </div>
              <Thresh
                label="Flat / rolling travel pace"
                value={preferences.runnerPaceMinutesPerMile}
                min={5}
                max={90}
                step={1}
                unit="min/mi"
                onChange={(e) => updatePreferences({ runnerPaceMinutesPerMile: Math.max(5, Math.min(90, Number(e.target.value) || 5)) })}
                onCommit={() => undefined}
              />
              <Thresh
                label="Ascent allowance"
                value={preferences.runnerAscentMinutesPer1000Ft}
                min={0}
                max={120}
                step={5}
                unit="min/1k ft"
                onChange={(e) => updatePreferences({ runnerAscentMinutesPer1000Ft: Math.max(0, Math.min(120, Number(e.target.value) || 0)) })}
                onCommit={() => undefined}
              />
              <Thresh
                label="Stops and contingency"
                value={preferences.runnerStopBufferMinutes}
                min={0}
                max={240}
                step={5}
                unit="min"
                onChange={(e) => updatePreferences({ runnerStopBufferMinutes: Math.max(0, Math.min(240, Number(e.target.value) || 0)) })}
                onCommit={() => undefined}
              />
            </section>

            {/* APPEARANCE */}
            <section className="ssr-set-card" id="ssr-set-appearance">
              <div className="ssr-set-card-h">
                <h2><Eye /> Appearance</h2>
                <p>Theme follows your system by default.</p>
              </div>
              <div className="ssr-set-row">
                <span className="ssr-set-row-label">Theme</span>
                <Seg value={preferences.themeMode} options={THEME_OPTIONS} onChange={handleThemeModeChange} />
              </div>
            </section>

            {/* UNITS */}
            <section className="ssr-set-card" id="ssr-set-units">
              <div className="ssr-set-card-h">
                <h2><Ruler /> Units &amp; time</h2>
                <p>Controls display units in report cards and exported summaries.</p>
              </div>
              <div className="ssr-set-row">
                <span className="ssr-set-row-label">Temperature</span>
                <Seg value={preferences.temperatureUnit} options={TEMP_OPTIONS} onChange={handleTemperatureUnitChange} />
              </div>
              <div className="ssr-set-row">
                <span className="ssr-set-row-label">Elevation</span>
                <Seg value={preferences.elevationUnit} options={ELEV_OPTIONS} onChange={handleElevationUnitChange} />
              </div>
              <div className="ssr-set-row">
                <span className="ssr-set-row-label">Wind speed</span>
                <Seg value={preferences.windSpeedUnit} options={WIND_OPTIONS} onChange={handleWindSpeedUnitChange} />
              </div>
              <div className="ssr-set-row">
                <span className="ssr-set-row-label">Time style</span>
                <Seg value={preferences.timeStyle} options={TIME_OPTIONS} onChange={handleTimeStyleChange} />
              </div>
            </section>

            {/* THRESHOLDS */}
            <section className="ssr-set-card" id="ssr-set-thresholds">
              <div className="ssr-set-card-h">
                <h2><Gauge /> Travel window thresholds</h2>
                <p>The gates that drive the pass/fail timeline. An hour is clean only if it clears every threshold.</p>
              </div>
              <Thresh
                label={`Max wind gust`}
                value={maxWindGustDraft}
                min={windThresholdMin}
                max={windThresholdMax}
                step={windThresholdStep}
                unit={windUnitLabel}
                onChange={handleWindThresholdDisplayChange}
                onCommit={handleWindThresholdDisplayBlur}
              />
              <Thresh
                label="Max precip chance"
                value={maxPrecipChanceDraft}
                min={0}
                max={100}
                step={1}
                unit="%"
                onChange={handleMaxPrecipChanceDraftChange}
                onCommit={handleMaxPrecipChanceDraftBlur}
              />
              <Thresh
                label="Min feels-like"
                value={minFeelsLikeDraft}
                min={feelsLikeThresholdMin}
                max={feelsLikeThresholdMax}
                step={feelsLikeThresholdStep}
                unit={tempUnitLabel}
                onChange={handleFeelsLikeThresholdDisplayChange}
                onCommit={handleFeelsLikeThresholdDisplayBlur}
              />
              <Thresh
                label="Max heat (feels-like ceiling)"
                value={maxFeelsLikeDraft}
                min={heatCeilingMin}
                max={heatCeilingMax}
                step={feelsLikeThresholdStep}
                unit={tempUnitLabel}
                onChange={handleHeatCeilingDisplayChange}
                onCommit={handleHeatCeilingDisplayBlur}
              />

              <div style={{ padding: '16px 22px 20px' }}>
                <div className="ssr-set-preview">
                  <div className="ssr-set-preview-h"><FlaskConical /> Live gate check · sample 09:00 hour</div>
                  {gates.map((g, i) => (
                    <div className="ssr-set-gate" key={i}>
                      <span className={`ssr-set-gate-ic ${g.ok ? 'ok' : 'fail'}`}>
                        {g.ok ? <Check strokeWidth={3} /> : <X strokeWidth={3} />}
                      </span>
                      <span className="ssr-set-gate-label">{g.label}</span>
                      <span className="ssr-set-gate-val"><b>{g.val}{g.unit}</b> {g.cmp} {g.lim}{g.unit}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ACTIONS */}
            <section className="ssr-set-card">
              <div className="ssr-set-actions">
                <button type="button" className="ssr-btn primary" onClick={applyPreferencesToPlanner}>
                  Open planner with these settings
                </button>
                <button type="button" className="ssr-btn" onClick={resetPreferences}>Reset to defaults</button>
                <span className="ssr-spacer" />
                {account.user && account.preferenceSyncState === 'error' ? (
                  <button
                    type="button"
                    className="ssr-btn"
                    onClick={() => void account.savePreferences(preferences).catch(() => undefined)}
                  >
                    Retry account sync
                  </button>
                ) : (
                  <span className="ssr-set-autosave">
                    <Check /> {account.user ? 'Saved automatically to account' : 'Saved automatically'}
                  </span>
                )}
              </div>
              <div className="ssr-set-note">
                <b>Current defaults</b> · {ACTIVITY_PROFILES[preferences.defaultActivity].label} · Start {displayDefaultStartTime} · Theme {preferences.themeMode} · Units {preferences.temperatureUnit.toUpperCase()}/{preferences.elevationUnit}/{preferences.windSpeedUnit} · Time {preferences.timeStyle === 'ampm' ? '12h' : '24h'} · Window {travelWindowHoursLabel} · Route {preferences.runnerPaceMinutesPerMile} min/mi + {preferences.runnerAscentMinutesPer1000Ft} min/1k ft · Gust {windThresholdDisplay} · Precip {preferences.maxPrecipChance}% · Feels-like {feelsLikeThresholdDisplay} · Heat {heatCeilingDisplay}
              </div>
            </section>

            <AccountView
              appShellClassName={appShellClassName}
              isViewPending={isViewPending}
              navigateToView={navigateToView}
              openPlannerView={openPlannerView}
              openTripToolView={openTripToolView}
              preferences={preferences}
              embedded
            />
          </div>
        </div>
      </div>
    </div>
  );
}
