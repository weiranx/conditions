import type { SafetyData, SupplementalDiscussionSection, SupplementalSource } from '../app/types';
import { SourceLink } from './Details';
import './supplemental-evidence.css';

const HOUR = 3600000;
const timestamp = (value?: string) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  : 'Time unavailable';
const status = (source: SupplementalSource) => source.available ? 'Available'
  : source.status === 'not_configured' ? 'Not configured'
  : source.status === 'out_of_range' ? 'Outside coverage'
  : source.status === 'no_data' ? 'No matching data' : 'Unavailable';
const kinds = { observation: 'Current observations', probabilistic_forecast: 'Model probability guidance', regional_context: 'Regional forecaster context', modeled_forecast: 'Smoke model snapshot' };
const time = (value?: string) => (value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null);

// "At your start", "6 h before your start", "3 days after your start".
const fromStart = (value: number, start: number) => {
  const hours = Math.round((value - start) / HOUR);
  if (Math.abs(hours) < 1) return 'at your start';
  const span = Math.abs(hours) < 48 ? `${Math.abs(hours)} h` : `${Math.round(Math.abs(hours) / 24)} days`;
  return `${span} ${hours < 0 ? 'before' : 'after'} your start`;
};

// Current observations only describe the trip when it starts within a few
// hours; for later trips the forecast sources say more about the objective.
const NEAR_START_HOURS = 3;
const order = (nearStart: boolean) => nearStart ? ['synoptic', 'nbm', 'hrrrSmoke', 'discussion'] : ['nbm', 'discussion', 'hrrrSmoke', 'synoptic'];
const rank = (key: string, nearStart: boolean) => { const index = order(nearStart).indexOf(key); return index < 0 ? 99 : index; };

const sectionLabel = (section: SupplementalDiscussionSection) => {
  const title = section.title.replace(/^[A-Z]{3} (?=WATCHES)/, '');
  return `${title.charAt(0)}${title.slice(1).toLowerCase()}${section.period ? ` · ${section.period}` : ''}`;
};

function Discussion({ source }: { source: SupplementalSource }) {
  const sections = (source.sections || []).filter((section) => section.kind !== 'not_relevant');
  if (!sections.length) return <details><summary>Read {source.office} forecast discussion</summary><pre>{source.text}</pre></details>;
  const dated = sections.filter((section) => section.matchesTrip != null);
  const matched = sections.filter((section) => section.matchesTrip === true);
  // Without a dated section for the trip, the overview is the best regional summary.
  const lead = sections.filter((section) => section.kind === 'key_messages' || section.matchesTrip === true || (!matched.length && section.kind === 'overview' && section.matchesTrip == null));
  const rest = sections.filter((section) => !lead.includes(section));
  return <>
    {dated.length > 0 && !matched.length && <p>None of the discussion&apos;s dated forecast periods include your trip date{source.tripDayOffset != null && source.tripDayOffset > 0 ? ` (${source.tripDayOffset} days after it was written)` : ''}. Its guidance may not reach your trip.</p>}
    {lead.map((section, index) => <div className="supplemental-discussion-section" key={`${section.title}-${index}`}>
      <h4>{sectionLabel(section)}{section.matchesTrip ? <span className="supplemental-match">Includes your date</span> : null}</h4>
      <pre>{section.text}</pre>
    </div>)}
    {rest.map((section, index) => <details key={`${section.title}-${index}`}><summary>{sectionLabel(section)}{section.matchesTrip === false ? ' (another period)' : ''}</summary><pre>{section.text}</pre></details>)}
    <details><summary>Full {source.office} discussion, including aviation and marine</summary><pre>{source.text}</pre></details>
  </>;
}

export function SupplementalEvidence({ evidence, localize = (text) => text }: {
  evidence?: SafetyData['supplementalEvidence'];
  localize?: (text: string) => string;
}) {
  if (!evidence || !Object.values(evidence).some(Boolean)) return null;
  const entries = Object.entries(evidence).filter((entry): entry is [string, SupplementalSource] => Boolean(entry[1]));
  const start = entries.map(([, source]) => time(source.targetTime)).find((value) => value !== null) ?? null;
  const checked = entries.map(([, source]) => time(source.checkedTime)).find((value) => value !== null) ?? null;
  const nearStart = start === null || checked === null || Math.abs(start - checked) <= NEAR_START_HOURS * HOUR;
  const available = entries.filter(([, source]) => source.available).sort(([a], [b]) => rank(a, nearStart) - rank(b, nearStart));
  const missing = entries.filter(([, source]) => !source.available);

  return <section className="field-panel supplemental-evidence" aria-labelledby="supplemental-evidence-title">
    <h2 id="supplemental-evidence-title">Additional source evidence</h2>
    <p className="field-muted">Use these sources to cross-check the report. They do not change its safety score.{start !== null ? ` Listed by relevance to your ${timestamp(new Date(start).toISOString())} start.` : ''}</p>
    {available.map(([key, source]) => {
      const valid = time(source.validTime);
      const observedLater = key === 'synoptic' && !nearStart && start !== null && checked !== null;
      const closest = start === null ? null : (source.points || []).reduce<string | null>((best, point) => {
        const t = time(point.validTime), b = time(best ?? undefined);
        return t !== null && (b === null || Math.abs(t - start) < Math.abs(b - start)) ? point.validTime : best;
      }, null);
      const stations = source.stations?.map((station) => <div className="supplemental-station" key={station.id}>
        <strong>{station.name} ({station.id})</strong>
        <p>{localize(`${station.distanceKm} km away${station.elevationFt != null ? ` · ${station.elevationFt} ft elevation` : ''}${station.elevationDifferenceFt != null ? ` · ${Math.abs(station.elevationDifferenceFt)} ft ${station.elevationDifferenceFt >= 0 ? 'above' : 'below'} objective` : ''}`)}</p>
        <dl>{Object.entries(station.readings || {}).map(([name, reading]) => <div key={name}>
          <dt>{name === 'temperatureF' ? 'Temperature' : name === 'gustMph' ? 'Wind gust' : 'Wind speed'}</dt>
          <dd>{localize(`${reading.value} ${name === 'temperatureF' ? '°F' : 'mph'}`)} <small>· {timestamp(reading.observedTime)}</small></dd>
        </div>)}</dl>
      </div>);
      return <article key={key}>
        <div className="supplemental-evidence-heading"><h3>{source.source}</h3><span>{status(source)}</span></div>
        <p className="field-muted">{kinds[source.kind]}{source.issuedTime ? ` · Issued ${timestamp(source.issuedTime)}` : ''}</p>
        {observedLater && <p>These readings are from {fromStart(checked, start).replace(' your start', '')} your start, so they show conditions now, not during the trip. Use them to judge whether today&apos;s forecast is running high or low.</p>}
        {stations?.length ? (observedLater ? <details><summary>Show {stations.length} current station reading{stations.length === 1 ? '' : 's'}</summary>{stations}</details> : stations) : null}
        {source.station && <p>{localize(`${source.station.name} (${source.station.id}) · ${source.station.distanceKm} km away${source.station.elevationFt != null ? ` · ${source.station.elevationFt} ft elevation` : ''}`)}</p>}
        {source.points?.length ? <div className="supplemental-table-scroll"><table>
          <caption>Wind speed percentiles at the forecast station</caption>
          <thead><tr><th scope="col">Valid time</th><th scope="col">P10</th><th scope="col">Median</th><th scope="col">P90</th></tr></thead>
          <tbody>{source.points.map((point) => {
            const t = time(point.validTime);
            return <tr key={point.validTime} className={point.validTime === closest ? 'is-closest' : undefined}>
              <th scope="row">{timestamp(point.validTime)}{start !== null && t !== null ? <small>{fromStart(t, start)}</small> : null}</th>
              {[point.windMph.p10, point.windMph.p50, point.windMph.p90].map((value, i) => <td key={i}>{localize(`${value} mph`)}</td>)}
            </tr>;
          })}</tbody>
        </table></div> : null}
        {source.nearSurfaceUgM3 != null && <>
          <p>Valid {timestamp(source.validTime)}{start !== null && valid !== null ? ` (${fromStart(valid, start)})` : ''}{source.gridDistanceKm != null ? localize(` · Model grid point ${source.gridDistanceKm} km away`) : ''}</p>
          <dl><div><dt>Near-surface smoke</dt><dd>{source.nearSurfaceUgM3} µg/m³</dd></div><div><dt>Total-column smoke</dt><dd>{source.columnMgM2 ?? 'Unavailable'} mg/m²</dd></div></dl>
        </>}
        {key === 'discussion' && source.text ? <Discussion source={source} /> : null}
        <p>{source.note}</p>
        <SourceLink url={source.sourceLink}>View source</SourceLink>
      </article>;
    })}
    {missing.length > 0 && <div className="supplemental-missing">
      <h3>Not available for this report</h3>
      <ul>{missing.map(([key, source]) => <li key={key}><strong>{source.source}</strong> · {status(source)}{source.note ? <span className="field-muted"> — {source.note}</span> : null}</li>)}</ul>
    </div>}
  </section>;
}
