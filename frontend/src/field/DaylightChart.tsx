import { Sunrise, Sunset } from "lucide-react";
import { parseTimeInputMinutes } from "../app/core";
export function DaylightChart({
  start,
  hours,
  sunrise,
  sunset,
}: {
  start: string;
  hours: number;
  sunrise?: string;
  sunset?: string;
}) {
  const begin = parseTimeInputMinutes(start),
    rise = parseTimeInputMinutes(sunrise || ""),
    set = parseTimeInputMinutes(sunset || "");
  if (begin === null || rise === null || set === null || set <= rise)
    return <p className="field-muted">Daylight timeline unavailable.</p>;
  const duration = begin + hours * 60 > 1440 ? 2880 : 1440;
  return (
    <figure className="daylight-chart">
      <figcaption>
        <span>
          <Sunrise size={18} />
          {sunrise} sunrise
        </span>
        <span>
          <Sunset size={18} />
          {sunset} sunset
        </span>
      </figcaption>
      <div
        className="daylight-track"
        role="img"
        aria-label={`Daylight from ${sunrise} to ${sunset}. Trip begins at ${start} for ${hours} hours${duration > 1440 ? ", returning the following day" : ""}.`}
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
        <span>00:00</span>
        <span>{duration === 1440 ? "12:00" : "Next day"}</span>
        <span>24:00{duration > 1440 ? " +1 day" : ""}</span>
      </div>
      <div className="daylight-legend">
        <span>Daylight</span>
        <span>Planned outing · {hours}h</span>
      </div>
    </figure>
  );
}
