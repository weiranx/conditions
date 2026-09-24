import { useId, useMemo } from "react";
import {
  ArrowRight,
  BedDouble,
  Check,
  CircleDashed,
  CloudLightning,
  Footprints,
  LogOut,
  Mountain,
  Pencil,
  RefreshCw,
  Snowflake,
  TriangleAlert,
} from "lucide-react";
import type { Workspace } from "./model/useWorkspace";
import {
  itineraryEndDate,
  type ItineraryDayAssessment,
  type ItineraryNightAssessment,
  type ItineraryNightState,
  type ItineraryStage,
  type ItineraryVerdictLevel,
} from "../app/itinerary";
import { useAiAvailability } from "../hooks/useAiAvailability";
import { Chat } from "./Chat";
import { activityProfile } from "../app/activity-profiles";
import { formatClockForStyle, parseTimeInputMinutes } from "../app/core";
import { ageLabel, dateLabel } from "./data";
import "./itinerary.css";

const VERDICT_COPY: Record<ItineraryVerdictLevel, { pill: string; tone: "go" | "watch" | "stop" | "missing" }> = {
  GO: { pill: "Go", tone: "go" },
  CAUTION: { pill: "Caution", tone: "watch" },
  "NO-GO": { pill: "No-go", tone: "stop" },
  INCOMPLETE: { pill: "Not cleared yet", tone: "missing" },
};

const NIGHT_COPY: Record<ItineraryNightState, { label: string; tone: "ok" | "over" | "missing" }> = {
  settled: { label: "Settled", tone: "ok" },
  hard: { label: "Hard night", tone: "over" },
  serious: { label: "Serious", tone: "over" },
  incomplete: { label: "Partly forecast", tone: "missing" },
  "not-forecast": { label: "Not yet forecast", tone: "missing" },
  unavailable: { label: "Not checked", tone: "missing" },
};

function endClock(start: string, hours: number, timeStyle: Workspace["preferences"]["timeStyle"]) {
  const minutes = parseTimeInputMinutes(start);
  if (minutes === null) return null;
  const end = (minutes + hours * 60) % (24 * 60);
  const clock = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
  return formatClockForStyle(clock, timeStyle);
}

export function Itinerary({
  workspace: w,
  onEdit,
  onSave,
  onWatch,
  actionBusy = false,
  feedback = "",
}: {
  workspace: Workspace;
  onEdit: () => void;
  onSave?: () => void;
  onWatch?: () => void;
  actionBusy?: boolean;
  feedback?: string;
}) {
  const id = useId();
  const it = w.itinerary;
  const { result, assessment, draft } = it;
  const available = useAiAvailability(result?.results.find((entry) => entry.report)?.report?.capabilities);
  // The backend builds what the trip chat reads.
  const chatContext = result?.chatContext;
  const chatAvailable = available.reportChat;
  const chatPayload = useMemo(
    () => (chatAvailable && chatContext ? JSON.stringify(chatContext) : ""),
    [chatAvailable, chatContext],
  );
  if (!result || !assessment) return null;
  const verdict = VERDICT_COPY[assessment.level];
  const { headline } = assessment;
  const nights = result.stages.length - 1;
  const tripName = draft.name || (draft.trailhead?.name ? `${draft.trailhead.name} trip` : "Multi-day trip");
  const lowConfidenceDays = assessment.days.filter((day) => day.lowConfidence).map((day) => day.index + 1);
  const coldest = assessment.nights.find((night) => night.index === assessment.coldestNightIndex) ?? null;
  const coldestLow = coldest?.data?.status === "ok" ? coldest.data.minFeelsLikeF : null;
  const localize = (text: string) => w.localizeUnitText(text);
  const { alsoLimiting } = assessment;
  const checkedWith = result.preferences ?? w.preferences;
  const activity = activityProfile(checkedWith.defaultActivity).label;
  const limitsChanged = !it.fromSaved && (["maxWindGustMph", "maxPrecipChance", "minFeelsLikeF", "maxFeelsLikeF"] as const)
    .some((key) => checkedWith[key] !== w.preferences[key]);
  const timeline: Array<{ kind: "day"; day: ItineraryDayAssessment; stage: ItineraryStage } | { kind: "night"; night: ItineraryNightAssessment }> = [];
  assessment.days.forEach((day) => {
    const stage = result.stages[day.index];
    if (stage) timeline.push({ kind: "day", day, stage });
    const night = assessment.nights.find((entry) => entry.index === day.index);
    if (night) timeline.push({ kind: "night", night });
  });

  return (
    <article className="sky-trip-brief" aria-labelledby={`${id}-title`}>
      <header className="field-page-heading sky-trip-heading">
        <span className="field-kicker">Trip brief · {activity}</span>
        <h1 id={`${id}-title`}>{tripName}</h1>
        <p>
          {nights + 1} days, {nights} {nights === 1 ? "night" : "nights"} · {dateLabel(result.stages[0].date)} to{" "}
          {dateLabel(result.stages[result.stages.length - 1].date)} · checked {ageLabel(result.checkedAt)}
        </p>
      </header>

      {it.fromSaved && (
        <aside className="sky-notice" aria-label="Saved trip snapshot">
          <div>This is a saved trip. It shows the forecast from when it was checked and won’t update.
            Check again for current conditions.</div>
        </aside>
      )}
      {limitsChanged && (
        <p className="sky-notice is-info" role="status">
          Your limits have changed since this check. Check again to read the trip with them.
        </p>
      )}
      <section className={`sky-verdict-card sky-trip-verdict is-${verdict.tone}`} aria-labelledby={`${id}-verdict`}>
        <span className={`sky-pill is-${verdict.tone === "missing" ? "watch" : verdict.tone}`}>
          {assessment.level === "GO"
            ? <Check size={16} aria-hidden="true" />
            : assessment.level === "INCOMPLETE"
              ? <CircleDashed size={16} aria-hidden="true" />
              : <TriangleAlert size={16} aria-hidden="true" />}
          {verdict.pill}
        </span>
        <h2 id={`${id}-verdict`} tabIndex={-1}>{headline.title}</h2>
        {headline.reason && <p className="sky-verdict-reason">{localize(headline.reason)}</p>}
        <ul className="sky-limiting sky-trip-notes">
          {alsoLimiting.length > 0 && (
            <li>Also {alsoLimiting.map((link) => `${link.kind === "day" ? "day" : "night"} ${link.index + 1}`).join(", ")}: {alsoLimiting.length === 1 ? "it calls" : "they call"} for caution too.</li>
          )}
          {coldest && coldestLow !== null && (
            <li>
              Coldest night: {w.formatTempDisplay(coldestLow)} feels-like at {coldest.camp.name || `camp ${coldest.index + 1}`} (night {coldest.index + 1}).
              Size the sleep system for it.
            </li>
          )}
          {assessment.unresolved > 0 && assessment.level !== "INCOMPLETE" && (
            <li>{assessment.unresolved} {assessment.unresolved === 1 ? "part of the trip is" : "parts of the trip are"} not fully checked yet.</li>
          )}
          {lowConfidenceDays.length > 0 && (
            <li>
              {lowConfidenceDays.length === 1 ? `Day ${lowConfidenceDays[0]} is` : `Days ${lowConfidenceDays.join(", ")} are`} five or more days out, where forecasts change a lot. Check again before you go.
            </li>
          )}
        </ul>
        <p className="sky-cap">
          The trip is as good as its weakest day or night. Each day is checked at its camp and any high points, using your limits for {activity.toLowerCase()}; each night is read at its camp.
        </p>
        <div className="sky-trip-actions">
          <button type="button" className="field-button" onClick={onEdit}>
            <Pencil size={15} aria-hidden="true" /> Edit trip
          </button>
          <button type="button" className="field-button" disabled={it.loading} onClick={() => void it.runCheck()}>
            <RefreshCw size={15} aria-hidden="true" /> Check again
          </button>
          {onSave && (
            <button type="button" className="field-button" disabled={actionBusy} onClick={onSave}>
              Save trip
            </button>
          )}
          {onWatch && (
            <button type="button" className="field-button" disabled={actionBusy} onClick={onWatch}>
              Watch trip
            </button>
          )}
        </div>
        {feedback && <p className="sky-notice is-info" role="status">{feedback}</p>}
      </section>

      <section className="sky-section" aria-labelledby={`${id}-timeline`}>
        <div className="sky-sh">
          <h2 id={`${id}-timeline`}>Day by day</h2>
          <p>Open a day for its full conditions brief.</p>
        </div>
        <ol className="sky-trip-timeline">
          {timeline.map((entry) => entry.kind === "day"
            ? <DayCard key={`day-${entry.day.index}`} workspace={w} day={entry.day} stage={entry.stage} lastDay={entry.day.index === result.stages.length - 1} />
            : <NightCard key={`night-${entry.night.index}`} workspace={w} night={entry.night} />)}
        </ol>
      </section>
      {!it.fromSaved && <OtherStarts workspace={w} />}
      {chatPayload && (
        <Chat key={chatPayload} reportPayload={chatPayload} contextType="itinerary" contextLabel={`${tripName} · ${nights + 1} days`} />
      )}
      <p className="field-muted sky-trip-disclaimer">
        A planning aid, not a guarantee. Missing or not-yet-issued forecasts are shown as such, never as good conditions.
        Check official forecasts and conditions on the ground.
      </p>
    </article>
  );
}

function DayCard({ workspace: w, day, stage, lastDay }: { workspace: Workspace; day: ItineraryDayAssessment; stage: ItineraryStage; lastDay: boolean }) {
  const checked = day.day;
  const tone = day.level === "GO" ? "ok" : day.level ? "over" : "missing";
  const label = day.level === "GO" ? "Go" : day.level === "NO-GO" ? "No-go" : day.level === "CAUTION" ? "Caution" : "Not checked";
  const timeStyle = w.preferences.timeStyle;
  const arrive = endClock(stage.start, stage.travelHours, timeStyle);
  const route = stage.layover
    ? `Layover at ${stage.to.name || "camp"}`
    : `${stage.from.name || "Start"} → ${stage.to.name || "camp"}`;
  return (
    <li className={`sky-card sky-trip-card is-day is-${tone}`}>
      <div className="sky-trip-card-head">
        <span className="sky-trip-card-kicker">
          <Footprints size={15} aria-hidden="true" />
          Day {stage.index + 1} · {dateLabel(stage.date)}
        </span>
        <span className={`sky-status is-${tone}`}>
          {tone === "ok" ? <Check size={13} aria-hidden="true" /> : tone === "over" ? <TriangleAlert size={13} aria-hidden="true" /> : <CircleDashed size={13} aria-hidden="true" />}
          {label}
        </span>
      </div>
      <h3>{route}</h3>
      <p className="sky-cap">
        {formatClockForStyle(stage.start, timeStyle)}{arrive ? ` to ${arrive}` : ""} · {stage.travelHours} h
        {day.elevationFt !== null ? ` · ${lastDay ? "ends at" : "camp"} ${w.formatElevationDisplay(day.elevationFt)}` : ""}
      </p>
      {checked ? (
        <dl className="sky-trip-readings">
          <div><dt>Temp</dt><dd>{checked.tempLowF !== null || checked.tempHighF !== null ? `${w.formatTempDisplay(checked.tempLowF)} – ${w.formatTempDisplay(checked.tempHighF)}` : "—"}</dd></div>
          <div><dt>Peak gust</dt><dd>{w.formatWindDisplay(checked.peakGustMph)}</dd></div>
          <div><dt>Rain or snow</dt><dd>{checked.peakPrecipChance !== null ? `${checked.peakPrecipChance}%` : "—"}</dd></div>
          <div><dt>Sky</dt><dd>{checked.weatherDescription}</dd></div>
        </dl>
      ) : (
        <p className="sky-notice is-missing">This day could not be checked at camp. Check the trip again, or open the day in the planner later.</p>
      )}
      {day.limitingChecks.length > 0 && (
        <ul className="sky-limiting">
          {day.limitingChecks.slice(0, 3).map((message) => (
            <li key={message}>
              {day.limitingPlace && day.limitingPlace !== stage.to.name ? `${day.limitingPlace}: ` : ""}
              {w.localizeUnitText(message)}
            </li>
          ))}
        </ul>
      )}
      {day.checkpoints.length > 0 && (
        <ul className="sky-trip-checkpoints" aria-label="High points">
          {day.checkpoints.map((checkpoint) => {
            const level = checkpoint.day?.decisionLevel;
            return (
              <li key={checkpoint.name}>
                <Mountain size={14} aria-hidden="true" />
                <span>{checkpoint.name || "High point"}</span>
                <span className={`sky-status is-${level === "GO" ? "ok" : level ? "over" : "missing"}`}>
                  {level === "GO" ? "Go" : level === "NO-GO" ? "No-go" : level === "CAUTION" ? "Caution" : "Not checked"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <ul className="sky-trip-flags">
        {day.avalancheNotIssued && <li><Snowflake size={13} aria-hidden="true" /> Avalanche forecast not issued for this day yet</li>}
        {day.incompleteHours > 0 && <li><CircleDashed size={13} aria-hidden="true" /> {day.incompleteHours} h without a complete forecast</li>}
        {checked?.partialData && <li><CircleDashed size={13} aria-hidden="true" /> Some sources were unavailable</li>}
        {day.lowConfidence && <li>{day.daysAhead} days out: forecast skill is low</li>}
        {checked && checked.alertCount > 0 && <li><TriangleAlert size={13} aria-hidden="true" /> {checked.alertCount} active weather {checked.alertCount === 1 ? "alert" : "alerts"}</li>}
      </ul>
      {checked && (
        <button type="button" className="field-text-button sky-trip-open" onClick={() => w.openItineraryDay(stage.index)}>
          Open day {stage.index + 1} report <ArrowRight size={14} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

function NightCard({ workspace: w, night }: { workspace: Workspace; night: ItineraryNightAssessment }) {
  const copy = NIGHT_COPY[night.state];
  const data = night.data?.status === "ok" ? night.data : null;
  const exit = night.nearestExit;
  const elevation = night.data?.elevationFt ?? night.camp.elevationFt;
  return (
    <li className={`sky-card sky-trip-card is-night is-${copy.tone}`}>
      <div className="sky-trip-card-head">
        <span className="sky-trip-card-kicker">
          <BedDouble size={15} aria-hidden="true" />
          Night {night.index + 1}{night.layoverFollows ? " · layover follows" : ""}
        </span>
        <span className={`sky-status is-${copy.tone}`}>
          {copy.tone === "ok" ? <Check size={13} aria-hidden="true" /> : copy.tone === "over" ? <TriangleAlert size={13} aria-hidden="true" /> : <CircleDashed size={13} aria-hidden="true" />}
          {copy.label}
        </span>
      </div>
      <h3>{night.camp.name || "Camp"}{elevation !== null && elevation !== undefined ? ` · ${w.formatElevationDisplay(elevation)}` : ""}</h3>
      {data ? (
        <dl className="sky-trip-readings">
          <div><dt>Low</dt><dd>{w.formatTempDisplay(data.lowTempF)}</dd></div>
          <div><dt>Feels like</dt><dd>{w.formatTempDisplay(data.minFeelsLikeF)}</dd></div>
          <div><dt>Gusts</dt><dd>{w.formatWindDisplay(data.peakGustMph)}</dd></div>
          <div><dt>Rain or snow</dt><dd>{data.peakPrecipChance !== null ? `${Math.round(data.peakPrecipChance)}%` : "—"}</dd></div>
        </dl>
      ) : null}
      <p className="sky-trip-night-summary">
        {data?.storm && <CloudLightning size={15} aria-label="Thunderstorms" />}
        {night.data ? w.localizeUnitText(night.data.summary) : "This night could not be checked because its day failed."}
      </p>
      {exit && exit.miles > 0.2 && (
        <p className="sky-cap sky-trip-exit">
          <LogOut size={13} aria-hidden="true" />
          Nearest way out: {exit.name || "trailhead"}, {w.formatDistanceDisplay(exit.miles)} in a straight line
        </p>
      )}
    </li>
  );
}

/** The same trip starting a day or two later, to see where the weak link moves. */
function OtherStarts({ workspace: w }: { workspace: Workspace }) {
  const id = useId();
  const it = w.itinerary;
  const { draft, result } = it;
  if (!result) return null;
  // Start dates later than this one that still end inside the forecast.
  const offsets = [1, 2, 3].filter((offset) => {
    const end = itineraryEndDate({ startDate: result.startDate, camps: draft.camps });
    if (!end) return false;
    const shifted = new Date(`${end}T12:00:00Z`);
    shifted.setUTCDate(shifted.getUTCDate() + offset);
    return shifted.toISOString().slice(0, 10) <= w.maxForecastDate;
  });
  if (offsets.length === 0) return null;
  const running = it.alternatives.some((item) => item.loading);
  return (
    <section className="sky-section" aria-labelledby={`${id}-starts`}>
      <div className="sky-sh">
        <h2 id={`${id}-starts`}>Other start dates</h2>
        <p>The same camps and hours, starting later. Each start date uses one multi-day check.</p>
      </div>
      {it.alternatives.length === 0 ? (
        <button type="button" className="field-button" onClick={() => void it.compareStartDates(offsets)}>
          Check starting {offsets.length === 1 ? "1 day" : `1–${offsets.length} days`} later
        </button>
      ) : (
        <ul className="sky-card sky-trip-starts" aria-busy={running}>
          {it.alternatives.map((item) => {
            const assessment = item.result?.assessment ?? null;
            const headline = assessment?.headline ?? null;
            const verdict = assessment ? VERDICT_COPY[assessment.level] : null;
            return (
              <li key={item.startDate}>
                <span className="sky-trip-start-date">{dateLabel(item.startDate)}</span>
                {item.loading ? (
                  <span className="sky-cap" role="status">Checking…</span>
                ) : assessment && verdict && headline ? (
                  <>
                    <span className={`sky-status is-${verdict.tone === "go" ? "ok" : verdict.tone === "missing" ? "missing" : "over"}`}>{verdict.pill}</span>
                    <span className="sky-trip-start-reason">{headline.title}</span>
                    <button type="button" className="field-text-button" onClick={() => it.chooseAlternative(item.startDate)}>
                      Use this start
                    </button>
                  </>
                ) : (
                  <span className="sky-cap">{item.error || "Not checked."}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
