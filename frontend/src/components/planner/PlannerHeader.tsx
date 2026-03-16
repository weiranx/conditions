import React from 'react';
import {
  SlidersHorizontal,
  BookmarkPlus,
  BookmarkCheck,
  Link2,
  Check,
} from 'lucide-react';
import { SearchBox } from './SearchBox';
import type { Suggestion } from '../../lib/search';
import type { AppView } from '../../hooks/useUrlState';

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
  handleSearchSubmit: () => void;
  handleSearchClear: () => void;
  handleUseTypedCoordinates: (value: string) => void;
  selectSuggestion: (suggestion: Suggestion) => void;
  setActiveSuggestionIndex: (index: number) => void;
  hasObjective: boolean;
  objectiveIsSaved: boolean;
  handleToggleSaveObjective: () => void;
  copiedLink: boolean;
  handleCopyLink: () => void;
  navigateToView: (view: AppView) => void;
}

export function PlannerHeader({
  searchWrapperRef, searchInputRef, searchQuery, trimmedSearchQuery,
  showSuggestions, searchLoading, suggestions, activeSuggestionIndex,
  parsedTypedCoordinates,
  handleInputChange, handleFocus, handleSearchKeyDown, handleSearchSubmit,
  handleSearchClear, handleUseTypedCoordinates, selectSuggestion, setActiveSuggestionIndex,
  hasObjective, objectiveIsSaved, handleToggleSaveObjective,
  copiedLink, handleCopyLink, navigateToView,
}: PlannerHeaderProps) {
  return (
    <header className="header-section">
      <div className="brand">
        <button
          type="button"
          className="brand-mark brand-home-btn"
          onClick={() => navigateToView('home')}
          aria-label="Go to homepage"
          title="Homepage"
        >
          <img src="/summitsafe-icon.svg" alt="Backcountry Conditions" className="brand-mark-icon" />
        </button>
        <div className="brand-copy">
          <h1>Backcountry Conditions</h1>
          <p className="brand-subtitle">Backcountry planning dashboard</p>
        </div>
      </div>

      <div className="header-controls">
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
          onSubmit={handleSearchSubmit}
          onClear={handleSearchClear}
          onUseCoordinates={handleUseTypedCoordinates}
          onSelectSuggestion={selectSuggestion}
          onHoverSuggestion={setActiveSuggestionIndex}
        />

        <nav className="header-nav" aria-label="Planner controls">
          <button type="button" className="secondary-btn header-nav-btn" onClick={() => navigateToView('settings')}>
            <SlidersHorizontal size={14} /> <span className="nav-btn-label">Settings</span>
          </button>
          {hasObjective && (
            <button type="button" className="secondary-btn header-nav-btn" onClick={handleToggleSaveObjective}>
              {objectiveIsSaved ? <BookmarkCheck size={14} /> : <BookmarkPlus size={14} />}{' '}
              <span className="nav-btn-label">{objectiveIsSaved ? 'Saved' : 'Save'}</span>
            </button>
          )}
          <button type="button" className="secondary-btn header-nav-btn" onClick={handleCopyLink}>
            {copiedLink ? <Check size={14} /> : <Link2 size={14} />} <span className="nav-btn-label">{copiedLink ? 'Copied' : 'Share'}</span>
          </button>
        </nav>
      </div>
    </header>
  );
}
