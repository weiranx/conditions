import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import {
  ArrowRight,
  Clock3,
  Compass,
  LoaderCircle,
  LocateFixed,
  MapPin,
  Minus,
  Pencil,
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
import { formatClockForStyle, parseSolarClockMinutes, parseTimeInputMinutes } from "../app/core";
import type { TimeStyle } from "../app/types";
import { parseGpxFile } from "../lib/gpx";
import { Thresholds } from "./Thresholds";
import "./sky/plan.css";
import { ACTIVITY_ICONS } from "./sky/activity-icons";
import { liftAboveKeyboard } from "./touch";
import { useAiAvailability } from "../hooks/useAiAvailability";
import { RouteSuggestions } from "./RouteSuggestions";
import { SuggestionLabel } from "./SuggestionLabel";
import { ItineraryCamps, ItineraryWhen } from "./ItineraryPlan";
import { PlanDateChips } from "./PlanDateChips";
import { usePlanDaylight } from "../hooks/usePlanDaylight";

/** "6:31:02 AM" as a time input's "06:31". */
function clockInput(value: string) {
  const minutes = parseSolarClockMinutes(value);
  if (minutes === null) return null;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The clock an outing ends at, and whether that falls on a later day. */
function returnLabel(start: string, hours: number, timeStyle: TimeStyle) {
  const startMinutes = parseTimeInputMinutes(start);
  if (startMinutes === null || !Number.isFinite(hours) || hours <= 0) return null;
  const end = startMinutes + Math.round(hours * 60);
  const clock = `${String(Math.floor((end % 1440) / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
  const days = Math.floor(end / 1440);
  return `${formatClockForStyle(clock, timeStyle)}${days === 1 ? " the next day" : days > 1 ? ` ${days} days later` : ""}`;
}

/**
 * The plan in the order people decide it: what kind of trip, where (a place,
 * and optionally the route there), when (the day, the start and how long),
 * and the activity.
 */
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
  // "Change" reopens the search for the place chosen at that moment; choosing
  // any place (a result, the map, a GPX track) gives a new key and ends it.
  const placeKey = `${w.position.lat},${w.position.lng},${w.committedSearchQuery}`;
  const [changingPlace, setChangingPlace] = useState<string | null>(null);
  const [focusSearch, setFocusSearch] = useState(false);
  // Create with a typed place picks the best match, then carries on.
  const [continueAfterSelect, setContinueAfterSelect] = useState(false);
  // A multi-day trip is planned here too; Compare keeps its own day range.
  const multiDay = !comparison && w.itinerary.mode === "multi";
  const busy = comparison ? w.tripForecastLoading : multiDay ? w.itinerary.loading : w.loading;
  const selected = w.hasObjective && !w.objectiveDraftDirty;
  const showPlace = selected && changingPlace !== placeKey;
  // A point from the map or the device is named, and measured, after it is chosen.
  const lookup = w.pointLookup;
  const lookupHere = Boolean(lookup && lookup.lat === w.position.lat && lookup.lng === w.position.lng);
  const lookingUp = lookupHere && Boolean(lookup?.loading);
  const pointElevation = lookupHere ? lookup?.elevationFt ?? null : null;
  const placeElevation = pointElevation ?? w.searchedPlaceElevationFt ?? null;
  // A name typed for the place, while it is being renamed.
  const [renaming, setRenaming] = useState<string | null>(null);
  function saveName() {
    if (!renaming?.trim()) return;
    if (!comparison && !multiDay && w.safetyData) w.handleEditPlan();
    w.renameObjective(renaming);
    setRenaming(null);
  }
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
  // A custom activity reads like the activity it is based on.
  const activeProfile = ACTIVITY_PROFILES[w.preferences.defaultActivity] ?? null;
  const startTime = comparison ? w.tripStartTime : w.alpineStartTime;
  const planDate = comparison ? w.tripStartDate : w.forecastDate;
  const daylight = usePlanDaylight(
    w.hasObjective && !multiDay ? { lat: w.position.lat, lon: w.position.lng } : null,
    planDate,
  );
  const dawnStart = daylight?.dawn ? clockInput(daylight.dawn) : null;
  const back = returnLabel(startTime, Number(w.travelWindowHoursDraft), w.preferences.timeStyle);
  function setDuration(hours: number) {
    if (!Number.isFinite(hours)) return;
    if (!comparison && w.safetyData) w.handleEditPlan();
    // The draft handler clamps and commits, exactly as typing does.
    w.handleTravelWindowHoursDraftChange({
      target: { value: String(Math.max(1, Math.min(24, Math.round(hours)))) },
    } as ChangeEvent<HTMLInputElement>);
  }
  function setDate(value: string) {
    if (comparison) {
      w.setTripStartDate(value);
      w.setTripForecastRowsDirect([]);
    } else {
      if (w.safetyData) w.handleEditPlan();
      w.setForecastDate(value);
    }
  }
  function setStart(value: string) {
    if (!/^\d{2}:\d{2}$/.test(value)) return;
    if (comparison) {
      w.setTripStartTime(value);
      w.setTripForecastRowsDirect([]);
    } else {
      if (w.safetyData) w.handleEditPlan();
      w.setAlpineStartTime(value);
    }
  }
  function keepPlace() {
    w.setSearchInputValue(w.committedSearchQuery);
    w.setShowSuggestions(false);
    setChangingPlace(null);
    setError("");
  }
  function run() {
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
  }
  useEffect(() => {
    if (!focusSearch) return;
    const input = searchInputRef.current;
    input?.focus({ preventScroll: true });
    input?.select();
    // Focus follows the render that shows the search again.
    setFocusSearch(false);
  }, [focusSearch, searchInputRef]);
  // A trip's trailhead reaches its draft a render after the place is chosen.
  const trailhead = multiDay ? w.itinerary.draft.trailhead : null;
  const trailheadReady = !multiDay || Boolean(trailhead && trailhead.lat === w.position.lat && trailhead.lon === w.position.lng);
  useEffect(() => {
    if (!continueAfterSelect || !selected || !trailheadReady) return;
    setContinueAfterSelect(false);
    run();
    // run reads this render's workspace, the one holding the chosen place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continueAfterSelect, selected, trailheadReady]);
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
  const gpxAllowed = w.featureFlags.gpxImport && !multiDay && !comparison;
  const chooseGpx = () => file.current?.click();
  return (
    <form
      className="field-plan-form sky-plan"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || selectingLocation) return;
        if (!selected) {
          if (!w.searchQuery.trim()) {
            setError(multiDay ? "Choose a trailhead first." : "Choose a place first.");
            searchInputRef.current?.focus({ preventScroll: true });
            return;
          }
          setSelectingLocation(true);
          setError("");
          try {
            const found = await w.handleSearchSubmit();
            if (!found) {
              setError("Choose a search result or enter latitude, longitude.");
              searchInputRef.current?.focus({ preventScroll: true });
            } else {
              setContinueAfterSelect(true);
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
        run();
      }}
    >
      <div className="field-form-title">
        <div>
          <h2>Plan details</h2>
        </div>
      </div>
      <fieldset disabled={busy}>
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
        <h3 className="sky-plan-step"><span aria-hidden="true">1</span>{multiDay ? "Trailhead" : "Where"}</h3>
        {gpxAllowed && (
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
                setChangingPlace(null);
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
        )}
        {showPlace ? (
          <div className="sky-plan-place">
            <div className="sky-plan-place-head">
              <span className="sky-plan-place-icon" aria-hidden="true">
                {w.importedGpxRoute && !multiDay ? <RouteIcon size={18} /> : <MapPin size={18} />}
              </span>
              {renaming !== null ? (
                <div className="sky-plan-place-name sky-plan-rename">
                  <input
                    aria-label={multiDay ? "Trailhead name" : "Place name"}
                    value={renaming}
                    maxLength={120}
                    autoFocus
                    onChange={(event) => setRenaming(event.target.value)}
                    onKeyDown={(event) => {
                      // Enter names the place; it must not submit the plan.
                      if (event.key === "Enter") {
                        event.preventDefault();
                        saveName();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setRenaming(null);
                      }
                    }}
                  />
                  <small>{w.position.lat.toFixed(4)}, {w.position.lng.toFixed(4)}</small>
                </div>
              ) : (
                <div className="sky-plan-place-name" role="status">
                  <span className="sky-plan-place-title">
                    <strong>{lookingUp ? "Finding what’s here…" : w.objectiveName || w.committedSearchQuery}</strong>
                    {!lookingUp && (
                      <button
                        type="button"
                        className="field-icon-button sky-plan-rename-button"
                        aria-label={multiDay ? "Rename trailhead" : "Rename place"}
                        title="Rename"
                        onClick={() => setRenaming(w.objectiveName || w.committedSearchQuery)}
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                    )}
                  </span>
                  <small>
                    {placeElevation !== null && <>{w.formatElevationDisplay(placeElevation)} · </>}
                    {w.position.lat.toFixed(4)}, {w.position.lng.toFixed(4)}
                    {w.objectiveTimezone && <> · {w.objectiveTimezone.replace(/_/g, " ")}</>}
                  </small>
                </div>
              )}
              {renaming !== null ? (
                <span className="sky-plan-place-actions">
                  <button type="button" className="field-text-button" onClick={saveName} disabled={!renaming.trim()}>
                    Save
                  </button>
                  <button type="button" className="field-text-button" onClick={() => setRenaming(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <span className="sky-plan-place-actions">
                  <button
                    type="button"
                    className="field-text-button"
                    aria-label={multiDay ? "Change trailhead" : "Change place"}
                    onClick={() => {
                      setError("");
                      setChangingPlace(placeKey);
                      setFocusSearch(true);
                    }}
                  >
                    Change
                  </button>
                </span>
              )}
            </div>
            {multiDay || comparison ? null : w.featureFlags.routeAnalysis ? (
              <PlanRoute workspace={w} selected={selected} onImportGpx={gpxAllowed ? chooseGpx : undefined} />
            ) : (
              <GpxSummary workspace={w} />
            )}
          </div>
        ) : (
          <>
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
                  onKeyDown={(event) => {
                    // Escape closes the results first, then gives up the change.
                    if (event.key === "Escape" && !w.showSuggestions && w.hasObjective && w.committedSearchQuery) {
                      keepPlace();
                      return;
                    }
                    w.handleSearchKeyDown(event);
                  }}
                />
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
                        <SuggestionLabel item={item} elevationUnit={w.preferences.elevationUnit} />
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
              {gpxAllowed && (
                <button type="button" className="field-text-button" onClick={chooseGpx}>
                  <Upload size={14} />
                  Import GPX
                </button>
              )}
            </div>
            <p id={`${id}-location-status`} className="field-location-status" role="status">
              {w.hasObjective && w.committedSearchQuery ? (
                <>
                  Pick a new place, or{" "}
                  <button type="button" className="field-text-button sky-plan-keep" onClick={keepPlace}>
                    keep {w.objectiveName || w.committedSearchQuery}
                  </button>
                </>
              ) : onChooseMap
                ? "Pick a search result, or choose a point on the map."
                : "Pick a search result, or enter latitude, longitude."}
            </p>
          </>
        )}
        <div className="field-form-divider">
          <h3 className="sky-plan-step"><span aria-hidden="true">2</span>When</h3>
          {!comparison && !multiDay && (
            <button
              className="field-text-button"
              type="button"
              title="Start now, in local time"
              onClick={() => {
                if (w.safetyData) w.handleEditPlan();
                w.handleUseNowConditions();
              }}
            >
              <Clock3 size={14} />
              Leave now
            </button>
          )}
        </div>
        {multiDay ? <ItineraryWhen workspace={w} /> : (
          <>
            <PlanDateChips
              label={comparison ? "First day" : "Day"}
              value={comparison ? w.tripStartDate : w.forecastDate}
              today={w.todayDate}
              last={w.maxForecastDate}
              onChange={setDate}
            />
            <div className="field-input-grid field-plan-schedule">
              <label>
                Leave at
                <input
                  type="time"
                  aria-describedby={`${id}-window`}
                  required
                  onInput={(event) => setStart(event.currentTarget.value)}
                  value={startTime}
                  onChange={(event) => setStart(event.target.value)}
                />
              </label>
              <div className="field-plan-duration">
                <span aria-hidden="true">Out for (hours)</span>
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
                    aria-describedby={`${id}-window`}
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
            <p className="sky-plan-window" id={`${id}-window`}>
              {back && <strong>{comparison ? "Each day, back by" : "Back by"} {back}</strong>}
              <span>
                {w.hasObjective
                  ? `Local time at ${w.objectiveName || "the place"}`
                  : "Times are local to the place you choose."}
              </span>
            </p>
            {daylight && (daylight.sunrise || daylight.sunset) && (
              <p className="sky-plan-daylight">
                {daylight.dawn && <span>First light {formatClockForStyle(daylight.dawn, w.preferences.timeStyle)}</span>}
                {daylight.sunrise && <span>Sunrise {formatClockForStyle(daylight.sunrise, w.preferences.timeStyle)}</span>}
                {daylight.sunset && <span>Sunset {formatClockForStyle(daylight.sunset, w.preferences.timeStyle)}</span>}
                {dawnStart && dawnStart !== startTime && (
                  <button type="button" className="field-text-button" onClick={() => setStart(dawnStart)}>
                    Leave at first light
                  </button>
                )}
              </p>
            )}
            {comparison && (
              <label className="field-activity sky-plan-compare-days">
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
            )}
          </>
        )}
        <fieldset className="sky-plan-activities">
          <legend className="sky-plan-step"><span aria-hidden="true">3</span>Activity</legend>
          <div className="sky-activity-grid" role="radiogroup" aria-label="Activity">
            {activities.map((option) => {
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
                  />
                  <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
          <details className="sky-plan-limits">
            <summary>
              <span className="sky-plan-limits-title">
                {activeActivityLabel(w.preferences)}
                <span className="sky-plan-limits-edit">Adjust limits</span>
              </span>
              {activeProfile && (
                <span className="sky-plan-lens">
                  {activeProfile.description}
                  {activeProfile.report.leads && <> The brief leads with {activeProfile.report.leads}.</>}
                </span>
              )}
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
        {multiDay && <ItineraryCamps workspace={w} onChooseMap={onChooseMap} />}
        <button
          className="field-button field-button-primary field-form-submit"
          type="submit"
          disabled={selectingLocation}
        >
          {selectingLocation
            ? "Finding the place…"
            : busy
            ? "Reading conditions…"
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

/** The imported track's distance, climb and high point, with its duration estimate. */
function GpxSummary({ workspace: w }: { workspace: Workspace }) {
  const route = w.importedGpxRoute;
  if (!route) return null;
  return (
    <div className="field-route-import">
      <strong>{route.fileName}</strong>
      <p>
        {w.formatDistanceDisplay(route.distanceMiles)} ·{" "}
        {w.formatElevationDeltaDisplay(route.elevationGainFt)} ascent
        {route.maxElevationFt !== null && (
          <> · report for the high point, {w.formatElevationDisplay(route.maxElevationFt)}</>
        )}
      </p>
      {w.gpxEstimatedDurationHours !== null && (
        <button
          type="button"
          className="field-text-button"
          onClick={() => w.updatePreferences({ travelWindowHours: w.gpxEstimatedDurationHours! })}
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
  );
}

/** The route to the chosen place: a GPX track, or a named route to check at timed checkpoints once the brief is ready. */
function PlanRoute({ workspace: w, selected, onImportGpx }: { workspace: Workspace; selected: boolean; onImportGpx?: () => void }) {
  const [routeOpen, setRouteOpen] = useState(Boolean(w.plannedRouteName));
  // Offered until the health check says route AI is off; the request itself
  // still reports any failure.
  const available = useAiAvailability({ ai: true });
  const findingRoutes = w.routeLoadingState?.kind === "suggestions";
  // The hours a chosen route set, and the hours it replaced, until undone or changed.
  const [routeHours, setRouteHours] = useState<{ route: string; hours: number; previous: number } | null>(null);
  const routeHoursShown = routeHours !== null && w.customRouteName === routeHours.route
    && Number(w.travelWindowHoursDraft) === routeHours.hours;
  function setHours(hours: number) {
    if (w.safetyData) w.handleEditPlan();
    w.updatePreferences({ travelWindowHours: hours });
  }
  return (
    <details
      className="sky-plan-route"
      open={routeOpen}
      onToggle={(event) => setRouteOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="sky-plan-route-label">
          <RouteIcon size={15} aria-hidden="true" />
          Route
        </span>
        <small>{w.plannedRouteName || "Optional"}</small>
      </summary>
      {w.importedGpxRoute ? (
        <>
          <GpxSummary workspace={w} />
          <p className="sky-plan-route-note">
            Checkpoints come from your GPX track, {w.importedGpxRoute.checkpoints.length} along the way.
          </p>
        </>
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
          <RouteSuggestions
            workspace={w}
            onChoose={(route, hours) => {
              const previous = Number(w.travelWindowHoursDraft);
              if (hours === null || hours === previous) {
                setRouteHours(null);
                return;
              }
              setHours(hours);
              setRouteHours({ route, hours, previous });
            }}
          />
          {routeHoursShown && (
            <p className="sky-plan-route-note" role="status">
              Out for {routeHours.hours} hours, the time this route takes at your pace.
              <button
                type="button"
                className="field-text-button"
                onClick={() => {
                  setHours(routeHours.previous);
                  setRouteHours(null);
                }}
              >
                Keep {routeHours.previous} hours
              </button>
            </p>
          )}
          {onImportGpx && (
            <button type="button" className="field-text-button sky-plan-route-gpx" onClick={onImportGpx}>
              <Upload size={14} aria-hidden="true" />
              Or import a GPX track
            </button>
          )}
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
