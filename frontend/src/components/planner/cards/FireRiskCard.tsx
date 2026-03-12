import { sanitizeExternalUrl } from '../../../app/url-state';

interface FireAlert {
  event?: string;
  severity?: string;
  expires?: string;
  link?: string;
}

export interface FireRiskCardProps {
  guidance: string;
  reasons: string[];
  fireRiskAlerts: FireAlert[];
  source: string;
  formatPubTime: (isoString?: string) => string;
}

export function FireRiskCard({
  guidance,
  reasons,
  fireRiskAlerts,
  source,
  formatPubTime,
}: FireRiskCardProps) {
  return (
    <>
      <p className="muted-note">{guidance || 'No fire-risk guidance available.'}</p>
      {reasons.length > 0 && (
        <ul className="signal-list compact">
          {reasons.slice(0, 3).map((reason, idx) => (
            <li key={`fire-reason-${idx}`}>{reason}</li>
          ))}
        </ul>
      )}
      {fireRiskAlerts.length > 0 && (
        <ul className="score-trace-list nws-alert-list">
          {fireRiskAlerts.slice(0, 3).map((alert, idx) => {
            const safeAlertLink = sanitizeExternalUrl(alert.link || undefined);
            return (
              <li key={`${alert.event || 'fire-alert'}-${idx}`}>
                <span className="score-trace-hazard">{alert.event || 'Alert'}</span>
                <span className="score-trace-impact down">{alert.severity || 'Unknown'}</span>
                <small>{alert.expires ? `Expires ${formatPubTime(alert.expires)}` : 'Expiry not specified'}</small>
                {safeAlertLink && (
                  <small>
                    <a href={safeAlertLink} target="_blank" rel="noreferrer" className="raw-link-value">
                      Source link
                    </a>
                  </small>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted-note">Source: {source || 'Not provided'}</p>
    </>
  );
}
