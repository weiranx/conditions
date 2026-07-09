import React from 'react';
import { Bookmark, History, Mountain, Search, Star, X } from 'lucide-react';
import { isMountainSuggestion, type Suggestion } from '../../lib/search';

interface SearchBoxProps {
  searchWrapperRef: React.RefObject<HTMLDivElement | null>;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchQuery: string;
  trimmedSearchQuery: string;
  showSuggestions: boolean;
  searchLoading: boolean;
  suggestions: Suggestion[];
  activeSuggestionIndex: number;
  canUseCoordinates: boolean;
  disabled?: boolean;
  onInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onClear: () => void;
  onUseCoordinates: (value: string) => void;
  onSelectSuggestion: (suggestion: Suggestion) => void;
  onHoverSuggestion: (index: number) => void;
}

export function SearchBox({
  searchWrapperRef,
  searchInputRef,
  searchQuery,
  trimmedSearchQuery,
  showSuggestions,
  searchLoading,
  suggestions,
  activeSuggestionIndex,
  canUseCoordinates,
  disabled = false,
  onInputChange,
  onFocus,
  onKeyDown,
  onClear,
  onUseCoordinates,
  onSelectSuggestion,
  onHoverSuggestion,
}: SearchBoxProps) {
  const suggestionsListRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (showSuggestions) {
      suggestionsListRef.current?.scrollTo({ top: 0 });
    }
  }, [showSuggestions, trimmedSearchQuery]);

  return (
    <div className="search-wrapper" ref={searchWrapperRef}>
      <div className="search-bar">
        <Search size={16} />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search by peak, trailhead, zone, town, or coordinates"
          value={searchQuery}
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          onChange={onInputChange}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          disabled={disabled}
          aria-label="Search location"
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
          aria-controls="planner-suggestion-list"
          aria-activedescendant={activeSuggestionIndex >= 0 ? `suggestion-${activeSuggestionIndex}` : undefined}
        />
        {trimmedSearchQuery.length > 0 && (
          <button type="button" className="search-clear-btn" onClick={onClear} aria-label="Clear search" disabled={disabled}>
            <X size={14} />
          </button>
        )}
      </div>

      {!disabled && showSuggestions && (searchLoading || suggestions.length > 0 || trimmedSearchQuery.length > 0) && (
        <div ref={suggestionsListRef} className="suggestions-list" id="planner-suggestion-list" role="listbox" aria-label="Search suggestions">
          {searchLoading && (
            <div className="suggestion-status" role="presentation">
              Searching...
            </div>
          )}
          {!searchLoading && canUseCoordinates && (
            <button
              type="button"
              role="option"
              aria-selected={false}
              className="suggestion-item coordinate-suggestion"
              onClick={() => onUseCoordinates(trimmedSearchQuery)}
            >
              <strong className="suggestion-title">Use typed coordinates</strong>
              <span className="suggestion-subtitle">{trimmedSearchQuery}</span>
            </button>
          )}
          {!searchLoading && suggestions.length === 0 && trimmedSearchQuery.length > 0 && (
            <div className="suggestion-status" role="presentation">No matches found. Try “Mount Elbert”, “Mt Hood”, or “39.1178 -106.4452”.</div>
          )}
          {!searchLoading &&
            suggestions.map((suggestion, index) => (
              <button
                key={`${suggestion.name}-${index}`}
                id={`suggestion-${index}`}
                type="button"
                role="option"
                aria-selected={activeSuggestionIndex === index}
                className={`suggestion-item ${suggestion.class === 'popular' ? 'popular-suggestion' : ''} ${
                  suggestion.class === 'saved' ? 'saved-suggestion' : ''
                } ${suggestion.class === 'recent' ? 'recent-suggestion' : ''} ${
                  activeSuggestionIndex === index ? 'active' : ''
                }`}
                onClick={() => onSelectSuggestion(suggestion)}
                onMouseEnter={() => onHoverSuggestion(index)}
              >
                <strong className="suggestion-title">
                  {suggestion.class === 'popular' && <Star size={13} className="suggestion-title-icon" aria-hidden="true" />}
                  {suggestion.class === 'saved' && <Bookmark size={13} className="suggestion-title-icon" aria-hidden="true" />}
                  {suggestion.class === 'recent' && <History size={13} className="suggestion-title-icon" aria-hidden="true" />}
                  {isMountainSuggestion(suggestion) && <Mountain size={14} className="suggestion-title-icon" aria-hidden="true" />}
                  <span>{suggestion.name.split(',')[0]}</span>
                </strong>
                <span className="suggestion-subtitle">{suggestion.name.split(',').slice(1, 3).join(',')}</span>
              </button>
            ))}
          {!searchLoading && suggestions.length > 0 && (
            <div className="suggestion-status search-shortcuts" role="presentation">Tip: Press `/` to focus, `↑/↓` to navigate, `Enter` to select.</div>
          )}
        </div>
      )}
    </div>
  );
}
