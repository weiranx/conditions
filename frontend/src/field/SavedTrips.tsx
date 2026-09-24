import { useEffect, useId, useState } from "react";
import { ArrowUpRight, Backpack, LoaderCircle, Trash2 } from "lucide-react";
import type { Workspace } from "./model/useWorkspace";
import { deleteSavedTrip, listSavedTrips, loadSavedTrip, type SavedTripSummary } from "../lib/saved-trips";
import type { ItineraryVerdictLevel } from "../app/itinerary";
import { ageLabel, dateLabel } from "./data";

const VERDICT_LABEL: Record<ItineraryVerdictLevel, string> = {
  GO: "Go",
  CAUTION: "Caution",
  "NO-GO": "No-go",
  INCOMPLETE: "Not cleared",
};

/** Trips saved from the trip brief, after the single-day reports in Saved reports. */
export function SavedTrips({ workspace: w }: { workspace: Workspace }) {
  const id = useId();
  const [trips, setTrips] = useState<SavedTripSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const userId = w.accountUser?.id ?? null;

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;
    listSavedTrips()
      .then((list) => { if (active) setTrips(list); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load saved trips."); });
    return () => { active = false; };
  }, [userId]);

  if (!userId || (trips !== null && trips.length === 0 && !error)) return null;

  async function open(trip: SavedTripSummary) {
    setPending(trip.id);
    setError(null);
    try {
      const saved = await loadSavedTrip(trip.id);
      w.openSavedTrip(saved.draft, saved.result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not open this trip.");
    } finally {
      setPending(null);
    }
  }

  async function remove(trip: SavedTripSummary) {
    if (!window.confirm(`Delete the saved trip “${trip.title}”? This cannot be undone.`)) return;
    setPending(`delete-${trip.id}`);
    setError(null);
    try {
      await deleteSavedTrip(trip.id);
      setTrips((current) => (current ?? []).filter((item) => item.id !== trip.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete this trip.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="sky-section" aria-labelledby={`${id}-trips`}>
      <div className="sky-sh">
        <h2 id={`${id}-trips`}>Saved trips</h2>
        <p>Multi-day trips as they were checked. Open one to review it or check it again.</p>
      </div>
      {error && <p className="sky-notice is-caution" role="alert">{error}</p>}
      {trips === null && !error && <p className="sky-cap" role="status">Loading saved trips…</p>}
      {trips && trips.length > 0 && (
        <div className="sky-card sky-row-list">
          {trips.map((trip) => (
            <article className="field-library-entry" key={trip.id}>
              <button className="field-journal-entry sky-report-row" disabled={Boolean(pending)} onClick={() => void open(trip)}>
                <span className="sky-date-badge" aria-hidden="true"><Backpack size={18} /></span>
                <span className="sky-report-copy">
                  <strong>{trip.title}</strong>
                  <small>
                    {trip.startDate ? dateLabel(trip.startDate) : "Date unavailable"}
                    {trip.dayCount ? ` · ${trip.dayCount} days` : ""}
                    {trip.verdictLevel ? ` · ${VERDICT_LABEL[trip.verdictLevel]}` : ""}
                  </small>
                  <small>Checked {ageLabel(trip.checkedAt)}</small>
                </span>
                {pending === trip.id
                  ? <LoaderCircle className="field-history-spinner" size={18} aria-label="Opening trip" />
                  : <ArrowUpRight size={18} aria-hidden="true" />}
              </button>
              <button
                className="sky-row-action"
                disabled={Boolean(pending)}
                aria-label={`Delete saved trip ${trip.title}`}
                onClick={() => void remove(trip)}
              >
                <Trash2 size={15} aria-hidden="true" />
                <span>Delete</span>
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
