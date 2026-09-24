import { Mountain } from "lucide-react";
import type { ApproachElevationSource, ApproachSummary } from "../../app/types";
import { APPROACH_SOURCE_LABEL, spanLabel, type SkyHour } from "./sky-model";

const roundTo100 = (ft: number) => Math.round(ft / 100) * 100;

/**
 * Plain-language note for hours checked below the objective, so a changed
 * verdict never comes from an adjustment the reader cannot see.
 */
export function ApproachNote({ hours, summary, source, clock, elevation, onEdit }: {
  hours: SkyHour[];
  /** The hours checked below the objective, as the backend evaluated them. */
  summary: ApproachSummary | null;
  source: ApproachElevationSource | null;
  clock: (minute: number) => string;
  elevation: (ft: number) => string;
  onEdit?: () => void;
}) {
  if (!summary || !source) return null;
  const spans = summary.adjustedRuns.map((run) => spanLabel(hours, run, clock)).filter(Boolean).join(" and ");
  const low = roundTo100(summary.lowFt);
  const high = roundTo100(summary.highFt);
  const range = low === high ? `~${elevation(low)}` : `~${elevation(low)}–${elevation(high)}`;
  const inversion = summary.inversionRuns.map((run) => spanLabel(hours, run, clock)).filter(Boolean).join(" and ");
  return (
    <div className="sky-approach-note">
      <Mountain size={16} aria-hidden="true" />
      <p>
        <strong>{spans || `${summary.adjustedHours} h`} checked at your estimated elevation</strong>, {range}, not the
        summit ({APPROACH_SOURCE_LABEL[source]}).{" "}
        {onEdit && (
          <button type="button" onClick={onEdit}>
            {source === "estimated" ? "Set trailhead" : "Edit approach"}
          </button>
        )}
        {inversion && (
          <span className="sky-approach-inversion">
            {" "}Clear, calm conditions: {inversion} may be colder at the trailhead than at the summit.
          </span>
        )}
      </p>
    </div>
  );
}
