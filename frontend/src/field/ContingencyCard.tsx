import type { ContingencyData } from "../app/types";
import { durationLabel } from "./sky/status";

const SEVERITY_LABEL: Record<string, string> = {
  high: "Serious",
  moderate: "Cold or wet",
  low: "Manageable",
};

interface ContingencyCardProps {
  contingency: ContingencyData | null | undefined;
  /** Planned return, minutes after local midnight of the start day. */
  returnMinutes: number | null;
  clock: (minute: number) => string;
  formatTemp: (value: number | null | undefined) => string;
  formatWind: (value: number | null | undefined) => string;
  /** The objective's IANA time zone; event times are read on its clock. */
  timeZone?: string | null;
}

const hoursLabel = (hours: number) => durationLabel(Math.round(hours * 60));

// Minutes after local midnight at the objective for an instant, or null when
// the zone is unusable.
function localMinuteAt(ms: number, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    return Number.isFinite(hour) && Number.isFinite(minute) ? (hour % 24) * 60 + minute : null;
  } catch {
    return null;
  }
}

export function ContingencyCard({ contingency, returnMinutes, clock, formatTemp, formatWind, timeZone = null }: ContingencyCardProps) {
  if (!contingency || contingency.status !== "ok") return null;
  const buffer = contingency.delayBuffer;
  const night = contingency.overnight?.status === "ok" ? contingency.overnight : null;
  if (!buffer && !night) return null;
  const at = (hoursAfterReturn: number) =>
    returnMinutes === null ? `${hoursLabel(hoursAfterReturn)} after return` : clock(returnMinutes + hoursAfterReturn * 60);
  // Hours after return are rounded to a tenth; the event's own time is exact,
  // so sunset reads as the sunset shown elsewhere in the report. Read it on the
  // objective's clock: elapsed time from the return misreads the clock when a
  // daylight-saving change falls in between.
  const returnMs = Date.parse(contingency.plannedReturnIso || "");
  const atEvent = (iso: string | null | undefined, hoursAfterReturn: number) => {
    const eventMs = Date.parse(iso || "");
    const localMinute = timeZone && Number.isFinite(eventMs) ? localMinuteAt(eventMs, timeZone) : null;
    if (localMinute !== null) return clock(localMinute);
    return returnMinutes !== null && Number.isFinite(returnMs) && Number.isFinite(eventMs)
      ? clock(returnMinutes + Math.round((eventMs - returnMs) / 60000))
      : at(hoursAfterReturn);
  };

  const bufferEvents = buffer
    ? [
      ...buffer.onsetHazards.map((hazard) => `${hazard.label} from ${atEvent(hazard.onsetIso, hazard.hoursAfterReturn)}`),
      ...(buffer.nightfall ? [`Dark by ${atEvent(buffer.nightfall.onsetIso, buffer.nightfall.hoursAfterReturn)}`] : []),
    ]
    : [];
  const nightConditions = night
    ? [
      night.storm ? "thunderstorms" : null,
      night.freezingRain ? "freezing rain" : null,
      night.snow && !night.freezingRain ? "snow" : null,
      Number(night.peakPrecipChance) >= 30 ? `${Math.round(Number(night.peakPrecipChance))}% precipitation chance` : null,
    ].filter(Boolean)
    : [];

  const reasons = night
    ? (night.reasonCodes || []).map((code) => {
      if (code === "longDay") return "a long day";
      if (code === "nearDark") return night.hoursToDark !== undefined && night.hoursToDark <= 0 ? "return after dark" : "return close to dark";
      if (code === "coldNight") return `a night that feels like ${formatTemp(night.minFeelsLikeF)}`;
      if (code === "winterTerrain") return "snow or avalanche terrain";
      return null;
    }).filter((reason): reason is string => Boolean(reason))
    : [];

  return (
    <section className="sky-card sky-contingency" aria-labelledby="sky-timing-contingency">
      <span className="sky-card-head"><span id="sky-timing-contingency">If you're delayed</span></span>
      {buffer && (
        <>
          <p className="sky-cap is-body">
            Running up to <strong>{hoursLabel(buffer.hours)} late</strong>
            {returnMinutes !== null && <> (back by {atEvent(buffer.endIso, buffer.hours)})</>}
            {buffer.coveredHours <= 0
              ? ": no forecast covers those hours."
              : bufferEvents.length > 0
                ? <>: <strong className="is-over">{bufferEvents.join(" · ")}</strong>.</>
                : ": the forecast adds no new hazards."}
          </p>
          {buffer.coveredHours > 0 && (
            <dl className="sky-list">
              <div><dt>Coldest feels-like</dt><dd>{formatTemp(buffer.minFeelsLikeF)}</dd></div>
              <div><dt>Peak gust</dt><dd>{formatWind(buffer.peakGustMph)}</dd></div>
              <div><dt>Peak rain chance</dt><dd>{buffer.peakPrecipChance === null ? "—" : `${Math.round(buffer.peakPrecipChance)}%`}</dd></div>
            </dl>
          )}
          {buffer.coveredHours > 0 && !buffer.complete && (
            <p className="sky-cap">The forecast covers only {hoursLabel(buffer.coveredHours)} of this buffer.</p>
          )}
        </>
      )}
      {night && (
        <>
          <span className="sky-card-head sky-contingency-night">
            <span>Unplanned night</span>
            {night.severity && <span className={`sky-contingency-level is-${night.severity}`}>{SEVERITY_LABEL[night.severity]}</span>}
          </span>
          <p className="sky-cap is-body">
            {typeof night.hoursToDark === "number" && (
              night.hoursToDark <= 0 ? "You'd already be out after dark. " : `Dark by ${atEvent(night.startIso, night.hoursToDark)}. `
            )}
            Coldest it feels overnight: <strong>{formatTemp(night.minFeelsLikeF)}</strong>
            {Number(night.peakGustMph) >= 20 && <>, gusts to {formatWind(night.peakGustMph)}</>}
            {nightConditions.length > 0 && <>, {nightConditions.join(", ")}</>}.
          </p>
          <dl className="sky-list">
            <div><dt>Air temperature low</dt><dd>{formatTemp(night.lowTempF)}</dd></div>
            <div><dt>Peak wind</dt><dd>{formatWind(night.peakWindMph)}</dd></div>
          </dl>
          {night.relevant && reasons.length > 0 && (
            <p className="sky-cap">Worth planning for: {reasons.join(" · ")}.</p>
          )}
          {night.complete === false && (
            <p className="sky-cap">The forecast ends before sunrise; the rest of the night is not covered.</p>
          )}
        </>
      )}
    </section>
  );
}
