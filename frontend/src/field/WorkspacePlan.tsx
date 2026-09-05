import { useId, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Clock3,
  LocateFixed,
  MapPin,
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

export function WorkspacePlan({
  workspace: w,
  comparison = false,
}: {
  workspace: Workspace;
  comparison?: boolean;
}) {
  const { searchWrapperRef, searchInputRef } = w;
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const busy = comparison ? w.tripForecastLoading : w.loading;
  const selected = w.hasObjective && !w.objectiveDraftDirty;
  return (
    <form
      className="field-plan-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        if (!selected) {
          const found = await w.handleSearchSubmit();
          setError(
            found
              ? "Location selected. Review the plan, then create your brief."
              : "Choose a search result or enter coordinates.",
          );
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
          <span className="field-kicker">Trip setup</span>
          <h2>Plan details</h2>
        </div>
        <MapPin aria-hidden="true" />
      </div>
      <fieldset disabled={busy}>
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
            <Search size={17} aria-hidden="true" />
            <input
              id={`${id}-search`}
              ref={searchInputRef}
              value={w.searchQuery}
              placeholder="Search place or coordinates"
              role="combobox"
              aria-expanded={w.showSuggestions}
              aria-controls={`${id}-results`}
              aria-autocomplete="list"
              aria-activedescendant={
                w.showSuggestions && w.activeSuggestionIndex >= 0
                  ? `suggestion-${w.activeSuggestionIndex}`
                  : undefined
              }
              autoComplete="off"
              onFocus={w.handleFocus}
              onChange={w.handleInputChange}
              onKeyDown={w.handleSearchKeyDown}
            />
            {selected && <Check size={16} aria-label="Location selected" />}
            {w.searchQuery && (
              <button
                type="button"
                aria-label="Clear location"
                className="field-icon-button"
                onClick={w.handleSearchClear}
              >
                <X size={15} />
              </button>
            )}
          </div>
          {w.showSuggestions && (
            <div
              className="field-search-results"
              id={`${id}-results`}
              role="listbox"
              aria-label="Location results"
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
                  id={`suggestion-${index}`}
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
              {!w.suggestions.length && (
                <p>
                  {w.searchLoading
                    ? "Searching…"
                    : "Search for a place, or enter latitude, longitude."}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="field-plan-utilities">
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
          <span className="field-kicker">Date and time</span>
        </div>
        <div className="field-input-grid">
          <label>
            Date
            <input
              type="date"
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
          <label>
            Hours
            <input
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
          </label>
        </div>
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
        ) : (
          <button
            className="field-text-button"
            type="button"
            onClick={w.handleUseNowConditions}
          >
            <Clock3 size={14} />
            Use local time now
          </button>
        )}
        <label className="field-activity">
          Activity
          <select
            value={w.preferences.defaultActivity}
            onChange={(event) => {
              if (!comparison && w.safetyData) w.handleEditPlan();
              w.updatePreferences({
                defaultActivity: event.target
                  .value as typeof w.preferences.defaultActivity,
              });
            }}
          >
            {ACTIVITY_PROFILE_ORDER.map((key) => (
              <option key={key} value={key}>
                {ACTIVITY_PROFILES[key].label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="field-button field-button-primary field-form-submit"
          type="submit"
        >
          {busy
            ? "Reading conditions…"
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
      <p className="field-form-note">
        {w.hasObjective
          ? `Times are local to ${w.objectiveTimezone || "the objective"}.`
          : "Choose a location to set the local time zone."}
      </p>
    </form>
  );
}
