import React from 'react';
import {
  CalendarDays,
  Clock,
  Clock3,
  Mountain,
  Activity,
  ArrowRight,
  Check,
  Info,
  Layers3,
  LoaderCircle,
  RadioTower,
  Route,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { SearchBox } from '../planner/SearchBox';
import type { Suggestion } from '../../lib/search';
import { MAX_TRAVEL_WINDOW_HOURS, MIN_TRAVEL_WINDOW_HOURS } from '../../app/constants';
import '../../styles/home-redesign.css';
import { ProductNav } from './ProductNav';

const FEATURED_PEAKS: Suggestion[] = [
  { name: 'Mount Rainier, Washington', lat: 46.8523, lon: -121.7603, class: 'popular', type: 'peak' },
  { name: 'Grand Teton, Wyoming', lat: 43.7417, lon: -110.8024, class: 'popular', type: 'peak' },
  { name: 'Mount Whitney, California', lat: 36.5786, lon: -118.2923, class: 'popular', type: 'peak' },
  { name: 'Mount Hood, Oregon', lat: 45.3735, lon: -121.6959, class: 'popular', type: 'peak' },
  { name: 'Longs Peak, Colorado', lat: 40.2549, lon: -105.615, class: 'popular', type: 'peak' },
];

const PEAK_ELEVATIONS: Record<string, string> = {
  'Mount Rainier': "WA · 14,411'",
  'Grand Teton': "WY · 13,775'",
  'Mount Whitney': "CA · 14,505'",
  'Mount Hood': "OR · 11,249'",
  'Longs Peak': "CO · 14,259'",
};

export interface HomeViewProps {
  appShellClassName: string;
  isViewPending: boolean;

  // Search state
  searchWrapperRef: React.RefObject<HTMLDivElement | null>;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchQuery: string;
  trimmedSearchQuery: string;
  showSuggestions: boolean;
  searchLoading: boolean;
  suggestions: Suggestion[];
  activeSuggestionIndex: number;
  canUseCoordinates: boolean;

  // Search handlers
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleFocus: () => void;
  handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  handleSearchSubmit: () => Promise<boolean>;
  handleSearchClear: () => void;
  handleUseTypedCoordinates: (value: string) => void;
  selectSuggestion: (suggestion: Suggestion) => void;
  setActiveSuggestionIndex: (index: number) => void;

  // Trip defaults (shown in the search console, editable)
  todayDate: string;
  maxForecastDate: string;
  forecastDate: string;
  handleDateChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  alpineStartTime: string;
  handlePlannerTimeChange: (setter: React.Dispatch<React.SetStateAction<string>>) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  setAlpineStartTime: React.Dispatch<React.SetStateAction<string>>;
  travelWindowHoursDraft: string | number;
  handleTravelWindowHoursDraftChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleTravelWindowHoursDraftBlur: () => void;

  // Navigation
  navigateToPlanner: () => void;
  navigateToView: (view: 'home' | 'planner' | 'settings' | 'status' | 'trip' | 'logs') => void;
  openPlannerView: () => void;
  openTripToolView: () => void;
}

export function HomeView({
  appShellClassName,
  isViewPending,
  searchWrapperRef,
  searchInputRef,
  searchQuery,
  trimmedSearchQuery,
  showSuggestions,
  searchLoading,
  suggestions,
  activeSuggestionIndex,
  canUseCoordinates,
  handleInputChange,
  handleFocus,
  handleSearchKeyDown,
  handleSearchSubmit,
  handleSearchClear,
  handleUseTypedCoordinates,
  selectSuggestion,
  setActiveSuggestionIndex,
  todayDate,
  maxForecastDate,
  forecastDate,
  handleDateChange,
  alpineStartTime,
  handlePlannerTimeChange,
  setAlpineStartTime,
  travelWindowHoursDraft,
  handleTravelWindowHoursDraftChange,
  handleTravelWindowHoursDraftBlur,
  navigateToPlanner,
  navigateToView,
  openPlannerView,
  openTripToolView,
}: HomeViewProps) {
  const submitSearch = async () => {
    const didSelectObjective = await handleSearchSubmit();
    if (didSelectObjective) navigateToPlanner();
  };

  return (
    <div key="view-home" className={appShellClassName} aria-busy={isViewPending}>
      <ProductNav
        active="home"
        navigateToView={navigateToView}
        openPlannerView={openPlannerView}
        openTripToolView={openTripToolView}
      />
      <div className="ssr-home">
        <section className="ssr-h-hero">
          <div className="ssr-h-hero-inner">
            <div className="ssr-h-workspace">
              <div className="ssr-h-kicker">
                <span className="ssr-h-kicker-mark" aria-hidden><Sparkles size={12} /></span>
                Mountain intelligence, on your clock
              </div>
              <h1>Know the mountain <br />before you move.</h1>
              <p className="ssr-lede">
                Build a time-aware conditions brief for the exact place and window you plan to travel.
              </p>

              <div className="ssr-h-console">
                <div className="ssr-h-console-head">
                  <div>
                    <span className="ssr-h-live-dot" aria-hidden />
                    Conditions brief
                  </div>
                  <span>6 signal families · one decision view</span>
                </div>
                <div className="ssr-h-console-search">
                  <SearchBox
                    searchWrapperRef={searchWrapperRef}
                    searchInputRef={searchInputRef}
                    searchQuery={searchQuery}
                    trimmedSearchQuery={trimmedSearchQuery}
                    showSuggestions={showSuggestions}
                    searchLoading={searchLoading}
                    suggestions={suggestions}
                    activeSuggestionIndex={activeSuggestionIndex}
                    canUseCoordinates={canUseCoordinates}
                    onInputChange={handleInputChange}
                    onFocus={handleFocus}
                    onKeyDown={handleSearchKeyDown}
                    onClear={handleSearchClear}
                    onUseCoordinates={handleUseTypedCoordinates}
                    onSelectSuggestion={selectSuggestion}
                    onHoverSuggestion={setActiveSuggestionIndex}
                  />
                  <button
                    type="button"
                    className="ssr-h-go"
                    onClick={submitSearch}
                    disabled={!trimmedSearchQuery || searchLoading}
                    aria-busy={searchLoading}
                  >
                    {searchLoading ? (
                      <><LoaderCircle size={16} className="spin" aria-hidden /> Finding location…</>
                    ) : (
                      <>Build brief <ArrowRight size={16} aria-hidden /></>
                    )}
                  </button>
                </div>
                <div className="ssr-h-params">
                  <label className="ssr-h-param">
                    <span className="ssr-h-param-k"><CalendarDays size={12} /> Date</span>
                    <input
                      type="date"
                      className="ssr-h-param-v ssr-h-param-input"
                      value={forecastDate}
                      min={todayDate}
                      max={maxForecastDate}
                      onChange={handleDateChange}
                    />
                  </label>
                  <label className="ssr-h-param">
                    <span className="ssr-h-param-k"><Clock size={12} /> Start</span>
                    <input
                      type="time"
                      className="ssr-h-param-v ssr-h-param-input"
                      aria-label="Start time"
                      value={alpineStartTime}
                      onChange={handlePlannerTimeChange(setAlpineStartTime)}
                    />
                  </label>
                  <label className="ssr-h-param">
                    <span className="ssr-h-param-k"><Activity size={12} /> Window</span>
                    <span className="ssr-h-param-window">
                      <input
                        type="number"
                        inputMode="numeric"
                        className="ssr-h-param-v ssr-h-param-input"
                        aria-label="Trip duration in hours"
                        min={MIN_TRAVEL_WINDOW_HOURS}
                        max={MAX_TRAVEL_WINDOW_HOURS}
                        step={1}
                        value={travelWindowHoursDraft}
                        onChange={handleTravelWindowHoursDraftChange}
                        onBlur={handleTravelWindowHoursDraftBlur}
                      />
                      hours
                    </span>
                  </label>
                  <div className="ssr-h-param-note">Conditions are scored for your exact timing.</div>
                </div>
                <div className="ssr-h-confidence" aria-label="Brief qualities">
                  <span><RadioTower size={12} aria-hidden /> Official forecast feeds</span>
                  <span><Layers3 size={12} aria-hidden /> Cross-signal synthesis</span>
                  <span><Check size={12} aria-hidden /> Decision-ready summary</span>
                </div>
              </div>

              <div className="ssr-h-popular">
                <span className="ssr-h-popular-label">Start with</span>
                {FEATURED_PEAKS.map((peak) => {
                  const shortName = peak.name.split(',')[0];
                  return (
                    <button
                      type="button"
                      className="ssr-h-chip"
                      key={peak.name}
                      onClick={() => selectSuggestion(peak)}
                    >
                      <Mountain size={13} aria-hidden />
                      {shortName}
                      {PEAK_ELEVATIONS[shortName] && <span className="ssr-st">{PEAK_ELEVATIONS[shortName]}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="ssr-h-intro" aria-labelledby="home-features-title">
          <div className="ssr-h-intro-copy">
            <p className="ssr-h-eyebrow">One brief. The whole picture.</p>
            <h2 id="home-features-title">Know the window before you go.</h2>
            <p>
              Backcountry Conditions turns scattered forecasts into a decision-ready view of your
              objective, matched to when and where you plan to move.
            </p>
          </div>

          <div className="ssr-h-feature-grid">
            <article className="ssr-h-feature">
              <div className="ssr-h-feature-icon"><Clock3 aria-hidden /></div>
              <div>
                <span className="ssr-h-feature-label"><b>01</b> Your timing</span>
                <h3>Conditions for your exact window</h3>
                <p>See hourly weather, daylight, and changing hazards from your start through your return.</p>
              </div>
            </article>

            <article className="ssr-h-feature">
              <div className="ssr-h-feature-icon"><ShieldCheck aria-hidden /></div>
              <div>
                <span className="ssr-h-feature-label"><b>02</b> Your risk picture</span>
                <h3>Critical signals, weighed together</h3>
                <p>Weather, avalanche, snowpack, alerts, air quality, and terrain become one prioritized brief.</p>
              </div>
            </article>

            <article className="ssr-h-feature">
              <div className="ssr-h-feature-icon"><Route aria-hidden /></div>
              <div>
                <span className="ssr-h-feature-label"><b>03</b> Your next move</span>
                <h3>Planning that leads to action</h3>
                <p>Compare start times, inspect route exposure, and carry the same context into a multi-day plan.</p>
              </div>
            </article>
          </div>

          <div className="ssr-h-signal-band" aria-label="Conditions included in every brief">
            <span>Every brief considers</span>
            <div>
              <b>Weather</b>
              <b>Avalanche</b>
              <b>Snowpack</b>
              <b>Alerts</b>
              <b>Air quality</b>
              <b>Terrain</b>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="ssr-h-foot">
          <div className="ssr-h-disclaimer">
            <Info size={16} aria-hidden />
            <span>
              This is a planning aid, not a safety guarantee. Data can be delayed, incomplete, or
              incorrect. Always verify official avalanche forecasts and field observations before
              committing to terrain.
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
