import React from 'react';
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  CloudSun,
  Clock,
  Compass,
  Info,
  Layers3,
  LoaderCircle,
  MapPin,
  Mountain,
  Route,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Sunrise,
  Timer,
  TriangleAlert,
  Wind,
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
];

export interface HomeViewProps {
  appShellClassName: string;
  isViewPending: boolean;
  searchWrapperRef: React.RefObject<HTMLDivElement | null>;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchQuery: string;
  trimmedSearchQuery: string;
  showSuggestions: boolean;
  searchLoading: boolean;
  suggestions: Suggestion[];
  activeSuggestionIndex: number;
  canUseCoordinates: boolean;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleFocus: () => void;
  handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  handleSearchSubmit: () => Promise<boolean>;
  handleSearchClear: () => void;
  handleUseTypedCoordinates: (value: string) => void;
  selectSuggestion: (suggestion: Suggestion) => void;
  setActiveSuggestionIndex: (index: number) => void;
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

      <main className="ssr-home">
        <section className="ssr-h-hero" aria-labelledby="home-hero-title">
          <div className="ssr-h-hero-coordinates" aria-hidden="true">46.8523° N&nbsp;&nbsp; 121.7603° W</div>
          <div className="ssr-h-hero-inner">
            <div className="ssr-h-hero-copy">
              <div className="ssr-h-kicker"><Sparkles size={13} aria-hidden /> Backcountry planning intelligence</div>
              <h1 id="home-hero-title">Move with the mountain,<br /><em>not against it.</em></h1>
              <p>
                One time-aware brief that connects weather, snow, avalanche, terrain, and daylight—so
                you can choose the right objective, route, and window.
              </p>
              <div className="ssr-h-proof" aria-label="Data sources included">
                <span><Check size={13} aria-hidden /> Official forecast feeds</span>
                <span><Check size={13} aria-hidden /> Hour-by-hour context</span>
                <span><Check size={13} aria-hidden /> One decision view</span>
              </div>
            </div>

            <div className="ssr-h-builder" id="build-brief">
              <div className="ssr-h-builder-head">
                <div>
                  <span className="ssr-h-builder-step">Start here</span>
                  <h2>Build your conditions brief</h2>
                </div>
                <span className="ssr-h-builder-time"><Timer size={13} aria-hidden /> 30 seconds</span>
              </div>

              <div className="ssr-h-search-block">
                <label className="ssr-h-field-label" htmlFor="location-search-input">
                  <MapPin size={13} aria-hidden /> Objective or coordinates
                </label>
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
              </div>

              <div className="ssr-h-params">
                <label className="ssr-h-param">
                  <span><CalendarDays size={13} aria-hidden /> Date</span>
                  <input type="date" value={forecastDate} min={todayDate} max={maxForecastDate} onChange={handleDateChange} />
                </label>
                <label className="ssr-h-param">
                  <span><Clock size={13} aria-hidden /> Start</span>
                  <input
                    type="time"
                    aria-label="Start time"
                    value={alpineStartTime}
                    onChange={handlePlannerTimeChange(setAlpineStartTime)}
                  />
                </label>
                <label className="ssr-h-param">
                  <span><Route size={13} aria-hidden /> Travel window</span>
                  <span className="ssr-h-window-input">
                    <input
                      type="number"
                      inputMode="numeric"
                      aria-label="Trip duration in hours"
                      min={MIN_TRAVEL_WINDOW_HOURS}
                      max={MAX_TRAVEL_WINDOW_HOURS}
                      step={1}
                      value={travelWindowHoursDraft}
                      onChange={handleTravelWindowHoursDraftChange}
                      onBlur={handleTravelWindowHoursDraftBlur}
                    />
                    hr
                  </span>
                </label>
              </div>

              <button
                type="button"
                className="ssr-h-go"
                onClick={submitSearch}
                disabled={!trimmedSearchQuery || searchLoading}
                aria-busy={searchLoading}
              >
                {searchLoading ? (
                  <><LoaderCircle size={17} className="spin" aria-hidden /> Finding your objective…</>
                ) : (
                  <>See my conditions <ArrowRight size={17} aria-hidden /></>
                )}
              </button>

              <div className="ssr-h-popular">
                <span>Or explore</span>
                {FEATURED_PEAKS.map((peak) => (
                  <button type="button" key={peak.name} onClick={() => selectSuggestion(peak)}>
                    {peak.name.split(',')[0]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <a className="ssr-h-scroll" href="#how-it-works">
            See how it works <ChevronDown size={14} aria-hidden />
          </a>
        </section>

        <section className="ssr-h-story" id="how-it-works" aria-labelledby="home-story-title">
          <div className="ssr-h-story-head">
            <div>
              <span className="ssr-h-eyebrow">Signal → window → decision</span>
              <h2 id="home-story-title">The mountain doesn’t change<br />one variable at a time.</h2>
            </div>
            <p>
              A forecast tells you what may happen. Backcountry Conditions shows how those changes
              overlap across your exact travel window—and what deserves your attention first.
            </p>
          </div>

          <div className="ssr-h-story-grid">
            <article className="ssr-h-story-card ssr-h-signals-card">
              <div className="ssr-h-card-number">01 / Gather</div>
              <div className="ssr-h-card-icon"><Layers3 aria-hidden /></div>
              <h3>Every signal, in context</h3>
              <p>Official sources are gathered around your objective, then checked for freshness and relevance.</p>
              <div className="ssr-h-signal-list" aria-label="Signals gathered">
                <span><CloudSun size={15} aria-hidden /> Weather <b>Hourly</b></span>
                <span><Snowflake size={15} aria-hidden /> Snowpack <b>Latest</b></span>
                <span><TriangleAlert size={15} aria-hidden /> Avalanche <b>Official</b></span>
                <span><Wind size={15} aria-hidden /> Wind loading <b>Modeled</b></span>
              </div>
            </article>

            <article className="ssr-h-story-card ssr-h-window-card">
              <div className="ssr-h-card-number">02 / Time</div>
              <div className="ssr-h-card-icon"><Sunrise aria-hidden /></div>
              <h3>Your day, not the daily average</h3>
              <p>Conditions are aligned to when you expect to move, climb, summit, and return.</p>
              <div className="ssr-h-timeline" aria-label="Example trip timeline">
                <div className="ssr-h-timeline-labels"><span>4 am</span><span>9 am</span><span>2 pm</span></div>
                <div className="ssr-h-timeline-track"><i /><i /><i /><b /></div>
                <div className="ssr-h-timeline-events">
                  <span><Sunrise size={14} aria-hidden /> Alpine start</span>
                  <span><Wind size={14} aria-hidden /> Gusts rise</span>
                </div>
              </div>
            </article>

            <article className="ssr-h-story-card ssr-h-decision-card">
              <div className="ssr-h-card-number">03 / Decide</div>
              <div className="ssr-h-card-icon"><Compass aria-hidden /></div>
              <h3>A brief built to act on</h3>
              <p>The result is prioritized: what supports the plan, what could change it, and what to verify.</p>
              <div className="ssr-h-sample-decision">
                <div className="ssr-h-sample-top"><span>Example outlook</span><b><ShieldCheck size={14} aria-hidden /> Caution</b></div>
                <strong>Earlier is the better window.</strong>
                <span>Winds strengthen after 11 am; exposed ridges deserve a firm turnaround time.</span>
              </div>
            </article>
          </div>
        </section>

        <section className="ssr-h-cta" aria-labelledby="home-cta-title">
          <div className="ssr-h-cta-mark" aria-hidden><Mountain /></div>
          <div>
            <span className="ssr-h-eyebrow">Your plan starts here</span>
            <h2 id="home-cta-title">Choose the window before<br />the window chooses for you.</h2>
          </div>
          <div className="ssr-h-cta-actions">
            <button type="button" onClick={() => searchInputRef.current?.focus()}>
              Build a conditions brief <ArrowRight size={16} aria-hidden />
            </button>
            <button type="button" className="secondary" onClick={openTripToolView}>Compare multiple days</button>
          </div>
        </section>

        <footer className="ssr-h-foot">
          <div className="ssr-h-foot-brand"><Mountain size={17} aria-hidden /> Backcountry Conditions</div>
          <div className="ssr-h-disclaimer">
            <Info size={15} aria-hidden />
            <span>
              Planning aid only—not a safety guarantee. Always verify official forecasts and field
              observations before committing to terrain.
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}
