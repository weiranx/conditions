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

export function GearActions({
  hidden,
  recommendations,
  decision,
  actionLine,
  onSources,
  activityLabel = null,
  localize = identity,
}: {
  hidden: boolean;
  recommendations: GearItem[];
  decision: SummitDecision;
  actionLine: string;
  onSources: () => void;
  activityLabel?: string | null;
  localize?: (text: string) => string;
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
  const blockers = [...new Set(decision.blockers.filter(Boolean))];
  const cautions = [
    ...new Set(
      decision.cautions.filter((item) => item && !blockers.includes(item)),
    ),
  ];
  const actions = decision.checks.filter(
    (check) => !check.ok && check.action?.trim(),
  );
  const noGo = decision.level === "NO-GO";

  return (
    <section
      className="gear-actions sky-gear"
      hidden={hidden}
      aria-labelledby={`${id}-title`}
    >
      <h2 id={`${id}-title`} className="sr-only">Gear and field actions</h2>
      <div className={`gear-decision${noGo ? " is-blocked" : ""}`}>
        <TriangleAlert size={20} aria-hidden="true" />
        <div>
          <strong>{headline[decision.level] ?? headline.CAUTION}</strong>
          <p>{actionLine}</p>
        </div>
      </div>
      <section className="gear-field-plan sky-section" aria-labelledby={`${id}-actions`}>
        <div className="sky-sh">
          <h2 id={`${id}-actions`}>Before you leave</h2>
          <p>Settle these first. They can change the plan.</p>
        </div>
        <div className="gear-plan-card">
          {blockers.length > 0 && (
            <div className="gear-concerns is-blocked">
              <h3>Must resolve</h3>
              <ol>
                {blockers.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </div>
          )}
          {cautions.length > 0 && (
            <div className="gear-concerns">
              <h3>Plan around</h3>
              <ol start={blockers.length + 1} style={{ counterReset: `gear ${blockers.length}` }}>
                {cautions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </div>
          )}
          {actions.length > 0 && (
            <details className="gear-check-actions sky-details">
              <summary>
                {actions.length}{" "}
                {actions.length === 1 ? "check needs" : "checks need"} attention
              </summary>
              <ul>
                {actions.map((check, i) => (
                  <li key={`${check.key || check.label}-${i}`}>
                    <span className="gear-unmet">Needs review</span>
                    <strong>{check.label}</strong>
                    <p>{check.action}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {blockers.length === 0 &&
            cautions.length === 0 &&
            actions.length === 0 && (
              <p className="gear-quiet">
                Nothing in this report calls for a plan change. Check current
                sources and agree on a turnaround time with your group.
              </p>
            )}
          <button className="field-button" type="button" onClick={onSources}>
            Review checks & sources{" "}
            <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        </div>
      </section>
      <section className="gear-kit sky-section" aria-labelledby={`${id}-kit`}>
        <div className="sky-sh">
          <h2 id={`${id}-kit`}>
            <Backpack size={20} aria-hidden="true" />
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
              return (
                members.length > 0 && (
                  <fieldset
                    className={`gear-group is-${group.id}`}
                    key={group.id}
                  >
                    <legend>
                      {group.label}
                      <span>{members.length}</span>
                    </legend>
                    <p className="gear-group-note">{group.note}</p>
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
                )
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
