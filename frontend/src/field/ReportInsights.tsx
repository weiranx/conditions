import type { SafetyData } from '../app/types';
import { reportInsightItems } from '../app/report-insights';
import { SourceLink } from './Details';
import './report-insights.css';

type Insight = ReturnType<typeof reportInsightItems>[number];

// Items that only restate what a feed cannot establish. They stay in the
// payload for the AI brief and field brief but are not worth screen space.
const disclaimerOnly = (item: Insight) =>
  item.tone === 'gap' || (item.tone === 'context' && ['access', 'station-wind', 'water'].includes(item.id));

export function ReportInsights({ data, localize = text => text, onSources }: {
  data: SafetyData;
  localize?: (text: string) => string;
  onSources: () => void;
}) {
  const items = reportInsightItems(data);
  const cautions = items.filter(item => item.decisionRelevant);
  const background = items.filter(item => !item.decisionRelevant && !disclaimerOnly(item));
  if (!cautions.length && !background.length) return null;
  const renderItem = (item: Insight) => <article key={item.id} className={`report-insight is-${item.tone}`}>
    {!item.decisionRelevant && <span className="field-kicker">{item.tone === 'support' ? 'Limited agreement' : 'Background'}</span>}
    <h3>{item.title}</h3>
    <p>{localize(item.meaning)}</p>
    <p className="report-insight-action"><strong>For your plan:</strong> {localize(item.action)}</p>
    {item.evidence.length > 0 && <details><summary>Why the report says this</summary>
      <ul>{item.evidence.map((source, i) => <li key={i}><strong>{source.source}</strong><span>{localize(source.detail)}</span>
        {source.time && <time dateTime={source.time}>{Number.isFinite(Date.parse(source.time)) ? new Date(source.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : 'Time unavailable'}</time>}
        {source.url && <SourceLink url={source.url}>Open source</SourceLink>}
      </li>)}</ul>
    </details>}
  </article>;
  const backgroundLabel = `${background.length} background note${background.length === 1 ? '' : 's'}`;
  if (!cautions.length) return <details className="report-insights report-insights-quiet">
    <summary>No field or access flags · {backgroundLabel}</summary>
    <div className="report-insight-list">{background.map(renderItem)}</div>
    <button className="field-button" onClick={onSources}>Checks & sources</button>
  </details>;
  return <section className="report-insights field-panel" aria-labelledby="report-insights-title">
    <header><div><span className="field-kicker">Before you commit</span><h2 id="report-insights-title">{cautions.length === 1 ? '1 check to resolve' : `${cautions.length} checks to resolve`}</h2></div><button className="field-button" onClick={onSources}>Checks & sources</button></header>
    <div className="report-insight-list">{cautions.map(renderItem)}</div>
    {background.length > 0 && <details className="report-insight-more"><summary>{backgroundLabel}</summary><div className="report-insight-list">{background.map(renderItem)}</div></details>}
  </section>;
}
