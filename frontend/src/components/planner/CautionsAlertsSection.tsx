import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  MapPin,
  Radio,
  ShieldAlert,
} from 'lucide-react';
import type { NwsAlertItem } from '../../app/types';
import '../../styles/cautions-alerts.css';

interface CautionsAlertsSectionProps {
  blockers: string[];
  cautions: string[];
  alerts: NwsAlertItem[];
  formatPubTime: (isoString?: string) => string;
  localizeUnitText: (text: string) => string;
}

type AlertTone = 'nogo' | 'warn' | 'neutral';

function alertTone(severity?: string | null): AlertTone {
  const normalized = (severity || '').toLowerCase();
  if (normalized === 'extreme' || normalized === 'severe') return 'nogo';
  if (normalized === 'moderate') return 'warn';
  return 'neutral';
}

function alertWindow(alert: NwsAlertItem, formatPubTime: CautionsAlertsSectionProps['formatPubTime']) {
  const starts = alert.onset || alert.effective;
  const ends = alert.ends || alert.expires;
  if (starts && ends) return `${formatPubTime(starts)} – ${formatPubTime(ends)}`;
  if (ends) return `Until ${formatPubTime(ends)}`;
  if (starts) return `From ${formatPubTime(starts)}`;
  return null;
}

export function CautionsAlertsSection({
  blockers,
  cautions,
  alerts,
  formatPubTime,
  localizeUnitText,
}: CautionsAlertsSectionProps) {
  const openCount = blockers.length + cautions.length + alerts.length;
  const highestAlertTone = alerts.some((alert) => alertTone(alert.severity) === 'nogo')
    ? 'nogo'
    : alerts.some((alert) => alertTone(alert.severity) === 'warn')
      ? 'warn'
      : 'neutral';
  const sectionTone = blockers.length > 0 || highestAlertTone === 'nogo'
    ? 'nogo'
    : openCount > 0
      ? 'warn'
      : 'clear';
  const statusLabel = blockers.length > 0
    ? `${blockers.length} blocker${blockers.length === 1 ? '' : 's'}`
    : openCount > 0
      ? `${openCount} to review`
      : 'No open items';
  const overviewTitle = blockers.length > 0
    ? 'Resolve no-go conditions before committing to this plan.'
    : openCount > 0
      ? 'Review these items before leaving the planning screen.'
      : 'No modeled cautions or active weather alerts.';
  const overviewDetail = blockers.length > 0
    ? 'Start with blockers, then carry the listed cautions and official alerts into your route and turnaround plan.'
    : openCount > 0
      ? 'Modeled cautions are planning guidance; weather alerts are official notices from the issuing agency.'
      : 'Conditions can change. Recheck official sources and reassess at field checkpoints.';

  return (
    <section className={`ssr-card ssr-alerts-card ${sectionTone}`} id="planner-section-alerts" aria-labelledby="planner-alerts-title">
      <div className="ssr-card-h">
        <h2 id="planner-alerts-title">
          <span className={`ssr-h-icon ssr-alerts-h-icon ${sectionTone}`}><ShieldAlert size={16} /></span>
          Cautions &amp; Alerts
        </h2>
        <span className={`ssr-alerts-status ${sectionTone}`}>{statusLabel}</span>
      </div>

      <div className="ssr-card-b ssr-alerts-body">
        <div className={`ssr-alerts-overview ${sectionTone}`}>
          <span className="ssr-alerts-overview-icon" aria-hidden>
            {sectionTone === 'clear' ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
          </span>
          <div>
            <strong>{overviewTitle}</strong>
            <span>{overviewDetail}</span>
          </div>
        </div>

        {openCount > 0 && (
          <div className="ssr-alerts-counts" aria-label="Open item counts">
            <div className={blockers.length > 0 ? 'nogo' : ''}>
              <span>Plan blockers</span>
              <strong>{blockers.length}</strong>
            </div>
            <div className={cautions.length > 0 ? 'warn' : ''}>
              <span>Modeled cautions</span>
              <strong>{cautions.length}</strong>
            </div>
            <div className={alerts.length > 0 ? highestAlertTone : ''}>
              <span>Official alerts</span>
              <strong>{alerts.length}</strong>
            </div>
          </div>
        )}

        {blockers.length > 0 && (
          <section className="ssr-alerts-group nogo" aria-labelledby="alert-blockers-title">
            <div className="ssr-alerts-group-head">
              <div>
                <span className="ssr-alerts-group-icon"><ShieldAlert size={15} /></span>
                <span>
                  <strong id="alert-blockers-title">Plan blockers</strong>
                  <small>Conditions that rule out the plan as entered</small>
                </span>
              </div>
              <b>{blockers.length}</b>
            </div>
            <div className="ssr-alerts-items">
              {blockers.map((blocker, index) => (
                <div className="ssr-alerts-item nogo" key={`blocker-${index}`}>
                  <span className="ssr-alerts-item-marker"><AlertTriangle size={15} /></span>
                  <div>
                    <span className="ssr-alerts-item-kicker">Resolve before committing</span>
                    <p>{localizeUnitText(blocker)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {cautions.length > 0 && (
          <section className="ssr-alerts-group warn" aria-labelledby="alert-cautions-title">
            <div className="ssr-alerts-group-head">
              <div>
                <span className="ssr-alerts-group-icon"><AlertTriangle size={15} /></span>
                <span>
                  <strong id="alert-cautions-title">Modeled cautions</strong>
                  <small>Adjustments to carry into the trip plan</small>
                </span>
              </div>
              <b>{cautions.length}</b>
            </div>
            <ol className="ssr-alerts-items ssr-alerts-caution-list">
              {cautions.map((caution, index) => (
                <li className="ssr-alerts-item warn" key={`caution-${index}`}>
                  <span className="ssr-alerts-priority">{index + 1}</span>
                  <div>
                    <span className="ssr-alerts-item-kicker">Planning adjustment</span>
                    <p>{localizeUnitText(caution)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {alerts.length > 0 && (
          <section className="ssr-alerts-group official" aria-labelledby="weather-alerts-title">
            <div className="ssr-alerts-group-head">
              <div>
                <span className="ssr-alerts-group-icon"><Radio size={15} /></span>
                <span>
                  <strong id="weather-alerts-title">Official weather alerts</strong>
                  <small>Notices issued for the selected area and time</small>
                </span>
              </div>
              <b>{alerts.length}</b>
            </div>
            <div className="ssr-alerts-items">
              {alerts.map((alert, index) => {
                const tone = alertTone(alert.severity);
                const activeWindow = alertWindow(alert, formatPubTime);
                const event = alert.event || 'Weather alert';
                const headline = alert.headline && alert.headline !== event ? alert.headline : null;
                const area = alert.areaDesc || alert.affectedAreas?.slice(0, 3).join(', ');
                const facts = [alert.urgency, alert.certainty].filter(Boolean);
                return (
                  <article className={`ssr-official-alert ${tone}`} key={`${event}-${alert.sent || index}`}>
                    <div className="ssr-official-alert-top">
                      <div>
                        <span className="ssr-official-label"><Radio size={12} /> Official notice</span>
                        <h3>{event}</h3>
                      </div>
                      <span className={`ssr-official-severity ${tone}`}>{alert.severity || 'Severity unknown'}</span>
                    </div>

                    {headline && <p className="ssr-official-headline">{headline}</p>}

                    <div className="ssr-official-meta">
                      {activeWindow && <span><strong>Active</strong>{activeWindow}</span>}
                      {facts.length > 0 && <span><strong>Signal</strong>{facts.join(' · ')}</span>}
                      {area && <span><MapPin size={12} aria-hidden /><strong>Area</strong>{area}</span>}
                    </div>

                    {(alert.description || alert.instruction) && (
                      <details className="ssr-official-details">
                        <summary>Alert details and instructions <ChevronRight size={13} aria-hidden /></summary>
                        {alert.description && <p>{alert.description}</p>}
                        {alert.instruction && (
                          <div className="ssr-official-instruction">
                            <strong>Official guidance</strong>
                            <p>{alert.instruction}</p>
                          </div>
                        )}
                      </details>
                    )}

                    <div className="ssr-official-footer">
                      <span>{alert.senderName || 'National Weather Service'}</span>
                      {alert.link && (
                        <a href={alert.link} target="_blank" rel="noreferrer">
                          Open official alert <ExternalLink size={12} aria-hidden />
                        </a>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
