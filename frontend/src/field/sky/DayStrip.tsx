import { isOverHour, skyRuns, spanLabel, type SkyHour } from "./sky-model";

/** A compact version of the Brief's sky, one tile per planned hour. */
export function DayStrip({ hours, clock }: { hours: SkyHour[]; clock: (minute: number) => string }) {
  if (!hours.length) return null;
  const over = skyRuns(hours).filter((run) => run.tone === "over");
  const label = `Your day, ${clock(hours[0].minute)} to ${clock(hours[hours.length - 1].minute + 60)}. ` +
    (over.length ? `Over your limits ${over.map((run) => spanLabel(hours, run, clock)).join(" and ")}.` : "No hours over your limits.");
  return (
    <div className="sky-daystrip" role="img" aria-label={label}>
      {hours.map((hour) => (
        <i key={hour.index}
          className={isOverHour(hour) ? "is-over" : hour.tone === "missing" ? "is-missing" : undefined}
          style={{ ["--z" as string]: hour.zenith, ["--h" as string]: hour.horizon }} />
      ))}
      <span>{clock(hours[0].minute)}</span>
      <span className="is-end">{clock(hours[hours.length - 1].minute + 60)}</span>
    </div>
  );
}
