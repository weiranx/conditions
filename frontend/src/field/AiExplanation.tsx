import {
  Binoculars,
  Compass,
  Gauge,
  Info,
  Layers,
  Navigation,
  Sun,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { parseExplanation, type ExplanationSection } from "./ai-explanation";
import "./ai-explanation.css";
const icons = {
  overview: Compass,
  action: Navigation,
  watch: Binoculars,
  confidence: Gauge,
  evidence: Layers,
  comfort: Sun,
  note: Info,
};
function Heading({ section }: { section: ExplanationSection }) {
  const Icon = icons[section.kind];
  return (
    <header className="ai-explanation-heading">
      <Icon size={16} aria-hidden="true" />
      <h3>{section.title}</h3>
      {section.kind === "comfort" && (
        <span className="ai-explanation-tag">Not a safety factor</span>
      )}
    </header>
  );
}
function Content({ text }: { text: string }) {
  return (
    <div className="field-markdown ai-explanation-copy">
      <Streamdown mode="static">{text}</Streamdown>
    </div>
  );
}
function Section({ section }: { section: ExplanationSection }) {
  return (
    <article className={`ai-explanation-section is-${section.kind}`}>
      <Heading section={section} />
      <Content text={section.text} />
    </article>
  );
}
// Reads as an inverted pyramid: the overall picture, the recommended move, then
// the supporting reasoning in the order the brief was written.
export function AiExplanation({
  text,
  stale = false,
}: {
  text: string;
  stale?: boolean;
}) {
  const sections = parseExplanation(text);
  const lead = sections.filter((s) => s.kind === "note" || s.kind === "overview");
  const action = sections.filter((s) => s.kind === "action");
  const supporting = sections.filter(
    (s) => !["note", "overview", "action"].includes(s.kind),
  );
  return (
    <div className={`ai-explanation${stale ? " is-stale" : ""}`}>
      {lead.map((section, index) => (
        <Section section={section} key={`${section.kind}-${index}`} />
      ))}
      {action.map((section, index) => (
        <Section section={section} key={`${section.kind}-${index}`} />
      ))}
      {supporting.length > 0 && (
        <div className="ai-explanation-supporting">
          {supporting.map((section, index) => (
            <Section section={section} key={`${section.kind}-${index}`} />
          ))}
        </div>
      )}
    </div>
  );
}
export function AiExplanationSkeleton() {
  return (
    <div className="ai-explanation-skeleton" aria-hidden="true">
      <span />
      <span />
      <span />
      <span className="is-block" />
      <span className="is-short" />
    </div>
  );
}
