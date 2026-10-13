import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import type { Workspace } from "./model/useWorkspace";
import { ACTIVITY_PROFILES } from "../app/activity-profiles";
import { activeActivityKey } from "../app/activity-limits";
import { convertElevationFeetToDisplayValue, formatClockForStyle } from "../app/core";
import type { UserPreferences } from "../app/types";
import { PLAN_SENTENCE_MAX_LENGTH, parsePlanSentence, type ParsedPlan } from "../lib/plan-parse";
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

/**
 * "Describe your plan": one sentence read into the plan form. The place goes
 * into the search box for the traveler to pick; the day, start, duration,
 * activity and limits go through the form's own setters. Nothing is run.
 */
export function PlanSentence({
  workspace: w,
  placeKey,
  onDate,
  onStart,
  onDuration,
  onPlaceQuery,
}: {
  workspace: Workspace;
  /** Changes whenever a different place is chosen. */
  placeKey: string;
  onDate: (date: string) => void;
  onStart: (time: string) => void;
  onDuration: (hours: number) => void;
  onPlaceQuery: (query: string) => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<{ filled: string[]; notes: string[] } | null>(null);
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

  function apply(plan: ParsedPlan) {
    const filled: string[] = [];
    const notes = [...plan.notes];
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
    if (plan.activity && ACTIVITY_PROFILES[plan.activity]) {
      if (activeActivityKey(w.preferences) !== plan.activity) {
        if (w.safetyData) w.handleEditPlan();
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
      if (w.safetyData) w.handleEditPlan();
      w.updatePreferences(limits);
      if (limits.maxWindGustMph !== undefined) filled.push(`gusts ≤ ${w.formatWindDisplay(limits.maxWindGustMph)}`);
      if (limits.maxPrecipChance !== undefined) filled.push(`rain or snow ≤ ${limits.maxPrecipChance}%`);
      if (limits.minFeelsLikeF !== undefined) filled.push(`feels ≥ ${w.formatTempDisplay(limits.minFeelsLikeF)}`);
      if (limits.maxFeelsLikeF !== undefined) filled.push(`feels ≤ ${w.formatTempDisplay(limits.maxFeelsLikeF)}`);
    }
    const target = plan.params.target_elevation_ft;
    if (typeof target === "number") {
      if (plan.placeQuery) setPendingElevation({ feet: target, placeKey });
      else applyElevation(target);
      filled.push(`target ${w.formatElevationDisplay(target)}`);
    }
    if (plan.placeQuery) {
      onPlaceQuery(plan.placeQuery);
      filled.unshift(`${plan.placeQuery} (pick it from the results)`);
    }
    setSummary({ filled, notes });
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
      );
      if (controller.signal.aborted) return;
      apply(plan);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "Could not read that plan.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }

  return (
    <div className="sky-plan-sentence">
      <label htmlFor={`${id}-sentence`}>Describe your plan</label>
      <div className="sky-plan-sentence-row">
        <input
          id={`${id}-sentence`}
          value={text}
          maxLength={PLAN_SENTENCE_MAX_LENGTH}
          placeholder="Split Mountain Saturday, ski the north couloir, 3am start, bail over 30 mph"
          autoComplete="off"
          enterKeyHint="go"
          aria-describedby={`${id}-sentence-status`}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Enter fills the form; it must not submit the plan.
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
        />
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
              {summary.filled.length
                ? <>Filled in: {summary.filled.join(" · ")}. Review it, then create the brief.</>
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
