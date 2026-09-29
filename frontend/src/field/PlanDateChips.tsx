import { useId } from "react";
import { addDaysToIsoDate } from "../app/core";

function chipLabel(date: string, today: string) {
  const parsed = new Date(`${date}T12:00:00`);
  return {
    day: date === today
      ? "Today"
      : date === addDaysToIsoDate(today, 1)
        ? "Tomorrow"
        : parsed.toLocaleDateString(undefined, { weekday: "short" }),
    date: parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  };
}

// Hour-by-hour forecasts hold up for a few days; after that they are outlooks.
const OUTLOOK_FROM_DAY = 5;

/**
 * Every forecast day as a chip, so the day is one tap and the range is visible.
 * The later days are marked as outlooks, and choosing one says why.
 */
export function PlanDateChips({
  value,
  today,
  last,
  label,
  onChange,
}: {
  value: string;
  today: string;
  last: string;
  label: string;
  onChange: (date: string) => void;
}) {
  const id = useId();
  const dates: string[] = [];
  for (let date = today; date <= last && dates.length < 16; date = addDaysToIsoDate(date, 1)) dates.push(date);
  const outlook = (date: string) => dates.indexOf(date) >= OUTLOOK_FROM_DAY;
  return (
    <>
    <div className="sky-date-chips" role="radiogroup" aria-label={label}>
      {dates.map((date) => {
        const text = chipLabel(date, today);
        const classes = [date === value ? "is-checked" : "", outlook(date) ? "is-outlook" : ""].filter(Boolean).join(" ");
        return (
          <label key={date} className={classes || undefined} title={outlook(date) ? "Outlook: expect bigger forecast changes" : undefined}>
            <input
              type="radio"
              name={`${id}-date`}
              value={date}
              checked={date === value}
              onChange={() => onChange(date)}
            />
            <strong>{text.day}</strong>
            <small>{text.date}</small>
          </label>
        );
      })}
    </div>
    {outlook(value) && (
      <p className="sky-date-outlook" role="status">
        This far out the forecast is an outlook. Expect it to change; check again closer to the day.
      </p>
    )}
    </>
  );
}
