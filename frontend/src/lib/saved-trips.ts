import {
  buildSavedTrip,
  parseSavedTrip,
  stagePlan,
  stageStartElevationFt,
  type ItineraryCheckResult,
  type ItineraryDraft,
  type ItineraryVerdictLevel,
} from '../app/itinerary';
import { buildPersistedReport } from '../app/report-storage';
import type { UserPreferences } from '../app/types';
import { fetchApi, readApiErrorMessage } from './api-client';
import { saveObjectiveWatch, type ObjectiveWatchPolicy } from './objective-watches';

export interface SavedTripSummary {
  id: string;
  title: string;
  startDate: string | null;
  dayCount: number | null;
  verdictLevel: ItineraryVerdictLevel | null;
  checkedAt: string | null;
  createdAt: string | null;
}

const VERDICTS = new Set(['GO', 'CAUTION', 'NO-GO', 'INCOMPLETE']);

function parseSummary(value: unknown): SavedTripSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const trip = value as Record<string, unknown>;
  if (typeof trip.id !== 'string' || typeof trip.title !== 'string') return null;
  const text = (key: string) => (typeof trip[key] === 'string' ? trip[key] as string : null);
  return {
    id: trip.id,
    title: trip.title,
    startDate: text('startDate'),
    dayCount: typeof trip.dayCount === 'number' ? trip.dayCount : null,
    verdictLevel: VERDICTS.has(String(trip.verdictLevel)) ? trip.verdictLevel as ItineraryVerdictLevel : null,
    checkedAt: text('checkedAt'),
    createdAt: text('createdAt'),
  };
}

export async function listSavedTrips(): Promise<SavedTripSummary[]> {
  const { response, payload } = await fetchApi('/api/account/trips');
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not load saved trips.'));
  const trips = (payload as { trips?: unknown } | null)?.trips;
  return Array.isArray(trips) ? trips.map(parseSummary).filter((trip): trip is SavedTripSummary => Boolean(trip)) : [];
}

export async function saveTrip(draft: ItineraryDraft, result: ItineraryCheckResult): Promise<SavedTripSummary> {
  const { response, payload } = await fetchApi('/api/account/trips', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trip: buildSavedTrip(draft, result) }),
  });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not save this trip.'));
  const saved = parseSummary((payload as { trip?: unknown } | null)?.trip);
  if (!saved) throw new Error('Saved trips returned an unexpected response.');
  return saved;
}

export async function loadSavedTrip(id: string) {
  const { response, payload } = await fetchApi(`/api/account/trips/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not open this trip.'));
  const trip = parseSavedTrip((payload as { trip?: { snapshot?: unknown } } | null)?.trip?.snapshot);
  if (!trip) throw new Error('This saved trip is incomplete and could not be opened.');
  return trip;
}

export async function deleteSavedTrip(id: string): Promise<void> {
  const { response, payload } = await fetchApi(`/api/account/trips/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not delete this trip.'));
}

/**
 * Watches each upcoming day of a checked trip as its own objective watch, so
 * the watchlist re-checks every day and flags changes. Stops at the account's
 * watch limit and says how far it got.
 */
export async function watchTripDays(
  draft: ItineraryDraft,
  result: ItineraryCheckResult,
  preferences: UserPreferences,
  convertStartElevation: (feet: number) => string,
  todayDate: string,
): Promise<{ watched: number[]; skipped: number[]; limited: boolean; policy: ObjectiveWatchPolicy | null; error: string | null }> {
  const tripName = draft.name || (draft.trailhead?.name ? `${draft.trailhead.name} trip` : 'Trip');
  const watched: number[] = [];
  const skipped: number[] = [];
  let policy: ObjectiveWatchPolicy | null = null;
  for (const stage of result.stages) {
    const report = result.results[stage.index]?.report;
    if (!report || stage.date < todayDate) {
      skipped.push(stage.index);
      continue;
    }
    const startFt = stageStartElevationFt(stage, result.results[stage.index]);
    const plan = {
      ...stagePlan(stage, startFt === null ? '' : convertStartElevation(startFt)),
      objectiveName: `${tripName} · Day ${stage.index + 1} · ${stage.to.name || 'camp'}`.slice(0, 160),
    };
    try {
      const saved = await saveObjectiveWatch(buildPersistedReport(plan, report, {
        aiBriefNarrative: null,
        snowVisionAnalysis: null,
        snowVisionImage: null,
        reportChatMessages: [],
      }, { preferences: { ...(result.preferences ?? preferences), travelWindowHours: stage.travelHours } }));
      policy = saved.policy;
      watched.push(stage.index);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not watch this trip.';
      // The watch limit is reached: say how many days made it.
      const limited = /includes up to \d+ active objective/i.test(message);
      return { watched, skipped, limited, policy, error: message };
    }
  }
  return { watched, skipped, limited: false, policy, error: null };
}
