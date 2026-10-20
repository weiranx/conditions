import { ArrowDown, Bell, Check, CircleHelp, CloudSun, Mountain, Route as RouteIcon, Snowflake, Sunset, TriangleAlert, Wind } from "lucide-react";
import type { ReactNode } from "react";
import type { Workspace } from "../model/useWorkspace";
import type { CheckStatus } from "./status";
import type { SkyHour } from "./sky-model";
import type { PlannedRouteSummary } from "../route-planning";
import { activityProfile } from "../../app/activity-profiles";
import type { ActivityType } from "../../app/types";
import { buildBrief, type Brief, type BriefChapter, type BriefCheck } from "./brief-model";

type Status = CheckStatus;

export function StatusTag({ status, children }: { status: Status; children: ReactNode }) {
  const Icon = status === "over" ? TriangleAlert : status === "missing" ? CircleHelp : Check;
  return <span className={`sky-status is-${status}`}><Icon size={15} aria-hidden="true" />{children}</span>;
}

/** Where a brief card or number leads: a report section, and the part of it that holds the detail. */
export type BriefOpen = (chapter: BriefChapter, anchor?: string) => void;

/** Each check's icon, as on a weather tile. */
const CHECK_ICONS: Record<string, typeof Bell> = {
  Weather: CloudSun, Alerts: Bell, Daylight: Sunset, "Terrain & snow": Mountain, Avalanche: Snowflake, "Air & fire": Wind, Route: RouteIcon,
};

/** A check that needs attention: a full tile with its value up front, scrolling straight to the reading behind it. */
function CheckCard({ check, onOpen }: { check: BriefCheck; onOpen: BriefOpen }) {
  const { title, status, statusText, caption, visual, to, anchor, cue, className = "" } = check;
  const Icon = CHECK_ICONS[title];
  return (
    <button type="button" className={`sky-card sky-check sky-tile${status === "missing" ? " is-missing" : ""}${className ? ` ${className}` : ""}`}
      onClick={() => onOpen(to, anchor)}>
      <span className="sky-card-head">{Icon && <Icon size={14} aria-hidden="true" />}<span>{title}</span><StatusTag status={status}>{statusText}</StatusTag></span>
      {visual}
      <span className="sky-cap">{caption}</span>
      <span className="sky-open">{cue}<ArrowDown size={14} aria-hidden="true" /></span>
    </button>
  );
}

/** A check within your limits: one line that still opens its reading. The full caption shows on hover. */
function CheckRow({ check, onOpen }: { check: BriefCheck; onOpen: BriefOpen }) {
  const { title, status, statusText, caption, to, anchor, cue, className = "" } = check;
  const Icon = CHECK_ICONS[title];
  return (
    <button type="button" title={caption} className={`sky-check sky-check-row${className ? ` ${className}` : ""}`}
      onClick={() => onOpen(to, anchor)}>
      <span className="sky-card-head">{Icon && <Icon size={14} aria-hidden="true" />}<span>{title}</span><StatusTag status={status}>{statusText}</StatusTag></span>
      <span className="sky-cap">{caption}</span>
      <span className="sky-open">{cue}<ArrowDown size={14} aria-hidden="true" /></span>
    </button>
  );
}

/**
 * The brief under the hero: the headline numbers and every check, each a step into the section that explains it.
 * A check that needs attention keeps its full tile; the ones within your limits are a line each beneath.
 */
export function BriefSections({ brief, w, hours, clock, route = null, activity, onOpen, notes = null }: {
  /** The brief, when the report has already built it for its section bar. */
  brief?: Brief;
  w: Workspace;
  hours: SkyHour[];
  clock: (minute: number) => string;
  route?: PlannedRouteSummary | null;
  activity: ActivityType;
  onOpen: BriefOpen;
  /** One-line notes under the numbers, e.g. the hours judged on the approach. */
  notes?: ReactNode;
}) {
  const { checks, numbers } = brief ?? buildBrief({ w, hours, clock, route, activity });
  const profile = activityProfile(activity);
  const leads = profile.report.leads;
  const attention = checks.filter((check) => check.status !== "ok");
  const within = checks.filter((check) => check.status === "ok");
  const grouped = attention.length > 0 && within.length > 0;
  return (
    <>
      <div className="sky-numbers" role="group" aria-label="Key numbers">
        {numbers.map((tile) => (
          <button key={tile.key} type="button" className={`sky-card sky-tile sky-number-tile${tile.over ? " is-over" : ""}`} onClick={() => onOpen(tile.to, tile.anchor)}>
            <span className="sky-tile-label">{tile.label}</span>
            <span className="sky-big">{tile.value}</span>
            <span className="sky-cap">{tile.note}</span>
          </button>
        ))}
      </div>
      {notes && <div className="sky-brief-lines">{notes}</div>}

      <section className="sky-section sky-brief-checks" aria-labelledby="sky-checks">
        <div className="sr-only"><h2 id="sky-checks">Checks</h2><p>{leads ? `Ordered for ${profile.label.toLowerCase()}: ${leads} first. ` : ""}Problems first; tap one to go to its detail in the report below.</p></div>
        {attention.length > 0 && (
          <>
            {grouped && <h3 className="sky-check-group">Needs attention</h3>}
            <div className="sky-checks">
              {attention.map((check) => <CheckCard key={check.key} check={check} onOpen={onOpen} />)}
            </div>
          </>
        )}
        {within.length > 0 && (
          <>
            {grouped && <h3 className="sky-check-group">Within limits</h3>}
            <ul className="sky-check-rows" aria-label="Checks within your limits">
              {within.map((check) => <li key={check.key}><CheckRow check={check} onOpen={onOpen} /></li>)}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
