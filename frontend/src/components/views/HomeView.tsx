import React from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Clock,
  CloudRain,
  Mountain,
  Route,
  Snowflake,
  Activity,
  ArrowRight,
  Check,
  Info,
} from 'lucide-react';
import { SearchBox } from '../planner/SearchBox';
import type { Suggestion } from '../../lib/search';
import { MAX_TRAVEL_WINDOW_HOURS, MIN_TRAVEL_WINDOW_HOURS } from '../../app/constants';
import '../../styles/home-redesign.css';

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
  handleSearchSubmit: () => void;
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
  openTripToolView,
}: HomeViewProps) {
  const submitSearch = () => {
    handleSearchSubmit();
    if (searchQuery.trim()) navigateToPlanner();
  };

  return (
    <div key="view-home" className={appShellClassName} aria-busy={isViewPending}>
      <div className="ssr-home">
        {/* HERO */}
        <section className="ssr-h-hero">
          <svg className="ssr-h-topo" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1120 420">
            <g fill="none" strokeWidth="1">
              <path d="M-20 340 Q 200 260 420 320 T 900 300 T 1200 340" />
              <path d="M-20 380 Q 220 300 440 360 T 920 340 T 1200 380" />
              <path d="M-20 60 Q 260 20 500 55 T 940 40 T 1200 70" />
              <path d="M-20 100 Q 280 60 520 95 T 960 80 T 1200 110" />
            </g>
          </svg>
          <div className="ssr-h-kicker">Backcountry conditions, synthesized</div>
          <h1>
            Know before you go.
            <br />
            <span className="ssr-accent">One brief, every signal.</span>
          </h1>
          <p className="ssr-lede">
            Enter an objective and your start time. We pull weather, avalanche, snowpack, and alerts
            into a single time-aware go/no-go call.
          </p>

          {/* SEARCH CONSOLE */}
          <div className="ssr-h-console">
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
                showGoButton={false}
                onInputChange={handleInputChange}
                onFocus={handleFocus}
                onKeyDown={(e) => {
                  handleSearchKeyDown(e);
                  if (e.key === 'Enter' && searchQuery.trim()) navigateToPlanner();
                }}
                onSubmit={submitSearch}
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
              <button type="button" className="ssr-h-go" onClick={submitSearch}>
                Get conditions <ArrowRight size={16} aria-hidden />
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
              <div className="ssr-h-param-note">
                Reports are scored for your exact start time and travel window.
              </div>
            </div>
          </div>

          {/* POPULAR */}
          <div className="ssr-h-popular">
            <span className="ssr-h-popular-label">Popular</span>
            {FEATURED_PEAKS.map((peak) => {
              const shortName = peak.name.split(',')[0];
              return (
                <button
                  type="button"
                  className="ssr-h-chip"
                  key={peak.name}
                  onClick={() => {
                    selectSuggestion(peak);
                    navigateToPlanner();
                  }}
                >
                  <Mountain size={13} aria-hidden />
                  {shortName}
                  {PEAK_ELEVATIONS[shortName] && <span className="ssr-st">{PEAK_ELEVATIONS[shortName]}</span>}
                </button>
              );
            })}
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="ssr-h-section">
          <div className="ssr-h-section-head">
            <h2>From objective to decision in one screen</h2>
            <p>No tab-hopping between five forecast sites. One synthesized brief.</p>
          </div>
          <div className="ssr-h-steps">
            <div className="ssr-h-step">
              <div className="ssr-h-step-num">1</div>
              <h3>Pick your objective</h3>
              <p>Search any peak or drop a pin. Set the date, alpine start, and how long you'll be out.</p>
            </div>
            <div className="ssr-h-step">
              <div className="ssr-h-step-num">2</div>
              <h3>We synthesize the signals</h3>
              <p>Weather, avalanche bulletins, snowpack, alerts, and terrain — scored against your thresholds and timing.</p>
            </div>
            <div className="ssr-h-step">
              <div className="ssr-h-step-num">3</div>
              <h3>Get a go/no-go call</h3>
              <p>A safety score, critical-check gates, and the cleanest travel window — printable and shareable.</p>
            </div>
          </div>
        </section>

        {/* SAMPLE PREVIEW */}
        <section className="ssr-h-section">
          <div className="ssr-h-section-head">
            <h2>A real brief, not a dashboard</h2>
            <p>Every report answers one question: should you commit, right now?</p>
          </div>
          <div className="ssr-h-preview">
            <div className="ssr-h-preview-verdict">
              <span className="ssr-h-preview-pill">Caution</span>
              <div className="ssr-h-preview-score">71<sub>/100</sub></div>
              <div className="ssr-h-preview-obj">
                <b>Mt. Shasta · Avalanche Gulch</b>
                Apr 22 · 04:30 start · 12h window
              </div>
            </div>
            <div className="ssr-h-preview-body">
              <p className="ssr-h-preview-headline">Short but real window — be off the gulch by 11:30.</p>
              <div className="ssr-h-preview-checks">
                <div className="ssr-h-preview-check">
                  <span className="ssr-h-check-ic ok"><Check size={12} strokeWidth={3} /></span>
                  <span>Overnight refreeze solid below 11k</span>
                  <span className="ssr-h-check-val">22°F</span>
                </div>
                <div className="ssr-h-preview-check">
                  <span className="ssr-h-check-ic warn"><AlertTriangle size={12} /></span>
                  <span>Wet-loose hazard on solar aspects after 10:30</span>
                  <span className="ssr-h-check-val">D1–D2</span>
                </div>
                <div className="ssr-h-preview-check">
                  <span className="ssr-h-check-ic warn"><AlertTriangle size={12} /></span>
                  <span>Ridge gusts climb through the afternoon</span>
                  <span className="ssr-h-check-val">G48</span>
                </div>
                <div className="ssr-h-preview-check">
                  <span className="ssr-h-check-ic ok"><Check size={12} strokeWidth={3} /></span>
                  <span>Precipitation below threshold all window</span>
                  <span className="ssr-h-check-val">5%</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SIGNALS */}
        <section className="ssr-h-section">
          <div className="ssr-h-section-head">
            <h2>Everything in one place</h2>
            <p>Pulled live from public forecast infrastructure, refreshed and freshness-tagged.</p>
          </div>
          <div className="ssr-h-signals">
            <div className="ssr-h-signal">
              <div className="ssr-h-signal-ic"><CloudRain size={19} /></div>
              <h3>Weather</h3>
              <p>Hourly temp, wind, gusts, and precip across your window — elevation-adjusted.</p>
              <div className="ssr-sources">NOAA/NWS · Open-Meteo</div>
            </div>
            <div className="ssr-h-signal">
              <div className="ssr-h-signal-ic"><AlertTriangle size={19} /></div>
              <h3>Avalanche</h3>
              <p>Danger ratings, problems, and bottom line scored for your aspect and timing.</p>
              <div className="ssr-sources">Avalanche.org centers</div>
            </div>
            <div className="ssr-h-signal">
              <div className="ssr-h-signal-ic"><Snowflake size={19} /></div>
              <h3>Snowpack</h3>
              <p>Station depth, SWE, and how it compares to the 30-year average.</p>
              <div className="ssr-sources">SNOTEL · NOHRSC</div>
            </div>
            <div className="ssr-h-signal">
              <div className="ssr-h-signal-ic"><Route size={19} /></div>
              <h3>Route analysis</h3>
              <p>Multi-waypoint briefings with per-waypoint conditions and go/no-go.</p>
              <div className="ssr-sources">AI-assisted</div>
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
          <div className="ssr-h-foot-links">
            <button type="button" onClick={() => navigateToView('status')}>Status</button>
            <button type="button" onClick={openTripToolView}>Multi-Day Trip</button>
            <button type="button" onClick={() => navigateToView('settings')}>Settings</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
