import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchApi } from "../../lib/api-client";
import { ITINERARY_DRAFT_KEY } from "../../app/constants";
import { parseMultiDayUsage, type MultiDayUsage } from "../../app/multi-day-usage";
import { addDaysToIsoDate } from "../../app/core";
import type { UserPreferences } from "../../app/types";
import {
  buildItineraryRequest,
  buildItineraryStages,
  createItineraryDraft,
  itineraryEndDate,
  itineraryGaps,
  maxNightsWithinForecast,
  parseItineraryResults,
  parseStoredItinerary,
  readItineraryAssessment,
  setItineraryNights,
  type ItineraryCheckResult,
  type ItineraryDraft,
  type ItineraryPoint,
  type PlanMode,
} from "../../app/itinerary";

/** The trip checked from another start date, for comparison. */
export interface ItineraryAlternative {
  startDate: string;
  result: ItineraryCheckResult | null;
  error: string | null;
  loading: boolean;
}

/** Where the next map tap goes while building a trip; null moves the objective as usual. */
export type ItineraryPickTarget =
  | { kind: "camp"; index: number }
  | { kind: "exit" }
  | { kind: "checkpoint"; day: number }
  | { kind: "bail" };

function loadStored() {
  try {
    const raw = window.localStorage.getItem(ITINERARY_DRAFT_KEY);
    return raw ? parseStoredItinerary(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function storeDraft(mode: PlanMode, draft: ItineraryDraft) {
  try {
    window.localStorage.setItem(ITINERARY_DRAFT_KEY, JSON.stringify({ mode, draft }));
  } catch {
    // Private windows and full storage keep the draft for this visit only.
  }
}

export function useItinerary({
  enabled,
  todayDate,
  maxForecastDate,
  initialStartDate,
  initialStartTime,
  preferences,
  onUsageUpdated,
  onUsageLimitReached,
}: {
  enabled: boolean;
  todayDate: string;
  maxForecastDate: string;
  initialStartDate: string;
  initialStartTime: string;
  preferences: UserPreferences;
  onUsageUpdated?: (usage: MultiDayUsage) => void;
  onUsageLimitReached?: (usage: MultiDayUsage) => void;
}) {
  const [stored] = useState(loadStored);
  const [mode, setModeState] = useState<PlanMode>(stored?.mode ?? "day");
  const [draft, setDraftState] = useState<ItineraryDraft>(() => stored?.draft ?? createItineraryDraft({
    startDate: initialStartDate,
    start: initialStartTime,
    travelHours: Math.min(8, preferences.travelWindowHours),
  }));
  const [result, setResult] = useState<ItineraryCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openDayIndex, setOpenDayIndex] = useState<number | null>(null);
  const [pickTarget, setPickTarget] = useState<ItineraryPickTarget | null>(null);
  // A trip opened from Saved reports reads as a snapshot until it is checked again.
  const [fromSaved, setFromSaved] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const alternativeRequest = useRef<AbortController | null>(null);
  const [alternatives, setAlternatives] = useState<ItineraryAlternative[]>([]);

  // Multi-day planning is off when the flag is, whatever was stored.
  const activeMode: PlanMode = enabled ? mode : "day";

  useEffect(() => storeDraft(mode, draft), [mode, draft]);
  useEffect(() => () => {
    activeRequest.current?.abort();
    alternativeRequest.current?.abort();
  }, []);

  const cancel = useCallback(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setLoading(false);
  }, []);

  /** Any change to the trip makes the last check stale. */
  const updateDraft = useCallback((update: (current: ItineraryDraft) => ItineraryDraft) => {
    cancel();
    alternativeRequest.current?.abort();
    setAlternatives([]);
    setResult(null);
    setFromSaved(false);
    setError(null);
    setOpenDayIndex(null);
    setDraftState((current) => update(current));
  }, [cancel]);

  const setMode = useCallback((next: PlanMode) => {
    setModeState(next);
    setPickTarget(null);
    setOpenDayIndex(null);
  }, []);

  // A start date that has slipped into the past, or past the forecast, moves
  // to today; the trip then shortens to the days that fit.
  useEffect(() => {
    const outOfRange = !draft.startDate || draft.startDate < todayDate || draft.startDate > maxForecastDate;
    const fits = maxNightsWithinForecast(outOfRange ? todayDate : draft.startDate, maxForecastDate);
    if (!outOfRange && draft.camps.length <= fits) return;
    setDraftState((current) => setItineraryNights({ ...current, startDate: outOfRange ? todayDate : current.startDate }, Math.min(current.camps.length, fits)));
  }, [draft.startDate, draft.camps.length, todayDate, maxForecastDate]);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  /** Follows the plan's objective while the trip is being built. */
  const setTrailhead = useCallback((trailhead: ItineraryPoint | null) => {
    const current = draftRef.current.trailhead;
    const same = current && trailhead
      ? current.lat === trailhead.lat && current.lon === trailhead.lon && current.name === trailhead.name
      : current === trailhead;
    if (same) return;
    updateDraft((previous) => ({ ...previous, trailhead }));
  }, [updateDraft]);

  const stages = useMemo(() => buildItineraryStages(draft), [draft]);
  const gaps = useMemo(() => itineraryGaps(draft), [draft]);
  // The backend's reading of the trip, with the limits it was checked with.
  const assessment = result?.assessment ?? null;

  type CheckOutcome = { ok: true; result: ItineraryCheckResult } | { ok: false; error: string | null; limited?: boolean };

  /** One itinerary check for `planned`; usage and limit prompts are reported as they arrive. */
  const requestCheck = useCallback(async (checkDraft: ItineraryDraft, signal: AbortSignal): Promise<CheckOutcome> => {
    const planned = buildItineraryStages(checkDraft);
    if (!planned) return { ok: false, error: itineraryGaps(checkDraft)[0] || "Finish the trip before checking it." };
    if (planned[planned.length - 1].date > maxForecastDate) {
      return { ok: false, error: "The trip runs past the last forecast day. Start earlier or plan fewer nights." };
    }
    const { response, payload } = await fetchApi("/api/itineraries/check", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "Idempotency-Key": `itinerary-${crypto.randomUUID()}` },
      body: JSON.stringify(buildItineraryRequest(checkDraft, planned, preferences)),
    });
    const record = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
    const usage = parseMultiDayUsage(record?.multiDayUsage);
    if (usage) onUsageUpdated?.(usage);
    if (!response.ok) {
      if (response.status === 429 && usage) {
        onUsageLimitReached?.(usage);
        return { ok: false, error: null, limited: true };
      }
      return { ok: false, error: typeof record?.error === "string" ? record.error : "Could not check this trip right now. Try again in a moment." };
    }
    return {
      ok: true,
      result: {
        checkedAt: typeof record?.checkedAt === "string" ? record.checkedAt : new Date().toISOString(),
        startDate: checkDraft.startDate,
        stages: planned,
        results: parseItineraryResults(record, planned),
        assessment: readItineraryAssessment(record?.assessment),
        chatContext: record?.chatContext ?? null,
        preferences,
      },
    };
  }, [maxForecastDate, preferences, onUsageUpdated, onUsageLimitReached]);

  const runCheck = useCallback(async () => {
    cancel();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setError(null);
    setResult(null);
    setFromSaved(false);
    setAlternatives([]);
    setOpenDayIndex(null);
    setPickTarget(null);
    try {
      const outcome = await requestCheck(draft, controller.signal);
      if (activeRequest.current !== controller) return false;
      if (!outcome.ok) {
        setError(outcome.error);
        return false;
      }
      setResult(outcome.result);
      return true;
    } catch {
      if (activeRequest.current !== controller) return false;
      setError("Could not check this trip right now. Try again in a moment.");
      return false;
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setLoading(false);
      }
    }
  }, [cancel, draft, requestCheck]);

  /**
   * The same trip starting later, one check per start date, so the user can
   * see where the weak link moves. Each start date is one multi-day check.
   */
  const compareStartDates = useCallback(async (offsets: number[]) => {
    alternativeRequest.current?.abort();
    const controller = new AbortController();
    alternativeRequest.current = controller;
    const starts = offsets
      .map((offset) => addDaysToIsoDate(draft.startDate, offset))
      .filter((startDate) => {
        const end = itineraryEndDate({ startDate, camps: draft.camps });
        return end !== null && end <= maxForecastDate;
      });
    setAlternatives(starts.map((startDate) => ({ startDate, result: null, error: null, loading: true })));
    for (const startDate of starts) {
      let entry: ItineraryAlternative;
      let limited = false;
      try {
        const outcome = await requestCheck({ ...draft, startDate }, controller.signal);
        limited = !outcome.ok && outcome.limited === true;
        entry = outcome.ok
          ? { startDate, result: outcome.result, error: null, loading: false }
          : { startDate, result: null, error: limited ? "Your multi-day allowance is used up." : outcome.error, loading: false };
      } catch {
        entry = { startDate, result: null, error: "Could not check this start date.", loading: false };
      }
      if (alternativeRequest.current !== controller) return;
      setAlternatives((current) => current.map((item) => (item.startDate === startDate ? entry : item)));
      // A reached limit stops the rest rather than failing each in turn.
      if (limited) {
        setAlternatives((current) => current.map((item) => (item.loading ? { ...item, loading: false, error: "Not checked." } : item)));
        break;
      }
    }
    if (alternativeRequest.current === controller) alternativeRequest.current = null;
  }, [draft, maxForecastDate, requestCheck]);

  /** Make a compared start date the trip. */
  const chooseAlternative = useCallback((startDate: string) => {
    const chosen = alternatives.find((item) => item.startDate === startDate && item.result);
    if (!chosen?.result) return;
    alternativeRequest.current?.abort();
    setDraftState((current) => ({ ...current, startDate }));
    setResult(chosen.result);
    setFromSaved(false);
    setAlternatives([]);
    setOpenDayIndex(null);
  }, [alternatives]);

  /** A saved trip opened from the library: its plan and its checked days, read-only until re-checked. */
  const restore = useCallback((savedDraft: ItineraryDraft, savedResult: ItineraryCheckResult | null) => {
    cancel();
    alternativeRequest.current?.abort();
    setAlternatives([]);
    setModeState("multi");
    setDraftState(savedDraft);
    setResult(savedResult);
    setFromSaved(savedResult !== null);
    setError(null);
    setOpenDayIndex(null);
    setPickTarget(null);
  }, [cancel]);

  return {
    mode: activeMode,
    setMode,
    draft,
    updateDraft,
    setTrailhead,
    stages,
    gaps,
    result,
    assessment,
    loading,
    error,
    setError,
    runCheck,
    compareStartDates,
    alternatives,
    chooseAlternative,
    restore,
    fromSaved,
    openDayIndex,
    setOpenDayIndex,
    pickTarget,
    setPickTarget,
    maxNights: maxNightsWithinForecast(draft.startDate || todayDate, maxForecastDate),
  };
}

export type ItineraryState = ReturnType<typeof useItinerary>;
