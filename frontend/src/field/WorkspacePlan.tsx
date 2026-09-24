import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Compass,
  LoaderCircle,
  LocateFixed,
  MapPin,
  Minus,
  Plus,
  Route as RouteIcon,
  Search,
  Upload,
  X,
} from "lucide-react";
import type { Workspace } from "./model/useWorkspace";
import {
  ACTIVITY_PROFILES,
  ACTIVITY_PROFILE_ORDER,
} from "../app/activity-profiles";
import { activeActivityKey, activeActivityLabel } from "../app/activity-limits";
import { parseGpxFile } from "../lib/gpx";
import { Thresholds } from "./Thresholds";
import "./sky/plan.css";
import { ACTIVITY_ICONS } from "./sky/activity-icons";
import { liftAboveKeyboard } from "./touch";
import { useAiAvailability } from "../hooks/useAiAvailability";
import { RouteSuggestions } from "./RouteSuggestions";
import { ItineraryCamps, ItineraryWhen } from "./ItineraryPlan";


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
  const [showAllActivities, setShowAllActivities] = useState(false);
  // A multi-day trip is planned here too; Compare keeps its own day range.
  const multiDay = !comparison && w.itinerary.mode === "multi";
  const busy = comparison ? w.tripForecastLoading : multiDay ? w.itinerary.loading : w.loading;
  const selected = w.hasObjective && !w.objectiveDraftDirty;
  const activities = [
    ...ACTIVITY_PROFILE_ORDER.map((key) => ({
      key,
      label: ACTIVITY_PROFILES[key].label,
      icon: key,
      patch: { defaultActivity: key, customActivityId: null },
    })),
    ...w.preferences.customActivities.map((custom) => ({
      key: custom.id,
      label: custom.label,
      icon: custom.baseActivity,
      patch: { defaultActivity: custom.baseActivity, customActivityId: custom.id },
    })),
  ];
  const activeKey = activeActivityKey(w.preferences);
  // Only the chosen activity shows until the list is opened; with no
  // match (a deleted custom activity) every choice shows.
  const hasChoice = activities.some((option) => option.key === activeKey);
  const expanded = showAllActivities || !hasChoice;
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
        else if (multiDay) {
          if (w.itinerary.gaps.length) {
            setError(w.itinerary.gaps[0]);
            return;
          }
          w.navigateToView("planner");
          void w.itinerary.runCheck();
        } else {
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
        <h3 className="sky-plan-step"><span aria-hidden="true">1</span>{multiDay ? "Trailhead" : "Where"}</h3>
        <div
          className="field-search"
          ref={searchWrapperRef}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              w.setShowSuggestions(false);
          }}
        >
          <label htmlFor={`${id}-search`}>
            {multiDay ? "Trailhead, trail, or coordinates" : "Mountain, trail, or coordinates"}
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
          {w.featureFlags.gpxImport && !multiDay && (
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
        {w.importedGpxRoute && !multiDay && (
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
          {!comparison && !multiDay && (
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
        {!comparison && w.featureFlags.tripPlanning && (
          <div className="sky-trip-mode" role="radiogroup" aria-label="Trip length">
            {([["day", "Day trip"], ["multi", "Multi-day"]] as const).map(([value, label]) => (
              <label key={value} className={w.itinerary.mode === value ? "is-checked" : undefined}>
                <input
                  type="radio"
                  name={`${id}-trip-mode`}
                  value={value}
                  checked={w.itinerary.mode === value}
                  onChange={() => {
                    setError("");
                    w.itinerary.setMode(value);
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        )}
        <p className="field-plan-timezone" id={`${id}-timezone`}>
          {w.hasObjective
            ? `Local time · ${w.objectiveTimezone || "the objective"}`
            : "Choose a location to set the local time zone."}
        </p>
        {multiDay ? <ItineraryWhen workspace={w} /> : (
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
        )}
        <fieldset className="sky-plan-activities">
          <legend className="sky-plan-step"><span aria-hidden="true">3</span>How</legend>
          <div
            id={`${id}-activities`}
            className="sky-activity-grid"
            role="radiogroup"
            aria-label="Activity"
          >
            {activities.filter((option) => expanded || option.key === activeKey).map((option) => {
              const Icon = ACTIVITY_ICONS[option.icon] || Compass;
              const checked = activeKey === option.key;
              return (
                <label key={option.key} className={`sky-activity${checked ? " is-checked" : ""}`}>
                  <input
                    type="radio"
                    name={`${id}-activity`}
                    value={option.key}
                    checked={checked}
                    onChange={() => {
                      if (!comparison && !multiDay && w.safetyData) w.handleEditPlan();
                      // Loaded days carry the previous activity's gear list.
                      if (comparison) w.setTripForecastRowsDirect([]);
                      if (multiDay) w.itinerary.updateDraft((draft) => draft);
                      w.updatePreferences(option.patch);
                    }}
                    onClick={(event) => {
                      // A pointer pick closes the list; arrow keys also fire
                      // click (detail 0) and keep it open to move through.
                      if (event.detail > 0) setShowAllActivities(false);
                    }}
                  />
                  <Icon size={24} strokeWidth={1.7} aria-hidden="true" />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
          {hasChoice && (
            <button
              type="button"
              className="sky-activity-toggle"
              aria-expanded={expanded}
              aria-controls={`${id}-activities`}
              onClick={() => setShowAllActivities(!expanded)}
            >
              {expanded ? (
                <>
                  Show less
                  <ChevronUp size={16} aria-hidden="true" />
                </>
              ) : (
                <>
                  Change activity
                  <ChevronDown size={16} aria-hidden="true" />
                </>
              )}
            </button>
          )}
          <details className="sky-plan-limits">
            <summary>
              <span className="sky-plan-limits-title">
                Limits for {activeActivityLabel(w.preferences)}
                <span className="sky-plan-limits-edit">Adjust</span>
              </span>
              <span className="sky-plan-limit-chips">
                <span>Gusts ≤ {w.formatWindDisplay(w.preferences.maxWindGustMph)}</span>
                <span>Rain or snow ≤ {w.preferences.maxPrecipChance}%</span>
                <span>
                  Feels {w.formatTempDisplay(w.preferences.minFeelsLikeF)} to {w.formatTempDisplay(w.preferences.maxFeelsLikeF)}
                </span>
              </span>
            </summary>
            <Thresholds workspace={w} hideHeader />
            <button type="button" className="sky-plan-limits-link" onClick={() => w.navigateToView("settings")}>
              <Plus size={14} aria-hidden="true" />
              Create your own activity in Preferences
            </button>
          </details>
        </fieldset>
        {multiDay ? (
          <ItineraryCamps workspace={w} onChooseMap={onChooseMap} />
        ) : !comparison && w.featureFlags.routeAnalysis && (
          <PlanRoute workspace={w} selected={selected} />
        )}
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
            : multiDay
              ? w.itinerary.gaps[0] || `Check ${w.itinerary.draft.camps.length + 1}-day trip`
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

/** Optional fourth step: a route to check at timed checkpoints once the brief is ready. */
function PlanRoute({ workspace: w, selected }: { workspace: Workspace; selected: boolean }) {
  const [routeOpen, setRouteOpen] = useState(Boolean(w.plannedRouteName));
  // Offered until the health check says route AI is off; the request itself
  // still reports any failure.
  const available = useAiAvailability({ ai: true });
  const findingRoutes = w.routeLoadingState?.kind === "suggestions";
  return (
    <details
      className="sky-plan-route"
      open={routeOpen}
      onToggle={(event) => setRouteOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="sky-plan-step"><span aria-hidden="true">4</span>Route</span>
        <small>{w.plannedRouteName || "Optional"}</small>
      </summary>
      {w.importedGpxRoute ? (
        <p className="sky-plan-route-note">
          <RouteIcon size={15} aria-hidden="true" />
          Checkpoints come from your GPX track, {w.importedGpxRoute.checkpoints.length} along the way.
        </p>
      ) : (
        <>
          <div className="sky-plan-route-name">
            <label>
              Route name
              <input
                value={w.customRouteName}
                onChange={(event) => w.setCustomRouteName(event.target.value)}
                placeholder="Enter a named route"
                maxLength={250}
              />
            </label>
            <button
              type="button"
              className="field-button"
              disabled={!selected || w.routeLoading || !available.routeAnalysis}
              onClick={() =>
                w.handleFetchRouteSuggestions(
                  w.objectiveName,
                  w.position.lat,
                  w.position.lng,
                )
              }
            >
              {findingRoutes ? "Finding routes…" : "Suggest routes"}
            </button>
          </div>
          {w.routeError && (
            <p className="field-feedback" role="alert">{w.routeError}</p>
          )}
          <RouteSuggestions workspace={w} />
        </>
      )}
      <p className="sky-plan-route-hint">
        {!available.routeAnalysis
          ? "Route analysis is unavailable on this server right now."
          : w.accountUser
            ? "Once your brief is ready, analyze the route in its Route chapter to check conditions at timed checkpoints."
            : "Sign in to check conditions at timed checkpoints along the route."}
      </p>
    </details>
  );
}
