import React from 'react';
import {
  BookmarkPlus,
  BookmarkCheck,
  Link2,
  Check,
  Compass,
} from 'lucide-react';
import { SearchBox } from './SearchBox';
import type { Suggestion } from '../../lib/search';

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
  disabled?: boolean;
  hasObjective: boolean;
  objectiveIsSaved: boolean;
  handleToggleSaveObjective: () => void;
  copiedLink: boolean;
  handleCopyLink: () => void;
}

export function PlannerHeader({
  searchWrapperRef, searchInputRef, searchQuery, trimmedSearchQuery,
  showSuggestions, searchLoading, suggestions, activeSuggestionIndex,
  parsedTypedCoordinates,
  handleInputChange, handleFocus, handleSearchKeyDown,
  handleSearchClear, handleUseTypedCoordinates, selectSuggestion, setActiveSuggestionIndex,
  disabled = false,
  hasObjective, objectiveIsSaved, handleToggleSaveObjective,
  copiedLink, handleCopyLink,
}: PlannerHeaderProps) {
  const [saveMessage, setSaveMessage] = React.useState('');
  const saveMessageTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => {
    if (saveMessageTimer.current) clearTimeout(saveMessageTimer.current);
  }, []);

  const toggleSavedObjective = () => {
    const willSave = !objectiveIsSaved;
    handleToggleSaveObjective();
    setSaveMessage(willSave
      ? 'Objective saved. Find it from any location search.'
      : 'Objective removed from saved locations.');
    if (saveMessageTimer.current) clearTimeout(saveMessageTimer.current);
    saveMessageTimer.current = setTimeout(() => setSaveMessage(''), 2800);
  };

  return (
    <header className="header-section">
      <div className="planner-header-intro">
        <p className="planner-header-kicker"><Compass size={12} aria-hidden /> Decision workspace</p>
        <h1>Plan with the whole picture.</h1>
        <p className="planner-header-lede">Set an objective and timing. We’ll organize the signals that shape the call.</p>
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
          disabled={disabled}
          onInputChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleSearchKeyDown}
          onClear={handleSearchClear}
          onUseCoordinates={handleUseTypedCoordinates}
          onSelectSuggestion={selectSuggestion}
          onHoverSuggestion={setActiveSuggestionIndex}
        />

        <nav className="header-nav" aria-label="Planner controls">
          {hasObjective && (
            <button
              type="button"
              className={`secondary-btn header-nav-btn ${objectiveIsSaved ? 'is-saved' : ''}`}
              onClick={toggleSavedObjective}
              aria-pressed={objectiveIsSaved}
              title={objectiveIsSaved ? 'Remove this objective from saved locations' : 'Save this objective for faster access from search'}
            >
              {objectiveIsSaved ? <BookmarkCheck size={14} /> : <BookmarkPlus size={14} />}{' '}
              <span className="nav-btn-label">{objectiveIsSaved ? 'Objective saved' : 'Save objective'}</span>
            </button>
          )}
          <button type="button" className="secondary-btn header-nav-btn" onClick={handleCopyLink}>
            {copiedLink ? <Check size={14} /> : <Link2 size={14} />} <span className="nav-btn-label">{copiedLink ? 'Copied' : 'Share'}</span>
          </button>
        </nav>
        <span className={`planner-save-status ${saveMessage ? 'is-visible' : ''}`} role="status" aria-live="polite">
          {saveMessage}
        </span>
      </div>
    </header>
  );
}
