import React from 'react';
import { LoaderCircle, Search, X } from 'lucide-react';
import type { Suggestion } from '../../lib/search';

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
  onInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
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
  onInputChange,
  onFocus,
  onKeyDown,
  onSubmit,
  onClear,
  onUseCoordinates,
  onSelectSuggestion,
  onHoverSuggestion,
}: SearchBoxProps) {
  return (
    <div className="search-wrapper" ref={searchWrapperRef}>
      <div className="search-bar">
        <Search size={16} />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search by peak, trailhead, zone, town, or coordinates"
          defaultValue={searchQuery}
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          onChange={onInputChange}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          aria-label="Search location"
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
          aria-controls="planner-suggestion-list"
          aria-activedescendant={activeSuggestionIndex >= 0 ? `suggestion-${activeSuggestionIndex}` : undefined}
        />
        <button
          type="button"
          className="search-go-btn"
          onClick={onSubmit}
          aria-label={searchLoading ? 'Searching' : 'Search location'}
          disabled={searchLoading}
        >
          {searchLoading ? <LoaderCircle size={14} className="spin" /> : 'Go'}
        </button>
        {trimmedSearchQuery.length > 0 && (
          <button type="button" className="search-clear-btn" onClick={onClear} aria-label="Clear search">
            <X size={14} />
          </button>
        )}
      </div>

      {showSuggestions && (searchLoading || suggestions.length > 0 || trimmedSearchQuery.length > 0) && (
        <ul className="suggestions-list" id="planner-suggestion-list" role="listbox" aria-label="Search suggestions">
          {searchLoading && <li className="suggestion-status">Searching...</li>}
          {!searchLoading && canUseCoordinates && (
            <li>
              <button
                type="button"
                className="suggestion-item coordinate-suggestion"
                onClick={() => onUseCoordinates(trimmedSearchQuery)}
              >
                <strong className="suggestion-title">Use typed coordinates</strong>
                <span className="suggestion-subtitle">{trimmedSearchQuery}</span>
              </button>
            </li>
          )}
          {!searchLoading && suggestions.length === 0 && trimmedSearchQuery.length > 0 && (
            <li className="suggestion-status">No matches found. Try “Mount Elbert”, “Mt Hood”, or “39.1178 -106.4452”.</li>
          )}
          {!searchLoading &&
            suggestions.map((suggestion, index) => (
              <li key={`${suggestion.name}-${index}`}>
                <button
                  id={`suggestion-${index}`}
                  type="button"
                  role="option"
                  aria-selected={activeSuggestionIndex === index}
                  className={`suggestion-item ${suggestion.class === 'popular' ? 'popular-suggestion' : ''} ${
                    activeSuggestionIndex === index ? 'active' : ''
                  }`}
                  onClick={() => onSelectSuggestion(suggestion)}
                  onMouseEnter={() => onHoverSuggestion(index)}
                >
                  <strong className="suggestion-title">
                    {suggestion.class === 'popular' && '⭐ '} {suggestion.name.split(',')[0]}
                  </strong>
                  <span className="suggestion-subtitle">{suggestion.name.split(',').slice(1, 3).join(',')}</span>
                </button>
              </li>
            ))}
          {!searchLoading && (
            <li className="suggestion-status search-shortcuts">Tip: Press `/` to focus, `↑/↓` to navigate, `Enter` to select.</li>
          )}
        </ul>
      )}
    </div>
  );
}
