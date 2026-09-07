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
  category: string;
  tone: string;
};
const itemKey = (item: GearItem) =>
  JSON.stringify([item.title, item.detail, item.category]);
const groups = [
  { id: "priority", label: "High priority", note: "Address these first." },
  {
    id: "conditions",
    label: "For these conditions",
    note: "Extra preparation for this forecast.",
  },
  {
    id: "other",
    label: "Additional preparation",
    note: "Round out your usual kit.",
  },
] as const;
const groupFor = (tone: string) =>
  tone === "nogo" ? "priority" : tone === "caution" ? "conditions" : "other";

export function GearActions({
  hidden,
  recommendations,
  decision,
  actionLine,
  onSources,
}: {
  hidden: boolean;
  recommendations: GearItem[];
  decision: SummitDecision;
  actionLine: string;
  onSources: () => void;
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
      className="gear-actions"
      hidden={hidden}
      aria-labelledby={`${id}-title`}
    >
      <div className="field-chapter-heading">
        <h2 id={`${id}-title`}>Gear and field actions</h2>
        <p>Review the plan, then prepare your kit for these conditions.</p>
      </div>
      <div className={`gear-decision${noGo ? " is-blocked" : ""}`}>
        <TriangleAlert size={21} aria-hidden="true" />
        <div>
          <strong>
            {noGo
              ? "Change the plan before packing"
              : "Your field plan comes first"}
          </strong>
          <p>{actionLine}</p>
        </div>
      </div>
      <div className="gear-layout">
        <section className="gear-field-plan" aria-labelledby={`${id}-actions`}>
          <header className="gear-section-head">
            <span className="field-kicker">01 / Review</span>
            <h3 id={`${id}-actions`}>Before you commit</h3>
          </header>
          {blockers.length > 0 && (
            <div className="gear-concerns is-blocked">
              <h4>Resolve before departure</h4>
              <ul>
                {blockers.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {cautions.length > 0 && (
            <div className="gear-concerns">
              <h4>Adjust for these conditions</h4>
              <ul>
                {cautions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {actions.length > 0 && (
            <details className="gear-check-actions">
              <summary>
                Actions from {actions.length} unmet{" "}
                {actions.length === 1 ? "check" : "checks"}
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
                No specific adjustments are listed in this report. Review
                current sources and agree on checkpoints with your group.
              </p>
            )}
          <button className="field-button" type="button" onClick={onSources}>
            Review checks & sources{" "}
            <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        </section>
        <section className="gear-kit" aria-labelledby={`${id}-kit`}>
          <header className="gear-section-head">
            <span className="field-kicker">02 / Prepare</span>
            <h3 id={`${id}-kit`}>
              <Backpack size={20} aria-hidden="true" />
              Your packing list
            </h3>
          </header>
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
                    Reset checks
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
                            <span className="gear-item-copy">
                              <span className="gear-item-meta">
                                {item.category}
                                {checked && (
                                  <span>
                                    <Check size={12} aria-hidden="true" />
                                    Packed
                                  </span>
                                )}
                              </span>
                              <strong>{item.title}</strong>
                              {item.detail && (
                                <span className="gear-item-detail">
                                  {item.detail}
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
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
            Checks stay while this report is open; a new report starts fresh.
            Carry your normal essentials too. Packing progress does not change
            the report’s risk assessment.
          </p>
        </section>
      </div>
    </section>
  );
}
