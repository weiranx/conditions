import type { SafetyData, SupplementalSource } from '../app/types';
import { SourceLink } from './Details';
import './supplemental-evidence.css';

const timestamp = (value?: string) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  : 'Time unavailable';
const status = (source: SupplementalSource) => source.available ? 'Available'
  : source.status === 'not_configured' ? 'Not configured'
  : source.status === 'out_of_range' ? 'Outside coverage'
  : source.status === 'no_data' ? 'No matching data' : 'Unavailable';
const kinds = { observation: 'Current observations', probabilistic_forecast: 'Model probability guidance', regional_context: 'Regional forecaster context', modeled_forecast: 'Smoke model snapshot' };

export function SupplementalEvidence({ evidence, localize = (text) => text }: {
  evidence?: SafetyData['supplementalEvidence'];
  localize?: (text: string) => string;
}) {
  if (!evidence || !Object.values(evidence).some(Boolean)) return null;
  return <section className="field-panel supplemental-evidence" aria-labelledby="supplemental-evidence-title">
    <h2 id="supplemental-evidence-title">Additional source evidence</h2>
    <p className="field-muted">Use these sources to cross-check the report. They do not change its safety score.</p>
    {Object.entries(evidence).filter((entry): entry is [string, SupplementalSource] => Boolean(entry[1])).map(([key, source]) => (
      <article key={key}>
        <div className="supplemental-evidence-heading"><h3>{source.source}</h3><span>{status(source)}</span></div>
        <p className="field-muted">{kinds[source.kind]}{source.issuedTime ? ` · Issued ${timestamp(source.issuedTime)}` : ''}</p>
        {source.available && source.stations?.map((station) => <div className="supplemental-station" key={station.id}>
          <strong>{station.name} ({station.id})</strong>
          <p>{localize(`${station.distanceKm} km away${station.elevationFt != null ? ` · ${station.elevationFt} ft elevation` : ''}${station.elevationDifferenceFt != null ? ` · ${Math.abs(station.elevationDifferenceFt)} ft ${station.elevationDifferenceFt >= 0 ? 'above' : 'below'} objective` : ''}`)}</p>
          <dl>{Object.entries(station.readings || {}).map(([name, reading]) => <div key={name}>
            <dt>{name === 'temperatureF' ? 'Temperature' : name === 'gustMph' ? 'Wind gust' : 'Wind speed'}</dt>
            <dd>{localize(`${reading.value} ${name === 'temperatureF' ? '°F' : 'mph'}`)} <small>· {timestamp(reading.observedTime)}</small></dd>
          </div>)}</dl>
        </div>)}
        {source.available && source.station && <p>{localize(`${source.station.name} (${source.station.id}) · ${source.station.distanceKm} km away${source.station.elevationFt != null ? ` · ${source.station.elevationFt} ft elevation` : ''}`)}</p>}
        {source.available && source.points?.length ? <div className="supplemental-table-scroll"><table>
          <caption>Wind speed percentiles at the forecast station</caption>
          <thead><tr><th scope="col">Valid time</th><th scope="col">P10</th><th scope="col">Median</th><th scope="col">P90</th></tr></thead>
          <tbody>{source.points.map((point) => <tr key={point.validTime}><th scope="row">{timestamp(point.validTime)}</th>{[point.windMph.p10, point.windMph.p50, point.windMph.p90].map((value, i) => <td key={i}>{localize(`${value} mph`)}</td>)}</tr>)}</tbody>
        </table></div> : null}
        {source.available && source.nearSurfaceUgM3 != null && <>
          <p>Valid {timestamp(source.validTime)}{source.gridDistanceKm != null ? localize(` · Model grid point ${source.gridDistanceKm} km away`) : ''}</p>
          <dl><div><dt>Near-surface smoke</dt><dd>{source.nearSurfaceUgM3} µg/m³</dd></div><div><dt>Total-column smoke</dt><dd>{source.columnMgM2 ?? 'Unavailable'} mg/m²</dd></div></dl>
        </>}
        <p>{source.note}</p>
        {source.available && source.text && <details><summary>Read {source.office} forecast discussion</summary><pre>{source.text}</pre></details>}
        <SourceLink url={source.sourceLink}>View source</SourceLink>
      </article>
    ))}
  </section>;
}
