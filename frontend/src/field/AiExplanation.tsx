import type { ReactNode } from "react";
import {
  Binoculars,
  Compass,
  Gauge,
  Info,
  Layers,
  MapPin,
  Mountain,
  Navigation,
  Snowflake,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { Streamdown } from "streamdown";
import {
  parseExplanation,
  parseSnowAnalysis,
  type LabeledSection,
} from "./ai-explanation";
import "./ai-explanation.css";

type Layout = {
  icons: Record<string, LucideIcon>;
  lead: string;
  action: string;
  tags?: Record<string, string>;
};
const briefLayout: Layout = {
  icons: {
    overview: Compass,
    action: Navigation,
    watch: Binoculars,
    confidence: Gauge,
    evidence: Layers,
    comfort: Sun,
    note: Info,
  },
  lead: "overview",
  action: "action",
  tags: { comfort: "Not a safety factor" },
};
const snowLayout: Layout = {
  icons: {
    coverage: Snowflake,
    terrain: Mountain,
    ground: MapPin,
    uncertainty: Info,
    takeaway: Navigation,
    note: Info,
  },
  lead: "coverage",
  action: "takeaway",
};

function Section({
  section,
  layout,
}: {
  section: LabeledSection<string>;
  layout: Layout;
}) {
  const Icon = layout.icons[section.kind] ?? Info;
  const tag = layout.tags?.[section.kind];
  const role =
    section.kind === layout.action
      ? "action"
      : section.kind === layout.lead || section.kind === "note"
        ? "lead"
        : null;
  const roleClass = role && role !== section.kind ? ` is-${role}` : "";
  return (
    <article className={`ai-explanation-section is-${section.kind}${roleClass}`}>
      <header className="ai-explanation-heading">
        <Icon size={16} aria-hidden="true" />
        <h3>{section.title}</h3>
        {tag && <span className="ai-explanation-tag">{tag}</span>}
      </header>
      <div className="field-markdown ai-explanation-copy">
        <Streamdown mode="static">{section.text}</Streamdown>
      </div>
    </article>
  );
}

// Reads as an inverted pyramid: the overall picture, the recommended move, then
// the supporting reasoning in the order the model wrote it.
function AiSections({
  sections,
  layout,
  stale,
  media,
}: {
  sections: LabeledSection<string>[];
  layout: Layout;
  stale: boolean;
  media?: ReactNode;
}) {
  const lead = sections.filter((s) => s.kind === "note" || s.kind === layout.lead);
  const action = sections.filter((s) => s.kind === layout.action);
  const supporting = sections.filter(
    (s) => !["note", layout.lead, layout.action].includes(s.kind),
  );
  const render = (section: LabeledSection<string>, index: number) => (
    <Section section={section} layout={layout} key={`${section.kind}-${index}`} />
  );
  const main = (
    <>
      {lead.map(render)}
      {action.map(render)}
    </>
  );
  return (
    <div className={`ai-explanation${stale ? " is-stale" : ""}`}>
      {media ? (
        <div className="ai-explanation-media">
          {media}
          <div className="ai-explanation-main">{main}</div>
        </div>
      ) : (
        main
      )}
      {supporting.length > 0 && (
        <div
          className={`ai-explanation-supporting${supporting.length === 3 ? " is-three" : ""}`}
        >
          {supporting.map(render)}
        </div>
      )}
    </div>
  );
}

export function AiExplanation({
  text,
  stale = false,
}: {
  text: string;
  stale?: boolean;
}) {
  return (
    <AiSections sections={parseExplanation(text)} layout={briefLayout} stale={stale} />
  );
}

export function SnowAnalysis({
  text,
  image,
  stale = false,
}: {
  text: string;
  image?: string | null;
  stale?: boolean;
}) {
  const media = image ? (
    <figure className="ai-snow-figure">
      <img src={image} alt="Sentinel-2 true-colour satellite image used for the snow analysis" />
      <figcaption>
        Sentinel-2 true colour · about 5 × 5 km centred on the objective ·
        least-cloudy pass in the last 30 days
      </figcaption>
    </figure>
  ) : undefined;
  return (
    <AiSections
      sections={parseSnowAnalysis(text)}
      layout={snowLayout}
      stale={stale}
      media={media}
    />
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
