import {
  ArrowUpRight,
  Binoculars,
  Compass,
  Database,
  Info,
  Sun,
  Layers,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { parseExplanation, type ExplanationSection } from "./ai-explanation";
import "./ai-explanation.css";
const icons = {
  overview: Compass,
  action: ArrowUpRight,
  watch: Binoculars,
  confidence: Database,
  evidence: Layers,
  comfort: Sun,
  note: Info,
};
function Heading({ section }: { section: ExplanationSection }) {
  const Icon = icons[section.kind];
  return (
    <>
      <span className="ai-explanation-icon">
        <Icon size={18} aria-hidden="true" />
      </span>
      <h3>{section.title}</h3>
    </>
  );
}
function Content({ text }: { text: string }) {
  return (
    <div className="field-markdown ai-explanation-copy">
      <Streamdown mode="static">{text}</Streamdown>
    </div>
  );
}
export function AiExplanation({ text }: { text: string }) {
  const sections = parseExplanation(text);
  const primary = sections.filter((section) =>
    ["overview", "action", "note"].includes(section.kind),
  );
  const supporting = sections.filter(
    (section) => !["overview", "action", "note"].includes(section.kind),
  );
  return (
    <div className="ai-explanation">
      <div className="ai-explanation-primary">
        {primary.map((section, index) => (
          <article
            className={`ai-explanation-card is-${section.kind}`}
            key={`${section.kind}-${index}`}
          >
            <header>
              <Heading section={section} />
            </header>
            <Content text={section.text} />
          </article>
        ))}
      </div>
      {supporting.length > 0 && (
        <div className="ai-explanation-supporting">
          {supporting.map((section, index) => (
            <details
              className={`ai-explanation-detail is-${section.kind}`}
              key={`${section.kind}-${index}`}
              open={section.kind === "watch"}
            >
              <summary>
                <Heading section={section} />
                <span className="ai-explanation-chevron" aria-hidden="true" />
              </summary>
              <Content text={section.text} />
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
