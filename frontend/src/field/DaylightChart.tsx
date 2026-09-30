import { Sunrise, Sunset } from "lucide-react";
import { formatClockForStyle, parseSolarClockMinutes, parseTimeInputMinutes } from "../app/core";
import type { TimeStyle } from "../app/types";
export function DaylightChart({
  start,
  hours,
  sunrise,
  sunset,
  timeStyle,
}: {
  start: string;
  hours: number;
  sunrise?: string;
  sunset?: string;
  /** The traveler's clock: sunrise and sunset arrive as the provider wrote them ("6:30 AM"). */
  timeStyle?: TimeStyle;
}) {
  const clock = (value: string | undefined) => (timeStyle ? formatClockForStyle(value, timeStyle) : value ?? "");
  const begin = parseTimeInputMinutes(start),
    rise = parseTimeInputMinutes(sunrise || "") ?? parseSolarClockMinutes(sunrise),
    set = parseTimeInputMinutes(sunset || "") ?? parseSolarClockMinutes(sunset);
  if (begin === null || rise === null || set === null || set <= rise)
    return <p className="field-muted">Daylight timeline unavailable.</p>;
  const duration = begin + hours * 60 > 1440 ? 2880 : 1440;
  return (
    <figure className="daylight-chart">
      <figcaption>
        <span>
          <Sunrise size={18} />
          {clock(sunrise)} sunrise
        </span>
        <span>
          <Sunset size={18} />
          {clock(sunset)} sunset
        </span>
      </figcaption>
      <div
        className="daylight-track"
        role="img"
        aria-label={`Daylight from ${clock(sunrise)} to ${clock(sunset)}. Trip begins at ${clock(start)} for ${hours} hours${duration > 1440 ? ", returning the following day" : ""}.`}
      >
        {Array.from({ length: duration / 1440 }, (_, day) => (
          <span
            className="daylight-sun"
            key={day}
            style={{
              left: `${((rise + day * 1440) / duration) * 100}%`,
              width: `${((set - rise) / duration) * 100}%`,
            }}
          />
        ))}
        <span
          className="daylight-trip"
          style={{
            left: `${(begin / duration) * 100}%`,
            width: `${((hours * 60) / duration) * 100}%`,
          }}
        />
      </div>
      <div className="daylight-axis">
        <span>{clock("00:00")}</span>
        <span>{duration === 1440 ? clock("12:00") : "Next day"}</span>
        <span>{timeStyle === "ampm" ? "12:00 AM" : "24:00"}{duration > 1440 ? " +1 day" : ""}</span>
      </div>
      <div className="daylight-legend">
        <span>Daylight</span>
        <span>Planned outing · {hours}h</span>
      </div>
    </figure>
  );
}
