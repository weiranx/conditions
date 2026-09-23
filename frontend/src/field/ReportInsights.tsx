import type { SafetyData } from '../app/types';
import { reportInsightItems } from '../app/report-insights';
import { SourceLink } from './Details';
import './report-insights.css';

export function ReportInsights({ data, localize = text => text, onSources }: {
  data: SafetyData;
  localize?: (text: string) => string;
  onSources: () => void;
}) {
  const items = reportInsightItems(data);
  if (!items.length) return null;
  const priority = items.filter(item => item.decisionRelevant);
  const renderItem = (item: typeof items[number]) => <article key={item.id} className={`report-insight is-${item.tone}`}>
    <span className="field-kicker">{item.tone === 'caution' ? 'Needs review' : item.tone === 'gap' ? 'Evidence gap' : item.tone === 'support' ? 'Limited agreement' : 'Planning context'}</span>
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
  return <section className="report-insights field-panel" aria-labelledby="report-insights-title">
    <header><div><span className="field-kicker">Forecast, field observations & access</span><h2 id="report-insights-title">What this means for your trip</h2></div><button className="field-button" onClick={onSources}>Checks & sources</button></header>
    <p>{priority.length ? `Start with: ${priority[0].title}. Weigh the highlighted checks together with the main forecast.` : 'How the available sources apply to your plan, and where they cannot confirm conditions.'}</p>
    <p className="field-muted">These points can move the trip decision to Caution, but they do not lower the safety score.</p>
    <div className="report-insight-list">{items.slice(0, 3).map(renderItem)}</div>
    {items.length > 3 && <details className="report-insight-more"><summary>{items.length - 3} more findings and evidence limits</summary><div className="report-insight-list">{items.slice(3).map(renderItem)}</div></details>}
  </section>;
}
