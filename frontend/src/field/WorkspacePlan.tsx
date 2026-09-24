import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import {
  ArrowRight,
  Check,
  Clock3,
  Compass,
  LoaderCircle,
  LocateFixed,
  MapPin,
  Minus,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";
import type { Workspace } from "./model/useWorkspace";
import {
  ACTIVITY_PROFILES,
  ACTIVITY_PROFILE_ORDER,
} from "../app/activity-profiles";
import { parseGpxFile } from "../lib/gpx";
import "./sky/plan.css";
import { ACTIVITY_ICONS } from "./sky/activity-icons";
import { liftAboveKeyboard } from "./touch";


export function WorkspacePlan({
  workspace: w,
  comparison = false,
  onChooseMap,
}: {
  workspace: Workspace;
  comparison?: boolean;
  onChooseMap?: () => void;
}) {
  const { searchWrapperRef, searchInputRef } = w;
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const tapped = useRef(false);
  const [error, setError] = useState("");
  const [selectingLocation, setSelectingLocation] = useState(false);
  const busy = comparison ? w.tripForecastLoading : w.loading;
  const selected = w.hasObjective && !w.objectiveDraftDirty;
  function setDuration(hours: number) {
    if (!Number.isFinite(hours)) return;
    if (!comparison && w.safetyData) w.handleEditPlan();
    // The draft handler clamps and commits, exactly as typing does.
    w.handleTravelWindowHoursDraftChange({
      target: { value: String(Math.max(1, Math.min(24, Math.round(hours)))) },
    } as ChangeEvent<HTMLInputElement>);
  }
  useEffect(() => {
    const list = results.current;
    if (!w.showSuggestions || w.activeSuggestionIndex < 0 || !list) return;
    const option = list.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!option) return;
    const listTop = list.getBoundingClientRect().top + list.clientTop;
    const listBottom = listTop + list.clientHeight;
    const optionBounds = option.getBoundingClientRect();
    // Keep keyboard navigation inside the results, without moving the page.
    if (optionBounds.top < listTop) list.scrollTop += optionBounds.top - listTop;
    else if (optionBounds.bottom > listBottom)
      list.scrollTop += optionBounds.bottom - listBottom;
  }, [w.activeSuggestionIndex, w.showSuggestions, w.suggestions]);
  return (
    <form
      className="field-plan-form sky-plan"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || selectingLocation) return;
        if (!selected) {
          setSelectingLocation(true);
          setError("");
          try {
            const found = await w.handleSearchSubmit();
            if (!found) {
              setError("Choose a search result or enter latitude, longitude.");
              searchInputRef.current?.focus({ preventScroll: true });
            }
          } catch {
            setError(onChooseMap
              ? "Could not select this location. Try a search result or choose a point on the map."
              : "Could not select this location. Try a search result or enter latitude, longitude.");
          } finally {
            setSelectingLocation(false);
          }
          return;
        }
        setError("");
        if (comparison) void w.runTripForecast();
        else {
          w.navigateToView("planner");
          w.handleGenerateReport();
        }
      }}
    >
      <div className="field-form-title">
        <div>
          <h2>Plan details</h2>
        </div>
      </div>
      <fieldset disabled={busy}>
        <h3 className="sky-plan-step"><span aria-hidden="true">1</span>Where</h3>
        <div
          className="field-search"
          ref={searchWrapperRef}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              w.setShowSuggestions(false);
          }}
        >
          <label htmlFor={`${id}-search`}>
            Mountain, trail, or coordinates
          </label>
          <div className="field-input-icon">
            {w.searchLoading
              ? <LoaderCircle size={17} className="field-spin" aria-hidden="true" />
              : <Search size={17} aria-hidden="true" />}
            <input
              id={`${id}-search`}
              ref={searchInputRef}
              value={w.searchQuery}
              placeholder="Search place or coordinates"
              role="combobox"
              aria-expanded={w.showSuggestions}
              aria-controls={`${id}-results`}
              aria-autocomplete="list"
              aria-describedby={`${id}-location-status`}
              aria-activedescendant={
                w.showSuggestions && w.suggestions[w.activeSuggestionIndex]
                  ? `${id}-suggestion-${w.activeSuggestionIndex}`
                  : undefined
              }
              autoComplete="off"
              onPointerDown={(event) => {
                tapped.current = event.pointerType !== "mouse";
              }}
              onFocus={() => {
                w.handleFocus();
                // Only a tap opens the keyboard; focus moved here by the form
                // (after a failed search) keeps the page where it is.
                if (tapped.current) liftAboveKeyboard(searchWrapperRef.current);
                tapped.current = false;
              }}
              onChange={(event) => {
                setError("");
                w.handleInputChange(event);
              }}
              onKeyDown={w.handleSearchKeyDown}
            />
            {selected && <Check size={16} aria-label="Location selected" />}
            {w.searchQuery && (
              <button
                type="button"
                aria-label="Clear location"
                className="field-icon-button"
                onClick={() => {
                  setError("");
                  w.handleSearchClear();
                  searchInputRef.current?.focus({ preventScroll: true });
                }}
              >
                <X size={15} />
              </button>
            )}
          </div>
          {w.showSuggestions && (
            <div
              className="field-search-results"
              ref={results}
            >
              <div
                id={`${id}-results`}
                role="listbox"
                aria-label="Location results"
                aria-busy={w.searchLoading}
              >
                {w.parsedTypedCoordinates && (
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => w.handleUseTypedCoordinates(w.searchQuery)}
                  >
                    <MapPin size={15} />
                    Use these coordinates
                  </button>
                )}
                {w.suggestions.map((item, index) => (
                  <button
                    id={`${id}-suggestion-${index}`}
                    key={`${item.name}-${item.lat}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={w.activeSuggestionIndex === index}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => w.selectSuggestion(item)}
                  >
                    <MapPin size={15} />
                    <span>{item.name}</span>
                    <ArrowRight size={14} />
                  </button>
                ))}
              </div>
              {(w.searchLoading || (!w.suggestions.length && !w.parsedTypedCoordinates)) && (
                <p role="status">
                  {w.searchLoading
                    ? "Searching for places…"
                    : w.searchQuery.trim().length >= 2
                      ? "No matching places. Try a nearby place or enter latitude, longitude."
                      : "Search for a place, or enter latitude, longitude."}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="field-plan-utilities">
          {onChooseMap && (
            <button
              className="field-text-button"
              type="button"
              onClick={() => {
                w.setShowSuggestions(false);
                onChooseMap();
              }}
            >
              <MapPin size={14} aria-hidden="true" />
              Choose on map
            </button>
          )}
          <button
            className="field-text-button"
            type="button"
            disabled={w.locatingUser}
            onClick={w.handleUseCurrentLocation}
          >
            <LocateFixed size={14} />
            {w.locatingUser ? "Locating…" : "Use my location"}
          </button>
          {w.featureFlags.gpxImport && (
            <>
              <input
                type="file"
                ref={file}
                accept=".gpx,application/gpx+xml"
                hidden
                onChange={async (event) => {
                  const input = event.target;
                  const upload = input.files?.[0];
                  if (!upload) return;
                  try {
                    w.handleImportGpxObjective(await parseGpxFile(upload));
                    setError("");
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : "Could not read this route.",
                    );
                  }
                  input.value = "";
                }}
              />
              <button
                type="button"
                className="field-text-button"
                onClick={() => file.current?.click()}
              >
                <Upload size={14} />
                Import GPX
              </button>
            </>
          )}
        </div>
        <p
          id={`${id}-location-status`}
          className={`field-location-status${selected ? " is-selected" : ""}`}
          role="status"
        >
          {selected ? (
            <><Check size={14} aria-hidden="true" /> Location selected.</>
          ) : onChooseMap
            ? "Select a search result or choose a point on the map."
            : "Select a search result or enter latitude, longitude."}
        </p>
        {w.importedGpxRoute && (
          <div className="field-route-import">
            <strong>{w.importedGpxRoute.fileName}</strong>
            <p>
              {w.formatDistanceDisplay(w.importedGpxRoute.distanceMiles)} ·{" "}
              {w.formatElevationDeltaDisplay(
                w.importedGpxRoute.elevationGainFt,
              )}{" "}
              ascent
            </p>
            {w.gpxEstimatedDurationHours !== null && (
              <button
                type="button"
                className="field-text-button"
                onClick={() =>
                  w.updatePreferences({
                    travelWindowHours: w.gpxEstimatedDurationHours!,
                  })
                }
              >
                Use estimated duration · {w.gpxEstimatedDurationHours} hours
              </button>
            )}
            <button
              type="button"
              className="field-text-button"
              onClick={() => {
                w.setImportedGpxRoute(null);
                w.resetRouteState();
              }}
            >
              Remove route
            </button>
          </div>
        )}
        <div className="field-form-divider">
          <h3 className="sky-plan-step"><span aria-hidden="true">2</span>When</h3>
          {!comparison && (
            <button
              className="field-text-button"
              type="button"
              title="Use local time now"
              aria-label="Use local time now"
              onClick={w.handleUseNowConditions}
            >
              <Clock3 size={14} />
              Use now
            </button>
          )}
        </div>
        <p className="field-plan-timezone" id={`${id}-timezone`}>
          {w.hasObjective
            ? `Local time · ${w.objectiveTimezone || "the objective"}`
            : "Choose a location to set the local time zone."}
        </p>
        <div className="field-input-grid field-plan-schedule">
          <label>
            Date
            <input
              type="date"
              aria-describedby={`${id}-timezone`}
              min={w.todayDate}
              max={w.maxForecastDate}
              required
              onInput={(event) => {
                const value = event.currentTarget.value;
                if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                  if (comparison) {
                    w.setTripStartDate(value);
                    w.setTripForecastRowsDirect([]);
                  } else {
                    if (w.safetyData) w.handleEditPlan();
                    w.setForecastDate(value);
                  }
                }
              }}
              value={comparison ? w.tripStartDate : w.forecastDate}
              onChange={(event) => {
                if (comparison) {
                  w.setTripStartDate(event.target.value);
                  w.setTripForecastRowsDirect([]);
                } else w.handleDateChange(event);
              }}
            />
          </label>
          <label>
            Start time
            <input
              type="time"
              aria-describedby={`${id}-timezone`}
              required
              onInput={(event) => {
                const value = event.currentTarget.value;
                if (/^\d{2}:\d{2}$/.test(value)) {
                  if (comparison) {
                    w.setTripStartTime(value);
                    w.setTripForecastRowsDirect([]);
                  } else {
                    if (w.safetyData) w.handleEditPlan();
                    w.setAlpineStartTime(value);
                  }
                }
              }}
              value={comparison ? w.tripStartTime : w.alpineStartTime}
              onChange={(event) => {
                if (comparison) {
                  w.setTripStartTime(event.target.value);
                  w.setTripForecastRowsDirect([]);
                } else w.handlePlannerTimeChange(w.setAlpineStartTime)(event);
              }}
            />
          </label>
          <div className="field-plan-duration">
            <span aria-hidden="true">Duration (hours)</span>
            <span className="field-duration-control">
              <button
                type="button"
                className="sky-stepper"
                aria-label="One hour shorter"
                disabled={Number(w.travelWindowHoursDraft) <= 1}
                onClick={() => setDuration(Number(w.travelWindowHoursDraft) - 1)}
              >
                <Minus size={16} aria-hidden="true" />
              </button>
              <input
                aria-label="Duration in hours"
                type="number"
                min="1"
                max="24"
                required
                value={w.travelWindowHoursDraft}
                onChange={(event) => {
                  if (!comparison && w.safetyData) w.handleEditPlan();
                  w.handleTravelWindowHoursDraftChange(event);
                }}
                onBlur={w.handleTravelWindowHoursDraftBlur}
              />
              <span className="field-duration-unit" aria-hidden="true">hours</span>
              <button
                type="button"
                className="sky-stepper"
                aria-label="One hour longer"
                disabled={Number(w.travelWindowHoursDraft) >= 24}
                onClick={() => setDuration(Number(w.travelWindowHoursDraft) + 1)}
              >
                <Plus size={16} aria-hidden="true" />
              </button>
            </span>
          </div>
        </div>
        <fieldset className="sky-plan-activities">
          <legend className="sky-plan-step"><span aria-hidden="true">3</span>How</legend>
          <div className="sky-activity-grid" role="radiogroup" aria-label="Activity">
            {ACTIVITY_PROFILE_ORDER.map((key) => {
              const Icon = ACTIVITY_ICONS[key] || Compass;
              const checked = w.preferences.defaultActivity === key;
              return (
                <label key={key} className={`sky-activity${checked ? " is-checked" : ""}`}>
                  <input
                    type="radio"
                    name={`${id}-activity`}
                    value={key}
                    checked={checked}
                    onChange={() => {
                      if (!comparison && w.safetyData) w.handleEditPlan();
                      w.updatePreferences({ defaultActivity: key });
                    }}
                  />
                  <Icon size={24} strokeWidth={1.7} aria-hidden="true" />
                  <span>{ACTIVITY_PROFILES[key].label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        {comparison ? (
          <label className="field-activity">
            Days to compare
            <select
              value={w.tripDurationDays}
              onChange={(event) => {
                w.setTripDurationDays(Number(event.target.value));
                w.setTripForecastRowsDirect([]);
              }}
            >
              {[2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n} days
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          className="field-button field-button-primary field-form-submit"
          type="submit"
          disabled={selectingLocation}
        >
          {selectingLocation
            ? "Selecting location…"
            : busy
            ? "Reading conditions…"
            : !selected
              ? "Select location"
            : comparison
              ? "Compare these days"
              : "Create conditions brief"}
          <ArrowRight size={17} />
        </button>
      </fieldset>
      {error && (
        <p className="field-feedback" role="status">
          {error}
        </p>
      )}
    </form>
  );
}
