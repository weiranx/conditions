import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, BedDouble, Flag, LoaderCircle, LogOut, MapPin, Minus, Mountain, Plus, Search, Upload, X } from "lucide-react";
import type { Workspace } from "./model/useWorkspace";
import type { ItineraryPickTarget } from "./model/useItinerary";
import { fetchApi } from "../lib/api-client";
import { formatClockForStyle, parseCoordinates } from "../app/core";
import { parseGpxFile } from "../lib/gpx";
import type { Suggestion } from "../lib/search";
import {
  MAX_DAY_CHECKPOINTS,
  campPoint,
  setItineraryNights,
  splitGpxIntoDays,
  stageStraightLineMiles,
  LONG_DAY_STRAIGHT_LINE_MILES,
  type ItineraryDraft,
  type ItineraryPoint,
} from "../app/itinerary";
import { dateLabel } from "./data";
import "./itinerary.css";

const MAX_BAIL_POINTS = 4;

/** Multi-day "When": start date, nights, and the usual start and hours for each day. */
export function ItineraryWhen({ workspace: w }: { workspace: Workspace }) {
  const it = w.itinerary;
  const { draft } = it;
  const firstDay = draft.days[0];
  const nights = draft.camps.length;
  const sameEveryDay = draft.days.every((day) => day.start === firstDay.start && day.travelHours === firstDay.travelHours);
  const setAllDays = (patch: Partial<Pick<ItineraryDraft["days"][number], "start" | "travelHours">>) =>
    it.updateDraft((current) => ({ ...current, days: current.days.map((day) => ({ ...day, ...patch })) }));
  const setNights = (value: number) => it.updateDraft((current) => setItineraryNights(current, Math.min(value, it.maxNights)));
  return (
    <div className="field-input-grid field-plan-schedule sky-trip-when">
      <label>
        Start date
        <input
          type="date"
          min={w.todayDate}
          max={w.maxForecastDate}
          required
          value={draft.startDate}
          onChange={(event) => {
            const value = event.target.value;
            if (/^\d{4}-\d{2}-\d{2}$/.test(value)) it.updateDraft((current) => ({ ...current, startDate: value }));
          }}
        />
      </label>
      <div className="field-plan-duration">
        <span aria-hidden="true">Nights</span>
        <span className="field-duration-control">
          <button type="button" className="sky-stepper" aria-label="One night fewer" disabled={nights <= 1} onClick={() => setNights(nights - 1)}>
            <Minus size={16} aria-hidden="true" />
          </button>
          <output aria-label="Nights" aria-live="polite">{nights}</output>
          <span className="field-duration-unit" aria-hidden="true">{nights === 1 ? "night" : "nights"}</span>
          <button type="button" className="sky-stepper" aria-label="One night more" disabled={nights >= it.maxNights} onClick={() => setNights(nights + 1)}>
            <Plus size={16} aria-hidden="true" />
          </button>
        </span>
      </div>
      <label>
        Leave camp
        <input
          type="time"
          required
          value={firstDay.start}
          onChange={(event) => {
            if (/^\d{2}:\d{2}$/.test(event.target.value)) setAllDays({ start: event.target.value });
          }}
        />
      </label>
      <div className="field-plan-duration">
        <span aria-hidden="true">Hiking per day</span>
        <span className="field-duration-control">
          <button type="button" className="sky-stepper" aria-label="One hour shorter each day" disabled={firstDay.travelHours <= 1} onClick={() => setAllDays({ travelHours: firstDay.travelHours - 1 })}>
            <Minus size={16} aria-hidden="true" />
          </button>
          <output aria-label="Hiking hours per day" aria-live="polite">{firstDay.travelHours}</output>
          <span className="field-duration-unit" aria-hidden="true">hours</span>
          <button type="button" className="sky-stepper" aria-label="One hour longer each day" disabled={firstDay.travelHours >= 24} onClick={() => setAllDays({ travelHours: firstDay.travelHours + 1 })}>
            <Plus size={16} aria-hidden="true" />
          </button>
        </span>
      </div>
      <p className="sky-trip-when-note">
        {nights + 1} days, {dateLabel(draft.startDate)} to {dateLabel(draft.days.length ? addDays(draft.startDate, nights) : draft.startDate)}.
        {!sameEveryDay && " Some days have their own start or hours; setting these changes every day."}
        {nights >= it.maxNights && nights < 6 && " The forecast does not reach further yet."}
      </p>
    </div>
  );
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Multi-day step 4: a camp for each night, the exit, high points, and bail points. */
export function ItineraryCamps({ workspace: w, onChooseMap }: { workspace: Workspace; onChooseMap?: () => void }) {
  const it = w.itinerary;
  const { draft } = it;
  const file = useRef<HTMLInputElement>(null);
  const [gpxError, setGpxError] = useState("");
  const [choosingExit, setChoosingExit] = useState(false);
  const pickOnMap = onChooseMap
    ? (target: ItineraryPickTarget) => {
        it.setPickTarget(target);
        onChooseMap();
      }
    : undefined;
  const setCamp = (index: number, point: ItineraryPoint | null) =>
    it.updateDraft((current) => ({
      ...current,
      camps: current.camps.map((camp, campIndex) => (campIndex === index ? { point, layover: false } : camp)),
    }));
  const setLayover = (index: number, layover: boolean) =>
    it.updateDraft((current) => ({
      ...current,
      camps: current.camps.map((camp, campIndex) => (campIndex === index ? { ...camp, layover } : camp)),
    }));
  const setDay = (index: number, patch: Partial<ItineraryDraft["days"][number]>) =>
    it.updateDraft((current) => ({
      ...current,
      days: current.days.map((day, dayIndex) => (dayIndex === index ? { ...day, ...patch } : day)),
    }));
  const stages = it.stages;

  async function importGpx(upload: File) {
    try {
      const route = await parseGpxFile(upload);
      const split = splitGpxIntoDays(route, draft.camps.length, {
        paceMinutesPerMile: w.preferences.runnerPaceMinutesPerMile,
        ascentMinutesPer1000Ft: w.preferences.runnerAscentMinutesPer1000Ft,
        stopBufferMinutes: w.preferences.runnerStopBufferMinutes,
      });
      if (!split) throw new Error("This GPX track is too short to split into days.");
      // The plan's objective is the trailhead in multi-day mode.
      w.selectSuggestion({ name: split.trailhead.name, lat: split.trailhead.lat, lon: split.trailhead.lon });
      it.updateDraft((current) => ({
        ...current,
        name: current.name || route.name,
        trailhead: split.trailhead,
        exit: split.exit,
        camps: split.camps.map((point) => ({ point, layover: false })),
        days: current.days.map((day, index) => ({
          ...day,
          travelHours: split.days[index]?.travelHours ?? day.travelHours,
          checkpoints: split.days[index]?.checkpoints ?? [],
        })),
        track: route.displayTrack.map(({ lat, lon }) => ({ lat, lon })),
      }));
      setGpxError("");
    } catch (error) {
      setGpxError(error instanceof Error ? error.message : "Could not read this route.");
    }
  }

  return (
    <section className="sky-trip-camps" aria-labelledby="sky-trip-camps-title">
      <div className="field-form-divider">
        <h3 className="sky-plan-step" id="sky-trip-camps-title"><span aria-hidden="true">4</span>Camps</h3>
        {w.featureFlags.gpxImport && (
          <>
            <input
              type="file"
              ref={file}
              accept=".gpx,application/gpx+xml"
              hidden
              onChange={(event) => {
                const upload = event.target.files?.[0];
                if (upload) void importGpx(upload);
                event.target.value = "";
              }}
            />
            <button type="button" className="field-text-button" onClick={() => file.current?.click()}>
              <Upload size={14} aria-hidden="true" />
              Fill from GPX
            </button>
          </>
        )}
      </div>
      {gpxError && <p className="field-feedback" role="alert">{gpxError}</p>}
      {draft.track && (
        <p className="sky-trip-hint">
          Camps and hours come from your GPX track, split into days of equal effort. Move any camp to where you plan to sleep.
          <button type="button" className="field-text-button" onClick={() => it.updateDraft((current) => ({ ...current, track: null }))}>
            Hide track
          </button>
        </p>
      )}
      <ol className="sky-trip-legs">
        {draft.days.map((_, index) => {
          const last = index === draft.days.length - 1;
          const stage = stages?.[index];
          const longDay = stage && !stage.layover && stageStraightLineMiles(stage) > LONG_DAY_STRAIGHT_LINE_MILES;
          const from = index === 0 ? draft.trailhead : campPoint(draft, index - 1);
          return (
            <li key={index} className="sky-trip-leg">
              <DayRow
                workspace={w}
                index={index}
                fromName={from?.name || (index === 0 ? "Trailhead" : `Camp ${index}`)}
                longDay={Boolean(longDay)}
                onChange={(patch) => setDay(index, patch)}
                onPickOnMap={pickOnMap}
              />
              {!last ? (
                <div className="sky-trip-night">
                  <span className="sky-trip-night-label">
                    <BedDouble size={15} aria-hidden="true" />
                    Night {index + 1}
                  </span>
                  {draft.camps[index].layover ? (
                    <p className="sky-trip-layover">
                      Stay at {campPoint(draft, index)?.name || "the same camp"} another night.
                      <button type="button" className="field-text-button" onClick={() => setLayover(index, false)}>
                        Move on instead
                      </button>
                    </p>
                  ) : (
                    <PlaceField
                      label={`Camp for night ${index + 1}`}
                      value={draft.camps[index].point}
                      onChange={(point) => setCamp(index, point)}
                      onPickOnMap={pickOnMap ? () => pickOnMap({ kind: "camp", index }) : undefined}
                      picking={it.pickTarget?.kind === "camp" && it.pickTarget.index === index}
                    />
                  )}
                  {index > 0 && !draft.camps[index].layover && (
                    <button type="button" className="field-text-button sky-trip-layover-toggle" onClick={() => setLayover(index, true)}>
                      Stay another night at the previous camp
                    </button>
                  )}
                </div>
              ) : (
                <div className="sky-trip-night is-exit">
                  <span className="sky-trip-night-label">
                    <Flag size={15} aria-hidden="true" />
                    Exit
                  </span>
                  {draft.exit || choosingExit ? (
                    <>
                      <PlaceField
                        label="Exit trailhead"
                        value={draft.exit}
                        onChange={(exit) => {
                          it.updateDraft((current) => ({ ...current, exit }));
                          setChoosingExit(false);
                        }}
                        onPickOnMap={pickOnMap ? () => pickOnMap({ kind: "exit" }) : undefined}
                        picking={it.pickTarget?.kind === "exit"}
                      />
                      <button
                        type="button"
                        className="field-text-button"
                        onClick={() => {
                          setChoosingExit(false);
                          if (draft.exit) it.updateDraft((current) => ({ ...current, exit: null }));
                        }}
                      >
                        End at the trailhead
                      </button>
                    </>
                  ) : (
                    <p className="sky-trip-layover">
                      Back to {draft.trailhead?.name || "the trailhead"}.
                      <button type="button" className="field-text-button" onClick={() => setChoosingExit(true)}>
                        End somewhere else
                      </button>
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <details className="sky-trip-bail">
        <summary>
          <LogOut size={15} aria-hidden="true" />
          Bail points
          <small>{draft.bailPoints.length ? `${draft.bailPoints.length} added` : "Optional"}</small>
        </summary>
        <p className="sky-trip-hint">Other trailheads or roads you could walk out to. Each camp shows its nearest way out.</p>
        <ul className="sky-trip-bail-list">
          {draft.bailPoints.map((point, index) => (
            <li key={`${point.lat}-${point.lon}-${index}`}>
              <MapPin size={14} aria-hidden="true" />
              <span>{point.name || `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`}</span>
              <button
                type="button"
                className="field-icon-button"
                aria-label={`Remove bail point ${point.name}`}
                onClick={() => it.updateDraft((current) => ({ ...current, bailPoints: current.bailPoints.filter((_, i) => i !== index) }))}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
        {draft.bailPoints.length < MAX_BAIL_POINTS && (
          <PlaceField
            label="Add a bail point"
            value={null}
            onChange={(point) => {
              if (point) it.updateDraft((current) => ({ ...current, bailPoints: [...current.bailPoints, point] }));
            }}
            onPickOnMap={pickOnMap ? () => pickOnMap({ kind: "bail" }) : undefined}
            picking={it.pickTarget?.kind === "bail"}
          />
        )}
      </details>
    </section>
  );
}

function DayRow({
  workspace: w,
  index,
  fromName,
  longDay,
  onChange,
  onPickOnMap,
}: {
  workspace: Workspace;
  index: number;
  fromName: string;
  longDay: boolean;
  onChange: (patch: Partial<ItineraryDraft["days"][number]>) => void;
  onPickOnMap?: (target: ItineraryPickTarget) => void;
}) {
  const it = w.itinerary;
  const day = it.draft.days[index];
  // A day spent at camp: the night after it is a layover at the same camp.
  const layover = index < it.draft.camps.length && it.draft.camps[index].layover;
  return (
    <details className="sky-trip-day">
      <summary>
        <span className="sky-trip-day-label">Day {index + 1}</span>
        <span className="sky-trip-day-summary">
          {layover ? "Layover" : `From ${fromName}`} · {formatClockForStyle(day.start, w.preferences.timeStyle)} · {day.travelHours} h
          {day.checkpoints.length > 0 && ` · ${day.checkpoints.length} high point${day.checkpoints.length > 1 ? "s" : ""}`}
        </span>
      </summary>
      <div className="field-input-grid">
        <label>
          Start
          <input
            type="time"
            value={day.start}
            onChange={(event) => {
              if (/^\d{2}:\d{2}$/.test(event.target.value)) onChange({ start: event.target.value });
            }}
          />
        </label>
        <label>
          Hours
          <input
            type="number"
            min="1"
            max="24"
            value={day.travelHours}
            onChange={(event) => {
              const hours = Math.round(Number(event.target.value));
              if (hours >= 1 && hours <= 24) onChange({ travelHours: hours });
            }}
          />
        </label>
      </div>
      {day.checkpoints.map((checkpoint, checkpointIndex) => (
        <p className="sky-trip-checkpoint" key={`${checkpoint.lat}-${checkpoint.lon}`}>
          <Mountain size={14} aria-hidden="true" />
          <span>{checkpoint.name || "High point"}</span>
          <button
            type="button"
            className="field-icon-button"
            aria-label={`Remove ${checkpoint.name || "high point"}`}
            onClick={() => onChange({ checkpoints: day.checkpoints.filter((_, i) => i !== checkpointIndex) })}
          >
            <X size={14} />
          </button>
        </p>
      ))}
      {day.checkpoints.length < MAX_DAY_CHECKPOINTS && (
        <PlaceField
          label="Add a pass or high point"
          value={null}
          onChange={(point) => {
            if (point) onChange({ checkpoints: [...day.checkpoints, point] });
          }}
          onPickOnMap={onPickOnMap ? () => onPickOnMap({ kind: "checkpoint", day: index }) : undefined}
          picking={it.pickTarget?.kind === "checkpoint" && it.pickTarget.day === index}
        />
      )}
      {longDay && (
        <p className="field-feedback" role="status">
          This day covers more than {w.formatDistanceDisplay(LONG_DAY_STRAIGHT_LINE_MILES)} in a straight line. Check the camps are where you plan to sleep.
        </p>
      )}
    </details>
  );
}

/** A small place search for camps and exits: a search result, typed coordinates, or a map tap. */
export function PlaceField({
  label,
  value,
  onChange,
  onPickOnMap,
  picking = false,
}: {
  label: string;
  value: ItineraryPoint | null;
  onChange: (point: ItineraryPoint | null) => void;
  onPickOnMap?: () => void;
  picking?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [editing, setEditing] = useState(false);
  const coordinates = parseCoordinates(query);
  const typedCoordinates = coordinates !== null;
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3 || typedCoordinates) {
      setResults([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const { response, payload } = await fetchApi(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        if (response.ok && Array.isArray(payload)) setResults((payload as Suggestion[]).slice(0, 5));
      } catch {
        // A failed search leaves the typed text; coordinates and the map still work.
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, typedCoordinates]);

  const choose = (point: ItineraryPoint) => {
    onChange(point);
    setQuery("");
    setResults([]);
    setEditing(false);
  };

  if (value && !editing) {
    return (
      <p className="sky-trip-place is-chosen">
        <MapPin size={15} aria-hidden="true" />
        <span>
          <strong>{value.name || `${value.lat.toFixed(4)}, ${value.lon.toFixed(4)}`}</strong>
        </span>
        <button type="button" className="field-text-button" aria-label={`Change ${label.toLowerCase()}`} onClick={() => setEditing(true)}>
          Change
        </button>
      </p>
    );
  }
  return (
    <div className="sky-trip-place field-search">
      <label htmlFor={`${id}-input`} className="sky-visually-hidden-label">{label}</label>
      <div className="field-input-icon">
        {searching ? <LoaderCircle size={16} className="field-spin" aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
        <input
          id={`${id}-input`}
          value={query}
          placeholder={`${label}: search or lat, lon`}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (coordinates) choose({ name: query.trim(), lat: coordinates.lat, lon: coordinates.lon, elevationFt: null });
              else if (results[0]) choose(suggestionPoint(results[0]));
            }
            if (event.key === "Escape" && value) setEditing(false);
          }}
        />
      </div>
      {(results.length > 0 || coordinates) && (
        <div className="field-search-results" role="listbox" aria-label={`${label} results`}>
          {coordinates && (
            <button type="button" role="option" aria-selected="false" onClick={() => choose({ name: query.trim(), lat: coordinates.lat, lon: coordinates.lon, elevationFt: null })}>
              <MapPin size={15} />
              Use these coordinates
            </button>
          )}
          {results.map((item, index) => (
            <button type="button" role="option" aria-selected="false" key={`${item.name}-${index}`} onClick={() => choose(suggestionPoint(item))}>
              <MapPin size={15} />
              <span>{item.name}</span>
              <ArrowRight size={14} />
            </button>
          ))}
        </div>
      )}
      <div className="sky-trip-place-actions">
        {onPickOnMap && (
          <button type="button" className="field-text-button" aria-pressed={picking} onClick={onPickOnMap}>
            <MapPin size={14} aria-hidden="true" />
            {picking ? "Tap the map…" : "Choose on map"}
          </button>
        )}
        {value && (
          <button type="button" className="field-text-button" onClick={() => setEditing(false)}>
            Keep {value.name || "current"}
          </button>
        )}
      </div>
    </div>
  );
}

function suggestionPoint(item: Suggestion): ItineraryPoint {
  return {
    name: item.name.split(",")[0].trim(),
    lat: Number(item.lat),
    lon: Number(item.lon),
    elevationFt: null,
  };
}
