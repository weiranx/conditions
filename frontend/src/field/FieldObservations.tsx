import { useContext, useEffect, useRef, useState } from "react";
import { Info, MessageSquareQuote, Sparkles } from "lucide-react";
import { AiAccessContext } from "../contexts/ai-access";
import {
  FIELD_OBSERVATION_TEXT_LIMIT,
  extractFieldObservations,
  fieldObservationKey,
  storeFieldObservations,
  useStoredFieldObservations,
  type FieldObservation,
} from "../lib/field-observations";
import "./field-observations.css";

const SURFACE_LABELS: Record<string, string> = {
  "dry-trail": "Dry trail",
  "wet-trail": "Wet trail",
  mud: "Mud",
  "firm-snow": "Firm snow",
  "soft-snow": "Soft snow",
  slush: "Slush",
  ice: "Ice",
  verglas: "Verglas",
  mixed: "Mixed",
  unknown: "Surface not stated",
};

function ageLabel(observation: FieldObservation): string {
  if (!observation.observedDate) return "Date not stated";
  if (observation.ageDays === null) return observation.observedDate;
  if (observation.ageDays < 0) return `${observation.observedDate} · after your date`;
  if (observation.ageDays === 0) return `${observation.observedDate} · same day`;
  return `${observation.observedDate} · ${observation.ageDays} day${observation.ageDays === 1 ? "" : "s"} before`;
}

export interface FieldObservationsProps {
  objective: { name: string; lat: number; lon: number; elevationFt?: number | null };
  /** Planned trip date, YYYY-MM-DD. */
  date: string | null;
  /** AI extraction is configured and enabled on this server. */
  available: boolean;
  /** A saved report is open: nothing new can be added to it. */
  readOnly?: boolean;
  formatElevation: (feet: number) => string;
}

/** What people saw on the ground, read from a pasted trip report. Shown as evidence; it never changes the verdict. */
export function FieldObservations({ objective, date, available, readOnly = false, formatElevation }: FieldObservationsProps) {
  const access = useContext(AiAccessContext);
  const [text, setText] = useState("");
  const storeKey = fieldObservationKey(objective.lat, objective.lon, date);
  const observations = useStoredFieldObservations(storeKey);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const tooLong = text.length > FIELD_OBSERVATION_TEXT_LIMIT;
  const canExtract = available && !readOnly;

  const extract = async () => {
    if (loading || !text.trim() || tooLong) return;
    if (access && !access.requestAiAccess()) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setError(null);
    try {
      const result = await extractFieldObservations({ text, objective, date }, request.signal);
      if (request.signal.aborted) return;
      storeFieldObservations(storeKey, result.observations);
    } catch (caught) {
      if (request.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "Could not read observations from that text.");
    } finally {
      if (controller.current === request) {
        controller.current = null;
        setLoading(false);
      }
    }
  };

  if (!canExtract && observations === null) return null;

  return (
    <section className="sky-card sky-section ai-panel field-observations" aria-labelledby="sky-field-observations" aria-busy={loading}>
      <div className="ai-panel-head">
        <span className="sky-card-head">
          <span id="sky-field-observations">Field observations</span>
          <span className="ai-panel-badge"><Sparkles size={11} aria-hidden="true" />AI</span>
        </span>
        <MessageSquareQuote size={18} aria-hidden="true" className="sky-muted" />
      </div>
      {canExtract && (
        <form
          className="field-observations-form"
          onSubmit={(event) => {
            event.preventDefault();
            void extract();
          }}
        >
          <label htmlFor="field-observations-text">Paste a trip report or what you saw</label>
          <textarea
            id="field-observations-text"
            rows={4}
            value={text}
            placeholder="e.g. Sat 10/4: dry trail to 9,000 ft, then firm snow on the north side of the bowl. Postholing after noon."
            onChange={(event) => setText(event.target.value)}
          />
          <div className="field-observations-actions">
            <span className={tooLong ? "field-observations-count is-over" : "field-observations-count"}>
              {text.length.toLocaleString("en-US")} / {FIELD_OBSERVATION_TEXT_LIMIT.toLocaleString("en-US")}
            </span>
            <button
              type="submit"
              className="field-button field-button-primary"
              disabled={!text.trim() || tooLong}
              aria-disabled={loading || undefined}
            >
              <Sparkles size={16} aria-hidden="true" />
              {loading ? "Extracting…" : "Extract"}
            </button>
          </div>
        </form>
      )}
      {error && <p className="sky-notice is-caution" role="alert">{error}</p>}
      {observations !== null && (
        observations.length === 0 ? (
          <p className="sky-cap is-body">No observations with a supporting sentence were found in that text.</p>
        ) : (
          <ul className="field-observations-list" aria-label="Extracted observations">
            {observations.map((observation, index) => {
              const place = [
                observation.location,
                observation.elevationFt !== null ? formatElevation(observation.elevationFt) : null,
                observation.aspect ? `${observation.aspect} aspect` : null,
              ].filter(Boolean).join(" · ");
              return (
                <li key={`${observation.quote}-${index}`} className={observation.stale ? "field-observation is-stale" : "field-observation"}>
                  <div className="field-observation-meta">
                    <span>{ageLabel(observation)}</span>
                    {observation.stale && <span className="sky-chip">{observation.observedDate ? "Old" : "Undated"}</span>}
                    <span className="sky-chip">{observation.confidence} confidence</span>
                  </div>
                  <p className="field-observation-surface">
                    <strong>{SURFACE_LABELS[observation.surface] ?? SURFACE_LABELS.unknown}</strong>
                    {place && <> · {place}</>}
                    {observation.snowlineFt !== null && <> · snowline {formatElevation(observation.snowlineFt)}</>}
                  </p>
                  {observation.hazards.length > 0 && (
                    <ul className="field-observation-hazards" aria-label="Hazards">
                      {observation.hazards.map((hazard) => <li key={hazard}>{hazard}</li>)}
                    </ul>
                  )}
                  <blockquote>{observation.quote}</blockquote>
                </li>
              );
            })}
          </ul>
        )
      )}
      <p className="ai-brief-footnote">
        <Info size={13} aria-hidden="true" />
        Read by AI from text you pasted and checked against it word for word. These are other
        people’s observations: they do not change the verdict, and conditions may have changed since.
      </p>
    </section>
  );
}
