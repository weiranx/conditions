import { useId, useState } from "react";
import {
  ArrowUpRight,
  Backpack,
  Check,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import type { SummitDecision } from "../app/types";
import "./gear-actions.css";
import { Fold } from "./sky/Fold";

type GearItem = {
  title: string;
  detail: string;
  reason?: string;
  category: string;
  tone: string;
};
const itemKey = (item: GearItem) =>
  JSON.stringify([item.title, item.detail, item.category]);
const groups = [
  {
    id: "priority",
    label: "Don’t leave without",
    note: "Required for the hazards in this report.",
  },
  {
    id: "conditions",
    label: "For today’s conditions",
    note: "Added because of this forecast. Each item says why.",
  },
  {
    id: "other",
    label: "Standard kit",
    note: "Bring these on every trip like this one.",
  },
] as const;
const groupFor = (tone: string) =>
  tone === "nogo"
    ? "priority"
    : tone === "caution" || tone === "watch"
      ? "conditions"
      : "other";
const headline = {
  "NO-GO": "Change the plan before packing",
  CAUTION: "Settle the plan, then pack",
  GO: "Plan looks workable. Pack for the conditions.",
} as const;
const identity = (text: string) => text;

/** The chapter's lead: what the decision asks of the plan before packing. */
export function GearLead({ decision, actionLine }: { decision: SummitDecision; actionLine: string }) {
  return (
    <p className="sky-lead">
      <strong className={decision.level === "NO-GO" ? "is-over" : undefined}>{headline[decision.level] ?? headline.CAUTION}</strong>{" "}
      {actionLine}
    </p>
  );
}

export function GearActions({
  hidden,
  recommendations,
  decision,
  actionLine,
  onSources,
  activityLabel = null,
  localize = identity,
  lead = true,
}: {
  hidden: boolean;
  recommendations: GearItem[];
  decision: SummitDecision;
  actionLine: string;
  onSources: () => void;
  activityLabel?: string | null;
  localize?: (text: string) => string;
  /** The chapter opens with the decision box; the report shows its lead in the chapter heading instead. */
  lead?: boolean;
}) {
  const id = useId();
  const [packed, setPacked] = useState<Set<string>>(() => new Set());
  const uniqueItems = new Map<string, GearItem>();
  const priority = (tone: string) =>
    tone === "nogo" ? 0 : tone === "caution" ? 1 : 2;
  for (const item of recommendations) {
    if (!item.title.trim()) continue;
    const key = itemKey(item);
    const existing = uniqueItems.get(key);
    if (!existing || priority(item.tone) < priority(existing.tone)) {
      uniqueItems.set(key, item);
    }
  }
  const items = [...uniqueItems.values()];
  const packedCount = items.filter((item) => packed.has(itemKey(item))).length;
  const actions = decision.checks.filter(
    (check) => !check.ok && check.action?.trim(),
  );
  const noGo = decision.level === "NO-GO";
  // Advice below any limit (moderate air, elevated fire or heat, a field report's action)
  // is not a failing check, so it appears nowhere else in the report.
  const advisories = [...new Set((decision.advisories ?? []).filter(
    (item) => item && !decision.blockers.includes(item) && !decision.cautions.includes(item),
  ))];

  return (
    <section
      className="gear-actions sky-gear"
      hidden={hidden}
      aria-labelledby={`${id}-title`}
    >
      <h2 id={`${id}-title`} className="sr-only">Gear and field actions</h2>
      {lead && (
        <div className={`gear-decision${noGo ? " is-blocked" : ""}`}>
          <TriangleAlert size={20} aria-hidden="true" />
          <div>
            <strong>{headline[decision.level] ?? headline.CAUTION}</strong>
            <p>{actionLine}</p>
          </div>
        </div>
      )}
      {/* The checks themselves are in the brief and in Checks & sources; here, only how many and where. */}
      <p className="gear-field-plan">
        {actions.length > 0
          ? <><strong>{actions.length} {actions.length === 1 ? "check needs" : "checks need"} attention</strong>{" · "}</>
          : <>Nothing in this report calls for a plan change.{" "}</>}
        <button className="sky-link" type="button" onClick={onSources}>
          Review checks & sources
          <ArrowUpRight size={15} aria-hidden="true" />
        </button>
      </p>
      {advisories.length > 0 && (
        <ul className="gear-advisories" aria-label="Plan around">
          {advisories.map((item) => <li key={item}>{localize(item)}</li>)}
        </ul>
      )}
      <section className="gear-kit sky-section" aria-labelledby={`${id}-kit`}>
        <div className="sky-sh">
          <h2 id={`${id}-kit`} className="sky-subhead">
            <Backpack size={16} aria-hidden="true" />
            Packing list
          </h2>
          <p>
            {activityLabel
              ? `Based on this forecast, your time window, and ${activityLabel.toLowerCase()}.`
              : "Based on this forecast and your time window."}
          </p>
        </div>
        {items.length > 0 ? (
          <>
            <div className="gear-progress">
              <div>
                <p role="status">
                  <strong>
                    {packedCount} of {items.length}
                  </strong>{" "}
                  packed
                  {packedCount === items.length
                    ? " · List complete"
                    : ` · ${items.length - packedCount} remaining`}
                </p>
                <button
                  type="button"
                  disabled={packedCount === 0}
                  onClick={() => setPacked(new Set())}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  Clear
                </button>
              </div>
              <progress
                value={packedCount}
                max={items.length}
                aria-label="Packing progress"
              />
            </div>
            {groups.map((group) => {
              const members = items.filter(
                (item) => groupFor(item.tone) === group.id,
              );
              if (!members.length) return null;
              const fieldset = (
                <fieldset className={`gear-group is-${group.id}`} key={group.id}>
                  <legend className={group.id === "other" ? "sr-only" : undefined}>
                    {group.label}
                    <span>{members.length}</span>
                  </legend>
                  {group.id !== "other" && <p className="gear-group-note">{group.note}</p>}
                  <div className="gear-grid">
                    {members.map((item) => {
                      const key = itemKey(item);
                      const checked = packed.has(key);
                      return (
                        <label
                          className={`gear-item${checked ? " is-packed" : ""}`}
                          key={key}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              const nextChecked = event.currentTarget.checked;
                              setPacked((current) => {
                                const next = new Set(current);
                                if (nextChecked) next.add(key);
                                else next.delete(key);
                                return next;
                              });
                            }}
                          />
                          <span className="gear-check" aria-hidden="true">
                            {checked && <Check size={15} strokeWidth={3} />}
                          </span>
                          <span className="gear-item-copy">
                            <span className="gear-item-meta">
                              {item.category}
                              {checked && <span>Packed</span>}
                            </span>
                            <strong>{item.title}</strong>
                            {item.reason && (
                              <span className="gear-item-why">
                                <span className="sr-only">Why: </span>
                                {localize(item.reason)}
                              </span>
                            )}
                            {item.detail && (
                              <span className="gear-item-detail">
                                {localize(item.detail)}
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              );
              // The kit for every trip like this one waits shut; what this forecast adds stays open.
              if (group.id !== "other") return fieldset;
              const packedHere = members.filter((item) => packed.has(itemKey(item))).length;
              return (
                <Fold key={group.id} id={`${id}-standard`} title={group.label} className="gear-standard"
                  hint={`${members.length} ${members.length === 1 ? "item" : "items"}${packedHere ? `, ${packedHere} packed` : ""} · ${group.note.toLowerCase().replace(/\.$/, "")}`}>
                  {fieldset}
                </Fold>
              );
            })}
          </>
        ) : (
          <p className="gear-quiet">
            No gear recommendations are available for this report. Build your
            packing list from the route, current conditions, and your normal
            essentials.
          </p>
        )}
        <p className="gear-footnote">
          Checkmarks last while this report is open and do not change the
          risk assessment.
        </p>
      </section>
    </section>
  );
}
