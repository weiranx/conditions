import React from 'react';
import {
  BarChart3,
  ArrowRight,
  CalendarRange,
  CalendarDays,
  Check,
  ChevronDown,
  CloudSun,
  Clock,
  Compass,
  Database,
  Info,
  Layers3,
  LoaderCircle,
  MapPinned,
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
import { GpxObjectiveInput } from '../planner/GpxObjectiveInput';
import type { Suggestion } from '../../lib/search';
import type { ParsedGpxRoute } from '../../lib/gpx';
import { MAX_TRAVEL_WINDOW_HOURS, MIN_TRAVEL_WINDOW_HOURS } from '../../app/constants';
import '../../styles/home-redesign.css';
import { ProductNav } from './ProductNav';
import { LegalLinks } from '../../app/legal-links';
import { useProductFeatureFlags } from '../../contexts/feature-flags';
import type { AppView } from '../../hooks/useUrlState';

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
  navigateToView: (view: AppView) => void;
  openPlannerView: () => void;
  openTripToolView: () => void;
  importedGpxRoute: ParsedGpxRoute | null;
  handleImportGpxObjective: (route: ParsedGpxRoute) => void;
  gpxEstimatedDurationHours: number | null;
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
  importedGpxRoute,
  handleImportGpxObjective,
  gpxEstimatedDurationHours,
}: HomeViewProps) {
  const featureFlags = useProductFeatureFlags();
  const submitSearch = async () => {
    const didSelectObjective = await handleSearchSubmit();
    if (didSelectObjective) navigateToPlanner();
  };

  const importGpxObjective = (route: ParsedGpxRoute) => {
    handleImportGpxObjective(route);
    navigateToPlanner();
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
          <div className="ssr-h-hero-contours" aria-hidden="true"><i /><i /><i /></div>
          <div className="ssr-h-hero-coordinates" aria-hidden="true">46.8523° N&nbsp;&nbsp; 121.7603° W</div>
          <div className="ssr-h-hero-inner">
            <div className="ssr-h-hero-copy">
              <div className="ssr-h-kicker"><Sparkles size={13} aria-hidden /> Backcountry planning intelligence</div>
              <h1 id="home-hero-title">Move with the mountain,<br /><em>not against it.</em></h1>
              <p>
                Turn weather, avalanche, snowpack, terrain, and daylight into one time-aware brief—so
                you can see the best window, the reasons behind it, and what still needs verification.
              </p>
              <div className="ssr-h-proof" aria-label="Brief capabilities">
                <span><b>6+</b><small>Conditions signals</small></span>
                <span><b>Hourly</b><small>Window-level timing</small></span>
                <span><b>Visible</b><small>Age &amp; confidence</small></span>
              </div>
              <div className="ssr-h-hero-actions">
                <button type="button" onClick={() => searchInputRef.current?.focus()}>
                  Plan my objective <ArrowRight size={16} aria-hidden />
                </button>
                <a href="#home-report-title">Preview a sample brief</a>
              </div>
            </div>

            <div className="ssr-h-builder" id="build-brief">
              <div className="ssr-h-builder-status">
                <span><i aria-hidden="true" /> Live source synthesis</span>
                <small>Official + modeled data</small>
              </div>
              <div className="ssr-h-builder-head">
                <div>
                  <span className="ssr-h-builder-step">Planning workspace</span>
                  <h2>Build your conditions brief</h2>
                </div>
                <span className="ssr-h-builder-time"><Timer size={13} aria-hidden /> 30 seconds</span>
              </div>

              <div className="ssr-h-search-block">
                <label className="ssr-h-field-label" htmlFor="location-search-input">
                  <MapPin size={13} aria-hidden /> Location or route
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
                {featureFlags.gpxImport && <GpxObjectiveInput
                  selectedRoute={importedGpxRoute}
                  onImport={importGpxObjective}
                  estimatedDurationHours={gpxEstimatedDurationHours}
                />}
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
                {importedGpxRoute ? (
                  <div className="ssr-h-param ssr-h-route-estimate">
                    <span><Route size={13} aria-hidden /> Route estimate</span>
                    <strong>{gpxEstimatedDurationHours ?? travelWindowHoursDraft} hr · Objective profile</strong>
                  </div>
                ) : (
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
                )}
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
                  <>See my conditions window <ArrowRight size={17} aria-hidden /></>
                )}
              </button>

              <div className="ssr-h-builder-assurance" aria-label="Brief benefits">
                <span><Check size={12} aria-hidden /> 10 reports without an account</span>
                <span><Check size={12} aria-hidden /> Source age and confidence included</span>
              </div>

              <div className="ssr-h-popular">
                <span>Try a sample</span>
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

        <section className="ssr-h-signal-rail" aria-label="Conditions synthesized in every brief">
          <div className="ssr-h-signal-rail-inner">
            <div className="ssr-h-signal-rail-intro">
              <span>One connected picture</span>
              <strong>Six forecasts. One travel window.</strong>
            </div>
            <div className="ssr-h-signal-rail-items">
              <span><CloudSun aria-hidden /><b>Weather</b><small>Hourly</small></span>
              <span><TriangleAlert aria-hidden /><b>Avalanche</b><small>Official</small></span>
              <span><Snowflake aria-hidden /><b>Snowpack</b><small>Latest</small></span>
              <span><Layers3 aria-hidden /><b>Terrain</b><small>Route-aware</small></span>
            </div>
          </div>
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

        <section className="ssr-h-report" aria-labelledby="home-report-title">
          <div className="ssr-h-report-copy">
            <span className="ssr-h-eyebrow">A brief you can use</span>
            <h2 id="home-report-title">The answer first.<br />The evidence close behind.</h2>
            <p>
              Your report opens with the decision, the timing, and the reasons that matter most. Dig
              deeper when you need to—without hunting through six different forecasts first.
            </p>

            <div className="ssr-h-report-points">
              <div>
                <span>01</span>
                <p><strong>Know what changes the plan.</strong> Conditions are ranked by their real effect on your objective and travel window.</p>
              </div>
              <div>
                <span>02</span>
                <p><strong>See where uncertainty lives.</strong> Source age, gaps, and confidence reasons stay visible instead of being hidden.</p>
              </div>
              <div>
                <span>03</span>
                <p><strong>Leave with next steps.</strong> Get specific checks, timing adjustments, and route considerations before departure.</p>
              </div>
            </div>

            <button type="button" className="ssr-h-inline-cta" onClick={() => searchInputRef.current?.focus()}>
              Build a brief for my objective <ArrowRight size={15} aria-hidden />
            </button>
          </div>

          <div className="ssr-h-report-preview" aria-label="Example conditions brief for Mount Rainier">
            <div className="ssr-h-preview-head">
              <div>
                <span>Conditions brief</span>
                <h3>Mount Rainier</h3>
                <p>Paradise to Camp Muir · 4:00 am–4:00 pm</p>
              </div>
              <div className="ssr-h-preview-score"><b>72</b><span>/ 100</span></div>
            </div>

            <div className="ssr-h-preview-verdict">
              <div className="ssr-h-preview-status"><ShieldCheck size={15} aria-hidden /> Caution</div>
              <span className="ssr-h-preview-confidence">High confidence · updated 18 min ago</span>
              <h4>Earlier is the better window.</h4>
              <p>Firm overnight snow and light early winds support the plan. Exposed travel becomes less favorable after late morning.</p>
            </div>

            <div className="ssr-h-preview-window">
              <div className="ssr-h-preview-window-top"><span>Your travel window</span><b>4 am</b><b>8 am</b><b>12 pm</b><b>4 pm</b></div>
              <div className="ssr-h-preview-chart" aria-hidden="true">
                <span className="good" /><span className="good" /><span className="fair" /><span className="poor" />
                <i className="sunrise-marker" /><i className="wind-marker" />
              </div>
              <div className="ssr-h-preview-markers"><span><Sunrise size={12} /> Sunrise 5:24</span><span><Wind size={12} /> Gusts rise 11:00</span></div>
            </div>

            <div className="ssr-h-preview-factors">
              <div><span className="positive"><Check size={13} /></span><p><strong>Overnight freeze</strong><small>Good surface refreeze expected above 8,000 ft</small></p><b>Supports</b></div>
              <div><span className="caution"><Wind size={13} /></span><p><strong>Ridgetop wind</strong><small>Gusts build from 18 to 37 mph by noon</small></p><b>Watch</b></div>
              <div><span className="neutral"><TriangleAlert size={13} /></span><p><strong>Avalanche problem</strong><small>Wet loose becomes relevant on sun-exposed slopes</small></p><b>Verify</b></div>
            </div>

            <div className="ssr-h-preview-action"><Compass size={16} aria-hidden /><span><strong>Plan adjustment</strong> Set an 11 am turnaround for exposed upper-mountain travel.</span></div>
          </div>
        </section>

        <section className="ssr-h-tools" aria-labelledby="home-tools-title">
          <div className="ssr-h-tools-head">
            <span className="ssr-h-eyebrow">Beyond the first brief</span>
            <h2 id="home-tools-title">Keep planning as the questions get sharper.</h2>
            <p>Move from “Is Saturday viable?” to the route, start time, and fallback that make the most sense.</p>
          </div>

          <div className="ssr-h-tools-grid">
            {featureFlags.tripPlanning && <article>
              <div className="ssr-h-tool-icon"><CalendarRange aria-hidden /></div>
              <span>Compare days</span>
              <h3>Find the best day in the window.</h3>
              <p>Run the same objective and travel assumptions across several days, then carry your choice directly into Planner.</p>
              <button type="button" onClick={openTripToolView}>Open Trip tool <ArrowRight size={14} aria-hidden /></button>
            </article>}
            {featureFlags.gpxImport && <article>
              <div className="ssr-h-tool-icon"><MapPinned aria-hidden /></div>
              <span>Inspect the route</span>
              <h3>Put the forecast on your line.</h3>
              <p>Upload a GPX track to see elevation, slope, aspect, and condition changes along the route—not just at one point.</p>
              <button type="button" onClick={openPlannerView}>Explore route analysis <ArrowRight size={14} aria-hidden /></button>
            </article>}
            {featureFlags.startTimeComparisons && <article>
              <div className="ssr-h-tool-icon"><BarChart3 aria-hidden /></div>
              <span>Compare start times</span>
              <h3>See what an hour changes.</h3>
              <p>Test earlier and later departures against daylight, precipitation, heat, wind, and time-sensitive hazards.</p>
              <button type="button" onClick={openPlannerView}>Open Planner <ArrowRight size={14} aria-hidden /></button>
            </article>}
            <article>
              <div className="ssr-h-tool-icon"><Sparkles aria-hidden /></div>
              <span>Ask the report</span>
              <h3>Follow the question that matters.</h3>
              <p>Ask focused follow-ups about timing, terrain, gear, or alternatives with your actual report kept in context.</p>
              <button type="button" onClick={openPlannerView}>Build a report first <ArrowRight size={14} aria-hidden /></button>
            </article>
          </div>
        </section>

        <section className="ssr-h-sources" aria-labelledby="home-sources-title">
          <div className="ssr-h-sources-title">
            <div className="ssr-h-sources-icon"><Database aria-hidden /></div>
            <div>
              <span className="ssr-h-eyebrow">Transparent by design</span>
              <h2 id="home-sources-title">Built on sources you already trust.</h2>
              <p>Every brief keeps source age, coverage, and limitations visible so you know what the result is—and what it isn’t.</p>
            </div>
          </div>
          <div className="ssr-h-source-names" aria-label="Example data providers">
            <span><b>NWS</b> Weather</span>
            <span><b>Avalanche.org</b> Bulletins</span>
            <span><b>NRCS</b> Snowpack</span>
            <span><b>NOAA</b> Snow & climate</span>
            <span><b>OpenStreetMap</b> Search & terrain</span>
          </div>
          <div className="ssr-h-source-standards">
            <span><Check size={14} aria-hidden /> Source timestamps on every brief</span>
            <span><Check size={14} aria-hidden /> Visible partial-data warnings</span>
            <span><Check size={14} aria-hidden /> Confidence factors explained</span>
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
            {featureFlags.tripPlanning && <button type="button" className="secondary" onClick={openTripToolView}>Compare multiple days</button>}
          </div>
        </section>

        <footer className="ssr-h-foot">
          <div className="ssr-h-foot-meta">
            <div className="ssr-h-foot-brand"><Mountain size={17} aria-hidden /> Backcountry Conditions</div>
            <LegalLinks navigateToView={navigateToView} />
          </div>
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
