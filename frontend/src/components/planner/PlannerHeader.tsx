import React from 'react';
import {
  Link2,
  Check,
  Compass,
  CloudSun,
  Clock3,
  LockKeyhole,
  MapPin,
  MountainSnow,
} from 'lucide-react';
import { SearchBox } from './SearchBox';
import { GpxObjectiveInput } from './GpxObjectiveInput';
import type { Suggestion } from '../../lib/search';
import type { ParsedGpxRoute } from '../../lib/gpx';

export interface PlannerHeaderProps {
  searchWrapperRef: React.RefObject<HTMLDivElement | null>;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchQuery: string;
  trimmedSearchQuery: string;
  showSuggestions: boolean;
  searchLoading: boolean;
  suggestions: Suggestion[];
  activeSuggestionIndex: number;
  parsedTypedCoordinates: { lat: number; lon: number } | null;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleFocus: () => void;
  handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  handleSearchSubmit: () => Promise<boolean>;
  handleSearchClear: () => void;
  handleUseTypedCoordinates: (value: string) => void;
  selectSuggestion: (suggestion: Suggestion) => void;
  setActiveSuggestionIndex: (index: number) => void;
  disabled?: boolean;
  readOnly?: boolean;
  reportGeneratedAt: string | null;
  reportGeneratedAtLabel: string;
  hasObjective: boolean;
  copiedLink: boolean;
  handleCopyLink: () => void;
  importedGpxRoute: ParsedGpxRoute | null;
  handleImportGpxObjective: (route: ParsedGpxRoute) => void;
  gpxEstimatedDurationHours: number | null;
  activityLabel: string;
}

export function PlannerHeader({
  searchWrapperRef, searchInputRef, searchQuery, trimmedSearchQuery,
  showSuggestions, searchLoading, suggestions, activeSuggestionIndex,
  parsedTypedCoordinates,
  handleInputChange, handleFocus, handleSearchKeyDown,
  handleSearchClear, handleUseTypedCoordinates, selectSuggestion, setActiveSuggestionIndex,
  disabled = false,
  readOnly = false,
  reportGeneratedAt,
  reportGeneratedAtLabel,
  hasObjective,
  copiedLink, handleCopyLink,
  importedGpxRoute, handleImportGpxObjective,
  gpxEstimatedDurationHours,
  activityLabel,
}: PlannerHeaderProps) {
  const plannerControls = hasObjective ? (
    <nav className="header-nav" aria-label="Planner controls">
      <button type="button" className="secondary-btn header-nav-btn" onClick={handleCopyLink}>
        {copiedLink ? <Check size={14} /> : <Link2 size={14} />} <span className="nav-btn-label">{copiedLink ? 'Copied' : 'Share'}</span>
      </button>
    </nav>
  ) : null;

  return (
    <header className={`header-section ${hasObjective ? 'has-objective' : 'is-awaiting-objective'} ${disabled ? 'is-locked' : ''}`}>
      <div className="planner-header-intro">
        <div className="planner-header-eyebrow">
          <p className="planner-header-kicker"><Compass size={12} aria-hidden /> Decision workspace</p>
          <span className="planner-source-status"><i aria-hidden /> {readOnly ? 'Saved snapshot' : 'Live source synthesis'}</span>
        </div>
        <h1>Plan with the <em>whole picture.</em></h1>
        <p className="planner-header-lede">Set an objective and timing. We’ll organize the signals that shape the call.</p>
        <div className="planner-header-signals" aria-label="Conditions included in the report">
          <span><Compass size={13} aria-hidden /> {activityLabel}</span>
          <span><CloudSun size={13} aria-hidden /> Weather</span>
          <span><MountainSnow size={13} aria-hidden /> Snow &amp; avalanche</span>
          <span><Compass size={13} aria-hidden /> Terrain &amp; daylight</span>
        </div>
      </div>
      <div className="header-controls">
        {disabled ? (
          <div className="planner-locked-summary">
            <span className="planner-locked-label"><LockKeyhole size={13} aria-hidden /> {readOnly ? 'Read-only report' : 'Report generated'}</span>
            <div className="planner-locked-objective">
              <span className="planner-locked-icon"><MapPin size={18} aria-hidden /></span>
              <span>
                <strong>{searchQuery.trim() || 'Selected objective'}</strong>
                <small>{importedGpxRoute ? 'GPX route locked to this report' : activityLabel}</small>
                <small className="planner-report-generated-at">
                  <Clock3 size={11} aria-hidden />
                  <time dateTime={reportGeneratedAt || undefined}>Generated {reportGeneratedAtLabel}</time>
                </small>
              </span>
            </div>
            <p>{readOnly ? 'This saved snapshot cannot be changed.' : 'Inputs are locked so this report stays consistent.'} Choose <strong>New report</strong> below to edit the objective or timing.</p>
            {plannerControls}
          </div>
        ) : (
          <>
            <div className="planner-search-heading">
              <span><MapPin size={14} aria-hidden /> Choose a location or route</span>
              <small>Search a route by name or upload its GPX track</small>
            </div>
            <SearchBox
              searchWrapperRef={searchWrapperRef}
              searchInputRef={searchInputRef}
              searchQuery={searchQuery}
              trimmedSearchQuery={trimmedSearchQuery}
              showSuggestions={showSuggestions}
              searchLoading={searchLoading}
              suggestions={suggestions}
              activeSuggestionIndex={activeSuggestionIndex}
              canUseCoordinates={Boolean(parsedTypedCoordinates)}
              onInputChange={handleInputChange}
              onFocus={handleFocus}
              onKeyDown={handleSearchKeyDown}
              onClear={handleSearchClear}
              onUseCoordinates={handleUseTypedCoordinates}
              onSelectSuggestion={selectSuggestion}
              onHoverSuggestion={setActiveSuggestionIndex}
            />
            <GpxObjectiveInput
              selectedRoute={importedGpxRoute}
              onImport={handleImportGpxObjective}
              estimatedDurationHours={gpxEstimatedDurationHours}
            />

            <div className="planner-search-footer">
              <p>
                {importedGpxRoute
                  ? 'Base conditions use the route midpoint; the generated brief keeps the full track ready for checkpoint analysis.'
                  : 'Search a place or named route, or upload a GPX track. You’ll review timing before generating the brief.'}
              </p>
              {plannerControls}
            </div>
          </>
        )}
      </div>
    </header>
  );
}
