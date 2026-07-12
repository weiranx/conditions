import type { ReactNode } from 'react';
import {
  Binoculars,
  Compass,
  Database,
  PackageCheck,
  ShieldCheck,
  Sparkles,
  Sun,
} from 'lucide-react';
import type { AiBriefSection, AiBriefSectionKind } from '../../app/text-utils';
import '../../styles/dashboard-redesign.css';

const SECTION_ICONS = {
  overview: Compass,
  watch: Binoculars,
  comfort: Sun,
  evidence: Database,
  gear: PackageCheck,
  action: ShieldCheck,
  note: Sparkles,
} as const satisfies Record<AiBriefSectionKind, typeof Sparkles>;

interface AiInsightBriefingProps {
  title: string;
  subtitle: string;
  sections: AiBriefSection[];
  media?: ReactNode;
  footer?: ReactNode;
  formatText?: (text: string) => string;
}

export function AiInsightBriefing({
  title,
  subtitle,
  sections,
  media,
  footer,
  formatText = (text) => text,
}: AiInsightBriefingProps) {
  return (
    <div className="ssr-dash-ai-text">
      <div className="ssr-dash-ai-heading">
        <span className="ssr-dash-ai-heading-icon"><Sparkles size={17} aria-hidden /></span>
        <div>
          <div className="ssr-dash-ai-label">{title}</div>
          <p>{subtitle}</p>
        </div>
      </div>
      {media}
      <div className="ssr-dash-ai-grid">
        {sections.map((section) => {
          const SectionIcon = SECTION_ICONS[section.kind];
          const gearItems = section.kind === 'gear'
            ? section.text.split(/\s*;\s*|\s+-\s+/).map((item) => item.replace(/^[-•]\s*/, '').trim()).filter(Boolean)
            : [];
          return (
            <article
              className={`ssr-dash-ai-note ${section.kind}`}
              key={`${section.kind}-${section.label}-${section.text.slice(0, 32)}`}
            >
              <div className="ssr-dash-ai-note-title">
                <span><SectionIcon size={15} aria-hidden /></span>
                <h3>{section.label}</h3>
              </div>
              {gearItems.length > 1 ? (
                <ul>
                  {gearItems.map((item) => <li key={item}>{formatText(item)}</li>)}
                </ul>
              ) : (
                <p>{formatText(section.text)}</p>
              )}
            </article>
          );
        })}
      </div>
      {footer}
    </div>
  );
}
