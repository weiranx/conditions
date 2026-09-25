import type { ApproachSummary } from "../../app/types";
import { SUMMIT_TERMS, type ObjectiveTerms } from "../../app/objective-terms";
import { isOverHour, skyRuns, spanLabel, type SkyHour } from "./sky-model";

/** A compact version of the Brief's sky, one tile per planned hour. */
export function DayStrip({ hours, approach = null, clock, elevation = (ft) => `${ft} ft`, terms = SUMMIT_TERMS }: {
  hours: SkyHour[];
  /** The hours checked below the objective, as the backend evaluated them. */
  approach?: ApproachSummary | null;
  clock: (minute: number) => string;
  elevation?: (ft: number) => string;
  terms?: ObjectiveTerms;
}) {
  if (!hours.length) return null;
  const over = skyRuns(hours).filter((run) => run.tone === "over");
  const label = `Your day, ${clock(hours[0].minute)} to ${clock(hours[hours.length - 1].minute + 60)}. ` +
    (over.length ? `Over your limits ${over.map((run) => spanLabel(hours, run, clock)).join(" and ")}.` : "No hours over your limits.") +
    (approach ? ` ${approach.adjustedRuns.map((run) => spanLabel(hours, run, clock)).join(" and ")} checked at your estimated elevation, not the ${terms.top}.` : "");
  return (
    <div className="sky-daystrip" role="img" aria-label={label}>
      {hours.map((hour) => (
        <i key={hour.index}
          className={[isOverHour(hour) ? "is-over" : hour.tone === "missing" ? "is-missing" : "", hour.approachAdjusted ? "is-approach" : ""].filter(Boolean).join(" ") || undefined}
          title={hour.approachAdjusted && Number.isFinite(hour.elevationFt) ? `${clock(hour.minute)} · checked near ${elevation(Math.round((hour.elevationFt as number) / 100) * 100)}` : undefined}
          style={{ ["--z" as string]: hour.zenith, ["--h" as string]: hour.horizon }} />
      ))}
      <span>{clock(hours[0].minute)}</span>
      <span className="is-end">{clock(hours[hours.length - 1].minute + 60)}</span>
    </div>
  );
}
