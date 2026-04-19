import React from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CloudRain,
  Mountain,
  Route,
  SlidersHorizontal,
  ArrowRight,
} from 'lucide-react';
import { AppDisclaimer } from '../../app/map-components';
import { SearchBox } from '../planner/SearchBox';
import type { Suggestion } from '../../lib/search';

const FEATURED_PEAKS: Suggestion[] = [
  { name: 'Mount Rainier, Washington', lat: 46.8523, lon: -121.7603, class: 'popular', type: 'peak' },
  { name: 'Grand Teton, Wyoming', lat: 43.7417, lon: -110.8024, class: 'popular', type: 'peak' },
  { name: 'Mount Whitney, California', lat: 36.5786, lon: -118.2923, class: 'popular', type: 'peak' },
  { name: 'Longs Peak, Colorado', lat: 40.2549, lon: -105.615, class: 'popular', type: 'peak' },
  { name: 'Mount Hood, Oregon', lat: 45.3735, lon: -121.6959, class: 'popular', type: 'peak' },
  { name: 'Kings Peak, Utah', lat: 40.7764, lon: -110.3726, class: 'popular', type: 'peak' },
];

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
  handleSearchSubmit: () => void;
  handleSearchClear: () => void;
  handleUseTypedCoordinates: (value: string) => void;
  selectSuggestion: (suggestion: Suggestion) => void;
  setActiveSuggestionIndex: (index: number) => void;

  // Navigation
  navigateToPlanner: () => void;
  navigateToView: (view: 'home' | 'planner' | 'settings' | 'status' | 'trip' | 'logs') => void;
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
  navigateToPlanner,
  navigateToView,
  openTripToolView,
}: HomeViewProps) {
  return (
    <div key="view-home" className={appShellClassName} aria-busy={isViewPending}>
      <section className="home-hero">
        <div className="home-hero-main">
          <div className="home-kicker">Backcountry Conditions</div>
          <h1>Plan your next backcountry day.</h1>
          <p>All conditions in one place.</p>
          <div className="home-search-wrapper">
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
              onKeyDown={(e) => {
                handleSearchKeyDown(e);
                if (e.key === 'Enter' && searchQuery.trim()) navigateToPlanner();
              }}
              onSubmit={() => {
                handleSearchSubmit();
                if (searchQuery.trim()) navigateToPlanner();
              }}
              onClear={handleSearchClear}
              onUseCoordinates={(v) => {
                handleUseTypedCoordinates(v);
                navigateToPlanner();
              }}
              onSelectSuggestion={(s) => {
                selectSuggestion(s);
                navigateToPlanner();
              }}
              onHoverSuggestion={setActiveSuggestionIndex}
            />
          </div>
          <div className="home-actions">
            <button className="settings-btn" onClick={openTripToolView}>
              <CalendarDays size={14} /> Multi-Day Trip Tool
            </button>
            <button className="settings-btn" onClick={() => navigateToView('settings')}>
              <SlidersHorizontal size={14} /> Settings
            </button>
          </div>
        </div>
      </section>

      <section className="home-featured" aria-label="Popular objectives">
        <div className="home-featured-head">
          <span className="home-featured-label">Popular objectives</span>
          <span className="home-featured-divider" />
        </div>
        <div className="home-featured-row">
          {FEATURED_PEAKS.map((peak) => (
            <button
              key={peak.name}
              type="button"
              className="home-featured-chip"
              onClick={() => {
                selectSuggestion(peak);
                navigateToPlanner();
              }}
            >
              <Mountain size={14} aria-hidden />
              <span>{peak.name.split(',')[0]}</span>
              <ArrowRight size={13} className="home-featured-arrow" aria-hidden />
            </button>
          ))}
        </div>
      </section>

      <section className="home-section">
        <div className="home-section-head">
          <h2 className="home-section-title">Everything in one place</h2>
          <p className="home-section-sub">Synthesized from NOAA, avalanche centers, SNOTEL, and more.</p>
        </div>
        <div className="home-grid">
          <article className="home-card">
            <div className="home-card-head">
              <CloudRain size={18} />
              <h3>Weather</h3>
            </div>
            <p>Temperature, wind, precipitation, and feels-like for your start time with elevation adjustments.</p>
          </article>
          <article className="home-card">
            <div className="home-card-head">
              <Mountain size={18} />
              <h3>Snow & Avalanche</h3>
            </div>
            <p>Avalanche forecasts combined with SNOTEL and NOHRSC snowpack signals.</p>
          </article>
          <article className="home-card">
            <div className="home-card-head">
              <AlertTriangle size={18} />
              <h3>Risk Assessment</h3>
            </div>
            <p>Go/no-go decision, critical checks, and travel window based on your thresholds.</p>
          </article>
          <article className="home-card">
            <div className="home-card-head">
              <Route size={18} />
              <h3>Field Ready</h3>
            </div>
            <p>Printable reports, shareable links, and SAT-ready one-liners.</p>
          </article>
        </div>
      </section>
      <AppDisclaimer />
    </div>
  );
}
