import { useEffect, useId, useRef, useState } from "react";
import { Footprints, Info, Sparkles, Upload } from "lucide-react";
import type { PersistedReport } from "../app/report-storage";
import { readGpxRecordedTrack, type RecordedTrackPoint } from "../lib/gpx";
import {
  formatDuration,
  requestTripDebrief,
  type TripDebriefComparison,
  type TripDebriefHour,
  type TripDebriefResult,
} from "../lib/trip-debrief";
import { Markdown } from "./Markdown";
import { AiExplanationSkeleton } from "./AiExplanation";
import "./ai-explanation.css";
import "./trip-debrief.css";

const number = (value: number, digits = 0) =>
  value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const miles = (value: number | null | undefined) => (Number.isFinite(value) ? `${number(value as number, 1)} mi` : "—");
const feet = (value: number | null | undefined) => (Number.isFinite(value) ? `${number(value as number)} ft` : "—");

/** A signed difference in words: "30m later", "10m before". */
function offset(minutes: number | null | undefined, later: string, earlier: string, same = "on time"): string | null {
  if (!Number.isFinite(minutes)) return null;
  const value = Math.round(minutes as number);
  if (value === 0) return same;
  return `${formatDuration(value)} ${value > 0 ? later : earlier}`;
}

const signed = (value: number | null | undefined, format: (n: number) => string) => {
  if (!Number.isFinite(value)) return null;
  const n = value as number;
  return n === 0 ? "same" : `${n > 0 ? "+" : "−"}${format(Math.abs(n))}`;
};

const paceText = (pace: { minutesPerMile: number; ascentMinutesPer1000Ft: number }) =>
  `${pace.minutesPerMile} min/mi + ${pace.ascentMinutesPer1000Ft} min per 1,000 ft`;

const PACE_SOURCE: Record<string, string> = {
  "route-your-pace": "your pace on the route",
  "route-default": "route default",
  plan: "plan",
  preferences: "your saved pace",
  activity: "activity default",
  default: "default",
};

type Row = { label: string; planned: string; actual: string; difference: string | null };

function comparisonRows(c: TripDebriefComparison, clock: (hhmm: string) => string): Row[] {
  const { track, plan, differences: d } = c;
  const at = (hhmm: string | null) => (hhmm ? clock(hhmm) : "—");
  const rows: Row[] = [];
  rows.push({
    label: "Start",
    planned: at(plan.startClock),
    actual: track.hasTimes ? at(track.startClock) : "—",
    difference: offset(d.startMinutes, "later", "earlier"),
  });
  rows.push({
    label: "Time out",
    planned: [
      plan.travelWindowHours != null ? `${plan.travelWindowHours} h window` : null,
      plan.estimatedMinutes != null ? `est. ${formatDuration(plan.estimatedMinutes)}` : null,
    ].filter(Boolean).join(" · ") || "—",
    actual: track.hasTimes ? `${formatDuration(track.elapsedMinutes)} (moving ${formatDuration(track.movingMinutes)})` : "—",
    difference: offset(d.elapsedVsWindowMinutes, "over the window", "under the window", "matched the window"),
  });
  rows.push({
    label: "Distance",
    planned: miles(plan.route?.distanceMiles),
    actual: miles(track.distanceMiles),
    difference: signed(d.distanceMiles, (n) => miles(n)),
  });
  rows.push({
    label: "Gain",
    planned: feet(plan.route?.gainFt),
    actual: feet(track.gainFt),
    difference: signed(d.gainFt, (n) => feet(n)),
  });
  rows.push({ label: "Loss", planned: "—", actual: feet(track.lossFt), difference: null });
  rows.push({
    label: "Moving pace",
    planned: `${paceText(plan.pace)} (${PACE_SOURCE[plan.pace.source] ?? plan.pace.source})`,
    actual: d.paceRatio != null
      ? `${formatDuration(track.movingMinutes)} vs ${formatDuration(d.plannedMovingMinutes)} at plan pace`
      : "—",
    difference: d.matchingPace ? `Matching pace: ${paceText(d.matchingPace)}` : null,
  });
  const { climbing, descending, flat } = track.pace;
  if (climbing?.minutesPerMile != null) rows.push({
    label: "Climbs",
    planned: "—",
    actual: `${number(climbing.miles, 1)} mi · ${climbing.minutesPerMile} min/mi · ${number(climbing.verticalFtPerHour ?? 0)} ft/h up`,
    difference: null,
  });
  if (descending?.minutesPerMile != null) rows.push({
    label: "Descents",
    planned: "—",
    actual: `${number(descending.miles, 1)} mi · ${descending.minutesPerMile} min/mi · ${number(descending.verticalFtPerHour ?? 0)} ft/h down`,
    difference: null,
  });
  if (flat?.minutesPerMile != null) rows.push({
    label: "Flats",
    planned: `${plan.pace.minutesPerMile} min/mi`,
    actual: `${number(flat.miles, 1)} mi · ${flat.minutesPerMile} min/mi`,
    difference: null,
  });
  rows.push({
    label: "Stops",
    planned: formatDuration(plan.pace.stopBufferMinutes),
    actual: track.hasTimes ? formatDuration(track.stoppedMinutes) : "—",
    difference: offset(d.stoppedVsPlannedMinutes, "more", "less", "as planned"),
  });
  rows.push({
    label: "High point",
    planned: plan.turnaroundClock ? `turn around by ${at(plan.turnaroundClock)}` : "—",
    actual: track.highPoint
      ? `${feet(track.highPoint.elevationFt)}${track.highPoint.clock ? ` at ${at(track.highPoint.clock)}` : ""}`
      : "—",
    difference: offset(d.highPointMarginToTurnaroundMinutes, "before turnaround", "after turnaround"),
  });
  rows.push({
    label: "Finish",
    planned: [plan.endClock ? `plan ends ${at(plan.endClock)}` : null, plan.sunsetClock ? `sunset ${at(plan.sunsetClock)}` : null]
      .filter(Boolean).join(" · ") || "—",
    actual: track.hasTimes ? at(track.finishClock) : "—",
    difference: [
      offset(d.finishMarginToPlanEndMinutes, "before plan end", "after plan end", "at plan end"),
      offset(d.finishMarginToSunsetMinutes, "before sunset", "after sunset", "at sunset"),
    ].filter(Boolean).join(" · ") || null,
  });
  return rows;
}

function HourRow({ hour, clock }: { hour: TripDebriefHour; clock: (hhmm: string) => string }) {
  const where = hour.highElevationFt == null
    ? "—"
    : hour.lowElevationFt != null && hour.highElevationFt - hour.lowElevationFt >= 100
      ? `${number(hour.lowElevationFt)}–${feet(hour.highElevationFt)}`
      : feet(hour.highElevationFt);
  const f = hour.forecast;
  const high = hour.atHigh;
  if (!f) {
    return (
      <tr>
        <th scope="row">{clock(hour.clock)}</th>
        <td>{where}</td>
        <td colSpan={3}>No forecast for this hour</td>
      </tr>
    );
  }
  const temp = high ? `${high.tempF}°F` : f.tempF != null ? `${f.tempF}°F` : "—";
  const lowTemp = hour.atLow ? ` (${hour.atLow.tempF}°F low)` : "";
  const wind = high
    ? `${high.windMph}${high.gustMph != null ? ` g${high.gustMph}` : ""} mph`
    : f.windMph != null ? `${f.windMph}${f.gustMph != null ? ` g${f.gustMph}` : ""} mph` : "—";
  return (
    <tr>
      <th scope="row">{clock(hour.clock)}</th>
      <td>{where}</td>
      <td className="is-num">{temp}{lowTemp}</td>
      <td className="is-num">{wind}</td>
      <td className="is-num">{f.precipChance != null ? `${f.precipChance}%` : "—"}</td>
    </tr>
  );
}

/**
 * After the trip: compare a recorded GPX track with what this saved report
 * planned and forecast. The comparison comes from the backend; the AI only
 * writes the short debrief under it.
 */
export function TripDebrief({
  report,
  aiAvailable,
  formatClock,
}: {
  report: PersistedReport;
  aiAvailable: boolean;
  formatClock: (hhmm: string) => string;
}) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [track, setTrack] = useState<{ name: string; fileName: string; points: RecordedTrackPoint[] } | null>(null);
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<TripDebriefResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  // Only a trip that has started can be debriefed.
  const plannedStart = Date.parse(report.safetyData.forecast?.selectedStartTime ?? "");
  if (Number.isFinite(plannedStart) && plannedStart > Date.now()) return null;

  async function chooseFile(file: File) {
    setError(null);
    setResult(null);
    try {
      const parsed = await readGpxRecordedTrack(file);
      setTrack({ ...parsed, fileName: file.name });
    } catch (reason) {
      setTrack(null);
      setError(reason instanceof Error ? reason.message : "Could not read this GPX file.");
    }
  }

  async function compare() {
    if (!track || loading) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      const next = await requestTripDebrief(report, track.points, notes, controller.signal);
      if (!controller.signal.aborted) setResult(next);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not compare this track.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }

  const timed = track ? track.points.filter((point) => point.time).length : 0;
  const comparison = result?.comparison ?? null;
  const rows = comparison ? comparisonRows(comparison, formatClock) : [];
  return (
    <section className="field-panel ai-brief trip-debrief" aria-labelledby={`${id}-title`} aria-busy={loading}>
      <div className="ai-brief-heading">
        <div>
          <span className="field-kicker ai-brief-kicker">
            <Footprints size={14} aria-hidden="true" />
            After the trip
          </span>
          <h2 id={`${id}-title`}>Debrief this trip</h2>
        </div>
      </div>
      <p className="trip-debrief-intro">
        Add the GPX you recorded (Strava, Garmin, or any watch or app) to compare what happened with
        what this report planned and forecast: start, time out, pace, miles and feet climbed, and the
        forecast for the hours you were out.
      </p>
      <div className="trip-debrief-form">
        <input
          ref={fileInput}
          type="file"
          accept=".gpx,application/gpx+xml"
          hidden
          aria-label="Recorded GPX track"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void chooseFile(file);
            event.target.value = "";
          }}
        />
        <button type="button" className="field-button" onClick={() => fileInput.current?.click()}>
          <Upload size={16} aria-hidden="true" />
          {track ? "Choose another GPX" : "Choose recorded GPX"}
        </button>
        {track && (
          <p className="trip-debrief-file" role="status">
            {track.name} · {number(track.points.length)} points
            {timed === 0 ? " · no timestamps, so only distance and climb can be compared" : ""}
          </p>
        )}
        <label className="trip-debrief-notes" htmlFor={`${id}-notes`}>
          <span>How did it go? <small>Optional, used for the written debrief</small></span>
          <textarea
            id={`${id}-notes`}
            rows={2}
            maxLength={2000}
            value={notes}
            placeholder="e.g. gusts much stronger than forecast on the ridge"
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="field-button field-button-primary"
          disabled={!track}
          aria-disabled={loading || undefined}
          onClick={() => void compare()}
        >
          {loading ? "Comparing…" : "Compare with the plan"}
        </button>
      </div>
      {error && <p className="field-warning" role="alert">{error}</p>}
      {loading && <AiExplanationSkeleton />}
      {comparison && !loading && (
        <div className="trip-debrief-result">
          <div className="sky-table-scroll">
            <table className="sky-table trip-debrief-table">
              <caption className="sr-only">Planned and actual, in miles and feet</caption>
              <thead>
                <tr>
                  <th scope="col"><span className="sr-only">Measure</span></th>
                  <th scope="col">Planned</th>
                  <th scope="col">Actual</th>
                  <th scope="col">Difference</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>{row.planned}</td>
                    <td>{row.actual}</td>
                    <td>{row.difference ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {comparison.hours.length > 0 && (
            <>
              <h3 className="trip-debrief-subhead">Forecast for the hours you were out</h3>
              <p className="trip-debrief-caption">
                As forecast in this report, moved to the highest elevation you reached each hour. This is the
                forecast, not what was observed.
              </p>
              <div className="sky-table-scroll">
                <table className="sky-table trip-debrief-table">
                  <thead>
                    <tr>
                      <th scope="col">Hour</th>
                      <th scope="col">Elevation</th>
                      <th scope="col" className="is-num">Temp</th>
                      <th scope="col" className="is-num">Wind</th>
                      <th scope="col" className="is-num">Precip</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.hours.map((hour) => <HourRow key={hour.time} hour={hour} clock={formatClock} />)}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {comparison.notes.length > 0 && (
            <ul className="trip-debrief-notes-list">
              {comparison.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          )}
          {result?.narrative ? (
            <div className="trip-debrief-narrative">
              <span className="field-kicker ai-brief-kicker">
                <Sparkles size={14} aria-hidden="true" />
                Debrief
              </span>
              <div className="field-markdown">
                <Markdown mode="static">{result.narrative}</Markdown>
              </div>
              <p className="ai-brief-footnote">
                <Info size={13} aria-hidden="true" />
                Written by AI from the comparison above and your notes, and can be wrong.
              </p>
            </div>
          ) : aiAvailable && result?.narrativeStatus === "failed" ? (
            <p className="trip-debrief-caption">The written debrief could not be generated this time; the comparison above is complete.</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
