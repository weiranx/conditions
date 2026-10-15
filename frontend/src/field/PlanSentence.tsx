import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import type { Workspace } from "./model/useWorkspace";
import { ACTIVITY_PROFILES } from "../app/activity-profiles";
import { activeActivityKey } from "../app/activity-limits";
import { convertElevationFeetToDisplayValue, formatClockForStyle } from "../app/core";
import type { UserPreferences } from "../app/types";
import { PLAN_SENTENCE_MAX_LENGTH, TRIP_DESCRIPTION_MAX_LENGTH, parsePlanSentence, type ParsedPlan } from "../lib/plan-parse";
import { applyDescribedTrip, hasPlaceHints } from "../app/itinerary";
import "./plan-sentence.css";

const LIMIT_PREFERENCES = [
  ["max_gust_mph", "maxWindGustMph"],
  ["max_precip_chance", "maxPrecipChance"],
  ["min_feels_like_f", "minFeelsLikeF"],
  ["max_feels_like_f", "maxFeelsLikeF"],
] as const;

function dayLabel(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : date;
}

/** "Kearsarge Lakes, Rae Lakes, layover": the camps a description named, in order. */
function campsLabel(camps: NonNullable<ParsedPlan["trip"]>["camps"]) {
  return camps.map((camp, index) => (camp.layover ? "layover" : camp.placeQuery ?? `night ${index + 1} open`)).join(", ");
}

/**
 * What became of the place a sentence named: still being searched, chosen
 * because the search found one clear match (`label` names it), or left in the
 * search for the traveler to pick.
 */
export type DescribedPlace =
  | { query: string; state: "searching" | "pick" }
  | { query: string; state: "picked"; label: string; lat: number; lon: number };

function describedPlaceLabel(query: string, place: DescribedPlace | null) {
  if (place?.query === query && place.state === "picked") {
    return `${place.label} (picked: the only match)`;
  }
  if (place?.query === query && place.state === "searching") return `${query} (searching…)`;
  return `${query} (pick it from the results)`;
}

/**
 * "Describe your plan": one sentence read into the plan form. The place goes
 * into the search box, and is chosen when the search finds one clear match
 * (`describedPlace`); otherwise the traveler picks it. The day, start, duration,
 * activity and limits go through the form's own setters. Nothing is run.
 *
 * For a multi-day trip (`multiDay`) the description also names the nights,
 * camps, exit and passes: the trailhead goes into the search like a day's
 * place, and each camp, exit and pass waits in its own search under Camps.
 */
export function PlanSentence({
  workspace: w,
  multiDay = false,
  placeKey,
  onDate,
  onStart,
  onDuration,
  onPlaceQuery,
  describedPlace = null,
}: {
  workspace: Workspace;
  multiDay?: boolean;
  /** Changes whenever a different place is chosen. */
  placeKey: string;
  onDate: (date: string) => void;
  onStart: (time: string) => void;
  onDuration: (hours: number) => void;
  onPlaceQuery: (query: string) => void;
  /** The place the latest sentence put in the search, and whether it was chosen. */
  describedPlace?: DescribedPlace | null;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<{ placeQuery: string | null; filled: string[]; notes: string[]; placesToPick: boolean } | null>(null);
  // A new place clears the target elevation, so one read with a place waits for it.
  const [pendingElevation, setPendingElevation] = useState<{ feet: number; placeKey: string } | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  function applyElevation(feet: number) {
    const display = Math.round(convertElevationFeetToDisplayValue(feet, w.preferences.elevationUnit));
    w.handleTargetElevationChange({ target: { value: String(display) } } as ChangeEvent<HTMLInputElement>);
  }
  useEffect(() => {
    if (!pendingElevation || !w.hasObjective || w.objectiveDraftDirty || placeKey === pendingElevation.placeKey) return;
    applyElevation(pendingElevation.feet);
    // Applied once, for the place picked after the sentence.
    setPendingElevation(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingElevation, placeKey, w.hasObjective, w.objectiveDraftDirty]);

  function applyTrip(plan: ParsedPlan, filled: string[], notes: string[]) {
    const it = w.itinerary;
    const applied = applyDescribedTrip(it.draft, plan, { todayDate: w.todayDate, maxForecastDate: w.maxForecastDate });
    notes.push(...applied.notes.map((note) => (plan.date ? note.replace(plan.date, dayLabel(plan.date)) : note)));
    // One change, so the trip is stale once and its searches wait for the picked trailhead.
    it.updateDraft(() => applied.draft);
    it.setPlaceHints(applied.hints);
    const trip = plan.trip;
    if (trip?.name) filled.push(`“${trip.name}”`);
    if (plan.date && applied.draft.startDate === plan.date) filled.push(`from ${dayLabel(plan.date)}`);
    if (trip?.nights) {
      const nights = applied.draft.camps.length;
      filled.push(`${nights} night${nights === 1 ? "" : "s"}`);
    }
    if (plan.startTime) filled.push(`leave camp ${formatClockForStyle(plan.startTime, w.preferences.timeStyle)}`);
    const hours = plan.params.travel_window_hours;
    if (typeof hours === "number") filled.push(`${Math.round(hours)} h a day`);
    const keptCamps = trip?.camps.slice(0, applied.draft.camps.length) ?? [];
    if (keptCamps.some((camp) => camp.placeQuery || camp.layover)) filled.push(`camps: ${campsLabel(keptCamps)}`);
    if (trip?.exit) filled.push(`out at ${trip.exit}`);
    const passes = applied.hints.checkpoints.flat();
    if (passes.length) filled.push(`over ${passes.join(", ")}`);
    return hasPlaceHints(applied.hints);
  }

  function applyDay(plan: ParsedPlan, filled: string[], notes: string[]) {
    if (plan.date) {
      if (plan.date >= w.todayDate && plan.date <= w.maxForecastDate) {
        onDate(plan.date);
        filled.push(dayLabel(plan.date));
      } else {
        notes.push(`${dayLabel(plan.date)} is past the forecast days; pick the day yourself.`);
      }
    }
    if (plan.startTime) {
      onStart(plan.startTime);
      filled.push(`leave ${formatClockForStyle(plan.startTime, w.preferences.timeStyle)}`);
    }
    const hours = plan.params.travel_window_hours;
    if (typeof hours === "number") {
      onDuration(hours);
      filled.push(`out ${Math.round(hours)} h`);
    }
  }

  function apply(plan: ParsedPlan) {
    const filled: string[] = [];
    const notes = [...plan.notes];
    // A trip's searches for camps, an exit or passes wait under Camps.
    let placesToPick = false;
    if (multiDay) placesToPick = applyTrip(plan, filled, notes);
    else applyDay(plan, filled, notes);
    // A trip is checked again as a whole, so only a day's brief is put back into editing.
    const editPlan = () => {
      if (!multiDay && w.safetyData) w.handleEditPlan();
    };
    if (plan.activity && ACTIVITY_PROFILES[plan.activity]) {
      if (activeActivityKey(w.preferences) !== plan.activity) {
        editPlan();
        // Picking the activity first loads its own saved limits; the sentence's go on top.
        w.updatePreferences({ defaultActivity: plan.activity, customActivityId: null });
      }
      filled.push(ACTIVITY_PROFILES[plan.activity].label);
    }
    const limits: Partial<UserPreferences> = {};
    for (const [param, preference] of LIMIT_PREFERENCES) {
      const value = plan.params[param];
      if (typeof value === "number" && Number.isFinite(value)) limits[preference] = value;
    }
    if (Object.keys(limits).length) {
      editPlan();
      w.updatePreferences(limits);
      if (limits.maxWindGustMph !== undefined) filled.push(`gusts ≤ ${w.formatWindDisplay(limits.maxWindGustMph)}`);
      if (limits.maxPrecipChance !== undefined) filled.push(`rain or snow ≤ ${limits.maxPrecipChance}%`);
      if (limits.minFeelsLikeF !== undefined) filled.push(`feels ≥ ${w.formatTempDisplay(limits.minFeelsLikeF)}`);
      if (limits.maxFeelsLikeF !== undefined) filled.push(`feels ≤ ${w.formatTempDisplay(limits.maxFeelsLikeF)}`);
    }
    const target = multiDay ? undefined : plan.params.target_elevation_ft;
    if (typeof target === "number") {
      if (plan.placeQuery) setPendingElevation({ feet: target, placeKey });
      else applyElevation(target);
      filled.push(`target ${w.formatElevationDisplay(target)}`);
    }
    if (plan.placeQuery) onPlaceQuery(plan.placeQuery);
    setSummary({ placeQuery: plan.placeQuery, filled, notes, placesToPick });
  }

  async function submit() {
    const sentence = text.trim();
    if (!sentence || loading) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    setSummary(null);
    try {
      const plan = await parsePlanSentence(
        sentence,
        w.todayDate,
        {
          temperature: w.preferences.temperatureUnit,
          wind: w.preferences.windSpeedUnit,
          elevation: w.preferences.elevationUnit,
        },
        controller.signal,
        multiDay ? "multi" : "day",
      );
      if (controller.signal.aborted) return;
      apply(plan);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : multiDay ? "Could not read that trip." : "Could not read that plan.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }

  const filled = summary
    ? [...(summary.placeQuery ? [describedPlaceLabel(summary.placeQuery, describedPlace)] : []), ...summary.filled]
    : [];
  const fieldProps = {
    id: `${id}-sentence`,
    value: text,
    autoComplete: "off",
    enterKeyHint: "go" as const,
    "aria-describedby": `${id}-sentence-status`,
    onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      // Enter fills the form; it must not submit the plan. Shift+Enter starts a new line in a trip.
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void submit();
      }
    },
  };
  return (
    <div className="sky-plan-sentence">
      <label htmlFor={`${id}-sentence`}>{multiDay ? "Describe your trip" : "Describe your plan"}</label>
      <div className="sky-plan-sentence-row">
        {multiDay ? (
          <textarea
            {...fieldProps}
            rows={3}
            maxLength={TRIP_DESCRIPTION_MAX_LENGTH}
            placeholder="Onion Valley Friday, 3 nights: Kearsarge Lakes, Rae Lakes, layover, out at Cottonwood Lakes. Over Glen Pass day 2, leave camp 8am, 6 h a day"
            onChange={(event) => setText(event.target.value)}
          />
        ) : (
          <input
            {...fieldProps}
            maxLength={PLAN_SENTENCE_MAX_LENGTH}
            placeholder="Split Mountain Saturday, ski the north couloir, 3am start, bail over 30 mph"
            onChange={(event) => setText(event.target.value)}
          />
        )}
        <button type="button" className="field-button" disabled={loading || !text.trim()} onClick={() => void submit()}>
          {loading ? <LoaderCircle size={15} className="field-spin" aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
          {loading ? "Reading…" : "Fill in"}
        </button>
      </div>
      <div id={`${id}-sentence-status`} role="status">
        {error ? (
          <p className="sky-plan-sentence-error">{error}</p>
        ) : summary ? (
          <>
            <p className="sky-plan-sentence-summary">
              {filled.length
                ? <>Filled in: {filled.join(" · ")}. {summary.placesToPick
                  ? "Pick each camp, exit and pass from its results under Camps, then check the trip."
                  : multiDay ? "Review it, then check the trip." : "Review it, then create the brief."}</>
                : multiDay
                  ? "Nothing in that description matched the trip; fill it in below."
                  : "Nothing in that sentence matched the plan; fill it in below."}
            </p>
            {summary.notes.length > 0 && (
              <p className="sky-plan-sentence-notes">Not set: {summary.notes.join("; ")}</p>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
