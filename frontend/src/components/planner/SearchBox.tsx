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

  React.useEffect(() => {
    if (!showSuggestions || activeSuggestionIndex < 0) return;
    suggestionsListRef.current
      ?.querySelector<HTMLElement>(`#suggestion-${activeSuggestionIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeSuggestionIndex, showSuggestions]);

  const optionCount = suggestions.length + (canUseCoordinates ? 1 : 0);
  const searchStatus = disabled || !showSuggestions
    ? ''
    : searchLoading
      ? 'Searching for locations and routes.'
      : trimmedSearchQuery && optionCount === 0
        ? 'No matching locations or routes found.'
        : optionCount > 0
          ? `${optionCount} objective ${optionCount === 1 ? 'option' : 'options'} available.`
          : '';

  return (
    <div className="search-wrapper" ref={searchWrapperRef}>
      <div className="search-bar">
        <Search size={16} aria-hidden />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search by peak, trail, route, town, or coordinates"
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
          role="combobox"
          aria-label="Search location or route"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={!disabled && showSuggestions}
          aria-controls="planner-suggestion-list"
          aria-describedby="planner-search-status"
          aria-activedescendant={!disabled && activeSuggestionIndex >= 0 ? `suggestion-${activeSuggestionIndex}` : undefined}
        />
        {trimmedSearchQuery.length > 0 && (
          <button type="button" className="search-clear-btn" onClick={onClear} aria-label="Clear search" disabled={disabled}>
            <X size={14} aria-hidden />
          </button>
        )}
      </div>
      <span id="planner-search-status" className="sr-only" role="status" aria-live="polite">
        {searchStatus}
      </span>

      {!disabled && showSuggestions && (searchLoading || suggestions.length > 0 || trimmedSearchQuery.length > 0) && (
        <div
          ref={suggestionsListRef}
          className="suggestions-list"
          id="planner-suggestion-list"
          role="listbox"
          aria-label="Location and route suggestions"
          aria-busy={searchLoading}
        >
          {searchLoading && (
            <div className="suggestion-status">
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
            <div className="suggestion-status">No matches found. Try “Mount Elbert”, a trail or route name, or “39.1178 -106.4452”.</div>
          )}
          {!searchLoading &&
            suggestions.map((suggestion, index) => (
              <button
                key={`${suggestion.name}-${suggestion.lat}-${suggestion.lon}`}
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
            <div className="suggestion-status search-shortcuts">Tip: Press `/` to focus, `↑/↓` to navigate, `Enter` to select.</div>
          )}
        </div>
      )}
    </div>
  );
}
